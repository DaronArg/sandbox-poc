// Verificacion de E6 (design §7.6, §7.7, §7.9): lockdown, telemetria desktop y bloqueo de navegadores. Desarrollo.
// Las teclas reales (F12, Ctrl+Shift+I) y el Alt+Tab se mandan por Windows (SendKeys / SetForegroundWindow) SOLO si la
// ventana en primer plano es la de la app; si no, se aborta antes de mandar nada.
const { spawn, execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');
const exe = require('electron');
const { sleep, listTargets, findTarget, attach } = require('./cdp-lib');

const EV = path.resolve(process.env.EVIDENCE || '../openspec/changes/desktop-electron/qa-evidence');
const USERDATA = fs.mkdtempSync(path.join(os.tmpdir(), 'assessment-e6-'));
const PORT = 9333;
const BACKEND = 'http://localhost:9090';
const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const wsl = (...cmd) => execFileSync('wsl.exe', ['-d', 'Ubuntu', '--exec', ...cmd], { encoding: 'utf8' });
const ps = (script) => execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], { encoding: 'utf8' }).trim();
const log = (...a) => console.log(...a);
const check = (cond, msg) => { if (!cond) throw new Error('FALLO: ' + msg); log('  ok  ' + msg); };
const events = async (id) => (await fetch(`${BACKEND}/api/sessions/${id}/events`)).json();

let child = null;
const launch = (extraEnv = {}) => {
  child = spawn(exe, ['.', `--remote-debugging-port=${PORT}`], {
    cwd: process.cwd(), stdio: 'ignore',
    env: { ...process.env, ASSESSMENT_USER_DATA: USERDATA, ASSESSMENT_DEV_AUTOSTART: '1,1', ...extraEnv },
  });
  return child;
};
const killHard = () => { if (child) { try { execFileSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore' }); } catch { /* ya termino */ } child = null; } };
const exited = (c, ms = 60000) => new Promise((res, rej) => { const t = setTimeout(() => rej(new Error('no salio a tiempo')), ms); c.exitCode !== null ? (clearTimeout(t), res(c.exitCode)) : c.once('exit', (code) => { clearTimeout(t); res(code); }); });

const PS_FG = `
Add-Type @'
using System; using System.Runtime.InteropServices; using System.Text;
public class W { [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern int GetWindowText(IntPtr h, StringBuilder s, int n); }
'@
function Fg { $s = New-Object System.Text.StringBuilder 256; [void][W]::GetWindowText([W]::GetForegroundWindow(), $s, 256); $s.ToString() }
`;
// Activa la ventana por titulo, confirma que quedo en primer plano y recien ahi manda las teclas.
function sendKeysToApp(keys) {
  return ps(`${PS_FG}
$sh = New-Object -ComObject WScript.Shell
[void]$sh.AppActivate('Assessment')
Start-Sleep -Milliseconds 800
$t = Fg
if (-not $t.StartsWith('Assessment')) { 'ABORT:' + $t; exit 0 }
Add-Type -AssemblyName System.Windows.Forms
[System.Windows.Forms.SendKeys]::SendWait('${keys}')
'SENT'`);
}
const devtoolsTargets = async () => (await listTargets(PORT)).filter((t) => /devtools/i.test(t.url) || /devtools/i.test(t.type));

async function shellPage() {
  const t = await findTarget(PORT, (x) => x.url.startsWith('file:'), 60000);
  return attach(t);
}

(async () => {
  log('== arranque (autostart de desarrollo)');
  launch();
  const sh = await shellPage();
  await sh.waitFor(`!document.getElementById('bar').hidden`, 240000);
  const ide = await attach(await findTarget(PORT, (x) => x.url.includes('ide.localhost'), 60000));
  await ide.waitFor(`!!document.querySelector('.monaco-workbench')`, 120000);
  const sessions = await (await fetch(`${BACKEND}/api/sessions`)).json();
  const SID = sessions[0].id;
  log('sessionId=' + SID);

  log('== 1. ventana: titulo fijo, sin menu');
  const winInfo = ps(`Get-Process | Where-Object { $_.MainWindowTitle -like 'Assessment*' } | Select-Object -First 1 -ExpandProperty MainWindowTitle`);
  check(/^Assessment — Ana Alumna · Examen Spring Boot$/.test(winInfo), 'titulo de la ventana: ' + winInfo);

  log('== 2. F12 y Ctrl+Shift+I no abren nada (teclas reales de Windows)');
  const before = (await devtoolsTargets()).length;
  for (const [name, keys] of [['F12', '{F12}'], ['Ctrl+Shift+I', '^+i'], ['Ctrl+Shift+J', '^+j'], ['Ctrl+U', '^u']]) {
    const r = sendKeysToApp(keys);
    check(r === 'SENT', `${name} enviada a la ventana de la app (${r})`);
    await sleep(1500);
  }
  const after = await listTargets(PORT);
  check((await devtoolsTargets()).length === before, 'no aparecio ningun target de DevTools');
  check(after.filter((t) => t.type === 'page').length === 2, 'siguen solo 2 paginas (shell + IDE), sin ventanas nuevas: ' + after.map((t) => t.type + ':' + t.url.slice(0, 30)).join(' | '));

  log('== 3. window.open y links externos desde el IDE no abren nada');
  const opened = await ide.eval(`(() => { const w = window.open('https://example.com/', '_blank'); return w === null ? 'null' : 'ventana'; })()`);
  check(opened === 'null', 'window.open devuelve null');
  await ide.eval(`(() => { const a = document.createElement('a'); a.href = 'https://example.com/'; a.target = '_blank'; document.body.appendChild(a); a.click(); a.remove(); return true; })()`);
  await ide.eval(`(() => { const a = document.createElement('a'); a.href = 'https://example.com/'; document.body.appendChild(a); a.click(); a.remove(); return true; })()`);
  await ide.eval(`setTimeout(() => { location.href = 'https://example.com/'; }, 10); true`);
  await sleep(3000);
  check((await ide.eval('location.href')).startsWith('http://ide.localhost:'), 'el IDE sigue en ide.localhost tras link con target, link normal y location.href');
  check((await listTargets(PORT)).filter((t) => t.type === 'page').length === 2, 'no se creo ninguna pagina nueva');
  check(!(await listTargets(PORT)).some((t) => t.url.includes('example.com')), 'nadie navego a example.com');

  log('== 4. dos instancias -> una sola');
  const second = spawn(exe, ['.', '--remote-debugging-port=9444'], { cwd: process.cwd(), stdio: 'ignore', env: { ...process.env, ASSESSMENT_USER_DATA: USERDATA } });
  const code2 = await exited(second, 30000);
  check(code2 === 0, 'la segunda instancia termina sola (codigo ' + code2 + ')');
  check((await listTargets(PORT)).filter((t) => t.type === 'page').length === 2, 'sigue habiendo una sola ventana/instancia');

  log('== 5. cambio de pestana y foco (Alt+Tab ida y vuelta, con otra ventana real)');
  await sh.eval(`document.getElementById('tab-app').click(); true`);
  await sleep(800);
  await sh.eval(`document.getElementById('tab-ide').click(); true`);
  const r = ps(`${PS_FG}
$n = Start-Process notepad.exe -PassThru
Start-Sleep -Milliseconds 1500
$sh = New-Object -ComObject WScript.Shell
[void]$sh.AppActivate($n.Id)
Start-Sleep -Milliseconds 800
$other = Fg
Start-Sleep -Seconds 4
[void]$sh.AppActivate('Assessment')
Start-Sleep -Milliseconds 1200
$back = Fg
Stop-Process -Id $n.Id -Force
'other=' + $other + ' | back=' + $back`);
  log('  ' + r);
  check(r.includes('back=Assessment'), 'volvio el foco a la app');
  await sleep(1000);

  log('== 6. el navegador no puede usar el IDE, el front ni la API (Edge headless real)');
  const port = (await ide.eval('location.port'));
  const edge = (url, extra = []) => {
    try {
      return execFileSync(EDGE, ['--headless=new', '--disable-gpu', `--user-data-dir=${path.join(USERDATA, 'edge')}`, '--no-first-run', '--virtual-time-budget=4000', ...extra, url], { encoding: 'utf8', timeout: 45000 });
    } catch (e) { return String(e.stdout || '') + String(e.stderr || ''); }
  };
  const pages = [
    [`http://localhost:${port}/`, 'Acceso denegado', 'e6-edge-localhost-P.png'],
    [`http://ide.localhost:${port}/`, 'Acceso denegado', 'e6-edge-ide-localhost-P.png'],
    [`http://app.localhost:${port}/`, 'Acceso denegado', 'e6-edge-app-localhost-P.png'],
    ['http://localhost:8081/api/price?price=200&percent=25', 'Solo Postman/curl', 'e6-edge-localhost-8081.png'],
  ];
  for (const [url, expected, shot] of pages) {
    const dom = edge(url, ['--dump-dom']);
    check(dom.includes(expected), `Edge -> ${url} -> bloqueado ("${expected}")`);
    edge(url, [`--screenshot=${path.join(EV, shot)}`, '--window-size=900,300']);
  }
  const post = execFileSync('curl.exe', ['-s', '-o', 'NUL', '-w', '%{http_code}', 'http://localhost:8081/api/price?price=200&percent=25'], { encoding: 'utf8' });
  check(['200', '400', '500'].includes(post), 'curl.exe (como Postman) a :8081 sigue funcionando: ' + post);

  log('== 7. telemetria en la API (flush del agente <= 10 s)');
  let evs = [];
  for (let i = 0; i < 20; i++) {
    evs = await events(SID);
    const types = evs.map((e) => e.type);
    if (types.filter((t) => t === 'GATE_ACCESS_DENIED').length >= 4 && types.includes('DESKTOP_FOCUS_GAINED') && types.includes('DESKTOP_TAB_CHANGED')) break;
    await sleep(3000);
  }
  const by = (t) => evs.filter((e) => e.type === t);
  check(by('DESKTOP_STARTED').length >= 1 && JSON.parse(by('DESKTOP_STARTED')[0].payload).resumed === false, 'DESKTOP_STARTED {version, resumed:false}');
  check(by('DESKTOP_FOCUS_LOST').length >= 1, 'DESKTOP_FOCUS_LOST presente');
  const gained = by('DESKTOP_FOCUS_GAINED');
  check(gained.length >= 1 && JSON.parse(gained[gained.length - 1].payload).awayMs >= 3000, 'DESKTOP_FOCUS_GAINED con awayMs >= 3000: ' + gained.map((e) => e.payload).join(' '));
  check(by('DESKTOP_TAB_CHANGED').some((e) => JSON.parse(e.payload).tab === 'APP'), 'DESKTOP_TAB_CHANGED {tab: APP}');
  check(by('GATE_ACCESS_DENIED').length >= 4, 'GATE_ACCESS_DENIED por los 4 intentos de Edge: ' + by('GATE_ACCESS_DENIED').length);

  log('== 8. cierre normal -> DESKTOP_CLOSED');
  await sh.eval(`document.getElementById('quit').click(); true`);
  const code = await exited(child, 90000);
  child = null;
  await sleep(1000);
  const finalEvs = await events(SID);
  check(finalEvs.some((e) => e.type === 'DESKTOP_CLOSED'), 'DESKTOP_CLOSED registrado (la app salio con codigo ' + code + ')');
  log('E6 OK (session ' + SID + ')');
  process.exit(0);
})().catch((e) => { console.error(e.message); killHard(); process.exit(1); });

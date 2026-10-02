// I3: con la app real: (a) sin imagen local la app hace `docker pull` de RUNTIME_IMAGE (GHCR) y arranca; (b) "Entregar" -> API
// COMPLETED con SHA que existe en GitHub, push posterior rechazado, contenedor apagado y la app no ofrece retomar.
// Requisitos: backend corriendo con RUNTIME_IMAGE=ghcr.io/daronarg/assessment-runtime:poc (restart-backend.sh) y el paquete publicado.
// Evidencia en qa-evidence/i3-*.png. Nunca imprime secretos (lee GITHUB_TOKEN/GITHUB_REPO del .env solo para consultar GitHub).
const { spawn, execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');
const exe = require('electron');
const { sleep, findTarget, attach } = require('./cdp-lib');

const EV = path.resolve(process.env.EVIDENCE || '../openspec/changes/desktop-integration/qa-evidence');
fs.mkdirSync(EV, { recursive: true });
const IMAGE = process.env.RUNTIME_IMAGE || 'ghcr.io/daronarg/assessment-runtime:poc';
const USERDATA = fs.mkdtempSync(path.join(os.tmpdir(), 'assessment-i3-'));
const PORT = 9333;
const SKIP_PULL = process.env.SKIP_PULL === '1'; // reintento sin volver a bajar 3.8 GB
const B = 'http://localhost:9090';
const wsl = (...cmd) => execFileSync('wsl.exe', ['-d', 'Ubuntu', '--exec', ...cmd], { encoding: 'utf8' });
const check = (cond, msg) => { if (!cond) throw new Error('FALLO: ' + msg); console.log('  ok  ' + msg); };
const running = () => wsl('docker', 'ps', '--format', '{{.Names}}').trim();
const env = Object.fromEntries(fs.readFileSync(path.resolve('..', '.env'), 'utf8').split(/\r?\n/).map((l) => l.match(/^([A-Z_]+)=(.*)$/)).filter(Boolean).map((m) => [m[1], m[2]]));
const gh = (p) => fetch(`https://api.github.com/repos/${env.GITHUB_REPO}/${p}`, { headers: { Authorization: `Bearer ${env.GITHUB_TOKEN}` } }).then((r) => r.status);
let child = null;
const killHard = () => { if (child) { try { execFileSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore' }); } catch { /* ya salio */ } child = null; } };
const launch = () => spawn(exe, ['.', `--remote-debugging-port=${PORT}`], { cwd: process.cwd(), stdio: 'ignore', env: { ...process.env, ASSESSMENT_USER_DATA: USERDATA, ASSESSMENT_TEST_DIALOG_LOG: path.join(USERDATA, 'dialogs.log'), ASSESSMENT_TEST_DIALOG_ANSWER: '0' } });

(async () => {
  console.log('== preparacion: sin contenedores y SIN la imagen local (se borra con docker rmi)');
  wsl('bash', '-c', 'docker ps -aq | xargs -r docker rm -f >/dev/null');
  if (!SKIP_PULL) {
    wsl('bash', '-c', `docker rmi -f ${IMAGE} assessment-runtime:poc >/dev/null 2>&1 || true`);
    check(wsl('bash', '-c', `docker images -q ${IMAGE} | wc -l`).trim() === '0', 'la imagen ya no esta en el Docker local');
  }

  child = launch();
  const sh = await attach(await findTarget(PORT, (x) => x.url.startsWith('assessment:'), 60000));
  await sh.waitFor(`!document.getElementById('form').hidden`, 60000);
  await sh.eval(`document.getElementById('begin').click(); true`);
  let pulled = false;
  const end = Date.now() + 600000;
  while (Date.now() < end) {
    if (await sh.eval(`!document.getElementById('bar').hidden`).catch(() => false)) break;
    const d = await sh.eval(`document.querySelector('[data-step="image"] .detail')?.innerText ?? ''`).catch(() => '');
    if (/Descargando/.test(d) && !pulled) { pulled = true; await sh.screenshot(`${EV}/i3-pull-progreso.png`); }
    await sleep(1000);
  }
  if (!SKIP_PULL) check(pulled, 'el paso "Imagen del entorno" mostro "Descargando la imagen"');
  check(wsl('bash', '-c', `docker images -q ${IMAGE} | wc -l`).trim() === '1', 'la imagen quedo en el Docker local (pull desde GHCR)');
  const c = running();
  check(/^assessment-\d+-[0-9a-f]{6}$/.test(c), 'sesion iniciada tras el pull: ' + c);
  const sid = Number(c.split('-')[1]);
  const token = wsl('docker', 'exec', c, 'printenv', 'SESSION_TOKEN').trim();
  await sleep(3000);
  await sh.screenshot(`${EV}/i3-workspace-barra-entregar.png`);
  check(await sh.eval(`!!document.getElementById('submit') && !document.getElementById('submit').closest('#bar').hidden`), 'la barra muestra el boton Entregar');

  console.log('== Entregar: cambio sin commitear + click');
  wsl('docker', 'exec', '-u', 'coder', c, 'bash', '-c', `echo entrega-i3-${sid} > /workspace/entrega-i3.txt`);
  await sh.eval(`document.getElementById('submit').click(); true`);
  await sh.waitFor(`!document.getElementById('submitted').hidden`, 240000);
  const sha = await sh.eval(`document.getElementById('sha').innerText`);
  check(/^[0-9a-f]{40}$/.test(sha), 'pantalla "Entrega registrada" con SHA ' + sha);
  await sh.screenshot(`${EV}/i3-entrega-registrada.png`);
  const dialogs = fs.readFileSync(path.join(USERDATA, 'dialogs.log'), 'utf8');
  check(/Vas a entregar el examen/.test(dialogs), 'se pidio confirmacion antes de entregar');

  const s = (await (await fetch(`${B}/api/sessions`)).json()).find((x) => x.id === sid);
  check(s.status === 'COMPLETED' && s.finalSha === sha, `API: status COMPLETED, finalSha == SHA de la pantalla`);
  check((await gh(`commits/${sha}`)) === 200, 'el SHA existe en GitHub');
  const events = await (await fetch(`${B}/api/sessions/${sid}/events`)).json();
  check(events.some((e) => e.type === 'SUBMISSION_COMPLETED'), 'evento SUBMISSION_COMPLETED en la timeline');
  check(running() === '', 'contenedor apagado');
  const basic = 'Basic ' + Buffer.from(`session:${token}`).toString('base64');
  const push = await fetch(`${B}/git/${sid}/repo.git/info/refs?service=git-receive-pack`, { headers: { Authorization: basic } });
  check(push.status === 401, `push posterior rechazado (git-receive-pack -> ${push.status})`);
  const tel = await fetch(`${B}/api/telemetry/batch`, { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ sessionId: sid, events: [] }) });
  check(tel.status === 401, `telemetria posterior rechazada (${tel.status})`);
  await sh.eval(`document.getElementById('submitted-quit').click(); true`);
  await new Promise((res) => (child.exitCode !== null ? res() : child.once('exit', res)));
  child = null;

  console.log('== reabrir la app: no ofrece retomar la sesion entregada');
  child = launch();
  const sh2 = await attach(await findTarget(PORT, (x) => x.url.startsWith('assessment:'), 60000));
  await sh2.waitFor(`!document.getElementById('form').hidden`, 60000);
  check(await sh2.eval(`document.getElementById('resume-card').hidden`), 'no hay tarjeta "Retomar"');
  await sh2.screenshot(`${EV}/i3-sin-retomar.png`);
  killHard();

  console.log('== restaurar la etiqueta local assessment-runtime:poc');
  wsl('docker', 'tag', IMAGE, 'assessment-runtime:poc');
  await fetch(`https://api.github.com/repos/${env.GITHUB_REPO}/git/refs/heads/${s.branch}`, { method: 'DELETE', headers: { Authorization: `Bearer ${env.GITHUB_TOKEN}` } }); // limpia la rama de prueba
  console.log('I3 check OK');
  process.exit(0);
})().catch((e) => { console.error(e.message); killHard(); process.exit(1); });

// Verificacion de E5 (design §7.3-§7.5) automatizada, con evidencia en qa-evidence/. Desarrollo; no se empaqueta.
// Requiere backend :9090, imagen assessment-runtime:poc y upstream git local (o GitHub) listos.
const { spawn, execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');
const exe = require('electron');
const { sleep, findTarget, attach } = require('./cdp-lib');

const EV = path.resolve(process.env.EVIDENCE || '../openspec/changes/desktop-electron/qa-evidence');
const USERDATA = fs.mkdtempSync(path.join(os.tmpdir(), 'assessment-e5-'));
const DIALOGS = path.join(USERDATA, 'dialogs.log');
const PORT = 9333;
const wsl = (...cmd) => execFileSync('wsl.exe', ['-d', 'Ubuntu', '--exec', ...cmd], { encoding: 'utf8' });
const log = (...a) => console.log(...a);
const check = (cond, msg) => { if (!cond) throw new Error('FALLO: ' + msg); log('  ok  ' + msg); };
const running = () => wsl('docker', 'ps', '--format', '{{.Names}}').trim();

let child = null;
function launch() {
  child = spawn(exe, ['.', `--remote-debugging-port=${PORT}`], {
    cwd: process.cwd(), stdio: 'ignore',
    env: { ...process.env, ASSESSMENT_USER_DATA: USERDATA, ASSESSMENT_TEST_DIALOG_LOG: DIALOGS, ASSESSMENT_TEST_DIALOG_ANSWER: '0' },
  });
  return child;
}
function killHard() { if (child) { try { execFileSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore' }); } catch { /* ya termino */ } child = null; } }
const exited = (c) => new Promise((res) => (c.exitCode !== null ? res() : c.once('exit', res)));

async function shellPage() {
  const t = await findTarget(PORT, (x) => x.url.startsWith('assessment:'), 60000);
  if (!t) throw new Error('no hay pagina del shell');
  return attach(t);
}
async function waitVisible(sh, id, ms = 120000) { await sh.waitFor(`!document.getElementById('${id}').hidden`, ms); }
const click = (sh, id) => sh.eval(`document.getElementById('${id}').click(); true`);
const viewTarget = (host, ms = 180000) => findTarget(PORT, (x) => x.url.includes(host + '.localhost'), ms);

async function ideTerminal(ide, text) {
  await ide.waitFor(`!!document.querySelector('.monaco-workbench')`, 120000);
  await ide.waitFor(`document.body.innerText.includes('pom.xml')`, 120000);
  await sleep(1500);
  await ide.key('`', { code: 'Backquote', vk: 192, modifiers: 2 });
  await ide.waitFor(`!!document.querySelector('.xterm')`, 30000);
  await sleep(3000);
  await ide.type(text);
  await ide.enter();
}

(async () => {
  wsl('bash', '-c', 'docker ps -aq | xargs -r docker rm -f >/dev/null');
  log('== 1. Iniciar desde el formulario');
  launch();
  let sh = await shellPage();
  await waitVisible(sh, 'form', 60000);
  await sh.waitFor(`document.getElementById('student').options.length >= 2 && document.getElementById('exam').options.length >= 1`, 30000);
  check(true, 'el formulario lista alumnos y examenes del backend');
  await sh.screenshot(`${EV}/e5-1-inicio.png`);
  await click(sh, 'begin');
  await waitVisible(sh, 'progress', 10000);
  await sh.screenshot(`${EV}/e5-2-progreso.png`);
  await waitVisible(sh, 'bar', 240000);
  check((await sh.eval(`document.getElementById('who').innerText`)).includes('Ana Alumna'), 'barra superior muestra alumno y estado activa');
  await sh.screenshot(`${EV}/e5-3-workspace-barra.png`);
  const containerName = running();
  check(/^assessment-\d+-[0-9a-f]{6}$/.test(containerName), 'hay un contenedor de sesion: ' + containerName);

  log('== 2. Pestana App: placeholder con el front apagado');
  await click(sh, 'tab-app');
  await sleep(1500);
  check(!(await sh.eval(`document.getElementById('app-placeholder').hidden`)), 'se muestra el placeholder de la App');
  check((await sh.eval(`document.getElementById('app-placeholder').innerText`)).includes('npm run dev'), 'el placeholder indica como levantar el front');
  await sh.screenshot(`${EV}/e5-4-app-placeholder.png`);
  await click(sh, 'tab-ide');

  log('== 3. npm run dev desde la terminal del IDE y la pestana App muestra el front');
  const ide = await attach(await viewTarget('ide', 60000));
  await ideTerminal(ide, 'cd frontend && npm install --no-audit --no-fund && npm run dev');
  const appT = await viewTarget('app', 240000);
  check(!!appT, 'aparecio la vista App (el front respondio 200 por el gate)');
  await click(sh, 'tab-app');
  await sleep(2500);
  check(await sh.eval(`document.getElementById('app-placeholder').hidden`), 'el placeholder desaparece');
  const app = await attach(appT);
  await app.waitFor(`document.querySelector('h1') && document.querySelector('h1').innerText === 'Calculadora de precios'`, 30000);
  await sleep(1500);
  await app.screenshot(`${EV}/e5-5-app-front.png`);

  log('== 4. Editar el front: la pestana App refleja el cambio sin recargar (HMR de Vite)');
  wsl('docker', 'exec', '-u', 'coder', containerName, 'sed', '-i', 's/Calculadora de precios/Calculadora de precios v2/', '/workspace/frontend/index.html');
  await app.waitFor(`document.querySelector('h1').innerText === 'Calculadora de precios v2'`, 30000);
  check(true, 'la pestana App muestra el h1 editado');
  await app.screenshot(`${EV}/e5-6-app-editado.png`);
  app.close();
  ide.close();

  log('== 5. Salir con cambios sin pushear -> aviso');
  await click(sh, 'quit');
  await exited(child);
  const dlg = fs.readFileSync(DIALOGS, 'utf8').trim().split('\n').map((l) => JSON.parse(l));
  const last = dlg[dlg.length - 1];
  check(last.message.includes('Se va a apagar el entorno') && (last.detail || '').includes('cambios sin subir'), 'el dialogo avisa de cambios sin subir: ' + JSON.stringify(last.detail));
  check(running() === '', 'el contenedor se apago');
  child = null;

  log('== 6. Reabrir -> Retomar -> mismo archivo editado');
  launch();
  sh = await shellPage();
  await waitVisible(sh, 'resume-card', 60000);
  const txt = await sh.eval(`document.getElementById('resume-text').innerText`);
  check(txt.includes('Ana Alumna') && txt.includes('Examen Spring Boot') && /rama session-\d+-[0-9a-f]{6}/.test(txt), 'tarjeta Retomar: ' + txt);
  await sh.screenshot(`${EV}/e5-7-retomar.png`);
  await click(sh, 'resume');
  await waitVisible(sh, 'bar', 240000);
  const name2 = running();
  check(name2 === containerName, 'se reutiliza el mismo nombre de contenedor y volumen: ' + name2);
  check(wsl('docker', 'exec', '-u', 'coder', name2, 'grep', '-c', 'precios v2', '/workspace/frontend/index.html').trim() >= 1, 'el volumen conserva el archivo editado (v2)');
  const ide2 = await attach(await viewTarget('ide', 60000));
  await ide2.waitFor(`document.body.innerText.includes('frontend')`, 120000);
  await sleep(1500);
  await ide2.screenshot(`${EV}/e5-8-retomado-ide.png`);
  ide2.close();

  log('== 7. Matar el proceso de Electron y reabrir -> recupera');
  killHard();
  await sleep(1500);
  check(running() === containerName, 'tras el kill el contenedor sigue corriendo (cierre abrupto)');
  launch();
  sh = await shellPage();
  await waitVisible(sh, 'resume-card', 60000);
  await click(sh, 'resume');
  await waitVisible(sh, 'bar', 240000);
  check(running() === containerName, 'el paso Contenedor hizo rm -f y recreo el contenedor: ' + running());
  check(wsl('docker', 'exec', '-u', 'coder', containerName, 'grep', '-c', 'precios v2', '/workspace/frontend/index.html').trim() >= 1, 'el codigo sigue ahi tras la recuperacion');

  log('== 8. docker stop manual -> pantalla de error -> Reiniciar');
  wsl('docker', 'stop', '-t', '2', containerName);
  await waitVisible(sh, 'error', 30000);
  check((await sh.eval(`document.getElementById('error-title').innerText`)) === 'El entorno se detuvo', 'pantalla "El entorno se detuvo"');
  check((await sh.eval(`document.getElementById('retry').innerText`)) === 'Reiniciar', 'el boton dice Reiniciar');
  await sh.screenshot(`${EV}/e5-9-entorno-detenido.png`);
  await click(sh, 'retry');
  await waitVisible(sh, 'bar', 240000);
  check(running() === containerName, 'Reiniciar vuelve a levantar el entorno');

  log('== 9. Iniciar otra sesion');
  await click(sh, 'quit');
  await exited(child); child = null;
  launch();
  sh = await shellPage();
  await waitVisible(sh, 'resume-card', 60000);
  await click(sh, 'other');
  await waitVisible(sh, 'form', 20000);
  const other = fs.readFileSync(DIALOGS, 'utf8').trim().split('\n').map((l) => JSON.parse(l)).pop();
  check(other.message.includes('reemplazar la sesion guardada'), 'confirmacion antes de reemplazar la sesion guardada');
  killHard();
  log('E5 OK');
  process.exit(0);
})().catch((e) => { console.error(e.message); killHard(); process.exit(1); });

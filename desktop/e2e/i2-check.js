// I2: en una sesion real de la app (repo clonado de GitHub), spring-boot:run + npm install && npm start -> la pestana App
// muestra "Precio final" consumiendo /api relativo por el proxy de ng serve. Evidencia en qa-evidence/i2-*.png.
const { spawn, execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');
const exe = require('electron');
const { sleep, findTarget, attach } = require('./cdp-lib');

const EV = path.resolve(process.env.EVIDENCE || '../openspec/changes/desktop-integration/qa-evidence');
fs.mkdirSync(EV, { recursive: true });
const USERDATA = fs.mkdtempSync(path.join(os.tmpdir(), 'assessment-i2-'));
const PORT = 9333;
const wsl = (...cmd) => execFileSync('wsl.exe', ['-d', 'Ubuntu', '--exec', ...cmd], { encoding: 'utf8' });
const check = (cond, msg) => { if (!cond) throw new Error('FALLO: ' + msg); console.log('  ok  ' + msg); };
const running = () => wsl('docker', 'ps', '--format', '{{.Names}}').trim();
let child = null;
const killHard = () => { if (child) { try { execFileSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore' }); } catch { /* ya salio */ } child = null; } };

(async () => {
  wsl('bash', '-c', 'docker ps -aq | xargs -r docker rm -f >/dev/null');
  child = spawn(exe, ['.', `--remote-debugging-port=${PORT}`], { cwd: process.cwd(), stdio: 'ignore', env: { ...process.env, ASSESSMENT_USER_DATA: USERDATA, ASSESSMENT_TEST_DIALOG_LOG: path.join(USERDATA, 'dialogs.log'), ASSESSMENT_TEST_DIALOG_ANSWER: '0' } });
  const sh = await attach(await findTarget(PORT, (x) => x.url.startsWith('assessment:'), 60000));
  await sh.waitFor(`!document.getElementById('form').hidden`, 60000);
  await sh.eval(`document.getElementById('begin').click(); true`);
  await sh.waitFor(`!document.getElementById('bar').hidden`, 240000);
  const c = running();
  check(/^assessment-\d+-[0-9a-f]{6}$/.test(c), 'sesion iniciada: ' + c);
  const remote = wsl('docker', 'exec', '-u', 'coder', c, 'git', '-C', '/workspace', 'remote', 'get-url', 'origin');
  check(remote.length > 0 && !remote.includes('@'), 'workspace clonado por el proxy git del backend');
  // el alumno implementa applyDiscount (se simula en el workspace del contenedor; el repo de examen no se toca)
  wsl('docker', 'exec', '-u', 'coder', c, 'node', '-e',
    `const f='/workspace/src/main/java/com/example/exam/PriceService.java';let s=require('fs').readFileSync(f,'utf8');` +
    `s=s.replace('throw new UnsupportedOperationException("not implemented");','if (price < 0 || percent < 0 || percent > 100) throw new IllegalArgumentException("invalid"); return price * (100 - percent) / 100.0;');require('fs').writeFileSync(f,s)`);
  wsl('docker', 'exec', '-u', 'coder', '-d', c, 'bash', '-c', 'cd /workspace && ./mvnw -q spring-boot:run >/tmp/api.log 2>&1');
  wsl('docker', 'exec', '-u', 'coder', c, 'bash', '-c', 'cd /workspace/frontend && npm install --no-audit --no-fund >/tmp/npm.log 2>&1');
  wsl('docker', 'exec', '-u', 'coder', '-d', c, 'bash', '-c', 'cd /workspace/frontend && npm start >/tmp/ng-serve.log 2>&1');
  await sh.eval(`document.getElementById('tab-app').click(); true`);
  const appT = await findTarget(PORT, (x) => x.url.includes('app.localhost'), 240000);
  check(!!appT, 'aparecio la vista App (ng serve respondio por el gate)');
  const app = await attach(appT);
  await app.waitFor(`document.getElementById('out') && document.getElementById('out').innerText.includes('Precio final: $150')`, 120000);
  check(true, 'la pestana App muestra "Precio final: $150" (llamo a /api relativo, sin CORS)');
  await sleep(1000);
  await app.screenshot(`${EV}/i2-app-precio-final.png`);
  app.close();
  await sh.eval(`document.getElementById('quit').click(); true`);
  await new Promise((res) => (child.exitCode !== null ? res() : child.once('exit', res)));
  child = null;
  console.log('I2 check OK');
  process.exit(0);
})().catch((e) => { console.error(e.message); killHard(); process.exit(1); });

// I4: Definition of Done de desktop-integration (design §5) sobre la app real con credenciales reales (Anthropic, GitHub, CI).
// Evidencia en qa-evidence/i4-*.png. Nunca imprime secretos. El rechazo de CDP en el binario empaquetado va en e7-check.js.
const { spawn, execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');
const exe = require('electron');
const { sleep, findTarget, attach } = require('./cdp-lib');

const EV = path.resolve(process.env.EVIDENCE || '../openspec/changes/desktop-integration/qa-evidence');
const USERDATA = fs.mkdtempSync(path.join(os.tmpdir(), 'assessment-i4-'));
const DIALOGS = path.join(USERDATA, 'dialogs.log');
const PORT = 9333;
const BACKEND = 'http://localhost:9090';
const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const wsl = (...cmd) => execFileSync('wsl.exe', ['-d', 'Ubuntu', '--exec', ...cmd], { encoding: 'utf8' });
const curl = (...a) => execFileSync('curl.exe', ['-s', ...a], { encoding: 'utf8' });
const running = () => wsl('docker', 'ps', '--format', '{{.Names}}').trim();
const env = Object.fromEntries(fs.readFileSync(path.resolve('..', '.env'), 'utf8').split(/\r?\n/).map((l) => l.match(/^([A-Z_]+)=(.*)$/)).filter(Boolean).map((m) => [m[1], m[2]]));
const ghapi = (p, o = {}) => fetch(`https://api.github.com/repos/${env.GITHUB_REPO}/${p}`, { ...o, headers: { Authorization: `Bearer ${env.GITHUB_TOKEN}`, Accept: 'application/vnd.github+json' } });
const log = (...a) => console.log(...a);
const check = (cond, msg) => { if (!cond) throw new Error('FALLO: ' + msg); log('  ok  ' + msg); };

let child = null;
const launch = () => { child = spawn(exe, ['.', `--remote-debugging-port=${PORT}`], { cwd: process.cwd(), stdio: 'ignore', env: { ...process.env, ASSESSMENT_USER_DATA: USERDATA, ASSESSMENT_TEST_DIALOG_LOG: DIALOGS, ASSESSMENT_TEST_DIALOG_ANSWER: '0' } }); return child; };
const killHard = () => { if (child) { try { execFileSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore' }); } catch { /* ya salio */ } child = null; } };
const exited = (c, ms = 120000) => new Promise((res, rej) => { const t = setTimeout(() => rej(new Error('no salio a tiempo')), ms); c.exitCode !== null ? (clearTimeout(t), res(c.exitCode)) : c.once('exit', (code) => { clearTimeout(t); res(code); }); });
const shellPage = async () => attach(await findTarget(PORT, (x) => x.url.startsWith('assessment:'), 60000));
const waitVisible = (sh, id, ms = 240000) => sh.waitFor(`!document.getElementById('${id}').hidden`, ms);
const click = (sh, id) => sh.eval(`document.getElementById('${id}').click(); true`);
const events = async (id) => (await fetch(`${BACKEND}/api/sessions/${id}/events`)).json();
const CTRL = 2, SHIFT = 8;
const termType = async (ide, text) => { await ide.type(text); await ide.enter(); };
const newTerminal = async (ide) => { await ide.send('Page.bringToFront'); await ide.key('`', { code: 'Backquote', vk: 192, modifiers: CTRL | SHIFT }); await sleep(3500); await ide.eval(`(document.querySelector('.terminal-wrapper.active .xterm-helper-textarea')||document.querySelector('.xterm-helper-textarea')).focus(); true`); };

(async () => {
  wsl('bash', '-c', 'docker ps -aq | xargs -r docker rm -f >/dev/null');
  log('== DoD 2: desde la app se elige alumno y examen y aparece el IDE con el repo clonado en session-<id>-<hex>');
  launch();
  let sh = await shellPage();
  await waitVisible(sh, 'form', 60000);
  await click(sh, 'begin');
  await waitVisible(sh, 'bar');
  const container = running();
  const sid = Number(container.split('-')[1]);
  const ide = await attach(await findTarget(PORT, (x) => x.url.includes('ide.localhost'), 60000));
  await ide.waitFor(`!!document.querySelector('.monaco-workbench')`, 120000);
  await ide.waitFor(`document.body.innerText.includes('pom.xml')`, 120000);
  const branch = wsl('docker', 'exec', '-u', 'coder', container, 'git', '-C', '/workspace', 'rev-parse', '--abbrev-ref', 'HEAD').trim();
  check(/^session-\d+-[0-9a-f]{6}$/.test(branch), `IDE con el repo clonado en la rama ${branch}`);
  await sleep(2500);
  await ide.screenshot(`${EV}/i4-2-ide-repo-clonado.png`);

  log('== DoD 4: el chat de Continue responde dentro de la app (AI_PROMPT / AI_RESPONSE con la API key real)');
  await ide.eval(`(document.querySelector('.activitybar .action-label[aria-label*="Continue"]')||{click(){}}).click();true`);
  await sleep(6000);
  const dpr = await ide.eval('devicePixelRatio');
  await ide.click(110 * 1.72 / dpr, 72 * 1.72 / dpr);
  await sleep(1500);
  await ide.type('Responde solo con la palabra pong');
  await ide.enter();
  let ai = false;
  for (let i = 0; i < 30 && !ai; i++) { await sleep(2000); const t = (await events(sid)).map((e) => e.type); ai = t.includes('AI_PROMPT') && t.includes('AI_RESPONSE'); }
  check(ai, 'AI_PROMPT y AI_RESPONSE en la timeline (Anthropic real a traves del gateway)');
  await sleep(3000);
  await ide.screenshot(`${EV}/i4-4-continue-chat.png`);
  await ide.eval(`(document.querySelector('.activitybar .action-label[aria-label*="Explorer"]')||{click(){}}).click();true`);

  // el alumno implementa applyDiscount (se simula editando el workspace del contenedor; el repo de examen no se toca)
  wsl('docker', 'exec', '-u', 'coder', container, 'node', '-e',
    `const f='/workspace/src/main/java/com/example/exam/PriceService.java';let s=require('fs').readFileSync(f,'utf8');` +
    `s=s.replace('throw new UnsupportedOperationException("not implemented");','if (price < 0 || percent < 0 || percent > 100) throw new IllegalArgumentException("invalid"); return price * (100 - percent) / 100.0;');require('fs').writeFileSync(f,s)`);

  log('== DoD 3: en la terminal del IDE corre ./mvnw test, ./mvnw spring-boot:run levanta en 8081 y curl.exe (como Postman) responde');
  await ide.key('`', { code: 'Backquote', vk: 192, modifiers: CTRL });
  await ide.waitFor(`!!document.querySelector('.xterm')`, 30000);
  await sleep(3000);
  await termType(ide, './mvnw test');
  let ok = false;
  for (let i = 0; i < 60 && !ok; i++) { await sleep(5000); ok = (await events(sid)).some((e) => e.type === 'COMMAND_EXECUTED' && JSON.parse(e.payload).command === './mvnw test' && JSON.parse(e.payload).exitCode === 0); }
  check(ok, '`./mvnw test` corrio en la terminal del IDE y termino con exit 0 (COMMAND_EXECUTED en la timeline)');
  await ide.screenshot(`${EV}/i4-3-mvnw-test.png`);
  await termType(ide, './mvnw spring-boot:run');
  let body = '';
  for (let i = 0; i < 40; i++) { await sleep(3000); body = curl('-w', '|%{http_code}', 'http://localhost:8081/api/price?price=200&percent=25'); if (body.endsWith('|200')) break; }
  check(body.endsWith('|200') && JSON.parse(body.split('|')[0]).finalPrice === 150, 'curl.exe a localhost:8081/api/price?price=200&percent=25 -> ' + body);
  await ide.screenshot(`${EV}/i4-3-spring-boot-run.png`);

  log('== DoD 4: npm start en frontend/ y la pestana App muestra la calculadora consumiendo la API');
  await newTerminal(ide);
  await termType(ide, 'cd frontend && npm install --no-audit --no-fund && npm start');
  const appT = await findTarget(PORT, (x) => x.url.includes('app.localhost'), 240000);
  check(!!appT, 'aparecio la vista App');
  await click(sh, 'tab-app');
  await sleep(2500);
  const app = await attach(appT);
  await app.waitFor(`document.getElementById('out') && document.getElementById('out').innerText.includes('Precio final: $150')`, 60000);
  check(true, 'la calculadora muestra "Precio final: $150" (llamo a /api por el proxy de ng serve)');
  await app.screenshot(`${EV}/i4-4-app-calculadora.png`);
  app.close();
  await click(sh, 'tab-ide');

  log('== DoD 5: Chrome y Edge a localhost:<P>, ide.localhost:<P>, app.localhost:<P> y localhost:8081 -> bloqueados');
  const gatePort = wsl('docker', 'port', container, '7000/tcp').trim().split('\n')[0].split(':').pop();
  const browser = (bin, name, url, expected, shot) => {
    const common = ['--headless=new', '--disable-gpu', `--user-data-dir=${path.join(USERDATA, name)}`, '--no-first-run', '--virtual-time-budget=4000'];
    let dom = '';
    try { dom = execFileSync(bin, [...common, '--dump-dom', url], { encoding: 'utf8', timeout: 45000 }); } catch (e) { dom = String(e.stdout || ''); }
    check(dom.includes(expected), `${name} -> ${url} -> bloqueado ("${expected}")`);
    if (shot) { try { execFileSync(bin, [...common, `--screenshot=${path.join(EV, shot)}`, '--window-size=900,300', url], { stdio: 'ignore', timeout: 45000 }); } catch { /* la captura es solo evidencia */ } }
  };
  for (const [bin, name] of [[EDGE, 'edge'], [CHROME, 'chrome']]) {
    browser(bin, name, `http://localhost:${gatePort}/`, 'Acceso denegado', `i4-5-${name}-localhost-P.png`);
    browser(bin, name, `http://ide.localhost:${gatePort}/`, 'Acceso denegado');
    browser(bin, name, `http://app.localhost:${gatePort}/`, 'Acceso denegado');
    browser(bin, name, 'http://localhost:8081/api/price?price=200&percent=25', 'Solo Postman/curl', `i4-5-${name}-localhost-8081.png`);
  }
  let denied = 0;
  for (let i = 0; i < 20 && denied < 4; i++) { await sleep(3000); denied = (await events(sid)).filter((e) => e.type === 'GATE_ACCESS_DENIED').length; }
  check(denied >= 4, `GATE_ACCESS_DENIED en la timeline: ${denied} (el gate registra como maximo una linea cada 30 s por puerto+host: Chrome y Edge consecutivos comparten las 4 combinaciones)`);

  log('== DoD 5: git push desde la terminal del IDE llega a GitHub real (GIT_PUSH) y dispara CI');
  wsl('docker', 'exec', container, 'bash', '-c', "pkill -f '[s]pring-boot'; pkill -f '[n]g serve'; true"); // el alumno detiene los servidores antes de entregar
  await sleep(5000);
  // la 3ra terminal nueva queda sin prompt con la carga actual: se reutiliza la primera (shell ya en prompt tras detener spring-boot)
  await ide.eval(`document.querySelector('.tabs-list .monaco-list-row').click(); true`);
  await sleep(2000);
  await ide.eval(`document.querySelector('.terminal-wrapper.active .xterm-helper-textarea').focus(); true`);
  await termType(ide, 'cd /workspace && git add -A && git commit -qm "feat: implement applyDiscount" && git push -u origin HEAD');
  let pushed = false;
  for (let i = 0; i < 100 && !pushed; i++) { await sleep(3000); pushed = (await events(sid)).some((e) => e.type === 'GIT_PUSH'); }
  if (!pushed) await ide.screenshot(EV + '/i4-debug-push.png');
  check(pushed, 'GIT_PUSH registrado');
  const localHead = wsl('docker', 'exec', '-u', 'coder', container, 'git', '-C', '/workspace', 'rev-parse', 'HEAD').trim();
  const ref = await (await ghapi(`git/ref/heads/${branch}`)).json();
  check(ref.object && ref.object.sha === localHead, `el branch ${branch} existe en GitHub real con el mismo commit (${localHead.slice(0, 7)})`);
  let run = null;
  for (let i = 0; i < 30 && !run; i++) { await sleep(4000); run = ((await (await ghapi(`actions/runs?head_sha=${localHead}`)).json()).workflow_runs || [])[0]; }
  check(!!run, `CI disparado en GitHub Actions (run ${run && run.id}: ${run && run.status})`);
  await ide.screenshot(`${EV}/i4-5-git-push.png`);
  ide.close();

  log('== DoD 7: Salir sin nada pendiente no avisa; apaga el contenedor; Retomar tras reiniciar el backend muestra el mismo codigo');
  await click(sh, 'quit');
  await exited(child); child = null;
  const dlg = fs.readFileSync(DIALOGS, 'utf8').trim().split('\n').map((l) => JSON.parse(l)).pop();
  check(dlg.message.includes('Se va a apagar el entorno') && !dlg.detail, 'el dialogo no avisa de cambios sin subir (todo commiteado y pusheado): ' + JSON.stringify(dlg.detail));
  check(running() === '', 'el contenedor se apago');
  wsl('bash', '-c', 'cd /mnt/f/repos/tpi-tup/sandbox-poc && ./scripts/restart-backend.sh');
  launch();
  sh = await shellPage();
  await waitVisible(sh, 'resume-card', 60000);
  check((await sh.eval(`document.getElementById('resume-text').innerText`)).includes(branch), 'Retomar sigue ofreciendo la sesion tras reiniciar el backend: ' + branch);
  await click(sh, 'resume');
  await waitVisible(sh, 'bar');
  check(running() === container, 'mismo contenedor/volumen');
  const resumedHead = wsl('docker', 'exec', '-u', 'coder', container, 'git', '-C', '/workspace', 'rev-parse', 'HEAD').trim();
  check(resumedHead === localHead, 'el mismo codigo: HEAD ' + resumedHead.slice(0, 7));
  check(wsl('docker', 'exec', '-u', 'coder', container, 'grep', '-c', 'percent', '/workspace/src/main/java/com/example/exam/PriceService.java').trim() >= 1, 'PriceService conserva la implementacion del alumno');
  const ide2 = await attach(await findTarget(PORT, (x) => x.url.includes('ide.localhost'), 60000));
  await ide2.waitFor(`document.body.innerText.includes('pom.xml')`, 120000);
  await sleep(2000);
  await ide2.screenshot(`${EV}/i4-7-retomado.png`);
  ide2.close();

  log('== DoD 6: Entregar -> COMPLETED con SHA final; despues el token no sirve');
  const token = wsl('docker', 'exec', container, 'printenv', 'SESSION_TOKEN').trim();
  await click(sh, 'submit');
  await sh.waitFor(`!document.getElementById('submitted').hidden`, 240000);
  const sha = await sh.eval(`document.getElementById('sha').innerText`);
  check(sha === localHead, 'pantalla "Entrega registrada" con el SHA del ultimo push ' + sha.slice(0, 7));
  await sh.screenshot(`${EV}/i4-6-entrega-registrada.png`);
  const s = (await (await fetch(`${BACKEND}/api/sessions`)).json()).find((x) => x.id === sid);
  check(s.status === 'COMPLETED' && s.finalSha === sha, 'API: COMPLETED con finalSha == SHA de la pantalla');
  check((await ghapi(`commits/${sha}`)).status === 200, 'el SHA existe en GitHub');
  check(running() === '', 'contenedor apagado');
  const basic = 'Basic ' + Buffer.from(`session:${token}`).toString('base64');
  const rp = await fetch(`${BACKEND}/git/${sid}/repo.git/info/refs?service=git-receive-pack`, { headers: { Authorization: basic } });
  check(rp.status === 401, `push posterior rechazado (${rp.status})`);
  const tel = await fetch(`${BACKEND}/api/telemetry/batch`, { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ sessionId: sid, events: [] }) });
  check(tel.status === 401, `telemetria posterior rechazada (${tel.status})`);
  await click(sh, 'submitted-quit');
  await exited(child); child = null;

  log('== DoD 8: panel del profesor con timeline, eventos DESKTOP_*, bloqueos, SHA final y resultado de CI');
  let result = {};
  for (let i = 0; i < 60; i++) { result = await (await fetch(`${BACKEND}/api/sessions/${sid}/result`)).json(); if (result.ciStatus === 'completed') break; await sleep(5000); }
  check(result.ciStatus === 'completed', `CI termino: ${result.ciStatus} / ${result.ciConclusion}`);
  const evs = await events(sid);
  const types = new Set(evs.map((e) => e.type));
  for (const t of ['SESSION_STARTED', 'DESKTOP_STARTED', 'DESKTOP_TAB_CHANGED', 'DESKTOP_CLOSED', 'GATE_ACCESS_DENIED', 'AI_PROMPT', 'AI_RESPONSE', 'GIT_PUSH', 'COMMAND_EXECUTED', 'FILE_CHANGED', 'SUBMISSION_COMPLETED']) check(types.has(t), `la timeline tiene ${t}`);
  check(evs.filter((e) => e.type === 'DESKTOP_STARTED').some((e) => JSON.parse(e.payload).resumed === true), 'DESKTOP_STARTED {resumed:true} tras Retomar');
  const { chromium } = require('@playwright/test');
  const pb = await chromium.launch({ channel: 'msedge' });
  const page = await pb.newPage({ viewport: { width: 1300, height: 900 } });
  await page.goto('http://localhost:9090/professor.html');
  await page.locator(`#sessions tr[data-id="${sid}"]`).click();
  await page.waitForFunction(() => document.getElementById('blocked').textContent !== '-');
  await page.waitForFunction(() => document.getElementById('r-ci') && !document.getElementById('r-ci').textContent.startsWith('-'));
  const ci = await page.locator('#r-ci').textContent();
  const rsha = (await page.locator('#r-sha').textContent()).trim();
  const rstatus = await page.locator('#r-status').textContent();
  const blocked = Number(await page.locator('#blocked').textContent());
  const away = await page.locator('#away').textContent();
  const desk = await page.locator('#timeline tr', { hasText: 'DESKTOP_' }).count();
  check(rstatus === 'COMPLETED' && rsha === sha, `panel: estado ${rstatus}, SHA final ${rsha.slice(0, 7)}`);
  check(/completed \/ \w+/.test(ci), 'panel: resultado de CI "' + ci.trim() + '"');
  check(blocked >= 4 && desk >= 1, `panel: ${blocked} accesos bloqueados, ${desk} filas DESKTOP_*, tiempo fuera "${away}"`);
  await page.screenshot({ path: `${EV}/i4-8-professor.png`, fullPage: true });
  await pb.close();

  log('== limpieza: branches session-* del repo de examen');
  const refs = await (await ghapi('git/matching-refs/heads/session-')).json();
  for (const r of refs) await ghapi(`git/${r.ref}`, { method: 'DELETE' });
  check((await (await ghapi('git/matching-refs/heads/session-')).json()).length === 0, `${refs.length} branches session-* borrados`);
  console.log('SESSION=' + sid);
  log('I4 walk OK (session ' + sid + ')');
  process.exit(0);
})().catch((e) => { console.error(e.message); killHard(); process.exit(1); });

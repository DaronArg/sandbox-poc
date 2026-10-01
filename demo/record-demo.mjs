// Graba UN video continuo (Playwright recordVideo) del recorrido completo de la plataforma de evaluacion.
// Nada simulado: el docker run se ejecuta de verdad, la IA responde via el gateway, el push llega a GitHub.
// Uso: node record-demo.mjs   (ver demo/README.md para los requisitos)
import { chromium } from 'playwright';
import http from 'node:http';
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(HERE, 'output');
const BACKEND = 'http://localhost:9090';
const IDE = 'http://localhost:8080';
const EXAM_REPO = process.env.EXAM_REPO || 'DaronArg/assessment-exam-template';
const TERM_PORT = 9191;
const VIEW = { width: 1920, height: 1080 };
const FILE_REL = 'src/main/java/com/example/exam/PriceService.java';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (...a) => console.log(`[${new Date().toISOString().slice(11, 19)}]`, ...a);

// ---------- helpers de sistema ----------
function wsl(cmd) {
  const r = spawnSync('wsl.exe', ['-d', 'Ubuntu', '--', 'bash', '-lc', cmd], { encoding: 'utf8' });
  return { code: r.status, out: (r.stdout || '').trim(), err: (r.stderr || '').trim() };
}
function gh(args) {
  const r = spawnSync('gh', args, { encoding: 'utf8', shell: process.platform === 'win32' });
  return { code: r.status, out: (r.stdout || '').trim(), err: (r.stderr || '').trim() };
}
async function api(p) {
  const r = await fetch(BACKEND + p);
  return r.json();
}
async function waitHttp(url, label, timeoutMs = 240000, okStatus = (s) => s === 200) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    try {
      const r = await fetch(url);
      if (okStatus(r.status)) return;
    } catch { /* aun no */ }
    await sleep(2000);
  }
  throw new Error(`timeout esperando ${label} (${url})`);
}

// ---------- pagina "terminal" local (paso 2) ----------
const term = { cmd: '', started: false, lines: [], done: false };
const TERM_HTML = `<!doctype html><html><head><meta charset="utf-8"><title>WSL Ubuntu</title><style>
html,body{margin:0;height:100%;background:#0c0c0c;color:#d4d4d4;font-family:'Cascadia Mono',Consolas,'DejaVu Sans Mono',monospace}
#bar{background:#1f1f1f;color:#aaa;padding:10px 18px;font-size:18px;border-bottom:1px solid #333}
#t{padding:18px 24px;font-size:20px;line-height:1.35;white-space:pre-wrap;word-break:break-all;height:calc(100% - 80px);overflow:hidden}
.p{color:#4ec9b0}.c{color:#fff}.o{color:#b5cea8}.cur{display:inline-block;width:11px;background:#d4d4d4;animation:b 1s steps(1) infinite}@keyframes b{50%{opacity:0}}
</style></head><body><div id="bar">daron@DESKTOP: ~  (WSL Ubuntu)</div><div id="t"></div><script>
const t=document.getElementById('t');let typed=0,lastCmd='';
async function tick(){
  const s=await (await fetch('/state')).json();
  if(s.cmd!==lastCmd){lastCmd=s.cmd;typed=0}
  if(typed<s.cmd.length)typed=Math.min(s.cmd.length,typed+12);
  let html=s.cmd?'<span class="p">daron@DESKTOP:~$ </span><span class="c">'+esc(s.cmd.slice(0,typed))+'</span>':'';
  if(typed>=s.cmd.length&&s.started){html+='\\n'+s.lines.slice(-40).map(l=>'<span class="o">'+esc(l)+'</span>').join('\\n')}
  if(!s.done)html+='<span class="cur"> </span>';
  t.innerHTML=html;t.scrollTop=t.scrollHeight;
}
const esc=s=>s.replace(/[&<>]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;'}[c]));
setInterval(tick,250);tick();
</script></body></html>`;
function startTermServer() {
  const srv = http.createServer((req, res) => {
    if (req.url === '/state') {
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify(term));
    } else {
      res.setHeader('content-type', 'text/html; charset=utf-8');
      res.end(TERM_HTML);
    }
  });
  return new Promise((r) => srv.listen(TERM_PORT, '127.0.0.1', () => r(srv)));
}

// ---------- preparacion del entorno ----------
async function prepare() {
  log('preflight: backend');
  await waitHttp(`${BACKEND}/api/exams`, 'backend :9090', 30000);
  const sessions = await api('/api/sessions');
  const nextId = sessions.length ? Math.max(...sessions.map((s) => s.id)) + 1 : 1;
  log(`preflight: la proxima sesion sera ${nextId}`);

  log('preflight: borrar branches session-* del repo de examen');
  const br = gh(['api', `repos/${EXAM_REPO}/branches`, '--paginate', '--jq', '.[].name']);
  if (br.code !== 0) throw new Error('gh api branches fallo: ' + br.err);
  for (const name of br.out.split(/\r?\n/).filter((n) => n.startsWith('session-'))) {
    const d = gh(['api', '-X', 'DELETE', `repos/${EXAM_REPO}/git/refs/heads/${name}`]);
    log(`  borrado branch ${name} -> exit ${d.code}`);
  }

  log('preflight: contenedor/volumen de la sesion de demo');
  wsl(`docker rm -f assessment-${nextId} >/dev/null 2>&1; docker volume rm assessment_${nextId}_workspace >/dev/null 2>&1; true`);
  return nextId;
}

// ---------- main ----------
async function main() {
  fs.rmSync(OUT, { recursive: true, force: true });
  fs.mkdirSync(path.join(OUT, 'shots'), { recursive: true });
  fs.mkdirSync(path.join(OUT, 'raw'), { recursive: true });

  const expectedId = await prepare();
  const srv = await startTermServer();

  const browser = await chromium.launch({ headless: true, slowMo: 90 });
  const context = await browser.newContext({
    viewport: VIEW,
    recordVideo: { dir: path.join(OUT, 'raw'), size: VIEW },
    permissions: ['clipboard-read', 'clipboard-write'],
  });
  // Cursor visible + cartel de paso (window.name persiste entre navegaciones, incluso cross-origin).
  await context.addInitScript(() => {
    const boot = () => {
      if (!document.body) return;
      const dot = document.createElement('div');
      dot.style.cssText = 'position:fixed;left:-30px;top:-30px;width:22px;height:22px;margin:-11px 0 0 -11px;border-radius:50%;background:rgba(255,64,64,.55);border:2px solid #fff;box-shadow:0 0 6px #000;z-index:2147483647;pointer-events:none';
      document.body.appendChild(dot);
      addEventListener('mousemove', (e) => { dot.style.left = e.clientX + 'px'; dot.style.top = e.clientY + 'px'; }, true);
      if (window.top !== window) return;
      const cap = document.createElement('div');
      cap.style.cssText = 'position:fixed;top:5px;left:50%;transform:translateX(-50%);z-index:2147483647;background:rgba(15,23,42,.94);color:#fff;font:600 20px/1 system-ui,Segoe UI,sans-serif;padding:9px 20px;border-radius:999px;pointer-events:none;border:2px solid #38bdf8;white-space:nowrap;max-width:1500px;overflow:hidden;text-overflow:ellipsis';
      document.body.appendChild(cap);
      const upd = () => { cap.textContent = window.name || ''; cap.style.display = window.name ? 'block' : 'none'; };
      upd(); setInterval(upd, 150);
    };
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();
  });
  const page = await context.newPage();
  page.on('dialog', (d) => d.accept().catch(() => {}));
  page.setDefaultTimeout(60000);
  const t0 = Date.now();
  const marks = [];

  let sid = null;
  let dockerProc = null;
  const caption = (text) => page.evaluate((t) => { window.name = t; }, text).catch(() => {});
  const mark = async (n, label) => {
    const at = (Date.now() - t0) / 1000;
    marks.push({ step: n, label, startSec: Math.round(at * 10) / 10 });
    log(`=== PASO ${n}: ${label} (t=${at.toFixed(0)}s)`);
    await caption(`Paso ${n}/11 - ${label}`);
  };
  const shot = (name) => page.screenshot({ path: path.join(OUT, 'shots', name + '.png') });
  const pause = (ms) => page.waitForTimeout(ms);

  // --- helpers de la IDE ---
  const palette = async (text) => {
    await page.keyboard.press('F1');
    await pause(700);
    await page.keyboard.type(text, { delay: 25 });
    await pause(900);
    await page.keyboard.press('Enter');
    await pause(900);
  };
  const termCount = () => page.locator('.terminal-wrapper').count();
  const newTerminal = async () => {
    const before = await termCount();
    await page.keyboard.press('Control+Shift+Backquote');
    await pause(2500);
    if ((await termCount()) <= before) {
      await palette('Terminal: Create New Terminal');
      await pause(2000);
    }
  };
  const cmdLog = () => {
    const r = wsl(`docker exec assessment-${sid} cat /tmp/telemetry/commands.log 2>/dev/null`);
    return r.out.split('\n').filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
  };
  const typeInTerminal = async (text) => {
    await page.keyboard.type(text, { delay: 45 });
    await pause(500);
    await page.keyboard.press('Enter');
  };
  // Escribe un comando en la terminal enfocada y espera (via commands.log del contenedor) a que termine.
  const runAndWait = async (text, timeoutMs = 360000) => {
    const baseline = cmdLog().length;
    await typeInTerminal(text);
    const t1 = Date.now();
    while (Date.now() - t1 < timeoutMs) {
      await sleep(3000);
      const l = cmdLog();
      if (l.length > baseline) {
        const hit = l.slice(baseline).find((e) => e.command.includes(text.slice(0, 20)));
        if (hit) return hit.exitCode;
      }
    }
    throw new Error(`timeout esperando fin de: ${text}`);
  };
  const continueFrame = () => page.frameLocator('iframe.webview').first().frameLocator('iframe#active-frame');

  try {
    // =============== PASO 1: pagina de inicio ===============
    await page.goto(BACKEND + '/');
    await page.evaluate(() => { document.documentElement.style.zoom = '1.6'; document.body.style.paddingTop = '60px'; });
    await mark(1, 'Pagina de inicio: elegir alumno y examen');
    await page.waitForSelector('#student option', { state: 'attached' });
    await pause(2500);
    const students = await page.locator('#student option').allTextContents();
    const exams = await page.locator('#exam option').allTextContents();
    log('alumnos:', students, 'examenes:', exams);
    await page.locator('#student').selectOption({ index: 0 });
    await pause(1500);
    await page.locator('#exam').selectOption({ index: 0 });
    await pause(1500);
    await page.locator('#start').click();
    await page.waitForSelector('#result:not([hidden])');
    sid = Number((await page.locator('#sid').textContent()).trim());
    const dockerRun = (await page.locator('#cmd').textContent()).trim();
    if (sid !== expectedId) log(`aviso: sesion ${sid} != esperada ${expectedId}`);
    await caption(`Paso 1/11 - Sesion ${sid} creada: el backend genera el docker run`);
    await pause(7000);
    await shot('step01');

    // =============== PASO 2: ejecutar el docker run (real) ===============
    await page.goto(`http://127.0.0.1:${TERM_PORT}/`);
    await mark(2, 'Se ejecuta el docker run en WSL (salida real)');
    term.cmd = dockerRun;
    await sleep(Math.ceil(dockerRun.length / 12) * 250 + 1500);
    term.started = true;
    dockerProc = spawn('wsl.exe', ['-d', 'Ubuntu', '--', 'bash', '-lc', dockerRun], { stdio: ['ignore', 'pipe', 'pipe'] });
    const feed = (buf) => {
      for (const l of buf.toString('utf8').split(/\r?\n/)) if (l.trim()) term.lines.push(l.replace(/\x1b\[[0-9;]*[A-Za-z]/g, ''));
    };
    dockerProc.stdout.on('data', feed);
    dockerProc.stderr.on('data', feed);
    dockerProc.on('exit', () => { term.done = true; });
    {
      const t1 = Date.now();
      while (!term.lines.some((l) => l.includes('HTTP server listening'))) {
        if (Date.now() - t1 > 300000) throw new Error('el contenedor no levanto code-server');
        if (term.done) throw new Error('docker run termino antes de tiempo:\n' + term.lines.join('\n'));
        await sleep(1000);
      }
    }
    await waitHttp(`${IDE}/healthz`, 'code-server');
    await pause(5000);
    await shot('step02');
    fs.writeFileSync(path.join(OUT, 'docker-run-stdout.txt'), term.lines.join('\n'));

    // =============== PASO 3: la IDE con el repo clonado ===============
    await page.goto(IDE + '/?folder=/workspace');
    await mark(3, 'IDE (localhost:8080): repo clonado y branch de la sesion');
    await page.waitForSelector('.monaco-workbench');
    await page.waitForSelector('.explorer-folders-view .monaco-list-row');
    await pause(4000);
    await palette('Notifications: Toggle Do Not Disturb Mode');
    await palette('View: Toggle Secondary Side Bar Visibility'); // oculta el chat nativo de code-server
    await pause(1000);
    for (let i = 0; i < 8; i++) {
      const row = page.locator('.explorer-folders-view .monaco-list-row[aria-expanded="false"]', { hasText: /^(src|main|java|com|example|exam)/ }).first();
      if (!(await row.count())) break;
      await row.click();
      await pause(700);
    }
    await pause(3500);
    await shot('step03');

    // =============== PASO 4: escribir codigo a mano ===============
    await mark(4, 'Escribir codigo a mano: abrir PriceService.java y editarlo');
    await page.mouse.move(1300, 700);
    await page.keyboard.press('Control+p');
    await pause(900);
    await page.keyboard.type('PriceService.java', { delay: 70 });
    await pause(1200);
    await page.keyboard.press('Enter');
    await page.waitForSelector('.monaco-editor .view-lines');
    await pause(2500);
    await page.keyboard.press('Control+g');
    await pause(600);
    await page.keyboard.type('7', { delay: 100 });
    await page.keyboard.press('Enter');
    await pause(800);
    await page.keyboard.press('Home');
    await page.keyboard.type('    // Nota del alumno: revisar los limites del descuento', { delay: 55 });
    await pause(800);
    await page.keyboard.press('Control+s');
    await pause(3000);
    await shot('step04');

    // =============== PASO 5: terminal, ./mvnw test (falla) ===============
    await mark(5, 'Terminal de la IDE: ./mvnw test (tests fallando)');
    await newTerminal();
    await pause(2500);
    await palette('View: Toggle Maximized Panel');
    await pause(1500);
    await page.locator('.terminal-wrapper').last().click();
    const ec1 = await runAndWait('./mvnw test');
    log('mvnw test #1 exit', ec1);
    if (ec1 === 0) throw new Error('los tests deberian fallar al inicio');
    await pause(4000);
    await shot('step05');
    await palette('View: Toggle Maximized Panel'); // restaura el panel
    await pause(1500);

    // =============== PASO 6: IA - chat ===============
    await mark(6, 'IA (Continue): preguntar sobre el codigo');
    await page.locator('.activitybar .action-label[aria-label*="Continue"]').first().click();
    await page.waitForSelector('iframe.webview');
    await pause(3000);
    // ensanchar la barra lateral para que el chat se lea bien
    await page.mouse.move(350, 400);
    await page.mouse.down();
    await page.mouse.move(760, 400, { steps: 12 });
    await page.mouse.up();
    await pause(1000);
    let f = continueFrame();
    await f.locator('.tiptap').first().waitFor();
    await pause(1500);
    // tarjeta "API Key" de onboarding: se cierra (Enter no envia mientras esta visible)
    await f.locator('button:has(svg path[d="M6 18 18 6M6 6l12 12"])').last().click().catch(() => log('sin tarjeta API Key'));
    await pause(800);
    // modo Chat
    await f.locator('[data-testid=mode-select-button]').click();
    await pause(800);
    await f.getByRole('option', { name: /^Chat/ }).click();
    await pause(800);
    // abrir el archivo en el editor (contexto "active file")
    await page.locator('.monaco-editor .view-lines').first().click();
    await pause(600);
    const doneCount = () => f.locator('[data-testid^=delete-button]').count();
    const waitResponse = async (before, timeoutMs = 120000) => {
      const t1 = Date.now();
      while (Date.now() - t1 < timeoutMs) {
        if ((await doneCount()) > before) return;
        await sleep(1500);
      }
      throw new Error('la IA no termino de responder');
    };
    let before = await doneCount();
    await f.locator('[data-testid=editor-input-main]').click();
    await page.keyboard.type('¿Qué hace este código y por qué fallan los tests?', { delay: 55 });
    await pause(800);
    await page.keyboard.press('Control+Enter'); // enviar con el archivo activo como contexto
    await waitResponse(before);
    await pause(6000);
    await shot('step06');

    // =============== PASO 7: IA edita el codigo ===============
    await mark(7, 'IA (Continue): implementar el metodo faltante y aplicar el cambio');
    before = await doneCount();
    await f.locator('[data-testid=editor-input-main]').click();
    await page.keyboard.type('Implementá el método applyDiscount para que pasen los tests de PriceServiceTest. Devolveme PriceService.java completo en un solo bloque de código, sin omitir nada.', { delay: 50 });
    await pause(800);
    await page.keyboard.press('Control+Enter');
    await waitResponse(before);
    await pause(5000);
    await f.locator('[data-testid=codeblock-toolbar-apply]').last().click();
    await pause(6000);
    await shot('step07a');
    await f.getByText(/^Accept/).last().click({ timeout: 120000 });
    await pause(2500);
    await page.locator('.monaco-editor .view-lines').first().click();
    await page.keyboard.press('Control+s');
    await pause(3500);
    await shot('step07b');
    const fileNow = wsl(`docker exec assessment-${sid} cat /workspace/${FILE_REL}`).out;
    fs.writeFileSync(path.join(OUT, 'PriceService.after-ai.java'), fileNow);
    if (fileNow.includes('not implemented')) throw new Error('el archivo sigue sin implementar tras el apply de la IA');

    // =============== PASO 8: tests pasando ===============
    await mark(8, 'Terminal: ./mvnw test (tests pasando)');
    await palette('View: Toggle Maximized Panel');
    await pause(1000);
    await page.locator('.terminal-wrapper').last().click();
    const ec2 = await runAndWait('./mvnw test');
    log('mvnw test #2 exit', ec2);
    if (ec2 !== 0) throw new Error('los tests siguen fallando tras el cambio de la IA');
    await pause(4000);
    await shot('step08');
    await palette('View: Toggle Maximized Panel');
    await pause(1000);

    // =============== PASO 9: backend + frontend ===============
    await mark(9, 'Levantar backend (:8081) y frontend (:4200) en terminales de la IDE');
    await newTerminal();
    await pause(1500);
    await typeInTerminal('./mvnw spring-boot:run');
    await waitHttp('http://localhost:8081/api/price?price=200&percent=25', 'backend del examen :8081', 300000);
    await pause(2500);
    await shot('step09a');
    await newTerminal();
    await pause(1500);
    await typeInTerminal('cd frontend && npm install && npm run dev');
    await waitHttp('http://localhost:4200/', 'frontend :4200', 300000);
    await pause(5000);
    await shot('step09b');
    // mostrar las dos terminales (backend y frontend) alternando las pestanias
    for (const name of ['java', 'npm']) {
      await page.locator('.terminal-tabs-entry', { hasText: name }).first().click().catch(() => log('sin pestania', name));
      await pause(3500);
      await shot('step09-' + name);
    }
    await page.goto('http://localhost:4200/');
    await page.evaluate(() => { document.documentElement.style.zoom = '1.8'; document.body.style.paddingTop = '50px'; });
    await caption('Paso 9/11 - Frontend en localhost:4200 consumiendo la API del examen (:8081)');
    await pause(5000);
    await page.locator('#calc').click();
    await pause(4000);
    await shot('step09c');
    const frontText = (await page.locator('#out').textContent()).trim();
    log('front muestra:', frontText);
    if (!/150/.test(frontText)) throw new Error('el front no mostro el resultado esperado: ' + frontText);

    // =============== PASO 10: git ===============
    await page.goto(IDE + '/?folder=/workspace');
    await mark(10, 'Git desde la terminal de la IDE: status, add, commit, push');
    await page.waitForSelector('.monaco-workbench');
    await page.waitForSelector('.terminal-wrapper', { timeout: 30000 }).catch(() => log('terminales no restauradas'));
    await pause(6000);
    await newTerminal();
    await pause(1500);
    const ecs = [];
    await palette('View: Toggle Maximized Panel');
    await page.locator('.terminal-wrapper:visible').last().click().catch(() => {});
    ecs.push(await runAndWait('git status'));
    await pause(3500);
    ecs.push(await runAndWait('git add -A'));
    await pause(2000);
    ecs.push(await runAndWait('git commit -m "feat: implementar applyDiscount y agregar frontend"'));
    await pause(3500);
    ecs.push(await runAndWait(`git push -u origin session-${sid}`));
    log('git exits', ecs);
    await pause(5000);
    await shot('step10');
    if (ecs.some((c) => c !== 0)) throw new Error('algun comando git fallo: ' + ecs.join(','));

    // =============== PASO 11: vista del profesor ===============
    // espera a que el agente de telemetria envie el ultimo lote (cada 10 s)
    {
      const t1 = Date.now();
      while (Date.now() - t1 < 90000) {
        const evs = await api(`/api/sessions/${sid}/events`);
        if (evs.some((e) => e.type === 'COMMAND_EXECUTED' && String(e.payload).includes('git push')) && evs.some((e) => e.type === 'GIT_PUSH')) break;
        await sleep(3000);
      }
    }
    await page.goto(BACKEND + '/professor.html');
    await page.evaluate(() => { document.documentElement.style.zoom = '1.35'; document.body.style.paddingTop = '60px'; });
    await mark(11, 'Panel del profesor: timeline de la sesion (donde queda el uso de IA)');
    await pause(3500);
    await page.locator(`#sessions tr[data-id="${sid}"]`).click();
    await pause(3500);
    await shot('step11a');
    const hl = async (type, text) => {
      const row = page.locator('#timeline tbody tr', { hasText: type }).first();
      if (!(await row.count())) { log('sin eventos', type); return; }
      await row.scrollIntoViewIfNeeded();
      await row.evaluate((el) => { el.querySelectorAll('td').forEach((td) => { td.style.background = '#fde68a'; td.style.borderColor = '#f59e0b'; }); el.scrollIntoView({ block: 'center' }); });
      await caption(`Paso 11/11 - ${text}`);
      await pause(4500);
    };
    await hl('FILE_CHANGED', 'Eventos de archivos (FILE_CHANGED)');
    await hl('COMMAND_EXECUTED', 'Comandos ejecutados en la terminal');
    await hl('AI_PROMPT', 'Prompt enviado a la IA (AI_PROMPT)');
    await shot('step11b');
    await hl('AI_RESPONSE', 'Respuesta de la IA (AI_RESPONSE)');
    await shot('step11c');
    await hl('GIT_PUSH', 'El push del alumno (GIT_PUSH)');
    await shot('step11d');
    await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'smooth' }));
    await caption('Paso 11/11 - Timeline completa de la sesion');
    await pause(5000);

    fs.writeFileSync(path.join(OUT, 'events.json'), JSON.stringify(await api(`/api/sessions/${sid}/events`), null, 2));
  } finally {
    const durSec = (Date.now() - t0) / 1000;
    fs.writeFileSync(path.join(OUT, 'steps.json'), JSON.stringify({ sessionId: sid, durationSec: Math.round(durSec), marks }, null, 2));
    const video = page.video();
    await context.close().catch(() => {});
    await browser.close().catch(() => {});
    if (video) {
      const src = await video.path();
      fs.copyFileSync(src, path.join(OUT, 'demo.webm'));
      log('video:', path.join(OUT, 'demo.webm'));
      fs.rmSync(path.join(OUT, 'raw'), { recursive: true, force: true });
    }
    if (sid != null && !process.env.KEEP_CONTAINER) {
      log('limpieza: parar contenedor de la sesion', sid);
      wsl(`docker rm -f assessment-${sid} >/dev/null 2>&1; true`);
    }
    try { dockerProc?.kill(); } catch { /* ya terminado */ }
    srv.close();
  }
}

main().then(() => { log('OK'); process.exit(0); }).catch((e) => { console.error('FALLO:', e); process.exit(1); });

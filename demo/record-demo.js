// Graba UN video del recorrido completo sobre la app Electron real (credenciales reales, nada simulado).
//
// Captura SOLO la ventana de la app: BrowserWindow.capturePage() via el inspector del main (--inspect), que compone el
// shell y las vistas hijas (IDE / App) en un frame. gdigrab por titulo de ventana salia negro (GPU de Electron), y nunca
// se graba el escritorio. El panel del profesor y el "navegador externo" se graban con Playwright recordVideo (solo
// el contenido de la pagina).
//
// Cada paso graba su propio segmento (output/seg/stepNN.mp4) y se puede retomar desde cualquiera:
//   node demo/record-demo.js                 # todo, desde el paso 1 (arranca la app de cero)
//   node demo/record-demo.js --from 6        # retoma en el paso 6 con la app y el contenedor vivos
//   node demo/record-demo.js --only 7        # regraba solo el paso 7
//   node demo/record-demo.js --assemble      # solo une los segmentos -> output/demo.mp4 + output/steps.json
// Las esperas largas (pull, mvn, npm, push, CI) se aceleran en el video (rec.fast); todas son esperas por condicion.
const { spawn, execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { createRequire } = require('module');

const ROOT = path.resolve(__dirname, '..');
const OUT = path.join(__dirname, 'output');
const SEG = path.join(OUT, 'seg');
const FRAMES = path.join(OUT, 'frames');
const STATE_FILE = path.join(OUT, 'state.json');
const desktopRequire = createRequire(path.join(ROOT, 'desktop', 'package.json'));
const exe = desktopRequire('electron');
const { chromium } = desktopRequire('@playwright/test');
const sharp = require('sharp');
const { sleep, findTarget, attach } = require(path.join(ROOT, 'desktop', 'e2e', 'cdp-lib.js'));

const PORT = 9333; // CDP de las vistas
const INSPECT = 9229; // inspector del main (captura de ventana)
const BACKEND = 'http://localhost:9090';
const W = 1600, H = 900, CAPTURE_FPS = 6;
const CTRL = 2, SHIFT = 8;
const LAST_STEP = 13;

fs.mkdirSync(SEG, { recursive: true });
fs.mkdirSync(FRAMES, { recursive: true });

// ---------- utilidades ----------
const log = (...a) => console.log(new Date().toTimeString().slice(0, 8), ...a);
const wsl = (...cmd) => execFileSync('wsl.exe', ['-d', 'Ubuntu', '--exec', ...cmd], { encoding: 'utf8' });
const curl = (...a) => execFileSync('curl.exe', ['-s', ...a], { encoding: 'utf8' });
const events = async (id) => (await fetch(`${BACKEND}/api/sessions/${id}/events`)).json();
const env = Object.fromEntries(fs.readFileSync(path.join(ROOT, '.env'), 'utf8').split(/\r?\n/).map((l) => l.match(/^([A-Z_]+)=(.*)$/)).filter(Boolean).map((m) => [m[1], m[2]]));
const ghapi = (p, o = {}) => fetch(`https://api.github.com/repos/${env.GITHUB_REPO}/${p}`, { ...o, headers: { Authorization: `Bearer ${env.GITHUB_TOKEN}`, Accept: 'application/vnd.github+json' } });
const check = (cond, msg) => { if (!cond) throw new Error('FALLO: ' + msg); log('  ok ', msg); };

function findFfmpeg() {
  if (process.env.FFMPEG) return process.env.FFMPEG;
  try { execFileSync('ffmpeg', ['-version'], { stdio: 'ignore' }); return 'ffmpeg'; } catch { /* sigue */ }
  const base = path.join(process.env.LOCALAPPDATA || '', 'Microsoft', 'WinGet', 'Packages');
  for (const d of fs.existsSync(base) ? fs.readdirSync(base) : []) {
    if (!d.startsWith('Gyan.FFmpeg')) continue;
    for (const v of fs.readdirSync(path.join(base, d))) {
      const f = path.join(base, d, v, 'bin', 'ffmpeg.exe');
      if (fs.existsSync(f)) return f;
    }
  }
  throw new Error('ffmpeg no encontrado (winget install Gyan.FFmpeg)');
}
const FFMPEG = findFfmpeg();
const FFPROBE = FFMPEG === 'ffmpeg' ? 'ffprobe' : FFMPEG.replace(/ffmpeg(\.exe)?$/, 'ffprobe$1');
const probeDuration = (f) => parseFloat(execFileSync(FFPROBE, ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', f], { encoding: 'utf8' }));

const loadState = () => (fs.existsSync(STATE_FILE) ? JSON.parse(fs.readFileSync(STATE_FILE, 'utf8')) : {});
const saveState = (s) => fs.writeFileSync(STATE_FILE, JSON.stringify(s, null, 2));
let state = {};

// ---------- app + inspector del main ----------
let child = null;
function launchApp() {
  state.userdata = fs.mkdtempSync(path.join(os.tmpdir(), 'assessment-demo-'));
  state.dialogs = path.join(state.userdata, 'dialogs.log');
  saveState(state);
  child = spawn(exe, ['.', `--remote-debugging-port=${PORT}`, `--inspect=${INSPECT}`], {
    cwd: path.join(ROOT, 'desktop'), stdio: 'ignore', detached: true,
    env: { ...process.env, ASSESSMENT_USER_DATA: state.userdata, ASSESSMENT_TEST_DIALOG_LOG: state.dialogs, ASSESSMENT_TEST_DIALOG_ANSWER: '0' },
  });
  child.unref();
}
const killApp = () => { try { execFileSync('taskkill', ['/IM', 'electron.exe', '/T', '/F'], { stdio: 'ignore' }); } catch { /* no habia */ } child = null; };

let main = null; // cliente del inspector
async function connectMain() {
  let t = null;
  for (let i = 0; i < 60 && !t; i++) { try { t = (await (await fetch(`http://127.0.0.1:${INSPECT}/json`)).json())[0]; } catch { await sleep(1000); } }
  if (!t) throw new Error('no hay inspector del main en :' + INSPECT);
  const ws = new WebSocket(t.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  let id = 0; const pending = new Map();
  ws.onmessage = (m) => { const j = JSON.parse(m.data); if (pending.has(j.id)) { pending.get(j.id)(j); pending.delete(j.id); } };
  main = (expr) => new Promise((res, rej) => {
    const i = ++id; pending.set(i, (j) => (j.result?.exceptionDetails ? rej(new Error(j.result.exceptionDetails.exception?.description || 'main eval')) : res(j.result?.result?.value)));
    ws.send(JSON.stringify({ id: i, method: 'Runtime.evaluate', params: { expression: expr, returnByValue: true, awaitPromise: true } }));
  });
  await ensureWindow();
  await sleep(1500);
}
// la ventana tiene que estar restaurada y con tamano fijo (minimizada, el contenido mide 0 y las vistas se crean 0x0)
const ensureWindow = () => main(`(()=>{const {BrowserWindow}=process.mainModule.require('electron');const w=BrowserWindow.getAllWindows()[0];if(w.isMinimized())w.restore();if(w.isMaximized())w.unmaximize();w.setContentSize(${W},${H});w.center();global.__w=w;return true})()`);
// ventana (shell) + cada vista hija visible (IDE / App), compuestas: capturePage() de la ventana no incluye las WebContentsView
const GRAB_JS = `(async()=>{const w=global.__w;const o={base:(await w.capturePage()).toJPEG(80).toString('base64'),views:[]};
for(const v of w.contentView.children){if(v.getVisible&&!v.getVisible())continue;const b=v.getBounds();if(b.width<=0||b.height<=0)continue;
o.views.push({b,img:(await v.webContents.capturePage()).toJPEG(80).toString('base64')});}return JSON.stringify(o)})()`;
async function grab() {
  const o = JSON.parse(await main(GRAB_JS));
  const layers = [];
  for (const v of o.views) {
    if (v.b.x >= W || v.b.y >= H) continue;
    layers.push({ input: await sharp(Buffer.from(v.img, 'base64')).resize(Math.min(v.b.width, W - v.b.x), Math.min(v.b.height, H - v.b.y), { fit: 'fill' }).toBuffer(), left: v.b.x, top: v.b.y });
  }
  return sharp(Buffer.from(o.base, 'base64')).resize(W, H, { fit: 'fill' }).composite(layers).jpeg({ quality: 85 }).toBuffer();
}

// ---------- grabacion por paso ----------
// rec.fast() devuelve end(factor): lo ocurrido entre fast() y end() se acelera `factor` veces en el video final.
function startAppRec(step) {
  const file = path.join(SEG, `step${String(step).padStart(2, '0')}.mp4`);
  const ff = spawn(FFMPEG, ['-y', '-v', 'error', '-use_wallclock_as_timestamps', '1', '-f', 'image2pipe', '-c:v', 'mjpeg', '-i', '-',
    '-vf', `fps=${CAPTURE_FPS},scale=${W}:${H}`, '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '23', '-pix_fmt', 'yuv420p', file],
  { stdio: ['pipe', 'inherit', 'inherit'] });
  ff.stdin.on('error', () => {});
  const t0 = Date.now();
  let on = true;
  const loop = (async () => {
    while (on) {
      const s = Date.now();
      try { ff.stdin.write(await grab()); } catch { /* ventana cerrada o frame perdido */ }
      await sleep(Math.max(0, 1000 / CAPTURE_FPS - (Date.now() - s)));
    }
  })();
  const fast = [];
  return {
    fast() { const a = (Date.now() - t0) / 1000; return (factor) => fast.push({ a, b: (Date.now() - t0) / 1000, f: factor }); },
    async stop() {
      on = false; await loop; ff.stdin.end();
      await new Promise((r) => ff.on('close', r));
      writeSeg(step, file, fast);
    },
    async discard() { on = false; await loop; ff.stdin.end(); await new Promise((r) => ff.on('close', r)); },
  };
}
function writeSeg(step, file, fast) {
  const meta = { step, file: path.basename(file), durationSec: probeDuration(file), fast };
  fs.writeFileSync(file.replace(/\.mp4$/, '.json'), JSON.stringify(meta));
  log(`  segmento paso ${step}: ${meta.durationSec.toFixed(1)}s (${fast.length} tramos acelerados)`);
}

// Pagina de un navegador externo (Edge): solo el contenido de la pagina, con un cartel con la URL actual.
async function browserStep(step, fn) {
  const dir = path.join(OUT, `pw${step}`);
  fs.rmSync(dir, { recursive: true, force: true });
  const browser = await chromium.launch({ channel: 'msedge' });
  const ctx = await browser.newContext({ viewport: { width: W, height: H }, recordVideo: { dir, size: { width: W, height: H } } });
  await ctx.addInitScript(() => {
    const bar = () => {
      if (document.getElementById('__urlbar') || !document.documentElement) return;
      const d = document.createElement('div');
      d.id = '__urlbar';
      d.style.cssText = 'position:fixed;top:0;left:0;right:0;height:38px;z-index:2147483647;background:#202124;color:#e8eaed;font:15px Segoe UI,sans-serif;display:flex;align-items:center;padding:0 16px;gap:12px';
      d.textContent = 'Navegador externo (Edge)  |  ' + location.href;
      document.documentElement.appendChild(d);
      document.documentElement.style.marginTop = '38px';
    };
    document.addEventListener('DOMContentLoaded', bar);
    bar();
  });
  const page = await ctx.newPage();
  const t0 = Date.now();
  const fast = [];
  const rec = { fast() { const a = (Date.now() - t0) / 1000; return (f) => fast.push({ a, b: (Date.now() - t0) / 1000, f }); } };
  try { await fn(page, rec); } finally { await ctx.close(); await browser.close(); }
  const webm = path.join(dir, fs.readdirSync(dir).find((f) => f.endsWith('.webm')));
  const file = path.join(SEG, `step${String(step).padStart(2, '0')}.mp4`);
  execFileSync(FFMPEG, ['-y', '-v', 'error', '-i', webm, '-vf', `fps=${CAPTURE_FPS},scale=${W}:${H}`, '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '23', '-pix_fmt', 'yuv420p', file]);
  writeSeg(step, file, fast);
}

// ---------- vistas de la app ----------
const shell = async () => attach(await findTarget(PORT, (x) => x.url.startsWith('assessment:'), 60000));
const ideView = async () => {
  const ide = await attach(await findTarget(PORT, (x) => x.url.includes('ide.localhost'), 60000));
  // los toasts de la IDE (Red Hat, portapapeles, Java) no aportan al video
  await ide.eval(`(()=>{if(!document.getElementById('__notoast')){const st=document.createElement('style');st.id='__notoast';st.textContent='.notifications-toasts{display:none!important}';document.head.appendChild(st)}return true})()`);
  return ide;
};
const clickId = (sh, id) => sh.eval(`document.getElementById('${id}').click(); true`);
const waitVisible = (sh, id, ms = 240000) => sh.waitFor(`!document.getElementById('${id}').hidden`, ms);
const typeSlow = async (cdp, text, ms = 35) => { for (const ch of text) { await cdp.type(ch); await sleep(ms); } };
const termType = async (ide, text) => { await typeSlow(ide, text); await sleep(300); await ide.enter(); };
const focusTerm = (ide) => ide.eval(`(document.querySelector('.terminal-wrapper.active .xterm-helper-textarea')||document.querySelector('.xterm-helper-textarea')).focus(); true`);
const newTerminal = async (ide) => { await ide.send('Page.bringToFront'); await ide.key('`', { code: 'Backquote', vk: 192, modifiers: CTRL | SHIFT }); await sleep(3500); await focusTerm(ide); };
// abre un archivo navegando el arbol del Explorer con clicks reales (expande las carpetas del camino)
async function openByTree(ide, folders, file) {
  await ide.key('e', { code: 'KeyE', vk: 69, modifiers: CTRL | SHIFT }); // muestra el Explorer (no alterna)
  await sleep(1200);
  for (let i = 0; i < 14; i++) {
    const pos = await ide.eval(`(()=>{const rows=[...document.querySelectorAll('.explorer-folders-view .monaco-list-row')];
      const lab=(r)=>(r.querySelector('.label-name')||r).innerText.trim();
      let r=rows.find((x)=>lab(x)===${JSON.stringify(file)});
      if(!r){const want=${JSON.stringify(folders)};r=rows.find((x)=>x.getAttribute('aria-expanded')==='false'&&lab(x).split('/').every((p)=>want.includes(p)));}
      if(!r)return null;const b=r.getBoundingClientRect();return {x:b.x+Math.min(120,b.width/2),y:b.y+b.height/2,file:lab(r)===${JSON.stringify(file)}}})()`);
    if (!pos) { await sleep(800); continue; }
    await ide.click(pos.x, pos.y);
    await sleep(900);
    if (pos.file) return;
  }
  throw new Error('no se pudo abrir ' + file + ' por el arbol');
}
const clearToasts = (ide) => ide.eval(`(()=>{for(const b of document.querySelectorAll('.notification-toast .monaco-button'))if(b.innerText==='Deny')b.click();for(const c of document.querySelectorAll('.notification-toast .codicon-close, .notification-toast .codicon-notifications-clear'))c.click();return true})()`);
async function palette(ide, cmd) {
  await ide.key('p', { code: 'KeyP', vk: 80, modifiers: CTRL | SHIFT });
  await sleep(1200);
  await typeSlow(ide, '>' + cmd, 30);
  await sleep(1200);
  await ide.enter();
  await sleep(800);
}
const ctrl = (ide, key, code, vk) => ide.key(key, { code, vk, modifiers: CTRL });

async function cmdCount(sid, cmd) {
  return (await events(sid)).filter((e) => e.type === 'COMMAND_EXECUTED' && JSON.parse(e.payload).command === cmd).length;
}
// corre un comando en la terminal de la IDE y espera (por condicion) su COMMAND_EXECUTED; devuelve el exitCode
async function runCmd(ide, sid, cmd, timeoutMs = 300000) {
  const before = await cmdCount(sid, cmd);
  await focusTerm(ide);
  await termType(ide, cmd);
  const end = Date.now() + timeoutMs;
  while (Date.now() < end) {
    const hits = (await events(sid)).filter((e) => e.type === 'COMMAND_EXECUTED' && JSON.parse(e.payload).command === cmd);
    if (hits.length > before) return JSON.parse(hits[hits.length - 1].payload).exitCode;
    await sleep(2000);
  }
  throw new Error('timeout esperando COMMAND_EXECUTED: ' + cmd);
}
const waitHttp = async (url, expect, ms) => {
  const end = Date.now() + ms;
  while (Date.now() < end) { const b = curl('-w', '|%{http_code}', url); if (b.endsWith('|200') && (!expect || b.includes(expect))) return b; await sleep(3000); }
  throw new Error('timeout esperando ' + url);
};
const exec = (...cmd) => wsl('docker', 'exec', '-u', 'coder', state.container, ...cmd);
const FILE = '/workspace/src/main/java/com/example/exam/PriceService.java';

// ---------- pasos ----------
const steps = {
  // 1. Inicio: elegir alumno y examen
  async 1() {
    killApp();
    wsl('bash', '-c', 'docker ps -aq | xargs -r docker rm -f >/dev/null; true');
    state = {}; launchApp(); await connectMain();
    const sh = await shell();
    await waitVisible(sh, 'form', 60000);
    const rec = startAppRec(1);
    try {
      await sleep(4000);
      const pick = async (id, idx) => { await sh.eval(`(()=>{const s=document.getElementById('${id}');s.selectedIndex=${idx};s.dispatchEvent(new Event('change',{bubbles:true}));return s.options[s.selectedIndex].text})()`); await sleep(2500); };
      const alumnos = await sh.eval(`document.getElementById('student').options.length`);
      await pick('student', Math.min(1, alumnos - 1));
      await pick('student', 0);
      await pick('exam', 0);
      await sleep(2000);
      await clickId(sh, 'begin');
      await sleep(1500);
      await rec.stop();
    } catch (e) { await rec.discard(); throw e; }
    sh.close();
  },

  // 2. Progreso: verificacion/descarga de la imagen y arranque del contenedor
  async 2() {
    const sh = await shell();
    const rec = startAppRec(2);
    try {
      await sleep(7000); // se ve la lista de pasos (pull, arranque, telemetria...)
      const ff = rec.fast();
      await waitVisible(sh, 'bar', 360000);
      ff(6);
      state.container = wsl('docker', 'ps', '--format', '{{.Names}}').trim();
      state.sid = Number(state.container.split('-')[1]);
      saveState(state);
      const ide = await ideView();
      const ff2 = rec.fast();
      await ide.waitFor(`!!document.querySelector('.monaco-workbench') && document.body.innerText.includes('pom.xml')`, 180000);
      ff2(4);
      ide.close();
      await rec.stop();
    } catch (e) { await rec.discard(); throw e; }
    sh.close();
  },

  // 3. IDE con el repo clonado en la rama de la sesion
  async 3() {
    const ide = await ideView();
    await ide.send('Page.bringToFront');
    await clearToasts(ide);
    await ide.key('b', { code: 'KeyB', vk: 66, modifiers: 3 }); // cierra el chat de VS Code de la derecha (el de la demo es Continue)
    await sleep(1500);
    await clearToasts(ide);
    const rec = startAppRec(3);
    try {
      state.branch = wsl('docker', 'exec', '-u', 'coder', state.container, 'git', '-C', '/workspace', 'rev-parse', '--abbrev-ref', 'HEAD').trim();
      check(/^session-\d+-[0-9a-f]{6}$/.test(state.branch), 'rama de sesion ' + state.branch);
      saveState(state);
      await sleep(11000);
      await rec.stop();
    } catch (e) { await rec.discard(); throw e; }
    ide.close();
  },

  // 4. Editar a mano
  async 4() {
    const ide = await ideView();
    for (let i = 0; i < 8 && (await clickLens(ide, 'Reject')); i++) await sleep(1000); // diffs pendientes de Continue, si los hay
    exec('git', '-C', '/workspace', 'checkout', '--', 'src'); // idempotente: vuelve el archivo al estado del repo
    await ide.click(1300, 250);
    await palette(ide, 'File: Revert File'); // y el buffer del editor al contenido de disco (si no, queda sucio de corridas anteriores)
    await sleep(2000);
    const rec = startAppRec(4);
    try {
      await ide.send('Page.bringToFront');
      await openByTree(ide, ['src', 'main', 'java', 'com', 'example', 'exam'], 'PriceService.java');
      await ide.waitFor(`!!document.querySelector('.monaco-editor .view-lines') && !!document.querySelector('.tab[aria-label*="PriceService.java"], .tab .label-name')`, 30000);
      await sleep(2500);
      // el cursor va a la linea de applyDiscount y se escribe un comentario a mano
      const line = Number(exec('bash', '-c', `grep -n 'public double applyDiscount' ${FILE} | head -1 | cut -d: -f1`).trim());
      await ctrl(ide, 'g', 'KeyG', 71);
      await sleep(800);
      await typeSlow(ide, String(line - 1), 120); // la linea del cierre del javadoc; el comentario va en una linea nueva debajo
      await ide.enter();
      await sleep(800);
      await ide.key('End', { code: 'End', vk: 35 });
      await ide.enter();
      await typeSlow(ide, '// TODO: aplicar el descuento sobre el precio', 55);
      await sleep(1200);
      await ctrl(ide, 's', 'KeyS', 83);
      const end = Date.now() + 30000;
      let saved = false;
      while (Date.now() < end && !saved) { saved = exec('bash', '-c', `grep -c 'TODO: aplicar el descuento' ${FILE} || true`).trim() >= 1; await sleep(1000); }
      check(saved, 'el comentario escrito a mano quedo en el archivo');
      await sleep(2500);
      await rec.stop();
    } catch (e) { await rec.discard(); throw e; }
    ide.close();
  },

  // 5. ./mvnw test falla
  async 5() {
    const ide = await ideView();
    const rec = startAppRec(5);
    try {
      await ide.send('Page.bringToFront');
      await ctrl(ide, '`', 'Backquote', 192);
      await ide.waitFor(`!!document.querySelector('.xterm')`, 30000);
      await sleep(3000);
      const ff = rec.fast();
      let code;
      const p = runCmd(ide, state.sid, './mvnw test');
      // los primeros segundos se ven a velocidad normal; el resto de la espera, acelerado
      await sleep(8000);
      code = await p;
      ff(8);
      check(code !== 0, './mvnw test FALLA (exit ' + code + ')');
      await sleep(5000);
      await rec.stop();
    } catch (e) { await rec.discard(); throw e; }
    ide.close();
  },

  // 6. Continue: pregunta sobre el codigo
  async 6() { await continueStep(6, 'Qué hace este código y por qué fallan los tests?', false); },
  // 7. Continue: implementa applyDiscount y se aplica
  async 7() { await continueStep(7, 'Implementá el método applyDiscount de PriceService para que pasen los tests de PriceServiceTest. Aplicá el cambio directamente en el archivo.', true); },

  // 8. ./mvnw test pasa
  async 8() {
    const ide = await ideView();
    const rec = startAppRec(8);
    try {
      await ide.send('Page.bringToFront');
      await sleep(1500);
      await ide.key('e', { code: 'KeyE', vk: 69, modifiers: CTRL | SHIFT }); // muestra el Explorer (no alterna)
      await ctrl(ide, '`', 'Backquote', 192);
      await sleep(1500);
      const ff = rec.fast();
      const p = runCmd(ide, state.sid, './mvnw test');
      await sleep(8000);
      const code = await p;
      ff(8);
      check(code === 0, './mvnw test PASA');
      await sleep(5000);
      await rec.stop();
    } catch (e) { await rec.discard(); throw e; }
    ide.close();
  },

  // 9. spring-boot:run, npm start y la pestana App
  async 9() {
    wsl('docker', 'exec', state.container, 'bash', '-c', "pkill -f '[s]pring-boot'; pkill -f '[n]g serve'; true"); // idempotente: reintento con servidores previos
    await sleep(3000);
    const ide = await ideView();
    const sh = await shell();
    const rec = startAppRec(9);
    try {
      await ide.send('Page.bringToFront');
      await focusTerm(ide);
      await termType(ide, 'cd /workspace && ./mvnw spring-boot:run');
      const ff = rec.fast();
      await sleep(6000);
      const body = await waitHttp('http://localhost:8081/api/price?price=200&percent=25', '150', 240000);
      ff(6);
      check(true, 'backend Spring Boot responde en :8081 ' + body);
      await sleep(3000);
      await newTerminal(ide);
      await termType(ide, 'cd frontend && npm install --no-audit --no-fund && npm start');
      const ff2 = rec.fast();
      await sleep(6000);
      const appT = await findTarget(PORT, (x) => x.url.includes('app.localhost'), 360000);
      ff2(8);
      check(!!appT, 'aparecio la vista App');
      await sleep(3000);
      await clickId(sh, 'tab-app');
      await sleep(2500);
      const app = await attach(appT);
      await app.waitFor(`document.getElementById('out') && document.getElementById('out').innerText.includes('Precio final: $150')`, 90000);
      app.close();
      await sleep(7000);
      await rec.stop();
    } catch (e) { await rec.discard(); throw e; }
    ide.close(); sh.close();
  },

  // 10. Navegador externo -> bloqueado
  async 10() {
    state.gatePort = wsl('docker', 'port', state.container, '7000/tcp').trim().split('\n')[0].split(':').pop();
    saveState(state);
    await browserStep(10, async (page, rec) => {
      const show = async (url, expected) => {
        await page.goto(url);
        await page.waitForFunction((t) => document.body && document.body.innerText.includes(t), expected, { timeout: 30000 });
        await sleep(6000);
      };
      await sleep(1500);
      await show(`http://ide.localhost:${state.gatePort}/`, 'Acceso denegado');
      await show(`http://localhost:${state.gatePort}/`, 'Acceso denegado');
      await show('http://localhost:8081/api/price?price=200&percent=25', 'Solo Postman/curl');
    });
    let denied = 0;
    for (let i = 0; i < 20 && denied < 2; i++) { await sleep(3000); denied = (await events(state.sid)).filter((e) => e.type === 'GATE_ACCESS_DENIED').length; }
    check(denied >= 2, 'GATE_ACCESS_DENIED en la timeline: ' + denied);
  },

  // 11. git push desde la terminal de la IDE
  async 11() {
    const ide = await ideView();
    const sh = await shell();
    const rec = startAppRec(11);
    try {
      await clickId(sh, 'tab-ide');
      await sleep(2500);
      await ide.send('Page.bringToFront');
      // el alumno detiene los servidores antes de entregar y vuelve a la primera terminal
      wsl('docker', 'exec', state.container, 'bash', '-c', "pkill -f '[s]pring-boot'; pkill -f '[n]g serve'; true");
      await sleep(5000);
      await ide.eval(`document.querySelector('.tabs-list .monaco-list-row').click(); true`);
      await sleep(1500);
      await focusTerm(ide);
      await sleep(500);
      for (const c of ['cd /workspace', 'git status -s', 'git add -A', 'git commit -m "feat: implement applyDiscount"']) {
        if (c === 'cd /workspace') { await termType(ide, c); await sleep(1200); continue; }
        const code = await runCmd(ide, state.sid, c, 60000);
        check(code === 0, c + ' ok');
        await sleep(1500);
      }
      const before = (await events(state.sid)).filter((e) => e.type === 'GIT_PUSH').length;
      await focusTerm(ide);
      await termType(ide, 'git push -u origin HEAD');
      const ff = rec.fast();
      await sleep(8000);
      let pushed = false;
      for (let i = 0; i < 100 && !pushed; i++) { pushed = (await events(state.sid)).filter((e) => e.type === 'GIT_PUSH').length > before; if (!pushed) await sleep(3000); }
      ff(8);
      check(pushed, 'GIT_PUSH registrado');
      await sleep(5000);
      await rec.stop();
    } catch (e) { await rec.discard(); throw e; }
    ide.close(); sh.close();
  },

  // 12. Entregar
  async 12() {
    const sh = await shell();
    const rec = startAppRec(12);
    try {
      state.localHead = exec('git', '-C', '/workspace', 'rev-parse', 'HEAD').trim();
      await sleep(2500);
      await clickId(sh, 'submit');
      await sh.waitFor(`!document.getElementById('submitted').hidden`, 240000);
      await sleep(8000);
      const sha = await sh.eval(`document.getElementById('sha').innerText`);
      check(sha === state.localHead, 'Entrega registrada con el SHA del ultimo push ' + sha.slice(0, 7));
      state.sha = sha; saveState(state);
      await rec.stop();
    } catch (e) { await rec.discard(); throw e; }
    await clickId(sh, 'submitted-quit').catch(() => {});
    sh.close();
    await sleep(4000);
    killApp();
    // el CI corre sobre el SHA final: se espera ANTES de mostrar el panel del profesor
    let result = {};
    for (let i = 0; i < 90; i++) { result = await (await fetch(`${BACKEND}/api/sessions/${state.sid}/result`)).json(); if (result.ciStatus === 'completed') break; await sleep(5000); }
    check(result.ciStatus === 'completed', `CI termino: ${result.ciStatus} / ${result.ciConclusion}`);
  },

  // 13. Panel del profesor
  async 13() {
    await browserStep(13, async (page) => {
      await page.goto(`${BACKEND}/professor.html`);
      await sleep(4000);
      await page.locator(`#sessions tr[data-id="${state.sid}"]`).click();
      await page.waitForFunction(() => document.getElementById('blocked').textContent !== '-');
      await page.waitForFunction(() => document.getElementById('r-ci') && !document.getElementById('r-ci').textContent.startsWith('-'));
      await sleep(9000); // estado, SHA final, CI
      // timeline: se recorren las filas que importan (eventos de la app, comandos, IA, bloqueos, push, entrega)
      for (const type of ['DESKTOP_STARTED', 'COMMAND_EXECUTED', 'AI_PROMPT', 'AI_RESPONSE', 'GATE_ACCESS_DENIED', 'DESKTOP_TAB_CHANGED', 'GIT_PUSH', 'SUBMISSION_COMPLETED', 'DESKTOP_CLOSED']) {
        const shown = await page.evaluate((t) => {
          const tr = [...document.querySelectorAll('#timeline tr')].find((r) => r.innerText.includes(t));
          if (!tr) return false;
          tr.scrollIntoView({ behavior: 'smooth', block: 'center' }); tr.style.outline = '3px solid #3b82f6';
          return true;
        }, type);
        if (shown) await sleep(4500);
      }
      await sleep(2000);
    });
  },
};

// Continue: el webview no es target propio (solo coordenadas). Se envia con Enter, se espera por condicion: AI_RESPONSE nuevo y estable en la API.
async function drag(ide, x1, y, x2) {
  await ide.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: x1, y });
  await ide.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: x1, y, button: 'left', clickCount: 1 });
  for (let i = 1; i <= 12; i++) { await ide.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: x1 + ((x2 - x1) * i) / 12, y, button: 'left', buttons: 1 }); await sleep(40); }
  await ide.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: x2, y, button: 'left', clickCount: 1 });
}
const aiResponses = async (sid) => (await events(sid)).filter((e) => e.type === 'AI_RESPONSE').length;
async function continueStep(step, prompt, apply) {
  const ide = await ideView();
  const rec = startAppRec(step);
  try {
    await ide.send('Page.bringToFront');
    {
      const sidebar = () => ide.eval(`(()=>{const p=document.querySelector('.part.sidebar');if(!p||p.offsetWidth===0)return null;const r=p.getBoundingClientRect();return {right:r.right,title:(p.querySelector('.title-label')||{innerText:''}).innerText}})()`);
      let sb = await sidebar();
      if (!sb || !/continue/i.test(sb.title)) { await ide.eval(`(document.querySelector('.activitybar .action-label[aria-label*="Continue"]')||{click(){}}).click();true`); await sleep(3500); sb = await sidebar(); }
      if (sb.right < 700) { await drag(ide, sb.right, 400, 760); await sleep(1000); sb = await sidebar(); } // sidebar mas ancha para que el chat se lea
      await ide.click(sb.right - 70, 52); // nuevo chat
      await sleep(1500);
    }
    const before = await aiResponses(state.sid);
    await ide.click(...COORDS.input);
    await sleep(1000);
    await typeSlow(ide, prompt, 45);
    await sleep(800);
    await ide.key('Enter', { code: 'Enter', vk: 13, modifiers: CTRL }); // Ctrl+Enter: envia con el archivo activo como contexto
    const ff = rec.fast();
    if (apply) {
      // la IA edita el archivo con su herramienta: el diff aparece en el editor con Accept/Reject (CodeLens)
      const hasDiff = () => ide.eval(`[...document.querySelectorAll('.codelens-decoration a')].some((x)=>x.innerText.trim()==='Accept')`);
      const end = Date.now() + 300000;
      let tries = 0;
      while (!(await hasDiff())) {
        if (Date.now() > end) throw new Error('la IA no dejo un diff para aceptar');
        await sleep(6000);
        if (await hasDiff()) break;
        // herramientas que pide el agente (leer archivos, correr un comando): se aprueban con Ctrl+Enter con el foco en el input de Continue
        if (++tries >= 3) { await ide.click(...COORDS.followUp); await ide.key('Enter', { code: 'Enter', vk: 13, modifiers: CTRL }); }
      }
      await sleep(3000);
    } else {
      let n = before, stable = 0, last = before;
      for (let i = 0; i < 45 && !(n > before && stable >= 5); i++) {
        await sleep(4000);
        n = await aiResponses(state.sid);
        stable = n === last ? stable + 1 : 0; last = n;
      }
      check(n > before, 'AI_RESPONSE registrado');
    }
    ff(4);
    await sleep(4000);
    if (apply) await acceptAndSave(ide);
    await sleep(3000);
    await rec.stop();
  } catch (e) { await rec.discard(); throw e; }
  ide.close();
}
const COORDS = { input: [200, 124], followUp: [300, 751] }; // chat nuevo: input arriba; con historial: input de seguimiento abajo
const COORDS_UNUSED = { input: [200, 124] }; // se recalcula tras ensanchar: ver continueStep
// CodeLens de Continue en el editor (Accept | Reject por hunk): click real sobre el link
async function clickLens(ide, label) {
  const pos = await ide.eval(`(()=>{const a=[...document.querySelectorAll('.codelens-decoration a')].find((x)=>x.innerText.trim()===${JSON.stringify(label)});if(!a)return null;const r=a.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}})()`);
  if (!pos) return false;
  await ide.click(pos.x, pos.y);
  return true;
}
async function acceptAndSave(ide) {
  for (let i = 0; i < 8 && (await clickLens(ide, 'Accept')); i++) await sleep(2000); // un click por hunk
  await sleep(1500);
  await ide.click(1300, 250); // foco en el editor para guardar
  await ctrl(ide, 's', 'KeyS', 83);
  const end = Date.now() + 30000;
  let done = false;
  while (Date.now() < end && !done) { done = exec('bash', '-c', `grep -c 'not implemented' ${FILE} || true`).trim() === '0'; await sleep(1000); }
  check(done, 'el cambio de la IA quedo aplicado y guardado en el archivo');
}

// ---------- ensamblado ----------
function assemble() {
  const metas = [];
  for (let n = 1; n <= LAST_STEP; n++) {
    const f = path.join(SEG, `step${String(n).padStart(2, '0')}.json`);
    if (fs.existsSync(f)) metas.push(JSON.parse(fs.readFileSync(f, 'utf8')));
  }
  const parts = [];
  const marks = [];
  let t = 0;
  for (const m of metas) {
    const src = path.join(SEG, m.file);
    const out = path.join(SEG, m.file.replace('.mp4', '.p.mp4'));
    const cuts = []; let cur = 0;
    for (const { a, b, f } of m.fast.sort((x, y) => x.a - y.a)) { if (a > cur) cuts.push([cur, a, 1]); cuts.push([a, b, f]); cur = b; }
    cuts.push([cur, m.durationSec + 1, 1]);
    const filt = cuts.map(([a, b, f], i) => `[0:v]trim=start=${a.toFixed(3)}:end=${b.toFixed(3)},setpts=(PTS-STARTPTS)/${f}[v${i}]`).join(';')
      + ';' + cuts.map((_, i) => `[v${i}]`).join('') + `concat=n=${cuts.length}:v=1:a=0,fps=25[v]`;
    execFileSync(FFMPEG, ['-y', '-v', 'error', '-i', src, '-filter_complex', filt, '-map', '[v]', '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '22', '-pix_fmt', 'yuv420p', out]);
    const d = probeDuration(out);
    marks.push({ step: m.step, label: LABELS[m.step], startSec: Math.round(t * 10) / 10 });
    t += d;
    parts.push(out);
  }
  const list = path.join(SEG, 'list.txt');
  fs.writeFileSync(list, parts.map((p) => `file '${p.replace(/\\/g, '/')}'`).join('\n'));
  execFileSync(FFMPEG, ['-y', '-v', 'error', '-f', 'concat', '-safe', '0', '-i', list, '-c', 'copy', '-movflags', '+faststart', path.join(OUT, 'demo.mp4')]);
  const total = probeDuration(path.join(OUT, 'demo.mp4'));
  fs.writeFileSync(path.join(OUT, 'steps.json'), JSON.stringify({ durationSec: Math.round(total * 10) / 10, marks }, null, 2));
  log(`demo.mp4 ${total.toFixed(0)}s, ${marks.length} pasos`);
  // un frame al inicio, medio y final de cada paso, para revisarlos
  for (let i = 0; i < marks.length; i++) {
    const a = marks[i].startSec, b = i + 1 < marks.length ? marks[i + 1].startSec : total;
    [0.15, 0.5, 0.9].forEach((p, k) => execFileSync(FFMPEG, ['-y', '-v', 'error', '-ss', String(a + (b - a) * p), '-i', path.join(OUT, 'demo.mp4'), '-frames:v', '1', '-vf', 'scale=800:-1', path.join(FRAMES, `step${String(marks[i].step).padStart(2, '0')}-${k}.jpg`)]));
  }
}
const LABELS = {
  1: 'Inicio: elegir alumno y examen', 2: 'Progreso: pull y arranque del contenedor', 3: 'IDE con el repo clonado',
  4: 'Edicion a mano', 5: './mvnw test falla', 6: 'Continue: pregunta', 7: 'Continue: implementa applyDiscount y se aplica',
  8: './mvnw test pasa', 9: 'spring-boot:run, npm start y pestana App', 10: 'Navegador externo bloqueado',
  11: 'git push desde la terminal', 12: 'Entregar', 13: 'Panel del profesor',
};

// ---------- main ----------
(async () => {
  const arg = (k) => { const i = process.argv.indexOf(k); return i > 0 ? Number(process.argv[i + 1]) : null; };
  if (process.argv.includes('--assemble')) { assemble(); return; }
  const only = arg('--only');
  const from = only || arg('--from') || 1;
  const to = only || arg('--to') || LAST_STEP;
  state = loadState();
  if (from > 1) {
    if (!state.sid) throw new Error('no hay estado previo (output/state.json): corre desde el paso 1');
    if (from <= 12) await connectMain();
  }
  for (let n = from; n <= to; n++) {
    log(`== paso ${n}: ${LABELS[n]}`);
    if (main && n <= 12 && n !== 1) await ensureWindow().catch(() => {});
    if (n >= 4 && n <= 9 && from > 1) { const sh = await shell(); await clickId(sh, 'tab-ide'); sh.close(); await sleep(1000); } // los pasos de IDE parten de la pestana IDE
    try { await steps[n](); } catch (e) {
      console.error(e.stack || e.message);
      if (main) try { fs.writeFileSync(path.join(OUT, `fail-${n}.jpg`), await grab()); } catch { /* sin ventana */ }
      console.error(`\nFallo el paso ${n}. La app y el contenedor siguen vivos: reintenta con  node demo/record-demo.js --from ${n}`);
      process.exit(1);
    }
    saveState(state);
  }
  assemble();
  if (to >= LAST_STEP) {
    killApp();
    wsl('bash', '-c', 'docker ps -aq | xargs -r docker rm -f >/dev/null; true');
    const refs = await (await ghapi('git/matching-refs/heads/session-')).json();
    for (const r of refs) await ghapi(`git/${r.ref}`, { method: 'DELETE' });
    log(`limpieza: ${refs.length} branches session-* borrados, contenedores y app cerrados`);
  }
  process.exit(0);
})().catch((e) => { console.error(e.stack || e.message); process.exit(1); });

function steps_need_app(n) { return ![10, 13].includes(n) || true; }

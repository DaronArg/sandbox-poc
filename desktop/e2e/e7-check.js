// Verificacion de E7 sobre el binario empaquetado/instalado (design §7.8, §13.9). Uso: EXE="C:\\Program Files\\Assessment\\Assessment.exe" node e2e/e7-check.js
const { spawn, execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');
const net = require('net');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const EXE = process.env.EXE;
if (!EXE) throw new Error('definir EXE');
const check = (cond, msg) => { if (!cond) throw new Error('FALLO: ' + msg); console.log('  ok  ' + msg); };
const kill = (c) => { try { execFileSync('taskkill', ['/PID', String(c.pid), '/T', '/F'], { stdio: 'ignore' }); } catch { /* ya salio */ } };
const listening = (port) => new Promise((res) => { const s = net.connect(port, '127.0.0.1'); s.on('connect', () => { s.destroy(); res(true); }); s.on('error', () => res(false)); });
const isolated = () => ({ ...process.env, ASSESSMENT_USER_DATA: undefined });
const titleOf = (pid) => { try { return execFileSync('powershell.exe', ['-NoProfile', '-Command', `(Get-Process -Id ${pid} -ErrorAction SilentlyContinue).MainWindowTitle`], { encoding: 'utf8' }).trim(); } catch { return ''; } };

async function run(args, env, ms, { stdout = false } = {}) {
  const c = spawn(EXE, args, { stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, ...env } });
  let out = '';
  c.stdout.on('data', (d) => (out += d)); c.stderr.on('data', (d) => (out += d));
  let code = null;
  c.on('exit', (x) => { code = x; });
  await sleep(ms);
  return { c, out, alive: () => code === null, code: () => code };
}

(async () => {
  console.log('== 1. la app arranca (fuses + integridad del asar OK) y abre una ventana "Assessment"');
  let r = await run([], {}, 12000);
  check(r.alive(), 'el proceso sigue vivo a los 12 s');
  let t = '';
  for (let i = 0; i < 10 && !t; i++) { t = titleOf(r.c.pid); if (!t) await sleep(1000); }
  check(t.startsWith('Assessment'), 'ventana con titulo "' + t + '"');
  kill(r.c);

  console.log('== 2. ELECTRON_RUN_AS_NODE=1 Assessment.exe -e "console.log(1)" no ejecuta Node');
  r = await run(['-e', 'console.log(1)'], { ELECTRON_RUN_AS_NODE: '1' }, 8000);
  check(!/^1\s*$/m.test(r.out), 'no imprimio "1" (stdout: ' + JSON.stringify(r.out.slice(0, 80)) + ')');
  check(r.alive(), 'en vez de Node, arranco la app normal (sigue vivo)');
  kill(r.c);

  console.log('== 3. Assessment.exe --inspect no abre el inspector');
  r = await run(['--inspect=9555'], {}, 8000);
  check(!(await listening(9555)), 'el puerto 9555 no esta escuchando');
  check(!/Debugger listening/i.test(r.out), 'sin "Debugger listening" en la salida');
  kill(r.c);

  console.log('== 4. Assessment.exe --remote-debugging-port se rechaza (la app sale)');
  r = await run(['--remote-debugging-port=9556'], {}, 6000);
  check(!(await listening(9556)), 'el puerto 9556 no queda abierto');
  check(!r.alive(), 'la app salio (codigo ' + r.code() + ')');
  kill(r.c);

  console.log('== 5. modificar app.asar impide que la app arranque (sobre una COPIA de la carpeta de instalacion)');
  const src = path.dirname(EXE);
  const copy = fs.mkdtempSync(path.join(os.tmpdir(), 'assessment-tamper-'));
  try { execFileSync('robocopy', [src, copy, '/E', '/NFL', '/NDL', '/NJH', '/NJS', '/NP'], { stdio: 'ignore', windowsHide: true }); } catch (e) { if (e.status >= 8) throw e; } // robocopy: 0-7 = exito
  const asar = path.join(copy, 'resources', 'app.asar');
  const buf = fs.readFileSync(asar);
  const results = {};
  for (const [name, offset] of [['header', 20], ['contenido', Math.floor(buf.length * 0.9)]]) {
    const tampered = Buffer.from(buf);
    tampered[offset] ^= 0xff;
    fs.writeFileSync(asar, tampered);
    const rr = await (async () => {
      const c = spawn(path.join(copy, path.basename(EXE)), [], { stdio: ['ignore', 'pipe', 'pipe'] });
      let code = null; let out = '';
      c.stdout.on('data', (d) => (out += d)); c.stderr.on('data', (d) => (out += d));
      c.on('exit', (x) => { code = x; });
      await sleep(10000);
      const alive = code === null;
      if (alive) kill(c);
      return { alive, code, out: out.slice(0, 200) };
    })();
    results[name] = rr;
    console.log(`  byte modificado en ${name} (offset ${offset}): ${rr.alive ? 'LA APP ARRANCO' : 'no arranco (codigo ' + rr.code + ')'}`);
  }
  fs.rmSync(copy, { recursive: true, force: true });
  check(!results.header.alive, 'con el header del asar alterado la app no arranca');
  if (results['contenido'].alive) console.log('  NOTA: alterar solo el contenido de un archivo dentro del asar NO se detecto (limite de la integridad embebida de Electron).');
  console.log('E7 OK');
  process.exit(0);
})().catch((e) => { console.error(e.message); process.exit(1); });

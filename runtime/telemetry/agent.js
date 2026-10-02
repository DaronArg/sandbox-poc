// Agente de telemetria: archivos (chokidar) + comandos (/tmp/telemetry/commands.log) + intentos bloqueados
// (/var/log/gate/denied.log) -> POST batch cada 10 s. SIGTERM => flush inmediato (timeout 4 s) y exit 0.
const fs = require('fs');
const chokidar = require('chokidar');

const { SESSION_ID, SESSION_TOKEN, BACKEND_URL } = process.env;
const FLUSH_MS = 10000;
const CMD_LOG = '/tmp/telemetry/commands.log';
const DENIED_LOG = '/var/log/gate/denied.log';

// al retomar una sesion, la secuencia sigue donde quedo (NEXT_SEQUENCE viene del connect)
let sequence = (Number(process.env.NEXT_SEQUENCE) || 1) - 1;
let queue = [];

function emit(type, payload) {
  queue.push({ sequence: ++sequence, type, timestamp: new Date().toISOString(), payload });
}

// --- archivos
chokidar
  .watch('/workspace', {
    ignored: (p) => p.split('/').some((seg) => ['.git', 'target', 'node_modules'].includes(seg)),
    ignoreInitial: true,
    persistent: true,
  })
  .on('add', (p) => emit('FILE_CREATED', { path: p }))
  .on('change', (p) => emit('FILE_CHANGED', { path: p }))
  .on('unlink', (p) => emit('FILE_DELETED', { path: p }));

// --- sigue un log de lineas JSON por offset y emite un evento por linea
function tail(file, startAtEnd, onLine) {
  let offset = 0;
  let partial = '';
  if (startAtEnd) {
    fs.mkdirSync(require('path').dirname(file), { recursive: true });
    fs.closeSync(fs.openSync(file, 'a'));
    offset = fs.statSync(file).size;
  }
  setInterval(() => {
    let size;
    try { size = fs.statSync(file).size; } catch (e) { return; } // todavia no existe
    if (size <= offset) return;
    const fd = fs.openSync(file, 'r');
    const buf = Buffer.alloc(size - offset);
    fs.readSync(fd, buf, 0, buf.length, offset);
    fs.closeSync(fd);
    offset = size;
    const lines = (partial + buf.toString('utf8')).split('\n');
    partial = lines.pop();
    for (const line of lines) {
      if (!line.trim()) continue;
      try { onLine(JSON.parse(line)); } catch (e) { console.error('[telemetry] linea invalida:', line); }
    }
  }, 1000);
}

tail(CMD_LOG, true, (o) => emit('COMMAND_EXECUTED', o));
// el contenedor es nuevo en cada sesion: todo lo que haya en denied.log es de esta corrida (se lee desde el inicio)
tail(DENIED_LOG, false, (o) => emit('GATE_ACCESS_DENIED', o));

// --- envio
async function flush() {
  if (!queue.length) return;
  const batch = queue;
  queue = [];
  try {
    const res = await fetch(`${BACKEND_URL}/api/telemetry/batch`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${SESSION_TOKEN}` },
      body: JSON.stringify({ sessionId: Number(SESSION_ID), events: batch }),
      signal: AbortSignal.timeout(4000),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
  } catch (e) {
    console.error('[telemetry] flush fallo, reintento en el proximo ciclo:', e.message);
    queue = batch.concat(queue);
  }
}
setInterval(flush, FLUSH_MS);

// El comando submit manda SIGUSR1: flush inmediato y marca /tmp/telemetry/flushed (cuenta tambien los comandos ya logueados)
process.on('SIGUSR1', async () => {
  try { await flush(); } finally { fs.writeFileSync('/tmp/telemetry/flushed', String(Date.now())); }
});

process.on('SIGTERM', async () => {
  const hard = setTimeout(() => process.exit(0), 4000);
  await flush();
  clearTimeout(hard);
  process.exit(0);
});

console.log(`[telemetry] agent started for session ${SESSION_ID}, sequence desde ${sequence + 1}`);

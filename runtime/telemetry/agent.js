// Agente de telemetria: archivos (chokidar) + comandos (/tmp/telemetry/commands.log) -> POST batch cada 10 s.
const fs = require('fs');
const chokidar = require('chokidar');

const { SESSION_ID, SESSION_TOKEN, BACKEND_URL } = process.env;
const FLUSH_MS = 10000;
const CMD_LOG = '/tmp/telemetry/commands.log';

let sequence = 0;
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

// --- comandos: sigue el log por offset (el hook agrega una linea JSON por comando)
fs.mkdirSync('/tmp/telemetry', { recursive: true });
fs.closeSync(fs.openSync(CMD_LOG, 'a'));
let offset = fs.statSync(CMD_LOG).size;
let partial = '';
setInterval(() => {
  const size = fs.statSync(CMD_LOG).size;
  if (size <= offset) return;
  const fd = fs.openSync(CMD_LOG, 'r');
  const buf = Buffer.alloc(size - offset);
  fs.readSync(fd, buf, 0, buf.length, offset);
  fs.closeSync(fd);
  offset = size;
  const lines = (partial + buf.toString('utf8')).split('\n');
  partial = lines.pop();
  for (const line of lines) {
    if (!line.trim()) continue;
    try { emit('COMMAND_EXECUTED', JSON.parse(line)); } catch (e) { console.error('[telemetry] linea invalida:', line); }
  }
}, 1000);

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
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
  } catch (e) {
    console.error('[telemetry] flush fallo, reintento en el proximo ciclo:', e.message);
    queue = batch.concat(queue);
  }
}
setInterval(flush, FLUSH_MS);
console.log(`[telemetry] agent started for session ${SESSION_ID}`);

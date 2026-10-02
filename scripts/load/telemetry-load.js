// Carga de ingesta de telemetria: N sesiones simuladas mandan 1 batch cada INTERVAL s a POST /api/telemetry/batch.
// Uso: node telemetry-load.js <backend> <interval_s> <batch_events> <stages>   (stages = "500:300,1000:60,2000:60": sesiones:segundos)
// Crea las sesiones por la API (usar una base de prueba, no la real) y emite una linea JSON por etapa.
const [, , BACKEND = 'http://localhost:9191', INTERVAL_S = '10', BATCH = '5', STAGES = '500:60'] = process.argv;
const interval = Number(INTERVAL_S) * 1000;
const batchSize = Number(BATCH);
const stages = STAGES.split(',').map((s) => s.split(':').map(Number));
const maxSessions = Math.max(...stages.map((s) => s[0]));

const TYPES = [
  ['FILE_CHANGED', () => ({ path: '/workspace/src/main/java/com/example/exam/PriceService.java' })],
  ['FILE_CREATED', () => ({ path: '/workspace/frontend/src/app/app.component.ts' })],
  ['COMMAND_EXECUTED', () => ({ command: './mvnw test', exitCode: 1, cwd: '/workspace', durationMs: 8123 })],
];

function makeBatch(seqStart) {
  const events = [];
  for (let i = 0; i < batchSize; i++) {
    const [type, payload] = TYPES[(seqStart + i) % TYPES.length];
    events.push({ sequence: seqStart + i + 1, type, timestamp: new Date().toISOString(), payload: payload() });
  }
  return events;
}

const pct = (sorted, p) => (sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))] : null);

async function createSessions(n) {
  const out = [];
  for (let i = 0; i < n; i++) {
    const r = await fetch(`${BACKEND}/api/sessions`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Desktop-Version': '0.1.0' }, body: JSON.stringify({ studentId: 1, examId: 1 }),
    });
    const j = await r.json();
    out.push({ id: j.sessionId, token: j.token, seq: 0 });
  }
  return out;
}

async function runStage(sessions, n, seconds) {
  const lat = [];
  const errors = {};
  let sent = 0, ok = 0, bytes = 0, lagMax = 0;
  const startEpoch = Date.now() / 1000;
  const end = Date.now() + seconds * 1000;
  const inflight = new Set();
  let lastTick = Date.now();
  const lagTimer = setInterval(() => { const now = Date.now(); lagMax = Math.max(lagMax, now - lastTick - 100); lastTick = now; }, 100);

  async function fire(s) {
    const body = JSON.stringify({ sessionId: s.id, events: makeBatch(s.seq) });
    s.seq += batchSize;
    bytes += Buffer.byteLength(body);
    sent++;
    const t0 = process.hrtime.bigint();
    try {
      const res = await fetch(`${BACKEND}/api/telemetry/batch`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${s.token}` }, body,
      });
      await res.arrayBuffer();
      if (res.ok) { ok++; lat.push(Number(process.hrtime.bigint() - t0) / 1e6); }
      else errors[`HTTP ${res.status}`] = (errors[`HTTP ${res.status}`] || 0) + 1;
    } catch (e) {
      const k = e.cause?.code || e.message;
      errors[k] = (errors[k] || 0) + 1;
    }
  }

  // cada sesion arranca con un offset aleatorio dentro del intervalo y sigue con periodo fijo (sin deriva)
  await new Promise((resolve) => {
    for (let i = 0; i < n; i++) {
      const s = sessions[i];
      let next = Date.now() + Math.random() * interval;
      const tick = () => {
        if (next >= end) return;
        const p = fire(s);
        inflight.add(p); p.finally(() => inflight.delete(p));
        next += interval;
        setTimeout(tick, Math.max(0, next - Date.now()));
      };
      setTimeout(tick, Math.max(0, next - Date.now()));
    }
    setTimeout(resolve, seconds * 1000 + 200);
  });
  await Promise.all([...inflight]);
  clearInterval(lagTimer);
  lat.sort((a, b) => a - b);
  const r = (x) => (x == null ? null : Math.round(x * 100) / 100);
  return {
    sessions: n, seconds, sent, ok, errors, reqPerSecActual: r(ok / seconds), reqPerSecTarget: r(n / (interval / 1000)),
    p50ms: r(pct(lat, 50)), p95ms: r(pct(lat, 95)), p99ms: r(pct(lat, 99)), maxMs: r(lat[lat.length - 1]),
    avgBodyBytes: Math.round(bytes / Math.max(1, sent)), generatorLagMaxMs: lagMax, startEpoch, endEpoch: Date.now() / 1000,
  };
}

(async () => {
  console.error(`creando ${maxSessions} sesiones en ${BACKEND}...`);
  const sessions = await createSessions(maxSessions);
  console.error('sesiones listas');
  for (const [n, secs] of stages) {
    const r = await runStage(sessions, n, secs);
    console.log(JSON.stringify(r));
  }
})();

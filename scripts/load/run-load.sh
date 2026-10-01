#!/usr/bin/env bash
# Carga de telemetria contra una instancia de PRUEBA del backend (:9191, base H2 en /tmp/loaddb); la base real no se toca.
# Uso (dentro de WSL): ./scripts/load/run-load.sh <tag> <stages> [cpus_backend] [interval_s] [batch_events]
#   ej: ./scripts/load/run-load.sh full-cpu 500:300,1000:60,2000:60,4000:60 0-7
# El generador de carga corre en un contenedor de la imagen del runtime (node 22) con --network host y cpuset 8-15.
set -euo pipefail
TAG=${1:?tag}; STAGES=${2:?stages}; CPUS=${3:-0-7}; INTERVAL=${4:-10}; BATCH=${5:-5}
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
PORT=9191; DB=/tmp/loaddb; OUT=/tmp/load-$TAG
IMAGE=${RUNTIME_IMAGE:-assessment-runtime:poc}
rm -rf "$DB" "$OUT"; mkdir -p "$OUT"

echo "== backend de prueba en :$PORT (cpus $CPUS, base $DB)"
cd "$ROOT/backend"
SERVER_PORT=$PORT SPRING_DATASOURCE_URL="jdbc:h2:file:$DB/assessment;DB_CLOSE_DELAY=-1" \
  setsid nohup taskset -c "$CPUS" ./mvnw -q -Dspring-boot.run.optimizedLaunch=false spring-boot:run > "$OUT/backend.log" 2>&1 &
MVN=$!
for i in $(seq 1 90); do
  curl -fsS -o /dev/null "http://localhost:$PORT/api/exams" 2>/dev/null && break
  sleep 1
done
curl -fsS -o /dev/null "http://localhost:$PORT/api/exams" || { tail -20 "$OUT/backend.log"; echo "FAIL: backend de prueba no arranco"; exit 1; }
PID=$(ss -ltnp "sport = :$PORT" | grep -o 'pid=[0-9]*' | head -1 | cut -d= -f2)
echo "pid app=$PID  jvm: $(tr '\0' ' ' < /proc/$PID/cmdline | cut -c1-120)"
sleep 20 # que se estabilice el arranque (JIT, GC)
echo "idle_rss_mb=$(awk '/VmRSS/{printf "%.0f",$2/1024}' /proc/$PID/status)" | tee "$OUT/idle.txt"

cleanup() {
  kill "$SAMPLER" 2>/dev/null || true
  kill "$PID" 2>/dev/null || true
  kill "$MVN" 2>/dev/null || true; sleep 3
  rm -rf "$DB"
}
./../scripts/load/sample-proc.sh "$PID" 2 "$OUT/samples.txt" & SAMPLER=$!
trap cleanup EXIT

echo "== carga: stages=$STAGES interval=${INTERVAL}s batch=$BATCH"
docker run --rm --network host --cpuset-cpus 8-15 -v "$ROOT/scripts/load:/load:ro" --entrypoint node "$IMAGE" \
  /load/telemetry-load.js "http://localhost:$PORT" "$INTERVAL" "$BATCH" "$STAGES" | tee "$OUT/stages.jsonl"

echo "== resumen por etapa (CPU 100% = 1 core)"
jq -r '[.sessions,.reqPerSecActual,.p50ms,.p95ms,.p99ms,.maxMs,(.errors|tostring),.startEpoch,.endEpoch]|@tsv' "$OUT/stages.jsonl" | while IFS=$'\t' read -r s rps p50 p95 p99 mx err st en; do
  awk -v st="$st" -v en="$en" -v s="$s" -v rps="$rps" -v p50="$p50" -v p95="$p95" -v p99="$p99" -v mx="$mx" -v err="$err" \
    '$1>=st && $1<=en {n++; c+=$2; if($2>cm)cm=$2; if($3>rm)rm=$3} END{printf "sessions=%s rps=%s p50=%s p95=%s p99=%s max=%s errors=%s cpu_avg=%.0f cpu_max=%.0f rss_max_mb=%.0f\n", s,rps,p50,p95,p99,mx,err,(n?c/n:0),cm,rm}' "$OUT/samples.txt"
done | tee "$OUT/summary.txt"
echo "db_bytes=$(du -sb $DB | cut -f1)" | tee -a "$OUT/summary.txt"
echo "session1_events=$(curl -fsS http://localhost:$PORT/api/sessions/1/events | jq length)" | tee -a "$OUT/summary.txt"

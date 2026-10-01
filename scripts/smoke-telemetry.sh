#!/usr/bin/env bash
# Smoke T5: crear/modificar archivo + comando en bash interactivo -> eventos en la API en < 30 s.
# Requiere backend en :9090 (reiniciado con TelemetryController) y la imagen assessment-runtime:poc. Correr dentro de WSL.
set -euo pipefail
B="${BACKEND:-http://localhost:9090}"
fail() { echo "FAIL: $*"; exit 1; }

echo "== crear sesion"
R=$(curl -fsS -X POST "$B/api/sessions" -H 'Content-Type: application/json' -d '{"studentId":1,"examId":1}')
ID=$(echo "$R" | jq -r .sessionId)
CMD=$(echo "$R" | jq -r .dockerRun)
NAME="assessment-$ID"
echo "sessionId=$ID"

docker ps -aq -f name=assessment- | xargs -r docker rm -f >/dev/null 2>&1 || true
docker volume rm "assessment_${ID}_workspace" >/dev/null 2>&1 || true
eval "${CMD/docker run --rm/docker run -d --rm}" >/dev/null
cleanup() { docker rm -f "$NAME" >/dev/null 2>&1 || true; docker volume rm "assessment_${ID}_workspace" >/dev/null 2>&1 || true; }
trap cleanup EXIT

echo "== esperar code-server"
for i in $(seq 1 60); do
  curl -fsS -o /dev/null http://localhost:8080/healthz 2>/dev/null && break
  docker ps -q -f "name=$NAME" | grep -q . || { docker logs "$NAME" 2>&1 | tail -20; fail "el contenedor murio"; }
  sleep 2
done
sleep 3 # que el watcher termine el scan inicial

echo "== crear y modificar archivo + comando en bash interactivo"
docker exec "$NAME" bash -c 'echo uno > /workspace/telemetry-test.txt'
sleep 2
docker exec "$NAME" bash -c 'echo dos >> /workspace/telemetry-test.txt'
docker exec -i "$NAME" bash -i <<'SH' >/dev/null 2>&1 || true
echo hola-telemetria
false
exit
SH
:

echo "== esperar eventos (max 30 s)"
OK=0
for i in $(seq 1 15); do
  EV=$(curl -fsS "$B/api/sessions/$ID/events")
  if echo "$EV" | jq -e '
      (map(select(.type=="FILE_CREATED" and (.payload|contains("telemetry-test.txt")))) | length > 0) and
      (map(select(.type=="FILE_CHANGED" and (.payload|contains("telemetry-test.txt")))) | length > 0) and
      (map(select(.type=="COMMAND_EXECUTED" and (.payload|fromjson|.command=="echo hola-telemetria" and .exitCode==0))) | length > 0) and
      (map(select(.type=="COMMAND_EXECUTED" and (.payload|fromjson|.command=="false" and .exitCode==1))) | length > 0)' >/dev/null; then
    OK=1; break
  fi
  sleep 2
done
echo "$EV" | jq -r '.[] | "\(.sequence)\t\(.type)\t\(.payload)"'
[ "$OK" = 1 ] || fail "no llegaron todos los eventos en 30 s"

echo "== professor.html y config"
curl -fsS "$B/professor.html" | grep -q "Timeline" || fail "professor.html"
curl -fsS "$B/api/professor-config" | jq -e '.repo' >/dev/null || fail "professor-config"
echo "SESSION_ID=$ID (professor.html: $B/professor.html)"
echo "OK smoke-telemetry"

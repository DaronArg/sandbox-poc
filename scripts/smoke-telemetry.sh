#!/usr/bin/env bash
# Smoke telemetria: crear/modificar archivo + comando en bash interactivo -> eventos en la API en < 30 s.
# Requiere backend en :9090 y la imagen assessment-runtime:poc. Correr dentro de WSL.
set -euo pipefail
source "$(dirname "$0")/lib-session.sh"

echo "== crear sesion y levantar contenedor"
start_session 1
wait_ide
sleep 3 # que el watcher termine el scan inicial

echo "== crear y modificar archivo + comando en bash interactivo"
docker exec -u coder "$NAME" bash -c 'echo uno > /workspace/telemetry-test.txt'
sleep 2
docker exec -u coder "$NAME" bash -c 'echo dos >> /workspace/telemetry-test.txt'
docker exec -u coder -i "$NAME" bash -i <<'SH' >/dev/null 2>&1 || true
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
[ "$OK" = 1 ] || sfail "no llegaron todos los eventos en 30 s"

echo "== el agente arranca en NEXT_SEQUENCE: ninguna secuencia del agente repite la de SESSION_STARTED"
echo "$EV" | jq -e '[.[] | select(.type=="SESSION_STARTED")][0].sequence as $s | [.[] | select(.type|test("^(FILE_|COMMAND_)"))] | all(.sequence > $s)' >/dev/null || sfail "sequence del agente <= SESSION_STARTED"

echo "== flush en SIGTERM: evento reciente llega sin esperar el ciclo de 10 s"
docker exec -u coder "$NAME" bash -c 'echo sigterm > /workspace/sigterm-test.txt'
sleep 2
docker exec -u root "$NAME" pkill -TERM -f telemetry/agent.js
sleep 3
curl -fsS "$B/api/sessions/$ID/events" | jq -e 'any(.[]; .type=="FILE_CREATED" and (.payload|contains("sigterm-test.txt")))' >/dev/null || sfail "no hubo flush al recibir SIGTERM"
docker exec "$NAME" pgrep -f telemetry/agent.js >/dev/null && sfail "el agente sigue vivo tras SIGTERM"
echo "  ok  agente termino con exit 0 tras flush"

echo "== professor.html y config"
curl -fsS "$B/professor.html" | grep -q "Timeline" || sfail "professor.html"
curl -fsS "$B/api/professor-config" | jq -e '.repo' >/dev/null || sfail "professor-config"
echo "SESSION_ID=$ID (professor.html: $B/professor.html)"
echo "OK smoke-telemetry"

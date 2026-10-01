#!/usr/bin/env bash
# Smoke del backend base. Requiere el backend corriendo en :9090 (scripts/run-backend.sh).
set -euo pipefail
B="${BACKEND:-http://localhost:9090}"
fail() { echo "FAIL: $*"; exit 1; }

echo "== exams / students"
curl -fsS "$B/api/exams" | jq -e 'length >= 1' >/dev/null || fail "exams"
curl -fsS "$B/api/students" | jq -e 'length >= 2' >/dev/null || fail "students"

echo "== crear sesion"
R=$(curl -fsS -X POST "$B/api/sessions" -H 'Content-Type: application/json' -d '{"studentId":1,"examId":1}')
ID=$(echo "$R" | jq -r .sessionId)
TOKEN=$(echo "$R" | jq -r .dockerRun | sed -E 's/.*SESSION_TOKEN=([^ ]+).*/\1/')
echo "$R" | jq -e '.dockerRun | startswith("docker run")' >/dev/null || fail "dockerRun"
echo "sessionId=$ID"

echo "== connect con token valido (200)"
CODE=$(curl -s -o /tmp/connect.json -w '%{http_code}' -X POST "$B/api/sessions/$ID/connect" -H "Authorization: Bearer $TOKEN")
[ "$CODE" = 200 ] || fail "connect valido dio $CODE"
jq -e '(.branch | test("^session-'"$ID"'-[0-9a-f]{6}$")) and .studentName != null' /tmp/connect.json >/dev/null || fail "connect body"
cat /tmp/connect.json; echo

echo "== connect con token malo (401)"
CODE=$(curl -s -o /dev/null -w '%{http_code}' -X POST "$B/api/sessions/$ID/connect" -H "Authorization: Bearer nope")
[ "$CODE" = 401 ] || fail "connect malo dio $CODE"

echo "== sesion inexistente (401)"
CODE=$(curl -s -o /dev/null -w '%{http_code}' -X POST "$B/api/sessions/99999/connect" -H "Authorization: Bearer $TOKEN")
[ "$CODE" = 401 ] || fail "sesion inexistente dio $CODE"

echo "== events contiene SESSION_STARTED"
EV=$(curl -fsS "$B/api/sessions/$ID/events")
echo "$EV"
echo "$EV" | jq -e 'map(.type) | index("SESSION_STARTED")' >/dev/null || fail "SESSION_STARTED"

echo "== pagina /"
curl -fsS "$B/" | grep -q "Iniciar" || fail "index.html"

echo "OK smoke-backend"

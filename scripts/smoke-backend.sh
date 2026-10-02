#!/usr/bin/env bash
# Smoke del backend (contrato desktop). Requiere el backend en :9090 (scripts/run-backend.sh o restart-backend.sh).
# Reinicia el backend en el paso de persistencia: dentro de WSL, con acceso a scripts/restart-backend.sh.
set -euo pipefail
B="${BACKEND:-http://localhost:9090}"
V="${DESKTOP_VERSION:-0.1.0}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
fail() { echo "FAIL: $*"; exit 1; }
post() { curl -s -w '\n%{http_code}' -X POST "$@"; }

echo "== exams / students"
curl -fsS "$B/api/exams" | jq -e 'length >= 1' >/dev/null || fail "exams"
curl -fsS "$B/api/students" | jq -e 'length >= 2' >/dev/null || fail "students"

echo "== crear sesion sin X-Desktop-Version (426)"
OUT=$(post "$B/api/sessions" -H 'Content-Type: application/json' -d '{"studentId":1,"examId":1}')
[ "$(echo "$OUT" | tail -1)" = 426 ] || fail "sin header no dio 426"
echo "$OUT" | head -1 | jq -e '.minVersion != null' >/dev/null || fail "426 sin minVersion"

echo "== crear sesion con header: contrato completo"
R1=$(curl -fsS -X POST "$B/api/sessions" -H 'Content-Type: application/json' -H "X-Desktop-Version: $V" -d '{"studentId":1,"examId":1}')
echo "$R1" | jq -e 'has("dockerRun") | not' >/dev/null || fail "no deberia devolver dockerRun"
for k in sessionId token branch containerName volume image containerBackendUrl studentName examTitle; do
  echo "$R1" | jq -e "has(\"$k\") and .$k != null" >/dev/null || fail "falta $k"
done
ID1=$(echo "$R1" | jq -r .sessionId); T1=$(echo "$R1" | jq -r .token)
echo "$R1" | jq -e '.branch | test("^session-[0-9]+-[0-9a-f]{6}$")' >/dev/null || fail "formato de branch"
echo "$R1" | jq -e '.containerName | test("^assessment-[0-9]+-[0-9a-f]{6}$")' >/dev/null || fail "formato de containerName"
echo "$R1" | jq -e '.volume | test("^assessment_[0-9]+_[0-9a-f]{6}_workspace$")' >/dev/null || fail "formato de volume"
echo "$R1" | jq 'del(.token)'

echo "== segunda sesion: rama, contenedor y volumen distintos"
R2=$(curl -fsS -X POST "$B/api/sessions" -H 'Content-Type: application/json' -H "X-Desktop-Version: $V" -d '{"studentId":2,"examId":1}')
for k in branch containerName volume; do
  [ "$(echo "$R1" | jq -r .$k)" != "$(echo "$R2" | jq -r .$k)" ] || fail "$k repetido"
done

echo "== status: token correcto 200, otro token 401, sin version 426"
CODE=$(curl -s -o /tmp/status.json -w '%{http_code}' "$B/api/sessions/$ID1/status" -H "Authorization: Bearer $T1" -H "X-Desktop-Version: $V")
[ "$CODE" = 200 ] || fail "status valido dio $CODE"
jq -e '.status == "CREATED" and .branch == "'"$(echo "$R1" | jq -r .branch)"'" and (has("token") | not)' /tmp/status.json >/dev/null || fail "status body"
CODE=$(curl -s -o /dev/null -w '%{http_code}' "$B/api/sessions/$ID1/status" -H "Authorization: Bearer otro" -H "X-Desktop-Version: $V")
[ "$CODE" = 401 ] || fail "status con otro token dio $CODE"
CODE=$(curl -s -o /dev/null -w '%{http_code}' "$B/api/sessions/$ID1/status" -H "Authorization: Bearer $T1")
[ "$CODE" = 426 ] || fail "status sin version dio $CODE"

echo "== connect: 200, token malo 401, inexistente 401, nextSequence"
CODE=$(curl -s -o /tmp/connect.json -w '%{http_code}' -X POST "$B/api/sessions/$ID1/connect" -H "Authorization: Bearer $T1")
[ "$CODE" = 200 ] || fail "connect valido dio $CODE"
jq -e '.branch == "'"$(echo "$R1" | jq -r .branch)"'" and .studentName != null and .nextSequence == 2' /tmp/connect.json >/dev/null || fail "connect body / nextSequence (esperado 2 tras SESSION_STARTED)"
CODE=$(curl -s -o /dev/null -w '%{http_code}' -X POST "$B/api/sessions/$ID1/connect" -H "Authorization: Bearer nope")
[ "$CODE" = 401 ] || fail "connect malo dio $CODE"
CODE=$(curl -s -o /dev/null -w '%{http_code}' -X POST "$B/api/sessions/99999/connect" -H "Authorization: Bearer $T1")
[ "$CODE" = 401 ] || fail "sesion inexistente dio $CODE"

echo "== desktop-events: tipo valido inserta con sequence del server, invalido 400"
CODE=$(curl -s -o /dev/null -w '%{http_code}' -X POST "$B/api/sessions/$ID1/desktop-events" -H "Authorization: Bearer $T1" -H 'Content-Type: application/json' \
  -d '{"events":[{"type":"DESKTOP_FOCUS_LOST","timestamp":"2026-10-01T12:00:00Z","payload":{}},{"type":"DESKTOP_FOCUS_GAINED","timestamp":"2026-10-01T12:00:05Z","payload":{"awayMs":5000}}]}')
[ "$CODE" = 200 ] || fail "desktop-events valido dio $CODE"
CODE=$(curl -s -o /dev/null -w '%{http_code}' -X POST "$B/api/sessions/$ID1/desktop-events" -H "Authorization: Bearer $T1" -H 'Content-Type: application/json' \
  -d '{"events":[{"type":"NO_EXISTE","payload":{}}]}')
[ "$CODE" = 400 ] || fail "tipo invalido dio $CODE"
CODE=$(curl -s -o /dev/null -w '%{http_code}' -X POST "$B/api/sessions/$ID1/desktop-events" -H "Authorization: Bearer nope" -H 'Content-Type: application/json' -d '{"events":[]}')
[ "$CODE" = 401 ] || fail "desktop-events con token malo dio $CODE"
EV=$(curl -fsS "$B/api/sessions/$ID1/events")
echo "$EV" | jq -e '[.[] | select(.type=="DESKTOP_FOCUS_LOST" or .type=="DESKTOP_FOCUS_GAINED")] | length == 2' >/dev/null || fail "eventos desktop no insertados"
echo "$EV" | jq -e '([.[] | select(.type=="DESKTOP_FOCUS_LOST")][0].sequence) == 2 and ([.[] | select(.type=="DESKTOP_FOCUS_GAINED")][0].sequence) == 3' >/dev/null || fail "sequence asignado por el servidor"
echo "$EV" | jq -e '[.[] | select(.type=="DESKTOP_FOCUS_LOST")][0].timestamp | startswith("2026-10-01T12:00:00")' >/dev/null || fail "timestamp del cliente"

echo "== pagina /"
curl -fsS "$B/" | grep -q "app de escritorio" || fail "index.html"
curl -fsS "$B/" | grep -q "professor.html" || fail "link a professor.html"

if [ -z "${NO_RESTART:-}" ]; then
  echo "== reiniciar backend: la sesion y sus eventos siguen"
  "$ROOT/scripts/restart-backend.sh"
  CODE=$(curl -s -o /tmp/status2.json -w '%{http_code}' "$B/api/sessions/$ID1/status" -H "Authorization: Bearer $T1" -H "X-Desktop-Version: $V")
  [ "$CODE" = 200 ] || fail "tras reinicio status dio $CODE"
  curl -fsS "$B/api/sessions/$ID1/events" | jq -e 'map(.type) | index("SESSION_STARTED") != null and index("DESKTOP_FOCUS_LOST") != null' >/dev/null || fail "eventos perdidos tras reinicio"
  curl -fsS "$B/api/students" | jq -e 'length == 2' >/dev/null || fail "seeds duplicados tras reinicio"
fi

echo "OK smoke-backend"

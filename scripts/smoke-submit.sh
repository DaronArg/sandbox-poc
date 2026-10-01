#!/usr/bin/env bash
# Smoke C1: persistencia H2 en archivo, branch unico por sesion, submit desde el contenedor, token invalidado.
# Reinicia el backend (usa scripts/run-backend.sh). Requiere la imagen assessment-runtime:poc. Correr dentro de WSL.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
B="${BACKEND:-http://localhost:9090}"
fail() { echo "FAIL: $*"; exit 1; }
envv() { tr -d '\r' < "$ROOT/.env" | sed -n "s/^$1=//p"; }
GH_TOKEN_LOCAL="$(envv GITHUB_TOKEN)"
REPO="$(envv GITHUB_REPO)"
gh_api() { curl -s -o /dev/null -w '%{http_code}' -H "Authorization: Bearer $GH_TOKEN_LOCAL" "https://api.github.com/repos/$REPO/$1"; }

restart_backend() {
  pkill -f 'spring-boot:run' || true
  pkill -f com.example.backend.BackendApplication || true
  sleep 3
  (cd "$ROOT" && setsid nohup ./scripts/run-backend.sh > /tmp/backend.log 2>&1 &)
  for _ in $(seq 1 90); do curl -fsS -o /dev/null "$B/api/exams" 2>/dev/null && return 0; sleep 2; done
  fail "el backend no levanto (ver /tmp/backend.log)"
}
new_session() { curl -fsS -X POST "$B/api/sessions" -H 'Content-Type: application/json' -d '{"studentId":1,"examId":1}'; }
wait_ide() {
  for _ in $(seq 1 60); do
    curl -fsS -o /dev/null http://localhost:8080/healthz 2>/dev/null && return 0
    docker ps -q -f "name=$1" | grep -q . || { docker logs "$1" 2>&1 | tail -20; fail "el contenedor $1 murio"; }
    sleep 2
  done
  fail "code-server no responde"
}
NAMES=(); BRANCHES=()
cleanup() {
  for n in "${NAMES[@]:-}"; do [ -n "$n" ] && docker rm -f "$n" >/dev/null 2>&1 && docker volume rm "${n/-/_}_workspace" >/dev/null 2>&1 || true; done
  for br in "${BRANCHES[@]:-}"; do [ -n "$br" ] && curl -s -o /dev/null -X DELETE -H "Authorization: Bearer $GH_TOKEN_LOCAL" "https://api.github.com/repos/$REPO/git/refs/heads/$br" || true; done
}
trap cleanup EXIT
start_container() { # $1=id $2=dockerRun
  local name="assessment-$1"
  docker rm -f "$name" >/dev/null 2>&1 || true
  docker volume rm "assessment_$1_workspace" >/dev/null 2>&1 || true
  NAMES+=("$name")
  eval "${2/docker run --rm/docker run -d --rm}" >/dev/null
  wait_ide "$name"
}

curl -fsS -o /dev/null "$B/api/exams" 2>/dev/null || restart_backend

echo "== persistencia: sesion + evento, reinicio del backend"
R=$(new_session); PID=$(echo "$R" | jq -r .sessionId)
PTOKEN=$(echo "$R" | jq -r .dockerRun | sed -E 's/.*SESSION_TOKEN=([^ ]+).*/\1/')
curl -fsS -X POST "$B/api/telemetry/batch" -H "Authorization: Bearer $PTOKEN" -H 'Content-Type: application/json' \
  -d "{\"sessionId\":$PID,\"events\":[{\"sequence\":1,\"type\":\"FILE_CREATED\",\"timestamp\":\"2026-01-01T00:00:00Z\",\"payload\":{\"path\":\"/workspace/persist.txt\"}}]}" >/dev/null
restart_backend
curl -fsS "$B/api/sessions" | jq -e --argjson id "$PID" 'map(.id) | index($id) != null' >/dev/null || fail "la sesion $PID se perdio al reiniciar"
curl -fsS "$B/api/sessions/$PID/events" | jq -e 'map(.type) | index("FILE_CREATED") != null' >/dev/null || fail "el evento se perdio al reiniciar"
[ "$(curl -fsS "$B/api/students" | jq length)" = 2 ] || fail "seeds duplicados o ausentes tras reinicio"
echo "ok: sesion $PID y su evento sobreviven; seeds = 2"

echo "== sesion A: contenedor, cambio sin commitear, submit"
R=$(new_session); A=$(echo "$R" | jq -r .sessionId); CMD_A=$(echo "$R" | jq -r .dockerRun)
TOKEN_A=$(echo "$CMD_A" | sed -E 's/.*SESSION_TOKEN=([^ ]+).*/\1/')
BR_A=$(curl -fsS "$B/api/sessions" | jq -r --argjson id "$A" '.[]|select(.id==$id)|.branch')
BRANCHES+=("$BR_A")
echo "$BR_A" | grep -Eq "^session-$A-[0-9a-f]{6}$" || fail "formato de branch: $BR_A"
start_container "$A" "$CMD_A"
NAME_A="assessment-$A"
docker exec "$NAME_A" bash -c "echo entrega-$A > /workspace/entrega.txt"
docker exec "$NAME_A" submit
SHA_A=$(docker exec "$NAME_A" git -C /workspace rev-parse HEAD)
S=$(curl -fsS "$B/api/sessions" | jq -c --argjson id "$A" '.[]|select(.id==$id)')
[ "$(echo "$S" | jq -r .status)" = COMPLETED ] || fail "estado: $S"
[ "$(echo "$S" | jq -r .finalSha)" = "$SHA_A" ] || fail "final_sha != HEAD: $S"
[ "$(gh_api "commits/$SHA_A")" = 200 ] || fail "el SHA $SHA_A no existe en GitHub"
curl -fsS "$B/api/sessions/$A/events" | jq -e 'map(.type) | index("SUBMISSION_COMPLETED") != null' >/dev/null || fail "falta SUBMISSION_COMPLETED"
curl -fsS "$B/api/sessions/$A/events" | jq -e 'map(select(.type=="COMMAND_EXECUTED")) | length >= 0' >/dev/null
echo "ok: COMPLETED, final_sha=$SHA_A existe en GitHub"

echo "== token invalidado tras submit"
docker exec "$NAME_A" bash -c "cd /workspace && echo x >> entrega.txt && git commit -qam 'post-submit'"
if docker exec "$NAME_A" git -C /workspace push -q origin HEAD 2>/tmp/push.err; then fail "git push funciono despues de submit"; fi
grep -qi "401\|Authentication\|denied" /tmp/push.err || { cat /tmp/push.err; fail "push fallo pero no por 401"; }
C=$(curl -s -o /dev/null -w '%{http_code}' -X POST "$B/ai/v1/messages" -H "x-api-key: $TOKEN_A" -H 'content-type: application/json' -d '{"model":"x","max_tokens":1,"messages":[]}')
[ "$C" = 401 ] || fail "gateway IA dio $C"
C=$(curl -s -o /dev/null -w '%{http_code}' -X POST "$B/api/telemetry/batch" -H "Authorization: Bearer $TOKEN_A" -H 'Content-Type: application/json' -d "{\"sessionId\":$A,\"events\":[]}")
[ "$C" = 401 ] || fail "telemetria dio $C"
C=$(curl -s -o /dev/null -w '%{http_code}' -X POST "$B/api/sessions/$A/connect" -H "Authorization: Bearer $TOKEN_A")
[ "$C" = 401 ] || fail "connect dio $C"
echo "ok: push, gateway IA, telemetria y connect -> 401"
docker rm -f "$NAME_A" >/dev/null; docker volume rm "assessment_${A}_workspace" >/dev/null 2>&1 || true

echo "== sesion B inmediatamente despues: branch distinto, push sin conflicto"
R=$(new_session); Bid=$(echo "$R" | jq -r .sessionId); CMD_B=$(echo "$R" | jq -r .dockerRun)
BR_B=$(curl -fsS "$B/api/sessions" | jq -r --argjson id "$Bid" '.[]|select(.id==$id)|.branch')
BRANCHES+=("$BR_B")
[ "$BR_A" != "$BR_B" ] || fail "mismo branch"
start_container "$Bid" "$CMD_B"
docker exec "assessment-$Bid" bash -c "cd /workspace && echo b-$Bid > b.txt && git add b.txt && git commit -qm 'test: B' && git push -q origin HEAD"
[ "$(gh_api "branches/$BR_B")" = 200 ] || fail "branch $BR_B no esta en GitHub"
[ "$(gh_api "branches/$BR_A")" = 200 ] || fail "branch $BR_A no esta en GitHub"
echo "ok: $BR_A y $BR_B conviven en GitHub"

echo "OK smoke-submit"

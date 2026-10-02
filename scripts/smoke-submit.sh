#!/usr/bin/env bash
# Smoke de entrega: persistencia H2 en archivo, branch unico por sesion, submit desde el contenedor, token invalidado.
# Reinicia el backend (restart-backend.sh). Requiere la imagen assessment-runtime:poc y GITHUB_TOKEN/GITHUB_REPO en .env. Dentro de WSL.
set -euo pipefail
source "$(dirname "$0")/lib-session.sh"
envv() { tr -d '\r' < "$ROOT/.env" | sed -n "s/^$1=//p"; }
GH_TOKEN_LOCAL="$(envv GITHUB_TOKEN)"
REPO="$(envv GITHUB_REPO)"
[ -n "$GH_TOKEN_LOCAL" ] || sfail "smoke-submit necesita GITHUB_TOKEN en .env (el SHA final se verifica en GitHub)"
gh_api() { curl -s -o /dev/null -w '%{http_code}' -H "Authorization: Bearer $GH_TOKEN_LOCAL" "https://api.github.com/repos/$REPO/$1"; }
new_session() { curl -fsS -X POST "$B/api/sessions" -H 'Content-Type: application/json' -H "X-Desktop-Version: $DESKTOP_VERSION" -d '{"studentId":1,"examId":1}'; }

BRANCHES=()
cleanup() {
  stop_session
  for br in "${BRANCHES[@]:-}"; do [ -n "$br" ] && curl -s -o /dev/null -X DELETE -H "Authorization: Bearer $GH_TOKEN_LOCAL" "https://api.github.com/repos/$REPO/git/refs/heads/$br" || true; done
}

curl -fsS -o /dev/null "$B/api/exams" 2>/dev/null || "$ROOT/scripts/restart-backend.sh" >/dev/null

echo "== persistencia: sesion + evento, reinicio del backend"
R=$(new_session); PID=$(echo "$R" | jq -r .sessionId); PTOKEN=$(echo "$R" | jq -r .token)
curl -fsS -X POST "$B/api/telemetry/batch" -H "Authorization: Bearer $PTOKEN" -H 'Content-Type: application/json' \
  -d "{\"sessionId\":$PID,\"events\":[{\"sequence\":1,\"type\":\"FILE_CREATED\",\"timestamp\":\"2026-01-01T00:00:00Z\",\"payload\":{\"path\":\"/workspace/persist.txt\"}}]}" >/dev/null
"$ROOT/scripts/restart-backend.sh" >/dev/null
curl -fsS "$B/api/sessions" | jq -e --argjson id "$PID" 'map(.id) | index($id) != null' >/dev/null || sfail "la sesion $PID se perdio al reiniciar"
curl -fsS "$B/api/sessions/$PID/events" | jq -e 'map(.type) | index("FILE_CREATED") != null' >/dev/null || sfail "el evento se perdio al reiniciar"
[ "$(curl -fsS "$B/api/students" | jq length)" = 2 ] || sfail "seeds duplicados o ausentes tras reinicio"
echo "ok: sesion $PID y su evento sobreviven; seeds = 2"

echo "== sesion A: contenedor, cambio sin commitear, submit"
start_session 1
trap cleanup EXIT
A=$ID; NAME_A=$NAME; TOKEN_A=$TOKEN; BR_A=$BRANCH
BRANCHES+=("$BR_A")
echo "$BR_A" | grep -Eq "^session-$A-[0-9a-f]{6}$" || sfail "formato de branch: $BR_A"
wait_ide
docker exec -u coder "$NAME_A" bash -c "echo entrega-$A > /workspace/entrega.txt"
docker exec -u coder "$NAME_A" submit
SHA_A=$(docker exec -u coder "$NAME_A" git -C /workspace rev-parse HEAD)
S=$(curl -fsS "$B/api/sessions" | jq -c --argjson id "$A" '.[]|select(.id==$id)')
[ "$(echo "$S" | jq -r .status)" = COMPLETED ] || sfail "estado: $S"
[ "$(echo "$S" | jq -r .finalSha)" = "$SHA_A" ] || sfail "final_sha != HEAD: $S"
[ "$(gh_api "commits/$SHA_A")" = 200 ] || sfail "el SHA $SHA_A no existe en GitHub"
curl -fsS "$B/api/sessions/$A/events" | jq -e 'map(.type) | index("SUBMISSION_COMPLETED") != null' >/dev/null || sfail "falta SUBMISSION_COMPLETED"
curl -fsS "$B/api/sessions/$A/result" | jq -e '.status == "COMPLETED" and .finalSha != null and .ciStatus != null' >/dev/null || sfail "GET /result"
echo "ok: COMPLETED, final_sha=$SHA_A existe en GitHub"

echo "== token invalidado tras submit"
docker exec -u coder "$NAME_A" bash -c "cd /workspace && echo x >> entrega.txt && git commit -qam 'post-submit'"
if docker exec -u coder "$NAME_A" git -C /workspace push -q origin HEAD 2>/tmp/push.err; then sfail "git push funciono despues de submit"; fi
grep -qi "401\|Authentication\|denied" /tmp/push.err || { cat /tmp/push.err; sfail "push fallo pero no por 401"; }
C=$(curl -s -o /dev/null -w '%{http_code}' -X POST "$B/ai/v1/messages" -H "x-api-key: $TOKEN_A" -H 'content-type: application/json' -d '{"model":"x","max_tokens":1,"messages":[]}')
[ "$C" = 401 ] || sfail "gateway IA dio $C"
C=$(curl -s -o /dev/null -w '%{http_code}' -X POST "$B/api/telemetry/batch" -H "Authorization: Bearer $TOKEN_A" -H 'Content-Type: application/json' -d "{\"sessionId\":$A,\"events\":[]}")
[ "$C" = 401 ] || sfail "telemetria dio $C"
C=$(curl -s -o /dev/null -w '%{http_code}' -X POST "$B/api/sessions/$A/connect" -H "Authorization: Bearer $TOKEN_A")
[ "$C" = 401 ] || sfail "connect dio $C"
C=$(curl -s -o /dev/null -w '%{http_code}' "$B/api/sessions/$A/status" -H "Authorization: Bearer $TOKEN_A" -H "X-Desktop-Version: $DESKTOP_VERSION")
[ "$C" = 401 ] || sfail "status dio $C"
echo "ok: push, gateway IA, telemetria, connect y status -> 401"
stop_session

echo "== sesion B inmediatamente despues: branch distinto, push sin conflicto"
start_session 1
BR_B=$BRANCH; BRANCHES+=("$BR_B")
[ "$BR_A" != "$BR_B" ] || sfail "mismo branch"
wait_ide
docker exec -u coder "$NAME" bash -c "cd /workspace && echo b-$ID > b.txt && git add b.txt && git commit -qm 'test: B' && git push -q origin HEAD"
[ "$(gh_api "branches/$BR_B")" = 200 ] || sfail "branch $BR_B no esta en GitHub"
[ "$(gh_api "branches/$BR_A")" = 200 ] || sfail "branch $BR_A no esta en GitHub"
echo "ok: $BR_A y $BR_B conviven en GitHub"

echo "OK smoke-submit"

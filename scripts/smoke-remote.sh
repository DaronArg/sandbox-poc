#!/usr/bin/env bash
# Smoke C5: flujo completo con el contenedor hablando con el backend SOLO por una URL publica HTTPS (tunel Cloudflare).
# Sin --add-host. Al terminar baja el tunel y reinicia el backend sin PUBLIC_URL. Requiere imagen assessment-runtime:poc
# (con bootstrap que respeta https) y cloudflared. Correr dentro de WSL. No imprime la URL del tunel.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
B=http://localhost:9090
fail() { echo "FAIL: $*"; exit 1; }
envv() { tr -d '\r' < "$ROOT/.env" | sed -n "s/^$1=//p"; }
GH_TOKEN_LOCAL="$(envv GITHUB_TOKEN)"; REPO="$(envv GITHUB_REPO)"
NAME=""; BR=""; ID=""
restart_backend() { # $1 = PUBLIC_URL (puede ser vacio)
  pkill -f 'spring-boot:run' || true
  pkill -f com.example.backend.BackendApplication || true
  sleep 3
  (cd "$ROOT" && PUBLIC_URL="${1:-}" setsid nohup ./scripts/run-backend.sh > /tmp/backend.log 2>&1 &)
  for _ in $(seq 1 90); do curl -fsS -o /dev/null "$B/api/exams" 2>/dev/null && return 0; sleep 2; done
  fail "el backend no levanto (ver /tmp/backend.log)"
}
cleanup() {
  [ -n "$NAME" ] && docker rm -f "$NAME" >/dev/null 2>&1 || true
  [ -n "$ID" ] && docker volume rm "assessment_${ID}_workspace" >/dev/null 2>&1 || true
  [ -n "$BR" ] && curl -s -o /dev/null -X DELETE -H "Authorization: Bearer $GH_TOKEN_LOCAL" "https://api.github.com/repos/$REPO/git/refs/heads/$BR" || true
  "$ROOT/scripts/tunnel.sh" down || true
  restart_backend ""
  pgrep -x cloudflared >/dev/null && echo "WARN: cloudflared sigue vivo" || echo "cleanup: tunel abajo, backend sin PUBLIC_URL"
}
trap cleanup EXIT

PUB=$("$ROOT/scripts/tunnel.sh" up)
echo "tunel arriba (URL oculta)"
restart_backend "$PUB"
# el tunel puede tardar en propagar DNS
for _ in $(seq 1 30); do curl -fsS -o /dev/null "$PUB/api/exams" 2>/dev/null && break; sleep 2; done
curl -fsS -o /dev/null "$PUB/api/exams" || fail "la URL publica no responde"
echo "ok: backend alcanzable por la URL publica"

R=$(curl -fsS -X POST "$B/api/sessions" -H 'Content-Type: application/json' -d '{"studentId":1,"examId":1}')
ID=$(echo "$R" | jq -r .sessionId); CMD=$(echo "$R" | jq -r .dockerRun)
TOKEN=$(echo "$CMD" | sed -E 's/.*SESSION_TOKEN=([^ ]+).*/\1/')
BR=$(curl -fsS "$B/api/sessions" | jq -r --argjson id "$ID" '.[]|select(.id==$id)|.branch')
echo "$CMD" | grep -q -- '--add-host' && fail "el docker run trae --add-host"
echo "$CMD" | grep -q "BACKEND_URL=$PUB" || fail "BACKEND_URL no es la URL publica"
echo "$CMD" | grep -q 'host.docker.internal' && fail "referencia a host.docker.internal"
echo "ok: docker run sin --add-host, BACKEND_URL publico"

NAME="assessment-$ID"
docker rm -f "$NAME" >/dev/null 2>&1 || true
docker volume rm "assessment_${ID}_workspace" >/dev/null 2>&1 || true
eval "${CMD/docker run --rm/docker run -d --rm}" >/dev/null
for _ in $(seq 1 90); do
  curl -fsS -o /dev/null http://localhost:8080/healthz 2>/dev/null && break
  docker ps -q -f "name=$NAME" | grep -q . || { docker logs "$NAME" 2>&1 | sed "s|$PUB|<url>|g" | tail -20; fail "el contenedor murio"; }
  sleep 2
done
curl -fsS -o /dev/null http://localhost:8080/healthz || fail "code-server no responde"
S=$(curl -fsS "$B/api/sessions" | jq -r --argjson id "$ID" '.[]|select(.id==$id)|.status')
[ "$S" = ACTIVE ] || fail "connect no dejo la sesion ACTIVE ($S)"
docker exec "$NAME" git -C /workspace rev-parse --abbrev-ref HEAD | grep -q "^$BR$" || fail "clone/checkout de $BR fallo"
docker exec "$NAME" test -f /workspace/pom.xml -o -f /workspace/backend/pom.xml || docker exec "$NAME" ls /workspace >/dev/null
echo "ok: connect y clone por HTTPS publico (sesion ACTIVE, branch $BR)"

echo "== telemetria"
docker exec "$NAME" bash -c "echo remoto > /workspace/remote.txt"
OKT=0
for _ in $(seq 1 30); do
  curl -fsS "$B/api/sessions/$ID/events" | jq -e 'map(.type) | index("FILE_CREATED") != null' >/dev/null && { OKT=1; break; }
  sleep 2
done
[ "$OKT" = 1 ] || fail "no llego FILE_CREATED por el tunel"
echo "ok: FILE_CREATED visible en la API"

echo "== IA (desde el contenedor, por la URL publica)"
MODEL=$(envv AI_CHAT_MODEL); MODEL="${MODEL:-claude-sonnet-5-5}"
BODY="{\"model\":\"$MODEL\",\"max_tokens\":30,\"messages\":[{\"role\":\"user\",\"content\":\"Reply with the single word: pong\"}]"
OUT=$(docker exec "$NAME" bash -c "curl -sS -w '\n%{http_code}' \"\$BACKEND_URL/ai/v1/messages\" -H \"x-api-key: \$SESSION_TOKEN\" -H 'anthropic-version: 2023-06-01' -H 'content-type: application/json' -d '$BODY}'")
[ "$(echo "$OUT" | tail -1)" = 200 ] || fail "IA normal: $(echo "$OUT" | tail -2)"
echo "$OUT" | head -n -1 | jq -e '.content[0].text' >/dev/null || fail "IA normal sin texto"
OUT=$(docker exec "$NAME" bash -c "curl -sSN -w '\n%{http_code}' \"\$BACKEND_URL/ai/v1/messages\" -H \"x-api-key: \$SESSION_TOKEN\" -H 'anthropic-version: 2023-06-01' -H 'content-type: application/json' -d '$BODY,\"stream\":true}'")
[ "$(echo "$OUT" | tail -1)" = 200 ] || fail "IA stream status"
echo "$OUT" | grep -q '^event: content_block_delta' || fail "IA stream sin content_block_delta"
echo "ok: IA normal y streaming (SSE) por el tunel"

echo "== push y submit"
docker exec "$NAME" bash -c "cd /workspace && git add -A && git commit -qm 'test: remote' && git push -q origin HEAD"
curl -s -o /dev/null -w '%{http_code}' -H "Authorization: Bearer $GH_TOKEN_LOCAL" "https://api.github.com/repos/$REPO/branches/$BR" | grep -q 200 || fail "el push no llego a GitHub"
docker exec "$NAME" submit
SHA=$(docker exec "$NAME" git -C /workspace rev-parse HEAD)
S=$(curl -fsS "$B/api/sessions" | jq -c --argjson id "$ID" '.[]|select(.id==$id)')
[ "$(echo "$S" | jq -r .status)" = COMPLETED ] || fail "estado: $S"
[ "$(echo "$S" | jq -r .finalSha)" = "$SHA" ] || fail "final_sha != HEAD"
curl -fsS "$B/api/sessions/$ID/events" | jq -e 'map(.type) | index("GIT_PUSH") != null and index("SUBMISSION_COMPLETED") != null' >/dev/null || fail "faltan GIT_PUSH/SUBMISSION_COMPLETED"
echo "ok: push en GitHub, submit COMPLETED con SHA $SHA"
echo "OK smoke-remote"

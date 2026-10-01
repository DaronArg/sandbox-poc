#!/usr/bin/env bash
# Smoke T6: AI Gateway (normal, stream, 401, eventos) + config de Continue renderizada en el contenedor.
# Requiere backend en :9090 con ANTHROPIC_API_KEY y la imagen assessment-runtime:poc. Correr dentro de WSL.
set -euo pipefail
B="${BACKEND:-http://localhost:9090}"
fail() { echo "FAIL: $*"; exit 1; }

R=$(curl -fsS -X POST "$B/api/sessions" -H 'Content-Type: application/json' -d '{"studentId":1,"examId":1}')
ID=$(echo "$R" | jq -r .sessionId)
CMD=$(echo "$R" | jq -r .dockerRun)
TOKEN=$(echo "$CMD" | sed -n 's/.*SESSION_TOKEN=\([^ ]*\).*/\1/p')
MODEL=$(curl -fsS -X POST "$B/api/sessions/$ID/connect" -H "Authorization: Bearer $TOKEN" | jq -r .chatModel)
echo "sessionId=$ID model=$MODEL"
BODY="{\"model\":\"$MODEL\",\"max_tokens\":50,\"messages\":[{\"role\":\"user\",\"content\":\"Reply with the single word: pong\"}]"

echo "== no stream"
OUT=$(curl -sS -w '\n%{http_code}' "$B/ai/v1/messages" -H "x-api-key: $TOKEN" -H 'anthropic-version: 2023-06-01' -H 'content-type: application/json' -d "$BODY}")
CODE=$(echo "$OUT" | tail -1); echo "$OUT" | head -n -1 | jq -r '.content[0].text // .'
[ "$CODE" = 200 ] || fail "no-stream status $CODE"

echo "== stream"
OUT=$(curl -sSN -w '\n%{http_code}' "$B/ai/v1/messages" -H "x-api-key: $TOKEN" -H 'anthropic-version: 2023-06-01' -H 'content-type: application/json' -d "$BODY,\"stream\":true}")
CODE=$(echo "$OUT" | tail -1)
echo "$OUT" | grep -q '^event: content_block_delta' || fail "stream sin content_block_delta"
[ "$CODE" = 200 ] || fail "stream status $CODE"
echo "stream OK (SSE recibido)"

echo "== token invalido"
CODE=$(curl -s -o /dev/null -w '%{http_code}' "$B/ai/v1/messages" -H "x-api-key: nope" -H 'content-type: application/json' -d "$BODY}")
[ "$CODE" = 401 ] || fail "token invalido dio $CODE"
echo "401 OK"

echo "== eventos"
EV=$(curl -fsS "$B/api/sessions/$ID/events")
echo "$EV" | jq -r '.[] | select(.type|startswith("AI_")) | "\(.type)\t\(.payload)"'
echo "$EV" | jq -e '([.[]|select(.type=="AI_PROMPT")]|length>=2) and ([.[]|select(.type=="AI_RESPONSE")]|length>=2)' >/dev/null || fail "faltan AI_PROMPT/AI_RESPONSE"

echo "== autocomplete model => AI_AUTOCOMPLETE sin contenido"
AC=$(grep -E '^AI_AUTOCOMPLETE_MODEL=' "$(dirname "$0")/../.env" | cut -d= -f2- | tr -d '\r')
curl -fsS -o /dev/null "$B/ai/v1/messages" -H "x-api-key: $TOKEN" -H 'anthropic-version: 2023-06-01' -H 'content-type: application/json' \
  -d "{\"model\":\"$AC\",\"max_tokens\":10,\"messages\":[{\"role\":\"user\",\"content\":\"secret-autocomplete-content\"}]}"
EV=$(curl -fsS "$B/api/sessions/$ID/events")
echo "$EV" | jq -e 'any(.[]; .type=="AI_AUTOCOMPLETE")' >/dev/null || fail "falta AI_AUTOCOMPLETE"
echo "$EV" | grep -q secret-autocomplete-content && fail "autocomplete guardo contenido"

echo "== config de Continue en el contenedor"
docker ps -aq -f name=assessment- | xargs -r docker rm -f >/dev/null 2>&1 || true
ID2=$(curl -fsS -X POST "$B/api/sessions" -H 'Content-Type: application/json' -d '{"studentId":1,"examId":1}' | tee /tmp/smoke-ai-s.json | jq -r .sessionId)
CMD2=$(jq -r .dockerRun /tmp/smoke-ai-s.json)
eval "${CMD2/docker run --rm/docker run -d --rm}" >/dev/null
trap 'docker rm -f assessment-$ID2 >/dev/null 2>&1 || true; docker volume rm assessment_${ID2}_workspace >/dev/null 2>&1 || true' EXIT
for i in $(seq 1 60); do docker exec "assessment-$ID2" test -f /home/coder/.continue/config.yaml 2>/dev/null && break; sleep 2; done
docker exec "assessment-$ID2" cat /home/coder/.continue/config.yaml | sed 's/apiKey: .*/apiKey: <redacted>/'
docker exec "assessment-$ID2" grep -q "apiBase: http://host.docker.internal:9090/ai/v1/" /home/coder/.continue/config.yaml || fail "apiBase"
echo "OK smoke-ai"

#!/usr/bin/env bash
# Smoke AI Gateway (normal, stream, 401, eventos) + config de Continue renderizada en el contenedor.
# Requiere backend en :9090 y la imagen assessment-runtime:poc. Correr dentro de WSL.
# Sin ANTHROPIC_API_KEY en .env se omiten (y se reportan como SKIPPED) los pasos que llaman a Anthropic.
set -euo pipefail
source "$(dirname "$0")/lib-session.sh"
HAS_KEY=0
grep -q '^ANTHROPIC_API_KEY=.\+' "$ROOT/.env" 2>/dev/null && HAS_KEY=1

echo "== crear sesion y levantar contenedor"
start_session 1
wait_ide
MODEL=$(curl -fsS -X POST "$B/api/sessions/$ID/connect" -H "Authorization: Bearer $TOKEN" | jq -r .chatModel)
BODY="{\"model\":\"$MODEL\",\"max_tokens\":50,\"messages\":[{\"role\":\"user\",\"content\":\"Reply with the single word: pong\"}]"

echo "== token invalido (401)"
CODE=$(curl -s -o /dev/null -w '%{http_code}' "$B/ai/v1/messages" -H "x-api-key: nope" -H 'content-type: application/json' -d "$BODY}")
[ "$CODE" = 401 ] || sfail "token invalido dio $CODE"
echo "401 OK"

if [ "$HAS_KEY" = 1 ]; then
  echo "== no stream"
  OUT=$(curl -sS -w '\n%{http_code}' "$B/ai/v1/messages" -H "x-api-key: $TOKEN" -H 'anthropic-version: 2023-06-01' -H 'content-type: application/json' -d "$BODY}")
  CODE=$(echo "$OUT" | tail -1); echo "$OUT" | head -n -1 | jq -r '.content[0].text // .'
  [ "$CODE" = 200 ] || sfail "no-stream status $CODE"
  echo "== stream"
  OUT=$(curl -sSN -w '\n%{http_code}' "$B/ai/v1/messages" -H "x-api-key: $TOKEN" -H 'anthropic-version: 2023-06-01' -H 'content-type: application/json' -d "$BODY,\"stream\":true}")
  CODE=$(echo "$OUT" | tail -1)
  echo "$OUT" | grep -q '^event: content_block_delta' || sfail "stream sin content_block_delta"
  [ "$CODE" = 200 ] || sfail "stream status $CODE"
  echo "== eventos"
  EV=$(curl -fsS "$B/api/sessions/$ID/events")
  echo "$EV" | jq -e '([.[]|select(.type=="AI_PROMPT")]|length>=2) and ([.[]|select(.type=="AI_RESPONSE")]|length>=2)' >/dev/null || sfail "faltan AI_PROMPT/AI_RESPONSE"
  echo "== autocomplete model => AI_AUTOCOMPLETE sin contenido"
  AC=$(grep -E '^AI_AUTOCOMPLETE_MODEL=' "$ROOT/.env" | cut -d= -f2- | tr -d '\r')
  curl -fsS -o /dev/null "$B/ai/v1/messages" -H "x-api-key: $TOKEN" -H 'anthropic-version: 2023-06-01' -H 'content-type: application/json' \
    -d "{\"model\":\"$AC\",\"max_tokens\":10,\"messages\":[{\"role\":\"user\",\"content\":\"secret-autocomplete-content\"}]}"
  EV=$(curl -fsS "$B/api/sessions/$ID/events")
  echo "$EV" | jq -e 'any(.[]; .type=="AI_AUTOCOMPLETE")' >/dev/null || sfail "falta AI_AUTOCOMPLETE"
  echo "$EV" | grep -q secret-autocomplete-content && sfail "autocomplete guardo contenido"
else
  echo "SKIPPED: no-stream / stream / eventos AI_* / autocomplete (no hay ANTHROPIC_API_KEY en .env)"
fi

echo "== config de Continue en el contenedor"
docker exec -u coder "$NAME" cat /home/coder/.continue/config.yaml | sed 's/apiKey: .*/apiKey: <redacted>/'
docker exec -u coder "$NAME" grep -q "apiBase: http://host.docker.internal:9090/ai/v1/" /home/coder/.continue/config.yaml || sfail "apiBase"
if [ "$HAS_KEY" = 1 ]; then echo "OK smoke-ai"; else echo "OK smoke-ai (parcial: sin ANTHROPIC_API_KEY)"; fi

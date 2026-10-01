#!/bin/bash
# Entrega el examen: commit de lo pendiente, push, flush de telemetria y POST /submit con el SHA de HEAD.
set -e
cd /workspace
git add -A
if ! git diff --cached --quiet; then
  git commit -qm "chore: final submission"
fi
git push -q origin HEAD
SHA="$(git rev-parse HEAD)"

# esperar a que el agente envie el ultimo batch (el agente lee el log de comandos cada 1 s)
sleep 2
rm -f /tmp/telemetry/flushed
if pkill -USR1 -f /opt/telemetry/agent.js; then
  for _ in $(seq 1 30); do [ -f /tmp/telemetry/flushed ] && break; sleep 1; done
fi

curl -fsS -X POST "$BACKEND_URL/api/sessions/$SESSION_ID/submit"   -H "Authorization: Bearer $SESSION_TOKEN" -H 'Content-Type: application/json'   -d "{\"sha\":\"$SHA\"}" >/dev/null
echo "Entrega enviada. SHA final: $SHA"

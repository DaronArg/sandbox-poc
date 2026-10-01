#!/bin/bash
# Corre como `coder`: connect, git, clone, Continue, telemetria y code-server (solo en 127.0.0.1:8080, detras del gate).
set -e

start_code_server() {
  exec code-server --auth none --bind-addr 127.0.0.1:8080 /workspace
}

mkdir -p "$HOME/.continue" "$HOME/.local/share/code-server/User"
SETTINGS='{"continue.telemetryEnabled": false, "security.workspace.trust.enabled": false, "remote.autoForwardPorts": false, "workbench.startupEditor": "none"}'

if [ -z "$SESSION_TOKEN" ]; then
  echo "[session] sin SESSION_TOKEN: solo code-server detras del gate (sin connect ni clone)"
  echo "$SETTINGS" > "$HOME/.local/share/code-server/User/settings.json"
  start_code_server
fi

echo "[session] connecting session $SESSION_ID to $BACKEND_URL"
if ! curl -fsS -X POST "$BACKEND_URL/api/sessions/$SESSION_ID/connect" \
     -H "Authorization: Bearer $SESSION_TOKEN" -o /tmp/connect.json; then
  echo "[session] ERROR: connect failed (backend unreachable or invalid session/token)" >&2
  exit 1
fi
json() { node -e 'const j=JSON.parse(require("fs").readFileSync("/tmp/connect.json","utf8"));process.stdout.write(String(j[process.argv[1]]))' "$1"; }
BRANCH="$(json branch)"
STUDENT_NAME="$(json studentName)"
STUDENT_EMAIL="$(json studentEmail)"
CHAT_MODEL="$(json chatModel)"
AUTOCOMPLETE_MODEL="$(json autocompleteModel)"
export NEXT_SEQUENCE="$(json nextSequence)"

git config --global user.name "$STUDENT_NAME"
git config --global user.email "$STUDENT_EMAIL"
git config --global credential.helper store
HOSTPORT="${BACKEND_URL#*://}"
echo "http://session:${SESSION_TOKEN}@${HOSTPORT}" > "$HOME/.git-credentials"
chmod 600 "$HOME/.git-credentials"

if [ ! -d /workspace/.git ]; then
  echo "[session] cloning exam repo"
  git clone "$BACKEND_URL/git/$SESSION_ID/repo.git" /workspace
  git -C /workspace checkout -b "$BRANCH"
else
  echo "[session] /workspace already has a repo, leaving it untouched"
fi

echo "[session] configuring Continue (AI gateway)"
sed -e "s|__API_BASE__|$BACKEND_URL/ai/v1/|g" -e "s|__TOKEN__|$SESSION_TOKEN|g" \
    -e "s|__CHAT_MODEL__|$CHAT_MODEL|g" -e "s|__AUTOCOMPLETE_MODEL__|$AUTOCOMPLETE_MODEL|g" \
    /opt/continue-config.yaml > "$HOME/.continue/config.yaml"
echo "$SETTINGS" > "$HOME/.local/share/code-server/User/settings.json"

echo "[session] starting telemetry agent"
node /opt/telemetry/agent.js >> /tmp/telemetry-agent.log 2>&1 &

start_code_server

#!/bin/bash
set -e

if [ -z "$SESSION_TOKEN" ]; then
  echo "[bootstrap] standalone mode (no SESSION_TOKEN): starting code-server only"
  exec code-server --auth none --bind-addr 0.0.0.0:8080 /workspace
fi

echo "[bootstrap] connecting session $SESSION_ID to $BACKEND_URL"
if ! curl -fsS -X POST "$BACKEND_URL/api/sessions/$SESSION_ID/connect" \
     -H "Authorization: Bearer $SESSION_TOKEN" -o /tmp/connect.json; then
  echo "[bootstrap] ERROR: connect failed (backend unreachable or invalid session/token)" >&2
  exit 1
fi
json() { node -e 'const j=JSON.parse(require("fs").readFileSync("/tmp/connect.json","utf8"));process.stdout.write(String(j[process.argv[1]]))' "$1"; }
BRANCH="$(json branch)"
STUDENT_NAME="$(json studentName)"
STUDENT_EMAIL="$(json studentEmail)"

git config --global user.name "$STUDENT_NAME"
git config --global user.email "$STUDENT_EMAIL"
git config --global credential.helper store
HOSTPORT="${BACKEND_URL#*://}"
echo "http://session:${SESSION_TOKEN}@${HOSTPORT}" > "$HOME/.git-credentials"
chmod 600 "$HOME/.git-credentials"

if [ ! -d /workspace/.git ]; then
  echo "[bootstrap] cloning exam repo"
  git clone "$BACKEND_URL/git/$SESSION_ID/repo.git" /workspace
  git -C /workspace checkout -b "$BRANCH"
else
  echo "[bootstrap] /workspace already has a repo, leaving it untouched"
fi

exec code-server --auth none --bind-addr 0.0.0.0:8080 /workspace

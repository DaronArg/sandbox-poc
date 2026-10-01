#!/usr/bin/env bash
# Upstream git local para entornos sin acceso a GitHub (dentro de WSL).
#   scripts/local-upstream.sh up    -> siembra /tmp/upstream desde exam-template/ y arranca el servidor en :9418
#   scripts/local-upstream.sh seed  -> vuelve a sembrar main con el contenido actual de exam-template/
#   scripts/local-upstream.sh down
# El backend debe correr con GIT_UPSTREAM_BASE=http://localhost:9418 (lo exporta scripts/run-backend.sh si el archivo
# /tmp/upstream/.active existe) y GITHUB_REPO=<owner>/<repo> del .env.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
UP=/tmp/upstream
REPO="$(tr -d '\r' < "$ROOT/.env" | sed -n 's/^GITHUB_REPO=//p')"
BARE="$UP/$REPO.git"

seed() {
  rm -rf "$BARE" /tmp/upstream-work
  mkdir -p "$BARE" /tmp/upstream-work
  git init -q --bare -b main "$BARE"
  git -C "$BARE" config http.receivepack true
  cp -r "$ROOT/exam-template/." /tmp/upstream-work/
  rm -rf /tmp/upstream-work/.git /tmp/upstream-work/node_modules /tmp/upstream-work/frontend/node_modules /tmp/upstream-work/target
  git -C /tmp/upstream-work init -q -b main
  git -C /tmp/upstream-work add -A
  git -C /tmp/upstream-work -c user.name=seed -c user.email=seed@example.com commit -qm "seed"
  git -C /tmp/upstream-work push -q "$BARE" main
  touch "$UP/.active"
  echo "upstream sembrado en $BARE"
}

case "${1:-up}" in
  up)
    pkill -f local-git-upstream.js 2>/dev/null || true
    seed
    setsid nohup node "$ROOT/scripts/local-git-upstream.js" "$UP" 9418 > /tmp/upstream.log 2>&1 < /dev/null &
    sleep 1
    curl -fsS "http://localhost:9418/$REPO.git/info/refs?service=git-upload-pack" -o /dev/null && echo "upstream arriba"
    ;;
  seed) seed ;;
  down) pkill -f local-git-upstream.js 2>/dev/null || true; rm -f "$UP/.active" ;;
esac

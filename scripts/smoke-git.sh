#!/usr/bin/env bash
# Smoke git: sesion -> docker run (§6.4) -> clone automatico -> commit+push -> upstream + GIT_PUSH.
# Requiere backend en :9090 y la imagen assessment-runtime:poc. Correr dentro de WSL.
# Con GITHUB_TOKEN en .env consulta GitHub; sin el, usa el upstream git local (scripts/local-upstream.sh).
set -euo pipefail
source "$(dirname "$0")/lib-session.sh"
REPO="$(tr -d '\r' < "$ROOT/.env" | sed -n 's/^GITHUB_REPO=//p')"
# Solo para consultar GitHub desde el script; nunca se imprime ni entra al contenedor.
GH_TOKEN_LOCAL="$(tr -d '\r' < "$ROOT/.env" | sed -n 's/^GITHUB_TOKEN=//p')"

echo "== crear sesion y levantar contenedor"
start_session 1
wait_ide

echo "== /workspace tiene el repo en el branch $BRANCH"
GOT=$(docker exec -u coder "$NAME" git -C /workspace rev-parse --abbrev-ref HEAD)
[ "$GOT" = "$BRANCH" ] || sfail "branch actual: $GOT"
docker exec -u coder "$NAME" test -f /workspace/pom.xml || sfail "no hay pom.xml (clone incompleto)"

echo "== commit + push desde el contenedor"
docker exec -u coder "$NAME" bash -c "cd /workspace && echo smoke-$ID > smoke.txt && git add smoke.txt && git commit -qm 'test: smoke push' && git push -q origin $BRANCH"

if [ -n "$GH_TOKEN_LOCAL" ]; then
  echo "== branch existe en GitHub"
  CODE=$(curl -s -o /dev/null -w '%{http_code}' -H "Authorization: Bearer $GH_TOKEN_LOCAL" "https://api.github.com/repos/$REPO/branches/$BRANCH")
  [ "$CODE" = 200 ] || sfail "GitHub branch $BRANCH dio $CODE"
  echo "== CI disparado (workflow runs del branch)"
  sleep 8
  RUNS=$(curl -fsS -H "Authorization: Bearer $GH_TOKEN_LOCAL" "https://api.github.com/repos/$REPO/actions/runs?branch=$BRANCH" | jq .total_count)
  echo "runs=$RUNS"
  [ "$RUNS" -ge 1 ] || echo "WARN: sin corridas de CI (falta ci.yml en main del repo de examen)"
else
  echo "== branch existe en el upstream LOCAL (sin GITHUB_TOKEN: no se verifica GitHub ni CI)"
  git -C "/tmp/upstream/$REPO.git" show-ref --verify --quiet "refs/heads/$BRANCH" || sfail "el branch no llego al upstream local"
  git -C "/tmp/upstream/$REPO.git" show "refs/heads/$BRANCH:smoke.txt" | grep -q "smoke-$ID" || sfail "contenido del push"
fi

echo "== evento GIT_PUSH en la API"
curl -fsS "$B/api/sessions/$ID/events" | jq -e 'map(.type) | index("GIT_PUSH")' >/dev/null || sfail "GIT_PUSH"

echo "== ningun token de GitHub ni de session visible fuera del credential store"
if [ -n "$GH_TOKEN_LOCAL" ] && docker exec -u coder "$NAME" bash -c 'env; cat ~/.git-credentials ~/.gitconfig /workspace/.git/config 2>/dev/null' | grep -q "$GH_TOKEN_LOCAL"; then
  sfail "GITHUB_TOKEN encontrado en el contenedor"
fi
echo "OK smoke-git"

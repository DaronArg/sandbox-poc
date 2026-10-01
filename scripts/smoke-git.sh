#!/usr/bin/env bash
# Smoke T4: sesion -> docker run -> clone automatico -> commit+push -> GitHub + GIT_PUSH.
# Requiere backend en :9090 y la imagen assessment-runtime:poc (scripts/build-runtime.sh). Correr dentro de WSL.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
B="${BACKEND:-http://localhost:9090}"
fail() { echo "FAIL: $*"; exit 1; }
# Solo para consultar GitHub desde el script; nunca se imprime ni entra al contenedor.
GH_TOKEN_LOCAL="$(tr -d '\r' < "$ROOT/.env" | sed -n 's/^GITHUB_TOKEN=//p')"
REPO="$(tr -d '\r' < "$ROOT/.env" | sed -n 's/^GITHUB_REPO=//p')"

echo "== crear sesion"
R=$(curl -fsS -X POST "$B/api/sessions" -H 'Content-Type: application/json' -d '{"studentId":1,"examId":1}')
ID=$(echo "$R" | jq -r .sessionId)
CMD=$(echo "$R" | jq -r .dockerRun)
TOKEN=$(echo "$CMD" | sed -E 's/.*SESSION_TOKEN=([^ ]+).*/\1/')
BRANCH="session-$ID"
NAME="assessment-$ID"
echo "sessionId=$ID branch=$BRANCH"

# Puertos 8080/8081/4200 pueden estar ocupados por otro contenedor; liberar el nombre anterior si existe.
docker rm -f "$NAME" >/dev/null 2>&1 || true
docker volume rm "assessment_${ID}_workspace" >/dev/null 2>&1 || true

echo "== docker run (comando generado por el backend)"
RUN_CMD="${CMD/docker run --rm/docker run -d --rm}"
eval "$RUN_CMD" >/dev/null
cleanup() { docker rm -f "$NAME" >/dev/null 2>&1 || true; docker volume rm "assessment_${ID}_workspace" >/dev/null 2>&1 || true; }
trap cleanup EXIT

echo "== esperar clone + code-server"
for i in $(seq 1 60); do
  curl -fsS -o /dev/null http://localhost:8080/healthz 2>/dev/null && break
  docker ps -q -f "name=$NAME" | grep -q . || { docker logs "$NAME" 2>&1 | tail -20; fail "el contenedor murio"; }
  sleep 2
done
curl -fsS -o /dev/null http://localhost:8080/healthz || fail "code-server no responde"

echo "== /workspace tiene el repo en el branch $BRANCH"
GOT=$(docker exec "$NAME" git -C /workspace rev-parse --abbrev-ref HEAD)
[ "$GOT" = "$BRANCH" ] || fail "branch actual: $GOT"
docker exec "$NAME" test -f /workspace/pom.xml || fail "no hay pom.xml (clone incompleto)"

echo "== commit + push desde el contenedor"
docker exec "$NAME" bash -c "cd /workspace && echo smoke-$ID > smoke.txt && git add smoke.txt && git commit -qm 'test: smoke push' && git push -q origin $BRANCH"

echo "== branch existe en GitHub"
CODE=$(curl -s -o /dev/null -w '%{http_code}' -H "Authorization: Bearer $GH_TOKEN_LOCAL" "https://api.github.com/repos/$REPO/branches/$BRANCH")
[ "$CODE" = 200 ] || fail "GitHub branch $BRANCH dio $CODE"

echo "== evento GIT_PUSH en la API"
curl -fsS "$B/api/sessions/$ID/events" | jq -e 'map(.type) | index("GIT_PUSH")' >/dev/null || fail "GIT_PUSH"

echo "== CI disparado (workflow runs del branch)"
sleep 8
RUNS=$(curl -fsS -H "Authorization: Bearer $GH_TOKEN_LOCAL" "https://api.github.com/repos/$REPO/actions/runs?branch=$BRANCH" | jq .total_count)
echo "runs=$RUNS"
[ "$RUNS" -ge 1 ] || echo "WARN: sin corridas de CI (falta ci.yml en main del repo de examen, ver T3)"

echo "== el token de GitHub no esta en el contenedor"
if docker exec "$NAME" bash -c 'env; cat ~/.git-credentials ~/.gitconfig /workspace/.git/config 2>/dev/null; grep -rl "ghp_\|github_pat_\|gho_" /workspace/.git /home/coder 2>/dev/null || true' | grep -q "$GH_TOKEN_LOCAL"; then
  fail "GITHUB_TOKEN encontrado en el contenedor"
fi

echo "OK smoke-git"

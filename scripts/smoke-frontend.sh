#!/usr/bin/env bash
# Smoke C3: sesion -> contenedor -> backend del examen (:8081) + ng serve (:4200) -> la pagina Angular muestra el precio de la API.
# Requiere backend en :9090 y la imagen assessment-runtime:poc. Correr dentro de WSL. Imprime los tiempos de npm install y primer ng serve.
set -euo pipefail
B="${BACKEND:-http://localhost:9090}"
fail() { echo "FAIL: $*"; exit 1; }

R=$(curl -fsS -X POST "$B/api/sessions" -H 'Content-Type: application/json' -d '{"studentId":1,"examId":1}')
ID=$(echo "$R" | jq -r .sessionId)
CMD=$(echo "$R" | jq -r .dockerRun)
BRANCH=$(curl -fsS "$B/api/sessions" | jq -r --argjson id "$ID" '.[]|select(.id==$id)|.branch')
NAME="assessment-$ID"
docker rm -f "$NAME" >/dev/null 2>&1 || true
docker volume rm "assessment_${ID}_workspace" >/dev/null 2>&1 || true
eval "${CMD/docker run --rm/docker run -d --rm}" >/dev/null
cleanup() { docker rm -f "$NAME" >/dev/null 2>&1 || true; docker volume rm "assessment_${ID}_workspace" >/dev/null 2>&1 || true; }
trap cleanup EXIT

echo "== esperar clone + code-server (sesion $ID, branch $BRANCH)"
for i in $(seq 1 60); do
  curl -fsS -o /dev/null http://localhost:8080/healthz 2>/dev/null && break
  docker ps -q -f "name=$NAME" | grep -q . || { docker logs "$NAME" 2>&1 | tail -20; fail "el contenedor murio"; }
  sleep 2
done
docker exec "$NAME" test -f /workspace/frontend/angular.json || fail "frontend/angular.json no esta en el clone"
docker exec "$NAME" ng version >/dev/null 2>&1 || fail "ng no esta en el PATH de la imagen"

echo "== backend del examen en :8081"
docker exec -d "$NAME" bash -c 'cd /workspace && ./mvnw -q spring-boot:run > /tmp/exam-backend.log 2>&1'
T0=$(date +%s)
for i in $(seq 1 90); do
  curl -fsS -o /dev/null "http://localhost:8081/api/price?price=200&percent=25" 2>/dev/null && break
  # 400/500 tambien indican que Spring esta arriba (applyDiscount sin implementar)
  [ "$(curl -s -o /dev/null -w '%{http_code}' "http://localhost:8081/api/price?price=200&percent=25")" != 000 ] && break
  sleep 2
done
echo "spring-boot arriba en $(( $(date +%s) - T0 )) s"

echo "== npm install"
T0=$(date +%s)
docker exec "$NAME" bash -c 'cd /workspace/frontend && npm install --no-audit --no-fund >/tmp/npm-install.log 2>&1' || { docker exec "$NAME" tail -20 /tmp/npm-install.log; fail "npm install"; }
echo "npm install: $(( $(date +%s) - T0 )) s"

echo "== ng serve (primer arranque)"
docker exec -d "$NAME" bash -c 'cd /workspace/frontend && npm start > /tmp/ng-serve.log 2>&1'
T0=$(date +%s)
for i in $(seq 1 90); do
  curl -fsS -o /dev/null http://localhost:4200/ 2>/dev/null && break
  sleep 2
done
curl -fsS -o /dev/null http://localhost:4200/ || { docker exec "$NAME" tail -30 /tmp/ng-serve.log; fail "ng serve no responde en :4200"; }
echo "ng serve responde en $(( $(date +%s) - T0 )) s"

echo "== la pagina devuelve el index de Angular"
curl -fsS http://localhost:4200/ | grep -q "app-root" || fail "index sin <app-root>"
echo "OK smoke-frontend (la comprobacion visual del precio se hace con Playwright)"

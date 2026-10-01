#!/bin/bash
# Smoke del runtime standalone (sin SESSION_TOKEN): code-server detras del gate. Correr dentro de WSL.
set -e
cd "$(dirname "$0")/.."
NAME=smoke-runtime
VOL=smoke_runtime_workspace
IMG=assessment-runtime:poc

cleanup() { docker rm -f $NAME >/dev/null 2>&1 || true; }
trap cleanup EXIT
cleanup
docker volume rm -f $VOL >/dev/null 2>&1 || true

echo "== build"
bash scripts/build-runtime.sh >/dev/null

run() {
  docker run -d --init --rm --name $NAME --security-opt no-new-privileges \
    -p 127.0.0.1::7000 -p 127.0.0.1:8081:9081 -v $VOL:/workspace $IMG >/dev/null
  PORT=$(docker port $NAME 7000/tcp | head -1 | sed 's/.*://')
  for i in $(seq 1 60); do
    KEY=$(docker exec -u root $NAME cat /run/gate/key 2>/dev/null || true)
    [ -n "$KEY" ] && curl -fs -o /dev/null --resolve "ide.localhost:$PORT:127.0.0.1" -H "Cookie: assessment_gate=$KEY" "http://ide.localhost:$PORT/healthz" && return 0
    sleep 1
  done
  echo "code-server did not come up"; docker logs $NAME; exit 1
}

echo "== run + healthz detras del gate"
run
curl -fs --resolve "ide.localhost:$PORT:127.0.0.1" -H "Cookie: assessment_gate=$KEY" "http://ide.localhost:$PORT/healthz"; echo
test "$(curl -s -o /dev/null -w '%{http_code}' --resolve "ide.localhost:$PORT:127.0.0.1" "http://ide.localhost:$PORT/healthz")" = 403 && echo "sin cookie -> 403"
echo "== 8080 y 4200 no se publican"
docker port $NAME | grep -E ':(8080|4200)' && { echo "puerto publicado de mas"; exit 1; } || echo "solo 7000 y 9081 publicados"
IP=$(docker inspect -f '{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}' $NAME)
curl -s -o /dev/null --max-time 3 "http://$IP:8080/healthz" && { echo "code-server accesible por la IP del contenedor"; exit 1; } || echo "code-server no escucha fuera de 127.0.0.1"

echo "== tools"
docker exec -u coder $NAME bash -c 'java -version 2>&1 | head -1; mvn -v | head -1; echo node $(node -v); git --version'
docker exec -u coder $NAME java -version 2>&1 | grep -q '"21' || { echo "java is not 21"; exit 1; }

echo "== extensions"
EXT="$(docker exec -u coder $NAME code-server --list-extensions)"
echo "$EXT"
echo "$EXT" | grep -qi 'vscjava.vscode-java-pack' || { echo "missing java pack"; exit 1; }
echo "$EXT" | grep -qi 'continue.continue' || { echo "missing continue"; exit 1; }
echo "$EXT" | grep -qi 'humao.rest-client' || { echo "missing rest client"; exit 1; }

echo "== persistence"
docker exec -u coder $NAME bash -c 'echo persisted > /workspace/smoke.txt'
docker rm -f $NAME >/dev/null
run
test "$(docker exec -u coder $NAME cat /workspace/smoke.txt)" = "persisted" && echo "file survived recreate"

cleanup
docker volume rm -f $VOL >/dev/null
echo "SMOKE RUNTIME OK"

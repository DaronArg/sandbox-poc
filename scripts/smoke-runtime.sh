#!/bin/bash
# Run inside WSL. Verifies T1 (runtime standalone).
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
bash scripts/build-runtime.sh

run() {
  docker run -d --rm --name $NAME \
    -p 127.0.0.1:8080:8080 -p 127.0.0.1:8081:8081 -p 127.0.0.1:4200:4200 \
    -v $VOL:/workspace $IMG >/dev/null
  for i in $(seq 1 60); do
    curl -fs -o /dev/null http://localhost:8080/healthz && return 0
    sleep 1
  done
  echo "code-server did not come up"; docker logs $NAME; exit 1
}

echo "== run + curl"
run
curl -fs http://localhost:8080/healthz; echo

echo "== tools"
docker exec $NAME bash -c 'java -version 2>&1 | head -1; mvn -v | head -1; echo node $(node -v); git --version'
docker exec $NAME java -version 2>&1 | grep -q '"21' || { echo "java is not 21"; exit 1; }

echo "== extensions"
EXT="$(docker exec $NAME code-server --list-extensions)"
echo "$EXT"
echo "$EXT" | grep -qi 'vscjava.vscode-java-pack' || { echo "missing java pack"; exit 1; }
echo "$EXT" | grep -qi 'continue.continue' || { echo "missing continue"; exit 1; }

echo "== persistence"
docker exec $NAME bash -c 'echo persisted > /workspace/smoke.txt'
docker rm -f $NAME >/dev/null
run
test "$(docker exec $NAME cat /workspace/smoke.txt)" = "persisted" && echo "file survived recreate"

cleanup
docker volume rm -f $VOL >/dev/null
echo "SMOKE RUNTIME OK"

#!/usr/bin/env bash
# Helpers compartidos por los smoke tests (dentro de WSL). Se usa con `source`.
# start_session [studentId] -> crea la sesion (con X-Desktop-Version) y levanta el contenedor con el docker run de
# design.md §6.4. Exporta: ID TOKEN NAME VOL BRANCH PORT (puerto host del gate). KEY se lee con gate_key.
# Nunca imprime TOKEN ni la clave del gate.
B="${BACKEND:-http://localhost:9090}"
DESKTOP_VERSION="${DESKTOP_VERSION:-0.1.0}"
ROOT="${ROOT:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"

sfail() { echo "FAIL: $*"; exit 1; }

# Sin GITHUB_TOKEN en .env no hay acceso a GitHub: se usa el upstream git local (scripts/local-upstream.sh).
ensure_upstream() {
  if ! grep -q '^GITHUB_TOKEN=.\+' "$ROOT/.env" 2>/dev/null; then
    if ! curl -fsS -o /dev/null "http://localhost:9418/$(tr -d '\r' < "$ROOT/.env" | sed -n 's/^GITHUB_REPO=//p').git/info/refs?service=git-upload-pack"; then
      "$ROOT/scripts/local-upstream.sh" up >/dev/null
      "$ROOT/scripts/restart-backend.sh" >/dev/null
    fi
  fi
}

start_session() {
  local student="${1:-1}"
  ensure_upstream
  local r
  r=$(curl -fsS -X POST "$B/api/sessions" -H 'Content-Type: application/json' -H "X-Desktop-Version: $DESKTOP_VERSION" \
      -d "{\"studentId\":$student,\"examId\":1}") || sfail "no pude crear la sesion"
  ID=$(echo "$r" | jq -r .sessionId); TOKEN=$(echo "$r" | jq -r .token)
  NAME=$(echo "$r" | jq -r .containerName); VOL=$(echo "$r" | jq -r .volume); BRANCH=$(echo "$r" | jq -r .branch)
  local image url
  image=$(echo "$r" | jq -r .image); url=$(echo "$r" | jq -r .containerBackendUrl)
  docker rm -f "$NAME" >/dev/null 2>&1 || true
  docker run -d --init --rm --name "$NAME" --security-opt no-new-privileges \
    -p 127.0.0.1::7000 -p 127.0.0.1:8081:9081 --add-host=host.docker.internal:host-gateway \
    -e SESSION_ID="$ID" -e SESSION_TOKEN="$TOKEN" -e BACKEND_URL="$url" \
    -v "$VOL":/workspace "$image" >/dev/null || sfail "docker run fallo"
  PORT=$(docker port "$NAME" 7000/tcp | head -1 | sed 's/.*://')
  export ID TOKEN NAME VOL BRANCH PORT
  trap 'stop_session' EXIT
  echo "sessionId=$ID container=$NAME gatePort=$PORT"
}

gate_key() { docker exec -u root "$NAME" cat /run/gate/key; }

# Espera a que code-server responda por el gate (con cookie). Falla si el contenedor muere.
wait_ide() {
  local key; key=$(gate_key 2>/dev/null || true)
  for _ in $(seq 1 90); do
    key=$(gate_key 2>/dev/null || true)
    if [ -n "$key" ] && [ "$(curl -s -o /dev/null -w '%{http_code}' --resolve "ide.localhost:$PORT:127.0.0.1" \
        -H "Cookie: assessment_gate=$key" "http://ide.localhost:$PORT/healthz")" = 200 ]; then return 0; fi
    docker ps -q -f "name=^${NAME}$" | grep -q . || { docker logs "$NAME" 2>&1 | tail -30; sfail "el contenedor murio"; }
    sleep 2
  done
  docker logs "$NAME" 2>&1 | tail -30
  sfail "el IDE no respondio por el gate"
}

stop_session() {
  [ -n "${NAME:-}" ] || return 0
  docker rm -f "$NAME" >/dev/null 2>&1 || true
  [ -n "${VOL:-}" ] && docker volume rm "$VOL" >/dev/null 2>&1 || true
}

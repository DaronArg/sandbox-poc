#!/usr/bin/env bash
# Exporta el .env de la raiz y corre el backend en :9090 (ejecutar dentro de WSL).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
if [ -f "$ROOT/.env" ]; then
  set -a
  # shellcheck disable=SC1091
  . <(tr -d '\r' < "$ROOT/.env")
  set +a
fi
[ -f /tmp/upstream/.active ] && export GIT_UPSTREAM_BASE=http://localhost:9418
cd "$ROOT/backend"
exec ./mvnw spring-boot:run

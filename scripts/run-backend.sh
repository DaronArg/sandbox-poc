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
# RUNTIME_IMAGE (en .env o exportada) cambia la imagen; por defecto el backend usa ghcr.io/daronarg/assessment-runtime:poc.
cd "$ROOT/backend"
exec ./mvnw spring-boot:run

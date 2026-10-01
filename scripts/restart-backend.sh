#!/usr/bin/env bash
# Reinicia el backend en background (dentro de WSL) y espera a que responda en :9090.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
pkill -f 'com.example.backend.BackendApplication' 2>/dev/null || true
pkill -f 'spring-boot:run' 2>/dev/null || true
for _ in $(seq 1 20); do
  curl -s -o /dev/null http://localhost:9090/api/exams || break
  sleep 1
done
setsid nohup "$ROOT/scripts/run-backend.sh" > /tmp/backend.log 2>&1 < /dev/null &
for _ in $(seq 1 90); do
  if curl -s -o /dev/null http://localhost:9090/api/exams; then echo "backend arriba"; exit 0; fi
  sleep 2
done
echo "el backend no levanto; ver /tmp/backend.log" >&2
tail -20 /tmp/backend.log >&2
exit 1

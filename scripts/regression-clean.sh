#!/usr/bin/env bash
# Regresion "desde cero" (dentro de WSL): sin contenedores ni volumenes de sesion, DB del backend nueva, imagen reconstruida
# sin cache y todos los smokes. Resumen al final; el detalle queda en /tmp/regression.log.
cd "$(dirname "$0")/.."
docker ps -aq | xargs -r docker rm -f >/dev/null
docker volume ls -q | grep -E '^(assessment_|smoke_)' | xargs -r docker volume rm >/dev/null
pkill -f com.example.backend.BackendApplication 2>/dev/null
pkill -f spring-boot:run 2>/dev/null
sleep 2
rm -rf backend/data
echo "== imagen sin cache"
docker build --no-cache -t assessment-runtime:poc runtime > /tmp/build-clean.log 2>&1
echo "build_rc=$?"; tail -1 /tmp/build-clean.log
./scripts/restart-backend.sh
TAIL=15 ./scripts/smoke-all.sh backend runtime gate git telemetry ai exam > /tmp/regression.log 2>&1
echo "smoke_rc=$?"
grep -E '^(>>>|SMOKE RUNTIME|OK )' /tmp/regression.log

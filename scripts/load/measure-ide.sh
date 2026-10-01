#!/usr/bin/env bash
# Con la IDE abierta en un navegador (open-ide.mjs): muestrea el contenedor mientras arranca el language server de Java y luego en regimen.
set -euo pipefail
cd "$(dirname "$0")"
. /tmp/measure-container.state
./measure-container.sh sample ide-java-warmup 60
echo "procesos por RSS (KB) en el contenedor:"
docker exec "$NAME" ps -eo rss,args --sort=-rss | head -6 | cut -c1-140
./measure-container.sh sample ide-java-steady 40

#!/usr/bin/env bash
# Con la IDE + Java LS abiertos: levanta Spring Boot + npm install + ng serve dentro del contenedor y mide pico y regimen.
set -euo pipefail
cd "$(dirname "$0")"
./measure-container.sh sample stack-peak 75 &
SP=$!
./measure-container.sh load
wait $SP
./measure-container.sh sample stack-steady 40
. /tmp/measure-container.state
echo "procesos por RSS (KB):"; docker exec "$NAME" ps -eo rss,args --sort=-rss | head -7 | cut -c1-120

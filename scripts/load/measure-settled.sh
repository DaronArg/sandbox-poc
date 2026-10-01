#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"
sleep 60
./measure-container.sh sample stack-settled 40
. /tmp/measure-container.state
docker exec "$NAME" ps -eo rss,pcpu,args --sort=-pcpu | head -5 | cut -c1-110

#!/usr/bin/env bash
# Levanta un tunel rapido de Cloudflare hacia el backend (:9090) y escribe la URL publica en /tmp/tunnel.url.
# El backend NO tiene autenticacion de usuarios: dejar el tunel arriba solo durante la prueba.
# Uso: ./scripts/tunnel.sh up | down | status   (dentro de WSL). No commitear ni publicar la URL.
set -euo pipefail
PORT="${PORT:-9090}"
LOG=/tmp/cloudflared.log
URLF=/tmp/tunnel.url
case "${1:-up}" in
  up)
    command -v cloudflared >/dev/null || { echo "falta cloudflared (ver README)"; exit 1; }
    pgrep -x cloudflared >/dev/null && { echo "ya hay un tunel: $(cat $URLF 2>/dev/null)"; exit 0; }
    rm -f "$URLF"; : > "$LOG"
    setsid nohup cloudflared tunnel --no-autoupdate --protocol http2 --url "http://localhost:$PORT" > "$LOG" 2>&1 &
    for _ in $(seq 1 60); do
      U=$(grep -Eo 'https://[a-z0-9-]+\.trycloudflare\.com' "$LOG" | head -1 || true)
      if [ -n "$U" ]; then echo "$U" > "$URLF"; echo "$U"; exit 0; fi
      sleep 1
    done
    echo "el tunel no dio URL (ver $LOG)"; exit 1 ;;
  down)
    pkill -x cloudflared || true
    sleep 1
    rm -f "$URLF"
    pgrep -x cloudflared >/dev/null && { echo "cloudflared sigue vivo"; exit 1; }
    echo "tunel abajo" ;;
  status)
    pgrep -x cloudflared >/dev/null && echo "arriba: $(cat $URLF 2>/dev/null)" || echo "abajo" ;;
esac

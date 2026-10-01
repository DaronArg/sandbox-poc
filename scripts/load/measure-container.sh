#!/usr/bin/env bash
# Mide el contenedor del alumno (correr dentro de WSL, backend en :9090, imagen local).
#   measure-container.sh image                 -> tamano en disco y comprimido de la imagen (proxy: docker save | gzip)
#   measure-container.sh start                 -> sesion nueva, arranque en frio (marcas de tiempo) y reposo (docker stats)
#   measure-container.sh sample <label> <secs> -> docker stats cada 2 s durante <secs> s, imprime promedio y maximo
#   measure-container.sh load                  -> spring-boot:run (:8081) + npm install + ng serve (:4200) dentro del contenedor, con tiempos
#   measure-container.sh stop                  -> baja contenedor y volumen
set -euo pipefail
B="${BACKEND:-http://localhost:9090}"
IMAGE="${RUNTIME_IMAGE:-assessment-runtime:poc}"
STATE=/tmp/measure-container.state
now() { date +%s.%N; }
el() { awk -v a="$1" -v b="$2" 'BEGIN{printf "%.1f", b-a}'; }

stats_line() { docker stats --no-stream --format '{{.CPUPerc}} {{.MemUsage}}' "$NAME" | awk '{gsub("%","",$1); m=$2; u=m; sub(/[A-Za-z]+$/,"",m); if (u ~ /GiB/) m*=1024; if (u ~ /KiB/) m/=1024; print $1, m}'; }

case "${1:-}" in
image)
  echo "disk_bytes=$(docker image inspect -f '{{.Size}}' "$IMAGE")"
  T0=$(now); GZ=$(docker save "$IMAGE" | gzip -1 | wc -c); echo "compressed_bytes_gzip1=$GZ (docker save | gzip -1; $(el "$T0" "$(now)") s)"
  docker history --no-trunc --format '{{.Size}}\t{{.CreatedBy}}' "$IMAGE" | awk -F'\t' '{print $1 "\t" substr($2,1,90)}' | head -12
  ;;
start)
  R=$(curl -fsS -X POST "$B/api/sessions" -H 'Content-Type: application/json' -d '{"studentId":1,"examId":1}')
  ID=$(echo "$R" | jq -r .sessionId); CMD=$(echo "$R" | jq -r .dockerRun); NAME="assessment-$ID"
  docker rm -f "$NAME" >/dev/null 2>&1 || true; docker volume rm "assessment_${ID}_workspace" >/dev/null 2>&1 || true
  echo "NAME=$NAME" > "$STATE"; echo "ID=$ID" >> "$STATE"
  T0=$(now)
  eval "${CMD/docker run --rm/docker run -d --rm}" >/dev/null
  T_HEALTH=""; T_CLONE=""; T_AGENT=""
  for i in $(seq 1 600); do
    [ -z "$T_HEALTH" ] && curl -fsS -o /dev/null http://localhost:8080/healthz 2>/dev/null && T_HEALTH=$(now)
    LOG=$(docker logs "$NAME" 2>&1 || true)
    [ -z "$T_CLONE" ] && echo "$LOG" | grep -q "configuring Continue" && T_CLONE=$(now)
    [ -z "$T_AGENT" ] && echo "$LOG" | grep -q "starting telemetry agent" && T_AGENT=$(now)
    [ -n "$T_HEALTH" ] && [ -n "$T_CLONE" ] && [ -n "$T_AGENT" ] && break
    sleep 0.25
  done
  echo "cold_start: clone_done=$(el "$T0" "$T_CLONE") s  telemetry_agent_started=$(el "$T0" "$T_AGENT") s  code_server_healthz=$(el "$T0" "$T_HEALTH") s"
  echo "workbench_http=$(curl -s -o /dev/null -w '%{http_code} in %{time_total}s' 'http://localhost:8080/?folder=/workspace')"
  echo "idle (code-server sin cliente, 30 s):"
  "$0" sample idle 30
  ;;
sample)
  . "$STATE"; LABEL=$2; SECS=$3; OUT=/tmp/measure-$LABEL.csv; : > "$OUT"
  END=$(( $(date +%s) + SECS ))
  while [ "$(date +%s)" -lt "$END" ]; do echo "$(date +%s) $(stats_line)" >> "$OUT"; sleep 1; done
  awk -v l="$LABEL" '{n++; c+=$2; m+=$3; if($2>cm)cm=$2; if($3>mm)mm=$3} END{printf "%s: samples=%d cpu_avg=%.0f%% cpu_max=%.0f%% mem_avg=%.0f MiB mem_max=%.0f MiB (100%% cpu = 1 core)\n", l,n,c/n,cm,m/n,mm}' "$OUT"
  ;;
load)
  . "$STATE"
  docker exec -d "$NAME" bash -c 'cd /workspace && ./mvnw -q spring-boot:run > /tmp/exam-backend.log 2>&1'
  T0=$(now)
  for i in $(seq 1 240); do
    [ "$(curl -s -o /dev/null -w '%{http_code}' 'http://localhost:8081/api/price?price=200&percent=25')" != 000 ] && break
    sleep 0.5
  done
  echo "spring_boot_ready=$(el "$T0" "$(now)") s"
  T0=$(now); docker exec "$NAME" bash -c 'cd /workspace/frontend && npm install --no-audit --no-fund >/tmp/npm-install.log 2>&1'
  echo "npm_install=$(el "$T0" "$(now)") s"
  docker exec -d "$NAME" bash -c 'cd /workspace/frontend && npm start > /tmp/ng-serve.log 2>&1'
  T0=$(now)
  for i in $(seq 1 240); do curl -fsS -o /dev/null http://localhost:4200/ 2>/dev/null && break; sleep 0.5; done
  echo "ng_serve_first_response=$(el "$T0" "$(now)") s"
  ;;
stop)
  . "$STATE"; docker rm -f "$NAME" >/dev/null 2>&1 || true; docker volume rm "assessment_${ID}_workspace" >/dev/null 2>&1 || true
  rm -f "$STATE"; echo stopped
  ;;
*) echo "uso: $0 image|start|sample <label> <secs>|load|stop"; exit 1 ;;
esac

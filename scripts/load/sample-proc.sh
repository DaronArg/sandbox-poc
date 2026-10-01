#!/usr/bin/env bash
# Muestrea CPU (100% = 1 core) y RSS (MB) de un PID cada INTERVAL s desde /proc. Salida: "epoch cpu_pct rss_mb".
# Uso: sample-proc.sh <pid> <interval_s> <outfile>   (corre hasta que el PID muere o lo matan)
PID=$1; INT=${2:-2}; OUT=$3
HZ=$(getconf CLK_TCK)
prev=$(awk '{print $14+$15}' /proc/$PID/stat); pt=$(date +%s.%N)
: > "$OUT"
while kill -0 "$PID" 2>/dev/null; do
  sleep "$INT"
  cur=$(awk '{print $14+$15}' /proc/$PID/stat 2>/dev/null) || break
  now=$(date +%s.%N)
  rss=$(awk '/VmRSS/{print $2}' /proc/$PID/status 2>/dev/null) || break
  awk -v c="$cur" -v p="$prev" -v n="$now" -v t="$pt" -v hz="$HZ" -v rss="$rss" 'BEGIN{printf "%.1f %.1f %.1f\n", n, (c-p)/hz/(n-t)*100, rss/1024}' >> "$OUT"
  prev=$cur; pt=$now
done

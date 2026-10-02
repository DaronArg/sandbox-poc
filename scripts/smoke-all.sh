#!/usr/bin/env bash
# Corre los smokes en orden (dentro de WSL) y resume. Uso: scripts/smoke-all.sh [nombres...]  (default: todos)
cd "$(dirname "$0")/.."
LIST=("$@")
[ ${#LIST[@]} -eq 0 ] && LIST=(backend runtime gate git telemetry ai submit)
RC=0
for s in "${LIST[@]}"; do
  echo "######## smoke-$s"
  if ./scripts/smoke-$s.sh 2>&1 | tail -${TAIL:-25}; [ "${PIPESTATUS[0]}" = 0 ]; then echo ">>> $s: OK"; else echo ">>> $s: FALLO"; RC=1; fi
done
exit $RC

#!/bin/bash
set -e

if [ -z "$SESSION_TOKEN" ]; then
  echo "[bootstrap] standalone mode (no SESSION_TOKEN): starting code-server only"
  exec code-server --auth none --bind-addr 0.0.0.0:8080 /workspace
fi

# Full session mode: implemented in T4.
echo "[bootstrap] session mode not implemented yet" >&2
exit 1

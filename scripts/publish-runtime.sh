#!/usr/bin/env bash
# Publica la imagen del runtime en GHCR (paquete privado). Correr dentro de WSL.
# Requiere un token de gh con scope write:packages: gh auth refresh -h github.com -s write:packages
set -euo pipefail
LOCAL=assessment-runtime:poc
REMOTE="${RUNTIME_IMAGE:-ghcr.io/daronarg/assessment-runtime:poc}"
USER_GH="$(gh api user -q .login)"
gh auth status 2>&1 | grep -q "write:packages" || { echo "FAIL: el token de gh no tiene write:packages"; exit 1; }
gh auth token | docker login ghcr.io -u "$USER_GH" --password-stdin
docker tag "$LOCAL" "$REMOTE"
docker push "$REMOTE"
echo "OK publicada $REMOTE (por defecto el paquete queda privado; verificar en github.com/users/$USER_GH/packages)"

#!/usr/bin/env bash
# Publica la imagen del runtime en GHCR (paquete privado). Correr dentro de WSL.
# Requiere un token de gh con scope write:packages: gh auth refresh -h github.com -s write:packages
set -euo pipefail
LOCAL=assessment-runtime:poc
REMOTE="${RUNTIME_IMAGE:-ghcr.io/daronarg/assessment-runtime:poc}"
# Token/usuario: GHCR_TOKEN y GHCR_USER si estan definidos (gh puede no estar instalado en WSL); si no, gh.
USER_GH="${GHCR_USER:-$(gh api user -q .login)}"
if [ -z "${GHCR_TOKEN:-}" ]; then
  gh auth status 2>&1 | grep -q "write:packages" || { echo "FAIL: el token de gh no tiene write:packages"; exit 1; }
  GHCR_TOKEN="$(gh auth token)"
fi
printf '%s' "$GHCR_TOKEN" | docker login ghcr.io -u "$USER_GH" --password-stdin
docker tag "$LOCAL" "$REMOTE"
docker push "$REMOTE"
echo "OK publicada $REMOTE (por defecto el paquete queda privado; verificar en github.com/users/$USER_GH/packages)"

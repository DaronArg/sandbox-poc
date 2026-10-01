# Apply progress — desktop-electron

## Entorno (E0, antes de E1)

La máquina donde se aplicó la spec NO coincide con lo que asumen los docs previos:

- WSL `Ubuntu` 24.04, usuario `joaquin`, distro en su ubicación por defecto (no está en `E:\wsl`). Sin Docker ni JDK: se instalaron Docker Engine 29.8.2 (`get.docker.com`, systemd) y `openjdk-21-jdk-headless` (apt) + `jq`. `/usr/bin/docker` era un symlink a Docker Desktop (inexistente) y `dpkg` estaba interrumpido: `dpkg --configure -a` y reinstalar.
- El repo está en `D:\...\sandbox-poc`; dentro de WSL se accede con el symlink `~/sandbox-poc` → `/mnt/d/.../sandbox-poc` (los docs mencionan `/mnt/f/repos/tpi-tup/sandbox-poc`, que no existe aquí).
- No había `.env`. Se creó SIN secretos (solo `GITHUB_REPO`, `AI_CHAT_MODEL`, `AI_AUTOCOMPLETE_MODEL`). **No hay `ANTHROPIC_API_KEY` ni `GITHUB_TOKEN`.**
- `gh` está logueado como `JoaquinBenegas2`, que no ve `DaronArg/assessment-exam-template` (repo inexistente/sin acceso). El repo git no tiene remoto `origin`.
  - Consecuencia: `git push origin feat/desktop-electron` no es posible (se omite en cada task) y todo lo que depende de GitHub real (proxy git contra GitHub, publicar el repo de examen, CI) o de Anthropic (Continue/AI gateway) queda sin verificar contra el servicio real. Los planes de sustitución locales se anotan en cada task.

## E1 — Backend
- H2 en archivo (`backend/data/`), `schema.sql` con `IF NOT EXISTS`, `data.sql` con `MERGE ... KEY(id)`.
- `POST /api/sessions` con contrato nuevo (sin `dockerRun`), `status`, `desktop-events`, `nextSequence`, 426 con JSON `{error,minVersion}`; `index.html` es el aviso.
- Decisión: el 426 se resuelve con un `@ExceptionHandler` propio (JSON); la versión se chequea antes que el token en `status`.
- Se agregó `scripts/restart-backend.sh` (lo usa `smoke-backend.sh` para el paso de reinicio).
- Verificación: `scripts/smoke-backend.sh` en WSL → `OK smoke-backend` (incluye reinicio real del backend con sesión y eventos conservados).

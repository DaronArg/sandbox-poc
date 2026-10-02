# Integración app de escritorio — Apply progress

## I1 — Merge e integración de backend, runtime y scripts (2026-10-02)

Hecho: `git merge origin/feat/desktop-electron` sobre `feat/desktop-integration`, 13 conflictos resueltos como unión.

Decisiones (lo más simple):
- **Backend:** contrato de escritorio de la rama Electron (inserción con `GeneratedKeyHolder`, sufijo hex con `SecureRandom`, `containerName`/`volume`/`image`/`containerBackendUrl`, `status`, `desktop-events`, 426). Se descartó el string `dockerRun` (nada depende de él). Se conservan `submit`, `COMPLETED`, `final_sha`, `GET /result`, `RUNTIME_IMAGE` y `PUBLIC_URL` (este último es el default de `containerBackendUrl` si no hay `CONTAINER_BACKEND_URL`).
- **Esquema H2:** un solo `schema.sql` (columnas `container_name`, `volume`, `final_sha`) más `ALTER TABLE ... ADD COLUMN IF NOT EXISTS` para migrar bases ya existentes (sin esto la base de `backend/data/` de la POC daba 500 al crear sesión). Seeds con `MERGE ... KEY(id)`; `AUTO_SERVER=TRUE` en la URL de H2.
- **Runtime:** `bootstrap.sh` + `session.sh` (gate, dos usuarios, dos etapas) de Electron; `submit` en `/usr/local/bin/submit`, Angular CLI 20, handler `SIGUSR1` (flush para submit) junto al de `SIGTERM` en `telemetry/agent.js`. `session.sh` toma el esquema de `BACKEND_URL` para `.git-credentials`.
- **Retirado (flujo web):** `demo/`, `scripts/smoke-remote.sh`, `scripts/tunnel.sh`, `scripts/load/measure-*.sh`, `scripts/load/open-ide.mjs` (medían el flujo web anterior; los números siguen en `docs/feasibility-report.md`). `scripts/load/telemetry-load.js` adaptado al contrato nuevo (`token`, `X-Desktop-Version`).
- **Examen:** `exam-template/frontend/main.js` y `vite.config.js` eliminados (el front canónico es Angular). Pendiente para I2: `smoke-exam.sh` y `smoke-frontend.sh` todavía asumen el flujo viejo (Vite / `dockerRun`) y NO están en `smoke-all.sh` hasta que I2 los actualice.
- **Scripts:** `smoke-submit.sh` reescrito sobre `lib-session.sh` (contenedor lanzado como lo hará la app); `smoke-all.sh` corre `backend runtime gate git telemetry ai submit`; `smoke-runtime.sh` verifica `submit` y `ng` en el PATH. `README.md` unificado (provisorio; el definitivo es de I4).

Verificación (todo ejecutado):
- Backend compila y arranca (`restart-backend.sh`), `POST /api/sessions` devuelve el contrato nuevo.
- Imagen `assessment-runtime:poc` reconstruida local (`build-runtime.sh`); NO publicada en GHCR.
- `smoke-all.sh`: backend, runtime, gate, git (contra GitHub real, 1 corrida de CI), telemetry, ai (API key real, respuesta `pong`), submit (SHA final existe en GitHub, push posterior 401) — todos OK.
- `desktop/`: `npm ci` OK, `npm test` (incluye build tsc) 5/5.

Gotchas:
- Un `/tmp/upstream/.active` viejo (de `local-upstream.sh up`) hace que `run-backend.sh` apunte el proxy git a `localhost:9418` y todo clone dé 500; se borró. Con `GITHUB_TOKEN` en `.env` no hace falta el upstream local.
- `smoke-git.sh` y `smoke-submit.sh` dejan branches `session-*` en el repo de examen (smoke-submit borra los suyos; smoke-git no): limpiar en I4.

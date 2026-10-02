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

## I2 — Examen Angular con rutas relativas (2026-10-02)

Hecho:
- `exam-template/frontend`: `app.ts` llama a `/api/price` (sin host); `proxy.conf.json` (`/api` -> `localhost:8081`) registrado en `angular.json` (`serve.options.proxyConfig`); `npm start` ya era `ng serve --host 0.0.0.0 --port 4200`. Sin `@CrossOrigin` en el backend del examen. README del examen actualizado (`npm start`).
- Publicado en `main` de `DaronArg/assessment-exam-template` (commit 6092d69, solo los archivos cambiados, LF; `.github/workflows/ci.yml` intacto).
- App: textos `npm run dev` -> `npm start` en `desktop/src/renderer/shell.html` y `runtime/gate/gate.js` (la detección de la pestaña App es por 200 en `:4200`, no asume Vite). E2E de `desktop/e2e/` actualizados (e5: edita `src/app/app.ts` en vez de `index.html`).
- Scripts: `smoke-exam.sh` reescrito para Angular y ahora además implementa `applyDiscount` en el workspace y exige `finalPrice == 150` por `app.localhost/api`; `smoke-frontend.sh` eliminado (lo cubre smoke-exam); `smoke-exam` agregado a `smoke-all.sh`. Nuevo `desktop/e2e/i2-check.js`.

Decisiones: el comando `ng serve` no necesitó `allowedHosts` (`app.localhost` pasa). Se publicó con LF porque la copia de trabajo en Windows es CRLF y generaba ruido en el diff.

Verificación (ejecutada): `smoke-exam.sh` OK (clone de GitHub real, 4 tests fallan a propósito, ng serve 200 por el gate, `/api` relativo llega a Spring, tras implementar `applyDiscount` -> `finalPrice:150.0`, curl.exe desde Windows 200). `i2-check.js` con la app Electron real: sesión desde el formulario, spring-boot:run + npm install + npm start -> la pestaña App muestra "Precio final: $150" (`qa-evidence/i2-app-precio-final.png`); app cerrada, sin contenedores. `desktop/` `npm test` en verde.
Nota: `smoke-exam`/`smoke-git` dejan branches `session-*` en el repo de examen (limpiar en I4).

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

## I3 — Entregar, pull de imagen y arreglo del bypass (2026-10-02)

Hecho:
- **Entregar:** botón en la barra → confirmación → pantalla "Entregando…" → `docker exec -u coder <c> submit` (flush de telemetría de la app antes) → pantalla "Entrega registrada" con el SHA (parseado de la salida de `submit`), contenedor apagado, `clearSession()` y cookies del gate borradas. Si `submit` falla no se registra nada: vuelve al workspace con un cuadro de error. `GET /status` de una sesión COMPLETED da 401, así que `getSaved` tampoco la ofrece aunque quedara guardada. El evento `SUBMISSION_COMPLETED` lo emite el backend.
- **Pull:** paso `image` hace `docker pull` si la imagen no está local (detalle "Descargando la imagen…"); si falla, mensaje claro (login al registry en WSL o build local) + últimas líneas del error. Timeout 15 min.
- **Bypass CDP:** `index.ts` rechaza `^(--?|/)(remote-debugging|inspect|remote-allow-origins)` sin distinguir mayúsculas y consulta `app.commandLine.hasSwitch` de 7 switches. `e7-check.js` suma 9 variantes + `--remote-allow-origins`.
- **GHCR:** `scripts/publish-runtime.sh` (con `GHCR_TOKEN`/`GHCR_USER` desde `gh auth token`) publicó `ghcr.io/daronarg/assessment-runtime:poc` (digest sha256:9fa13033…, imagen integrada con `submit`). Paquete privado.
- Nuevo `desktop/e2e/i3-check.js` (`SKIP_PULL=1` para reintentar sin re-bajar 3.8 GB).

Bug real encontrado al verificar: tras entregar, `closing` quedaba en `true` y "Cerrar" no salía (la app quedaba colgada). Arreglado en `controller.submit`.

Verificación (ejecutada): `e7-check.js` sobre `dist/win-unpacked/Assessment.exe`: todas las variantes (`-`, `/`, mayúsculas, `--inspect[-brk]`, `--remote-allow-origins`) → app sale con código 1, ningún puerto abierto; tampering del asar sigue OK. `i3-check.js` con la app real: se borró la imagen local, la app la bajó de GHCR (3.79 GB) y arrancó; Entregar → API COMPLETED, finalSha == SHA de pantalla, SHA existe en GitHub, SUBMISSION_COMPLETED, contenedor apagado, `git-receive-pack` y telemetría → 401, reabrir la app no ofrece "Retomar". Evidencia `qa-evidence/i3-*.png`. `npm test` de `desktop/` 5/5. Backend vuelto a su config por defecto (sin `RUNTIME_IMAGE`); local `assessment-runtime:poc` re-etiquetada desde GHCR.

Pendiente/notas: el instalador/`win-unpacked` se reconstruye en I4 (el actual no incluye el fix de `closing`, que no afecta e7). Quedan en el repo de examen branches `session-26-*` y `session-27-*` de corridas interrumpidas: limpiar en I4.

## I4 — QA final sobre Electron (2026-10-02)

Hecho: `desktop/e2e/i4-check.js` (recorrido DoD con la app real y credenciales reales), README unificado, `qa-manual-report.md` con evidencia en `qa-evidence/i4-*`. Todo en verde: DoD 1–10 (ver reporte), `smoke-all.sh` 8/8, `npm test` 5/5, instalador construido, `e7-check.js` sobre el `win-unpacked` nuevo OK.

Decisiones/gotchas:
- No hubo bugs de producto nuevos; los tropiezos fueron del script: `~/sandbox-poc` no existe en WSL (se usa `/mnt/f/...`), y el push contra GitHub real tarda ~2 min con la máquina cargada (espera ampliada). Se detienen spring-boot/ng serve antes del push y se reutiliza la primera terminal (la 3ra nueva quedaba sin prompt).
- Continue se maneja por CDP clickeando el input del sidebar (el webview no es target propio); se verifica por `AI_PROMPT`/`AI_RESPONSE` en la API.
- `i4-check.js` borra los branches `session-*` del repo de examen al final.

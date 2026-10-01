
## T0 — Entorno y scaffold
- WSL `Ubuntu` (26.04) movida a `E:\wsl\Ubuntu` (`wsl --manage --move`); `ext4.vhdx` verificado ahí.
- Docker 29.8.2 (get.docker.com, systemd) y OpenJDK 21 (apt) en WSL; usuario `daron` agregado al grupo `docker`. `~/.wslconfig` con `vmIdleTimeout=-1`.
- `.env` completado (GITHUB_TOKEN de la cuenta DaronArg, GITHUB_REPO, modelos). `ANTHROPIC_API_KEY` ya existía y no se tocó.
- Scaffold: carpetas con `.gitkeep`, `.gitattributes` (LF en sh/yaml/mvnw), `.claude/qa-config.md`.
- Verificación: `docker run hello-world` OK sin sudo, `java -version` 21.0.12, vhdx en E.
- ATENCIÓN T3: la cuenta activa `DaronArg` en gh tiene scopes `gist, read:org, repo` SIN `workflow`; pushear `.github/workflows/ci.yml` puede ser rechazado. Alternativa: `gh auth refresh -s workflow` (interactivo) o crear el workflow por la API/UI.
- Para mantener WSL vivo además de `vmIdleTimeout`: los procesos de background deben lanzarse dentro de WSL (p.ej. `wsl -d Ubuntu -- sleep infinity`).

## T1 — Runtime standalone (hecho)
- Archivos: `runtime/Dockerfile`, `runtime/bootstrap.sh` (solo standalone; modo sesión sale con error hasta T4), `scripts/build-runtime.sh`, `scripts/smoke-runtime.sh`.
- Verificación: `smoke-runtime.sh` en WSL → "SMOKE RUNTIME OK" (build, /healthz, java 21 / mvn 3.9.9 / node 22 / git, persistencia de volumen, extensiones). Desde Windows: `curl.exe http://localhost:8080/healthz` → 200 con puertos publicados en `127.0.0.1` (no hizo falta quitar la IP).
- Desvíos: JDK 21 vía tarball Temurin (Adoptium API) porque Debian no trae openjdk-21; Maven por apt; Node 22 por NodeSource. Usuario del contenedor: `coder`.
- Aviso para T6: Open VSX instaló `Continue.continue` v2.0.0 (no 1.3.x). Verificar que no pida login; si lo pide, fijar versión con `--install-extension Continue.continue@<ver>`.
- `/healthz` de code-server devuelve `status: expired` sin clientes conectados; es normal, HTTP 200.

## T2 — Backend base
- Archivos: `backend/` (pom Spring Boot 3.3.5, Java 21, mvnw generado con `mvn wrapper:wrapper`, `ApiController`, `EventService`, `schema.sql`, `data.sql`, `static/index.html`), `scripts/run-backend.sh`, `scripts/smoke-backend.sh`.
- Verificación: backend corriendo en WSL (:9090); `smoke-backend.sh` → "OK smoke-backend" (crear sesión, connect 200, token malo 401, sesión inexistente 401, events con SESSION_STARTED, página `/`). Desde Windows `localhost:9090/` → 200.
- Desvíos: se usa JdbcTemplate + `schema.sql` en lugar de entidades JPA (más simple). `EventService.record(sessionId, type, payloadJson)` calcula el sequence; `EventService.insert(...)` para telemetría con sequence/timestamp propios. `.env` tiene CRLF: `run-backend.sh` lo filtra con `tr -d '\r'`.
- Nota: el backend quedó corriendo (setsid, log en `/tmp/backend.log` de WSL). Los ids de sesión son autoincrementales (1, 2…) y las sesiones del smoke quedan en H2 hasta reiniciar.
- Los endpoints `/api/telemetry/batch`, git proxy, `/ai/**` y `professor.html` NO están (T4–T6).

## T3 — Repo de examen

- `exam-template/`: Spring Boot 3.3.5 / Java 21, `PriceService.applyDiscount` sin implementar, 4 tests (fallan: `./mvnw test` local → 2 failures + 2 errors), `mvnw` generado con `mvn wrapper:wrapper`, `.gitattributes` LF, `ci.yml` (`./mvnw test` en push a cualquier branch).
- Publicado como repo privado `DaronArg/assessment-exam-template`, branch `main` (se publicó desde una copia temporal; `exam-template/` del monorepo no tiene `.git`).
- **DESVÍO / PENDIENTE:** el token de `gh` de DaronArg no tiene scope `workflow`, GitHub rechazó el push de `.github/workflows/ci.yml`. El device flow (`gh auth refresh -s workflow`) no fue autorizado a tiempo. El repo se publicó SIN el workflow; `ci.yml` queda en `exam-template/.github/workflows/ci.yml` del monorepo. `gh run list` está vacío.
- Para completar: `gh auth refresh -h github.com -s workflow`, luego copiar `exam-template/.github/workflows/ci.yml` al repo (clone, `git add`, commit, `git push origin main`). El push dispara la corrida (esperada: falla por los tests).
- Nota T4: el bootstrap clona `main` del repo; el branch `session-<id>` se crea desde ahí. Sin workflow en `main`, el CI no corre en los push del alumno hasta completar el pendiente.

## T4 — Proxy git + bootstrap completo
- Archivos: `backend/.../GitProxyController.java` (proxy smart HTTP con `HttpClient`, Basic `session:<token>`, 401 + `WWW-Authenticate`, inyecta `x-access-token:GITHUB_TOKEN`, evento `GIT_PUSH` tras `git-receive-pack` 200), `runtime/bootstrap.sh` (connect, git config, credential store, clone, `checkout -b`), `scripts/smoke-git.sh`.
- Verificación: `smoke-git.sh` en WSL → "OK smoke-git": sesión → `docker run` generado → repo en branch `session-1` → commit+push desde el contenedor → branch en GitHub (API) → `GIT_PUSH` en la API → GITHUB_TOKEN ausente de env/credenciales/config del contenedor.
- **NO verificado: CI se dispara.** `runs=0` porque `ci.yml` no está en `main` del repo de examen (pendiente de T3: token sin scope `workflow`). Cuando se complete T3, los branches nuevos dispararán CI; el branch `session-1` de prueba en GitHub puede borrarse.
- Desvíos: el smoke consulta GitHub con `curl` + token leído de `.env` (no hay `gh` en WSL). `bootstrap.sh` parsea el JSON de connect con `node`.

## T5 — Telemetría + vista del profesor
- Archivos: `runtime/telemetry/{agent.js,package.json}` (chokidar 3.6.0, cola en memoria, flush cada 10 s), `runtime/bash-hook.sh` (PROMPT_COMMAND → `/tmp/telemetry/commands.log`, cargado desde `/etc/bash.bashrc` en el Dockerfile), `bootstrap.sh` lanza el agente en background tras el clone, `backend/.../TelemetryController.java` (`POST /api/telemetry/batch` con Bearer, `GET /api/professor-config` con el repo para el link a Actions), `backend/.../static/professor.html`, `scripts/smoke-telemetry.sh`.
- Verificación: `smoke-telemetry.sh` en WSL → "OK smoke-telemetry": FILE_CREATED, FILE_CHANGED, `COMMAND_EXECUTED echo hola-telemetria` exit 0 y `false` exit 1 llegan en <30 s (shell `bash -i`). Playwright en `http://localhost:9090/professor.html`: lista de sesiones, click en la sesión → timeline con todos los eventos + link a GitHub Actions del branch.
- Desvíos: el agente solo arranca en modo sesión (no standalone). `ignored` de chokidar es una función (más simple que regex). El `sequence` de los eventos del agente es propio de cada agente, por eso se ordena por timestamp (puede repetirse con eventos del backend). Backend reiniciado para cargar el nuevo controller; imagen reconstruida.
- Ojo para otros workers: el tool de edición/heredocs halvea backslashes; verificar regex/escapes en archivos escritos.

## T6 — AI Gateway + Continue
- Archivos: `backend/.../AiGatewayController.java` (`POST /ai/v1/messages`: valida `x-api-key` = token de sesion, reemplaza por `ANTHROPIC_API_KEY`, reenvia con streaming SSE por chunks; eventos `AI_PROMPT`/`AI_RESPONSE`, y `AI_AUTOCOMPLETE` sin contenido cuando `model == AI_AUTOCOMPLETE_MODEL`), `runtime/continue-config.yaml` (plantilla), `bootstrap.sh` (renderiza `~/.continue/config.yaml` con sed + escribe settings de code-server), `Dockerfile` (copia la plantilla), `scripts/smoke-ai.sh`.
- Verificacion: `smoke-ai.sh` en WSL -> "OK smoke-ai" (respuesta normal "pong", stream SSE con content_block_delta, 401 con token malo, AI_PROMPT/AI_RESPONSE/AI_AUTOCOMPLETE en la API, autocomplete no guarda contenido, config de Continue renderizada en el contenedor). Playwright en `localhost:8080`: panel Continue (v2.0.0, sin login) -> mensaje "Reply with the single word: pong" -> respuesta "pong" via gateway (eventos AI_* de esa sesion confirmados).
- Desvios/gotchas: (1) code-server arrancaba en Restricted Mode y Continue no se activaba -> `security.workspace.trust.enabled=false` en `~/.local/share/code-server/User/settings.json` (tambien `continue.telemetryEnabled=false`). (2) Continue 2.0.0 manda `thinking.type=enabled`, que claude-sonnet-5-5 rechaza (400) -> el gateway elimina el campo `thinking` antes de reenviar. (3) No hizo falta fijar 1.3.x. (4) `AI_RESPONSE` guarda el texto extraido; si no hay deltas de texto (p.ej. generacion de titulo) guarda el SSE crudo. (5) Autocomplete real no se probo desde la UI (solo por curl con el modelo haiku).
- Backend reiniciado con el nuevo controller (H2 reseteada); imagen reconstruida.

## T7 — QA end-to-end
- Recorrido de la DoD §13 con Playwright sobre la UI real (ver `qa-manual-report.md` y `qa-evidence/`): puntos 1, 2, 3, 4, 5 (push) y 6 OK.
- NO validado: CI se dispara al pushear (punto 5). El repo de examen sigue sin `ci.yml` por el scope `workflow` faltante en el token de gh; el device flow necesita login del usuario en el navegador.
- Hallazgo: ids de sesión reinician con H2 → colisión con branches viejos `session-<id>` en GitHub (push rechazado). Se borró el branch de prueba y se documentó en README. Sin cambios de código.
- Entregables: `README.md`, `qa-manual-report.md`. Backend corriendo (H2 limpia) en WSL y imagen `assessment-runtime:poc` construida.

## T8 — Demo grabada (frontend del examen + `demo/record-demo.mjs`)
- Repo de examen (publicado en `main`, commit `7733732`, sin `.github/workflows`): `PriceController` (`GET /api/price?price=&percent=` con `@CrossOrigin` para `http://localhost:4200`, 400 si `IllegalArgumentException`), `application.properties` con `server.port=8081` (sin esto choca con code-server en :8080), `frontend/` Vite vanilla (`npm run dev` en `0.0.0.0:4200`), `.gitignore` con `node_modules/`. `PriceService.applyDiscount` y los 4 tests siguen fallando (2F+2E). Mismo contenido en `exam-template/` del monorepo.
- **Bug del producto arreglado:** `runtime/bash-hook.sh` no registraba un comando identico repetido de forma consecutiva (el 2do `./mvnw test`): Debian pone `HISTCONTROL=ignoredups` en `~/.bashrc` y el hook deduplica por numero de historia. Fix: el hook resetea `HISTCONTROL`/`HISTIGNORE` en cada prompt. Imagen reconstruida.
- Limitaciones conocidas (sin cambio): comandos de larga duracion (`spring-boot:run`, `npm run dev`) solo aparecen en la timeline cuando terminan; el watcher emite ruido de `.attach_pid*` del language server de Java; el id de sesion de la segunda entrada (GIT_PUSH vs COMMAND_EXECUTED) comparte `sequence` por diseno.
- Decisiones: un solo `page` de Playwright + `goto` (un video continuo); cartel de paso y cursor inyectados con `addInitScript`; sincronizacion con la terminal de la IDE via `commands.log` del contenedor; Continue en modo Chat con Apply sobre un bloque con el archivo completo (el modo Agent pide aprobar cada tool). Chat-mode Apply no es determinista: si el modelo devuelve un bloque parcial, regrabar.

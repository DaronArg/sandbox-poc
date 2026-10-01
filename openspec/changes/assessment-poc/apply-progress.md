
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

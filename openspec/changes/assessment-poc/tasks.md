# Assessment POC — Tasks

**Spec:** `openspec/changes/assessment-poc/design.md` (leerlo completo antes de empezar cualquier task).
**Ejecución:** Run de Orca, un worker por task, todos en el worktree actual, branch `poc/assessment-platform`.

## Reglas para todos los workers

- POC: la opción más simple que funcione. Nada de capas extra, ni tests unitarios obligatorios, ni refactors.
- El usuario NO está disponible. No preguntar: decidir lo más simple y anotarlo en `openspec/changes/assessment-poc/apply-progress.md` (agregar al final, no pisar lo de otros).
- Una task termina solo cuando su verificación pasó de verdad, ejecutada, con la salida real. Si algo no se pudo verificar, reportar `--outcome failed` o decirlo explícito en el reporte.
- Secretos: nunca imprimir ni commitear `.env`. No hacer `cat`/`bat` de `.env`.
- Git: commitear solo los paths propios (`git add <paths>`), conventional commits, sin atribución de IA. No pushear el monorepo. Si aparece `index.lock`, esperar y reintentar.
- Hay acceso total a la máquina, incluido root en WSL (`wsl -d Ubuntu -u root`).
- Docker y backend corren dentro de WSL (sección 12.1 del spec).
- Al terminar: agregar a `apply-progress.md` qué se hizo, cómo se verificó y qué desvíos hubo.

## Dependencias

```
T0 ──┬── T1 ──┐
     ├── T2 ──┼── T4 ── T5 ── T6 ── T7 (QA)
T3 ──┴────────┘
```

T1, T2 y T3 corren en paralelo. De T4 en adelante es secuencial porque comparten `bootstrap.sh`, la imagen, el backend y los puertos.

## T0 — Entorno y scaffold (spec §3, §4, §12.1)

- [ ] Mover la distro WSL `Ubuntu` a `E:\wsl\Ubuntu`.
- [ ] Instalar Docker Engine y JDK 21 dentro de WSL; `vmIdleTimeout=-1` en `.wslconfig`.
- [ ] Completar `.env` (sin tocar `ANTHROPIC_API_KEY`): `GITHUB_TOKEN` con `gh auth token`, `GITHUB_REPO`, `AI_CHAT_MODEL`, `AI_AUTOCOMPLETE_MODEL`.
- [ ] Crear carpetas `runtime/`, `backend/`, `exam-template/`, `scripts/`; `.gitattributes` forzando LF en `*.sh`.
- [ ] Crear `.claude/qa-config.md` (formato del CLAUDE.md global: stack, URLs, cómo levantar, H2).
- **Verificación:** `wsl -d Ubuntu -- docker run --rm hello-world` OK; `wsl -d Ubuntu -- java -version` muestra 21; la distro está en E (`wsl -l -v` + existe `E:\wsl\Ubuntu\ext4.vhdx`).

## T1 — Runtime standalone (spec §6, sin sesión)

- [ ] `runtime/Dockerfile`, `runtime/bootstrap.sh` (solo modo standalone), `scripts/build-runtime.sh`.
- [ ] Extensiones Java pack y Continue preinstaladas.
- **Verificación** (`scripts/smoke-runtime.sh`): build OK; `docker run` con volumen → `curl localhost:8080` responde desde WSL **y desde Windows**; `java -version`, `mvn -v`, `node -v`, `git --version` dentro del contenedor; un archivo creado en `/workspace` sobrevive a borrar y recrear el contenedor; las dos extensiones aparecen en `code-server --list-extensions`.

## T2 — Backend base (spec §7, sin git proxy ni IA ni telemetría)

- [ ] Proyecto Spring Boot 3 / Java 21 / Maven wrapper en `backend/`, puerto 9090, H2 en memoria, `data.sql`.
- [ ] Entidades `Student`, `Exam`, `Session`, `Event`; un `EventService.record(sessionId, type, payloadJson)` que usarán las tasks siguientes.
- [ ] Endpoints: `GET /api/exams`, `GET /api/students`, `POST /api/sessions`, `POST /api/sessions/{id}/connect`, `GET /api/sessions`, `GET /api/sessions/{id}/events`.
- [ ] Página `/` (HTML estático + fetch) que crea la sesión y muestra el `docker run`.
- [ ] `scripts/run-backend.sh` (exporta `.env` y corre el backend).
- **Verificación** (`scripts/smoke-backend.sh`): con `curl`, crear sesión, connect con el token (200), connect con token malo (401), y `GET events` devuelve `SESSION_STARTED`.

## T3 — Repo de examen (spec §8.1)

- [ ] `exam-template/`: Spring Boot mínimo con Maven wrapper, un servicio con método sin implementar, tests que fallan, `.github/workflows/ci.yml`.
- [ ] Publicarlo como repo privado `DaronArg/assessment-exam-template` (contenido de `exam-template/` en la raíz del repo, branch `main`).
- **Verificación:** `gh repo view` lo muestra privado; `gh run list` muestra una corrida del workflow (se espera que falle por los tests: eso es correcto).

## T4 — Proxy git + bootstrap completo (spec §6.2, §8)

- [ ] Proxy `/git/{sessionId}/repo.git/**` en el backend con validación de token y evento `GIT_PUSH`.
- [ ] `bootstrap.sh` completo: connect, config de git, clone, branch.
- **Verificación** (`scripts/smoke-git.sh`): crear sesión → `docker run` con el comando generado → `/workspace` tiene el repo en el branch `session-<id>`; dentro del contenedor, commit + `git push` → el branch existe en GitHub (`gh api`), CI se dispara, evento `GIT_PUSH` en la API; el token de GitHub no aparece en ningún archivo ni variable del contenedor.

## T5 — Telemetría + vista del profesor (spec §7.2, §10)

- [ ] `runtime/telemetry/agent.js`, `runtime/bash-hook.sh`, arranque desde `bootstrap.sh`.
- [ ] `POST /api/telemetry/batch`.
- [ ] `professor.html`: lista de sesiones, timeline de la elegida, link a Actions del branch.
- **Verificación** (`scripts/smoke-telemetry.sh`): dentro del contenedor crear y modificar un archivo y ejecutar un comando en una shell bash interactiva → en menos de 30 s la API devuelve `FILE_CREATED`, `FILE_CHANGED` y `COMMAND_EXECUTED` con el comando y exit code; `professor.html` los muestra (verificar con el navegador o Playwright).

## T6 — AI Gateway + Continue (spec §9)

- [ ] `POST /ai/v1/messages` proxy con streaming y eventos `AI_PROMPT`, `AI_RESPONSE`, `AI_AUTOCOMPLETE`.
- [ ] `runtime/continue-config.yaml` + render en `bootstrap.sh`.
- **Verificación** (`scripts/smoke-ai.sh`): `curl` al proxy con token de sesión devuelve respuesta del modelo (normal y con `stream: true`); con token inválido da 401; eventos de IA en la API. Con Playwright o el navegador: abrir code-server, abrir el panel de Continue, mandar un mensaje y ver la respuesta. Si Continue exige login, fijar una versión 1.3.x y repetir.

## T7 — QA: validación end-to-end y cierre

- [ ] Levantar todo desde cero siguiendo `.claude/qa-config.md` y recorrer la Definition of Done (spec §13) punto por punto, con la UI real (Playwright).
- [ ] Revisar el código contra el spec; arreglar lo que falle y volver a correr hasta que pase.
- [ ] `README.md` en la raíz: cómo levantar el backend, crear una sesión y probar, para que el usuario haga sus pruebas manuales.
- [ ] Guardar `openspec/changes/assessment-poc/qa-manual-report.md` con evidencia por punto y lo que no se pudo validar.
- [ ] Dejar el backend corriendo y la imagen construida al terminar.

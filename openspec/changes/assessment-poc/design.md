# Assessment Platform — POC (spec de diseño)

Fecha: 2026-10-01 · Fuente: `handoff_arquitectura_assessment_platform_tecnico (1).md`

## 1. Objetivo

Validar de punta a punta que la arquitectura del handoff funciona, con la implementación más básica posible:

```
web → docker run → code-server en localhost → backend conoce la sesión
    → telemetría mínima → IA vía gateway → git push vía backend → CI → timeline del profesor
```

Prioridad: **infra funcionando**. No importan calidad de código, cobertura de tests ni robustez.

## 2. Fuera de alcance

Login/auth de usuarios, submit explícito, registry de imágenes, deploy del backend, hash chain, outbox offline,
captura PTY, diffs/snapshots de archivos, routing multi-modelo, límites de costo de IA, procedencia de IA
(accepted/modified/rejected), Electron, docker-compose, frontend Angular en el examen.

## 3. Estructura del monorepo

```
sandbox-poc/
├── runtime/                 # imagen Docker del alumno
│   ├── Dockerfile
│   ├── bootstrap.sh         # ENTRYPOINT
│   ├── bash-hook.sh         # hook de comandos para telemetría
│   ├── continue-config.yaml # plantilla de config de la extensión de IA
│   └── telemetry/           # agent.js + package.json
├── backend/                 # Spring Boot (única app)
├── exam-template/           # contenido que se publica como repo de examen en GitHub
├── scripts/                 # build-runtime, run-backend, smoke tests
├── .claude/qa-config.md
├── .env                     # NO versionado
└── openspec/
```

## 4. Configuración (`.env` en la raíz, gitignored)

```
ANTHROPIC_API_KEY=...            # la carga el usuario
GITHUB_TOKEN=...                 # la carga el agente con `gh auth token`
GITHUB_REPO=DaronArg/assessment-exam-template
AI_CHAT_MODEL=claude-sonnet-5-5
AI_AUTOCOMPLETE_MODEL=claude-haiku-4-5-20251001
```

El backend las lee como variables de entorno (`scripts/run-backend.sh` exporta el `.env` y ejecuta `./mvnw spring-boot:run`).

## 5. Puertos

| Puerto host | Qué |
|---|---|
| 9090 | Backend de la plataforma (corre en el host, fuera de Docker) |
| 8080 | code-server (contenedor) |
| 8081 | API Spring Boot del alumno (contenedor) |
| 4200 | reservado para frontend del alumno (contenedor) |

Todos los `-p` se publican sobre `127.0.0.1`. El contenedor llega al backend por `http://host.docker.internal:9090`.

## 6. Runtime (imagen `assessment-runtime:poc`)

- Base: `codercom/code-server` (Debian). Se agregan: JDK 21, Maven, Node 22, Git.
- Extensiones preinstaladas desde Open VSX: `vscjava.vscode-java-pack`, `Continue.continue`.
- code-server con `--auth none`, abre `/workspace`.
- Nada específico de alumno/examen/sesión dentro de la imagen.
- La imagen es específica de este stack; el producto final tendrá otras tecnologías → no se generaliza ahora.

### 6.1 `docker run` (lo genera el backend)

```bash
docker run --rm --name assessment-<sessionId> \
  -p 127.0.0.1:8080:8080 -p 127.0.0.1:8081:8081 -p 127.0.0.1:4200:4200 \
  --add-host=host.docker.internal:host-gateway \
  -e SESSION_ID=<sessionId> -e SESSION_TOKEN=<token> \
  -e BACKEND_URL=http://host.docker.internal:9090 \
  -v assessment_<sessionId>_workspace:/workspace \
  assessment-runtime:poc
```

### 6.2 `bootstrap.sh`

1. Sin `SESSION_TOKEN` → modo standalone: solo levanta code-server (sirve para probar la imagen sola).
2. `POST $BACKEND_URL/api/sessions/$SESSION_ID/connect` con `Authorization: Bearer $SESSION_TOKEN`. Si falla → log claro y `exit 1`.
3. Configura git: `user.name`/`user.email` del alumno y credencial `session:$SESSION_TOKEN` para `$BACKEND_URL` (credential store).
4. Si `/workspace/.git` no existe: `git clone $BACKEND_URL/git/$SESSION_ID/repo.git /workspace`, `git checkout -b <branch>`. Si existe, no toca nada (volumen persistente).
5. Renderiza `~/.continue/config.yaml` desde la plantilla (apiBase + token).
6. Lanza `telemetry/agent.js` en background.
7. `exec code-server --auth none --bind-addr 0.0.0.0:8080 /workspace`.

## 7. Backend (Spring Boot 3, Java 21, Maven, H2 en memoria)

Una sola app en `:9090`. H2 en memoria con `data.sql` de seeds (2 alumnos, 1 examen). Los datos se pierden al reiniciar: aceptado.

### 7.1 Modelo

- `Student(id, name, email)` — seed
- `Exam(id, title, description)` — seed
- `Session(id, token, studentId, examId, branch, status[CREATED|ACTIVE], createdAt)`
- `Event(id, sessionId, sequence, type, timestamp, payload TEXT/JSON)`

### 7.2 Endpoints

| Método y ruta | Auth | Qué hace |
|---|---|---|
| `GET /` | — | Página estática: elegir alumno + examen, botón "Iniciar", muestra el `docker run` para copiar |
| `GET /api/exams`, `GET /api/students` | — | Listados de seeds |
| `POST /api/sessions` `{studentId, examId}` | — | Crea sesión, token random (UUID), `branch = session-<id>`. Devuelve `{sessionId, dockerRun}` |
| `POST /api/sessions/{id}/connect` | Bearer | Pasa a `ACTIVE`, registra `SESSION_STARTED`. Devuelve `{examId, branch, studentName, studentEmail, chatModel, autocompleteModel}` |
| `POST /api/telemetry/batch` `{sessionId, events[]}` | Bearer | Persiste eventos |
| `/git/{sessionId}/repo.git/**` | Basic (`session:<token>`) | Proxy git (ver 8) |
| `POST /ai/v1/messages` | header `x-api-key: <token>` | AI Gateway (ver 9) |
| `GET /api/sessions`, `GET /api/sessions/{id}/events` | — | JSON para la vista del profesor |
| `GET /professor.html` | — | Página estática: lista de sesiones y timeline de eventos de la elegida, más link a GitHub Actions del branch |

Token inválido o sesión inexistente → `401`. Sin más manejo de errores.

## 8. Git: proxy en el backend

**Decisión:** el contenedor nunca habla con GitHub. Clona y pushea contra el backend, que reenvía a
`https://github.com/$GITHUB_REPO.git` inyectando `GITHUB_TOKEN`.

- Rutas reenviadas (git smart HTTP): `GET info/refs?service=...`, `POST git-upload-pack`, `POST git-receive-pack`. Passthrough en streaming del body y headers de contenido.
- Valida el token de sesión en cada request.
- En cada `git-receive-pack` registra el evento `GIT_PUSH`.
- No se restringe por branch (el alumno podría pushear a otro branch): aceptado en la POC.

**Sobre "un usuario que solo tenga acceso desde el entorno":** no es posible garantizarlo de forma absoluta, porque el
alumno es root del contenedor y puede leer cualquier credencial que viva ahí. Lo máximo alcanzable es lo que hace este
proxy: la credencial real de GitHub nunca sale del backend, y el acceso del alumno depende de un token de sesión que el
backend puede revocar. Mientras la sesión esté activa, el alumno podría usar ese token desde su host contra el backend;
al cerrarla, pierde todo acceso. El repo es privado y el alumno no tiene permisos en GitHub.

### 8.1 Repo de examen

`exam-template/` se publica como repo **privado** `DaronArg/assessment-exam-template`:
proyecto Spring Boot mínimo (un servicio con un método sin implementar y tests que fallan) más
`.github/workflows/ci.yml` que corre `./mvnw test` en cada push a cualquier branch.

## 9. IA

**Decisión: no se desarrolla una extensión.** Se usa **Continue** (open source, publicada en Open VSX), que da la
experiencia tipo Copilot: chat lateral con contexto del archivo/selección, edición inline y autocompletado.
Copilot real no sirve: es propietario, no está en Open VSX y no se puede redirigir a un gateway propio.

- Continue se configura con provider `anthropic`, `apiBase: $BACKEND_URL/ai/v1/` y `apiKey: $SESSION_TOKEN`.
  Dos modelos: uno para chat/edit/apply y uno para autocomplete. Telemetría anónima de Continue desactivada.
- El backend expone `POST /ai/v1/messages` como proxy transparente de la Messages API de Anthropic:
  valida el token de sesión, reemplaza `x-api-key` por `ANTHROPIC_API_KEY`, reenvía a `https://api.anthropic.com/v1/messages`
  y devuelve la respuesta tal cual, incluido streaming SSE.
- Registra `AI_PROMPT` (modelo + último mensaje del usuario) y `AI_RESPONSE` (texto acumulado o body crudo, lo que sea más simple).
  Los requests del modelo de autocomplete se registran como `AI_AUTOCOMPLETE` sin guardar el contenido, para no inundar la timeline.

Costo asumido de esta decisión: no hay eventos de aceptar/rechazar sugerencias. Eso requeriría extensión propia o fork de Continue (post-POC).

Riesgo a verificar al implementar: que Continue arranque con config local sin pedir login. Si la última versión lo exige, fijar una versión 1.3.x.

## 10. Telemetría (agente en el contenedor)

Script Node (`runtime/telemetry/agent.js`), una sola dependencia: `chokidar`.

- **Archivos:** watcher sobre `/workspace` ignorando `.git`, `target`, `node_modules`. Emite `FILE_CREATED`, `FILE_CHANGED`, `FILE_DELETED` con `{path}`.
- **Comandos:** `bash-hook.sh` se carga desde `/etc/bash.bashrc`; con `PROMPT_COMMAND` agrega una línea JSON `{command, exitCode}` a `/tmp/telemetry/commands.log`. El agente sigue ese archivo y emite `COMMAND_EXECUTED`.
- **Envío:** cola en memoria, `POST /api/telemetry/batch` cada 10 s con `sequence` incremental. Si falla, reintenta en el siguiente ciclo. Sin persistencia local.

Eventos totales de la POC: `SESSION_STARTED`, `FILE_*`, `COMMAND_EXECUTED`, `GIT_PUSH`, `AI_PROMPT`, `AI_RESPONSE`, `AI_AUTOCOMPLETE`.

## 11. Slices de implementación

Cada slice se cierra con un smoke script en `scripts/` que lo demuestra. Orden y dependencias:

| # | Slice | Depende de | Verificación |
|---|---|---|---|
| 0 | Scaffold: estructura, `.gitignore`, `.env` (con `GITHUB_TOKEN`), `.claude/qa-config.md` | — | archivos presentes |
| 1 | Runtime standalone: Dockerfile + bootstrap modo standalone | 0 | `docker run` → `curl localhost:8080` OK; `java`, `mvn`, `node`, `git` dentro del contenedor; un archivo sobrevive a recrear el contenedor |
| 2 | Backend base: modelo, seeds, sesiones, `connect`, página `/` | 0 | `curl` crea sesión y hace connect |
| 3 | Repo de examen: publicar `exam-template` en GitHub con CI | 0 | repo existe, workflow corre en un push |
| 4 | Proxy git + bootstrap completo (connect, clone, branch) | 1, 2, 3 | dentro del contenedor: clone automático y `git push` llega a GitHub; `GIT_PUSH` registrado |
| 5 | Telemetría: agente + hook + endpoint batch | 1, 2 | crear archivo y correr comando → eventos visibles por API |
| 6 | AI Gateway + Continue | 1, 2 | `curl` al proxy responde; Continue responde en el chat de code-server |
| 7 | Vista del profesor | 2 | `professor.html` muestra la timeline |
| 8 | QA end-to-end | todos | flujo completo de la sección 1, con Playwright para la UI |

Paralelizables: {1, 2, 3} tras el 0; {5, 6, 7} tras 1 y 2 (tocan archivos distintos del backend salvo registro de eventos, que se define en el slice 2).

## 12. Reglas de trabajo para los agentes

- Branch `poc/assessment-platform`; conventional commits; sin atribución de IA.
- **No** se pushea el monorepo a ningún remoto. Lo único que sale de la máquina es el repo de examen (autorizado por el usuario).
- Nunca commitear `.env` ni imprimir secretos en logs o reportes.
- Ante una duda no cubierta acá: elegir la opción más simple y dejarla anotada en `openspec/changes/assessment-poc/apply-progress.md`. No preguntar al usuario.

## 12.1 Entorno de ejecución: Docker en WSL (disco E)

La máquina es Windows 11 sin Docker Desktop. Todo lo que es Docker y backend corre **dentro de WSL Ubuntu**:

- La distro `Ubuntu` de WSL se mueve al disco E (`wsl --shutdown` + `wsl --manage Ubuntu --move E:\wsl\Ubuntu`), así la imagen, los volúmenes y los datos de Docker viven en E.
- Dentro de la distro (acceso root: `wsl -d Ubuntu -u root`): Docker Engine (script oficial `get.docker.com`), habilitado con systemd; JDK 21 para correr el backend.
- El backend corre dentro de WSL (`:9090`), desde el repo montado en `/mnt/f/repos/tpi-tup/sandbox-poc`. El contenedor lo alcanza con `--add-host=host.docker.internal:host-gateway`.
- Desde Windows se accede por `localhost:9090` y `localhost:8080` (reenvío de localhost de WSL). Si publicar sobre `127.0.0.1` no se reenvía a Windows, publicar sin IP y anotarlo.
- WSL apaga la VM cuando no quedan sesiones abiertas: configurar `vmIdleTimeout=-1` en `%UserProfile%\.wslconfig` y documentar en `qa-config.md` cómo se levanta todo.
- Los scripts de `scripts/` son bash y se ejecutan dentro de WSL (`wsl -d Ubuntu -- bash -lc '...'`). Cuidar los finales de línea: LF en todo `.sh` (agregar `.gitattributes`).
- Si la instalación de Docker en WSL falla sin arreglo posible: seguir con todo lo que no necesita contenedor y dejar anotado qué quedó sin verificar.

## 13. Definition of Done

1. Desde `http://localhost:9090` se crea una sesión y se copia el `docker run`.
2. El comando levanta la IDE en `http://localhost:8080` con el repo del examen clonado.
3. Se puede compilar y correr tests (`./mvnw test`) en la terminal de la IDE.
4. El chat de Continue responde usando el gateway.
5. `git push` desde la IDE llega a GitHub y dispara CI.
6. `http://localhost:9090/professor.html` muestra la timeline con eventos de archivos, comandos, IA y push.

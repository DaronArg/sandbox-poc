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

## E2 — Runtime con gate
- `runtime/gate/` (gate.js + http-proxy 1.18.1), `bootstrap.sh` (root) + `session.sh` (coder), Dockerfile (sin sudo, usuario `gate`, REST Client, `USER root`), agente con `NEXT_SEQUENCE`, tail de `denied.log` (lectura desde el inicio del archivo, el contenedor es nuevo por sesión) y flush en SIGTERM. Imagen reconstruida.
- **Upstream git local (desvío por entorno):** sin acceso a GitHub (§Entorno). Se agregó `GIT_UPSTREAM_BASE` (env opcional del backend, default `https://github.com`) y `scripts/local-upstream.sh` + `local-git-upstream.js` (git smart HTTP vía `git http-backend`, sembrado desde `exam-template/` en `/tmp/upstream`). `run-backend.sh` exporta `GIT_UPSTREAM_BASE` solo si existe `/tmp/upstream/.active`. `lib-session.sh` lo levanta solo cuando `.env` no tiene `GITHUB_TOKEN`. Con token real el flujo es el de siempre contra GitHub.
- `scripts/lib-session.sh` (start_session/wait_ide/stop_session) con el `docker run` exacto de §6.4 (sin shell: argumentos), usado por `smoke-gate/git/telemetry/ai`. `scripts/smoke-all.sh` corre la tanda.
- `smoke-gate.sh`: los 9 puntos de §12 pasan. Desvíos menores: (4) la API del alumno con `applyDiscount` sin implementar responde 500 (no 200): se verifica que el gate llega a Spring (JSON de Spring, no del gate); (5) el upstream de prueba es un servidor `node` en :4200 en vez de `nc` (la imagen no trae netcat); (9) `curl.exe` se invoca desde WSL por interop (`/mnt/c/Windows/System32/curl.exe`).
- Riesgo §10 "reenvío de localhost de WSL no lleva el puerto dinámico a Windows": **NO se confirmó**; `curl.exe` desde Windows llegó a `127.0.0.1:<P aleatorio>` (403 sin cookie, 200 con cookie). No hace falta el plan B (puerto fijo).
- Riesgo §10 "code-server rechaza WebSocket por Origin/Host": a nivel curl el upgrade con cookie y `Origin: http://ide.localhost:<P>` da 101. Se confirma de verdad con el IDE real en E4.
- `smoke-ai.sh`: **parcial**, no hay `ANTHROPIC_API_KEY`. Se verifican 401 con token inválido y la config de Continue renderizada; no-stream/stream/eventos AI_*/autocomplete quedan SKIPPED y sin verificar.
- `smoke-git.sh`: verificado contra el upstream LOCAL; GitHub real y CI **sin verificar**.
- Verificación: `smoke-gate`, `smoke-runtime`, `smoke-git`, `smoke-telemetry`, `smoke-backend` OK; `smoke-ai` parcial.

## E3 — Repo de examen
- `exam-template/`: `frontend/main.js` con `API = ''`, `vite.config.js` con proxy `/api` → `127.0.0.1:8081`, `PriceController` sin `@CrossOrigin`, `requests.http` y `README.md` nuevos. `PriceService.applyDiscount` y los 4 tests siguen fallando a propósito.
- **No se publicó en `main` de `DaronArg/assessment-exam-template`:** no hay acceso (ver Entorno). El espejo `exam-template/` queda listo y el upstream local se siembra desde él.
- `scripts/smoke-exam.sh` (nuevo) en un contenedor de sesión con gate: el clone trae los cambios; `./mvnw test` → `Tests run: 4, Failures: 2, Errors: 2`; `spring-boot:run` + `npm run dev`; `app.localhost:<P>/` → 200 con el HTML del front; `app.localhost:<P>/api/price?price=200&percent=25` → 500 JSON de Spring (esperado: `applyDiscount` sin implementar, anotado como pide la task); `curl.exe` desde Windows a `localhost:8081/api/price...` → 500 (mismo código, responde Spring). Nota: `curl.exe` necesita `-o NUL` (con `/dev/null` falla la escritura del body en Windows).
- Riesgo §10 HMR de Vite: se verifica con la app real en E5 (editar `main.js` y ver la pestaña App recargar).

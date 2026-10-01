
## C1 — Persistencia, ciclo de vida y submit (hecho)
- H2 en archivo (`jdbc:h2:file:./data/assessment`, relativo a `backend/`, gitignored). `schema.sql` con `IF NOT EXISTS` y columna `final_sha`; `data.sql` inserta seeds solo si la tabla está vacía.
- Branch `session-<id>-<6 hex>`. `POST /api/sessions/{id}/submit` (Bearer, `{sha}`) -> `final_sha`, `COMPLETED`, evento `SUBMISSION_COMPLETED`. Todas las consultas de token (connect, submit, git proxy, gateway IA, telemetría) filtran `status <> 'COMPLETED'` => 401. `GET /api/sessions` expone `finalSha`.
- Imagen: `runtime/submit.sh` instalado como `/usr/local/bin/submit`. Para esperar el último batch, el agente de telemetría atiende SIGUSR1 (flush inmediato y escribe `/tmp/telemetry/flushed`); `submit` espera 2 s (el agente lee el log de comandos cada 1 s), manda la señal y espera el marcador (máx. 30 s). Imagen reconstruida.
- Verificación: `scripts/smoke-submit.sh` -> "OK smoke-submit" (persistencia tras reinicio + seeds = 2, submit desde contenedor con cambio sin commitear, final_sha = HEAD y existe en GitHub, SUBMISSION_COMPLETED tras FILE_CREATED/GIT_PUSH, push/IA/telemetría/connect = 401, sesión B seguida sin conflicto de branch). El script borra los branches que crea. Regresión: smoke-backend, smoke-git, smoke-telemetry, smoke-ai OK (smoke-git y smoke-backend actualizados al nuevo formato de branch).
- Gotchas: `bash -x` en los smokes imprime el GITHUB_TOKEN (no usarlo). `pkill -f` desde `wsl -- bash -c '...'` mata su propio shell si el patrón aparece en la línea de comandos. No hay CI todavía (C2).

## C2 â€” CI y resultado en el panel (PARCIAL: bloqueado por scope `workflow`)
- Hecho: `GET /api/sessions/{id}/result` (`ApiController`, consulta `actions/runs?head_sha=` o `branch=` a la API de GitHub bajo demanda; devuelve `{status, finalSha, ciStatus, ciConclusion, ciUrl}`; `ciStatus` = `none` sin corridas, `unknown` si GitHub falla) y bloque de resultado en `professor.html` (ids `#r-status`, `#r-sha`, `#r-ci`, `#ci-link`).
- Verificado: backend reiniciado; sesion 9 con submit del SHA de `main` -> endpoint devuelve `COMPLETED` + SHA + `ciStatus=none`; Playwright en `professor.html` muestra estado, SHA final y `none / -`.
- NO hecho / PENDIENTE: `gh auth status` -> cuenta activa DaronArg con scopes `gist, read:org, repo` (sin `workflow`). No se hizo device flow ni se uso la otra cuenta. `ci.yml` NO esta en `main` del repo de examen, asi que `gh run list` esta vacio y no se verifico `ciConclusion`/`ciUrl` reales ni el link a la corrida.
- Para completar (comandos exactos, requiere accion del usuario en el navegador):
  1. `gh auth refresh -h github.com -s workflow,write:packages` (cuenta DaronArg)
  2. `git clone https://github.com/DaronArg/assessment-exam-template.git /tmp/exam && mkdir -p /tmp/exam/.github/workflows && cp exam-template/.github/workflows/ci.yml /tmp/exam/.github/workflows/ && cd /tmp/exam && git add .github && git commit -m "ci: run backend tests on push" && git push origin main`
  3. Verificar: nueva sesion con push + submit -> `gh run list -R DaronArg/assessment-exam-template` muestra la corrida del SHA; `curl localhost:9090/api/sessions/<id>/result` -> `ciStatus=completed`, `ciConclusion=failure` (los tests fallan a proposito) y `ciUrl`; Playwright en `professor.html` muestra el link.

## C3 â€” Examen con Angular (hecho)
- `exam-template/frontend/` reemplazado por app Angular 20 (generada con `ng new --minimal`, standalone component + `HttpClient` que consume `GET http://localhost:8081/api/price`, `npm start` = `ng serve --host 0.0.0.0 --port 4200`). Publicado en `main` del repo de examen (commit `c6391b1`, sin tocar `.github/workflows`, no requiere scope `workflow`).
- Imagen: `npm install -g @angular/cli@20` + `NG_CLI_ANALYTICS=false` en `runtime/Dockerfile`. Se fijÃ³ la v20 (la 22 pide Node >=22.22.3). Reconstruida (3 min, imagen 3.67 GB en disco).
- VerificaciÃ³n: `scripts/smoke-frontend.sh` OK en contenedor de sesiÃ³n: Spring Boot arriba en 14 s, `npm install` 23 s, primer `ng serve` responde en 4 s (tras instalar). Con `applyDiscount` implementado dentro del contenedor, Playwright en `http://localhost:4200` desde Windows muestra "Precio final: $150" (API :8081). Sin implementar, el endpoint falla y los tests siguen fallando (diseÃ±o).
- Gotcha: Git Bash de Windows mapea `/tmp` y reescribe rutas `/mnt/...` en `wsl -- bash script`; usar `wsl -d Ubuntu -- bash -lc '...'`. Sin `fd`/`bat`/`eza` en la mÃ¡quina (se usÃ³ Glob/Read).
- Pendiente para C7: `demo/record-demo.mjs` paso 9 usa `npm run dev` (Vite); pasa a `npm install && npm start` (Angular).

## C4 â€” Imagen en GHCR (PARCIAL: bloqueado por scope `write:packages`)
- Hecho: el `docker run` generado usa `RUNTIME_IMAGE` (default `ghcr.io/daronarg/assessment-runtime:poc`, `ApiController`). `scripts/publish-runtime.sh` (login con token de gh, tag, push; aborta si falta el scope). `scripts/run-backend.sh` exporta `RUNTIME_IMAGE=assessment-runtime:poc` si no esta definida, para que los smokes sigan usando la imagen local hasta publicar. No se pudo escribir `.env` (acceso denegado a este worker).
- NO hecho: `gh auth status` -> DaronArg con scopes `gist, read:org, repo` (sin `write:packages`). Sin device flow ni la otra cuenta. No se hizo login/push a GHCR, ni borrar la imagen local, ni `docker pull`, ni se midio tiempo/tamano de pull. La modificacion de Java no se compilo ni reinicio el backend (regla: no build).
- Para completar (requiere accion del usuario en el navegador):
  1. `gh auth refresh -h github.com -s workflow,write:packages` (cuenta DaronArg)
  2. `wsl -d Ubuntu -- bash -lc "cd /mnt/f/repos/tpi-tup/sandbox-poc && ./scripts/publish-runtime.sh"`
  3. Agregar `RUNTIME_IMAGE=ghcr.io/daronarg/assessment-runtime:poc` a `.env`; reiniciar backend.
  4. Verificar: `docker rmi ghcr.io/daronarg/assessment-runtime:poc assessment-runtime:poc`; `time docker pull ghcr.io/daronarg/assessment-runtime:poc` (login previo); `docker manifest inspect`/`docker images` para tamano; `docker tag ghcr.io/daronarg/assessment-runtime:poc assessment-runtime:poc` y `./scripts/smoke-git.sh` (o con RUNTIME_IMAGE de GHCR). Confirmar paquete privado en github.com/users/DaronArg/packages.

## C5 â€” Camino remoto por tunel HTTPS (hecho)
- `PUBLIC_URL` en `ApiController`: si esta definida, el `docker run` usa `BACKEND_URL=$PUBLIC_URL` (sin `/` final) y no agrega `--add-host`.
- Bug real arreglado: `runtime/bootstrap.sh` escribia `.git-credentials` siempre como `http://`; ahora usa el esquema de `BACKEND_URL` (https por el tunel). Imagen reconstruida.
- `scripts/tunnel.sh up|down|status` (cloudflared instalado en `/usr/local/bin` de WSL, v2026.9.3). Gotcha: en esta maquina QUIC (UDP 7844) falla y el tunel moria al instante; se fuerza `--protocol http2`. La URL queda en `/tmp/tunnel.url` (no se commitea ni se imprime en los smokes).
- Verificacion: `scripts/smoke-remote.sh` -> "OK smoke-remote": docker run sin `--add-host` ni `host.docker.internal`; connect (ACTIVE), clone y checkout del branch, FILE_CREATED visible en la API, IA normal y streaming (SSE) desde el contenedor, push a GitHub, submit COMPLETED con final_sha = HEAD, todo solo por la URL publica. Cleanup del script: borra branch, contenedor, volumen, baja el tunel y reinicia el backend sin `PUBLIC_URL`.
- Estado final verificado: sin proceso `cloudflared`, sin `/tmp/tunnel.url`, backend arriba con `PUBLIC_URL` vacia, sin contenedores. Regresion: smoke-git OK.
- Para usarlo a mano: `./scripts/tunnel.sh up`, `PUBLIC_URL=<url> ./scripts/run-backend.sh`, y al terminar `./scripts/tunnel.sh down` + reiniciar el backend sin `PUBLIC_URL`.

## C6 â€” Capacidad (hecho)
- Entregables: `scripts/load/` (`telemetry-load.js`, `run-load.sh`, `sample-proc.sh`, `measure-container.sh`, `measure-ide.sh`, `measure-load.sh`, `measure-settled.sh`, `open-ide.mjs`) y `docs/feasibility-report.md` con numeros medidos, comando y marca MEDIDO/PROYECTADO/NO MEDIDO.
- Carga contra una instancia de PRUEBA del backend (:9191, H2 en /tmp/loaddb, se borra al terminar); la base real (:9090) quedo intacta (14 sesiones antes y despues). 500 sesiones x 5 min: 0 errores, p99 2 ms. Con 2 cores hasta 3200 req/s (32000 sesiones): 0 errores, p99 9,6 ms. No se hallo el punto de degradacion: a 6400 req/s se saturo el generador (1 proceso Node), no el backend; esa etapa se descarto.
- Contenedor: imagen 3,9 GB en disco, ~1,12 GB comprimida (proxy docker save|gzip), arranque ~3 s, reposo 146 MiB, stack completo asentado 5,1 GB / pico 4,4 GB y 433 % CPU.
- NO medido: docker pull desde GHCR (C4 bloqueado por write:packages), carga sobre proxy git y gateway de IA, limites --memory/--cpus.
- Decisiones: generador en contenedor del runtime (no hay node en WSL); mediciones del contenedor usan el backend real :9090 (la sesion creada queda en su base, como en los smokes). Gotcha: Git Bash expande `$VAR` de scripts pasados inline a `wsl bash -lc`; usar archivos .sh.
- No se toco codigo del producto: no hizo falta re-correr los smokes.

## C7 â€” QA final y demo (hecho salvo CI/GHCR)
- 8/8 smokes OK desde cero; recorrido UI de 12 pasos (Angular, submit, push rechazado post-submit, panel con estado/SHA/CI) grabado a la primera; `demo-narrado.mp4` regenerado (444 s). Persistencia verificada reiniciando el backend tras el recorrido.
- DoD: 1, 3, 5, 6 OK; 2 PARCIAL (CI `none`: sin `ci.yml` en main); 4 NO VALIDADO (GHCR). Ambos bloqueados por scopes `workflow`/`write:packages` de gh; comandos exactos en `qa-manual-report.md` y README ("Pendiente").
- Decisiones: base H2 respaldada en WSL `/tmp/qa-db-backup` y recorrido con base limpia para que el panel muestre solo la sesion de la demo; el recorrido UI se hizo en local (el tunel solo en smoke-remote); variante `narration-paisa.json` no actualizada.
- Error propio: un `git checkout -- .` descarto cambios sin commitear; se reescribieron README/demo desde cero (mismo contenido que se uso en la grabacion).

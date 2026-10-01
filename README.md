# Assessment platform — POC

Monorepo: runtime Docker (code-server + Continue + telemetría), backend Spring Boot (sesiones, proxy git, gateway IA, vista del profesor) y el repo de examen (Spring Boot + Angular).
Diseño: `openspec/changes/assessment-poc/design.md` y `openspec/changes/assessment-poc-closure/design.md`. Capacidad medida: `docs/feasibility-report.md`. QA: `openspec/changes/assessment-poc-closure/qa-manual-report.md`.

Todo Docker y el backend corren **dentro de WSL Ubuntu** (distro en `E:\wsl\Ubuntu`). Los comandos de abajo se ejecutan desde PowerShell/Git Bash en Windows.

## Requisitos

- `.env` en la raíz (no versionado) con `ANTHROPIC_API_KEY`, `GITHUB_TOKEN`, `GITHUB_REPO`, `AI_CHAT_MODEL`, `AI_AUTOCOMPLETE_MODEL`. Opcionales: `RUNTIME_IMAGE`, `PUBLIC_URL`.
- WSL vivo (`vmIdleTimeout=-1` ya está en `.wslconfig`). Si Docker no responde: `wsl -d Ubuntu -u root -- systemctl start docker`.

## 1. Imagen del runtime

Construir (una vez):

```
wsl -d Ubuntu -- bash -lc 'cd /mnt/f/repos/tpi-tup/sandbox-poc && ./scripts/build-runtime.sh'
```

El `docker run` que genera el backend usa `RUNTIME_IMAGE` (default `ghcr.io/daronarg/assessment-runtime:poc`; `run-backend.sh` fuerza `assessment-runtime:poc` local si la variable no está definida).
Publicar en GHCR (paquete privado; requiere `gh auth refresh -h github.com -s workflow,write:packages`):

```
wsl -d Ubuntu -- bash -lc 'cd /mnt/f/repos/tpi-tup/sandbox-poc && ./scripts/publish-runtime.sh'
```

Después agregar `RUNTIME_IMAGE=ghcr.io/daronarg/assessment-runtime:poc` al `.env` y reiniciar el backend.

## 2. Levantar el backend (:9090)

```
wsl -d Ubuntu -- bash -lc 'cd /mnt/f/repos/tpi-tup/sandbox-poc && ./scripts/run-backend.sh'
```

Queda en foreground; para dejarlo en background agregá `setsid nohup ... > /tmp/backend.log 2>&1 &` dentro del `bash -lc`.
Health check: http://localhost:9090/api/exams. H2 en archivo (`backend/data/`, gitignored): sesiones y eventos sobreviven al reinicio; para empezar de cero, borrá esa carpeta con el backend apagado.

## 3. Flujo de una sesión

1. Abrí http://localhost:9090, elegí alumno + examen, **Iniciar**.
2. Copiá el `docker run` que aparece y ejecutalo **en WSL** (`wsl -d Ubuntu`).
3. Abrí http://localhost:8080: IDE con el repo del examen clonado en el branch `session-<id>-<hex>`.
   - Terminal: `./mvnw test` (los tests fallan a propósito hasta implementar `applyDiscount`).
   - Panel **Continue** (barra lateral izquierda): el chat responde vía el gateway del backend.
   - Frontend Angular: `./mvnw spring-boot:run` (:8081) y, en otra terminal, `cd frontend && npm install && npm start` (:4200).
   - `git add/commit/push` desde la terminal: va al backend, que reenvía a GitHub.
4. **Entrega:** `submit` en una terminal del contenedor. Hace commit de lo pendiente, `git push`, espera el último batch de telemetría y le informa al backend el SHA de `HEAD`. La sesión queda `COMPLETED` y su token deja de servir (push, IA, telemetría y connect responden `401`).
5. http://localhost:9090/professor.html: elegí la sesión. Arriba de la timeline se ven estado, SHA final y resultado del CI (con link a la corrida); abajo, la timeline (archivos, comandos, IA, push, entrega). El resultado del CI se consulta a GitHub bajo demanda: `GET /api/sessions/{id}/result`.

## 4. Camino remoto (HTTPS por internet)

Para probar con el backend detrás de una URL pública (sin `--add-host`; el contenedor usa solo esa URL):

```
./scripts/tunnel.sh up                      # dentro de WSL; imprime la URL de cloudflared (requiere cloudflared)
PUBLIC_URL=<url> ./scripts/run-backend.sh   # el docker run generado usa BACKEND_URL=$PUBLIC_URL
./scripts/tunnel.sh down                    # al terminar, y reiniciar el backend SIN PUBLIC_URL
```

El backend no tiene autenticación de usuarios y usa tu API key y token de GitHub: dejá el túnel arriba solo durante la prueba y no publiques la URL. `scripts/smoke-remote.sh` hace todo el ciclo y limpia.

## Pendiente: scopes de `gh`

El token de `gh` de DaronArg tiene solo `gist, read:org, repo`. Para cerrar lo que falta:

1. `gh auth refresh -h github.com -s workflow,write:packages` (en el navegador).
2. **CI:** copiar `exam-template/.github/workflows/ci.yml` a `.github/workflows/` del repo `DaronArg/assessment-exam-template` y pushear a `main`. Hasta entonces el panel muestra el CI como `none` (sin corridas).
3. **GHCR:** `./scripts/publish-runtime.sh`, y verificar con `docker rmi` + `docker pull` + `./scripts/smoke-git.sh`.

## Gotchas

- Cada sesión usa un branch propio `session-<id>-<6 hex>`: no hay choques con branches viejos aunque la base se reinicie. Los smokes y la demo borran los branches que crean.
- Volumen del workspace persistente: `docker volume rm assessment_<id>_workspace` para empezar de cero.
- Smoke tests por slice en `scripts/smoke-*.sh` (se ejecutan dentro de WSL: `runtime`, `backend`, `git`, `telemetry`, `ai`, `submit`, `frontend`, `remote`).
- Git Bash expande `$VAR` en comandos pasados inline a `wsl bash -lc` y mapea `/tmp` y `/mnt/...`: usá `wsl -d Ubuntu -- bash -lc '...'` o archivos `.sh` dentro de WSL. No uses `bash -x` en los smokes (imprime el token de GitHub).
- Demo grabada de punta a punta: `demo/README.md`.

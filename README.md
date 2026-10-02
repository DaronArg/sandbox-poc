# Assessment platform — POC

Monorepo: runtime Docker (code-server + Continue + telemetría + gate), backend Spring Boot (sesiones, proxy git, gateway IA, vista del profesor), el repo de examen (Spring Boot + Angular) y la **app de escritorio del alumno (Electron)**.
Diseño: `openspec/changes/desktop-integration/design.md` (vigente), `openspec/changes/desktop-electron/design.md` (app), `openspec/changes/assessment-poc*/` (POC y cierre). Capacidad medida: `docs/feasibility-report.md`.

```
Alumno → abre la app (Windows) → elige alumno + examen (o Retomar) → la app hace `docker run` dentro de WSL
       → IDE y front del alumno en pestañas dentro de la app → `git push` → `submit` → profesor ve timeline + CI en la web
```

El IDE y el front del alumno **no se pueden usar desde un navegador**: solo entran con la cookie del gate, que conoce únicamente la app.
La API del alumno (`localhost:8081`) se prueba con **Postman o curl**.

> Esta rama está en integración (ver `openspec/changes/desktop-integration/tasks.md`): el examen Angular con rutas relativas, el botón Entregar de la app y el pull de la imagen desde GHCR llegan en las tasks I2 y I3. El flujo web anterior (copiar el `docker run`, `demo/`, camino remoto con túnel) quedó retirado.

## Requisitos de la máquina del alumno

- Windows 10/11 x64.
- **WSL2 con la distro `Ubuntu`** y **Docker Engine con systemd** dentro (sin Docker Desktop). Si Docker no responde: `wsl -d Ubuntu -u root -- systemctl start docker`.
- La imagen `assessment-runtime:poc` en esa distro: `wsl -d Ubuntu -- bash -lc 'cd <repo> && ./scripts/build-runtime.sh'` (o `RUNTIME_IMAGE` apuntando a un registry).
- El backend alcanzable en `http://localhost:9090` (en la POC corre en la misma máquina, dentro de WSL).
- Puerto **8081** libre en Windows.
- `.env` en la raíz (no versionado) con `ANTHROPIC_API_KEY`, `GITHUB_TOKEN`, `GITHUB_REPO`, `AI_CHAT_MODEL`, `AI_AUTOCOMPLETE_MODEL` (lo lee el backend).

## Backend (profesor / infraestructura)

Dentro de WSL, desde la raíz del repo (el repo de Windows se ve en `/mnt/<unidad>/...`):

```
./scripts/run-backend.sh        # foreground, :9090
./scripts/restart-backend.sh    # background (log en /tmp/backend.log) y espera a que responda
```

- H2 **en archivo** (`backend/data/`, ignorado por git): sesiones y eventos sobreviven a reinicios; para empezar de cero, borrá esa carpeta con el backend apagado.
- Variables opcionales: `RUNTIME_IMAGE` (default `assessment-runtime:poc`), `CONTAINER_BACKEND_URL` (default `PUBLIC_URL` si está, si no `http://host.docker.internal:9090`), `PUBLIC_URL`, `DESKTOP_MIN_VERSION` (default `0.1.0`; versiones menores de la app reciben `426`).
- **Vista del profesor (web):** http://localhost:9090/professor.html — timeline por sesión, estado, SHA final y resultado del CI (`GET /api/sessions/{id}/result`, consulta a GitHub bajo demanda), tiempo fuera de la app, salidas y accesos bloqueados (`GATE_ACCESS_DENIED`).
- `http://localhost:9090/` ya no inicia sesiones: solo avisa que se inician desde la app.

## Entrega

`submit` en una terminal del contenedor (la app tendrá un botón Entregar): commit de lo pendiente, `git push`, flush de la telemetría y `POST /submit` con el SHA de `HEAD`. La sesión queda `COMPLETED` y su token deja de servir (push, IA, telemetría, connect y status responden `401`).

## App de escritorio

Instalar: ejecutar `Assessment-Setup-<versión>.exe` (instalador NSIS **sin firmar**, por-máquina: pide elevación). Abrir **Assessment** desde el menú Inicio.

Construir el instalador (Windows, Node 22):

```
powershell -File scripts\build-desktop.ps1     # => desktop\dist\Assessment-Setup-<versión>.exe
```

Desarrollo (`cd desktop`): `npm ci`, `npm start`, `npm test` (unit tests), `npm run test:e2e` (Playwright `_electron`, necesita backend + imagen).
Solo sin empaquetar, variables de prueba: `ASSESSMENT_BACKEND_URL`, `ASSESSMENT_WSL_DISTRO`, `ASSESSMENT_DEV_AUTOSTART=<studentId>,<examId>`, `ASSESSMENT_USER_DATA`, `ASSESSMENT_TEST_DIALOG_LOG`/`_ANSWER`.

Uso:

1. Elegir alumno y examen y **Iniciar** (o **Retomar**: mismo volumen = mismo código).
2. Pestaña **IDE**: code-server con el repo clonado en la rama `session-<id>-<hex>`. Terminal: `./mvnw test`, `./mvnw spring-boot:run` (API en `:8081`), `git add/commit/push`. Continue (chat IA) en la barra lateral.
3. Pestaña **App :4200**: front del examen (ver tarea I2).
4. **Salir** avisa si hay cambios sin subir y apaga el contenedor; el código queda en el volumen.

### Probar la API con Postman / curl

Con `./mvnw spring-boot:run` corriendo en el IDE: `GET http://localhost:8081/api/price?price=200&percent=25` desde Postman, curl o REST Client (`requests.http`). Cualquier request con headers de navegador recibe `403`.

## CI del repo de examen

`.github/workflows/ci.yml` está publicado en `main` de `DaronArg/assessment-exam-template` (fuente: `exam-template/.github/workflows/ci.yml`). Corre `./mvnw test` en cada push; el panel del profesor muestra la conclusión y el link a la corrida.

## Tests de infraestructura (dentro de WSL)

```
./scripts/smoke-all.sh [backend runtime gate git telemetry ai submit]   # sin argumentos: todos los vigentes
```

`smoke-gate.sh` cubre los puntos de `desktop-electron/design.md` §12. `smoke-submit.sh` reinicia el backend. Sin `GITHUB_TOKEN` en `.env`, `git` y `telemetry` usan un upstream git local (`scripts/local-upstream.sh`) y `smoke-submit` no corre; sin `ANTHROPIC_API_KEY`, `smoke-ai.sh` verifica solo lo que no llama a Anthropic.
`scripts/publish-runtime.sh` publica la imagen en GHCR; `scripts/load/` tiene la carga de telemetría usada en `docs/feasibility-report.md` (mediciones del flujo web anterior).

## Gotchas

- Ramas, contenedores y volúmenes llevan un sufijo aleatorio (`session-<id>-<hex>`): no colisionan al reiniciar el backend. Volumen: `docker volume rm assessment_<id>_<hex>_workspace` para empezar de cero esa sesión.
- Git Bash expande `$VAR` en comandos inline a `wsl bash -lc` y mapea `/tmp` y `/mnt/...`: usá `wsl -d Ubuntu -- bash -lc '...'` o archivos `.sh` dentro de WSL. No uses `bash -x` en los smokes (imprime tokens).
- Límites aceptados del bloqueo (ver `desktop-electron/design.md` §5.6): quien tenga acceso a Docker en su WSL puede leer la clave del gate; el instalador no está firmado.

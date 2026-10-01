# Assessment platform — POC

Monorepo: runtime Docker (code-server + Continue + telemetría + gate), backend Spring Boot (sesiones, proxy git, gateway IA, vista del profesor), el repo de examen y la **app de escritorio del alumno (Electron)**.
Diseño: `openspec/changes/assessment-poc/design.md` (POC) y `openspec/changes/desktop-electron/design.md` (app desktop; es lo vigente para el flujo del alumno).

```
Alumno → abre la app (Windows) → elige alumno + examen (o Retomar) → la app hace `docker run` dentro de WSL
       → IDE y front del alumno en pestañas dentro de la app → `git push` → profesor ve la timeline en la web
```

El IDE y el front del alumno **no se pueden usar desde un navegador**: solo entran con la cookie del gate, que conoce únicamente la app.
La API del alumno (`localhost:8081`) se prueba con **Postman o curl** (los navegadores quedan bloqueados).

## Requisitos de la máquina del alumno

- Windows 10/11 x64.
- **WSL2 con la distro `Ubuntu`** y **Docker Engine con systemd** dentro (sin Docker Desktop). Si Docker no responde: `wsl -d Ubuntu -u root -- systemctl start docker`.
- La imagen `assessment-runtime:poc` construida en esa distro (todavía no hay registry): `wsl -d Ubuntu -- bash -lc 'cd <repo> && ./scripts/build-runtime.sh'`.
- El backend alcanzable en `http://localhost:9090` (en la POC corre en la misma máquina, dentro de WSL).
- Puerto **8081** libre en Windows.
- `.env` en la raíz del repo (no versionado) con `ANTHROPIC_API_KEY`, `GITHUB_TOKEN`, `GITHUB_REPO`, `AI_CHAT_MODEL`, `AI_AUTOCOMPLETE_MODEL` (lo lee el backend).

## Backend (profesor / infraestructura)

Dentro de WSL, desde la raíz del repo (el repo de Windows se ve en `/mnt/<unidad>/...`):

```
./scripts/run-backend.sh        # foreground, :9090
./scripts/restart-backend.sh    # background (log en /tmp/backend.log) y espera a que responda
```

- H2 **en archivo** (`backend/data/`, ignorado por git): sesiones y eventos sobreviven a reinicios.
- Variables opcionales: `RUNTIME_IMAGE` (default `assessment-runtime:poc`), `CONTAINER_BACKEND_URL` (default `http://host.docker.internal:9090`), `DESKTOP_MIN_VERSION` (default `0.1.0`; versiones menores de la app reciben `426`).
- **Vista del profesor (web):** http://localhost:9090/professor.html — timeline por sesión, tiempo fuera de la app, salidas y accesos bloqueados (`GATE_ACCESS_DENIED`).
- `http://localhost:9090/` ya no inicia sesiones: solo avisa que se inician desde la app.

## App de escritorio

Instalar: ejecutar `Assessment-Setup-<versión>.exe` (instalador NSIS **sin firmar**, por-máquina: pide elevación y copia a `Program Files`). Abrir **Assessment** desde el menú Inicio.

Construir el instalador (Windows, Node 22):

```
powershell -File scripts\build-desktop.ps1     # => desktop\dist\Assessment-Setup-<versión>.exe
```

Desarrollo (`cd desktop`): `npm ci`, `npm start` (compila y abre la app), `npm test` (unit tests), `npm run test:e2e` (Playwright `_electron`, necesita backend + imagen + upstream git).
Solo sin empaquetar, variables de prueba: `ASSESSMENT_BACKEND_URL`, `ASSESSMENT_WSL_DISTRO`, `ASSESSMENT_DEV_AUTOSTART=<studentId>,<examId>`, `ASSESSMENT_USER_DATA`, `ASSESSMENT_TEST_DIALOG_LOG`/`_ANSWER`.

Uso:

1. Elegir alumno y examen y **Iniciar** (o **Retomar** la sesión anterior: mismo volumen = mismo código; **Iniciar otra sesión** la reemplaza).
2. Pestaña **IDE**: code-server con el repo clonado en la rama `session-<id>-<hex>`. Terminal: `./mvnw test`, `./mvnw spring-boot:run` (API en `:8081`), `git add/commit/push` (va al backend, que reenvía a GitHub). Continue (chat IA) en la barra lateral.
3. Pestaña **App :4200**: en la terminal del IDE `cd frontend && npm install && npm run dev`; el front llama a `/api` relativo y Vite lo reenvía a la API.
4. **Salir** avisa si hay cambios sin subir y apaga el contenedor; el código queda en el volumen para retomar.

### Probar la API con Postman / curl

Con `./mvnw spring-boot:run` corriendo en el IDE: `GET http://localhost:8081/api/price?price=200&percent=25` desde **Postman**, curl o la extensión REST Client del IDE (`requests.http`). Cualquier request con headers de navegador (`Sec-Fetch-*`, `Origin`) recibe `403`.

## Tests de infraestructura (dentro de WSL)

```
./scripts/smoke-all.sh [backend runtime gate git telemetry ai exam]   # sin argumentos: todos
```

`smoke-gate.sh` cubre los 9 puntos de `desktop-electron/design.md` §12. Sin `GITHUB_TOKEN` en `.env` los smokes que clonan/pushean usan un upstream git local (`scripts/local-upstream.sh`); sin `ANTHROPIC_API_KEY`, `smoke-ai.sh` verifica solo lo que no llama a Anthropic.

## Gotchas

- **CI no corre todavía:** el repo de examen publicado no tiene `.github/workflows/ci.yml` (el token de `gh` no tenía scope `workflow`). Para completarlo: `gh auth refresh -h github.com -s workflow`, copiar `exam-template/.github/workflows/ci.yml` al repo y pushear a `main`.
- Ramas, contenedores y volúmenes llevan un sufijo aleatorio (`session-<id>-<hex>`), así que ya no colisionan al reiniciar el backend.
- Volumen del workspace persistente: `docker volume rm assessment_<id>_<hex>_workspace` para empezar de cero esa sesión.
- **`demo/` muestra el flujo web anterior** (página del alumno con el `docker run`, IDE en `localhost:8080`); está desactualizada y no se regrabó.
- Límites aceptados del bloqueo (ver `desktop-electron/design.md` §5.6): quien tenga acceso a Docker en su WSL puede leer la clave del gate; el instalador no está firmado.

# Assessment — App desktop con Electron (spec de diseño)

Fecha: 2026-10-01 · Continúa `openspec/changes/assessment-poc/design.md` (leerlo primero; todo lo de ahí sigue vigente salvo lo que se cambia acá).
Fuentes: `handoff_arquitectura_assessment_platform_tecnico (1).md` §9.5, §30–§32, §38–§40; decisiones del usuario tomadas el 2026-10-01 (§2).

## 1. Objetivo

Reemplazar el acceso web del alumno por una **aplicación de escritorio instalable (Electron)**. La app:

1. deja elegir alumno y examen (o retomar la sesión anterior),
2. levanta por detrás **el mismo y único contenedor** de hoy (IDE, repo clonado, tests, API, front, git, telemetría, IA),
3. muestra el IDE y el front del alumno **dentro de la app**, en pestañas,
4. hace imposible usar el IDE o el front desde un navegador.

```
HOY       Alumno → localhost:9090 → copia docker run → lo pega en WSL → abre localhost:8080 en el navegador
CON APP   Alumno → abre la app → elige alumno + examen → la app hace docker run → IDE y App en pestañas de la app
```

Lo que **no** cambia: el contenedor sigue siendo uno solo y contiene todo; telemetría, proxy git, AI Gateway y backend
de sesiones siguen donde están (handoff §39: "NO deberían migrarse a Electron"). Electron solo orquesta y muestra.

## 2. Decisiones del usuario

| Tema | Decisión |
|---|---|
| Base | Se construye **sobre el estado actual** de `poc/assessment-platform`, sin esperar el cierre de factibilidad. Se trae del cierre solo lo imprescindible (§6.1). |
| SO y Docker | **Solo Windows + Docker Engine dentro de WSL** (como hoy, `design.md` §12.1). Sin Docker Desktop. |
| Navegador | **Nunca** se puede usar el IDE ni el front desde un navegador. |
| Probar la API | **Postman** (o curl) sobre `localhost:8081` sigue funcionando. Los navegadores quedan bloqueados también en ese puerto (§5.3). |
| Identidad | Lista de alumnos y exámenes, como hoy. Sin login. |
| Entrega | **No hay entrega.** Como hoy, el alumno hace `git push`. Cerrar la app apaga el contenedor. |
| Lockdown | **Medio**: ventana maximizada sin menú, sin DevTools, sin links externos, telemetría de foco. |
| Profesor | `professor.html` **sigue web**. Se elimina la página web del alumno (`index.html` con el `docker run`). |
| Layout | **Una ventana con pestañas** `IDE` y `App`, más barra superior con estado. |
| Reapertura | **Retoma la sesión** guardada (mismo volumen = mismo código) o permite iniciar una nueva. |
| Distribución | **Instalador NSIS `.exe` sin firmar** (electron-builder), con fuses e integridad del asar. |
| Stack | **TypeScript + HTML/CSS sin framework**. |

## 3. Fuera de alcance

Login, botón de entrega/submit, tiempo límite, CI y resultado en el panel, Angular en el examen, imagen en registry
(GHCR), túnel remoto, medición de capacidad (todo eso es del cierre de factibilidad), Docker Desktop, macOS/Linux,
firma de código, auto-update, modo profesor en la app, kiosko/pantalla completa forzada, protección contra capturas,
bloqueo de portapapeles y de arrastrar archivos, regrabar la demo (`demo/` queda desactualizada; se anota en el README).

## 4. Arquitectura

```
                      INTERNET:  GitHub · Anthropic
                                     ▲
═════════════════════════════════════╪══════════════════════════════════════════
 PC DEL ALUMNO (Windows)             │
                                     │
 ┌──────────────── App desktop (Electron) ──────────────────┐
 │ main process: WSL/Docker, sesión, clave del gate,         │
 │               cookies, seguridad, telemetría desktop      │
 │ ventana: barra superior + pestañas                        │
 │   [IDE] WebContentsView → http://ide.localhost:<P>        │──┐ cookie del gate
 │   [App] WebContentsView → http://app.localhost:<P>        │──┤ (solo la tiene la app)
 └───────────────┬───────────────────────────────────────────┘  │
                 │ wsl.exe -d Ubuntu -- docker ...               │
 ┌───────────────▼──────────── WSL Ubuntu ───────────────────────▼──────────┐
 │ Backend :9090 (Spring) ── proxy git · AI gateway · telemetría · sesiones  │
 │        ▲                                                                  │
 │        │ host.docker.internal:9090                                        │
 │ ┌──────┴──────────── contenedor assessment-runtime (UNO SOLO) ─────────┐  │
 │ │  gate (usuario gate)                                                 │  │
 │ │   :7000 ◄── 127.0.0.1:<P aleatorio>   exige cookie                   │  │
 │ │      ide.localhost → 127.0.0.1:8080 code-server                      │  │
 │ │      app.localhost → 127.0.0.1:4200 front del alumno (Vite)          │  │
 │ │   :9081 ◄── 127.0.0.1:8081            rechaza navegadores            │  │
 │ │      → 127.0.0.1:8081 API Spring del alumno (Postman / curl)         │  │
 │ │  code-server, Continue, JDK, Maven, Node, git, agente de telemetría  │  │
 │ │  (usuario coder, sin sudo)            /workspace = volumen           │  │
 │ └──────────────────────────────────────────────────────────────────────┘  │
 └───────────────────────────────────────────────────────────────────────────┘
```

Flujo de inicio:

1. La app verifica WSL, la distro, Docker y la imagen (§7.3).
2. `POST /api/sessions` al backend → `{sessionId, token, branch, containerName, volume, image, containerBackendUrl}`.
3. `docker run` (§6.4) desde el main process.
4. Lee el puerto asignado (`docker port`) y la clave del gate (`docker exec -u root ... cat /run/gate/key`).
5. Setea la cookie del gate en una sesión de Electron **en memoria** y carga `http://ide.localhost:<P>/`.
6. Mientras dura la sesión: estado del contenedor, pestaña App, telemetría de foco.
7. Al cerrar: aviso de cambios sin pushear, flush de telemetría, `docker stop`.

Chromium resuelve todo `*.localhost` a `127.0.0.1`, así que `ide.localhost:<P>` y `app.localhost:<P>` llegan al mismo
puerto publicado, y el gate enruta por el header `Host`. El reenvío de localhost de WSL lleva ese puerto a Windows (ya probado
con 8080 en el QA de la POC).

## 5. Bloqueo del navegador

### 5.1 Modelo

| Puerto host | Qué hay detrás | Regla |
|---|---|---|
| `127.0.0.1:<P>` (aleatorio, `-p 127.0.0.1::7000`) | IDE y front | Solo pasa con la cookie `assessment_gate=<clave>`. La clave es aleatoria por contenedor y solo la conoce la app. |
| `127.0.0.1:8081` (fijo, para Postman) | API del alumno | Se rechaza todo request con algún header `Sec-Fetch-*` u `Origin`. |
| 8080, 4200 | — | **Ya no se publican.** code-server escucha en `127.0.0.1:8080` dentro del contenedor. |

Por qué alcanza con `Sec-Fetch-*` para el 8081: los navegadores actuales (Chromium, Firefox ≥ 90, Safari ≥ 16.4) mandan
`Sec-Fetch-Site/Mode/Dest` en **todo** request, incluida la navegación por la barra de direcciones, y una página no puede
sacarlos (son *forbidden headers*). Postman desktop y curl no los mandan. Esto también cierra el bypass de "el alumno
levanta en el 8081 un proxy hacia code-server y lo abre en Chrome".

### 5.2 Gate del puerto UI (:7000)

- Al arrancar genera la clave (32 bytes aleatorios en hex) y la escribe en `/run/gate/key`, dueño `gate`, modo `600`.
- Lee la cookie `assessment_gate` y la compara con `crypto.timingSafeEqual`.
- Sin cookie válida → `403` con una página HTML: *"Este entorno solo se puede usar desde la aplicación de escritorio Assessment."*
- Enruta por `Host` (sin puerto): `ide.localhost` → `127.0.0.1:8080`; `app.localhost` → `127.0.0.1:4200`; otro → `404`.
- Upstream caído → `502` con una página *"La app no está levantada. Corré `npm run dev` en la terminal del IDE."*
- **Saca la cookie `assessment_gate` del header `Cookie` antes de reenviar**: el front (Vite) es código del alumno y podría
  loguear headers; así la clave nunca llega a un proceso del alumno.
- Preserva el `Host` original (code-server compara `Origin` con `Host` en los WebSocket) y agrega `X-Forwarded-*`.
- Aplica lo mismo al evento `upgrade` (WebSocket de code-server y HMR de Vite).

### 5.3 Gate del puerto API (:9081 → 8081)

- Si el request trae algún header que empiece con `sec-fetch-` o trae `origin` → `403` JSON `{"error":"Solo Postman/curl: los navegadores no pueden acceder a este puerto"}`.
- Si no, proxy transparente a `127.0.0.1:8081` (HTTP y upgrade). Upstream caído → `502` JSON.
- El front del alumno **no** usa este puerto: llama a `/api` relativo y Vite lo reenvía por dentro (§6.6).

### 5.4 Registro de intentos

Cada `403` del gate agrega una línea JSON a `/var/log/gate/denied.log` (`{port, host, path, userAgent, timestamp}`), como
máximo una línea cada 30 s por combinación `port+host`. El agente de telemetría la sigue y emite `GATE_ACCESS_DENIED`.
El profesor ve en la timeline si alguien intentó abrir el entorno desde un navegador.

### 5.5 Por qué el alumno no puede leer la clave desde el IDE

- El usuario `coder` (el de las terminales del IDE) **no tiene sudo** (se borra `/etc/sudoers.d/nopasswd` de la imagen base).
- El gate corre como usuario `gate`. `coder` no puede leer `/run/gate/key` ni matar el proceso.
- La clave no viaja por variable de entorno (no aparece en `docker inspect` ni en `env`).
- `--security-opt no-new-privileges` impide escalar con binarios setuid.

### 5.6 Límites conocidos (aceptados)

Coherente con handoff §30 ("no existe 100% anti-cheat cuando el alumno controla el hardware"):

- El alumno tiene acceso a Docker en su WSL: con `docker exec -u root` puede leer la clave y armar la cookie en un navegador.
  Requiere intención y conocimiento; no hay mitigación sin quitarle Docker.
- Una extensión de navegador que reescriba headers podría quitar `Sec-Fetch-*` para el 8081.
- El instalador no está firmado: el `.exe` de Electron puede parchearse (por ejemplo, revertir fuses). La integridad del asar
  frena la edición de los archivos de la app, no del binario.
- El `SESSION_TOKEN` sigue visible dentro del contenedor (`env`), como hoy (`design.md` §8).

## 6. Cambios en contenedor, backend y examen

### 6.1 Backend (se trae lo mínimo del cierre C1)

**Persistencia** (necesaria para "retomar"):
- `spring.datasource.url=jdbc:h2:file:./data/assessment;AUTO_SERVER=TRUE`; `backend/data/` en `.gitignore`.
- `schema.sql` con `CREATE TABLE IF NOT EXISTS`; `data.sql` con `MERGE INTO ... KEY(id)` para que los seeds no dupliquen.

**Nombres sin colisión:** al crear la sesión se generan 6 hex aleatorios (`HexFormat.of().formatHex(3 bytes)`):
- `branch = session-<id>-<hex>`
- `containerName = assessment-<id>-<hex>`
- `volume = assessment_<id>_<hex>_workspace`

Columnas nuevas en `session`: `container_name VARCHAR(100)`, `volume VARCHAR(100)`.

**Contrato:**

| Método y ruta | Auth | Cambio |
|---|---|---|
| `GET /` | — | `index.html` pasa a ser un aviso: *"Las sesiones de alumno se inician desde la app de escritorio"* y un link a `professor.html`. Se borra el formulario. |
| `POST /api/sessions` `{studentId, examId}` | header `X-Desktop-Version` | Devuelve `{sessionId, token, branch, containerName, volume, image, containerBackendUrl, studentName, examTitle}`. **Se elimina `dockerRun`.** `image` = env `RUNTIME_IMAGE` (default `assessment-runtime:poc`); `containerBackendUrl` = env `CONTAINER_BACKEND_URL` (default `http://host.docker.internal:9090`). |
| `GET /api/sessions/{id}/status` | Bearer + `X-Desktop-Version` | **Nuevo.** `{sessionId, status, branch, containerName, volume, image, containerBackendUrl, studentName, examTitle}`. Lo usa "Retomar". `401` si el token no corresponde. |
| `POST /api/sessions/{id}/connect` | Bearer | Además devuelve `nextSequence` = `MAX(sequence)+1` de la sesión. |
| `POST /api/sessions/{id}/desktop-events` `{events:[{type, timestamp, payload}]}` | Bearer | **Nuevo.** Inserta cada evento con `EventService.record` (el backend asigna `sequence`) respetando el `timestamp` del cliente. Tipos aceptados: los de §7.6; otro tipo → `400`. |

**Versión mínima de la app:** env `DESKTOP_MIN_VERSION` (default `0.1.0`). En `POST /api/sessions` y `GET .../status`, si
`X-Desktop-Version` falta o es menor (comparación semver numérica `major.minor.patch`) → `426 {error, minVersion}`.

### 6.2 Imagen `assessment-runtime:poc`

Cambios al `Dockerfile`:
- `rm -f /etc/sudoers.d/nopasswd` (y verificar que `sudo -n true` falla como `coder`).
- `useradd --system --no-create-home --shell /usr/sbin/nologin gate`.
- `COPY gate /opt/gate` + `npm install --omit=dev` (dependencia única: `http-proxy`).
- `COPY session.sh /usr/local/bin/session.sh`.
- Termina con `USER root` (el entrypoint baja privilegios). `EXPOSE 7000 9081`.
- `continue` y Java pack siguen preinstaladas. Se agrega la extensión **REST Client** (`humao.rest-client`, Open VSX) como alternativa a Postman dentro del IDE.

### 6.3 Arranque del contenedor

`bootstrap.sh` (ENTRYPOINT, corre como **root**):

1. `mkdir -p /run/gate /var/log/gate`; `chown gate:gate` ambos; `chmod 700 /run/gate`; `chmod 755 /var/log/gate`.
2. Lanza el gate en background: `setpriv --reuid=gate --regid=gate --clear-groups node /opt/gate/gate.js &`.
3. `exec setpriv --reuid=coder --regid=coder --init-groups env HOME=/home/coder /usr/local/bin/session.sh`.

`session.sh` (corre como **coder**) = lógica actual del `bootstrap.sh` con estos cambios:
- **Se elimina el modo standalone sin gate.** Sin `SESSION_TOKEN` igual levanta code-server detrás del gate, sin connect ni clone (sirve para probar la imagen).
- `settings.json` de code-server agrega `"remote.autoForwardPorts": false` y `"workbench.startupEditor": "none"` (evita el aviso "Open in Browser").
- Exporta `NEXT_SEQUENCE` desde `/tmp/connect.json` para el agente.
- `exec code-server --auth none --bind-addr 127.0.0.1:8080 /workspace` (antes `0.0.0.0`).

El contenedor corre con `--init` (tini como PID 1 reapea procesos y reenvía señales).

### 6.4 `docker run` (lo arma la app, nunca el backend ni el alumno)

Se ejecuta como array de argumentos (`execFile`, sin shell):

```
wsl.exe -d <distro> -- docker run -d --init --rm
  --name <containerName>
  --security-opt no-new-privileges
  -p 127.0.0.1::7000
  -p 127.0.0.1:8081:9081
  --add-host=host.docker.internal:host-gateway
  -e SESSION_ID=<sessionId> -e SESSION_TOKEN=<token> -e BACKEND_URL=<containerBackendUrl>
  -v <volume>:/workspace
  <image>
```

Antes de usarlos, la app valida los valores del backend: `containerName` y `volume` contra `^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,99}$`,
`image` contra `^[a-z0-9./:_-]+$`, `token` contra UUID, `containerBackendUrl` como `http(s)://`.

### 6.5 Agente de telemetría

- `sequence` arranca en `NEXT_SEQUENCE` (no en 1) para no repetir números al retomar.
- Sigue `/var/log/gate/denied.log` igual que `commands.log` → `GATE_ACCESS_DENIED`.
- `SIGTERM` → flush inmediato de la cola (timeout 4 s) y `exit 0`.

### 6.6 Repo de examen (`exam-template/` + `DaronArg/assessment-exam-template`, branch `main`)

- `frontend/main.js`: `const API = ''` (llamadas a `/api/price` relativas).
- `frontend/vite.config.js`: `server.proxy = { '/api': 'http://127.0.0.1:8081' }`; se mantiene `host 0.0.0.0`, `port 4200`, `strictPort`.
- `PriceController`: se borra `@CrossOrigin` (ya no hay llamadas cross-origin).
- `README` del examen: probar la API con Postman/curl en `localhost:8081` o con REST Client (`requests.http` de ejemplo en la raíz).
- `PriceService.applyDiscount` y los tests siguen fallando a propósito.

## 7. App desktop

### 7.1 Estructura (`desktop/` en el monorepo)

```
desktop/
├── package.json            # electron, typescript, electron-builder, @electron/fuses, @playwright/test
├── tsconfig.json
├── electron-builder.yml
├── config.json             # defaults de build (§7.2), queda dentro del asar
├── build/icon.ico
├── src/
│   ├── main/
│   │   ├── index.ts        # ciclo de vida, single-instance lock, ventana
│   │   ├── config.ts       # config.json (+ overrides por env solo si !app.isPackaged)
│   │   ├── wsl.ts          # wsl.exe: distro, comandos, decodificación UTF-16 de mensajes de wsl
│   │   ├── docker.ts       # info, image inspect, run, port, exec, inspect, stop, rm (sobre wsl.ts)
│   │   ├── backend.ts      # cliente HTTP del backend con X-Desktop-Version
│   │   ├── environment.ts  # orquestación: checks → sesión → contenedor → gate → IDE listo
│   │   ├── gate.ts         # clave, cookies en la partición en memoria
│   │   ├── views.ts        # WebContentsView IDE/App, layout, pestañas, polling de App
│   │   ├── security.ts     # navegación, permisos, descargas, atajos, CSP
│   │   ├── store.ts        # sesión guardada cifrada con safeStorage (DPAPI)
│   │   ├── telemetry.ts    # cola de eventos DESKTOP_* → /desktop-events
│   │   └── ipc.ts          # handlers con validación del sender
│   ├── preload/shell.ts    # contextBridge: API mínima para la UI
│   └── renderer/
│       ├── shell.html      # pantallas: inicio, progreso, error, workspace (barra + pestañas)
│       ├── shell.css
│       └── shell.ts
└── e2e/desktop.spec.ts     # Playwright `_electron`
```

Build: `tsc` (main y preload en CommonJS, renderer en ES module). Electron: última estable al implementar (≥ 33, por `WebContentsView`).

### 7.2 Configuración

`config.json` (empaquetado, el alumno no lo edita):

```json
{ "backendUrl": "http://localhost:9090", "wslDistro": "Ubuntu", "ideReadyTimeoutSec": 180, "telemetryFlushSec": 10 }
```

Con `!app.isPackaged` se aceptan overrides por env (`ASSESSMENT_BACKEND_URL`, `ASSESSMENT_WSL_DISTRO`) para desarrollo.
`containerBackendUrl` e `image` vienen del backend, no de la app.

### 7.3 Pantallas y flujo

**Inicio**
- Si hay sesión guardada y `GET .../status` responde `200`: tarjeta *"Retomar: <alumno> · <examen> (rama <branch>)"* con botón **Retomar** y link **Iniciar otra sesión**.
- Si no: combos de alumno (`/api/students`) y examen (`/api/exams`) y botón **Iniciar**.
- Status `401` o `404` → se borra la sesión guardada y se muestra el formulario.

**Progreso** (lista de pasos con ✓ / ⏳ / ✗):

| Paso | Cómo | Si falla |
|---|---|---|
| WSL | `wsl.exe --status` | "Instalá WSL: `wsl --install`" |
| Distro | `wsl.exe -l -q` contiene `wslDistro` | "No se encontró la distro Ubuntu en WSL" |
| Docker | `docker info --format {{.ServerVersion}}`; si falla, un intento de `wsl -d <distro> -u root -- systemctl start docker` y reintento | "Docker no responde dentro de WSL" |
| Backend | `GET /api/exams` | "No se puede conectar con el servidor de la plataforma" |
| Sesión | `POST /api/sessions` o `GET .../status` | `426` → "Actualizá la aplicación (versión mínima X)" |
| Imagen | `docker image inspect <image>` | "Falta la imagen `<image>`: corré `scripts/build-runtime.sh`" |
| Contenedor | `docker rm -f <containerName>` (si quedó de un cierre abrupto) → `docker run` (§6.4) | `port is already allocated` → "El puerto 8081 está ocupado; cerrá lo que lo use". Otro → últimas 30 líneas de `docker logs`. |
| Gate | `docker port <c> 7000/tcp` → `<P>`; `docker exec -u root <c> cat /run/gate/key` (reintenta 10 s) | contenedor terminó → `docker logs` |
| IDE | cookie seteada; `session.fetch(http://ide.localhost:<P>/healthz)` hasta `200` (timeout `ideReadyTimeoutSec`) | timeout → `docker logs` + **Reintentar** |

**Workspace**
- Barra superior de 44 px: `<alumno> · <examen> · ● activa` | pestañas **IDE** y **App :4200** | botón ↻ (recarga la vista activa) | **Salir**.
- Pestaña App: cada 3 s, `session.fetch(http://app.localhost:<P>/)`. Con `502`, la pestaña muestra un placeholder propio (*"Tu front no está levantado. En la terminal del IDE: `cd frontend && npm install && npm run dev`"*). Con `200`, carga la vista. Si vuelve a caer, se vuelve al placeholder.
- Cada 5 s, `docker inspect -f {{.State.Running}}`. Si el contenedor se cae → pantalla de error *"El entorno se detuvo"* con **Reiniciar** (vuelve a Progreso; el volumen conserva el código).

**Error**: mensaje, detalle desplegable (logs) y botones **Reintentar** / **Salir**.

### 7.4 Sesión guardada

`store.ts` guarda `{sessionId, token}` cifrado con `safeStorage.encryptString` en `%APPDATA%/<app>/session.bin`. El resto de
los datos se piden al backend (`status`). "Iniciar otra sesión" pide confirmación y reemplaza lo guardado. El volumen de la
sesión anterior no se borra.

### 7.5 Cierre

Al pedir **Salir** o cerrar la ventana (`close` con `preventDefault`):

1. `docker exec -u coder <c> git -C /workspace status --porcelain` y `git log --oneline @{u}..` (si no hay upstream, cuenta todos los commits de la rama).
2. Diálogo: *"Se va a apagar el entorno. Tu código queda guardado en este equipo para retomar."*; si hay cambios sin commitear o commits sin pushear se agrega *"Tenés cambios sin subir a GitHub (git push)."*. Botones **Salir** / **Cancelar**.
3. Overlay "Apagando entorno…": evento `DESKTOP_CLOSED` + flush de telemetría desktop; `docker exec -u root <c> pkill -TERM -f telemetry/agent.js` y espera hasta 5 s; `docker stop -t 10 <c>`.
4. `app.exit(0)`.

Con cierre abrupto (crash, kill) el contenedor queda corriendo. Al reabrir, el paso Contenedor hace `docker rm -f` y lo recrea.

### 7.6 Telemetría desktop

Cola en memoria, `POST /api/sessions/{id}/desktop-events` cada `telemetryFlushSec` y en el cierre; si falla, reintenta en el próximo ciclo.

| Evento | Cuándo | Payload |
|---|---|---|
| `DESKTOP_STARTED` | IDE listo | `{version, resumed}` |
| `DESKTOP_FOCUS_LOST` | `blur` o `minimize` de la ventana | `{}` |
| `DESKTOP_FOCUS_GAINED` | `focus` o `restore` | `{awayMs}` |
| `DESKTOP_TAB_CHANGED` | cambio de pestaña | `{tab: "IDE"\|"APP"}` |
| `DESKTOP_CLOSED` | cierre normal | `{}` |

### 7.7 Lockdown medio y seguridad de Electron

**Ventana**
- `show` maximizada, `minWidth 1100`, `minHeight 700`, `Menu.setApplicationMenu(null)`, `autoHideMenuBar`.
- Título fijo *"Assessment — <alumno> · <examen>"*.
- `app.requestSingleInstanceLock()`: una segunda instancia enfoca la existente.

**Todas las `webContents`** (shell, IDE, App)
- `contextIsolation: true`, `sandbox: true`, `nodeIntegration: false`, `devTools: false`, `webviewTag: false`, `spellcheck: false`.
- Las vistas IDE y App usan `partition: "assessment"` (sin `persist:` = en memoria; la cookie no toca el disco) y no tienen preload.
- `setWindowOpenHandler(() => ({ action: 'deny' }))`.
- `will-navigate` y `will-redirect`: solo el mismo origen de cada vista. Nunca se llama a `shell.openExternal`.
- `before-input-event`: se ignoran F12, Ctrl+Shift+I/J/C y Ctrl+U.
- `will-download`: `preventDefault`.
- Permisos (`setPermissionRequestHandler` y `setPermissionCheckHandler`): solo `clipboard-read` y `clipboard-sanitized-write` para el origen `ide.localhost`; todo lo demás se rechaza.

**Shell**
- Se carga desde `file://` dentro del asar con CSP `default-src 'self'; script-src 'self'; style-src 'self'`.
- IPC: todo handler valida `event.senderFrame.url` contra la URL de `shell.html`.
- El preload expone solo: `listStudents`, `listExams`, `getSaved`, `start`, `resume`, `newSession`, `retry`, `switchTab`, `reload`, `quit` y `onState`.

**Fuses** (`@electron/fuses`, en `afterPack` de electron-builder):
- `RunAsNode=false`, `EnableNodeOptionsEnvironmentVariable=false`, `EnableNodeCliInspectArguments=false`.
- `EnableEmbeddedAsarIntegrityValidation=true`, `OnlyLoadAppFromAsar=true`, `EnableCookieEncryption=true`, `GrantFileProtocolExtraPrivileges=false`.

**Lo que no se bloquea** (lockdown medio, decisión §2): Alt+Tab, otras apps, portapapeles, arrastrar archivos al IDE. El foco se registra (§7.6).

### 7.8 Empaquetado

`electron-builder.yml`:
- `appId: ar.utn.tup.assessment`, `productName: Assessment`.
- `asar: true`, target `nsis` x64, `nsis.perMachine: true` (instala en Program Files: el alumno sin elevar no puede tocar los archivos), `oneClick: false`.
- Sin firma.

Comando: `cd desktop && npm ci && npm run dist` → `desktop/dist/Assessment-Setup-<version>.exe`. Script `scripts/build-desktop.ps1`.
Corre en Windows (Node 22, igual que `demo/`).

### 7.9 Vista del profesor

`professor.html` agrega arriba de la timeline:
- Tiempo total fuera de la app: suma de `awayMs` y cantidad de salidas.
- Cantidad de `GATE_ACCESS_DENIED`.

En la timeline, las filas `DESKTOP_FOCUS_*` y `GATE_ACCESS_DENIED` se resaltan.

## 8. Requisitos de la máquina del alumno

Windows 10/11 x64; WSL2 con la distro `Ubuntu` y Docker Engine con systemd (como `design.md` §12.1); la imagen
`assessment-runtime:poc` construida en esa distro (`scripts/build-runtime.sh`), porque todavía no hay registry; el backend
alcanzable en `localhost:9090` (en la POC corre en la misma máquina, dentro de WSL); puerto 8081 libre.

## 9. Compatibilidad con el cierre de factibilidad

Cuando se implemente `assessment-poc-closure`:
- **C1:** la persistencia y el branch con hex ya quedan hechos acá; el `submit` se agrega como botón en la barra si se decide.
- **C3:** `ng serve` necesita `proxy.conf.json` para `/api` y aceptar el host `app.localhost`.
- **C4:** `RUNTIME_IMAGE` pasa a apuntar a GHCR y el paso Imagen agrega `docker pull`.
- **C5:** con `PUBLIC_URL`, el backend devuelve ese valor como `containerBackendUrl`.

## 10. Riesgos a verificar al implementar

| Riesgo | Verificación | Plan B |
|---|---|---|
| El reenvío de localhost de WSL no lleva a Windows un puerto publicado dinámicamente | E2 `smoke-gate.sh` desde Windows (`curl.exe`) | Puerto fijo configurable (`127.0.0.1:47000:7000`) |
| code-server rechaza WebSocket por `Origin`/`Host` detrás del gate | E4: el IDE carga y la terminal abre | Flag `--trusted-origins ide.localhost` |
| El cliente HMR de Vite intenta conectar a `:4200` en vez del puerto del gate | E3/E5: editar `main.js` recarga la pestaña App | `server.hmr.clientPort` vía env `GATE_PORT` exportado por `session.sh`, o HMR desactivado (recarga completa con ↻) |
| `session.fetch` y las cookies de la partición en memoria no aplican al service worker de code-server | E4: abrir un webview (Continue) | Además de la cookie, inyectar header con `webRequest.onBeforeSendHeaders` y que el gate acepte cualquiera de los dos |
| La integridad embebida del asar no está soportada en Windows en la versión elegida | E7: modificar `app.asar` instalado → la app no arranca | Documentar como límite; mantener los demás fuses |
| Mensajes de `wsl.exe` en UTF-16LE | Unit test de `wsl.ts` con salida real | — |

## 11. Slices

| # | Slice | Depende de | Verificación |
|---|---|---|---|
| E1 | Backend: persistencia, nombres con hex, contrato nuevo, `status`, `desktop-events`, `nextSequence`, versión mínima, `index.html` | — | `smoke-backend.sh` actualizado: reinicio conserva datos; dos sesiones con rama, contenedor y volumen distintos; `426` sin header; `desktop-events` inserta con sequence del server |
| E2 | Runtime: gate, usuarios, sin sudo, `bootstrap.sh` + `session.sh`, code-server en 127.0.0.1, agente (`NEXT_SEQUENCE`, `denied.log`, SIGTERM) | E1 | `smoke-gate.sh` (§12) + `smoke-git/telemetry/ai` adaptados al `docker run` nuevo |
| E3 | Examen: `/api` relativo + proxy Vite, sin `@CrossOrigin`, REST Client de ejemplo; publicar en `main` | E2 | Dentro de un contenedor con gate: front por `app.localhost` muestra el precio; Postman/curl a `:8081` responde |
| E4 | Desktop: scaffold, `wsl.ts`, `docker.ts`, `backend.ts`, `environment.ts`, `gate.ts`, vista IDE | E1, E2 | `npm start` en Windows → IDE cargado dentro de la app con el repo clonado; terminal y Continue funcionan |
| E5 | Desktop: pantallas, pestaña App, retomar, cierre, monitoreo del contenedor | E3, E4 | Flujo completo a mano: iniciar, App, salir con aviso, retomar con el mismo código |
| E6 | Lockdown, telemetría desktop, `professor.html` | E5 | Eventos `DESKTOP_*` y `GATE_ACCESS_DENIED` en la timeline; DevTools y links externos bloqueados |
| E7 | Empaquetado: electron-builder, NSIS perMachine, fuses, `build-desktop.ps1` | E6 | Instalar el `.exe`, abrir desde el menú Inicio, flujo OK; asar modificado no arranca; `ELECTRON_RUN_AS_NODE` ignorado |
| E8 | QA final: Playwright `_electron`, regresión de smokes, README, `qa-manual-report.md` | todos | Definition of Done (§13) |

Ejecución secuencial E1 → E8: comparten backend, imagen y repo de examen.

## 12. `scripts/smoke-gate.sh` (E2)

Con una sesión creada por `curl` y el contenedor levantado con el `docker run` de §6.4, verifica:

1. Sin cookie: `ide.localhost:<P>/` → 403; `app.localhost:<P>/` → 403; `127.0.0.1:<P>/` → 403.
2. Con la cookie: `ide.localhost:<P>/healthz` → 200; `app.localhost:<P>/` → 502 (front apagado).
3. WebSocket a code-server con cookie → `101`; sin cookie → 403.
4. `:8081` con `Sec-Fetch-Mode: navigate` → 403; con `Origin` → 403; sin esos headers → 502 (API apagada) y 200 con la API levantada (`docker exec -u coder ... ./mvnw spring-boot:run` en background).
5. El header `Cookie` que llega al upstream no contiene `assessment_gate` (upstream de prueba con `nc` en 4200).
6. Como `coder`: `sudo -n true` falla, `cat /run/gate/key` falla y `kill` del gate falla.
7. `docker inspect` no contiene la clave.
8. `denied.log` tiene las líneas de los 403 y aparecen como `GATE_ACCESS_DENIED` en `/api/sessions/{id}/events`.
9. Desde Windows (`curl.exe`): mismos resultados que 1, 2 y 4 por el reenvío de WSL.

## 13. Definition of Done

1. Se instala el `.exe` y la app abre maximizada, sin menú y sin DevTools.
2. Desde la app se elige alumno y examen y, sin tocar una terminal, aparece el IDE con el repo clonado en `session-<id>-<hex>`.
3. En la terminal del IDE: `./mvnw test` corre, `./mvnw spring-boot:run` levanta en 8081 y **Postman** desde Windows a `localhost:8081/api/price?price=200&percent=25` responde.
4. `npm run dev` en `frontend/` y la pestaña **App** muestra la calculadora consumiendo la API.
5. **Chrome/Edge** a `localhost:<P>`, `ide.localhost:<P>`, `app.localhost:<P>` y `localhost:8081` → bloqueados, y queda `GATE_ACCESS_DENIED` en la timeline.
6. Continue responde y `git push` llega a GitHub, como hoy.
7. Al salir avisa si hay cambios sin pushear y apaga el contenedor. Al reabrir, **Retomar** muestra el mismo código, también después de reiniciar el backend.
8. `professor.html` muestra la timeline con eventos `DESKTOP_*`, tiempo fuera de la app e intentos bloqueados.
9. Modificar `app.asar` en la carpeta de instalación impide que la app arranque.

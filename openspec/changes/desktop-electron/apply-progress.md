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

## E4 — Desktop: orquestación e IDE
- `desktop/` (Electron 44.5.1, TypeScript 5.9, `tsc`): `config.ts`, `wsl.ts`, `docker.ts`, `backend.ts`, `gate.ts`, `environment.ts` (los 9 pasos de §7.3 con sus errores), `validate.ts` (§6.4), vista del IDE en `views.ts`. Para poder correr y verificar E4 de punta a punta se escribieron también (adelantados de E5/E6, se verifican en esas tasks) `controller.ts`, `ipc.ts`, `store.ts`, `telemetry.ts`, `security.ts`, `preload/shell.ts` y el shell.
- `wsl.exe` se invoca con `--exec` (sin shell) en vez de `--`: `--` pasa la línea por el shell por defecto de la distro y reinterpretaría caracteres (`{{...}}`, `$`, `;`).
- Renderer compilado como script clásico (sin `import`/`export`), no como ES module: con el fuse `GrantFileProtocolExtraPrivileges=false` (E7) los módulos desde `file://` pueden dejar de cargar. Desvío mínimo de "renderer en ES module".
- Bug propio resuelto durante la verificación: el guard de `will-redirect` comparaba contra `wc.getURL()` (vacío en la primera carga) y bloqueaba el redirect de code-server → vista en `about:blank`. Ahora cada vista registra su origen permitido antes de cargar (`allowOrigin`).
- Unit tests (`npm test`): `decodeWslOutput` contra salida REAL capturada de `wsl -l -q`, `--status` y error de distro inexistente (UTF-16LE) + `validateRunValues`. 5/5 OK.
- Verificación (`desktop/e2e/ide-check.js`: app real con `ASSESSMENT_DEV_AUTOSTART=1,1`, backend + imagen + upstream local; el IDE se maneja por CDP porque Playwright no expone las vistas de otra partición):
  - Los 9 pasos pasan solos; la vista carga `http://ide.localhost:<P>/`, el workbench aparece y el explorador lista el repo clonado (`pom.xml`, `frontend/`, `requests.http`), rama `session-24-75f9b2` en la barra de estado. Evidencia: `qa-evidence/e4-ide-explorer.png`.
  - La terminal del IDE se abre y `./mvnw test` corre (fallan los tests, esperado). Evidencia: `qa-evidence/e4-terminal-mvnw-test.png`.
  - Continue: el panel carga (webview, sin login) en el lateral derecho. **El chat NO se probó**: no hay `ANTHROPIC_API_KEY` (§Entorno).
- Riesgos §10: (a) code-server rechaza WebSocket detrás del gate → **NO se confirmó** (el workbench y la terminal funcionan, ambos usan WebSocket); sin plan B. (b) `session.fetch`/cookies no aplican al service worker → **NO se confirmó** (el webview de Continue renderiza); sin plan B. (c) UTF-16 de `wsl.exe` → cubierto por unit test con salida real.

## E5 — Desktop: pantallas, App, retomar y cierre
- Shell (Inicio/Progreso/Error/Workspace/Cierre) + preload con la API mínima de §7.7, pestaña App con polling (3 s) y placeholder, ↻, monitoreo del contenedor (5 s) con pantalla "El entorno se detuvo" (**Reiniciar**), `store.ts` con `safeStorage` (DPAPI), Retomar / Iniciar otra sesión (con confirmación), cierre con detección de trabajo sin subir, flush del agente (`pkill -TERM` + espera ≤5 s), `docker stop -t 10` y recuperación tras cierre abrupto (`docker rm -f` en el paso Contenedor).
- Decisión (cierre): sin upstream configurado, "commits sin pushear" = commits de `HEAD` que no están en ningún remoto (`git log HEAD --not --remotes`). La spec dice "contar todos los commits de la rama", pero la rama sale de `main` y siempre tendría commits del template: avisaría siempre.
- Decisión: la sesión guardada se persiste recién cuando el entorno quedó listo (así "Retomar" nunca apunta a una sesión que no llegó a arrancar).
- Para poder automatizar los cuadros nativos: `desktop/src/main/dialogs.ts` (`ask`). Con la app SIN empaquetar y `ASSESSMENT_TEST_DIALOG_LOG` definido, registra el cuadro y responde `ASSESSMENT_TEST_DIALOG_ANSWER`; empaquetada, ignora esas variables. `ASSESSMENT_USER_DATA` (solo sin empaquetar) aísla los datos de usuario de las pruebas.
- Verificación: `node desktop/e2e/e5-check.js` (app real, backend + imagen + upstream local; formulario por la UI, IDE y App por CDP). Salida completa en verde, 25 chequeos:
  1. Iniciar desde el formulario (alumnos/examen del backend), barra con alumno y "activa", contenedor `assessment-<id>-<hex>`.
  2. Pestaña App con el front apagado → placeholder con `npm run dev`.
  3. `npm install && npm run dev` tecleado en la terminal del IDE → aparece la vista App (200 por el gate), el placeholder desaparece.
  4. Editar `frontend/index.html` en el contenedor → la pestaña App muestra el cambio sin recargar (**HMR de Vite OK**).
  5. Salir con cambios sin pushear → el diálogo agrega "Tenes cambios sin subir a GitHub (git push)."; el contenedor queda apagado.
  6. Reabrir → tarjeta "Retomar: Ana Alumna · Examen Spring Boot (rama session-26-4b8f23)" → mismo contenedor/volumen, el archivo editado sigue ahí.
  7. Kill del proceso de Electron (cierre abrupto): el contenedor queda corriendo; al reabrir y Retomar el paso Contenedor lo recrea y el código sigue.
  8. `docker stop` manual → en ≤30 s pantalla "El entorno se detuvo" con **Reiniciar** → vuelve a levantar.
  9. "Iniciar otra sesión" pide confirmación antes de reemplazar la guardada.
  Capturas en `qa-evidence/e5-*.png` (por vista, vía CDP: no se captura el escritorio real).
- Riesgo §10 HMR: **NO se confirmó**; Vite recarga la pestaña App detrás del gate sin plan B (`GATE_PORT`/`clientPort` no hacen falta).
- Detalle: en ese recorrido la calculadora muestra "Error: Unexpected end of JSON input" porque `spring-boot:run` no estaba levantado (el proxy de Vite devuelve vacío); con la API arriba responde 500 hasta que se implemente `applyDiscount` (esperado, ver E3).

## E6 — Lockdown, telemetría desktop y profesor
- `security.ts` (menú nulo, `will-navigate`/`will-redirect` solo al origen registrado de cada vista, `setWindowOpenHandler` deny, `before-input-event` F12/Ctrl+Shift+I/J/C/Ctrl+U, `will-download` cancelado, permisos solo `clipboard-*` para `ide.localhost`, `devtools-opened` cierra, `devTools:false`), validación del `senderFrame` en cada IPC, single-instance, `telemetry.ts` con los 5 eventos `DESKTOP_*` (cola en memoria, flush cada 10 s y en el cierre), `professor.html` con tiempo fuera, salidas, bloqueos y filas resaltadas.
- Verificación (`node desktop/e2e/e6-check.js` + `professor-check.js`, app real, sesión 31):
  - Título fijo de la ventana; F12, Ctrl+Shift+I, Ctrl+Shift+J y Ctrl+U enviadas como teclas REALES de Windows (SendKeys, solo si la app tiene el foco: si no, se aborta antes de mandar nada) → no aparece ningún target de DevTools ni ventana nueva.
  - `window.open`, link con `target=_blank`, link normal y `location.href` hacia `https://example.com` desde el IDE → no abren nada; el IDE sigue en `ide.localhost`; ninguna página nueva.
  - Segunda instancia → termina sola (código 0); una sola ventana.
  - Alt+Tab real ida y vuelta (SendKeys `%{TAB}`) + cambio de pestaña → API: `DESKTOP_STARTED {version:0.1.0, resumed:false}`, `DESKTOP_FOCUS_LOST`, `DESKTOP_FOCUS_GAINED {awayMs:5583}`, `DESKTOP_TAB_CHANGED {tab:APP}`, `DESKTOP_CLOSED` al salir.
  - **Edge headless real** a `localhost:<P>`, `ide.localhost:<P>`, `app.localhost:<P>` → "Acceso denegado"; a `localhost:8081/api/price` → "Solo Postman/curl". 4 `GATE_ACCESS_DENIED` en la timeline. `curl.exe` (sin headers de navegador) a :8081 no queda bloqueado (502: la API del alumno estaba apagada en ese contenedor).
  - `professor.html` (Playwright, Edge): fuera de la app `0 min 6 s`, `1` salida, `4` bloqueos; 2 filas `focus` y 4 `denied` resaltadas. Captura `qa-evidence/e6-professor.png`; capturas de Edge `qa-evidence/e6-edge-*.png`.
- Detalles/desvíos: `GATE_ACCESS_DENIED`, `DESKTOP_*` y los eventos del agente comparten espacio de `sequence` por sesión pero cada emisor asigna el suyo (el agente desde `NEXT_SEQUENCE`), así que pueden repetirse números; la vista del profesor ordena por timestamp. La verificación de Alt+Tab no registra el título de la otra ventana (privacidad).

## E7 — Empaquetado
- `electron-builder.yml` (NSIS x64, `perMachine: true`, `oneClick: false`, asar, sin firma), fuses con `@electron/fuses` en `scripts/after-pack.js` (RunAsNode, NODE_OPTIONS e inspect desactivados; integridad embebida del asar, solo-asar y cifrado de cookies activados; `GrantFileProtocolExtraPrivileges` desactivado), `build/icon.ico` (generado con `scripts/make-icon.js`), `scripts/build-desktop.ps1` (`npm ci` + `npm run dist`). `signAndEditExecutable: false`: sin firma ni edición de recursos del exe (no se aplica el ícono al `.exe`; el instalador y el acceso sí lo tienen configurado). La integridad del asar sí quedó embebida (el log de electron-builder muestra "updating asar integrity executable resource").
- **Riesgo nuevo, confirmado (no estaba en §10):** con `GrantFileProtocolExtraPrivileges=false`, Chromium no puede leer archivos dentro del asar por `file://` (`ERR_FILE_NOT_FOUND` al cargar `shell.html`). Plan: servir el shell por un protocolo propio `assessment://shell/` (`shell-protocol.ts`, lista fija de 3 archivos) y mantener el fuse. El IPC ahora compara el `senderFrame` contra la constante `assessment://shell/shell.html` (antes era contra la URL actual de la ventana).
- **Hardening agregado:** la app empaquetada sale con código 1 si se la lanza con `--remote-debugging-*`, `--inspect*` o `--remote-allow-origins` (los fuses cubren `--inspect` pero Chromium sigue aceptando `--remote-debugging-port`, que le abriría las vistas del IDE al alumno por CDP).
- Tamaño del instalador: `Assessment-Setup-0.1.0.exe` = 111 203 017 bytes (≈106 MB); instalado ≈ 246 MB (`Assessment.exe` 245 726 208 bytes por Electron).
- Verificación (`desktop/e2e/e7-check.js` sobre `dist/win-unpacked/Assessment.exe`, el mismo binario que va al instalador):
  - Arranca y abre la ventana "Assessment" (fuses + integridad válida).
  - `ELECTRON_RUN_AS_NODE=1 Assessment.exe -e "console.log(1)"` → no imprime `1`, arranca la app normal.
  - `Assessment.exe --inspect=9555` → puerto cerrado, sin "Debugger listening". `--remote-debugging-port=9556` → la app sale (código 1), puerto cerrado.
  - Un byte alterado en `resources/app.asar` (copia de la carpeta) → NO arranca, tanto en el header (offset 20) como en el contenido (offset 58110). Riesgo §10 "integridad del asar no soportada en Windows": **NO se confirmó**.
- Instalación: **BLOQUEADA la instalación por-máquina.** `Assessment-Setup-0.1.0.exe /S` con `-Verb RunAs` pidió UAC y se canceló ("El usuario ha cancelado la operación"); esta sesión no tiene privilegios de administrador y no se puede aprobar el UAC sin el usuario. Por eso NO se verificó: instalar en `C:\Program Files`, que el alumno sin elevar no pueda tocar los archivos, ni el acceso del menú Inicio de la variante por-máquina.
  - Sustituto: se construyó una variante idéntica con `perMachine: false` (`dist-user/`, ignorada por git), se instaló en silencio con `/S /D=%LOCALAPPDATA%\Programs\Assessment-test` (exit 0, crea `Assessment.lnk` en el menú Inicio del usuario) y se abrió **desde ese acceso** con `desktop/e2e/e7-flow.ps1`: ventana maximizada, sin menú, título "Assessment", Iniciar con teclado real → contenedor `assessment-24-75f9b2` (esa app retomó una sesión guardada por una corrida de desarrollo anterior), título "Assessment — Ana Alumna · Examen Spring Boot", repo clonado en `session-24-75f9b2`. Evidencia: `qa-evidence/e7-instalada-inicio.png` y `e7-instalada-ide.png` (captura SOLO de la ventana de la app con PrintWindow).

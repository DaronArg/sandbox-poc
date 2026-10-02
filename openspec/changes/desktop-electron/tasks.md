# Assessment — App desktop con Electron: Tasks

**Spec:** `openspec/changes/desktop-electron/design.md` (leerlo completo) y, antes, `openspec/changes/assessment-poc/design.md`.
**Contexto obligatorio:** `README.md`, `.claude/qa-config.md`, `openspec/changes/assessment-poc/apply-progress.md`.
**Ejecución:** Run de Orca, un worker por task, secuencial, worktree actual, branch `feat/desktop-electron` (sale de `poc/assessment-platform`).

## Reglas para todos los workers

- Es una POC: la opción más simple que cumpla la spec. Nada fuera de §2–§13 del design.
- El usuario NO está disponible. No preguntar: decidir lo más simple dentro de la spec y anotarlo en `openspec/changes/desktop-electron/apply-progress.md` (agregar al final, no pisar).
- Si un riesgo de §10 se confirma, aplicar el plan B de esa tabla y anotarlo. Si no hay plan B posible: `--outcome failed` con el motivo.
- Una task termina solo cuando su verificación se ejecutó de verdad y pasó, con la salida real. Lo no verificado se reporta explícito.
- No romper lo anterior: correr los `scripts/smoke-*.sh` afectados y actualizarlos si el contrato cambió (el `docker run` cambia en E2: todos los smoke que levantan contenedor se adaptan).
- Secretos: nunca imprimir ni commitear `.env`, tokens de sesión ni la clave del gate. No hacer `cat` de `.env`.
- Git: commitear solo paths propios, conventional commits, sin atribución de IA. Al cerrar la task, `git push origin feat/desktop-electron`.
- Docker y backend corren dentro de WSL (`wsl -d Ubuntu`, root con `-u root`). La app Electron se desarrolla, prueba y empaqueta **en Windows** (Node 22).
- Bug real del producto → se arregla en el código, no se tapa en un script.

## E1 — Backend (design §6.1)

- [ ] H2 en archivo (`backend/data/`, gitignored); `schema.sql` con `IF NOT EXISTS`; `data.sql` con `MERGE INTO`.
- [ ] Columnas `container_name`, `volume`; generación de `<hex>` para rama, contenedor y volumen.
- [ ] `POST /api/sessions` con el contrato nuevo (sin `dockerRun`); env `RUNTIME_IMAGE`, `CONTAINER_BACKEND_URL`.
- [ ] `GET /api/sessions/{id}/status`, `POST /api/sessions/{id}/desktop-events`, `nextSequence` en `connect`.
- [ ] `X-Desktop-Version` y `DESKTOP_MIN_VERSION` → `426`.
- [ ] `index.html` reemplazado por el aviso con link a `professor.html`.
- **Verificación** (`scripts/smoke-backend.sh` actualizado):
  - Crear sesión con header → contrato completo.
  - Sin header → 426.
  - Reiniciar backend → la sesión y sus eventos siguen.
  - Dos sesiones → rama, contenedor y volumen distintos.
  - `status` con token correcto → 200, con otro → 401.
  - `desktop-events` con tipo válido → inserta; con tipo inválido → 400.
  - `connect` devuelve `nextSequence` correcto.

## E2 — Runtime con gate (design §5, §6.2–§6.5, §12)

- [ ] `runtime/gate/` (`gate.js` + `package.json` con `http-proxy`): puertos 7000 y 9081, cookie, routing por host, strip de cookie, `Sec-Fetch-*`/`Origin`, upgrade, 403/502, `denied.log` con rate limit.
- [ ] `Dockerfile`: sin sudo, usuario `gate`, gate, `session.sh`, REST Client, `USER root`, `EXPOSE 7000 9081`.
- [ ] `bootstrap.sh` (root) + `session.sh` (coder); code-server en `127.0.0.1:8080`; settings sin auto-forward.
- [ ] Agente: `NEXT_SEQUENCE`, tail de `denied.log`, flush en SIGTERM.
- [ ] Reconstruir imagen (`scripts/build-runtime.sh`).
- **Verificación:** `scripts/smoke-gate.sh` nuevo cubriendo los 9 puntos de §12; `smoke-runtime`, `smoke-git`, `smoke-telemetry`, `smoke-ai` adaptados al `docker run` de §6.4 y pasando.

## E3 — Repo de examen (design §6.6)

- [ ] `frontend/main.js` con `/api` relativo; `vite.config.js` con proxy; sin `@CrossOrigin` en `PriceController`.
- [ ] `requests.http` de ejemplo para REST Client; README del examen.
- [ ] Publicar en `main` de `DaronArg/assessment-exam-template` y espejar en `exam-template/`.
- **Verificación** (contenedor de sesión nuevo):
  - `spring-boot:run` + `npm run dev`; `curl` con cookie a `app.localhost:<P>/` → 200, y `app.localhost:<P>/api/price?price=200&percent=25` → JSON (falla con 400/500 mientras `applyDiscount` no esté implementado: anotar).
  - `curl.exe` desde Windows a `localhost:8081/api/price...` → responde.
  - Los 4 tests siguen fallando.

## E4 — Desktop: orquestación e IDE (design §4, §6.4, §7.1, §7.2, §7.3 pasos)

- [ ] Scaffold `desktop/` (TypeScript, `tsc`, scripts `build`, `start`, `dist`, `test:e2e`); `.gitignore` de `desktop/dist`, `desktop/out`, `desktop/node_modules`.
- [ ] `config.ts`, `wsl.ts` (UTF-16 de `wsl.exe`), `docker.ts`, `backend.ts` (con `X-Desktop-Version`), `gate.ts` (partición `assessment` en memoria + cookie para `ide.localhost` y `app.localhost`).
- [ ] `environment.ts` con todos los pasos de la tabla de Progreso y sus errores; validación de valores del backend (§6.4).
- [ ] Vista IDE (`WebContentsView`) cargando `http://ide.localhost:<P>/` al pasar `/healthz`.
- **Verificación** (`npm start` en Windows, backend arriba, imagen construida):
  - Con un alumno y examen fijos por env de desarrollo, la app muestra el IDE con el repo clonado.
  - La terminal abre y corre `./mvnw test`.
  - El chat de Continue responde.
  - Riesgos §10 de code-server y del service worker resueltos o con plan B aplicado.

## E5 — Desktop: pantallas, App, retomar y cierre (design §7.3–§7.5)

- [ ] `shell.html/css/ts` + preload: Inicio, Progreso, Error, Workspace con barra y pestañas.
- [ ] Pestaña App con polling y placeholder; ↻; monitoreo del contenedor y pantalla "El entorno se detuvo".
- [ ] `store.ts` con `safeStorage`; Retomar e Iniciar otra sesión.
- [ ] Cierre: detección de cambios sin pushear, diálogo, flush del agente, `docker stop`; recuperación tras cierre abrupto.
- **Verificación** a mano, con capturas en `openspec/changes/desktop-electron/qa-evidence/`:
  - Iniciar.
  - App con placeholder y luego con el front.
  - Editar `main.js` y que la pestaña refleje el cambio (riesgo HMR §10).
  - Salir con cambios sin pushear → aviso.
  - Reabrir → Retomar → mismo archivo editado.
  - Matar el proceso de Electron y reabrir → recupera.
  - `docker stop` manual → pantalla de error → Reiniciar.

## E6 — Lockdown, telemetría desktop y profesor (design §7.6, §7.7, §7.9)

- [ ] `security.ts` completo (ventana, webPreferences, navegación, permisos, descargas, atajos, CSP, validación IPC, single-instance).
- [ ] `telemetry.ts` con los 5 eventos `DESKTOP_*`.
- [ ] `professor.html`: tiempo fuera de la app, conteo de bloqueos, filas resaltadas.
- **Verificación:**
  - F12 y Ctrl+Shift+I no abren nada.
  - Un `window.open` y un link externo desde el IDE (por ejemplo el link de un archivo Markdown) no abren nada.
  - Dos clics en el ícono → una sola instancia.
  - Alt+Tab ida y vuelta → `DESKTOP_FOCUS_LOST`/`GAINED` con `awayMs` en la API.
  - Abrir el puerto del gate en Chrome → `GATE_ACCESS_DENIED`.
  - `professor.html` (Playwright) muestra los totales.

## E7 — Empaquetado (design §7.8)

- [ ] `electron-builder.yml` (NSIS, perMachine, asar), `afterPack` con fuses, `build/icon.ico`, `scripts/build-desktop.ps1`.
- **Verificación:**
  - Instalar `Assessment-Setup-<v>.exe`, abrir desde el menú Inicio y recorrer el flujo.
  - Editar un byte de `resources/app.asar` instalado → la app no arranca. Restaurar reinstalando.
  - `ELECTRON_RUN_AS_NODE=1 Assessment.exe -e "console.log(1)"` no ejecuta Node.
  - `Assessment.exe --inspect` no abre el inspector.
  - Anotar el tamaño del instalador.

## E8 — QA final (design §13)

- [ ] `desktop/e2e/desktop.spec.ts` con Playwright `_electron`: iniciar sesión, IDE visible, pestaña App, salir y retomar.
- [ ] Regresión de todos los `scripts/smoke-*.sh` desde cero.
- [ ] Recorrido de la Definition of Done completa, incluido Postman real contra `:8081` y Chrome/Edge bloqueados.
- [ ] README: nuevo flujo (instalar app, requisitos §8, Postman, profesor web) y aviso de que `demo/` muestra el flujo web anterior.
- [ ] `openspec/changes/desktop-electron/qa-manual-report.md` con tabla de DoD y evidencia.
- [ ] Dejar el backend corriendo, la app instalada y sin contenedores de sesión.

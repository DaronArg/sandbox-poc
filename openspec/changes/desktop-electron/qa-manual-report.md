# QA — App desktop (Electron): Definition of Done

Fecha: 2026-10-01. Entorno: Windows 11, WSL2 Ubuntu 24.04 + Docker 29.8.2, Electron 44.5.1, backend en WSL (:9090), imagen `assessment-runtime:poc` reconstruida **sin caché** para esta corrida, DB del backend nueva.
Cómo se verificó: scripts en `desktop/e2e/` y `scripts/` (todos corridos de verdad; la evidencia está en `qa-evidence/`). Detalle y decisiones en `apply-progress.md`.

**Limitaciones del entorno (afectan varios puntos):** no hay `ANTHROPIC_API_KEY` ni `GITHUB_TOKEN`, y la cuenta de `gh` no ve `DaronArg/assessment-exam-template`; el `git push` se verificó contra un upstream git local (`scripts/local-upstream.sh`). La sesión no tiene privilegios de administrador y el UAC del instalador por-máquina no se aprobó.

## Definition of Done (design §13)

| # | Punto | Resultado | Evidencia |
|---|---|---|---|
| 1 | Se instala el `.exe` y la app abre maximizada, sin menú y sin DevTools | **PARCIAL** | Instalador `Assessment-Setup-0.1.0.exe` construido (111 203 017 bytes). **No se pudo instalar por-máquina** (UAC cancelado). Variante idéntica con `perMachine:false` instalada y abierta **desde el acceso del menú Inicio** (`e7-flow.ps1`): ventana maximizada (`IsZoomed`), sin menú (`GetMenu`=0), título "Assessment". DevTools: F12, Ctrl+Shift+I/J y Ctrl+U como teclas reales de Windows no abren nada (`e6-check.js`, build de desarrollo; el binario empaquetado usa el mismo código + `--inspect` y `--remote-debugging-*` rechazados, `e7-check.js`). `qa-evidence/e7-instalada-*.png`, `e6-*`. **Sin verificar:** instalación en `Program Files` y que el alumno sin elevar no pueda tocar los archivos. |
| 2 | Alumno + examen desde la app → IDE con el repo clonado en `session-<id>-<hex>`, sin terminal | **PASA** | `dod-check.js` (rama `session-8-00bb8d`), `desktop.spec.ts` (Playwright `_electron`) y la app instalada (rama `session-24-75f9b2`). `dod-2-ide-repo-clonado.png`, `e7-instalada-ide.png`. |
| 3 | `./mvnw test` corre, `./mvnw spring-boot:run` levanta en 8081 y **Postman** desde Windows responde | **PASA con curl.exe; Postman real SIN verificar** | En la terminal del IDE: `./mvnw test` (exit 0 con `applyDiscount` implementada en el workspace del alumno) y `./mvnw spring-boot:run`; `curl.exe` desde Windows a `localhost:8081/api/price?price=200&percent=25` → `200 {"finalPrice":150.0,...}`. `curl.exe` manda los mismos headers que Postman de escritorio (ningún `Sec-Fetch-*`/`Origin`), pero **no se automatizó la app Postman** (está instalada). `dod-3-*.png`. |
| 4 | `npm run dev` en `frontend/` y la pestaña **App** muestra la calculadora consumiendo la API | **PASA** | Terminal del IDE → vista App (200 por el gate) → "Precio final: $150" vía `/api` relativo + proxy de Vite; HMR verificado en `e5-check.js` (`e5-6-app-editado.png`). `dod-4-app-calculadora.png`. |
| 5 | Chrome/Edge a `localhost:<P>`, `ide.localhost:<P>`, `app.localhost:<P>` y `localhost:8081` → bloqueados, queda `GATE_ACCESS_DENIED` | **PASA** | Edge y Chrome reales (headless, perfil aislado): las 4 URL devuelven "Acceso denegado" / "Solo Postman/curl". 4 `GATE_ACCESS_DENIED` en la timeline (el gate registra como máximo 1 línea cada 30 s por puerto+host). `dod-5-*.png`, `e6-edge-*.png`. |
| 6 | Continue responde y `git push` llega a GitHub, como hoy | **PARCIAL** | `git push` tecleado en la terminal del IDE: el branch llegó al **upstream git local** con el mismo commit y quedó `GIT_PUSH`. **Sin verificar:** respuesta del chat de Continue (el panel carga sin login, pero no hay `ANTHROPIC_API_KEY`), push a GitHub real y disparo de CI (el repo de examen publicado no tiene `ci.yml`). `dod-6-git-push.png`, `e4-terminal-mvnw-test.png`. |
| 7 | Salir avisa si hay cambios sin pushear y apaga el contenedor; Retomar muestra el mismo código, también tras reiniciar el backend | **PASA** | Con cambios sin subir el diálogo agrega "Tenes cambios sin subir a GitHub (git push)." (`e5-check.js`, `desktop.spec.ts`); con todo commiteado y pusheado no avisa; el contenedor queda apagado; tras `restart-backend.sh` aparece "Retomar" y el HEAD (`d7901a2`) y el código del alumno son los mismos. `dod-7-retomado.png`, `e5-7-retomar.png`. |
| 8 | `professor.html` con eventos `DESKTOP_*`, tiempo fuera de la app e intentos bloqueados | **PASA** | `professor-check.js`: sesión con Alt+Tab real → fuera `0 min 6 s`, 1 salida, 4 bloqueos, filas resaltadas (`e6-professor.png`); sesión del recorrido DoD → `DESKTOP_STARTED {resumed:true}`, `TAB_CHANGED`, `CLOSED`, 4 bloqueos (`dod-8-professor.png`). |
| 9 | Modificar `app.asar` en la carpeta de instalación impide que la app arranque | **PASA** | `e7-check.js` sobre una copia de la carpeta instalada: un byte alterado en el header **y** en el contenido del asar → no arranca. `ELECTRON_RUN_AS_NODE=1 ... -e "console.log(1)"` no ejecuta Node; `--inspect` no abre inspector; `--remote-debugging-port` rechazado. |

## Regresión de infraestructura (desde cero)

`scripts/regression-clean.sh` (contenedores y volúmenes de sesión borrados, DB nueva, imagen `--no-cache`):

| Smoke | Resultado |
|---|---|
| `smoke-backend` (incluye reinicio real con sesión/eventos conservados) | OK |
| `smoke-runtime` | OK |
| `smoke-gate` (los 9 puntos de §12, incluido `curl.exe` desde Windows) | OK |
| `smoke-git` | OK **contra upstream local** (GitHub/CI sin verificar) |
| `smoke-telemetry` | OK |
| `smoke-ai` | **PARCIAL**: 401 con token inválido y config de Continue; no-stream/stream/eventos `AI_*`/autocomplete **SKIPPED** (sin `ANTHROPIC_API_KEY`) |
| `smoke-exam` (nuevo) | OK |
| `desktop`: `npm test` (5 unit tests, UTF-16 de `wsl.exe` con salida real) y `npx playwright test` (3 tests `_electron`) | OK |

## Planes B y riesgos de §10

Ningún riesgo de la tabla se confirmó (no hizo falta aplicar planes B): reenvío de localhost de WSL con puerto dinámico, WebSocket de code-server detrás del gate, HMR de Vite, service worker/cookies, integridad del asar en Windows. Se confirmó **uno nuevo** (no listado): `GrantFileProtocolExtraPrivileges=false` impide cargar `shell.html` por `file://` desde el asar → el shell se sirve por el protocolo propio `assessment://shell/`.

## Estado final

Backend corriendo en WSL (:9090, DB nueva), sin contenedores de sesión. App: el instalador por-máquina `desktop/dist/Assessment-Setup-0.1.0.exe` quedó construido pero **no instalado** (hace falta aprobar el UAC: ejecutarlo como administrador). Mientras tanto queda instalada la **variante por-usuario usada en las pruebas** en `%LOCALAPPDATA%ProgramsAssessment-test` con su acceso `Assessment` en el menú Inicio; se quita con `%LOCALAPPDATA%ProgramsAssessment-testUninstall Assessment.exe` antes de instalar la por-máquina.

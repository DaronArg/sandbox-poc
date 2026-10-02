# Integración: app de escritorio + cierre de factibilidad (spec de diseño)

Fecha: 2026-10-02.

## 1. Objetivo

Una sola rama, `feat/desktop-integration`, que tenga los avances de las dos líneas de trabajo y en la que **todo el flujo funcione sobre la app Electron**:

- `poc/assessment-platform` (specs en `openspec/changes/assessment-poc/` y `assessment-poc-closure/`): persistencia H2, ciclo de vida con `submit` y SHA final, resultado de CI en el panel, examen Angular, imagen en GHCR, `PUBLIC_URL`, reporte de capacidad.
- `origin/feat/desktop-electron` (spec en `openspec/changes/desktop-electron/design.md`): app Electron que orquesta Docker y embebe la IDE, gate de acceso, usuarios sin sudo, arranque en dos etapas, telemetría `DESKTOP_*`, empaquetado con fuses.

Insumo obligatorio: `F:\repos\tpi-tup\sandbox-poc-electron\qa-independent-report.md` (QA independiente de la rama Electron: hallazgos y análisis de choques).

Sigue siendo una POC de factibilidad: la opción más simple que funcione. Sin login, sin topes de IA.

## 2. Decisiones de integración

1. **La app lanza Docker.** Vale el contrato de sesión de `desktop-electron` (campos estructurados, `execFile`, validación). El backend ya no necesita generar el string `docker run`; si conservarlo es gratis se deja, pero nada depende de él.
2. **El gate y el modelo de usuarios de `desktop-electron` quedan siempre activos.** La IDE no se abre desde un navegador. El flujo web anterior (copiar `docker run`, `demo/record-demo.mjs`, `smoke-remote.sh` con navegador) queda retirado: los scripts que ya no apliquen se eliminan o se adaptan, no se dejan rotos.
3. **Runtime = unión.** Base de `desktop-electron` (gate, dos usuarios, dos etapas, `session.sh`) más lo del cierre: comando `submit` en el PATH, Angular CLI, flush de telemetría antes de entregar.
4. **Backend = unión.** Contrato de escritorio, `status`, `desktop-events` y totales del profesor, más `submit` / `COMPLETED` / `final_sha` / rechazo 401 de sesiones completadas / `GET /result` con CI / `RUNTIME_IMAGE` / `PUBLIC_URL`. Un solo esquema H2 en archivo; una sola forma de generar el sufijo hex.
5. **Examen = Angular con rutas relativas.** El front llama a `/api/...` y `ng serve` usa `proxy.conf.json` hacia `localhost:8081` (anticipado en `desktop-electron/design.md` §9). Se publica en `main` del repo de examen `DaronArg/assessment-exam-template` conservando `.github/workflows/ci.yml`. El comando del alumno es `npm start`; los textos de la app que digan `npm run dev` se actualizan.
6. **Entregar desde la app.** Botón "Entregar" en la barra, con confirmación. Ejecuta el `submit` del contenedor (commit de lo pendiente, push, SHA final al backend). Al terminar: pantalla "Entrega registrada" con el SHA, contenedor apagado, y esa sesión ya no se ofrece para retomar. Evento `SUBMISSION_COMPLETED` en la timeline.
7. **Imagen desde el registry.** Si `RUNTIME_IMAGE` no está en el Docker local, la app hace `docker pull` como un paso más del progreso. Si el pull falla (paquete privado sin login), mensaje claro.
8. **Backend remoto.** La app toma la URL del backend de su `config.json`. No se prueba la app contra un backend remoto en este cambio; `PUBLIC_URL` se conserva en el backend sin romperlo.

## 3. Arreglos

- **Bypass de depuración remota (alta).** `desktop/src/main/index.ts` solo rechaza `--remote-debugging*`, `--inspect*`, `--remote-allow-origins*` con doble guion y minúsculas. Debe rechazar cualquier variante que Chromium/Electron acepte (un guion, `/`, mayúsculas) y además consultar `app.commandLine.hasSwitch(...)` para esos switches. `desktop/e2e/e7-check.js` suma las variantes como regresión.
- Lo que falle al verificar con credenciales reales (sección 4) se arregla en este cambio.

## 4. Verificación con credenciales reales

El `.env` de la raíz de este worktree tiene `ANTHROPIC_API_KEY`, `GITHUB_TOKEN` y `GITHUB_REPO`. Ningún QA anterior de la app pudo usarlas. Hay que comprobar, dentro de la app:

- chat de Continue respondiendo y eventos `AI_PROMPT` / `AI_RESPONSE` en la API;
- `git push` desde la terminal de la IDE llegando a GitHub real, evento `GIT_PUSH`, y corrida de CI disparada;
- "Entregar" → `COMPLETED`, SHA final, y el panel del profesor mostrando resultado de CI junto con los eventos `DESKTOP_*`.

## 5. Definition of Done

1. `feat/desktop-integration` contiene ambos avances, compila, y la imagen construye.
2. Desde la app: iniciar sesión → IDE con el repo real clonado.
3. Tests, backend en 8081 y `npm start`; la pestaña App muestra la calculadora Angular consumiendo la API.
4. Chat de Continue responde dentro de la app.
5. `git push` llega a GitHub real y dispara CI.
6. "Entregar" cierra la sesión con SHA final; después el token no sirve.
7. Salir y retomar funciona, también tras reiniciar el backend.
8. El panel del profesor muestra timeline, eventos de la app, tiempo fuera, bloqueos, SHA final y resultado de CI.
9. Navegadores externos bloqueados; las variantes del flag de depuración no abren CDP.
10. Todos los smokes vigentes y los tests de `desktop/` pasan; el instalador se construye.

No verificable sin el usuario: instalación por-máquina (UAC) y Postman real.

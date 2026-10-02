# Integración app de escritorio — Tasks

**Spec:** `openspec/changes/desktop-integration/design.md`.
**Contexto obligatorio:** `openspec/changes/desktop-electron/design.md` y `apply-progress.md` (en la rama `origin/feat/desktop-electron`, o ya mergeados), `openspec/changes/assessment-poc-closure/design.md` y `apply-progress.md`, `README.md`, `.claude/qa-config.md`, y `F:\repos\tpi-tup\sandbox-poc-electron\qa-independent-report.md`.
**Ejecución:** Run de Orca, secuencial, worktree actual (`F:\repos\tpi-tup\sandbox-poc`), branch `feat/desktop-integration`.

## Reglas para todos los workers

- POC de factibilidad: lo más simple que funcione.
- El usuario NO está disponible. No preguntar: decidir lo más simple y anotarlo en `openspec/changes/desktop-integration/apply-progress.md` (agregar al final).
- Una task termina solo cuando su verificación se ejecutó de verdad y pasó. Lo no verificado se reporta explícito.
- Secretos: el `.env` de la raíz ya tiene las credenciales; los scripts lo leen. Nunca imprimirlo, copiarlo ni commitearlo.
- Git: trabajar solo en `feat/desktop-integration`. NO modificar ni pushear `poc/assessment-platform`, `feat/desktop-electron` ni `master`. Conventional commits, sin atribución de IA. Al cerrar la task: `git push origin feat/desktop-integration`.
- No tocar el worktree `F:\repos\tpi-tup\sandbox-poc-electron` (solo lectura).
- Docker y backend corren dentro de WSL (`wsl -d Ubuntu`, root con `-u root`). Acceso total a la máquina.
- La app abre ventanas reales: cerrarlas al terminar cada prueba. Privacidad: nunca capturar el escritorio completo, solo vistas (CDP) o la ventana de la app.
- Bug real → se arregla en el código, no se tapa en un script.

## I1 — Merge e integración de backend, runtime y scripts (spec §2.1–2.4, §2.8)

- [ ] `git merge origin/feat/desktop-electron` sobre `feat/desktop-integration` y resolver los conflictos según el spec (unión, no elegir un lado).
- [ ] Backend: un esquema, un contrato; conservar submit / result / RUNTIME_IMAGE / PUBLIC_URL y el contrato de escritorio / status / desktop-events.
- [ ] Runtime: gate + dos usuarios + dos etapas, con `submit`, Angular CLI y flush de telemetría. Reconstruir la imagen local (tag `assessment-runtime:poc`); NO publicar en GHCR todavía.
- [ ] Scripts: unificar smokes; retirar o adaptar los del flujo web que ya no aplican. Un `scripts/smoke-all.sh` que corra los vigentes.
- **Verificación:** backend compila y arranca; imagen construye; pasan los smokes vigentes de ambos lados (como mínimo backend, runtime, gate, git contra GitHub real, telemetry, ai con API key real, submit). `desktop/`: `npm ci`, `npm test`, build.

## I2 — Examen Angular con rutas relativas (spec §2.5)

- [ ] `exam-template/frontend` (Angular): llamadas a `/api/...`, `proxy.conf.json`, `npm start` en `0.0.0.0:4200`. Sin dependencia de CORS.
- [ ] Publicar en `main` del repo de examen conservando `ci.yml`.
- [ ] Actualizar en la app los textos y la detección que asuman `npm run dev`.
- **Verificación:** en una sesión real de la app (repo clonado de GitHub), `./mvnw spring-boot:run` + `npm install && npm start` → la pestaña App muestra "Precio final" consumiendo la API. `smoke-exam`/`smoke-frontend` actualizado y en verde.

## I3 — Entregar, pull de imagen y arreglo del bypass (spec §2.6, §2.7, §3)

- [ ] Botón "Entregar" con confirmación, pantalla de entrega registrada, contenedor apagado, sesión completada no retomable.
- [ ] `docker pull` de `RUNTIME_IMAGE` cuando no está local, con paso de progreso y error claro.
- [ ] Rechazo de todas las variantes de flags de depuración + `hasSwitch`; regresión en `desktop/e2e/e7-check.js`.
- [ ] Publicar la imagen integrada en GHCR (`scripts/publish-runtime.sh`).
- **Verificación:** con la app real: Entregar → API `COMPLETED` con SHA que existe en GitHub, push posterior rechazado, la app no ofrece retomar. Borrar la imagen local y arrancar una sesión → la app la baja de GHCR y funciona. Binario empaquetado (`win-unpacked`) lanzado con `-remote-debugging-port`, `/remote-debugging-port`, mayúsculas y `--inspect` → ningún puerto CDP abierto. Tests de `desktop/` en verde.

## I4 — QA final sobre Electron (spec §4, §5)

- [ ] Recorrer la Definition of Done completa con la app real y credenciales reales: Continue respondiendo, push a GitHub real, CI disparado, Entregar, panel del profesor con CI y eventos `DESKTOP_*`.
- [ ] `scripts/smoke-all.sh` desde cero, tests de `desktop/`, build del instalador.
- [ ] Arreglar lo que falle y repetir.
- [ ] README unificado (flujo con la app, requisitos, cómo levantar, qué quedó retirado).
- [ ] `openspec/changes/desktop-integration/qa-manual-report.md` con evidencia por punto en `qa-evidence/`.
- [ ] Estado final: backend corriendo en :9090, sin contenedores de sesión, sin ventanas de la app, branches `session-*` de prueba borrados del repo de examen.

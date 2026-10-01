# Assessment POC — Cierre de factibilidad: Tasks

**Spec:** `openspec/changes/assessment-poc-closure/design.md` y, antes, `openspec/changes/assessment-poc/design.md`.
**Contexto obligatorio:** `README.md`, `.claude/qa-config.md`, `openspec/changes/assessment-poc/apply-progress.md`, `demo/README.md`.
**Ejecución:** Run de Orca, un worker por task, secuencial, worktree actual, branch `poc/assessment-platform`.

## Reglas para todos los workers

- Es una POC de factibilidad: la opción más simple que funcione. Sin login, sin límites de IA, sin hardening.
- El usuario NO está disponible. No preguntar: decidir lo más simple y anotarlo en `openspec/changes/assessment-poc-closure/apply-progress.md` (agregar al final).
- Una task termina solo cuando su verificación se ejecutó de verdad y pasó. Lo que no se pudo verificar se reporta explícito, con `--outcome failed` si es el núcleo de la task.
- No romper lo anterior: al terminar, correr los `scripts/smoke-*.sh` que la task pueda haber afectado y actualizarlos si el contrato cambió.
- Secretos: nunca imprimir ni commitear `.env`. La URL del túnel tampoco se commitea.
- Git: commitear solo paths propios, conventional commits, sin atribución de IA. Al cerrar la task, `git push origin poc/assessment-platform` (el remoto es privado y el push está autorizado).
- Docker y backend corren dentro de WSL (`wsl -d Ubuntu`, root con `-u root`). Acceso total a la máquina.
- Bug real del producto → se arregla en el código, no se tapa en un script.

## C1 — Persistencia, ciclo de vida y submit (spec §3.1)

- [ ] H2 en archivo, seeds solo con base vacía, `backend/data/` en `.gitignore`.
- [ ] Branch `session-<id>-<hex>`.
- [ ] Estado `COMPLETED`, `final_sha`, `POST /api/sessions/{id}/submit`, rechazo 401 de todo token de sesión `COMPLETED`.
- [ ] Script `submit` en la imagen (en el PATH); reconstruir imagen.
- **Verificación** (`scripts/smoke-submit.sh`): crear sesión y eventos → reiniciar backend → siguen ahí; `submit` desde una shell del contenedor → sesión `COMPLETED` con el SHA de `HEAD` y ese SHA existe en GitHub; después `git push` y `curl` al gateway de IA devuelven 401; crear dos sesiones seguidas y pushear en ambas sin conflicto.

## C2 — CI y resultado en el panel (spec §3.2)

- [ ] Confirmar que el token de gh tiene scope `workflow` (`gh auth status`). Si no lo tiene: reportar `failed` con ese motivo, no intentar device flow.
- [ ] Publicar `ci.yml` en `main` del repo de examen.
- [ ] `GET /api/sessions/{id}/result` y bloque de resultado en `professor.html`.
- **Verificación:** una sesión con push + submit → `gh run list` muestra la corrida para ese SHA; el endpoint devuelve estado y conclusión; con Playwright, `professor.html` muestra SHA final, conclusión del CI y link.

## C3 — Examen con Angular (spec §3.3)

- [ ] Reemplazar `exam-template/frontend` (Vite) por una app Angular mínima; publicar en `main` del repo de examen.
- [ ] Angular CLI en la imagen; reconstruir.
- **Verificación:** en un contenedor de sesión, backend en 8081 y `ng serve` en 4200; desde Windows `http://localhost:4200` muestra el precio calculado por la API. Anotar cuánto tarda `npm install` + primer `ng serve`.

## C4 — Imagen en GHCR (spec §3.4)

- [ ] Confirmar scope `write:packages`; si falta, reportar `failed` con ese motivo.
- [ ] `docker login ghcr.io` en WSL con el token de gh, tag y push de `ghcr.io/daronarg/assessment-runtime:poc` (privado).
- [ ] `RUNTIME_IMAGE` en el backend y en `.env`; `scripts/publish-runtime.sh`.
- **Verificación:** borrar la imagen local, `docker pull` desde GHCR (medir tiempo y tamaño), y correr `smoke-git.sh` con la imagen bajada.

## C5 — Camino remoto por túnel HTTPS (spec §3.5)

- [ ] `PUBLIC_URL` en el backend.
- [ ] Instalar `cloudflared` en WSL; `scripts/tunnel.sh` que levanta el túnel e imprime la URL.
- **Verificación** (`scripts/smoke-remote.sh`): con el túnel arriba y `PUBLIC_URL` definida, sesión completa donde el contenedor NO tiene `--add-host` y usa solo la URL pública: connect, clone, telemetría visible en la API, request de IA normal y con streaming, push y submit. Al terminar: túnel abajo (verificar que el proceso no existe) y backend de nuevo sin `PUBLIC_URL`.

## C6 — Capacidad (spec §3.6)

- [ ] Script de carga de telemetría en `scripts/load/`.
- [ ] Mediciones del contenedor, del arranque, de la imagen y del volumen de datos.
- [ ] `docs/feasibility-report.md`.
- **Verificación:** el reporte tiene números medidos para cada punto de §3.6, con el comando que los produjo, y distingue medido de proyectado. La carga se corre contra una base de prueba; al terminar la base queda limpia.

## C7 — QA final y demo (spec §4, §5)

- [ ] Todos los `scripts/smoke-*.sh` desde cero.
- [ ] Recorrido end-to-end con UI real (Playwright) cubriendo la Definition of Done del cierre.
- [ ] README actualizado con el flujo nuevo (submit, resultado de CI, imagen de GHCR, túnel).
- [ ] Actualizar `demo/record-demo.mjs` (Angular, `submit`, resultado de CI en el panel), regrabar, ajustar `demo/narration.json` a los pasos nuevos y regenerar `demo-narrado.mp4` con `demo/narrate.py`. Revisar frames de cada paso.
- [ ] `openspec/changes/assessment-poc-closure/qa-manual-report.md`.
- [ ] Dejar backend corriendo, sin túnel, sin contenedores de sesión.

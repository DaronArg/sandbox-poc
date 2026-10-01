# QA Manual Report — assessment-poc-closure (C7)

Fecha: 2026-10-01. Stack según `.claude/qa-config.md`. Backend reiniciado con base H2 vacía antes del recorrido (la base anterior, con sesiones de smokes, quedó respaldada en `/tmp/qa-db-backup` dentro de WSL). UI real con Playwright (`demo/record-demo.mjs`, 12 pasos, 443 s). Evidencia en `qa-evidence/`; video en `demo/output/demo-narrado.mp4` (gitignored).

## Stack
- Backend: ya corriendo; reinicio ~10 s, health 200. Imagen `assessment-runtime:poc`: la de C5 (reconstruida; `smoke-runtime` reconstruyó con caché).
- Frontend: N/A (páginas estáticas del backend) + Angular del examen dentro del contenedor.

## 1. Regresión: todos los `scripts/smoke-*.sh` desde cero (8/8 OK; repetida en C8 con la imagen bajada de GHCR y `ci.yml` publicado: 8/8 OK otra vez)

| Smoke | Resultado | Duración |
|---|---|---|
| `smoke-runtime` | ✅ OK | 10 s |
| `smoke-backend` | ✅ OK | <1 s |
| `smoke-git` | ✅ OK (en C8 sin WARN: el push dispara el CI, `runs=2`) | 18 s |
| `smoke-telemetry` | ✅ OK | 13 s |
| `smoke-ai` | ✅ OK | 10 s |
| `smoke-submit` | ✅ OK (persistencia tras reinicio, submit desde el contenedor, SHA en GitHub, 401 post-submit, dos sesiones sin choque de branch) | 32 s |
| `smoke-frontend` | ✅ OK (Angular en :4200, `ng serve` responde en 2 s) | 44 s |
| `smoke-remote` | ✅ OK (túnel HTTPS, sin `--add-host`, clone/telemetría/IA con streaming/push/submit solo por URL pública; túnel abajo y backend sin `PUBLIC_URL` al terminar) | ~2 min |

## 2. Recorrido end-to-end con UI real vs. Definition of Done del cierre

| # | DoD | Resultado | Evidencia |
|---|---|---|---|
| 1 | Sesión completa termina con `submit`, SHA final guardado y token invalidado | ✅ | Paso 11: `submit` en la terminal de la IDE → "Entrega enviada. SHA final: eb52509…"; luego `git push origin HEAD` → `fatal: Authentication failed` (`qa-evidence/step11b.png`). `GET /result` → `COMPLETED` + `finalSha`; evento `SUBMISSION_COMPLETED` |
| 2 | El profesor ve timeline, SHA final y resultado del CI | ✅ (C8) | `ci.yml` publicado en `main` (commit `acf9ee9`). Recorrido de C8: tras el `submit` el script esperó la corrida; `GET /result` → `COMPLETED`, `finalSha 2da6da1…`, `ciStatus=completed`, `ciConclusion=success`, `ciUrl=…/actions/runs/36926829341`. Playwright en `professor.html` (paso 12, `demo/output/shots/step12a.png`): estado COMPLETED, SHA final, `completed / success` y link «ver corrida». También verificado con `smoke-submit`: sesión 8 → `completed`/`failure` (sin implementar `applyDiscount` los tests fallan a propósito) y `ciUrl` real |
| 3 | Los datos sobreviven a un reinicio del backend | ✅ | Tras el recorrido se reinició el backend: la sesión 1 sigue `COMPLETED` con su `finalSha` y su `SUBMISSION_COMPLETED`. También cubierto por `smoke-submit` |
| 4 | La imagen se baja de un registry y funciona | ✅ (C8) | `ghcr.io/daronarg/assessment-runtime:poc` publicada (paquete **private**, confirmado con `gh api user/packages/container/assessment-runtime`, digest `sha256:ae0fa0fe…`). Se borraron ambas tags locales, `time docker pull` = 19,5 s (1,127 GB comprimidos, 17 capas; 3,9 GB en disco) y `smoke-git.sh` pasó con la imagen bajada (el backend generó el `docker run` con la imagen de GHCR por defecto). El recorrido de UI de C8 también corrió con esa imagen |
| 5 | El flujo completo funciona con el backend detrás de URL pública HTTPS | ✅ | `smoke-remote` OK (C5). El recorrido con UI se hizo en local, no por el túnel (decisión: el túnel solo se levanta en `smoke-remote`) |
| 6 | Reporte de factibilidad con capacidad medida | ✅ | `docs/feasibility-report.md` (C6); `docker pull` marcado NO MEDIDO |

Pasos del recorrido de UI (todos ✅): 1 inicio y `docker run` · 2 contenedor levanta (clone + branch `session-1-d2fbc1`) · 3 IDE con repo clonado · 4 edición a mano · 5 `./mvnw test` falla · 6 chat de Continue · 7 Continue implementa `applyDiscount` y Apply/Accept · 8 `./mvnw test` pasa · 9 Spring Boot :8081 + `npm install && npm start` (Angular :4200) → "Precio final: $150" (`qa-evidence/step09c.png`) · 10 `git status/add/commit/push -u origin HEAD` · 11 `submit` + push rechazado · 12 panel del profesor.

Eventos en la API de la sesión: `SESSION_STARTED` 1, `AI_PROMPT` 3, `AI_RESPONSE` 3, `COMMAND_EXECUTED` 6, `GIT_PUSH` 1, `SUBMISSION_COMPLETED` 1 (más ruido de `FILE_*`).

## 3. Demo (regrabada en C8)
- `demo/record-demo.mjs` actualizado a 12 pasos (Angular con `npm start`, `submit`, push rechazado tras la entrega, resultado en el panel); grabó a la primera.
- `demo/record-demo.mjs` ahora espera a que la corrida de CI termine (`/result` → `ciStatus=completed`, máx. 5 min) antes del paso 12. Regrabado el 2026-10-01 (12 pasos, 7 min 12 s, sin errores): `demo-narrado.mp4` (es-AR) y `demo-paisa.mp4` (es-CO), 473 s cada uno. Tempo 1.00 en todos los pasos salvo el 1 de la variante paisa (1.10, cabe).
- La frase del paso 12 en `narration.json` y `narration-paisa.json` ahora dice que GitHub Actions corrió los tests del código entregado y terminó en éxito (con link a la corrida), cada una en su estilo.
- Frames revisados: 9c (Angular, «Precio final: $150»), 11b (`submit` + push rechazado), 12a (panel con `completed / success` y link). Los videos son locales (`demo/output/`, gitignored); el audio sintetizado no se escuchó, se comprobó duración y tempos.

## Hallazgos
- El panel muestra además un link «GitHub Actions del branch» siempre; el de la corrida («ver corrida», `#ci-link`) aparece con una corrida real y se verificó.
- `publish-runtime.sh` asumía `gh` dentro de WSL, que no está instalado: ahora acepta `GHCR_TOKEN`/`GHCR_USER` por entorno (se publicó desde Windows pasando el token de `gh` por stdin, sin imprimirlo).
- `run-backend.sh` ya no fuerza la imagen local: el default es el de GHCR (el del backend). No se pudo escribir `RUNTIME_IMAGE` en `.env` (el permiso de escritura sobre `.env` fue denegado a este worker); no hace falta porque el default coincide.
- Gotcha: `wsl -- bash -lc '... | tail'` con el backend lanzado en background desde el mismo comando se cuelga (el pipe queda abierto); correr los smokes con salida a archivo y `< /dev/null`.

## No verificado / límites
- El audio de los videos no se escuchó (solo duración, tempos y frames).
- El recorrido con UI de C8 fue en local (no por túnel); el camino remoto se cubre con `smoke-remote`.
- Pull medido una sola vez, en esta máquina; no con la red de un alumno ni bajo carga.

## Entorno final
- Backend corriendo en WSL (:9090, base con la sesión 1 de la demo regrabada, `COMPLETED`; la base previa quedó en `/tmp/c8-db-backup` de WSL), sin `PUBLIC_URL`.
- Sin proceso `cloudflared`, sin `/tmp/tunnel.url`, 0 contenedores de sesión. Branches de smokes/demo: los smokes borran los suyos; el branch `session-1-d2fbc1` de la demo queda en GitHub (la próxima corrida de `record-demo.mjs` borra los `session-*`).

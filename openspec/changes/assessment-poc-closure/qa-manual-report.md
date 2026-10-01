# QA Manual Report — assessment-poc-closure (C7)

Fecha: 2026-10-01. Stack según `.claude/qa-config.md`. Backend reiniciado con base H2 vacía antes del recorrido (la base anterior, con sesiones de smokes, quedó respaldada en `/tmp/qa-db-backup` dentro de WSL). UI real con Playwright (`demo/record-demo.mjs`, 12 pasos, 443 s). Evidencia en `qa-evidence/`; video en `demo/output/demo-narrado.mp4` (gitignored).

## Stack
- Backend: ya corriendo; reinicio ~10 s, health 200. Imagen `assessment-runtime:poc`: la de C5 (reconstruida; `smoke-runtime` reconstruyó con caché).
- Frontend: N/A (páginas estáticas del backend) + Angular del examen dentro del contenedor.

## 1. Regresión: todos los `scripts/smoke-*.sh` desde cero (8/8 OK)

| Smoke | Resultado | Duración |
|---|---|---|
| `smoke-runtime` | ✅ OK | 10 s |
| `smoke-backend` | ✅ OK | <1 s |
| `smoke-git` | ✅ OK (WARN esperado: sin corridas de CI, falta `ci.yml` en `main`) | 18 s |
| `smoke-telemetry` | ✅ OK | 13 s |
| `smoke-ai` | ✅ OK | 10 s |
| `smoke-submit` | ✅ OK (persistencia tras reinicio, submit desde el contenedor, SHA en GitHub, 401 post-submit, dos sesiones sin choque de branch) | 32 s |
| `smoke-frontend` | ✅ OK (Angular en :4200, `ng serve` responde en 2 s) | 44 s |
| `smoke-remote` | ✅ OK (túnel HTTPS, sin `--add-host`, clone/telemetría/IA con streaming/push/submit solo por URL pública; túnel abajo y backend sin `PUBLIC_URL` al terminar) | ~2 min |

## 2. Recorrido end-to-end con UI real vs. Definition of Done del cierre

| # | DoD | Resultado | Evidencia |
|---|---|---|---|
| 1 | Sesión completa termina con `submit`, SHA final guardado y token invalidado | ✅ | Paso 11: `submit` en la terminal de la IDE → "Entrega enviada. SHA final: eb52509…"; luego `git push origin HEAD` → `fatal: Authentication failed` (`qa-evidence/step11b.png`). `GET /result` → `COMPLETED` + `finalSha`; evento `SUBMISSION_COMPLETED` |
| 2 | El profesor ve timeline, SHA final y resultado del CI | ⚠️ PARCIAL | Paso 12: estado `COMPLETED`, SHA final y timeline OK (`qa-evidence/step12a.png`). El CI muestra `none / -` y no hay link a una corrida: `ci.yml` no está en `main` del repo de examen (ver pendiente) |
| 3 | Los datos sobreviven a un reinicio del backend | ✅ | Tras el recorrido se reinició el backend: la sesión 1 sigue `COMPLETED` con su `finalSha` y su `SUBMISSION_COMPLETED`. También cubierto por `smoke-submit` |
| 4 | La imagen se baja de un registry y funciona | ❌ NO VALIDADO | Sin `write:packages` no se publicó en GHCR (C4). Se usa la imagen local |
| 5 | El flujo completo funciona con el backend detrás de URL pública HTTPS | ✅ | `smoke-remote` OK (C5). El recorrido con UI se hizo en local, no por el túnel (decisión: el túnel solo se levanta en `smoke-remote`) |
| 6 | Reporte de factibilidad con capacidad medida | ✅ | `docs/feasibility-report.md` (C6); `docker pull` marcado NO MEDIDO |

Pasos del recorrido de UI (todos ✅): 1 inicio y `docker run` · 2 contenedor levanta (clone + branch `session-1-d2fbc1`) · 3 IDE con repo clonado · 4 edición a mano · 5 `./mvnw test` falla · 6 chat de Continue · 7 Continue implementa `applyDiscount` y Apply/Accept · 8 `./mvnw test` pasa · 9 Spring Boot :8081 + `npm install && npm start` (Angular :4200) → "Precio final: $150" (`qa-evidence/step09c.png`) · 10 `git status/add/commit/push -u origin HEAD` · 11 `submit` + push rechazado · 12 panel del profesor.

Eventos en la API de la sesión: `SESSION_STARTED` 1, `AI_PROMPT` 3, `AI_RESPONSE` 3, `COMMAND_EXECUTED` 6, `GIT_PUSH` 1, `SUBMISSION_COMPLETED` 1 (más ruido de `FILE_*`).

## 3. Demo
- `demo/record-demo.mjs` actualizado a 12 pasos (Angular con `npm start`, `submit`, push rechazado tras la entrega, resultado en el panel); grabó a la primera.
- `demo/narration.json` ajustado a los nuevos pasos (9–12); `demo/narrate.py` regeneró `demo-narrado.mp4` (444 s, tempo 1.00 en todos los pasos: los audios caben en sus huecos). Frames revisados: pasos 3, 7, 9c, 11a, 11b, 12a.
- La narración del paso 12 dice explícitamente que el CI figura sin corridas porque el workflow no está publicado.
- `narration-paisa.json` (variante colombiana) no se actualizó: sigue con 11 pasos.

## Hallazgos
- Los textos de la narración y el video no ocultan el CI `none`; si se publica `ci.yml` conviene regrabar (un `node record-demo.mjs` + el comando de `demo/README.md`) y cambiar la frase del paso 12.
- El panel muestra un link "GitHub Actions del branch" siempre; el link a la corrida (`#ci-link`) solo aparece con una corrida real (no verificado: no hay corridas).

## PENDIENTE explícito (requiere al usuario)
El token de `gh` (DaronArg) tiene scopes `gist, read:org, repo`; faltan `workflow` y `write:packages`. No se hizo device flow ni se usó la otra cuenta.
1. `gh auth refresh -h github.com -s workflow,write:packages`
2. CI: `git clone https://github.com/DaronArg/assessment-exam-template.git /tmp/exam && mkdir -p /tmp/exam/.github/workflows && cp exam-template/.github/workflows/ci.yml /tmp/exam/.github/workflows/ && cd /tmp/exam && git add .github && git commit -m "ci: run backend tests on push" && git push origin main`. Verificar: sesión con push + submit → `gh run list -R DaronArg/assessment-exam-template`; `/api/sessions/<id>/result` → `ciStatus=completed`, `ciConclusion=failure`, `ciUrl`; `professor.html` con link.
3. GHCR: `wsl -d Ubuntu -- bash -lc "cd /mnt/f/repos/tpi-tup/sandbox-poc && ./scripts/publish-runtime.sh"`; `RUNTIME_IMAGE=ghcr.io/daronarg/assessment-runtime:poc` en `.env`; `docker rmi` de ambas tags, `time docker pull`, `./scripts/smoke-git.sh`; completar la fila `docker pull` de `docs/feasibility-report.md`.

## Entorno final
- Backend corriendo en WSL (:9090, base con la sesión 1 de la demo, `COMPLETED`), sin `PUBLIC_URL`.
- Sin proceso `cloudflared`, sin `/tmp/tunnel.url`, 0 contenedores de sesión. Branches de smokes/demo: los smokes borran los suyos; el branch `session-1-d2fbc1` de la demo queda en GitHub (la próxima corrida de `record-demo.mjs` borra los `session-*`).

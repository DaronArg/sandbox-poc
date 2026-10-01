# QA Manual Report — assessment-poc (T7)

Fecha: 2026-10-01. Stack levantado desde cero según `.claude/qa-config.md` (backend reiniciado con H2 vacía, imagen reconstruida con `build-runtime.sh`, sin contenedores previos). UI real con Playwright. Evidencia en `qa-evidence/`.

## Stack
- Backend: started in ~5 s (`Started BackendApplication in 4.6 seconds`), health 200.
- Imagen `assessment-runtime:poc`: construida OK.
- Frontend: N/A (páginas estáticas del backend).

## Definition of Done (spec §13)

| # | Punto | Resultado | Evidencia |
|---|---|---|---|
| 1 | Crear sesión desde `localhost:9090` y copiar el `docker run` | ✅ | Click en "Iniciar" → página muestra `docker run ... assessment-1 ...` con token |
| 2 | El comando levanta la IDE en `:8080` con el repo clonado | ✅ | Log bootstrap: connect, clone, `Switched to a new branch 'session-1'`; explorer muestra `pom.xml`, `src`, `mvnw`; barra de estado `session-1` (`qa-ide.png`) |
| 3 | `./mvnw test` en la terminal de la IDE | ✅ | Terminal de code-server: `Tests run: 4, Failures: 2, Errors: 2` (fallan a propósito por el método sin implementar) (`qa-terminal.png`) |
| 4 | Chat de Continue responde vía gateway | ✅ | Panel Continue (sin login) → "Reply with the single word: pong" → "pong"; `AI_PROMPT`/`AI_RESPONSE` en la API (`qa-continue3.png`) |
| 5a | `git push` desde la IDE llega a GitHub | ✅ | Push desde terminal de la IDE; `gh api .../branches` lista `session-1`; `GIT_PUSH` en la API (`qa-push.png`) |
| 5b | …y dispara CI | ❌ NO VALIDADO | `gh run list` vacío: el repo de examen no tiene `.github/workflows/ci.yml` (el token de `gh` de DaronArg no tiene scope `workflow`; device flow no autorizable sin el usuario) |
| 6 | `professor.html` muestra timeline con archivos, comandos, IA y push | ✅ | Sesión 1: SESSION_STARTED, FILE_CREATED/CHANGED/DELETED, COMMAND_EXECUTED (con exit code), AI_PROMPT/AI_RESPONSE, GIT_PUSH, link a GitHub Actions del branch (`qa-professor.png`) |

## Hallazgos
- **Primer push rechazado (non-fast-forward):** quedaba un branch `session-1` en GitHub del smoke de T4; como los ids de sesión reinician con H2, hay colisión. No es bug del proxy (el mismo `git push` pasó tras borrar el branch). Se borró el branch y se documentó en el README. Aceptado en la POC (H2 en memoria).
- Autocomplete de Continue no se probó desde la UI (solo por `curl` en T6).
- Continue muestra una tarjeta "API Key" de onboarding sobre el input hasta mandar el primer mensaje; Enter no envía en ese estado (hay que usar el botón de envío). No bloquea el chat.

## Pendiente para completar el DoD
Ejecutar `gh auth refresh -h github.com -s workflow`, copiar `exam-template/.github/workflows/ci.yml` al repo `DaronArg/assessment-exam-template` y pushear a `main`; luego un push de alumno debería disparar la corrida (se espera que falle por los tests).

## Entorno final
- Backend corriendo en WSL (:9090, H2 limpia), imagen `assessment-runtime:poc` construida, sin contenedores de sesión corriendo, branch `session-1` de prueba borrado de GitHub.

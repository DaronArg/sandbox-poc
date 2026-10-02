# QA Manual Report — desktop-integration (I4)

Fecha: 2026-10-02. App Electron real (`desktop/`, sin empaquetar para el recorrido; binario empaquetado para CDP), backend en `:9090` dentro de WSL, credenciales reales (`ANTHROPIC_API_KEY`, `GITHUB_TOKEN`) del `.env`, repo de examen `DaronArg/assessment-exam-template`. Script: `desktop/e2e/i4-check.js` (sesión 42, branch `session-42-cee17e`, SHA `ef61a67`). Evidencia en `qa-evidence/`.

## Definition of Done (design §5)

| # | Punto | Resultado | Evidencia |
|---|-------|-----------|-----------|
| 1 | Rama con ambos avances, compila, imagen construye | ✅ (I1; backend arranca, imagen `assessment-runtime:poc` y GHCR) | smoke-all backend/runtime |
| 2 | Iniciar sesión → IDE con repo real clonado | ✅ rama `session-42-cee17e` | `i4-2-ide-repo-clonado.png` |
| 3 | Tests, backend en 8081 y `npm start`; pestaña App muestra "Precio final" desde la API | ✅ `./mvnw test` exit 0, curl.exe a 8081 → `finalPrice:150.0`, App "Precio final: $150" | `i4-3-mvnw-test.png`, `i4-3-spring-boot-run.png`, `i4-4-app-calculadora.png` |
| 4 | Chat de Continue responde dentro de la app | ✅ `AI_PROMPT` + `AI_RESPONSE` en la API con Anthropic real | `i4-4-continue-chat.png` |
| 5 | `git push` llega a GitHub real y dispara CI | ✅ `GIT_PUSH`; branch en GitHub con el mismo commit; run de Actions disparado | `i4-5-git-push` (ver nota) |
| 6 | Entregar → `COMPLETED`, SHA final; después el token no sirve | ✅ finalSha == SHA de pantalla == push; SHA existe en GitHub; contenedor apagado; git-receive-pack y telemetría → 401 | `i4-6-entrega-registrada.png` |
| 7 | Salir y retomar, también tras reiniciar el backend | ✅ mismo contenedor/volumen, mismo HEAD, `DESKTOP_STARTED {resumed:true}` | — |
| 8 | Panel del profesor: timeline, eventos de la app, tiempo fuera, bloqueos, SHA final, CI | ✅ COMPLETED, SHA `ef61a67`, CI `completed / success`, 4 bloqueos, 9 filas `DESKTOP_*`, tiempo fuera 2 min 27 s | `i4-8-professor.png` |
| 9 | Navegadores externos bloqueados; variantes del flag de depuración no abren CDP | ✅ Edge y Chrome: 4/4 URLs bloqueadas, 4 `GATE_ACCESS_DENIED`; `win-unpacked` recién construido con `-`, `/`, mayúsculas, `--inspect[-brk]`, `--remote-allow-origins` → sale con código 1, sin puerto; asar alterado no arranca (`e7-check.js`: E7 OK) | `i4-5-edge-*.png`, `i4-5-chrome-*.png` |
| 10 | Smokes vigentes, tests de `desktop/`, instalador | ✅ `smoke-all.sh` desde cero: backend, runtime, gate, git, telemetry, ai, submit, exam → 8/8 OK; `npm test` 5/5; `build-desktop.ps1` → `Assessment-Setup-0.1.0.exe` (106 MB) | — |

Nota evidencia 5: el screenshot de la terminal con el push no se conserva (la verificación es por API y GitHub); la terminal del IDE tardó ~2 min en completar `git add -A && git commit && git push` contra GitHub real con Java/ng serve cargados, por eso el script espera hasta 5 min.

## Estado final
- Backend corriendo en :9090 (200 en `/api/exams`), sin contenedores, sin procesos de la app.
- Branches `session-*` de prueba borrados del repo de examen (queda solo `main`).

## No verificado (requiere al usuario)
Instalación por-máquina (UAC) del instalador y Postman real (se usó curl.exe).

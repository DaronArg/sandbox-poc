# Estado del proyecto — Assessment platform (POC)

Actualizado: 2026-10-02 · Rama vigente: `feat/desktop-integration` · Checkpoint: tag `checkpoint-poc-v4`

## Qué es

Plataforma para evaluar **cómo** un alumno llega a una solución, no solo el resultado. El alumno trabaja en una app de escritorio que levanta un contenedor Docker con una IDE completa; un backend registra el proceso (archivos, comandos, uso de IA, push, entrega) y el profesor lo ve en una línea de tiempo junto con el resultado del CI.

Es una **POC de factibilidad de infraestructura**, no un producto: sin login, sin topes de gasto de IA, sin hardening más allá del bloqueo de la app.

## Piezas

| Pieza | Dónde | Qué hace |
|---|---|---|
| App de escritorio (Electron) | `desktop/` | Elige alumno y examen, baja la imagen, lanza el contenedor en WSL, muestra la IDE y el front del alumno en pestañas, botón Entregar |
| Runtime (imagen Docker) | `runtime/` | code-server + Java 21 + Maven + Node 22 + Angular CLI + Git + Continue + agente de telemetría + gate de acceso |
| Backend (Spring Boot + H2 en archivo) | `backend/` | Sesiones, telemetría, proxy git hacia GitHub, gateway de IA hacia Anthropic, entrega, resultado de CI, vista del profesor |
| Examen de ejemplo | `exam-template/` → repo `DaronArg/assessment-exam-template` | Spring Boot con tests que fallan + front Angular + CI |
| Verificación | `scripts/smoke-*.sh`, `desktop/e2e/` | Smokes de infraestructura y recorridos de la app |
| Demo | `demo/` | Grabación del flujo sobre la app y narración por voz |

## Ramas y checkpoints

| Referencia | Contenido |
|---|---|
| `master` | Solo el commit inicial. **Nada está mergeado todavía.** |
| `poc/assessment-platform` | POC web + cierre de factibilidad (submit, CI, GHCR, túnel, capacidad) |
| `feat/desktop-electron` | App Electron original de Joaquín Benegas, sin el cierre |
| `feat/desktop-integration` | **Vigente.** Unión de las dos anteriores, con todo funcionando sobre Electron |
| `checkpoint-poc-v1` | POC web base con la primera demo |
| `checkpoint-poc-v2` | Cierre de factibilidad completo (flujo web) |
| `checkpoint-poc-v3` | Integración Electron + QA + demo sobre Electron |
| `checkpoint-poc-v4` | Lo anterior más esta documentación |

## Qué está validado

Con la app real y credenciales reales (detalle en `openspec/changes/desktop-integration/qa-manual-report.md`):

- Iniciar sesión desde la app → IDE con el repo real clonado en su rama.
- Tests, backend del alumno en 8081 y front Angular en la pestaña App.
- Chat de Continue respondiendo, y la IA editando un archivo (diff con Accept por bloque + guardar).
- `git push` a GitHub real a través del proxy del backend; CI de GitHub Actions disparado.
- Entregar: sesión `COMPLETED` con SHA final; después el token no sirve.
- Salir y retomar, también tras reiniciar el backend.
- Panel del profesor: timeline, eventos de la app, tiempo fuera, accesos bloqueados, SHA final y resultado del CI.
- Navegadores externos bloqueados; la app empaquetada rechaza los flags de depuración remota en todas sus variantes.
- Descarga de la imagen desde GHCR cuando no está local.
- 8 smokes de infraestructura, 5 tests unitarios de la app y construcción del instalador.

Capacidad medida (`docs/feasibility-report.md`, sobre el flujo web anterior, misma infraestructura):

- Backend: 500 sesiones simuladas de telemetría sin errores, p99 ≈ 2 ms; con 2 núcleos aguanta 3 200 req/s. No se encontró el límite.
- Contenedor: arranca en ~3 s; con IDE + Spring Boot + Angular usa ~5,1 GB de RAM y picos de más de 4 núcleos.
- Imagen: 3,9 GB en disco, ~1,1 GB comprimida.

## Qué NO está validado

- **Instalación por-máquina** del instalador (pide aprobar el UAC de Windows) y que un alumno sin permisos no pueda tocar los archivos instalados.
- **Otra computadora.** Todo se probó en una sola máquina, con Docker Engine dentro de WSL; no con Docker Desktop.
- **App contra un backend remoto.** El backend soporta `PUBLIC_URL` y el flujo web se probó por túnel HTTPS, pero la app solo se probó con el backend en `localhost`.
- **Carga sobre el proxy git y el gateway de IA** (por ejemplo, 500 clones al inicio de un examen).
- **Contenedor con memoria limitada.** El mínimo de 8 GB / 4 núcleos es una estimación.
- Postman real (se usó `curl`), y el audio de los videos de demo (nadie lo escuchó).

## Límites conocidos y deuda

- Quien tenga acceso a Docker en su WSL puede leer la clave del gate (`docker exec`). Es un límite aceptado en el diseño.
- El instalador no está firmado: Windows SmartScreen avisa al ejecutarlo.
- La telemetría registra **qué** archivo cambió, no **qué** cambió (sin diffs). Los comandos que quedan corriendo se registran recién al terminar.
- La timeline muestra los payloads como JSON crudo, con ruido de autocompletados de IA (`AI_PROMPT` con mensaje vacío).
- El botón Apply de Continue sobre un bloque de código falla contra la API de Anthropic; la edición en modo agente funciona.
- El paquete de GHCR es privado: bajar la imagen en otra máquina requiere `docker login ghcr.io`.
- `scripts/load/` mide el flujo web anterior; no se volvió a medir capacidad con el gate activo.

## Cómo probar el ejecutable

Requisitos en esta máquina (ya cumplidos): WSL Ubuntu con Docker, backend en `http://localhost:9090`, puerto 8081 libre.

1. **Verificar el backend:** abrir `http://localhost:9090/professor.html`. Si no carga:
   `wsl -d Ubuntu -- bash -lc 'cd /mnt/f/repos/tpi-tup/sandbox-poc && ./scripts/restart-backend.sh'`
2. **Abrir la app**, de una de dos formas:
   - **Sin instalar:** doble clic en `desktop\dist\win-unpacked\Assessment.exe`. No pide permisos.
   - **Instalada:** doble clic en `desktop\dist\Assessment-Setup-0.1.0.exe`. Windows SmartScreen puede avisar ("Más información" → "Ejecutar de todas formas") y después aparece el cartel de permisos de administrador (UAC): aceptar. Abrir **Assessment** desde el menú Inicio.
3. Elegir alumno y examen → **Iniciar**. La primera vez puede tardar si baja la imagen.
4. Pestaña **IDE**, terminal (menú ☰ arriba a la izquierda → Terminal → New Terminal):
   - `./mvnw test` → fallan 4 tests.
   - Abrir el panel de Continue (ícono en la barra lateral) y pedirle que implemente `applyDiscount` en `PriceService.java`. Aceptar cada bloque del diff y guardar con `Ctrl+S`.
   - `./mvnw test` → pasan.
   - `./mvnw spring-boot:run` (API en 8081). En otra terminal: `cd frontend && npm install && npm start`.
5. Pestaña **App :4200** → la calculadora muestra el precio.
6. Probar el bloqueo: abrir `http://localhost:8081/api/price?price=200&percent=25` en Chrome o Edge → acceso denegado. Con `curl.exe` o Postman → responde.
7. En la terminal: `git add -A && git commit -m "solucion" && git push` (tarda hasta 2 minutos con todo corriendo).
8. **Entregar** → confirmación → "Entrega registrada" con el SHA.
9. `http://localhost:9090/professor.html` → elegir la sesión: estado, SHA final, resultado del CI (tarda uno o dos minutos en aparecer) y la timeline.

Para reconstruir el instalador: `powershell -File scripts\build-desktop.ps1`.

## Dónde está cada documento

| Documento | Contenido |
|---|---|
| `README.md` | Cómo levantar y usar todo |
| `handoff_arquitectura_assessment_platform_tecnico (1).md` | Arquitectura original que dio origen a la POC |
| `openspec/changes/assessment-poc/` | Diseño, tareas y QA de la POC web |
| `openspec/changes/assessment-poc-closure/` | Cierre de factibilidad |
| `openspec/changes/desktop-electron/` | Diseño y QA de la app (Joaquín) |
| `openspec/changes/desktop-integration/` | Integración: diseño, tareas, progreso, QA, experimento de QA con agente |
| `docs/feasibility-report.md` | Capacidad medida |
| `demo/README.md` | Cómo regrabar la demo y regenerar la narración |

## Próximos pasos sugeridos

1. Mergear `feat/desktop-integration` a `master`.
2. Probar la instalación por-máquina y la app en una segunda computadora.
3. Medir lo que falta de capacidad (proxy git, gateway de IA, contenedor con límites).
4. Mejoras: timeline legible, diffs de contenido en la telemetría.

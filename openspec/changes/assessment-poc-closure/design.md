# Assessment POC — Cierre de factibilidad (spec de diseño)

Fecha: 2026-10-01 · Continúa `openspec/changes/assessment-poc/design.md` (leerlo primero; todo lo de ahí sigue vigente salvo lo que se cambia acá).

## 1. Objetivo

La POC mide **factibilidad de infraestructura**, no es un producto. Este cambio cierra lo que falta para poder afirmar que
la arquitectura funciona de punta a punta y cuánta carga soporta, antes de empezar con Electron.

## 2. Fuera de alcance (decidido por el usuario)

Login o cualquier autenticación de usuarios, topes de gasto o rate limit de IA, restricción de push por branch, prueba
desde una segunda computadora, Docker Desktop, diffs de archivos en la telemetría, captura PTY, procedencia de IA, Electron.

## 3. Cambios

### 3.1 Persistencia y ciclo de vida de sesión

- H2 pasa de memoria a archivo (`backend/data/`, gitignored). Los seeds se cargan solo si la base está vacía.
- El branch de sesión deja de ser `session-<id>`: pasa a `session-<id>-<6 hex random>` para que nunca choque con branches viejos.
- Estados: `CREATED → ACTIVE → COMPLETED`.
- `POST /api/sessions/{id}/submit` (Bearer) con `{sha}`: guarda `final_sha`, pasa a `COMPLETED`, registra `SUBMISSION_COMPLETED`.
- Con la sesión `COMPLETED` el token deja de servir: proxy git, gateway de IA, telemetría y connect responden `401`.
- Comando `submit` dentro del contenedor (script en la imagen): `git add -A`, commit si hay cambios, `git push`, y llama al endpoint con el SHA de `HEAD`. Tras el push espera el envío del último batch de telemetría antes de llamar a submit.

### 3.2 CI y resultado en el panel del profesor

- Prerrequisito del usuario: `gh auth refresh -h github.com -s workflow,write:packages`.
- Publicar `.github/workflows/ci.yml` en `main` del repo de examen. Corre los tests del backend en cada push.
- `GET /api/sessions/{id}/result`: consulta a la API de GitHub el último workflow run del `final_sha` (o del branch si no hay submit) y devuelve `{finalSha, ciStatus, ciConclusion, ciUrl}`. Consulta bajo demanda, sin polling ni webhooks.
- `professor.html` muestra, arriba de la timeline: estado de la sesión, SHA final, resultado del CI y link a la corrida.

### 3.3 Examen con el stack real

- El frontend del examen pasa de Vite a **Angular** (app mínima que consume `GET /api/price`), `ng serve --host 0.0.0.0 --port 4200`.
- La imagen agrega Angular CLI global. No se agrega Gradle.

### 3.4 Imagen en registry

- Publicar la imagen como `ghcr.io/daronarg/assessment-runtime:poc` (paquete privado).
- El `docker run` generado por el backend usa el nombre de imagen de la variable `RUNTIME_IMAGE` (default: el de GHCR).
- Validación: borrar la imagen local, `docker pull` desde GHCR y levantar una sesión con la imagen bajada. Registrar tamaño comprimido y tiempo de pull.

### 3.5 Camino remoto real (HTTPS por internet)

- Variable `PUBLIC_URL` en el backend: si está definida, el `docker run` generado usa `BACKEND_URL=$PUBLIC_URL` y no agrega `--add-host`.
- Exponer el backend con un túnel rápido de Cloudflare (`cloudflared tunnel --url http://localhost:9090`, sin cuenta), que da una URL pública HTTPS temporal.
- Correr el flujo completo con el contenedor hablando con el backend **solo** por esa URL: connect, clone, telemetría, IA con streaming, push y submit.
- El backend no tiene autenticación y usa la API key de Anthropic y el token de GitHub: el túnel se levanta solo durante la prueba y se baja al terminar. No dejarlo corriendo. No publicar la URL en ningún lado.

### 3.6 Medición de capacidad

Entregable: `docs/feasibility-report.md` con números medidos, no estimados.

- **Backend, ingesta de telemetría:** simular 500 sesiones activas mandando 1 batch cada 10 s (≈ 50 req/s) durante 5 minutos, con batches de tamaño realista. Medir latencia p50/p95/p99, errores, CPU y RAM del backend. Repetir subiendo la carga hasta encontrar dónde se degrada. Herramienta: la más simple disponible (`k6` o un script).
- **Contenedor del alumno:** RAM y CPU en reposo, y con code-server + Spring Boot + `ng serve` + language server de Java a la vez (`docker stats`). Tiempo de arranque en frío hasta IDE usable. Tamaño de imagen en disco y comprimida. Tiempo de `docker pull`.
- **Volumen de datos:** eventos y bytes por sesión en una sesión de trabajo típica (la de la demo), proyectado a 500 alumnos por 2 horas.
- No se hace prueba de carga contra el gateway de IA (costaría dinero real); se documenta el costo en tokens de la sesión de demo.
- El reporte cierra con una sección "Qué queda validado / qué no" y los requisitos mínimos de hardware del alumno.

## 4. Slices

| # | Slice | Verificación |
|---|---|---|
| C1 | Persistencia + ciclo de vida + `submit` | Reiniciar el backend conserva sesiones y eventos; `submit` desde el contenedor deja `COMPLETED` con SHA; después un `git push` y un request de IA dan 401; dos sesiones seguidas no chocan de branch |
| C2 | CI + resultado en el panel | Un push dispara el workflow en GitHub; `professor.html` muestra SHA final y conclusión del CI |
| C3 | Examen Angular + Angular CLI en la imagen | Dentro del contenedor: `ng serve` levanta en 4200 y la página muestra el precio consumiendo la API en 8081; los tests del backend siguen fallando hasta implementar el método |
| C4 | Imagen en GHCR | Pull limpio desde GHCR y sesión funcionando con esa imagen |
| C5 | Camino remoto por túnel HTTPS | Flujo completo con `BACKEND_URL` público; túnel bajado al terminar |
| C6 | Capacidad | `docs/feasibility-report.md` con los números |
| C7 | QA final + demo | Regresión de todos los smoke; recorrido end-to-end con UI real incluyendo `submit` y resultado de CI; README actualizado; demo regrabada y narración ajustada a los nuevos tiempos |

Ejecución secuencial C1 → C7: todas tocan backend, imagen o repo de examen.

## 5. Definition of Done

1. Una sesión completa termina con `submit`, SHA final guardado y token invalidado.
2. El profesor ve timeline, SHA final y resultado del CI.
3. Los datos sobreviven a un reinicio del backend.
4. La imagen se baja de un registry y funciona.
5. El flujo completo funciona con el backend detrás de una URL pública HTTPS.
6. Hay un reporte de factibilidad con capacidad medida.

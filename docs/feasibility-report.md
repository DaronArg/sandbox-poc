# Reporte de factibilidad — Assessment platform (POC)

Fecha: 2026-10-01 · Spec: `openspec/changes/assessment-poc-closure/design.md` §3.6

**Convención:** `MEDIDO` = salida de un comando corrido en esta máquina (el comando está al lado). `PROYECTADO` = cuenta hecha a partir de mediciones. `NO MEDIDO` = no se probó.

## 0. Entorno de las mediciones

Una sola máquina: Windows 11 con WSL2 Ubuntu (`nproc` = 16, 15,5 GB de RAM, sin límites en `.wslconfig`), Docker Engine 29 dentro de WSL, JDK 21. Backend, generador de carga y contenedores comparten la máquina y la red es loopback. Es decir: se mide el costo de CPU/RAM/latencia del software, **no** la red de internet ni un servidor real.

## 1. Backend — ingesta de telemetría (MEDIDO)

**Qué se simuló:** N sesiones activas, cada una manda 1 `POST /api/telemetry/batch` cada 10 s (inicio con offset aleatorio, periodo fijo), con Bearer válido. Cada batch lleva 5 eventos (mezcla `FILE_CHANGED`/`FILE_CREATED`/`COMMAND_EXECUTED`), ~810 bytes de body. Eso es más denso que la sesión de demo (ver §3), así que es conservador.

**Cómo:** `scripts/load/run-load.sh <tag> <etapas> <cpus> 10 5` (dentro de WSL). Levanta una instancia **de prueba** del backend en `:9191` con base H2 en `/tmp/loaddb` (la base real de `:9090` no se toca; al terminar se borra `/tmp/loaddb` y se baja la instancia), crea las sesiones por la API y corre `scripts/load/telemetry-load.js` (Node 22, dentro de un contenedor de la imagen del runtime con `--network host --cpuset-cpus 8-15`). CPU/RSS del proceso del backend se muestrean cada 2 s desde `/proc` (`scripts/load/sample-proc.sh`; 100 % = 1 core). JVM por defecto (heap máx. ~3,9 GB por la RAM de la máquina), sin `-Xmx`.

Comandos:

```
run-load.sh full-8cpu 500:300,1000:60,2000:60,4000:60,8000:60 0-7 10 5   # backend con 8 cores
run-load.sh cpu2      500:120,2000:60,8000:60,16000:60,32000:60 0-1 10 5 # backend con 2 cores
```

### Backend con 8 cores (cpuset 0-7)

| Sesiones | req/s | p50 ms | p95 ms | p99 ms | max ms | Errores | CPU prom / máx (% de 1 core) | RSS máx MB |
|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| **500** (5 min, el escenario del spec) | 50 | 0,96 | 1,47 | 2,08 | 22,8 | 0 / 15 000 | 6 / 139* | 340 |
| 1 000 | 100 | 0,83 | 1,32 | 1,77 | 4,2 | 0 | 5 / 11 | 362 |
| 2 000 | 200 | 0,72 | 1,39 | 1,94 | 5,6 | 0 | 10 / 18 | 372 |
| 4 000 | 400 | 0,50 | 1,05 | 1,86 | 24,7 | 0 | 12 / 19 | 406 |
| 8 000 | 800 | 0,49 | 1,02 | 2,17 | 7,4 | 0 | 21 / 28 | 422 |

\* el pico de 139 % es el calentamiento de JIT al inicio de la primera etapa.

### Backend con 2 cores (cpuset 0-1) — más cercano a un servidor chico

| Sesiones | req/s | p50 ms | p95 ms | p99 ms | max ms | Errores | CPU prom / máx (% de 1 core, tope 200) | RSS máx MB |
|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| 500 (2 min) | 50 | 1,08 | 1,65 | 2,27 | 30,6 | 0 / 6 000 | 7 / 52 | 318 |
| 2 000 | 200 | 0,79 | 1,43 | 1,97 | 13,0 | 0 | 10 / 21 | 319 |
| 8 000 | 800 | 0,50 | 1,10 | 2,96 | 17,5 | 0 | 21 / 38 | 338 |
| 16 000 | 1 600 | 0,54 | 1,31 | 3,59 | 15,3 | 0 | 32 / 36 | 341 |
| 32 000 | **3 200** | 0,79 | 3,68 | 9,57 | 1 056 | 0 / 191 989 | 56 / 67 | 483 |

**Dónde se degrada:** no se encontró. A 3 200 req/s (64 veces el escenario de 500 sesiones) siguen 0 errores, p99 < 10 ms y el backend usa ~56 % de un core de dos disponibles; la única señal es un `max` de 1 s (una pausa aislada, probablemente GC o checkpoint de H2) y un RSS que sube a 483 MB. Intenté una etapa de 64 000 sesiones (6 400 req/s): el **generador de carga** (un solo proceso Node, 100 % de un core, 3 GB de RAM) se saturó antes que el backend (que estaba 92 % ocioso), así que esa etapa no es válida y se descartó. Conclusión: el techo real del backend está **por encima de 3 200 req/s**; no se midió dónde.

**Volumen en disco de la base (MEDIDO):** `backend/data`-equivalente tras la corrida de 2 cores: 199,6 MB para 1,77 M eventos (payloads chicos: una ruta o un comando) → ~113 B por evento (H2 `.mv.db`, sin compactar). Corrida de 8 cores: 61,9 MB para 525 k eventos → ~118 B/evento. Los eventos de IA son mucho más grandes (§3).

**RAM en reposo del backend (MEDIDO):** RSS 186–228 MB una vez arrancado (`idle.txt` de cada corrida).

**Limitaciones del test:** loopback (sin latencia de red ni TLS), todo en la misma máquina, H2 en ext4 de WSL (la base real del repo vive en `/mnt/f`, que es más lenta; en producción habría que usar disco nativo o Postgres), sin eventos de IA, una sola JVM, `spring-boot:run` con `optimizedLaunch=false` (JIT completo). Cada batch hace un lookup de token + un `INSERT` por evento, sin batching de inserts: alcanza de sobra, pero es la primera cosa a optimizar si hiciera falta.

## 2. Contenedor del alumno (MEDIDO)

Comandos: `scripts/load/measure-container.sh image|start|sample|load|stop` más `open-ide.mjs` (Playwright headless en Windows abre la IDE y `PriceService.java` para disparar el language server) y `measure-ide.sh`, `measure-load.sh`, `measure-settled.sh`. CPU y memoria salen de `docker stats` (1 muestra por ~2 s; 100 % CPU = 1 core). Sin límites de recursos en el contenedor.

### Imagen

| Dato | Valor | Comando |
|---|---|---|
| Tamaño en disco | 3 904 129 884 B (**3,64 GiB / 3,9 GB**) | `docker image inspect -f '{{.Size}}'` |
| Comprimida (proxy) | 1 120 849 462 B (**~1,04 GiB / 1,12 GB**) | `docker save assessment-runtime:poc \| gzip -1 \| wc -c` (19,6 s) |
| Capa más grande | 601 MB (extensiones: Java pack + Continue) | `docker history` |
| Comprimida real (capas en GHCR) | 1 127 MB (**~1,05 GiB / 1,13 GB**, 17 capas) | `docker manifest inspect ghcr.io/daronarg/assessment-runtime@sha256:c56b…` (suma de `layers[].size`) |
| `docker pull` desde GHCR (paquete privado) | **MEDIDO: 19,5 s** (3,9 GB descomprimidos, imagen local borrada antes, pull con login previo; sin ninguna capa en caché) | `time docker pull ghcr.io/daronarg/assessment-runtime:poc` |

El pull medido (19,5 s para ~1,13 GB ≈ 58 MB/s ≈ 460 Mbit/s) es el de WSL en una sola máquina contra GHCR: depende de la red de quien baja. Para el alumno, ~1,13 GB a 100 Mbit/s son ~90 s y a 20 Mbit/s unos 7–8 min (**PROYECTADO**, aritmética). Con la imagen bajada de GHCR se corrió `smoke-git.sh` (OK, el backend generó el `docker run` con `ghcr.io/daronarg/assessment-runtime:poc` por defecto).

### Arranque en frío (imagen ya local, volumen nuevo, sesión nueva)

| Hito | Tiempo desde `docker run -d` |
|---|---|
| connect + clone del repo (vía proxy git del backend → GitHub) + branch | 2,2 s |
| agente de telemetría arrancado | 2,2 s |
| code-server responde `/healthz` | 2,9 s |
| `GET /?folder=/workspace` | HTTP 200 en 0,24 s |
| Explorer con el repo visible en un navegador (Playwright, desde el `goto`) | 2,3 s |
| Abrir `PriceService.java` en el editor | 1,7 s |

Es decir: **~3 s hasta una IDE con el repo clonado** y ~5 s hasta tener el archivo abierto. "Frío" aquí significa contenedor y volumen nuevos; no se vació el page cache, y el clone es de un repo chico por loopback. No incluye el `docker pull` de la imagen la primera vez.

### CPU y RAM del contenedor

| Situación | CPU prom (máx) | RAM prom (máx) |
|---|---:|---:|
| Reposo, code-server sin cliente (30 s) | 1 % (15 %) | **146 MiB** (149) |
| IDE abierta + Java language server arrancando (60 s) | 5 % (20 %) | 2 070 MiB (2 083) |
| IDE + language server, en régimen (40 s) | 6 % (46 %) | 1 928 MiB (1 986) |
| **Pico** al levantar Spring Boot + `npm install` + `ng serve` (75 s) | 156 % (**433 %**) | 3 265 MiB (**4 426**) |
| Todo corriendo, justo después (40 s) | 145 % (209 %) | 4 766 MiB (4 911) |
| **Todo corriendo, asentado** (+60 s, 40 s) | 15 % (68 %) | **5 100 MiB** (5 164) |

"Todo" = code-server con el navegador conectado + language server de Java (`redhat.java`) + Spring Boot (`./mvnw spring-boot:run`, :8081) + `ng serve` (:4200). Procesos por RSS en régimen: code-server principal 1,8–2,1 GB (crece tras `npm install`: seguramente los file watchers sobre `node_modules`; no se investigó), language server de Java 1,19 GB, extension host 0,74 GB, `ng serve` 0,45 GB, Maven 0,29 GB, la app Spring 0,14 GB.

Tiempos dentro del contenedor (sesión recién creada, caches vacías de npm): Spring Boot responde en **6,7 s**, `npm install` en **22,6 s**, primer `ng serve` responde en **2,6 s** (tras instalar).

## 3. Volumen de datos por sesión

Base: la sesión de la demo (`demo/output/events.json`, 280 s entre el primer y el último evento, 11 pasos con IA real).

| Dato | Valor | Origen |
|---|---|---|
| Eventos | 26 (4 FILE_CREATED, 4 FILE_CHANGED, 3 FILE_DELETED, 6 COMMAND_EXECUTED, 1 GIT_PUSH, 3 AI_PROMPT, 3 AI_RESPONSE, 1 AI_AUTOCOMPLETE, 1 SESSION_STARTED) | MEDIDO |
| Bytes (JSON de la API de eventos) | 11 341 B; payload ≈ 7,9 KB, de los cuales 7 013 B (89 %) son texto de `AI_PROMPT`+`AI_RESPONSE` | MEDIDO |
| Ventanas de 10 s con eventos | 14 de 28; máx. 4 eventos en una ventana, promedio 1,9 | MEDIDO |
| Costo de tokens de la demo | no registrado por el gateway; texto de prompts+respuestas ≈ 7 000 caracteres ≈ **~1 750 tokens** de contenido visible (chars/4). No incluye el contexto que Continue manda (archivo activo, system prompt), así que el consumo real de entrada es mayor | PROYECTADO |

**Proyección a 500 alumnos × 2 h** (**PROYECTADO**, lineal desde la demo: 26 eventos / 280 s ≈ 5,6 eventos/min):

| | Por alumno | 500 alumnos |
|---|---:|---:|
| Eventos | ~670 | ~334 000 |
| Bytes (JSON de la API) | ~290 KB | ~146 MB |
| Rate medio de ingesta | — | ≤ 46 eventos/s, y **como mucho** 50 req/s |

Una demo guiada de 5 min no es un examen de 2 h: un alumno real genera más eventos (más comandos, más ediciones, más IA). Para dimensionar con margen: ×10 → ~3,3 M eventos y ~1,5 GB, que sigue siendo del orden de lo que se probó en §1 (1,77 M eventos y 200 MB de H2 en una sola corrida, sin errores). El costo en tokens de 500 alumnos **no** se midió ni se prueba contra el gateway (decisión de diseño: costaría dinero real).

## 4. Qué queda validado / qué no

**Validado (con números arriba):**
- La ingesta de telemetría del escenario del spec (500 sesiones, 50 req/s, 5 min) corre sin errores con p99 ≈ 2 ms y ~6 % de un core; hay margen de ~64× (3 200 req/s en 2 cores sin errores).
- El volumen de datos de una sesión es chico y está dominado por el texto de IA.
- El contenedor arranca en ~3 s con el repo clonado y la IDE usable en ~2 s más.
- El stack completo del examen (IDE + Java LS + Spring Boot + Angular) corre en un solo contenedor: ~5,1 GB asentado, pico ~4,4 GB y hasta 4+ cores durante el arranque.
- (De tareas anteriores, no de este reporte) flujo completo de punta a punta, persistencia y `submit`, camino remoto por túnel HTTPS.

**No validado:**
- `docker pull` desde la red de un alumno real (se midió una vez, desde esta máquina, contra GHCR: 19,5 s; no se midió con otras redes ni con GHCR bajo carga de cientos de pulls simultáneos).
- Carga sobre el **proxy git** (500 clones simultáneos al inicio del examen y 500 pushes al final, todos pasando por el backend hacia GitHub, con sus límites de tasa) y sobre el **gateway de IA** (concurrencia de streams SSE y límites de la API de Anthropic).
- Red real: latencia/TLS del camino por internet con cientos de clientes; el túnel de Cloudflare rápido es para pruebas, no para 500 alumnos.
- Dónde se degrada realmente el backend (el generador de carga fue el límite antes), el comportamiento de H2 con base de GB, y crecimiento de memoria del code-server en sesiones de horas (se vio que el proceso principal pasa de 0,2 a ~2 GB tras `npm install`; no se midió a 2 h).
- Más de una sesión de contenedor a la vez en la misma máquina (no es el caso de uso: un alumno por máquina).

## 5. Requisitos mínimos de hardware del alumno (derivados de lo medido)

| Recurso | Mínimo | Por qué |
|---|---|---|
| RAM disponible para Docker | **8 GB** (la máquina, con ≥ 6 GB asignados a la VM de Docker/WSL) | el stack completo asentado usa 5,1 GB y el pico 4,4–5,2 GB; el SO y el navegador se suman |
| CPU | **4 cores** | el arranque del stack llegó a 433 % (4,3 cores) durante ~1 min; después ~15 % |
| Disco libre | **~10 GB** | imagen 3,9 GB + workspace + `node_modules` + `.m2` |
| Descarga inicial | ~1,13 GB (imagen comprimida; 19,5 s medidos en esta máquina) | solo la primera vez |
| Red | salida HTTPS al backend | todo el tráfico va al backend (git, IA, telemetría) |

Estos mínimos son una estimación a partir de una sola máquina de 16 cores/15,5 GB sin límites de recursos; **no** se probó el contenedor con `--memory`/`--cpus` limitados (con un límite de RAM menor que ~5 GB el kernel podría matar procesos). Si se quiere afirmar "corre en 8 GB", falta correrlo con esos límites.

## 6. Reproducir

```
wsl -d Ubuntu -- bash -lc 'cd /mnt/f/repos/tpi-tup/sandbox-poc && ./scripts/load/run-load.sh cpu2 500:120,2000:60,8000:60,16000:60,32000:60 0-1 10 5'
wsl -d Ubuntu -- bash -lc 'cd /mnt/f/repos/tpi-tup/sandbox-poc/scripts/load && ./measure-container.sh image && ./measure-container.sh start'
node scripts/load/open-ide.mjs 420 &     # desde Windows, con demo/node_modules instalado
wsl -d Ubuntu -- bash -lc 'cd /mnt/f/repos/tpi-tup/sandbox-poc/scripts/load && ./measure-ide.sh && ./measure-load.sh && ./measure-settled.sh && ./measure-container.sh stop'
```

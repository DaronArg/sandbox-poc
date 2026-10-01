# HANDOFF TÉCNICO — Plataforma de Evaluación de Desarrollo con Entorno Local Controlado

## 0. Propósito de este documento

Este handoff concentra el contexto técnico de las **dos propuestas arquitectónicas definidas hasta ahora** para la plataforma educativa:

1. **POC / V1 — Web + Docker + code-server, sin Electron/Tauri/Runner**
2. **Evolución / V2 — Electron como capa de experiencia y orquestación, reutilizando el mismo core**

El objetivo es que este archivo pueda llevarse a otros chats, agentes o equipos técnicos y permita comenzar el desarrollo sin reconstruir todo el contexto desde cero.

---

# 1. Problema que estamos resolviendo

La plataforma no busca evaluar únicamente si el alumno llegó a una solución correcta.

El objetivo es evaluar **cómo llegó a esa solución**.

Queremos poder reconstruir el proceso de desarrollo completo de un alumno:

- evolución del código;
- creación/modificación/eliminación de archivos;
- comandos ejecutados;
- builds;
- tests;
- commits;
- uso de Git;
- interacción con IA;
- prompts;
- respuestas;
- contexto enviado al modelo;
- aceptación/modificación/rechazo de sugerencias de IA;
- tiempos;
- secuencia de trabajo;
- entrega final.

La idea central es evaluar:

```text
resultado final
+
proceso de desarrollo
+
uso de IA
```

No queremos depender de ejecutar cientos de proyectos en una VPS central.

La ejecución principal debe ocurrir **en la computadora del alumno**.

---

# 2. Decisiones arquitectónicas ya tomadas

Estas decisiones deben considerarse vigentes salvo que se discutan explícitamente:

- Kubernetes queda fuera.
- No se utilizará una VPS central para ejecutar los proyectos de los alumnos.
- Cada alumno ejecutará su entorno localmente.
- Docker será el mecanismo principal de encapsulación y reproducibilidad.
- `docker-compose` queda descartado para el POC actual.
- La ejecución será mediante una **Docker Image única** y un comando `docker run`.
- El código del alumno vivirá en Git/GitHub.
- La IDE será inicialmente `code-server` o equivalente VS Code Web.
- La UI del POC será navegador + `localhost`.
- Electron NO es requisito del POC.
- Electron queda como evolución futura.
- La telemetría debe funcionar independientemente del navegador.
- La IA se consumirá siempre a través de un **AI Gateway controlado por la plataforma**.
- Las API Keys reales de OpenAI/Anthropic/Google no deben llegar al alumno.
- El backend debe ser liviano y no ejecutar el proyecto del alumno.
- El resultado final puede validarse mediante CI externo.
- La solución debe poder trabajar con múltiples modelos de IA.
- La plataforma debe mantener trazabilidad del proceso.

---

# 3. Arquitectura V1 / POC

## 3.1. Concepto

El alumno entra a la plataforma web, acepta el desafío y recibe un comando `docker run` listo para copiar.

Ejemplo conceptual:

```bash
docker run -p 8080:8080 \
  -e SESSION_TOKEN=... \
  -e EXAM_ID=42 \
  -v workspace:/workspace \
  university/assessment-runtime:v1
```

La Docker Image contiene el entorno completo.

El alumno ejecuta el comando en su máquina.

Docker levanta el contenedor.

El alumno abre:

```text
http://localhost:8080
```

y accede a `code-server`.

---

## 3.2. Flujo de alto nivel

```text
┌───────────────────────┐
│ Plataforma Web        │
│                       │
│ - Login               │
│ - Exámenes            │
│ - Crear sesión        │
│ - Generar docker run  │
└──────────┬────────────┘
           │
           ▼
Alumno copia comando
           │
           ▼
┌───────────────────────┐
│ PC del alumno         │
│                       │
│ Docker Desktop        │
└──────────┬────────────┘
           │
           ▼
┌──────────────────────────────────┐
│ assessment-runtime:v1            │
│                                  │
│ code-server                      │
│ workspace                        │
│ Git                              │
│ telemetry agent                  │
│ AI client                        │
│ bootstrap script                 │
│ runtimes / tools                 │
└───────┬─────────┬─────────┬──────┘
        │         │         │
        │         │         │
        ▼         ▼         ▼
 Backend/API   AI Gateway  GitHub
```

---

# 4. Responsabilidad de la Docker Image

La imagen es el corazón del runtime del alumno.

Debe contener todo lo que sea **estable/reutilizable**.

Ejemplo:

```text
university/assessment-runtime:v1
```

## 4.1. Contenido esperado

```text
Linux base image
code-server
Git
Java
Maven
Gradle
Node.js
npm/pnpm
Angular CLI
herramientas del curso
telemetry agent
AI client / IDE extension
bootstrap script
scripts de test
scripts de session lifecycle
```

La regla es:

```text
Docker Image
= lo fijo / reusable

docker run
= lo variable / contexto de sesión
```

---

# 5. Qué NO debe quedar hardcodeado en la imagen

La imagen no debe contener datos específicos de:

- alumno;
- examen;
- sesión;
- intento;
- credenciales;
- token;
- repositorio puntual;
- puerto puntual;
- secretos;
- configuración por institución.

Ejemplos de valores dinámicos:

```text
SESSION_TOKEN
SESSION_ID
EXAM_ID
STUDENT_ID
REPO_URL
BRANCH
AI_POLICY_ID
COURSE_ID
```

Estos valores se inyectan al arranque.

---

# 6. Comando `docker run`

El backend genera el comando.

Ejemplo:

```bash
docker run \
  --name assessment-session-8f71 \
  -p 8080:8080 \
  -e SESSION_ID=8f71 \
  -e SESSION_TOKEN=eyJ... \
  -e EXAM_ID=42 \
  -e REPO_URL=https://github.com/... \
  -e BRANCH=student-123 \
  -v assessment_8f71_workspace:/workspace \
  university/assessment-runtime:v1
```

## 6.1. Consideraciones

- El token debe ser temporal.
- Debe tener scope de sesión.
- No debe ser reutilizable indefinidamente.
- El contenedor debe poder autenticarse contra el backend.
- El puerto puede ser fijo en POC y dinámico más adelante.
- El volumen debe persistir el workspace.
- La imagen debe poder levantar sola mediante `ENTRYPOINT`.

---

# 7. Bootstrap del contenedor

Al iniciarse, el contenedor ejecuta un script de bootstrap.

Ejemplo conceptual:

```text
ENTRYPOINT
   │
   ▼
bootstrap.sh
   │
   ├── validar SESSION_TOKEN
   ├── registrar session/container
   ├── obtener metadata del examen
   ├── obtener repo / branch
   ├── clonar o preparar workspace
   ├── inicializar telemetría
   ├── configurar AI client
   ├── iniciar code-server
   └── reportar READY al backend
```

Ejemplo de endpoint:

```http
POST /api/sessions/{sessionId}/connect
Authorization: Bearer <SESSION_TOKEN>
```

Respuesta esperada:

```json
{
  "examId": 42,
  "repository": "...",
  "branch": "...",
  "aiPolicy": "...",
  "telemetryEnabled": true
}
```

---

# 8. code-server

`code-server` será la IDE del POC.

## 8.1. Responsabilidades

- Editor de código
- Explorer
- Terminal
- Extensiones controladas
- Git
- integración de IA
- navegación de proyecto

## 8.2. Acceso

El contenedor expone localmente:

```text
localhost:8080
```

La experiencia del alumno será:

```text
docker run ...
↓
abrir localhost:8080
↓
trabajar en code-server
```

El navegador NO debe ser parte del core de la arquitectura.

Debe limitarse a ser el cliente visual.

---

# 9. Regla crítica: nada importante depende del navegador

Esto es fundamental para poder migrar a Electron más adelante.

El navegador únicamente muestra:

```text
code-server
```

Pero estos componentes deben funcionar independientemente:

```text
telemetry
Git
AI
session
workspace
tests
submission
```

Por lo tanto:

```text
Browser
  │
  ▼
code-server
```

es intercambiable.

Hoy:

```text
Chrome
  ↓
localhost
  ↓
code-server
```

Mañana:

```text
Electron
  ↓
localhost
  ↓
code-server
```

El resto del sistema no debe cambiar.

---


# 9.1. El contenedor ES una workstation de desarrollo completa

El contenedor no debe limitarse a mostrar una IDE y capturar telemetría. Debe permitir que el alumno realice dentro del mismo entorno el ciclo normal de desarrollo:

```text
editar
↓
compilar
↓
ejecutar
↓
probar
↓
debuggear
↓
consultar IA
↓
corregir
↓
volver a probar
```

El objetivo es observar el workflow real del alumno, no solamente la edición de archivos.

## Capacidades mínimas del POC

El alumno debe poder ejecutar dentro del entorno:

```text
✓ Java / Spring Boot
✓ Node / Angular
✓ Maven / Gradle
✓ npm / pnpm
✓ compilación backend
✓ compilación frontend
✓ unit tests
✓ integration tests livianos
✓ levantar API
✓ levantar frontend
✓ conectar frontend con backend
✓ Git
✓ terminal
✓ IA
```

Ejemplos:

```bash
./mvnw test
./mvnw spring-boot:run
```

```bash
npm install
npm test
npm start
```

El contenedor debe comportarse como una workstation de desarrollo reproducible.

---

# 9.2. Ejecución de frontend + backend dentro del POC

Para el POC se acepta ejecutar frontend y backend como procesos separados dentro del mismo contenedor.

Ejemplo:

```text
assessment-runtime:v1
│
├── code-server        :8080
├── Angular            :4200
├── Spring Boot API    :8081
├── telemetry agent
├── AI client
└── workspace
```

El frontend puede comunicarse con el backend dentro del mismo entorno.

```text
Angular
localhost:4200
      │
      │ HTTP
      ▼
Spring Boot
localhost:8081
```

Para el POC se pueden publicar puertos explícitamente:

```bash
docker run \
  -p 8080:8080 \
  -p 4200:4200 \
  -p 8081:8081 \
  ...
```

Resultado:

```text
localhost:8080 → code-server
localhost:4200 → frontend
localhost:8081 → API / Swagger
```

Más adelante se podrá cambiar la estrategia de puertos sin modificar el core.

---

# 9.3. Tests como parte de la evaluación de workflow

Los tests son parte central de la telemetría. La plataforma debe poder reconstruir secuencias como:

```text
22:14 COMMAND
      ./mvnw test

22:14 RESULT
      18 passed
      3 failed

22:17 FILE_CHANGED
      UserService.java

22:18 AI_PROMPT

22:20 FILE_CHANGED
      UserService.java

22:21 COMMAND
      ./mvnw test

22:21 RESULT
      21 passed
      0 failed
```

Esto permite medir:

```text
error
→ interpretación
→ uso de IA
→ modificación
→ validación
```

y no solamente el resultado final.

---

# 9.4. Bases de datos y complejidad del POC

Para el primer POC se recomienda evitar infraestructura pesada. Opciones simples:

```text
H2
SQLite
embedded database
```

Objetivo:

```text
Frontend
+
1 backend principal
+
DB liviana
```

También se pueden ejecutar varios procesos backend dentro del mismo contenedor si es necesario:

```text
code-server      :8080
Angular          :4200
Users Service    :8081
Courses Service  :8082
```

Esto es aceptable para el POC.

No se recomienda en esta fase:

```text
Docker-in-Docker
mount de /var/run/docker.sock
contenedores anidados administrados por el alumno
Kafka/Redis/PostgreSQL complejos dentro del primer vertical slice
```

La prioridad es validar el workflow observable.

---

# 9.5. El entorno final con Electron mantiene exactamente estas capacidades

La futura versión con Electron NO cambia la capacidad de desarrollo. Electron reemplaza únicamente la capa de acceso/UX.

POC:

```text
Browser
  ↓
code-server
  ↓
workspace / terminal / Spring / Angular / tests
```

Versión final:

```text
Electron
  ↓
code-server
  ↓
workspace / terminal / Spring / Angular / tests
```

Por lo tanto, en la versión final el alumno seguirá pudiendo:

```text
compilar backend
compilar frontend
levantar API
levantar frontend
ejecutar tests
hacer debugging
usar Git
usar IA
```

La diferencia es que Electron podrá:

```text
detectar Docker
hacer docker pull
hacer docker run
abrir la IDE automáticamente
mostrar estado de sesión
gestionar start/stop
integrar mejor la UX
```

La workstation sigue estando en Docker.

---

# 10. Git / GitHub

GitHub funciona como source of truth del código.

## 10.1. Git vive dentro del contenedor

No se requiere Git instalado en el host.

Dentro de la imagen:

```text
Git
```

El bootstrap puede hacer:

```text
git clone
git checkout <branch>
```

Durante la sesión:

```text
git status
git commit
git push
```

El modelo exacto queda por definir:

```text
repo por alumno
branch por alumno
repo por examen
repo por intento
GitHub Classroom
```

---

# 11. Persistencia del workspace

No se debe perder el trabajo si el contenedor se detiene.

Usar Docker Volume:

```bash
-v assessment_<sessionId>_workspace:/workspace
```

Ejemplo:

```text
Container
   │
   ▼
/workspace
   │
   ▼
Docker Volume
```

Permite:

```text
stop
start
```

sin perder el proyecto.

GitHub actúa como segunda capa de persistencia.

---

# 12. Telemetría

El objetivo es reconstruir el proceso de desarrollo.

## 12.1. Eventos principales

```text
SESSION_STARTED
SESSION_READY
SESSION_ENDED

FILE_CREATED
FILE_CHANGED
FILE_RENAMED
FILE_DELETED

COMMAND_EXECUTED
COMMAND_FINISHED

BUILD_STARTED
BUILD_FINISHED

TEST_STARTED
TEST_RESULT

GIT_COMMIT
GIT_BRANCH
GIT_PUSH

AI_PROMPT
AI_RESPONSE
AI_PATCH_ACCEPTED
AI_PATCH_MODIFIED
AI_PATCH_REJECTED

SUBMISSION_STARTED
SUBMISSION_COMPLETED
```

---

# 13. Qué NO registrar

No queremos un keylogger.

No enviar:

```text
a
b
c
Backspace
Enter
```

No capturar actividad personal ajena al examen.

La telemetría debe limitarse al workspace y herramientas oficiales del examen.

---

# 14. File telemetry

Se recomienda:

```text
initial snapshot
+
diffs
+
checkpoints
```

No guardar el archivo completo en cada cambio.

Ejemplo:

```text
10:00 snapshot
10:01 patch
10:03 patch
10:07 patch
10:10 checkpoint
```

Esto permite reconstruir cualquier estado.

---

# 15. Terminal telemetry

Debe capturarse a nivel PTY.

Registrar:

```json
{
  "type": "COMMAND_EXECUTED",
  "command": "mvn test",
  "timestamp": "...",
  "durationMs": 12000,
  "exitCode": 1
}
```

Los outputs grandes pueden:

- resumirse;
- comprimirse;
- almacenarse en object storage.

---

# 16. Telemetry Agent

Debe correr dentro del contenedor.

Responsabilidades:

```text
filesystem watcher
PTY logger
Git hooks / git watcher
build/test watcher
AI event bridge
session heartbeat
offline buffer
batch sender
```

El agente envía eventos al backend.

Ejemplo:

```http
POST /api/telemetry/batch
```

Payload:

```json
{
  "sessionId": "8f71",
  "events": [
    {
      "sequence": 1021,
      "type": "FILE_CHANGED",
      "timestamp": "...",
      "payload": {}
    }
  ]
}
```

---

# 17. Batching

No enviar cada evento individualmente.

Objetivo:

```text
batch cada 5-15 segundos
```

Ejemplo:

```text
37 cambios
2 saves
1 command
↓
1 TELEMETRY_BATCH
```

Esto reduce:

- requests;
- CPU;
- red;
- almacenamiento;
- overhead.

---

# 18. Offline-first

El contenedor debe soportar pérdida temporal de Internet.

Implementar local outbox.

Ejemplo:

```text
event 1001 → PENDING
event 1002 → PENDING
event 1003 → PENDING
```

Cuando vuelve la conexión:

```text
SYNC
```

Cada evento debe tener:

```text
sequenceNumber
```

para poder detectar faltantes.

---

# 19. Integridad de eventos

Se puede implementar una cadena hash:

```text
event 100
   ↓ hash
event 101
   ↓ hash
event 102
```

Campos posibles:

```text
sequence
timestamp
eventType
payloadHash
previousHash
currentHash
```

Esto NO hace el sistema inviolable.

Sirve para detectar manipulación o gaps.

---

# 20. AI Gateway

El alumno nunca se conecta directamente a OpenAI/Anthropic/Gemini.

Flujo:

```text
code-server / AI extension
          │
          ▼
      AI Gateway
          │
      ┌───┼─────────────┐
      ▼   ▼             ▼
    GPT  Claude        Gemini
```

---

# 21. Responsabilidades del AI Gateway

## 21.1. Authentication

Asociar cada request a:

```text
studentId
courseId
examId
sessionId
repository
```

## 21.2. Routing

Ejemplo:

```text
pregunta simple
→ modelo económico

debugging complejo
→ modelo avanzado
```

## 21.3. Guardrails

Ejemplo:

```text
modo tutor
modo debugging
modo refactor
modo tests
```

## 21.4. Context Builder

Seleccionar:

```text
archivo actual
selección
símbolos relacionados
tests
errores recientes
historial de conversación
```

Evitar enviar todo el repo.

## 21.5. Logging

Registrar:

```text
prompt
context
model
response
tokens
latency
cost
tool calls
```

---

# 22. AI Client

El cliente de IA vive dentro del entorno del alumno.

Puede ser:

- extensión de code-server;
- panel web integrado;
- extensión propia;
- servicio local conectado a la IDE.

Nunca debe contener API Keys de proveedor.

Solo debe conocer:

```text
AI_GATEWAY_URL
SESSION_TOKEN
```

---

# 23. AI provenance

Objetivo futuro:

Poder identificar qué código vino de una sugerencia de IA.

Ejemplo:

```text
AI genera 40 líneas
↓
Alumno acepta 28
↓
Alumno modifica 12
```

Registrar:

```text
AI_PATCH_ACCEPTED
AI_PATCH_MODIFIED
AI_PATCH_REJECTED
```

Esto es preferible a un detector estadístico de "código generado por IA".

---

# 24. Backend

El backend NO ejecuta proyectos.

Responsabilidades:

```text
Session API
Exam API
Telemetry API
AI Gateway
Audit/Event Store
Timeline Builder
Submission Service
Professor Dashboard
Evaluation Service
```

---

# 25. Session API

Responsabilidades:

```text
crear sesión
emitir token temporal
validar sesión
registrar conexión del container
heartbeat
cerrar sesión
revocar token
```

Estados sugeridos:

```text
CREATED
WAITING_FOR_CONTAINER
STARTING
READY
ACTIVE
SUBMITTING
COMPLETED
CANCELLED
EXPIRED
```

---

# 26. Event Store / Audit Store

Guardar telemetría.

Separar metadata de artifacts pesados.

## PostgreSQL

```text
student
exam
session
submission
repository
status
metrics
summary
```

## Object Storage

```text
telemetry batches
snapshots
terminal output
AI transcripts
artifacts
large logs
```

---

# 27. Timeline Builder

A partir de eventos:

```text
09:00 SESSION_STARTED
09:04 FILE_CREATED
09:08 COMMAND_EXECUTED
09:10 TEST_FAILED
09:12 AI_PROMPT
09:13 AI_RESPONSE
09:15 FILE_CHANGED
09:18 TEST_SUCCESS
09:25 GIT_COMMIT
```

Construir una timeline utilizable por el profesor.

---

# 28. Submission

Al finalizar:

```text
Alumno
↓
Submit
```

Debe ocurrir:

```text
sync telemetry
git commit/push final
freeze final SHA
mark session completed
trigger evaluation
```

El commit SHA final debe quedar asociado a la sesión.

---

# 29. CI / evaluación final

La ejecución diaria ocurre localmente.

La validación final debe poder ejecutarse en infraestructura confiable externa.

Ejemplo:

```text
GitHub Actions
```

Pipeline:

```text
clone final SHA
↓
backend build
↓
frontend build
↓
unit tests
↓
integration tests
↓
hidden tests
↓
evaluation result
```

Separación:

```text
local
= evaluar proceso

CI
= validar resultado final
```

---

# 30. Seguridad — modelo realista

No existe 100% anti-cheat cuando el alumno controla el hardware.

Puede usar:

```text
otro navegador
otro IDE
otro equipo
teléfono
IA externa
```

El objetivo es:

```text
controlar entorno oficial
+
registrar proceso oficial
+
proteger credenciales
+
generar evidencia
+
detectar anomalías
```

No convertir señales en acusaciones automáticas.

---

# 31. Docker security

Para el POC:

```text
no privileged
no host network
no docker.sock
mínimos mounts
solo workspace persistente
```

Evitar:

```text
-v /:/host
--privileged
-v /var/run/docker.sock:/var/run/docker.sock
```

Las conexiones principales deben ser salientes:

```text
Container
  ├── Backend
  ├── AI Gateway
  └── GitHub
```

---

# 32. Puertos

POC simple:

```text
-p 8080:8080
```

Más adelante:

```text
-p 127.0.0.1:<random>:8080
```

para evitar exponer la IDE hacia otras interfaces.

---

# 33. Docker Registry

La imagen deberá almacenarse en un registry.

Posibles opciones:

```text
GitHub Container Registry
Docker Hub
AWS ECR
Azure Container Registry
GCP Artifact Registry
```

Para comenzar:

```text
GHCR
```

es una opción natural si el código vive en GitHub.

---

# 34. Versionado

Separar tres cosas:

```text
Assessment Platform
v1.x

Runtime Image
assessment-runtime:vN

Exam
exam-42:vN
```

No acoplar versión de examen con versión del runtime.

---

# 35. Flujo POC completo

```text
1. Alumno entra a web

2. Login

3. Acepta desafío

4. Backend crea sesión

5. Backend genera:
   SESSION_ID
   SESSION_TOKEN
   EXAM_ID
   REPO_URL
   docker run

6. Web muestra comando

7. Alumno copia comando

8. Docker descarga image

9. Docker crea container

10. Bootstrap valida sesión

11. Bootstrap obtiene configuración

12. Clona repo

13. Levanta telemetry agent

14. Levanta AI client

15. Levanta code-server

16. Alumno abre localhost

17. Programa

18. Telemetría se envía

19. IA pasa por AI Gateway

20. Git push a GitHub

21. Submit

22. Backend fija SHA final

23. CI evalúa

24. Profesor ve timeline + resultado
```

---

# 36. Arquitectura POC mínima

```text
                         INTERNET

                  ┌───────────────────┐
                  │ Platform Backend  │
                  │                   │
                  │ Session API       │
                  │ Telemetry API     │
                  │ AI Gateway        │
                  │ Timeline          │
                  └───────▲───────────┘
                          │
                          │ HTTPS
                          │
══════════════════════════╪════════════════════════════

                     STUDENT PC

                  Docker Desktop
                       │
                       ▼
           assessment-runtime:v1
           ┌─────────────────────┐
           │ code-server         │
           │ workspace           │
           │ Git                 │
           │ telemetry agent     │
           │ AI client           │
           │ tools/runtimes      │
           └──────┬──────────────┘
                  │
                  ▼
             localhost:8080
                  │
                  ▼
               Browser

           Container ──────────► GitHub
```

---

# 37. POC técnico recomendado

Construir primero un vertical slice.

## POC-1

```text
Docker Image
+
code-server
+
Java/Node
```

Validar:

```text
docker run
↓
localhost
↓
IDE usable
```

## POC-2

Agregar:

```text
bootstrap
+
Session API
```

## POC-3

Agregar:

```text
GitHub clone/push
```

## POC-4

Agregar:

```text
Telemetry Agent
```

mínimo:

```text
FILE_CHANGED
COMMAND_EXECUTED
```

## POC-5

Agregar:

```text
AI Client
↓
AI Gateway
↓
1 modelo
```

## POC-6

Agregar:

```text
Submit
↓
final SHA
↓
GitHub Actions
```

---

# 38. Arquitectura futura V2 — Electron

Electron NO reemplaza el core.

Electron agrega una capa de UX/orquestación.

Hoy:

```text
Alumno
↓
terminal
↓
docker run
↓
Browser
↓
code-server
```

Futuro:

```text
Alumno
↓
Electron
↓
Electron ejecuta docker run
↓
Docker
↓
code-server
↓
Electron muestra IDE
```

---

# 39. Qué cambia con Electron

Electron puede agregar:

```text
system check
Docker detection
docker pull
docker run
start/stop session
auto-open IDE
embed code-server
status UI
updates
focus/minimize events
better UX
```

Pero NO deberían migrarse a Electron:

```text
telemetry core
Git logic
AI Gateway
session backend
workspace
tests
runtime
```

Esos componentes deben seguir dentro de Docker/backend.

---

# 40. Arquitectura V2

```text
                         INTERNET

                 Backend / AI / GitHub
                          ▲
                          │
══════════════════════════╪════════════════════════════

                     STUDENT PC

                    Electron App
                         │
                         │ orchestrates
                         ▼
                    Docker Engine
                         │
                         ▼
               assessment-runtime:v1
               ┌───────────────────┐
               │ code-server       │
               │ workspace         │
               │ Git               │
               │ telemetry         │
               │ AI client         │
               └─────────┬─────────┘
                         │
                         ▼
                 localhost/random
                         │
                         ▼
               Electron WebContents
```

---


## 40.1. Runtime de desarrollo en V2

La arquitectura con Electron conserva el mismo runtime Docker validado en el POC.

Electron no reemplaza:

```text
Java
Node
Angular
Spring Boot
Maven / Gradle
npm
tests
Git
telemetry
AI client
workspace
```

Solo reemplaza:

```text
copiar docker run
+
abrir localhost en navegador
```

por:

```text
botón "Iniciar examen"
+
orquestación automática
+
IDE embebida
```

La meta es que el runtime de desarrollo construido para el POC sea reutilizable sin reescritura.

---

# 41. Por qué esta migración es simple

Porque la interfaz visual está desacoplada.

POC:

```text
Chrome
↓
localhost
↓
code-server
```

V2:

```text
Electron
↓
localhost
↓
code-server
```

Todo lo siguiente permanece igual:

```text
Docker Image
code-server
workspace
Git
telemetry
AI client
Backend
AI Gateway
GitHub
CI
```

La inversión en el POC no se pierde.

---

# 42. Qué NO hacer en V1

Evitar construir desde el principio:

- Electron
- Tauri
- custom launcher
- runner local
- Kubernetes
- VPS execution
- complex event streaming
- Kafka
- multi-model routing avanzado
- behavioral scoring
- anti-cheat invasivo
- full analytics platform
- automatic plagiarism accusation
- custom IDE desde cero

Primero validar el vertical slice.

---

# 43. Escalabilidad

Como los proyectos corren localmente, la infraestructura central escala por:

```text
sessions
telemetry
AI requests
AI tokens
GitHub
CI submissions
storage
```

No por:

```text
Java processes
Angular builds
DBs
Docker containers of students
```

---

# 44. Capacity model

Variables importantes:

```text
Concurrent Sessions
Telemetry Batches / sec
Telemetry MB / day
AI Requests / min
AI Tokens / min
CI Jobs
Stored Artifacts
```

Ejemplo:

```text
500 alumnos
1 batch / 10 segundos

≈ 50 requests/sec
```

Carga razonable.

---

# 45. Telemetry optimization

Usar:

```text
batching
compression
diffs
checkpoints
deduplication
object storage
```

Evitar snapshots completos constantes.

---

# 46. AI cost control

Implementar:

```text
rate limit / student
rate limit / session
token budget / exam
context limit
model routing
cost tracking
```

El contexto del repo debe ser selectivo.

No enviar todo el repo en cada prompt.

---

# 47. CI backpressure

Al terminar un examen pueden llegar cientos de submits.

Diseñar:

```text
Submission
↓
Queue
↓
limited workers / managed CI
```

No ejecutar todo simultáneamente.

---

# 48. Observabilidad

Métricas mínimas:

```text
active sessions
connected containers
telemetry batches/sec
telemetry failures
queue depth
AI requests/min
AI tokens/min
AI cost
CI queue
CI duration
session failures
offline clients
```

---

# 49. Preguntas abiertas

Aún deben definirse:

## Runtime base

```text
Ubuntu / Debian / distroless?
```

## IDE

```text
code-server
openvscode-server
```

## Git strategy

```text
repo por alumno
branch por alumno
repo por intento
```

## Telemetry implementation

```text
Node
Go
Rust
Java
```

## AI extension

```text
propia
adaptar una existente
panel web
```

## Backend stack

Pendiente.

## Auth

```text
JWT
OAuth
SSO
GitHub App
```

## Registry

Pendiente.

## CI

Pendiente.

---

# 50. Recomendación de desarrollo inicial

Orden sugerido:

```text
1. assessment-runtime Dockerfile

2. code-server funcionando

3. workspace persistente

4. bootstrap

5. Session API

6. GitHub integration

7. Telemetry Agent

8. AI Client

9. AI Gateway

10. Submit

11. GitHub Actions

12. Professor Timeline
```

---

# 51. Definition of Done del POC

El POC se considera validado si un alumno puede:

```text
1. Entrar a la web
2. Aceptar un desafío
3. Copiar docker run
4. Ejecutarlo
5. Abrir localhost
6. Programar en code-server
7. Ejecutar terminal/tests
8. Usar IA
9. Hacer commit/push
10. Entregar
```

Y el sistema puede:

```text
1. identificar la sesión
2. registrar eventos
3. registrar IA
4. guardar timeline
5. asociar código final
6. ejecutar evaluación final
7. mostrar resultado al profesor
```

---

# 52. Resumen de las dos propuestas

## Propuesta A — POC actual

```text
Web
↓
docker run
↓
Docker Image
↓
code-server
↓
Browser
```

Ventajas:

```text
simple
rápida
sin app nativa
ideal para validar arquitectura
```

---

## Propuesta B — Evolución futura

```text
Electron
↓
orquesta Docker
↓
Docker Image
↓
code-server
↓
Electron UI
```

Ventajas:

```text
mejor UX
automatización
system check
un solo botón
más control visual
```

La arquitectura core es la misma.

---

# 53. Principio arquitectónico central

El principio que debe guiar el desarrollo es:

> **Docker contiene el entorno. Backend contiene el control y la trazabilidad. GitHub contiene el código. AI Gateway contiene el acceso a IA. Browser/Electron solamente contienen la experiencia visual.**

Esto permite construir primero la versión simple y luego escalar la experiencia sin reescribir el producto.

---

# 54. Arquitectura conceptual final

```text
                        PLATFORM

        ┌──────────────┬──────────────┐
        │ Backend      │ AI Gateway   │
        └──────▲───────┴──────▲───────┘
               │              │
               │              │
═══════════════╪══════════════╪══════════════════

                    STUDENT PC

                Docker Engine
                     │
                     ▼
           assessment-runtime:v1
           ┌──────────────────────┐
           │ code-server          │
           │ workspace            │
           │ Git                  │
           │ telemetry            │
           │ AI client            │
           │ tools                │
           └───────┬──────────────┘
                   │
                   ▼
              localhost

          POC: Browser
          V2 : Electron

                   │
                   ▼
                GitHub
                   │
                   ▼
                   CI
```

---

# 55. Siguiente acción

No diseñar más capas todavía.

Comenzar con:

```text
Dockerfile
+
code-server
+
workspace
+
bootstrap
```

Objetivo del primer spike:

```bash
docker run -p 8080:8080 university/assessment-runtime:poc
```

Resultado esperado:

```text
http://localhost:8080
```

Debe abrir una IDE funcional con:

```text
Java
Node
Git
terminal
workspace persistente
```

Una vez validado eso, conectar progresivamente Session API, GitHub, Telemetry y AI Gateway.

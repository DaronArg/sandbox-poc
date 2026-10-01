# Demo grabada de punta a punta

`record-demo.mjs` graba UN video continuo (Playwright `recordVideo`, 1920x1080) del recorrido completo. No hay nada simulado: el `docker run` se ejecuta de verdad, Continue responde via el gateway del backend, el push llega a GitHub.

## Requisitos

- Backend de la plataforma corriendo en :9090 (ver `README.md` de la raiz) y WSL vivo. Conviene arrancarlo recien reiniciado para que el panel del profesor muestre solo la sesion de la demo.
- Imagen `assessment-runtime:poc` construida (`scripts/build-runtime.sh`).
- `gh` autenticado con acceso a `DaronArg/assessment-exam-template` (el script borra los branches `session-*` de ese repo antes de grabar; si no, el push da non-fast-forward). Otro repo: variable `EXAM_REPO`.
- Node 22 en Windows.

## Regrabar

```
cd demo
npm install
npx playwright install chromium
node record-demo.mjs
```

Dura unos 6 minutos. Salida en `demo/output/` (ignorada por git):

- `demo.webm`: el video.
- `steps.json`: segundo de inicio de cada uno de los 11 pasos.
- `shots/`: screenshot al final de cada paso.
- `events.json`: timeline de la sesion segun la API; `docker-run-stdout.txt`: stdout real del contenedor.

Para mp4 (ffmpeg, p. ej. dentro de WSL: `sudo apt install ffmpeg`):

```
ffmpeg -i output/demo.webm -c:v libx264 -crf 23 -pix_fmt yuv420p -movflags +faststart output/demo.mp4
```

`KEEP_CONTAINER=1` deja el contenedor de la sesion corriendo al terminar (por defecto se borra).

## Recorrido (11 pasos)

1. Pagina de inicio `:9090`: alumno + examen, "Iniciar", se ve el `docker run`.
2. El `docker run` se ejecuta en WSL; se muestra el comando y su stdout real en una pagina local con estetica de terminal.
3. IDE `:8080`: explorer con el repo clonado, branch `session-<id>`.
4. Se abre `PriceService.java` y se escribe un comentario a mano.
5. Terminal de la IDE: `./mvnw test` -> fallan.
6. Continue (chat): pregunta sobre el codigo (Ctrl+Enter = con el archivo activo como contexto).
7. Continue: pide implementar `applyDiscount`, boton Apply del bloque de codigo, Accept del diff.
8. `./mvnw test` -> pasan.
9. `./mvnw spring-boot:run` (:8081) y `npm install && npm run dev` (:4200) en terminales de la IDE; se abre `:4200` y el front muestra el precio final.
10. `git status`, `git add`, `git commit`, `git push` desde la terminal de la IDE.
11. `professor.html`: timeline de la sesion (archivos, comandos, prompts/respuestas de IA, push).

## Notas de implementacion

- Un solo video: Playwright graba un archivo por pagina, por eso todo el recorrido usa una unica `page` y navega con `goto`. El cartel de paso y el cursor se inyectan con `addInitScript` (el texto viaja en `window.name`, que sobrevive a las navegaciones entre origenes).
- Continue vive en un webview (iframes anidados): se entra con `frameLocator('iframe.webview')` -> `iframe#active-frame`. Hay que cerrar la tarjeta "API Key" antes de escribir; se envia con Ctrl+Enter o con el boton de envio.
- La sincronizacion con comandos de la terminal de la IDE se hace leyendo `/tmp/telemetry/commands.log` del contenedor (lo escribe el hook de bash), no mirando el canvas de xterm.
- Si la IA devuelve un bloque parcial y Apply no produce el diff, repetir la grabacion (la respuesta del modelo no es determinista).

# Demo grabada de punta a punta (sobre la app Electron)

`record-demo.js` graba UN video del recorrido completo en la app de escritorio real. No hay nada simulado: el contenedor se levanta de verdad, Continue responde via el gateway del backend con la API key real, la IA edita el archivo, el push llega a GitHub y el CI corre en GitHub Actions.

## Requisitos

- Backend de la plataforma corriendo en :9090 (ver `README.md` de la raiz) y WSL (`Ubuntu`) con Docker. Conviene arrancar el backend recien reiniciado para que el panel del profesor muestre pocas sesiones.
- Imagen `assessment-runtime:poc` construida (`scripts/build-runtime.sh`).
- `.env` en la raiz con las credenciales reales (el script lo lee, nunca lo imprime). `GITHUB_TOKEN` se usa para borrar los branches `session-*` del repo de examen al terminar.
- Node 22 en Windows, `desktop/node_modules` instalado (Electron y `@playwright/test` se reusan de ahi) y Edge.
- ffmpeg en Windows (`winget install Gyan.FFmpeg`; el script lo busca solo, o variable `FFMPEG`) y `npm install` dentro de `demo/` (sharp, para componer los frames).
- La app compilada (`cd desktop && npm run build`).

## Grabar

```
cd demo
npm install
node record-demo.js            # los 13 pasos desde cero (~6 min de video, ~10 min de corrida)
```

La corrida usa la app real en modo desarrollo (`electron . --remote-debugging-port=9333 --inspect=9229`, ambos puertos solo para esto) y ejecuta pasos por condicion (eventos de la API, `docker exec`, HTTP), no por esperas fijas. Al terminar cierra la app, borra los contenedores y los branches `session-*`.

### Retomar sin reiniciar todo

Cada paso graba su propio segmento (`output/seg/stepNN.mp4`). Si un paso falla, la app y el contenedor quedan vivos y el script dice como seguir:

```
node record-demo.js --from 7        # retoma en el paso 7 (usa output/state.json)
node record-demo.js --only 9        # regraba solo el paso 9
node record-demo.js --from 4 --to 6
node record-demo.js --assemble      # solo une los segmentos
```

Un paso fallido guarda `output/fail-N.jpg` (frame de la ventana). Los pasos 4 a 9 son idempotentes (resetean el archivo, paran los servidores, vuelven a la pestana IDE).

### Salida (`demo/output/`, ignorada por git)

- `demo.mp4`: el video unido, 1600x900.
- `steps.json`: `{durationSec, marks:[{step,label,startSec}]}` para `narrate.py`.
- `seg/`: un segmento por paso (`stepNN.mp4` + `stepNN.json` con duracion y tramos acelerados).
- `frames/`: tres frames por paso (15 %, 50 %, 90 %) para revisarlos.

## Privacidad: que se captura

Nunca se graba el escritorio. Se probo en este orden:

1. `ffmpeg -f gdigrab -i title=Assessment`: sale NEGRO (el contenido de Electron lo dibuja la GPU y GDI no lo ve). Descartado.
2. **Lo que se usa:** el script se conecta al inspector del proceso main y llama `capturePage()` de la ventana (el shell: barra y pantallas de progreso/entrega) y de cada `WebContentsView` visible (IDE / App); los compone con `sharp` en un frame y se lo pasa a ffmpeg por stdin. Solo existe el contenido de esa ventana.

El panel del profesor y el "navegador externo bloqueado" se graban con Playwright `recordVideo` sobre Edge: solo el contenido de la pagina, con un cartel con la URL (la ventana del navegador no se captura). No hay cursor del mouse en el video (CDP no lo dibuja).

## Recorrido (13 pasos)

| # | Paso |
|---|------|
| 1 | Inicio: elegir alumno y examen, "Iniciar" |
| 2 | Progreso: WSL, Docker, imagen, contenedor, acceso, IDE (esperas aceleradas) |
| 3 | IDE con el repo clonado en `session-<id>-<hex>` |
| 4 | Edicion a mano: se abre `PriceService.java` por el Explorer y se escribe un comentario |
| 5 | `./mvnw test` falla |
| 6 | Continue: se pregunta que hace el codigo y por que fallan los tests |
| 7 | Continue: "implementa applyDiscount"; la IA edita el archivo, se aceptan los hunks (CodeLens) y se guarda |
| 8 | `./mvnw test` pasa |
| 9 | `./mvnw spring-boot:run` (:8081) y `npm install && npm start` (Angular); pestana App con la calculadora |
| 10 | Navegador externo (Edge) a `ide.localhost:<P>`, `localhost:<P>` y `localhost:8081`: "Acceso denegado" / "Solo Postman/curl" |
| 11 | `git status`, `git add`, `git commit`, `git push` desde la terminal de la IDE |
| 12 | Boton "Entregar": pantalla "Entrega registrada" con el SHA final |
| 13 | Panel del profesor (`professor.html`): estado, SHA final, CI, bloqueos y la timeline con los eventos `DESKTOP_*` |

Las esperas largas (pull, `mvn`, `npm`, push, respuesta de la IA) se aceleran en el video (`rec.fast()`, 3x a 8x); se esperan por condicion, no por tiempo.

## Gotchas de la automatizacion

- La ventana tiene que estar restaurada y con tamano fijo (`ensureWindow`): si queda minimizada el contenido mide 0 y la vista App se crea 0x0 (frames negros).
- Continue vive en un webview que no es target CDP: se maneja por coordenadas (el layout se calcula desde el ancho real de la barra lateral) y se envia con Ctrl+Enter (adjunta el archivo activo, sin pedir herramientas). Los clicks en el input, en "nuevo chat" y en el sash son por coordenadas.
- El boton Apply de un bloque de codigo parcial llama a un modelo con *prefill* que la API de Anthropic rechaza ("final assistant content cannot end with trailing whitespace"). Por eso el paso 7 pide que edite el archivo directamente y se aceptan los hunks con los CodeLens `Accept` (DOM del editor).
- Ctrl+Enter con el foco en el editor inserta una linea: nunca mandar teclas "a ciegas".
- El icono del Explorer alterna la barra lateral; se usa Ctrl+Shift+E (no alterna).
- Enter dentro de un comentario `//` en Java continua el comentario: el comentario del paso 4 va en una linea propia y sin Enter final.
- `Quick Open` + Enter no abre el archivo de forma fiable; se navega el arbol con clicks reales.
- La respuesta del modelo no es determinista: si el paso 6 o 7 sale distinto, regrabar con `--only`.

## Narracion

`narration.json` (voz es-AR, sobria) y `narration-paisa.json` (voz es-CO, expresiones colombianas) tienen un texto por paso. `narrate.py` arranca cada texto en el segundo de su paso (`output/steps.json`), acelera el audio lo justo si no entra en su hueco y mezcla todo sobre `output/demo.mp4`. Dentro de WSL (ffmpeg y edge-tts en `/opt/tts`):

```
wsl -d Ubuntu -- bash -lc 'cd /mnt/f/repos/tpi-tup/sandbox-poc && /opt/tts/bin/python demo/narrate.py narration.json demo-narrado.mp4 && /opt/tts/bin/python demo/narrate.py narration-paisa.json demo-paisa.mp4'
```

Salida: `output/demo-narrado.mp4` y `output/demo-paisa.mp4`. Los videos no se commitean.

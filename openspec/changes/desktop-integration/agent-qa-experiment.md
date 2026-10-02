# K2 — Experimento: QA con agente en vez de script

**Resultado: LOGRADO.** Dentro de la app Electron (modo desarrollo, `--remote-debugging-port=9333`), la IA del panel Continue implemento `applyDiscount` de `PriceService.java` y el cambio se aplico al archivo con Accept.

## Metricas
- Tiempo: ~3 minutos de reloj desde el build hasta tener el archivo verificado (14:00:37 -> 14:03:18; limite era 25).
- Acciones: ~20 llamadas de herramienta en total.
  - Build + lanzar la app + listar targets: 3
  - Interaccion con la IDE por CDP (abrir Continue, Ctrl+P + nombre + Enter, click en input, tipear prompt, click en enviar x2, Accept x2, click en editor, Ctrl+S): 12
  - Capturas mirando el estado antes de actuar: 4
  - Verificacion (docker exec cat, GET eventos): 2
- Un unico error de mi parte: el primer click en "enviar" cayo en el vacio porque el textarea crece al tipear y el boton baja; lo corregi mirando la captura siguiente (eso es exactamente lo que un script ciego no hace).

## Que funciono y que no
| Herramienta | Resultado |
|---|---|
| `desktop/e2e/cdp-lib.js` (`findTarget`/`attach`) en wrappers de una linea con `node` (eval, screenshot, click por coordenadas, `Input.insertText`, teclas) | Funciono. Alcanzo para todo. |
| Click por coordenadas sobre la pagina de la IDE | Funciono a traves de los iframes anidados de Continue: `Input.dispatchMouseEvent` entra al webview aunque no sea un target propio. |
| `Page.captureScreenshot` del target de la IDE (leida con Read) | Funciono y es la "vista" del agente. Solo captura la vista de la IDE, nunca el escritorio. |
| Playwright MCP (`browser_run_code_unsafe`) | No lo use: solo da `page` de su propio navegador y no hay forma de adjuntarlo por CDP a Electron; el cdp-lib hacia lo mismo con menos friccion. |
| DOM/eval dentro del webview de Continue | No funciona: el webview no aparece como target en `/json`, solo la pagina contenedora. Todo va por coordenadas. |

## Verificacion
- `docker exec assessment-55-6d31d6 ... cat PriceService.java`: el metodo tiene validacion de porcentaje 0-100, precio negativo/NaN con `IllegalArgumentException` y `price * (100 - percent) / 100.0`. Coincide con el javadoc.
- `GET /api/sessions/55/events`: 6 `AI_PROMPT` + 6 `AI_RESPONSE` (el primero con mi mensaje; los demas con `message` vacio son los autocompletados/titulos internos de Continue), la ultima respuesta trae el bloque ```java con la ruta del archivo; 3 `FILE_CHANGED`.
- Notable: Continue no necesito el truco de "devolveme el archivo completo": uso su herramienta de edicion y mostro un diff con Accept/Reject (CodeLens) en el editor. Hay que aceptar cada hunk (2 clicks) y luego guardar con Ctrl+S; Accept deja el buffer modificado ("M") sin guardar.
- No hizo falta tocar la tarjeta "API Key": la gateway de la sesion ya provee el modelo; el boton de enviar anduvo con la tarjeta visible.

## Limpieza
App cerrada (electron terminado, CDP ya no responde) y contenedor `assessment-55-6d31d6` borrado (`docker ps -a` vacio).

## Opinion honesta: agente vs script
- **Descubrimiento y primera pasada: agente, claramente.** Ir mirando la pantalla antes de cada accion resolvio en minutos lo que en un script cuesta horas de ensayo y error (coordenadas, timing, el boton que se mueve). Encontre el flujo real (Accept por CodeLens, guardar aparte) sin adivinar.
- **Regresion repetible: script.** Lo que hice es caro de repetir: cada corrida gasta tokens, depende de mi lectura de capturas y las coordenadas son fragiles (cambian con la resolucion y el layout del panel). Para el DoD que corre en cada cambio, `i4-check.js` sigue siendo la herramienta correcta: determinista, barato, sin criterio humano.
- **Recomendacion:** usar el agente para explorar flujos nuevos o diagnosticar una falla, y *destilar* lo aprendido (coordenadas relativas, selectores, esperas) en el script. Agente para aprender, script para vigilar.
- Limite de este experimento: una sola corrida; el resultado del modelo no es determinista (Apply a veces falla), asi que esto prueba que se puede, no que siempre salga.

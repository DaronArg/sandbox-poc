import { app, BrowserWindow, dialog, MessageBoxOptions } from 'electron';
import * as fs from 'fs';

/**
 * Pregunta con un cuadro nativo y devuelve el indice del boton. Solo con la app SIN empaquetar y
 * ASSESSMENT_TEST_DIALOG_LOG definido (pruebas): registra el cuadro en ese archivo y responde
 * ASSESSMENT_TEST_DIALOG_ANSWER (default 0) sin mostrar nada.
 */
export async function ask(win: BrowserWindow, options: MessageBoxOptions): Promise<number> {
  const log = !app.isPackaged ? process.env.ASSESSMENT_TEST_DIALOG_LOG : undefined;
  if (log) {
    fs.appendFileSync(log, JSON.stringify({ message: options.message, detail: options.detail, buttons: options.buttons }) + '\n');
    return Number(process.env.ASSESSMENT_TEST_DIALOG_ANSWER ?? 0);
  }
  return (await dialog.showMessageBox(win, options)).response;
}

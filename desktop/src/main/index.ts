import { app, BrowserWindow } from 'electron';
import * as path from 'path';
import { loadConfig } from './config';
import { Controller } from './controller';
import { registerIpc } from './ipc';
import { handleShellProtocol, registerShellScheme, SHELL_URL } from './shell-protocol';
import { installSecurity, setupSingleInstance } from './security';
import { Views } from './views';

let win: BrowserWindow | null = null;
let controller: Controller | null = null;

// Empaquetada, la app no admite depuracion remota (CDP) ni inspector: abriria las vistas del IDE al alumno.
if (app.isPackaged && process.argv.some((a) => /^--(remote-debugging|inspect|remote-allow-origins)/.test(a))) app.exit(1);

// solo desarrollo/pruebas: datos de usuario aislados (sesion guardada, cache) para no tocar los reales
if (!app.isPackaged && process.env.ASSESSMENT_USER_DATA) app.setPath('userData', process.env.ASSESSMENT_USER_DATA);

registerShellScheme();
installSecurity();

if (!setupSingleInstance(() => win)) {
  app.exit(0);
} else {
  app.whenReady().then(async () => {
    const cfg = loadConfig();
    handleShellProtocol();
    win = new BrowserWindow({
      show: false,
      minWidth: 1100,
      minHeight: 700,
      title: 'Assessment',
      autoHideMenuBar: true,
      webPreferences: {
        preload: path.join(__dirname, '..', 'preload', 'shell.js'),
        contextIsolation: true,
        sandbox: true,
        nodeIntegration: false,
        devTools: false,
        webviewTag: false,
        spellcheck: false,
      },
    });
    win.on('page-title-updated', (e) => e.preventDefault()); // titulo fijo
    const views = new Views(win);
    controller = new Controller(win, cfg, views, (state) => {
      if (win && !win.isDestroyed()) win.webContents.send('state', state);
    });
    registerIpc(controller, () => SHELL_URL);

    win.on('close', (e) => {
      e.preventDefault();
      void controller?.quit();
    });

    await win.loadURL(SHELL_URL);
    win.maximize();
    win.show();
    await controller.init();

    // solo desarrollo: arranque automatico con alumno/examen fijos ("<studentId>,<examId>")
    const auto = !app.isPackaged ? process.env.ASSESSMENT_DEV_AUTOSTART : undefined;
    if (auto) {
      const [s, x] = auto.split(',').map(Number);
      await controller.start(s, x);
    }
  });

  app.on('window-all-closed', () => app.exit(0));
}

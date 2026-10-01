import { app, BrowserWindow } from 'electron';
import * as path from 'path';
import { loadConfig } from './config';
import { Controller } from './controller';
import { registerIpc } from './ipc';
import { installSecurity, setupSingleInstance } from './security';
import { Views } from './views';

let win: BrowserWindow | null = null;
let controller: Controller | null = null;

installSecurity();

if (!setupSingleInstance(() => win)) {
  app.exit(0);
} else {
  app.whenReady().then(async () => {
    const cfg = loadConfig();
    const shellFile = path.join(__dirname, '..', 'renderer', 'shell.html');
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
    registerIpc(controller, () => win!.webContents.getURL());

    win.on('close', (e) => {
      e.preventDefault();
      void controller?.quit();
    });

    await win.loadFile(shellFile);
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

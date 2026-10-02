import { app, BrowserWindow, Menu, Session, WebContents } from 'electron';

const BLOCKED_KEYS = (i: Electron.Input): boolean => {
  if (i.type !== 'keyDown') return false;
  const k = i.key.toLowerCase();
  if (k === 'f12') return true;
  if (i.control && i.shift && ['i', 'j', 'c'].includes(k)) return true;
  if (i.control && !i.shift && k === 'u') return true;
  return false;
};

/** Origen permitido por webContents (lo registra Views antes de cargar la vista del IDE o de la App). */
const allowed = new Map<number, string>();
export function allowOrigin(wc: WebContents, origin: string): void { allowed.set(wc.id, origin); }

const ALLOWED_PERMISSIONS = new Set(['clipboard-read', 'clipboard-sanitized-write']);

function hardenSession(ses: Session): void {
  const allowed = (permission: string, origin: string | undefined): boolean => {
    if (!ALLOWED_PERMISSIONS.has(permission) || !origin) return false;
    try { return new URL(origin).hostname === 'ide.localhost'; } catch { return false; }
  };
  ses.setPermissionRequestHandler((_wc, permission, cb, details) => cb(allowed(permission, details.requestingUrl)));
  ses.setPermissionCheckHandler((_wc, permission, origin) => allowed(permission, origin));
  ses.on('will-download', (event) => event.preventDefault());
}

/** Restricciones de design §7.7 aplicadas a TODA webContents que se cree (shell, IDE, App). */
export function installSecurity(): void {
  Menu.setApplicationMenu(null);
  app.on('session-created', hardenSession);

  app.on('web-contents-created', (_e, wc: WebContents) => {
    wc.setWindowOpenHandler(() => ({ action: 'deny' }));
    const guard = (event: Electron.Event, url: string): void => {
      // solo el mismo origen de cada vista (el que registro Views antes de cargarla); el shell (file://) no navega a ningun
      // lado. Nunca shell.openExternal.
      let ok = false;
      try { ok = allowed.get(wc.id) === new URL(url).origin; } catch { ok = false; }
      if (!ok) event.preventDefault();
    };
    wc.once("destroyed", () => allowed.delete(wc.id));
    wc.on("will-navigate", guard);
    wc.on('will-redirect', guard);
    wc.on('before-input-event', (event, input) => { if (BLOCKED_KEYS(input)) event.preventDefault(); });
    wc.on('devtools-opened', () => wc.closeDevTools());
  });
}

/** Ventana unica, maximizada y sin menu; la segunda instancia enfoca la existente. */
export function setupSingleInstance(getWindow: () => BrowserWindow | null): boolean {
  if (!app.requestSingleInstanceLock()) return false;
  app.on('second-instance', () => {
    const w = getWindow();
    if (!w) return;
    if (w.isMinimized()) w.restore();
    w.focus();
  });
  return true;
}

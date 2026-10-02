import { app, protocol } from 'electron';
import * as fs from 'fs';
import * as path from 'path';

/**
 * El shell se sirve por un protocolo propio y no por file://: con el fuse GrantFileProtocolExtraPrivileges=false
 * (design §7.7) Chromium ya no puede leer archivos dentro del asar por file://. Solo se sirven archivos de una lista fija.
 */
export const SHELL_SCHEME = 'assessment';
export const SHELL_URL = `${SHELL_SCHEME}://shell/shell.html`;
const FILES: Record<string, string> = {
  '/shell.html': 'text/html; charset=utf-8',
  '/shell.css': 'text/css; charset=utf-8',
  '/shell.js': 'text/javascript; charset=utf-8',
};

/** Debe llamarse antes de `app.whenReady()`. */
export function registerShellScheme(): void {
  protocol.registerSchemesAsPrivileged([{ scheme: SHELL_SCHEME, privileges: { standard: true, secure: true } }]);
}

/** Debe llamarse con la app lista. */
export function handleShellProtocol(): void {
  const root = path.join(app.getAppPath(), 'out', 'renderer');
  protocol.handle(SHELL_SCHEME, async (req) => {
    const url = new URL(req.url);
    const type = url.hostname === 'shell' ? FILES[url.pathname] : undefined;
    if (!type) return new Response('not found', { status: 404 });
    const data = await fs.promises.readFile(path.join(root, url.pathname.slice(1)));
    return new Response(data, { headers: { 'content-type': type } });
  });
}

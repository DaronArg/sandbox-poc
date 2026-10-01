import { app, safeStorage } from 'electron';
import * as fs from 'fs';
import * as path from 'path';

export interface SavedSession { sessionId: number; token: string }

const file = () => path.join(app.getPath('userData'), 'session.bin');

/** Sesion guardada cifrada con DPAPI (safeStorage). El resto de los datos se piden al backend (`status`). */
export function saveSession(s: SavedSession): void {
  if (!safeStorage.isEncryptionAvailable()) return; // sin cifrado disponible no se guarda: se pierde "Retomar", pero nunca el token en claro
  fs.mkdirSync(path.dirname(file()), { recursive: true });
  fs.writeFileSync(file(), safeStorage.encryptString(JSON.stringify(s)));
}

export function loadSession(): SavedSession | null {
  try {
    const s = JSON.parse(safeStorage.decryptString(fs.readFileSync(file()))) as SavedSession;
    return Number.isInteger(s.sessionId) && typeof s.token === 'string' ? s : null;
  } catch {
    return null;
  }
}

export function clearSession(): void {
  try { fs.rmSync(file(), { force: true }); } catch { /* nada que borrar */ }
}

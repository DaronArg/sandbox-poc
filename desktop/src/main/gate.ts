import { session, Session } from 'electron';

export const PARTITION = 'assessment'; // sin `persist:` => en memoria: la cookie no toca el disco
export const COOKIE_NAME = 'assessment_gate';

export function assessmentSession(): Session {
  return session.fromPartition(PARTITION);
}

export function ideOrigin(port: number): string { return `http://ide.localhost:${port}`; }
export function appOrigin(port: number): string { return `http://app.localhost:${port}`; }

/** Setea la cookie del gate para ide.localhost y app.localhost en la sesion en memoria. */
export async function setGateCookie(port: number, key: string): Promise<void> {
  const ses = assessmentSession();
  for (const origin of [ideOrigin(port), appOrigin(port)]) {
    await ses.cookies.set({ url: origin + '/', name: COOKIE_NAME, value: key, path: '/', httpOnly: true, sameSite: 'strict' });
  }
}

export async function clearGateCookies(): Promise<void> {
  await assessmentSession().clearStorageData();
}

/** GET con las cookies de la sesion; devuelve el status o 0 si no hay conexion. */
export async function fetchStatus(url: string): Promise<number> {
  try {
    const res = await assessmentSession().fetch(url, { signal: AbortSignal.timeout(5000) });
    await res.arrayBuffer().catch(() => undefined);
    return res.status;
  } catch {
    return 0;
  }
}

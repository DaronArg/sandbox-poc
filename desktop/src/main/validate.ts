/** Validacion de lo que devuelve el backend antes de usarlo en el `docker run` (design §6.4). */
export interface SessionInfo {
  sessionId: number;
  token?: string;
  branch: string;
  containerName: string;
  volume: string;
  image: string;
  containerBackendUrl: string;
  studentName: string;
  examTitle: string;
}

const NAME_RE = /^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,99}$/;
const IMAGE_RE = /^[a-z0-9./:_-]+$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function validateRunValues(v: { containerName: string; volume: string; image: string; token: string; containerBackendUrl: string; sessionId: number }): void {
  const bad = (what: string): never => {
    throw new Error(`El servidor devolvio un valor invalido para ${what}`);
  };
  if (!NAME_RE.test(v.containerName)) bad('containerName');
  if (!NAME_RE.test(v.volume)) bad('volume');
  if (!IMAGE_RE.test(v.image)) bad('image');
  if (!UUID_RE.test(v.token)) bad('token');
  if (!/^https?:\/\/[^\s]+$/.test(v.containerBackendUrl)) bad('containerBackendUrl');
  if (!Number.isInteger(v.sessionId) || v.sessionId <= 0) bad('sessionId');
}

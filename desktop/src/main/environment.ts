import { Backend, BackendError } from './backend';
import { Config } from './config';
import { distroInstalled, Docker, wslStatusOk } from './docker';
import { fetchStatus, ideOrigin, setGateCookie } from './gate';
import { SessionInfo, validateRunValues } from './validate';

export type StepId = 'wsl' | 'distro' | 'docker' | 'backend' | 'session' | 'image' | 'container' | 'gate' | 'ide';
export type StepStatus = 'pending' | 'running' | 'ok' | 'error';
export interface Step { id: StepId; label: string; status: StepStatus; detail?: string }

export const STEP_LABELS: Record<StepId, string> = {
  wsl: 'WSL', distro: 'Distro Ubuntu', docker: 'Docker', backend: 'Servidor de la plataforma',
  session: 'Sesion', image: 'Imagen del entorno', container: 'Contenedor', gate: 'Acceso al entorno', ide: 'IDE',
};

export class EnvironmentError extends Error {
  constructor(public readonly step: StepId, message: string, public readonly logs?: string) {
    super(message);
  }
}

export type Mode =
  | { kind: 'new'; studentId: number; examId: number }
  | { kind: 'resume'; sessionId: number; token: string };

export interface Environment {
  info: SessionInfo;
  token: string;
  port: number;
  resumed: boolean;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Orquesta los pasos de design §7.3 (Progreso). `report` recibe el estado de cada paso. */
export async function startEnvironment(
  cfg: Config,
  backend: Backend,
  docker: Docker,
  mode: Mode,
  report: (id: StepId, status: StepStatus, detail?: string) => void,
): Promise<Environment> {
  const run = async <T>(id: StepId, fn: () => Promise<T>): Promise<T> => {
    report(id, 'running');
    try {
      const out = await fn();
      report(id, 'ok');
      return out;
    } catch (e) {
      const msg = (e as Error).message;
      report(id, 'error', msg);
      throw e instanceof EnvironmentError ? e : new EnvironmentError(id, msg);
    }
  };

  await run('wsl', async () => {
    if (!(await wslStatusOk())) throw new EnvironmentError('wsl', 'Instala WSL: `wsl --install`');
  });
  await run('distro', async () => {
    if (!(await distroInstalled(cfg.wslDistro))) throw new EnvironmentError('distro', `No se encontro la distro ${cfg.wslDistro} en WSL`);
  });
  await run('docker', async () => {
    if (await docker.serverVersion()) return;
    await docker.tryStartDaemon();
    for (let i = 0; i < 10; i++) {
      await sleep(1000);
      if (await docker.serverVersion()) return;
    }
    throw new EnvironmentError('docker', 'Docker no responde dentro de WSL');
  });
  await run('backend', async () => {
    try { await backend.exams(); } catch (e) {
      if (e instanceof BackendError && e.status === 426) throw new EnvironmentError('backend', `Actualiza la aplicacion (version minima ${e.minVersion})`);
      throw new EnvironmentError('backend', 'No se puede conectar con el servidor de la plataforma');
    }
  });

  let info!: SessionInfo;
  let token = '';
  const resumed = mode.kind === 'resume';
  await run('session', async () => {
    try {
      if (mode.kind === 'new') {
        info = await backend.createSession(mode.studentId, mode.examId);
        token = info.token ?? '';
      } else {
        info = await backend.status(mode.sessionId, mode.token);
        token = mode.token;
      }
    } catch (e) {
      if (e instanceof BackendError && e.status === 426) throw new EnvironmentError('session', `Actualiza la aplicacion (version minima ${e.minVersion})`);
      throw e;
    }
    validateRunValues({ ...info, token });
  });

  await run('image', async () => {
    if (await docker.imageExists(info.image)) return;
    report('image', 'running', 'Descargando la imagen (la primera vez tarda unos minutos)');
    const r = await docker.pull(info.image);
    if (r.code !== 0) {
      throw new EnvironmentError(
        'image',
        `No se pudo descargar la imagen \`${info.image}\`. Si el paquete es privado, inicia sesion en el registry dentro de WSL (docker login) o construila local con scripts/build-runtime.sh.`,
        (r.stderr + r.stdout).trim().split('\n').slice(-8).join('\n'),
      );
    }
  });

  await run('container', async () => {
    await docker.removeForce(info.containerName); // sobrante de un cierre abrupto
    const r = await docker.run({
      containerName: info.containerName, volume: info.volume, image: info.image,
      sessionId: info.sessionId, token, backendUrl: info.containerBackendUrl,
    });
    if (r.code !== 0) {
      const err = (r.stderr + r.stdout).trim();
      if (/port is already allocated|address already in use/i.test(err)) {
        throw new EnvironmentError('container', 'El puerto 8081 esta ocupado; cerra lo que lo use');
      }
      const logs = await docker.logs(info.containerName).catch(() => '');
      throw new EnvironmentError('container', 'No se pudo iniciar el contenedor', [err, logs].filter(Boolean).join('\n'));
    }
  });

  const { port, key } = await run('gate', async () => {
    let port: number | null = null;
    let key: string | null = null;
    for (let i = 0; i < 10 && !(port && key); i++) {
      port = port ?? (await docker.gatePort(info.containerName));
      key = key ?? (await docker.gateKey(info.containerName));
      if (port && key) break;
      if (!(await docker.isRunning(info.containerName))) {
        throw new EnvironmentError('gate', 'El contenedor se detuvo al iniciar', await docker.logs(info.containerName));
      }
      await sleep(1000);
    }
    if (!port || !key) throw new EnvironmentError('gate', 'No se pudo leer el acceso del entorno', await docker.logs(info.containerName));
    return { port, key };
  });

  await run('ide', async () => {
    await setGateCookie(port, key);
    const deadline = Date.now() + cfg.ideReadyTimeoutSec * 1000;
    while (Date.now() < deadline) {
      if ((await fetchStatus(`${ideOrigin(port)}/healthz`)) === 200) return;
      if (!(await docker.isRunning(info.containerName))) {
        throw new EnvironmentError('ide', 'El contenedor se detuvo al iniciar', await docker.logs(info.containerName));
      }
      await sleep(1500);
    }
    throw new EnvironmentError('ide', 'El IDE no respondio a tiempo', await docker.logs(info.containerName));
  });

  return { info, token, port, resumed };
}

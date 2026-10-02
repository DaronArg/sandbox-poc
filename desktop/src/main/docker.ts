import { runInDistro, wslCommand, WslResult } from './wsl';

export interface RunParams {
  containerName: string;
  volume: string;
  image: string;
  sessionId: number;
  token: string;
  backendUrl: string;
}

/** Todo `docker` se ejecuta dentro de la distro de WSL, como array de argumentos (sin shell). */
export class Docker {
  constructor(private readonly distro: string) {}

  private docker(args: string[], opts: { user?: string; timeoutMs?: number } = {}): Promise<WslResult> {
    return runInDistro(this.distro, ['docker', ...args], opts);
  }

  async serverVersion(): Promise<string | null> {
    const r = await this.docker(['info', '--format', '{{.ServerVersion}}'], { timeoutMs: 20000 });
    return r.code === 0 ? r.stdout.trim() : null;
  }

  /** Un intento de levantar el daemon como root (systemd) cuando no responde. */
  async tryStartDaemon(): Promise<void> {
    await runInDistro(this.distro, ['systemctl', 'start', 'docker'], { user: 'root', timeoutMs: 60000 });
  }

  async imageExists(image: string): Promise<boolean> {
    return (await this.docker(['image', 'inspect', '--format', '{{.Id}}', image], { timeoutMs: 20000 })).code === 0;
  }

  /** `docker pull` (un registry como GHCR puede ser privado: requiere `docker login` previo en la distro). */
  pull(image: string): Promise<WslResult> {
    return this.docker(['pull', image], { timeoutMs: 15 * 60 * 1000 });
  }

  async removeForce(name: string): Promise<void> {
    await this.docker(['rm', '-f', name], { timeoutMs: 30000 });
  }

  /** design §6.4 */
  run(p: RunParams): Promise<WslResult> {
    return this.docker([
      'run', '-d', '--init', '--rm',
      '--name', p.containerName,
      '--security-opt', 'no-new-privileges',
      '-p', '127.0.0.1::7000',
      '-p', '127.0.0.1:8081:9081',
      '--add-host=host.docker.internal:host-gateway',
      '-e', `SESSION_ID=${p.sessionId}`,
      '-e', `SESSION_TOKEN=${p.token}`,
      '-e', `BACKEND_URL=${p.backendUrl}`,
      '-v', `${p.volume}:/workspace`,
      p.image,
    ], { timeoutMs: 120000 });
  }

  /** Puerto del host asignado al 7000 del gate. */
  async gatePort(name: string): Promise<number | null> {
    const r = await this.docker(['port', name, '7000/tcp'], { timeoutMs: 15000 });
    if (r.code !== 0) return null;
    const m = /:(\d+)\s*$/m.exec(r.stdout.trim().split('\n')[0] ?? '');
    return m ? Number(m[1]) : null;
  }

  /** Clave del gate (nunca se loguea). */
  async gateKey(name: string): Promise<string | null> {
    const r = await this.docker(['exec', '-u', 'root', name, 'cat', '/run/gate/key'], { timeoutMs: 15000 });
    const key = r.stdout.trim();
    return r.code === 0 && /^[0-9a-f]{64}$/.test(key) ? key : null;
  }

  async isRunning(name: string): Promise<boolean> {
    const r = await this.docker(['inspect', '-f', '{{.State.Running}}', name], { timeoutMs: 15000 });
    return r.code === 0 && r.stdout.trim() === 'true';
  }

  async logs(name: string, lines = 30): Promise<string> {
    const r = await this.docker(['logs', '--tail', String(lines), name], { timeoutMs: 15000 });
    return (r.stdout + r.stderr).trim();
  }

  exec(name: string, user: string, cmd: string[], timeoutMs = 20000): Promise<WslResult> {
    return this.docker(['exec', '-u', user, name, ...cmd], { timeoutMs });
  }

  async stop(name: string, graceSec = 10): Promise<void> {
    await this.docker(['stop', '-t', String(graceSec), name], { timeoutMs: (graceSec + 20) * 1000 });
  }
}

export async function wslStatusOk(): Promise<boolean> {
  return (await wslCommand(['--status'])).code === 0;
}

export async function distroInstalled(distro: string): Promise<boolean> {
  const r = await wslCommand(['-l', '-q']);
  if (r.code !== 0) return false;
  return r.stdout.split(/\r?\n/).map((s) => s.trim().toLowerCase()).includes(distro.toLowerCase());
}

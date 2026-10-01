import { execFile } from 'child_process';

export interface WslResult {
  code: number;
  stdout: string;
  stderr: string;
}

/**
 * Los mensajes propios de wsl.exe (--status, -l, errores) salen en UTF-16LE; lo que imprime un comando dentro de la
 * distro sale en UTF-8. Se detecta por la cantidad de bytes nulos y se normaliza (sin BOM ni NUL).
 */
export function decodeWslOutput(buf: Buffer): string {
  if (buf.length === 0) return '';
  let zeros = 0;
  for (const b of buf) if (b === 0) zeros++;
  const utf16 = zeros >= buf.length / 4;
  const text = utf16 ? buf.toString('utf16le') : buf.toString('utf8');
  return text.replace(/^﻿/, '').replace(/\0/g, '');
}

export interface WslOptions {
  distro?: string;
  user?: string;
  timeoutMs?: number;
  input?: string;
}

function exec(args: string[], timeoutMs: number, input?: string): Promise<WslResult> {
  return new Promise((resolve) => {
    const child = execFile(
      'wsl.exe',
      args,
      { encoding: 'buffer', windowsHide: true, maxBuffer: 16 * 1024 * 1024, timeout: timeoutMs },
      (err, stdout, stderr) => {
        const code = !err ? 0 : typeof (err as { code?: unknown }).code === "number" ? (err as unknown as { code: number }).code : 1;
        resolve({ code, stdout: decodeWslOutput(stdout as Buffer), stderr: decodeWslOutput(stderr as Buffer) });
      },
    );
    if (input !== undefined) child.stdin?.end(input);
  });
}

/** Comandos propios de wsl.exe: `--status`, `-l -q`. */
export function wslCommand(args: string[], timeoutMs = 15000): Promise<WslResult> {
  return exec(args, timeoutMs);
}

/** Ejecuta un binario dentro de la distro sin shell (`wsl.exe -d <distro> [-u user] --exec <cmd> <args...>`). */
export function runInDistro(distro: string, cmd: string[], opts: WslOptions = {}): Promise<WslResult> {
  const args = ['-d', distro];
  if (opts.user) args.push('-u', opts.user);
  args.push('--exec', ...cmd);
  return exec(args, opts.timeoutMs ?? 60000, opts.input);
}

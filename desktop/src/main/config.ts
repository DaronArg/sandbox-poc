import { app } from 'electron';
import * as fs from 'fs';
import * as path from 'path';

export interface Config {
  backendUrl: string;
  wslDistro: string;
  ideReadyTimeoutSec: number;
  telemetryFlushSec: number;
}

/** config.json va empaquetado dentro del asar; con la app sin empaquetar se aceptan overrides por env (solo desarrollo). */
export function loadConfig(): Config {
  const file = path.join(app.getAppPath(), 'config.json');
  const cfg: Config = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (!app.isPackaged) {
    if (process.env.ASSESSMENT_BACKEND_URL) cfg.backendUrl = process.env.ASSESSMENT_BACKEND_URL;
    if (process.env.ASSESSMENT_WSL_DISTRO) cfg.wslDistro = process.env.ASSESSMENT_WSL_DISTRO;
  }
  return cfg;
}

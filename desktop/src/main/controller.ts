import { app, BrowserWindow } from 'electron';
import { Backend, BackendError, Exam, Student } from './backend';
import { Config } from './config';
import { ask } from './dialogs';
import { Docker } from './docker';
import { Environment, EnvironmentError, Mode, Step, STEP_LABELS, StepId, startEnvironment } from './environment';
import { appOrigin, clearGateCookies, fetchStatus } from './gate';
import { clearSession, loadSession, saveSession } from './store';
import { DesktopTelemetry } from './telemetry';
import { Tab, Views } from './views';

export interface SavedInfo { sessionId: number; studentName: string; examTitle: string; branch: string }

export type AppState =
  | { screen: 'start'; saved: SavedInfo | null }
  | { screen: 'progress'; steps: Step[] }
  | { screen: 'error'; title: string; message: string; logs?: string; canRetry: boolean }
  | { screen: 'workspace'; student: string; exam: string; tab: Tab; appUp: boolean; port: number }
  | { screen: 'submitting' }
  | { screen: 'submitted'; sha: string }
  | { screen: 'closing' };

const STEP_ORDER: StepId[] = ['wsl', 'distro', 'docker', 'backend', 'session', 'image', 'container', 'gate', 'ide'];
const APP_POLL_MS = 3000;
const CONTAINER_POLL_MS = 5000;

/** Estado de la aplicacion: arranque del entorno, workspace (pestanas), monitoreo y cierre (design §7.3-§7.5). */
export class Controller {
  private state: AppState = { screen: 'start', saved: null };
  private env: Environment | null = null;
  private lastMode: Mode | null = null;
  private steps: Step[] = [];
  private views: Views;
  private docker: Docker;
  private backend: Backend;
  private telemetry: DesktopTelemetry;
  private appTimer: NodeJS.Timeout | null = null;
  private containerTimer: NodeJS.Timeout | null = null;
  private closing = false;
  private awaySince: number | null = null;

  constructor(private readonly win: BrowserWindow, private readonly cfg: Config, views: Views, private readonly onState: (s: AppState) => void) {
    this.views = views;
    this.docker = new Docker(cfg.wslDistro);
    this.backend = new Backend(cfg.backendUrl);
    this.telemetry = new DesktopTelemetry(this.backend, cfg.telemetryFlushSec);
    this.watchFocus();
  }

  getState(): AppState { return this.state; }
  listStudents(): Promise<Student[]> { return this.backend.students(); }
  listExams(): Promise<Exam[]> { return this.backend.exams(); }

  private set(s: AppState): void {
    this.state = s;
    this.onState(s);
  }

  /** Pantalla de inicio: si hay sesion guardada y el backend la reconoce, ofrece "Retomar". */
  async init(): Promise<void> {
    this.views.setVisible(false);
    this.set({ screen: 'start', saved: await this.getSaved() });
  }

  async getSaved(): Promise<SavedInfo | null> {
    const saved = loadSession();
    if (!saved) return null;
    try {
      const s = await this.backend.status(saved.sessionId, saved.token);
      return { sessionId: s.sessionId, studentName: s.studentName, examTitle: s.examTitle, branch: s.branch };
    } catch (e) {
      if (e instanceof BackendError && (e.status === 401 || e.status === 404)) clearSession();
      return null; // backend caido u otra causa: se muestra el formulario; el error aparece al iniciar
    }
  }

  start(studentId: number, examId: number): Promise<void> { return this.launch({ kind: 'new', studentId, examId }); }

  async resume(): Promise<void> {
    const saved = loadSession();
    if (!saved) return this.init();
    return this.launch({ kind: 'resume', sessionId: saved.sessionId, token: saved.token });
  }

  async newSession(): Promise<void> {
    const r = await ask(this.win, {
      type: 'question', buttons: ['Iniciar otra sesion', 'Cancelar'], defaultId: 1, cancelId: 1,
      message: 'Se va a reemplazar la sesion guardada.',
      detail: 'El codigo de la sesion anterior queda en este equipo, pero ya no vas a poder retomarla desde la aplicacion.',
    });
    if (r !== 0) return;
    clearSession();
    this.set({ screen: 'start', saved: null });
  }

  retry(): Promise<void> {
    if (this.lastMode) return this.launch(this.lastMode);
    return this.init();
  }

  private async launch(mode: Mode): Promise<void> {
    this.lastMode = mode;
    this.stopMonitors();
    this.views.setVisible(false);
    this.steps = STEP_ORDER.map((id) => ({ id, label: STEP_LABELS[id], status: 'pending' as const }));
    this.set({ screen: 'progress', steps: this.steps });
    try {
      this.env = await startEnvironment(this.cfg, this.backend, this.docker, mode, (id, status, detail) => {
        const st = this.steps.find((s) => s.id === id)!;
        st.status = status;
        st.detail = detail;
        this.set({ screen: 'progress', steps: this.steps.map((s) => ({ ...s })) });
      });
    } catch (e) {
      const err = e as EnvironmentError;
      this.lastMode = mode;
      this.set({ screen: 'error', title: 'No se pudo iniciar el entorno', message: err.message, logs: err.logs, canRetry: true });
      return;
    }
    // se guarda recien con el entorno listo: "Retomar" nunca apunta a una sesion que no llego a arrancar
    saveSession({ sessionId: this.env.info.sessionId, token: this.env.token });
    this.lastMode = { kind: 'resume', sessionId: this.env.info.sessionId, token: this.env.token };
    this.win.setTitle(`Assessment — ${this.env.info.studentName} · ${this.env.info.examTitle}`);
    this.telemetry.start(this.env.info.sessionId, this.env.token);
    this.telemetry.emit('DESKTOP_STARTED', { version: app.getVersion(), resumed: this.env.resumed });
    this.views.openIde(this.env.port);
    this.views.setVisible(true);
    this.setWorkspace('IDE', false);
    this.startMonitors();
  }

  private setWorkspace(tab: Tab, appUp: boolean): void {
    const e = this.env!;
    this.set({ screen: 'workspace', student: e.info.studentName, exam: e.info.examTitle, tab, appUp, port: e.port });
  }

  switchTab(tab: Tab): void {
    if (this.state.screen !== 'workspace' || tab === this.state.tab) return;
    this.views.setActive(tab);
    this.telemetry.emit('DESKTOP_TAB_CHANGED', { tab });
    this.setWorkspace(tab, this.state.appUp);
  }

  reload(): void { this.views.reload(); }

  // --- monitoreo (design §7.3 Workspace)
  private startMonitors(): void {
    this.appTimer = setInterval(() => void this.pollApp(), APP_POLL_MS);
    this.containerTimer = setInterval(() => void this.pollContainer(), CONTAINER_POLL_MS);
    void this.pollApp();
  }

  private stopMonitors(): void {
    if (this.appTimer) clearInterval(this.appTimer);
    if (this.containerTimer) clearInterval(this.containerTimer);
    this.appTimer = this.containerTimer = null;
  }

  private async pollApp(): Promise<void> {
    if (!this.env || this.state.screen !== 'workspace') return;
    const up = (await fetchStatus(`${appOrigin(this.env.port)}/`)) === 200;
    if (up && !this.views.hasApp) this.views.showApp(this.env.port);
    if (!up && this.views.hasApp) this.views.hideApp();
    if (this.state.screen === 'workspace' && this.state.appUp !== up) this.setWorkspace(this.state.tab, up);
  }

  private async pollContainer(): Promise<void> {
    if (!this.env || this.closing || this.state.screen !== 'workspace') return;
    if (await this.docker.isRunning(this.env.info.containerName)) return;
    this.stopMonitors();
    this.views.setVisible(false);
    this.views.closeAll();
    this.set({ screen: 'error', title: 'El entorno se detuvo', message: 'El contenedor ya no esta corriendo. Tu codigo queda guardado: podes reiniciar el entorno.', canRetry: true });
  }

  // --- entrega (design §2.6): `submit` del contenedor (commit de lo pendiente, push, SHA final al backend)
  async submit(): Promise<void> {
    if (this.closing || this.state.screen !== 'workspace' || !this.env) return;
    const env = this.env;
    const r = await ask(this.win, {
      type: 'warning', buttons: ['Entregar', 'Cancelar'], defaultId: 1, cancelId: 1,
      message: 'Vas a entregar el examen.',
      detail: 'Se sube tu codigo a GitHub y la sesion se cierra: despues de entregar no podes seguir trabajando ni retomarla.',
    });
    if (r !== 0) return;
    this.closing = true;
    this.stopMonitors();
    this.views.setVisible(false);
    this.set({ screen: 'submitting' });
    await this.telemetry.flush();
    const out = await this.docker.exec(env.info.containerName, 'coder', ['submit'], 180000);
    const sha = /SHA final:\s*([0-9a-f]{7,40})/i.exec(out.stdout)?.[1];
    if (out.code !== 0 || !sha) {
      // sin SHA registrado la sesion sigue activa: se vuelve al workspace para reintentar
      this.closing = false;
      this.views.setVisible(true);
      this.setWorkspace(this.views.activeTab, this.views.hasApp);
      this.startMonitors();
      await ask(this.win, { type: 'error', buttons: ['Aceptar'], defaultId: 0, cancelId: 0, message: 'No se pudo entregar.', detail: (out.stderr + out.stdout).trim().split('\n').slice(-6).join('\n') });
      return;
    }
    this.telemetry.stop();
    this.views.closeAll();
    await this.docker.stop(env.info.containerName, 10).catch(() => undefined);
    await clearGateCookies().catch(() => undefined);
    clearSession(); // una sesion entregada no se retoma
    this.env = null;
    this.lastMode = null;
    this.closing = false; // sin entorno, `quit` sale directo (pantalla "Entrega registrada" -> Cerrar)
    this.win.setTitle('Assessment');
    this.set({ screen: 'submitted', sha });
  }

  // --- foco (design §7.6)
  private watchFocus(): void {
    const lost = (): void => {
      if (this.awaySince !== null || !this.env) return;
      this.awaySince = Date.now();
      this.telemetry.emit('DESKTOP_FOCUS_LOST');
    };
    const gained = (): void => {
      if (this.awaySince === null || !this.env) return;
      const awayMs = Date.now() - this.awaySince;
      this.awaySince = null;
      this.telemetry.emit('DESKTOP_FOCUS_GAINED', { awayMs });
    };
    this.win.on('blur', lost);
    this.win.on('minimize', lost);
    this.win.on('focus', gained);
    this.win.on('restore', gained);
  }

  // --- cierre (design §7.5)
  async quit(): Promise<void> {
    if (this.closing) return;
    if (!this.env) { app.exit(0); return; }
    const env = this.env;
    const unsaved = await this.unsavedWork(env.info.containerName).catch(() => false);
    const r = await ask(this.win, {
      type: 'question', buttons: ['Salir', 'Cancelar'], defaultId: 1, cancelId: 1,
      message: 'Se va a apagar el entorno. Tu codigo queda guardado en este equipo para retomar.',
      detail: unsaved ? 'Tenes cambios sin subir a GitHub (git push).' : undefined,
    });
    if (r !== 0) return;
    this.closing = true;
    this.stopMonitors();
    this.views.setVisible(false);
    this.set({ screen: 'closing' });
    this.telemetry.emit('DESKTOP_CLOSED');
    await this.telemetry.flush();
    await this.docker.exec(env.info.containerName, 'root', ['pkill', '-TERM', '-f', 'telemetry/agent.js']).catch(() => undefined);
    for (let i = 0; i < 10; i++) { // espera hasta 5 s a que el agente haga su flush y termine
      const r2 = await this.docker.exec(env.info.containerName, 'root', ['pgrep', '-f', 'telemetry/agent.js']).catch(() => ({ code: 1 }));
      if (r2.code !== 0) break;
      await new Promise((res) => setTimeout(res, 500));
    }
    await this.docker.stop(env.info.containerName, 10).catch(() => undefined);
    await clearGateCookies().catch(() => undefined);
    app.exit(0);
  }

  /** Cambios sin commitear o commits que no estan en ningun remoto. */
  private async unsavedWork(name: string): Promise<boolean> {
    const status = await this.docker.exec(name, 'coder', ['git', '-C', '/workspace', 'status', '--porcelain']);
    if (status.stdout.trim()) return true;
    const up = await this.docker.exec(name, 'coder', ['git', '-C', '/workspace', 'rev-parse', '--abbrev-ref', '@{u}']);
    const log = up.code === 0
      ? await this.docker.exec(name, 'coder', ['git', '-C', '/workspace', 'log', '--oneline', '@{u}..'])
      : await this.docker.exec(name, 'coder', ['git', '-C', '/workspace', 'log', '--oneline', 'HEAD', '--not', '--remotes']);
    return log.stdout.trim().length > 0;
  }
}

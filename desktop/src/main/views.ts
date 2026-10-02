import { BrowserWindow, WebContentsView } from 'electron';
import { appOrigin, ideOrigin, PARTITION } from './gate';
import { allowOrigin } from './security';

export const BAR_HEIGHT = 44;
export type Tab = 'IDE' | 'APP';

/** Vistas del IDE y del front del alumno, debajo de la barra superior (que es la propia pagina del shell). */
export class Views {
  private ide: WebContentsView | null = null;
  private app: WebContentsView | null = null;
  private active: Tab = 'IDE';
  private visible = false;
  onCreate: (view: WebContentsView, kind: Tab) => void = () => undefined;

  constructor(private readonly win: BrowserWindow) {
    win.on('resize', () => this.layout());
    win.on('maximize', () => this.layout());
    win.on('unmaximize', () => this.layout());
  }

  private make(kind: Tab): WebContentsView {
    const view = new WebContentsView({
      webPreferences: {
        partition: PARTITION,
        contextIsolation: true,
        sandbox: true,
        nodeIntegration: false,
        devTools: false,
        webviewTag: false,
        spellcheck: false,
      },
    });
    this.onCreate(view, kind);
    this.win.contentView.addChildView(view);
    return view;
  }

  private bounds() {
    const [w, h] = this.win.getContentSize();
    return { x: 0, y: BAR_HEIGHT, width: w, height: Math.max(0, h - BAR_HEIGHT) };
  }

  layout(): void {
    for (const v of [this.ide, this.app]) if (v) v.setBounds(this.bounds());
    this.refresh();
  }

  private refresh(): void {
    this.ide?.setVisible(this.visible && this.active === 'IDE');
    this.app?.setVisible(this.visible && this.active === 'APP');
  }

  openIde(port: number): void {
    this.closeAll();
    this.ide = this.make('IDE');
    this.ide.setBounds(this.bounds());
    allowOrigin(this.ide.webContents, ideOrigin(port));
    void this.ide.webContents.loadURL(`${ideOrigin(port)}/`).catch((e) => console.error('[views] IDE no cargo:', e.message));
    this.active = 'IDE';
    this.refresh();
  }

  /** Muestra u oculta todas las vistas (el shell se ve debajo: pantallas de progreso/error, placeholder de App). */
  setVisible(v: boolean): void {
    this.visible = v;
    this.refresh();
  }

  setActive(tab: Tab): void {
    this.active = tab;
    this.refresh();
  }

  get activeTab(): Tab { return this.active; }
  get hasApp(): boolean { return this.app !== null; }

  showApp(port: number): void {
    if (this.app) return;
    this.app = this.make('APP');
    this.app.setBounds(this.bounds());
    allowOrigin(this.app.webContents, appOrigin(port));
    void this.app.webContents.loadURL(`${appOrigin(port)}/`).catch((e) => console.error('[views] App no cargo:', e.message));
    this.refresh();
  }

  hideApp(): void {
    if (!this.app) return;
    this.win.contentView.removeChildView(this.app);
    this.app.webContents.close();
    this.app = null;
    this.refresh();
  }

  reload(): void {
    const v = this.active === 'IDE' ? this.ide : this.app;
    v?.webContents.reload();
  }

  closeAll(): void {
    for (const v of [this.ide, this.app]) {
      if (!v) continue;
      this.win.contentView.removeChildView(v);
      v.webContents.close();
    }
    this.ide = null;
    this.app = null;
  }
}

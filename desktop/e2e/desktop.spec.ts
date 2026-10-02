// E2E de la app (Playwright `_electron`): iniciar sesion, IDE visible, pestana App, salir y retomar.
// Corre contra la app sin empaquetar (la empaquetada no admite inspector, por diseno). Las vistas del IDE/App se inspeccionan
// desde el proceso principal (executeJavaScript sobre sus webContents).
import { _electron as electron, ElectronApplication, expect, Page, test } from '@playwright/test';
import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

const USERDATA = fs.mkdtempSync(path.join(os.tmpdir(), 'assessment-pw-'));
const DIALOGS = path.join(USERDATA, 'dialogs.log');
const wsl = (...cmd: string[]): string => execFileSync('wsl.exe', ['-d', 'Ubuntu', '--exec', ...cmd], { encoding: 'utf8' });
const running = (): string => wsl('docker', 'ps', '--format', '{{.Names}}').trim();

let app: ElectronApplication;
let shell: Page;
let container = '';

async function launch(): Promise<void> {
  app = await electron.launch({
    args: ['.'],
    cwd: path.resolve(__dirname, '..'),
    env: { ...process.env, ASSESSMENT_USER_DATA: USERDATA, ASSESSMENT_TEST_DIALOG_LOG: DIALOGS, ASSESSMENT_TEST_DIALOG_ANSWER: '0' } as Record<string, string>,
  });
  shell = await app.firstWindow();
}

/** Ejecuta JS dentro de la vista (WebContentsView) cuya URL contiene `host`. */
async function inView<T>(host: string, js: string): Promise<T> {
  return app.evaluate(async ({ BrowserWindow }, { host, js }) => {
    const w = BrowserWindow.getAllWindows()[0];
    const v = w.contentView.children.find((c) => (c as any).webContents?.getURL().includes(host)) as any;
    if (!v) return null;
    return v.webContents.executeJavaScript(js);
  }, { host, js }) as Promise<T>;
}

test.describe.configure({ mode: 'serial' });

test.beforeAll(() => {
  wsl('bash', '-c', 'docker ps -aq | xargs -r docker rm -f >/dev/null');
});
test.afterAll(async () => {
  await app?.evaluate(({ app: a }) => a.exit(0)).catch(() => undefined);
});

test('iniciar una sesion muestra el IDE con el repo clonado', async () => {
  await launch();
  await expect(shell.locator('#form')).toBeVisible({ timeout: 60_000 });
  await expect(shell.locator('#student option')).not.toHaveCount(0);
  await shell.locator('#begin').click();
  await expect(shell.locator('#progress')).toBeVisible();
  await expect(shell.locator('#bar')).toBeVisible({ timeout: 240_000 });
  await expect(shell.locator('#who')).toContainText('Ana Alumna');

  container = running();
  expect(container).toMatch(/^assessment-\d+-[0-9a-f]{6}$/);
  await expect.poll(() => inView<boolean>('ide.localhost', `!!document.querySelector('.monaco-workbench')`), { timeout: 120_000 }).toBe(true);
  await expect.poll(() => inView<boolean>('ide.localhost', `document.body.innerText.includes('pom.xml')`), { timeout: 120_000 }).toBe(true);
  const branch = wsl('docker', 'exec', '-u', 'coder', container, 'git', '-C', '/workspace', 'rev-parse', '--abbrev-ref', 'HEAD').trim();
  expect(branch).toMatch(/^session-\d+-[0-9a-f]{6}$/);
});

test('la pestana App muestra el placeholder y luego el front', async () => {
  await shell.locator('#tab-app').click();
  await expect(shell.locator('#app-placeholder')).toBeVisible();
  await expect(shell.locator('#app-placeholder')).toContainText('npm start');
  await shell.locator('#tab-ide').click();

  // front levantado dentro del contenedor (equivale a `npm start` en la terminal del IDE)
  wsl('docker', 'exec', '-u', 'coder', container, 'bash', '-c', 'cd /workspace/frontend && npm install --no-audit --no-fund >/tmp/npm.log 2>&1');
  wsl('docker', 'exec', '-u', 'coder', '-d', container, 'bash', '-c', 'cd /workspace/frontend && npm start >/tmp/ng-serve.log 2>&1');
  await shell.locator('#tab-app').click();
  await expect(shell.locator('#app-placeholder')).toBeHidden({ timeout: 120_000 });
  await expect.poll(() => inView<string>('app.localhost', `document.querySelector('h1')?.innerText`), { timeout: 60_000 }).toBe('Calculadora de precios');
});

test('salir apaga el entorno y retomar recupera el mismo codigo', async () => {
  wsl('docker', 'exec', '-u', 'coder', container, 'bash', '-c', 'echo e2e-marker > /workspace/e2e-marker.txt');
  await shell.locator('#tab-ide').click();
  const closed = app.waitForEvent('close');
  await shell.locator('#quit').click();
  await closed;
  const dialog = fs.readFileSync(DIALOGS, 'utf8').trim().split('\n').map((l) => JSON.parse(l)).pop();
  expect(dialog.message).toContain('Se va a apagar el entorno');
  expect(dialog.detail).toContain('cambios sin subir');
  expect(running()).toBe('');

  await launch();
  await expect(shell.locator('#resume-card')).toBeVisible({ timeout: 60_000 });
  await expect(shell.locator('#resume-text')).toContainText('Ana Alumna');
  await shell.locator('#resume').click();
  await expect(shell.locator('#bar')).toBeVisible({ timeout: 240_000 });
  expect(running()).toBe(container);
  expect(wsl('docker', 'exec', '-u', 'coder', container, 'cat', '/workspace/e2e-marker.txt').trim()).toBe('e2e-marker');
});

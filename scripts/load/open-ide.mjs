// Abre la IDE del alumno (localhost:8080) en un navegador real, mide el tiempo hasta que el explorer muestra el repo
// y abre PriceService.java para que arranque el language server de Java. Mantiene la pestana abierta HOLD_S segundos.
// Uso (desde Windows, con demo/node_modules instalado): node scripts/load/open-ide.mjs [HOLD_S]
import { chromium } from '../../demo/node_modules/playwright/index.mjs';

const HOLD_S = Number(process.argv[2] || 150);
const browser = await chromium.launch({ headless: true });
const page = await (await browser.newContext({ viewport: { width: 1600, height: 900 } })).newPage();

const t0 = Date.now();
await page.goto('http://localhost:8080/?folder=/workspace', { waitUntil: 'domcontentloaded' });
await page.getByText('pom.xml').first().waitFor({ timeout: 120000 });
console.log(`ide_usable_explorer_visible=${((Date.now() - t0) / 1000).toFixed(1)} s (desde el goto; navegador headless en Windows, IDE por localhost)`);

const t1 = Date.now();
await page.keyboard.press('Control+p');
await page.keyboard.type('PriceService.java', { delay: 30 });
await page.waitForTimeout(800);
await page.keyboard.press('Enter');
await page.locator('.monaco-editor').first().waitFor({ timeout: 30000 });
console.log(`file_open=${((Date.now() - t1) / 1000).toFixed(1)} s`);
console.log('HOLDING');
await page.waitForTimeout(HOLD_S * 1000);
await browser.close();

// Genera build/icon.ico (PNG de 256x256 dentro de un ICO) renderizando un SVG con Edge headless via Playwright.
const { chromium } = require('@playwright/test');
const fs = require('fs');
const path = require('path');
(async () => {
  const browser = await chromium.launch({ channel: 'msedge' });
  const page = await browser.newPage({ viewport: { width: 256, height: 256 } });
  await page.setContent(`<body style="margin:0;background:transparent"><svg width="256" height="256" viewBox="0 0 256 256" xmlns="http://www.w3.org/2000/svg">
    <rect width="256" height="256" rx="48" fill="#1e1e1e"/><rect x="16" y="16" width="224" height="224" rx="36" fill="#3b82f6"/>
    <text x="128" y="180" font-family="Segoe UI, Arial" font-weight="700" font-size="150" text-anchor="middle" fill="#fff">A</text></svg></body>`);
  const png = await page.screenshot({ omitBackground: true, clip: { x: 0, y: 0, width: 256, height: 256 } });
  await browser.close();
  const header = Buffer.alloc(22);
  header.writeUInt16LE(0, 0); header.writeUInt16LE(1, 2); header.writeUInt16LE(1, 4);       // ICONDIR: 1 imagen
  header.writeUInt8(0, 6); header.writeUInt8(0, 7); header.writeUInt8(0, 8); header.writeUInt8(0, 9); // 256x256 => 0
  header.writeUInt16LE(1, 10); header.writeUInt16LE(32, 12);                                  // planos, bpp
  header.writeUInt32LE(png.length, 14); header.writeUInt32LE(22, 18);                         // tamano y offset
  fs.mkdirSync(path.join(__dirname, '..', 'build'), { recursive: true });
  fs.writeFileSync(path.join(__dirname, '..', 'build', 'icon.ico'), Buffer.concat([header, png]));
  console.log('build/icon.ico', header.length + png.length, 'bytes');
})();

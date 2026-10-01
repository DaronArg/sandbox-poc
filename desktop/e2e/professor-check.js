// Verifica professor.html (design §7.9) con Playwright sobre la sesion indicada (SESSION=<id>, default la ultima).
const { chromium } = require('@playwright/test');
const path = require('path');
const EV = path.resolve(process.env.EVIDENCE || '../openspec/changes/desktop-electron/qa-evidence');
(async () => {
  const sessions = await (await fetch('http://localhost:9090/api/sessions')).json();
  const id = Number(process.env.SESSION || sessions[0].id);
  const browser = await chromium.launch({ channel: 'msedge' });
  const page = await browser.newPage({ viewport: { width: 1300, height: 800 } });
  await page.goto('http://localhost:9090/professor.html');
  await page.locator(`#sessions tr[data-id="${id}"]`).click();
  await page.waitForFunction(() => document.getElementById('blocked').textContent !== '-');
  const away = await page.locator('#away').textContent();
  const exits = await page.locator('#exits').textContent();
  const blocked = await page.locator('#blocked').textContent();
  console.log(JSON.stringify({ session: id, away, exits, blocked }));
  const denied = await page.locator('#timeline tr.denied').count();
  const focus = await page.locator('#timeline tr.focus').count();
  console.log(JSON.stringify({ filasResaltadasDenied: denied, filasResaltadasFocus: focus }));
  if (!(Number(blocked) >= 4 && Number(exits) >= 1 && denied >= 4 && focus >= 2 && !away.startsWith('0 min 0 s'))) { console.error('FALLO: totales o resaltado incorrectos'); process.exit(1); }
  await page.screenshot({ path: `${EV}/e6-professor.png`, fullPage: true });
  await browser.close();
  console.log('professor OK');
})().catch((e) => { console.error(e.message); process.exit(1); });

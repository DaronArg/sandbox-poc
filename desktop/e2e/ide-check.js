// Verificacion de E4 (desarrollo): app real + CDP para manejar el IDE dentro de la vista.
const { spawn } = require('child_process');
const exe = require('electron');
const { sleep, findTarget, attach } = require('./cdp-lib');
const EV = process.env.EVIDENCE || '../openspec/changes/desktop-electron/qa-evidence';
(async () => {
  const child = spawn(exe, ['.', '--remote-debugging-port=9333'], { cwd: process.cwd(), env: { ...process.env, ASSESSMENT_DEV_AUTOSTART: '1,1' }, stdio: 'ignore' });
  try {
    const t = await findTarget(9333, (x) => x.url.includes('ide.localhost'));
    if (!t) throw new Error('no aparecio la vista del IDE');
    console.log('ide url:', t.url);
    const ide = await attach(t);
    await ide.waitFor(`!!document.querySelector('.monaco-workbench')`, 120000);
    console.log('workbench cargado');
    await ide.waitFor(`document.body.innerText.includes('pom.xml')`, 120000);
    console.log('el explorador muestra pom.xml (repo clonado)');
    await sleep(2000);
    await ide.screenshot(`${EV}/e4-ide-explorer.png`);
    await ide.key('`', { code: 'Backquote', vk: 192, modifiers: 2 });
    await ide.waitFor(`!!document.querySelector('.xterm')`, 30000);
    await sleep(4000);
    await ide.type('./mvnw test');
    await ide.enter();
    await sleep(100000);
    await ide.screenshot(`${EV}/e4-terminal-mvnw-test.png`);
    console.log('terminal: ./mvnw test enviado');
    ide.close();
  } finally { child.kill(); }
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });

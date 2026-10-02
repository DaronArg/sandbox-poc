// Cliente CDP minimo para manejar las vistas (WebContentsView) de la app, que Playwright no expone
// (viven en otra particion/contexto). Requiere la app lanzada con --remote-debugging-port (solo desarrollo/pruebas).
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function listTargets(port) {
  try { return await (await fetch(`http://127.0.0.1:${port}/json`)).json(); } catch { return []; }
}

async function findTarget(port, pred, timeoutMs = 120000) {
  const end = Date.now() + timeoutMs;
  while (Date.now() < end) {
    const t = (await listTargets(port)).find((x) => x.type === 'page' && pred(x));
    if (t) return t;
    await sleep(1000);
  }
  return null;
}

async function attach(target) {
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  let id = 0;
  const pending = new Map();
  ws.onmessage = (m) => {
    const msg = JSON.parse(m.data);
    if (msg.id && pending.has(msg.id)) { const { res, rej } = pending.get(msg.id); pending.delete(msg.id); msg.error ? rej(new Error(msg.error.message)) : res(msg.result); }
  };
  const send = (method, params = {}) => new Promise((res, rej) => { const i = ++id; pending.set(i, { res, rej }); ws.send(JSON.stringify({ id: i, method, params })); });
  const api = {
    send,
    close: () => ws.close(),
    async eval(expr) {
      const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
      if (r.exceptionDetails) throw new Error(r.exceptionDetails.text + ' ' + (r.exceptionDetails.exception?.description ?? ''));
      return r.result.value;
    },
    async screenshot(file) {
      const r = await send('Page.captureScreenshot', { format: 'png' });
      require('fs').writeFileSync(file, Buffer.from(r.data, 'base64'));
    },
    async key(key, opts = {}) {
      const base = { key, code: opts.code ?? '', windowsVirtualKeyCode: opts.vk ?? 0, modifiers: opts.modifiers ?? 0, text: opts.text };
      await send('Input.dispatchKeyEvent', { type: opts.text ? 'keyDown' : 'rawKeyDown', ...base });
      await send('Input.dispatchKeyEvent', { type: 'keyUp', ...base, text: undefined });
    },
    async type(text) { await send('Input.insertText', { text }); },
    async enter() { await api.key('Enter', { code: 'Enter', vk: 13, text: '\r' }); },
    async waitFor(expr, timeoutMs = 60000) {
      const end = Date.now() + timeoutMs;
      while (Date.now() < end) { if (await api.eval(expr).catch(() => false)) return true; await sleep(1000); }
      throw new Error('timeout esperando: ' + expr);
    },
    async click(x, y) {
      await send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 });
      await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 });
    },
  };
  await send('Page.enable');
  await send('Runtime.enable');
  return api;
}

module.exports = { sleep, listTargets, findTarget, attach };

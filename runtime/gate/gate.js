// Gate del contenedor: unica puerta de entrada desde el host.
//  :7000 (UI)  exige la cookie assessment_gate; enruta por Host: ide.localhost -> :8080, app.localhost -> :4200.
//  :9081 (API) rechaza navegadores (Sec-Fetch-* / Origin) y hace proxy a :8081 (Postman / curl).
// Corre como usuario `gate`: la clave vive en /run/gate/key (solo lectura para gate/root).
const http = require('http');
const fs = require('fs');
const crypto = require('crypto');
const httpProxy = require('http-proxy');

const KEY_FILE = '/run/gate/key';
const DENIED_LOG = '/var/log/gate/denied.log';
const COOKIE = 'assessment_gate';
const UI_PORT = 7000;
const API_PORT = 9081;
const RATE_MS = 30000;

const key = crypto.randomBytes(32).toString('hex');
fs.writeFileSync(KEY_FILE, key, { mode: 0o600 });
const keyBuf = Buffer.from(key);

const proxy = httpProxy.createProxyServer({ xfwd: true, changeOrigin: false });
proxy.on('error', (err, req, res) => {
  if (res && typeof res.writeHead === 'function' && !res.headersSent) upstreamDown(req, res);
  else if (res && typeof res.destroy === 'function') res.destroy();
});

// --- registro de intentos denegados (maximo una linea cada 30 s por puerto+host)
const lastLogged = new Map();
function logDenied(port, req) {
  const host = req.headers.host || '';
  const k = `${port}|${host}`;
  const now = Date.now();
  if (now - (lastLogged.get(k) || 0) < RATE_MS) return;
  lastLogged.set(k, now);
  const line = JSON.stringify({
    port, host, path: req.url, userAgent: req.headers['user-agent'] || '', timestamp: new Date(now).toISOString(),
  });
  try { fs.appendFileSync(DENIED_LOG, line + '\n'); } catch (e) { console.error('[gate] no pude escribir denied.log:', e.message); }
}

function parseCookies(header) {
  const out = {};
  for (const part of (header || '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = part.slice(i + 1).trim();
  }
  return out;
}

function validCookie(req) {
  const given = Buffer.from(parseCookies(req.headers.cookie)[COOKIE] || '');
  return given.length === keyBuf.length && crypto.timingSafeEqual(given, keyBuf);
}

function stripCookie(req) {
  if (!req.headers.cookie) return;
  const rest = req.headers.cookie.split(';').map((s) => s.trim()).filter((s) => !s.startsWith(COOKIE + '='));
  if (rest.length) req.headers.cookie = rest.join('; ');
  else delete req.headers.cookie;
}

function upstreamFor(req) {
  const host = (req.headers.host || '').split(':')[0].toLowerCase();
  if (host === 'ide.localhost') return 'http://127.0.0.1:8080';
  if (host === 'app.localhost') return 'http://127.0.0.1:4200';
  return null;
}

const FORBIDDEN_HTML = '<!doctype html><meta charset="utf-8"><title>Acceso denegado</title>'
  + '<body style="font-family:sans-serif;margin:3rem"><h1>Acceso denegado</h1>'
  + '<p>Este entorno solo se puede usar desde la aplicaci&oacute;n de escritorio Assessment.</p></body>';
const DOWN_HTML = '<!doctype html><meta charset="utf-8"><title>No disponible</title>'
  + '<body style="font-family:sans-serif;margin:3rem"><h1>La app no est&aacute; levantada</h1>'
  + '<p>Corr&eacute; <code>npm start</code> en la terminal del IDE.</p></body>';

function upstreamDown(req, res) {
  const api = req.socket.localPort === API_PORT;
  if (api) {
    res.writeHead(502, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ error: 'La API del alumno no esta levantada en el puerto 8081 del contenedor' }));
  } else {
    res.writeHead(502, { 'content-type': 'text/html; charset=utf-8' });
    res.end(DOWN_HTML);
  }
}

// --- UI :7000
function uiAllowed(req) { return validCookie(req); }

const ui = http.createServer((req, res) => {
  if (!uiAllowed(req)) {
    logDenied(UI_PORT, req);
    res.writeHead(403, { 'content-type': 'text/html; charset=utf-8' });
    return res.end(FORBIDDEN_HTML);
  }
  const target = upstreamFor(req);
  if (!target) { res.writeHead(404); return res.end('host desconocido'); }
  stripCookie(req);
  proxy.web(req, res, { target });
});
ui.on('upgrade', (req, socket, head) => {
  if (!uiAllowed(req)) {
    logDenied(UI_PORT, req);
    socket.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n');
    return;
  }
  const target = upstreamFor(req);
  if (!target) { socket.end('HTTP/1.1 404 Not Found\r\nConnection: close\r\n\r\n'); return; }
  stripCookie(req);
  proxy.ws(req, socket, head, { target });
});

// --- API :9081
function isBrowser(req) {
  return Object.keys(req.headers).some((h) => h.startsWith('sec-fetch-')) || req.headers.origin !== undefined;
}
const API_TARGET = 'http://127.0.0.1:8081';

const api = http.createServer((req, res) => {
  if (isBrowser(req)) {
    logDenied(API_PORT, req);
    res.writeHead(403, { 'content-type': 'application/json' });
    return res.end(JSON.stringify({ error: 'Solo Postman/curl: los navegadores no pueden acceder a este puerto' }));
  }
  proxy.web(req, res, { target: API_TARGET });
});
api.on('upgrade', (req, socket, head) => {
  if (isBrowser(req)) {
    logDenied(API_PORT, req);
    socket.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n');
    return;
  }
  proxy.ws(req, socket, head, { target: API_TARGET });
});

ui.listen(UI_PORT, '0.0.0.0', () => console.log(`[gate] UI en :${UI_PORT}`));
api.listen(API_PORT, '0.0.0.0', () => console.log(`[gate] API en :${API_PORT}`));

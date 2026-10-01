// Upstream git local (git smart HTTP via `git http-backend`) para probar el proxy sin GitHub.
// Uso (dentro de WSL): node scripts/local-git-upstream.js <root> [port]
//   <root>/<owner>/<repo>.git son repos bare; el backend lo usa con GIT_UPSTREAM_BASE=http://localhost:<port>.
const http = require('http');
const { spawn } = require('child_process');

const root = process.argv[2];
const port = Number(process.argv[3] || 9418);

http.createServer((req, res) => {
  const chunks = [];
  req.on('data', (c) => chunks.push(c));
  req.on('end', () => {
    const body = Buffer.concat(chunks);
    const [path, query = ''] = req.url.split('?');
    const env = {
      PATH: process.env.PATH,
      GIT_PROJECT_ROOT: root,
      GIT_HTTP_EXPORT_ALL: '1',
      REQUEST_METHOD: req.method,
      PATH_INFO: path,
      QUERY_STRING: query,
      CONTENT_TYPE: req.headers['content-type'] || '',
      CONTENT_LENGTH: String(body.length),
      REMOTE_USER: 'upstream',
      REMOTE_ADDR: '127.0.0.1',
    };
    if (req.headers['content-encoding']) env.HTTP_CONTENT_ENCODING = req.headers['content-encoding'];
    if (req.headers['git-protocol']) env.GIT_PROTOCOL = req.headers['git-protocol'];
    const cgi = spawn('git', ['http-backend'], { env });
    const out = [];
    cgi.stdout.on('data', (c) => out.push(c));
    cgi.stderr.on('data', (c) => process.stderr.write(c));
    cgi.stdin.on('error', () => {});
    cgi.stdin.end(body);
    cgi.on('close', () => {
      const raw = Buffer.concat(out);
      const sep = raw.indexOf('\r\n\r\n');
      const head = raw.subarray(0, sep).toString('utf8').split('\r\n');
      let status = 200;
      const headers = {};
      for (const line of head) {
        const i = line.indexOf(':');
        if (i < 0) continue;
        const k = line.slice(0, i).trim();
        const v = line.slice(i + 1).trim();
        if (k.toLowerCase() === 'status') status = parseInt(v, 10);
        else headers[k] = v;
      }
      res.writeHead(status, headers);
      res.end(raw.subarray(sep + 4));
    });
  });
}).listen(port, '127.0.0.1', () => console.log(`local git upstream en :${port} root=${root}`));

// Copia al out/ lo que tsc no emite: HTML y CSS del shell.
const fs = require('fs');
const path = require('path');
const src = path.join(__dirname, '..', 'src', 'renderer');
const dst = path.join(__dirname, '..', 'out', 'renderer');
fs.mkdirSync(dst, { recursive: true });
for (const f of fs.readdirSync(src)) {
  if (f.endsWith('.html') || f.endsWith('.css')) fs.copyFileSync(path.join(src, f), path.join(dst, f));
}

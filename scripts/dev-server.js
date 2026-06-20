import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '..');
const arg = process.argv[2] || '.';
const isDistMode = arg === 'dist';
const rootDir = path.resolve(projectRoot, arg);
const port = Number(process.env.PORT || 5173);

const mime = {
  '.html':'text/html; charset=utf-8', '.js':'text/javascript; charset=utf-8', '.css':'text/css; charset=utf-8',
  '.json':'application/json; charset=utf-8', '.png':'image/png', '.jpg':'image/jpeg', '.jpeg':'image/jpeg',
  '.webp':'image/webp', '.svg':'image/svg+xml', '.ico':'image/x-icon', '.mp3':'audio/mpeg', '.wav':'audio/wav', '.ogg':'audio/ogg'
};
const safe = (base, p) => { const r = path.resolve(base, p); return r.startsWith(base) ? r : null; };

function resolvePath(url) {
  let u = decodeURIComponent((url || '/').split('?')[0]);
  if (u === '/') u = 'index.html';
  else if (u === '/editor') u = 'editor.html';
  else u = u.replace(/^\/+/, '');

  if (!isDistMode && (u.startsWith('assets/') || u.startsWith('data/'))) {
    return safe(path.join(projectRoot, 'public'), u);
  }
  return safe(rootDir, u);
}

http.createServer((req, res) => {
  let f = resolvePath(req.url);
  if (!f) { res.writeHead(403); return res.end('403 Forbidden'); }
  if (fs.existsSync(f) && fs.statSync(f).isDirectory()) f = path.join(f, 'index.html');
  if (!fs.existsSync(f)) f = path.join(rootDir, 'index.html');
  fs.readFile(f, (e, b) => {
    if (e) { res.writeHead(404, {'Content-Type':'text/plain'}); res.end('404 Not Found'); return; }
    const ext = path.extname(f).toLowerCase();
    const noCache = !isDistMode && ['.html', '.js', '.css', '.json'].includes(ext);
    const cache = noCache ? 'no-cache, no-store, must-revalidate' : (ext === '.html' ? 'no-cache' : 'public, max-age=3600');
    res.writeHead(200, {'Content-Type': mime[ext] || 'application/octet-stream', 'Cache-Control': cache});
    res.end(b);
  });
}).listen(port, () => {
  console.log(`Plastic Hunter running at http://localhost:${port}`);
  console.log(`Editor: http://localhost:${port}/editor.html`);
  console.log(`Serving: ${rootDir}`);
});

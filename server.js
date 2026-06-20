import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = __dirname;
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

function allowSpaFallback(url) {
  const u = decodeURIComponent((url || '/').split('?')[0]);
  if (u === '/' || u === '/editor') return true;
  const bare = u.replace(/^\/+/, '');
  if (bare.startsWith('assets/') || bare.startsWith('data/') || bare.startsWith('src/')) return false;
  return !path.extname(bare);
}

http.createServer((req, res) => {
  let f = resolvePath(req.url);
  if (!f) { res.writeHead(403); return res.end('403 Forbidden'); }
  if (fs.existsSync(f) && fs.statSync(f).isDirectory()) f = path.join(f, 'index.html');
  if (!fs.existsSync(f)) {
    if (!allowSpaFallback(req.url)) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      return res.end('404 Not Found');
    }
    f = path.join(rootDir, 'index.html');
  }
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
  console.log('Giữ cửa sổ terminal này mở trong lúc chơi. Nhấn Ctrl+C để dừng server.');
}).on('error', err => {
  if (err.code === 'EADDRINUSE') {
    console.error(`\nPort ${port} đang được dùng — server có thể đã chạy sẵn.`);
    console.error(`Mở game tại: http://localhost:${port}`);
    console.error('Nếu không mở được, tắt process cũ rồi chạy lại npm run dev.\n');
    process.exit(0);
  }
  console.error(err);
  process.exit(1);
});

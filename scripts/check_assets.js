import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const checks = [
  ['public/assets/maps/map-clean.webp', 'Map sạch (map-clean.webp)'],
  ['public/assets/maps/map-with-trash.webp', 'Map có rác (map-with-trash.webp)'],
  ['public/assets/tiles/manifest.json', 'Tile manifest'],
  ['public/assets/tiles/clean/z0/0_0.webp', 'Tile mẫu (clean/z0/0_0.webp)'],
  ['public/assets/slices/manifest.json', 'Slice manifest']
];

const missing = checks.filter(([rel]) => !fs.existsSync(path.join(root, rel)));

if (missing.length) {
  console.error('\n[Thợ Săn Nhựa] Thiếu file bản đồ — game sẽ không tải được map.\n');
  for (const [, label] of missing) {
    console.error(`  ✗ ${label}`);
  }
  console.error('\nChạy lệnh sau để tạo tile + slice (cần Python 3 và Pillow):\n');
  console.error('  pip install Pillow');
  console.error('  npm run tiles\n');
  console.error('Sau đó: npm run dev\n');
  process.exit(1);
}

console.log('[Thợ Săn Nhựa] OK — asset bản đồ đã sẵn sàng.');
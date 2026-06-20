import { spawnSync } from 'node:child_process';

const py = process.platform === 'win32' ? 'python' : 'python3';
const extra = process.argv.slice(2);
const r = spawnSync(py, ['scripts/generate_tiles.py', ...extra], { stdio: 'inherit' });
process.exit(r.status ?? 1);
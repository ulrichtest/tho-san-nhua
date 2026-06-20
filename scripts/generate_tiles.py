from pathlib import Path
from PIL import Image
import json, shutil, math, sys

SLICES_ONLY = '--slices-only' in sys.argv

Image.MAX_IMAGE_PIXELS = None
ROOT = Path(__file__).resolve().parents[1]
MAP_DIR = ROOT / 'public' / 'assets' / 'maps'
DATA_DIR = ROOT / 'public' / 'data'
TILES_DIR = ROOT / 'public' / 'assets' / 'tiles'
SLICES_DIR = ROOT / 'public' / 'assets' / 'slices'

clean = MAP_DIR / 'map-clean.webp'
trash = MAP_DIR / 'map-with-trash.webp'
if not clean.exists():
    raise SystemExit(f'Missing {clean}. Copy your clean map to this path first.')
if not trash.exists():
    raise SystemExit(f'Missing {trash}. Copy your with-trash map to this path first.')

with Image.open(clean) as im_clean:
    cw, ch = im_clean.size
with Image.open(trash) as im_trash:
    tw, th = im_trash.size
if (cw, ch) != (tw, th):
    raise SystemExit(f'Map dimensions do not match: clean={cw}x{ch}, with-trash={tw}x{th}')

hotspots_path = DATA_DIR / 'hotspots.json'
if not hotspots_path.exists():
    raise SystemExit(f'Missing {hotspots_path}')
hotspots = json.loads(hotspots_path.read_text(encoding='utf-8')).get('hotspots', [])

tile_size = 512
max_zoom = max(0, math.ceil(math.log2(max(cw, ch) / 1024)))
levels = []

if not SLICES_ONLY:
    # 1) Tile pyramid for smooth zooming.
    levels = []
    shutil.rmtree(TILES_DIR, ignore_errors=True)

    sets = {
        'clean': clean,
        'withTrash': trash,
    }

    for z in range(max_zoom + 1):
        scale = 2 ** (z - max_zoom)
        lw = max(1, round(cw * scale))
        lh = max(1, round(ch * scale))
        cols = math.ceil(lw / tile_size)
        rows = math.ceil(lh / tile_size)
        levels.append({'z': z, 'scale': scale, 'width': lw, 'height': lh, 'cols': cols, 'rows': rows})

    for set_name, source_path in sets.items():
        with Image.open(source_path).convert('RGB') as src:
            for level in levels:
                z = level['z']
                lw, lh = level['width'], level['height']
                if (lw, lh) == (cw, ch):
                    lvl = src
                else:
                    lvl = src.resize((lw, lh), Image.Resampling.LANCZOS)
                out_dir = TILES_DIR / set_name / f'z{z}'
                out_dir.mkdir(parents=True, exist_ok=True)
                for ty in range(level['rows']):
                    for tx in range(level['cols']):
                        left = tx * tile_size
                        top = ty * tile_size
                        right = min(lw, left + tile_size)
                        bottom = min(lh, top + tile_size)
                        tile = lvl.crop((left, top, right, bottom))
                        tile.save(out_dir / f'{tx}_{ty}.webp', 'WEBP', quality=86, method=6)

    manifest = {
        'version': '4.0',
        'mode': 'tiled-clean-map-plus-sliced-trash',
        'width': cw,
        'height': ch,
        'tileSize': tile_size,
        'maxZoom': max_zoom,
        'levels': levels,
        'sets': {
            'clean': '/assets/tiles/clean/z{z}/{x}_{y}.webp',
            'withTrash': '/assets/tiles/withTrash/z{z}/{x}_{y}.webp'
        }
    }
    (TILES_DIR / 'manifest.json').write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding='utf-8')
else:
    manifest_path = TILES_DIR / 'manifest.json'
    if not manifest_path.exists():
        raise SystemExit(f'Missing {manifest_path}. Run "npm run tiles" first (full tile build).')
    manifest = json.loads(manifest_path.read_text(encoding='utf-8'))
    levels = manifest.get('levels', [])
    max_zoom = int(manifest.get('maxZoom', max_zoom))

# 2) Pixel-perfect hotspot slices cropped straight from full-res map-with-trash.webp.
shutil.rmtree(SLICES_DIR, ignore_errors=True)
SLICES_DIR.mkdir(parents=True, exist_ok=True)
slice_manifest = {'version': '4.0', 'width': cw, 'height': ch, 'items': {}}
count = 0
with Image.open(trash) as src:
    src_rgba = src.convert('RGBA')
    for h in hotspots:
        if h.get('type') not in ('trash', 'puzzle'):
            continue
        if h.get('type') == 'trash' and not h.get('trashId'):
            continue
        x = float(h.get('x', 0)); y = float(h.get('y', 0)); w = float(h.get('w', 0)); hh = float(h.get('h', 0))
        if w <= 0 or hh <= 0:
            continue
        left = max(0, int(round((x - w/2) * cw)))
        top = max(0, int(round((y - hh/2) * ch)))
        right = min(cw, int(round((x + w/2) * cw)))
        bottom = min(ch, int(round((y + hh/2) * ch)))
        if right <= left or bottom <= top:
            continue
        crop = src_rgba.crop((left, top, right, bottom))
        out = SLICES_DIR / f"{h['id']}.webp"
        crop.save(out, 'WEBP', lossless=True, method=6)
        slice_manifest['items'][h['id']] = {
            'src': f"/assets/slices/{h['id']}.webp",
            'x': (left + right) / 2 / cw,
            'y': (top + bottom) / 2 / ch,
            'w': (right - left) / cw,
            'h': (bottom - top) / ch,
            'px': {'left': left, 'top': top, 'right': right, 'bottom': bottom}
        }
        count += 1
(SLICES_DIR / 'manifest.json').write_text(json.dumps(slice_manifest, ensure_ascii=False, indent=2), encoding='utf-8')

(DATA_DIR / 'map.json').write_text(json.dumps({
    'version': '4.0',
    'mode': 'tiled-clean-map-plus-sliced-trash',
    'width': cw,
    'height': ch,
    'cleanTiles': '/assets/tiles/manifest.json',
    'sliceManifest': '/assets/slices/manifest.json',
    'clean': '/assets/maps/map-clean.webp',
    'withTrash': '/assets/maps/map-with-trash.webp'
}, ensure_ascii=False, indent=2), encoding='utf-8')

print(f'OK maps: {cw}x{ch}')
if SLICES_ONLY:
    print('Mode: slices-only (tiles unchanged)')
else:
    print(f'Generated tile pyramid: {len(levels)} levels, z0..z{max_zoom}')
print(f'Generated {count} lossless hotspot slices from map-with-trash.webp in {SLICES_DIR}')
print('Next: npm run build && npm run dev')

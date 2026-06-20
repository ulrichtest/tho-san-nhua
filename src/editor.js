import { TileMap } from './tilemap.js';

const app = document.getElementById('editorApp');
const esc = s => String(s ?? '').replace(/[&<>\"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '\"': '&quot;' }[c] || c));

let map, data, sliceManifest = { items: {} };
let factPropPresets = [];
let selected = null;
let mode = 'select';
let createKind = 'trash';
let factEditTarget = 'hit';
let showFactZones = true;
let showFactProps = true;
let viewMode = 'compare';
let overlayOpacity = 0.45;
let drawStart = null;
let drawEl = null;
let livePreviewUrls = new Map();
let previewJob = 0;
const trashTileCache = new Map();
const RESIZE_HANDLES = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'];

async function load() {
  const [items, hotspots, facts, manifest, factProps] = await Promise.all([
    fetch('/data/trash-items.json').then(r => r.json()),
    fetch('/data/hotspots.json').then(r => r.json()),
    fetch('/data/facts.json').then(r => r.json()),
    fetch('/assets/slices/manifest.json', { cache: 'no-cache' }).then(r => r.ok ? r.json() : { items: {} }).catch(() => ({ items: {} })),
    fetch('/data/fact-props.json').then(r => r.ok ? r.json() : { props: [] }).catch(() => ({ props: [] }))
  ]);
  sliceManifest = manifest;
  factPropPresets = factProps.props || [];
  data = {
    items: items.items,
    itemsById: Object.fromEntries(items.items.map(i => [i.id, i])),
    hotspots: hotspots.hotspots,
    facts: facts.facts
  };
  render();
}

function render() {
  app.innerHTML = `<div class="editor-shell">
    <div class="editor-map-wrap"><div id="editorMap" class="map-root"></div></div>
    <aside class="editor-panel">
      <h1>Hotspot &amp; Slice Editor</h1>
      <p><b>Rác/puzzle:</b> cắt từ map có rác đè lên map sạch. <b>Fact:</b> chỉnh <b>vùng click</b>; ảnh riêng (prop) đặt thủ công — không có trên map rác.</p>
      <div class="editor-view-modes">
        <label><input type="radio" name="viewMode" value="overlay" ${viewMode === 'overlay' ? 'checked' : ''}> Overlay map rác</label>
        <label><input type="radio" name="viewMode" value="preview" ${viewMode === 'preview' ? 'checked' : ''}> Preview slice</label>
        <label><input type="radio" name="viewMode" value="compare" ${viewMode === 'compare' ? 'checked' : ''}> So sánh cả hai</label>
      </div>
      <div class="editor-controls">
        <button id="createBtn">＋ Tạo hotspot rác</button>
        <button id="createFactBtn">＋ Tạo vùng click fact</button>
        <button id="selectBtn">Chọn / kéo map</button>
        <button id="centerBtn">Căn giữa</button>
        <button id="refreshPreviewBtn">Cập nhật preview</button>
        <button id="downloadBtn">Download JSON</button>
        <button id="copyBtn">Copy JSON</button>
        <a href="/" target="_blank">Về game</a>
      </div>
      <div class="editor-overlay-slider">
        <label><input id="overlayOn" type="checkbox" ${viewMode !== 'preview' ? 'checked' : ''}> Hiện map có rác</label>
        <label><input id="showFactZones" type="checkbox" ${showFactZones ? 'checked' : ''}> Hiện vùng click fact</label>
        <label><input id="showFactProps" type="checkbox" ${showFactProps ? 'checked' : ''}> Hiện ảnh prop fact</label>
        <input id="opacity" type="range" min="0" max="1" step="0.05" value="${overlayOpacity}">
      </div>
      <hr>
      <div id="formPanel"></div>
      <h3>Danh sách hotspot</h3>
      <input id="searchHotspot" placeholder="Tìm id/tên rác">
      <div id="hotspotList" class="hotspot-list"></div>
    </aside>
  </div>`;

  map = new TileMap(document.getElementById('editorMap'), {
    setName: 'clean',
    lockPanAtMin: false,
    onClickMap: pt => selectHit(pt.nx, pt.ny),
    onTransform: renderMapObjects
  });

  map.load().then(() => {
    map.overlayLayer = map.addTileOverlay('withTrash', overlayOpacity);
    updateOverlay();
    renderMapObjects();
    renderList();
    renderForm();
  });

  app.querySelectorAll('input[name="viewMode"]').forEach(r => {
    r.onchange = () => {
      viewMode = r.value;
      updateOverlay();
      renderMapObjects();
    };
  });

  document.getElementById('createBtn').onclick = () => {
    mode = 'create';
    createKind = 'trash';
    toastEditor('Kéo chuột trên map để vẽ vùng cắt rác (slice).');
  };
  document.getElementById('createFactBtn').onclick = () => {
    mode = 'create';
    createKind = 'fact';
    toastEditor('Kéo chuột trên map để vẽ vùng click fact (không có ảnh, chỉ vùng bấm).');
  };
  document.getElementById('showFactZones').onchange = e => {
    showFactZones = e.target.checked;
    renderMapObjects();
  };
  document.getElementById('showFactProps').onchange = e => {
    showFactProps = e.target.checked;
    renderMapObjects();
  };
  document.getElementById('selectBtn').onclick = () => {
    mode = 'select';
    toastEditor('Kéo map để di chuyển. Kéo vùng/slice để chỉnh vị trí. Kéo chấm đỏ ở góc/cạnh để đổi kích thước.');
  };
  document.getElementById('centerBtn').onclick = () => map.fit(false);
  document.getElementById('refreshPreviewBtn').onclick = () => refreshSelectedPreview(true);
  document.getElementById('downloadBtn').onclick = downloadJson;
  document.getElementById('copyBtn').onclick = () => navigator.clipboard.writeText(exportJson()).then(() => toastEditor('Đã copy JSON.'));
  document.getElementById('opacity').oninput = e => {
    overlayOpacity = Number(e.target.value);
    updateOverlay();
  };
  document.getElementById('overlayOn').onchange = updateOverlay;
  document.getElementById('searchHotspot').oninput = renderList;
  installDrawing();
  installKeyboardNudge();
}

function isSliceType(h) {
  return h && (h.type === 'trash' || h.type === 'puzzle') && (h.type !== 'trash' || h.trashId);
}

function isClickZoneType(h) {
  return h?.type === 'fact';
}

function hasFactProp(h) {
  return isClickZoneType(h) && !!h.propImage;
}

function factPropRectPx(h) {
  const w = Math.max(12, (h.propW ?? h.w) * map.mapWidth);
  const hPx = Math.max(12, (h.propH ?? h.h) * map.mapHeight);
  const cx = (h.propX ?? h.x) * map.mapWidth;
  const cy = (h.propY ?? h.y) * map.mapHeight;
  return {
    cx, cy, w, h: hPx,
    left: cx - w / 2,
    top: cy - hPx / 2
  };
}

function applyPropRectPx(h, left, top, width, height) {
  h.propX = +((left + width / 2) / map.mapWidth).toFixed(5);
  h.propY = +((top + height / 2) / map.mapHeight).toFixed(5);
  h.propW = +(width / map.mapWidth).toFixed(5);
  h.propH = +(height / map.mapHeight).toFixed(5);
}

function applyPropRectPxSnapped(h, left, top, width, height, fine = false) {
  applyPropRectPx(
    h,
    snapMapPx(left, fine),
    snapMapPx(top, fine),
    Math.max(12, snapMapPx(width, fine)),
    Math.max(12, snapMapPx(height, fine))
  );
}

function initFactPropFromHit(h, src) {
  h.propImage = src;
  h.propX = h.x;
  h.propY = h.y;
  h.propW = h.w;
  h.propH = h.h;
}

function updateOverlay() {
  if (!map?.overlayLayer) return;
  const onEl = document.getElementById('overlayOn');
  const show = viewMode !== 'preview' && (onEl?.checked ?? true);
  const opacity = document.getElementById('opacity')?.value ?? overlayOpacity;
  map.setOverlayVisible(map.overlayLayer, show);
  map.setOverlayOpacity(map.overlayLayer, opacity);
}

function hotspotRectPx(h) {
  const w = Math.max(12, h.w * map.mapWidth);
  const hPx = Math.max(12, h.h * map.mapHeight);
  const cx = h.x * map.mapWidth;
  const cy = h.y * map.mapHeight;
  return {
    cx, cy, w, h: hPx,
    left: cx - w / 2,
    top: cy - hPx / 2
  };
}

function applyRectPx(h, left, top, width, height) {
  h.x = +((left + width / 2) / map.mapWidth).toFixed(5);
  h.y = +((top + height / 2) / map.mapHeight).toFixed(5);
  h.w = +(width / map.mapWidth).toFixed(5);
  h.h = +(height / map.mapHeight).toFixed(5);
}

function snapMapPx(v, fine = false) {
  return fine ? Math.round(v * 4) / 4 : Math.round(v);
}

function applyRectPxSnapped(h, left, top, width, height, fine = false) {
  applyRectPx(
    h,
    snapMapPx(left, fine),
    snapMapPx(top, fine),
    Math.max(12, snapMapPx(width, fine)),
    Math.max(12, snapMapPx(height, fine))
  );
}

function mapPointerDelta(edit, ev) {
  const cur = map.screenToMap(ev.clientX, ev.clientY);
  const start = map.screenToMap(edit.startX, edit.startY);
  return { dx: cur.x - start.x, dy: cur.y - start.y };
}

function handleSizeMap() {
  return Math.max(10, 18 / map.scale);
}

function focusHotspot(h, zoomMul = 3) {
  if (!map || !h) return;
  const target = Math.min(map.maxScale, Math.max(map.scale, map.minScale * zoomMul));
  map.focus(h.x * map.mapWidth, h.y * map.mapHeight, target);
}

function savedSliceSrc(h) {
  return sliceManifest.items?.[h.id]?.src || `/assets/slices/${encodeURIComponent(h.id)}.webp`;
}

async function loadTrashTile(z, tx, ty) {
  const key = `${z}/${tx}/${ty}`;
  if (trashTileCache.has(key)) return trashTileCache.get(key);
  const url = `/assets/tiles/withTrash/z${z}/${tx}_${ty}.webp`;
  const img = new Image();
  const promise = new Promise((resolve, reject) => {
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`Khong load tile ${url}`));
  });
  img.src = url;
  trashTileCache.set(key, promise);
  return promise;
}

async function cropHotspotFromTrash(h) {
  const cw = map.mapWidth;
  const ch = map.mapHeight;
  const left = Math.max(0, Math.round((h.x - h.w / 2) * cw));
  const top = Math.max(0, Math.round((h.y - h.h / 2) * ch));
  const right = Math.min(cw, Math.round((h.x + h.w / 2) * cw));
  const bottom = Math.min(ch, Math.round((h.y + h.h / 2) * ch));
  if (right <= left || bottom <= top) return null;

  const cropW = right - left;
  const cropH = bottom - top;
  const level = map.levels[map.levels.length - 1];
  const z = level.z;
  const t = map.tileSize;
  const tx0 = Math.max(0, Math.floor(left / t));
  const ty0 = Math.max(0, Math.floor(top / t));
  const tx1 = Math.min(level.cols - 1, Math.floor((right - 1) / t));
  const ty1 = Math.min(level.rows - 1, Math.floor((bottom - 1) / t));

  const canvas = document.createElement('canvas');
  canvas.width = cropW;
  canvas.height = cropH;
  const ctx = canvas.getContext('2d');

  for (let ty = ty0; ty <= ty1; ty++) {
    for (let tx = tx0; tx <= tx1; tx++) {
      const img = await loadTrashTile(z, tx, ty);
      const tileLeft = tx * t;
      const tileTop = ty * t;
      const srcLeft = Math.max(left, tileLeft);
      const srcTop = Math.max(top, tileTop);
      const srcRight = Math.min(right, tileLeft + t);
      const srcBottom = Math.min(bottom, tileTop + t);
      const sw = srcRight - srcLeft;
      const sh = srcBottom - srcTop;
      ctx.drawImage(
        img,
        srcLeft - tileLeft, srcTop - tileTop, sw, sh,
        srcLeft - left, srcTop - top, sw, sh
      );
    }
  }

  return new Promise(resolve => {
    canvas.toBlob(blob => {
      if (!blob) return resolve(null);
      resolve(URL.createObjectURL(blob));
    }, 'image/webp', 0.92);
  });
}

function revokeLivePreview(id) {
  const old = livePreviewUrls.get(id);
  if (old) URL.revokeObjectURL(old);
  livePreviewUrls.delete(id);
}

async function refreshSelectedPreview(forceToast = false) {
  const h = getSel();
  if (!h || !isSliceType(h)) {
    if (forceToast) toastEditor('Chọn hotspot trash/puzzle để xem preview crop.');
    return;
  }
  const job = ++previewJob;
  try {
    const url = await cropHotspotFromTrash(h);
    if (job !== previewJob) {
      if (url) URL.revokeObjectURL(url);
      return;
    }
    revokeLivePreview(h.id);
    if (url) livePreviewUrls.set(h.id, url);
    renderMapObjects();
    syncFormFields(h);
    if (forceToast) toastEditor('Đã cập nhật preview crop.');
  } catch (err) {
    console.error(err);
    if (forceToast) toastEditor('Lỗi preview crop: ' + err.message);
  }
}

let previewTimer = 0;
function schedulePreviewRefresh() {
  clearTimeout(previewTimer);
  previewTimer = setTimeout(() => refreshSelectedPreview(false), 280);
}

function updateHotspotVisual(h) {
  if (!map || !h) return;
  const hit = hotspotRectPx(h);
  const hitPos = { left: hit.cx + 'px', top: hit.cy + 'px', width: hit.w + 'px', height: hit.h + 'px' };
  map.objectLayer.querySelectorAll(`.editor-hotspot[data-id="${h.id}"], .editor-slice-preview[data-id="${h.id}"], .resize-handle-wrap[data-kind="hit"][data-id="${h.id}"]`).forEach(el => {
    Object.assign(el.style, hitPos);
  });
  if (hasFactProp(h)) {
    const prop = factPropRectPx(h);
    const propPos = { left: prop.cx + 'px', top: prop.cy + 'px', width: prop.w + 'px', height: prop.h + 'px' };
    map.objectLayer.querySelectorAll(`.editor-fact-prop[data-id="${h.id}"], .resize-handle-wrap[data-kind="prop"][data-id="${h.id}"]`).forEach(el => {
      Object.assign(el.style, propPos);
    });
  }
}

const HANDLE_CURSORS = {
  nw: 'nwse-resize', ne: 'nesw-resize', se: 'nwse-resize', sw: 'nesw-resize',
  n: 'ns-resize', s: 'ns-resize', e: 'ew-resize', w: 'ew-resize'
};

function appendResizeHandles(h, r, kind = 'hit') {
  const wrap = document.createElement('div');
  wrap.className = `resize-handle-wrap resize-handle-wrap--${kind}`;
  wrap.dataset.id = h.id;
  wrap.dataset.kind = kind;
  wrap.setAttribute('data-id', h.id);
  wrap.setAttribute('data-kind', kind);
  wrap.style.left = r.cx + 'px';
  wrap.style.top = r.cy + 'px';
  wrap.style.width = r.w + 'px';
  wrap.style.height = r.h + 'px';
  wrap.style.setProperty('--editor-handle', handleSizeMap() + 'px');
  wrap.innerHTML = '<span class="editor-crosshair-h" aria-hidden="true"></span><span class="editor-crosshair-v" aria-hidden="true"></span>';
  for (const handle of RESIZE_HANDLES) {
    const handleEl = document.createElement('span');
    handleEl.className = `resize-handle resize-${handle}`;
    handleEl.dataset.handle = handle;
    handleEl.onpointerdown = e => startHotspotEdit(e, h, wrap, handle, kind);
    wrap.appendChild(handleEl);
  }
  map.objectLayer.appendChild(wrap);
}

function renderMapObjects() {
  if (!map) return;
  map.objectLayer.querySelectorAll('.editor-hotspot, .editor-slice-preview, .editor-fact-prop, .resize-handle-wrap').forEach(e => e.remove());

  const showBoxes = viewMode === 'overlay' || viewMode === 'compare';
  const showSlices = viewMode === 'preview' || viewMode === 'compare';

  for (const h of data.hotspots) {
    const r = hotspotRectPx(h);
    const showSlice = showSlices && isSliceType(h);

    if (showSlice) {
      const src = (selected === h.id && livePreviewUrls.has(h.id))
        ? livePreviewUrls.get(h.id)
        : `${savedSliceSrc(h)}?t=${encodeURIComponent(`${h.x}_${h.y}_${h.w}_${h.h}`)}`;
      const el = document.createElement('div');
      el.className = `editor-slice-preview ${selected === h.id ? 'selected' : ''} ${livePreviewUrls.has(h.id) && selected === h.id ? 'live' : ''}`;
      el.dataset.id = h.id;
      el.setAttribute('data-id', h.id);
      el.style.left = r.cx + 'px';
      el.style.top = r.cy + 'px';
      el.style.width = r.w + 'px';
      el.style.height = r.h + 'px';
      el.innerHTML = `<img src="${src}" alt="" draggable="false" />`;
      el.onpointerdown = e => startHotspotEdit(e, h, el, null, 'hit');
      el.onclick = e => { e.stopPropagation(); selected = h.id; factEditTarget = 'hit'; focusHotspot(h); renderAll(); };
      map.objectLayer.appendChild(el);
    }

    if (showFactProps && hasFactProp(h)) {
      const pr = factPropRectPx(h);
      const propEl = document.createElement('div');
      propEl.className = `editor-fact-prop ${selected === h.id && factEditTarget === 'prop' ? 'selected' : ''}`;
      propEl.dataset.id = h.id;
      propEl.setAttribute('data-id', h.id);
      propEl.style.left = pr.cx + 'px';
      propEl.style.top = pr.cy + 'px';
      propEl.style.width = pr.w + 'px';
      propEl.style.height = pr.h + 'px';
      propEl.innerHTML = `<img src="${esc(h.propImage)}" alt="" draggable="false" />`;
      propEl.title = `Ảnh prop — ${h.reviewNote || h.id}`;
      propEl.onpointerdown = e => startHotspotEdit(e, h, propEl, null, 'prop');
      propEl.onclick = e => { e.stopPropagation(); selected = h.id; factEditTarget = 'prop'; focusHotspot(h); renderAll(); };
      map.objectLayer.appendChild(propEl);
    }

    const showHitBox = (showBoxes && !showSlice)
      || (showFactZones && isClickZoneType(h))
      || (selected === h.id && !showSlice && factEditTarget === 'hit');
    if (showHitBox) {
      const el = document.createElement('div');
      el.setAttribute('role', 'button');
      el.tabIndex = 0;
      el.className = `editor-hotspot ${h.type || 'trash'} ${selected === h.id && factEditTarget === 'hit' ? 'selected' : ''}`;
      el.dataset.id = h.id;
      el.setAttribute('data-id', h.id);
      el.style.left = r.cx + 'px';
      el.style.top = r.cy + 'px';
      el.style.width = r.w + 'px';
      el.style.height = r.h + 'px';
      if (isClickZoneType(h)) {
        const label = hasFactProp(h) ? 'Vùng click' : (h.reviewNote || h.id);
        el.innerHTML = `<span class="editor-fact-label">${esc(label)}</span>`;
        el.title = `${h.id} — vùng click`;
      } else {
        el.title = h.id;
      }
      el.onpointerdown = e => startHotspotEdit(e, h, el, null, 'hit');
      el.onclick = e => { e.stopPropagation(); selected = h.id; factEditTarget = 'hit'; focusHotspot(h); renderAll(); };
      map.objectLayer.appendChild(el);
    }

    if (selected === h.id) {
      if (factEditTarget === 'prop' && hasFactProp(h)) {
        appendResizeHandles(h, factPropRectPx(h), 'prop');
      } else {
        appendResizeHandles(h, r, 'hit');
      }
    }
  }
}

function startHotspotEdit(e, h, el, handle = null, editKind = 'hit') {
  if (mode === 'create') return;
  e.stopPropagation();
  e.stopImmediatePropagation();
  e.preventDefault();
  selected = h.id;
  factEditTarget = editKind;
  const target = e.currentTarget;
  target.setPointerCapture(e.pointerId);
  map.root.style.cursor = handle ? (HANDLE_CURSORS[handle] || 'default') : 'grabbing';

  const r = editKind === 'prop' ? factPropRectPx(h) : hotspotRectPx(h);
  const edit = {
    pointerId: e.pointerId,
    kind: editKind,
    handle: handle || (e.target.closest('.resize-handle')?.dataset.handle ?? null),
    startX: e.clientX,
    startY: e.clientY,
    left: r.left,
    top: r.top,
    width: r.w,
    height: r.h
  };

  const onMove = ev => {
    if (ev.pointerId !== edit.pointerId) return;
    const { dx, dy } = mapPointerDelta(edit, ev);
    const fine = ev.altKey;
    let left = edit.left;
    let top = edit.top;
    let width = edit.width;
    let height = edit.height;

    if (!edit.handle) {
      left = edit.left + dx;
      top = edit.top + dy;
    } else {
      const handle = edit.handle;
      if (handle.includes('e')) width = Math.max(12, edit.width + dx);
      if (handle.includes('w')) {
        width = Math.max(12, edit.width - dx);
        left = edit.left + (edit.width - width);
      }
      if (handle.includes('s')) height = Math.max(12, edit.height + dy);
      if (handle.includes('n')) {
        height = Math.max(12, edit.height - dy);
        top = edit.top + (edit.height - height);
      }
    }

    if (edit.kind === 'prop') applyPropRectPxSnapped(h, left, top, width, height, fine);
    else applyRectPxSnapped(h, left, top, width, height, fine);
    updateHotspotVisual(h);
    syncFormFields(h);
  };

  const onUp = ev => {
    if (ev.pointerId !== edit.pointerId) return;
    target.releasePointerCapture(ev.pointerId);
    map.root.style.cursor = '';
    target.removeEventListener('pointermove', onMove);
    target.removeEventListener('pointerup', onUp);
    target.removeEventListener('pointercancel', onUp);
    if (edit.kind === 'prop') {
      const final = factPropRectPx(h);
      applyPropRectPxSnapped(h, final.left, final.top, final.w, final.h, false);
    } else {
      const final = hotspotRectPx(h);
      applyRectPxSnapped(h, final.left, final.top, final.w, final.h, false);
    }
    renderMapObjects();
    renderForm();
    renderList();
    if (isSliceType(h)) schedulePreviewRefresh();
  };

  target.addEventListener('pointermove', onMove);
  target.addEventListener('pointerup', onUp);
  target.addEventListener('pointercancel', onUp);
}

function syncFormFields(h) {
  const set = (id, val) => { const el = document.getElementById(id); if (el) el.value = val; };
  set('x', h.x);
  set('y', h.y);
  set('w', h.w);
  set('h', h.h);
  if (hasFactProp(h)) {
    set('propX', h.propX);
    set('propY', h.propY);
    set('propW', h.propW);
    set('propH', h.propH);
    set('propImage', h.propImage);
  }
}

function installDrawing() {
  const root = document.getElementById('editorMap');
  root.addEventListener('pointerdown', e => {
    if (mode !== 'create') return;
    e.preventDefault();
    e.stopImmediatePropagation();
    root.setPointerCapture(e.pointerId);
    drawStart = map.screenToMap(e.clientX, e.clientY);
    drawEl = document.createElement('div');
    const drawClass = createKind === 'factProp' ? 'draw-rect draw-rect-prop'
      : createKind === 'fact' ? 'draw-rect draw-rect-fact' : 'draw-rect';
    drawEl.className = drawClass;
    map.objectLayer.appendChild(drawEl);
  }, true);

  root.addEventListener('pointermove', e => {
    if (mode === 'create') { e.preventDefault(); e.stopImmediatePropagation(); }
    if (!drawStart || !drawEl) return;
    const p = map.screenToMap(e.clientX, e.clientY);
    const left = Math.min(drawStart.x, p.x);
    const top = Math.min(drawStart.y, p.y);
    const width = Math.abs(p.x - drawStart.x);
    const height = Math.abs(p.y - drawStart.y);
    Object.assign(drawEl.style, { left: left + 'px', top: top + 'px', width: width + 'px', height: height + 'px' });
  }, true);

  root.addEventListener('pointerup', e => {
    if (mode === 'create') { e.preventDefault(); e.stopImmediatePropagation(); }
    if (!drawStart || !drawEl) return;
    const p = map.screenToMap(e.clientX, e.clientY);
    const left = Math.min(drawStart.x, p.x);
    const top = Math.min(drawStart.y, p.y);
    const width = Math.abs(p.x - drawStart.x);
    const height = Math.abs(p.y - drawStart.y);
    drawEl.remove();
    drawEl = null;
    drawStart = null;
    if (width > 8 && height > 8) {
      if (createKind === 'factProp') {
        const h = getSel();
        const src = document.getElementById('propImage')?.value?.trim();
        if (!h || h.type !== 'fact') {
          toastEditor('Chọn hotspot fact trước khi đặt ảnh prop.');
        } else if (!src) {
          toastEditor('Chọn ảnh prop trong form (preset hoặc đường dẫn).');
        } else {
          h.propImage = src;
          applyPropRectPx(h, left, top, width, height);
          factEditTarget = 'prop';
          mode = 'select';
          renderAll();
          toastEditor('Đã đặt ảnh prop lên map.');
        }
        return;
      }
      const isFact = createKind === 'fact';
      const hs = {
        id: nextId(),
        type: isFact ? 'fact' : 'trash',
        x: +((left + width / 2) / map.mapWidth).toFixed(5),
        y: +((top + height / 2) / map.mapHeight).toFixed(5),
        w: +(width / map.mapWidth).toFixed(5),
        h: +(height / map.mapHeight).toFixed(5),
        anchor: 'center',
        trashId: isFact ? null : (data.items[0]?.id || null),
        pieceId: null,
        factId: null,
        source: isFact ? 'manual_fact_hotspot_on_clean_map' : 'manual_editor',
        reviewNote: isFact ? 'Vùng click fact mới' : ''
      };
      data.hotspots.push(hs);
      selected = hs.id;
      factEditTarget = 'hit';
      mode = 'select';
      renderAll();
      if (!isFact) schedulePreviewRefresh();
      toastEditor(isFact ? 'Đã tạo vùng click fact.' : 'Đã tạo hotspot rác mới.');
    }
  }, true);
}

function installKeyboardNudge() {
  window.addEventListener('keydown', e => {
    const h = getSel();
    if (!h || !['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.key)) return;
    if (e.target.matches('input, textarea, select')) return;
    e.preventDefault();
    const step = e.shiftKey ? 5 : 1;
    const dx = e.key === 'ArrowLeft' ? -step : e.key === 'ArrowRight' ? step : 0;
    const dy = e.key === 'ArrowUp' ? -step : e.key === 'ArrowDown' ? step : 0;
    nudgeHotspot(h, dx, dy, 0, 0);
  });
}

function nudgeHotspot(h, dxPx, dyPx, dwPx, dhPx) {
  if (factEditTarget === 'prop' && hasFactProp(h)) {
    const r = factPropRectPx(h);
    applyPropRectPxSnapped(h, r.left + dxPx, r.top + dyPx, Math.max(12, r.w + dwPx), Math.max(12, r.h + dhPx), false);
  } else {
    const r = hotspotRectPx(h);
    applyRectPxSnapped(h, r.left + dxPx, r.top + dyPx, Math.max(12, r.w + dwPx), Math.max(12, r.h + dhPx), false);
  }
  updateHotspotVisual(h);
  syncFormFields(h);
  if (isSliceType(h)) schedulePreviewRefresh();
}

function nextId() {
  let max = 0;
  for (const h of data.hotspots) {
    const n = Number(String(h.id).replace(/\D/g, ''));
    if (n > max) max = n;
  }
  return 'hotspot_' + String(max + 1).padStart(3, '0');
}

function getSel() { return data.hotspots.find(h => h.id === selected); }

function selectHit(nx, ny) {
  const h = [...data.hotspots].reverse().find(h =>
    nx >= h.x - h.w / 2 && nx <= h.x + h.w / 2 &&
    ny >= h.y - h.h / 2 && ny <= h.y + h.h / 2
  );
  if (h) {
    selected = h.id;
    focusHotspot(h);
    renderAll();
    if (isSliceType(h)) schedulePreviewRefresh();
  }
}

function renderList() {
  const q = (document.getElementById('searchHotspot')?.value || '').toLowerCase();
  const list = document.getElementById('hotspotList');
  if (!list) return;
  list.innerHTML = data.hotspots
    .filter(h => {
      const it = data.itemsById[h.trashId];
      const note = h.reviewNote || '';
      return !q || h.id.toLowerCase().includes(q) || (it?.name || '').toLowerCase().includes(q) || note.toLowerCase().includes(q);
    })
    .map(h => {
      const label = h.type === 'fact'
        ? (h.reviewNote || 'vùng click')
        : (data.itemsById[h.trashId]?.name || h.pieceId || h.factId || '');
      return `<button data-id="${h.id}" class="${selected === h.id ? 'selected' : ''}">${h.id} • ${h.type} • ${esc(label)}</button>`;
    })
    .join('');
  list.querySelectorAll('button').forEach(b => {
    b.onclick = () => {
      selected = b.dataset.id;
      const h = getSel();
      if (h) focusHotspot(h);
      renderAll();
      if (h && isSliceType(h)) schedulePreviewRefresh();
    };
  });
}

function pxStepLabel() {
  if (!map) return '1px';
  return `1px (~${(100 / map.mapWidth).toFixed(4)}% x)`;
}

function renderForm() {
  const p = document.getElementById('formPanel');
  if (!p) return;
  const h = getSel();
  if (!h) {
    p.innerHTML = '<p>Chọn hotspot rác để chỉnh slice từ map có rác, hoặc hotspot <b>fact</b> để chỉnh <b>vùng click</b> và/hoặc <b>ảnh prop</b> đặt thủ công lên map sạch.</p>';
    return;
  }

  const isFact = isClickZoneType(h);
  const isSlice = isSliceType(h);
  const hasProp = hasFactProp(h);
  const propPresets = factPropPresets.map(pr => `<option value="${esc(pr.src)}" data-id="${esc(pr.id)}">${esc(pr.label)}</option>`).join('');
  const itemName = esc(data.itemsById[h.trashId]?.name || '');
  p.innerHTML = `<h2>${esc(h.id)}</h2>
    ${isFact ? '<p class="field-hint fact-zone-hint"><b>Fact</b> — <span class="fact-edit-hit">khung xanh</span> = vùng click; <span class="fact-edit-prop">ảnh prop</span> = vật thể đặt thủ công (không cắt từ map rác).</p>' : ''}
    ${itemName ? `<p class="field-hint"><b>Rác:</b> ${itemName}</p>` : ''}
    <div class="field-row"><label>Type</label><select id="type"><option>trash</option><option>puzzle</option><option>fact</option><option>disabled</option></select></div>
    <div class="field-row slice-only"><label>Trash item</label><select id="trashId"><option value="">-</option>${data.items.map(i => `<option value="${i.id}">${esc(i.name)} — ${esc(i.bin)}</option>`).join('')}</select></div>
    <div class="field-row slice-only"><label>Piece ID</label><select id="pieceId"><option value="">-</option><option>piece_01</option><option>piece_02</option><option>piece_03</option><option>piece_04</option></select></div>
    <div class="field-row fact-only"><label>Fact ID</label><select id="factId"><option value="">-</option>${data.facts.map((f, i) => `<option value="fact_${String(i + 1).padStart(2, '0')}">${esc(f.title)}</option>`).join('')}</select></div>
    <div class="field-row"><label>${isFact ? 'x (tâm vùng click)' : 'x'}</label><input id="x" value="${h.x}"></div>
    <div class="field-row"><label>${isFact ? 'y (tâm vùng click)' : 'y'}</label><input id="y" value="${h.y}"></div>
    <div class="field-row"><label>${isFact ? 'w (rộng vùng click)' : 'w'}</label><input id="w" value="${h.w}"></div>
    <div class="field-row"><label>${isFact ? 'h (cao vùng click)' : 'h'}</label><input id="h" value="${h.h}"></div>
    <p class="field-hint">Scroll chuột để zoom vào vùng cần chỉnh. Kéo chấm đỏ góc/cạnh để đổi kích thước. Bước: ${pxStepLabel()}, Shift+mũi tên = 5px. Giữ Alt khi kéo = chỉnh mịn (không snap pixel).</p>
    <p class="field-hint editor-px-readout">Vùng click: ${Math.round(h.w * map.mapWidth)}×${Math.round(h.h * map.mapHeight)} px tại (${Math.round(h.x * map.mapWidth)}, ${Math.round(h.y * map.mapHeight)})</p>
    ${isFact ? `
    <div class="fact-prop-panel">
      <h3>Ảnh prop trên map</h3>
      <div class="field-row"><label>Preset ảnh</label><select id="propPreset"><option value="">— chọn preset —</option>${propPresets}</select></div>
      <div class="field-row"><label>Đường dẫn ảnh</label><input id="propImage" value="${esc(h.propImage || '')}" placeholder="/assets/facts/trash-bags.png"></div>
      <div class="editor-controls fact-prop-actions">
        <button type="button" id="placePropBtn">Kéo đặt ảnh prop</button>
        <button type="button" id="usePresetPropBtn">Gắn preset + copy vùng click</button>
        <button type="button" id="clearPropBtn">Xóa ảnh prop</button>
      </div>
      <div class="field-row fact-edit-target">
        <label>Đang chỉnh</label>
        <label><input type="radio" name="factEditTarget" value="hit" ${factEditTarget === 'hit' ? 'checked' : ''}> Vùng click</label>
        <label><input type="radio" name="factEditTarget" value="prop" ${factEditTarget === 'prop' ? 'checked' : ''} ${hasProp ? '' : 'disabled'}> Ảnh prop</label>
      </div>
      ${hasProp ? `
      <div class="field-row"><label>propX</label><input id="propX" value="${h.propX ?? ''}"></div>
      <div class="field-row"><label>propY</label><input id="propY" value="${h.propY ?? ''}"></div>
      <div class="field-row"><label>propW</label><input id="propW" value="${h.propW ?? ''}"></div>
      <div class="field-row"><label>propH</label><input id="propH" value="${h.propH ?? ''}"></div>
      <p class="field-hint editor-px-readout">Ảnh prop: ${Math.round((h.propW ?? 0) * map.mapWidth)}×${Math.round((h.propH ?? 0) * map.mapHeight)} px</p>
      ` : '<p class="field-hint">Chưa có ảnh prop. Chọn preset (vd. Túi rác đen) rồi bấm <b>Kéo đặt ảnh prop</b>.</p>'}
    </div>` : ''}
    <div class="nudge-grid">
      <button type="button" data-nudge="0,-1,0,0">↑ Lên</button>
      <button type="button" data-nudge="0,1,0,0">↓ Xuống</button>
      <button type="button" data-nudge="-1,0,0,0">← Trái</button>
      <button type="button" data-nudge="1,0,0,0">→ Phải</button>
      <button type="button" data-nudge="0,0,1,0">Rộng +</button>
      <button type="button" data-nudge="0,0,-1,0">Rộng −</button>
      <button type="button" data-nudge="0,0,0,1">Cao +</button>
      <button type="button" data-nudge="0,0,0,-1">Cao −</button>
    </div>
    <label>${isFact ? 'Mô tả vùng (hiện trên editor)' : 'Ghi chu'}</label><textarea id="note" rows="3">${esc(h.reviewNote || '')}</textarea>
    <div class="editor-controls">
      <button id="apply">Áp dụng</button>
      ${isSlice ? '<button id="previewBtn">Xem preview crop</button>' : ''}
      <button id="duplicate">Nhân bản</button>
      <button id="delete">Xóa</button>
    </div>
    <p class="field-hint">${isFact
      ? 'Fact: Download JSON → thay <code>public/data/hotspots.json</code> (không cần <code>npm run tiles</code>).'
      : 'Sau khi chỉnh xong: Download JSON → thay <code>public/data/hotspots.json</code> → chạy <code>npm run tiles</code>.'}</p>`;

  p.querySelector('#type').value = h.type || 'trash';
  p.querySelector('#trashId').value = h.trashId || '';
  p.querySelector('#pieceId').value = h.pieceId || '';
  p.querySelector('#factId').value = h.factId || '';
  p.querySelector('#apply').onclick = applyForm;
  const previewBtn = p.querySelector('#previewBtn');
  if (previewBtn) previewBtn.onclick = () => refreshSelectedPreview(true);
  p.querySelector('#duplicate').onclick = () => {
    const n = { ...h, id: nextId(), x: +Math.min(0.99, h.x + 0.01).toFixed(5), y: +Math.min(0.99, h.y + 0.01).toFixed(5) };
    data.hotspots.push(n);
    selected = n.id;
    renderAll();
    schedulePreviewRefresh();
  };
  p.querySelector('#delete').onclick = () => {
    revokeLivePreview(h.id);
    data.hotspots = data.hotspots.filter(x => x.id !== h.id);
    selected = null;
    renderAll();
  };
  p.querySelectorAll('[data-nudge]').forEach(btn => {
    btn.onclick = () => {
      const [dx, dy, dw, dh] = btn.dataset.nudge.split(',').map(Number);
      nudgeHotspot(h, dx, dy, dw, dh);
    };
  });
  p.querySelector('#propPreset')?.addEventListener('change', e => {
    const src = e.target.value;
    if (src) {
      const img = p.querySelector('#propImage');
      if (img) img.value = src;
    }
  });
  p.querySelector('#placePropBtn')?.addEventListener('click', () => {
    const src = p.querySelector('#propImage')?.value?.trim();
    if (!src) return toastEditor('Chọn preset hoặc nhập đường dẫn ảnh prop.');
    mode = 'create';
    createKind = 'factProp';
    toastEditor('Kéo trên map để đặt kích thước ảnh prop.');
  });
  p.querySelector('#usePresetPropBtn')?.addEventListener('click', () => {
    const src = p.querySelector('#propImage')?.value?.trim();
    if (!src) return toastEditor('Chọn preset ảnh trước.');
    initFactPropFromHit(h, src);
    factEditTarget = 'prop';
    renderAll();
    toastEditor('Đã gắn ảnh prop trùng vùng click — kéo ảnh để căn lại.');
  });
  p.querySelector('#clearPropBtn')?.addEventListener('click', () => {
    delete h.propImage;
    delete h.propX;
    delete h.propY;
    delete h.propW;
    delete h.propH;
    factEditTarget = 'hit';
    renderAll();
    toastEditor('Đã xóa ảnh prop.');
  });
  p.querySelectorAll('input[name="factEditTarget"]').forEach(r => {
    r.onchange = () => {
      if (r.checked) {
        factEditTarget = r.value;
        renderMapObjects();
        renderForm();
      }
    };
  });
}

function applyForm() {
  const h = getSel();
  if (!h) return;
  h.type = document.getElementById('type').value;
  h.trashId = document.getElementById('trashId').value || null;
  h.pieceId = document.getElementById('pieceId').value || null;
  h.factId = document.getElementById('factId').value || null;
  h.x = +Number(document.getElementById('x').value).toFixed(5);
  h.y = +Number(document.getElementById('y').value).toFixed(5);
  h.w = +Number(document.getElementById('w').value).toFixed(5);
  h.h = +Number(document.getElementById('h').value).toFixed(5);
  h.reviewNote = document.getElementById('note').value;
  const propImageEl = document.getElementById('propImage');
  if (propImageEl) {
    const src = propImageEl.value.trim();
    if (src) {
      h.propImage = src;
      if (h.propX == null) initFactPropFromHit(h, src);
      h.propX = +Number(document.getElementById('propX')?.value || h.propX).toFixed(5);
      h.propY = +Number(document.getElementById('propY')?.value || h.propY).toFixed(5);
      h.propW = +Number(document.getElementById('propW')?.value || h.propW).toFixed(5);
      h.propH = +Number(document.getElementById('propH')?.value || h.propH).toFixed(5);
    } else {
      delete h.propImage;
      delete h.propX;
      delete h.propY;
      delete h.propW;
      delete h.propH;
    }
  }
  renderAll();
  if (isSliceType(h)) schedulePreviewRefresh();
}

function renderAll() {
  renderMapObjects();
  renderForm();
  renderList();
}

function exportJson() {
  return JSON.stringify({
    version: '2.0',
    note: 'Gameplay dung map sach + object rac rieng. Editor dung overlay map co rac.',
    total: data.hotspots.length,
    hotspots: data.hotspots
  }, null, 2);
}

function downloadJson() {
  const blob = new Blob([exportJson()], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'hotspots.json';
  a.click();
  URL.revokeObjectURL(a.href);
  toastEditor('Đã tải hotspots.json. Nhớ chạy npm run tiles để tạo slice mới.');
}

function toastEditor(t) {
  const el = document.createElement('div');
  el.className = 'toast';
  el.textContent = t;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 2800);
}

load().catch(err => {
  console.error(err);
  app.innerHTML = `<pre style="color:white;padding:20px">Editor error: ${esc(err.message)}</pre>`;
});
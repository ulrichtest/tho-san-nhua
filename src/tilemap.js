export class TileMap {
  constructor(root, options = {}) {
    if (!(root instanceof HTMLElement)) {
      throw new Error(`Phần tử bản đồ không hợp lệ (${typeof root}). Tải lại trang (Ctrl+F5).`);
    }
    this.root = root;
    this.setName = options.setName || 'clean';
    this.manifestUrl = options.manifestUrl || '/assets/tiles/manifest.json';
    this.lockPanAtMin = options.lockPanAtMin ?? true;
    this.onClickMap = options.onClickMap || null;
    this.onTransform = options.onTransform || null;
    this.mapWidth = 1;
    this.mapHeight = 1;
    this.scale = 1;
    this.minScale = 1;
    this.maxScale = 1;
    this.x = 0;
    this.y = 0;
    this._drag = null;
    this._raf = 0;
    this._layers = [];

    this.root.classList.add('tilemap');
    this.stage = document.createElement('div');
    this.stage.className = 'tilemap-stage map-world';

    this.imageLayer = document.createElement('div');
    this.imageLayer.className = 'tilemap-image-layer';

    this.objectLayer = document.createElement('div');
    this.objectLayer.className = 'tilemap-objects';

    this.stage.append(this.imageLayer, this.objectLayer);
    this.root.innerHTML = '';
    this.root.appendChild(this.stage);
    this._bindEvents();
  }

  async load() {
    const res = await fetch(this.manifestUrl, { cache: 'no-cache' });
    if (!res.ok) {
      throw new Error(`Không load được tile manifest (${res.status}): ${this.manifestUrl}`);
    }
    const contentType = res.headers.get('content-type') || '';
    if (!contentType.includes('json')) {
      throw new Error('Thiếu tile bản đồ. Chạy: npm run tiles (cần Python 3 + Pillow)');
    }
    this.manifest = await res.json();
    this.mapWidth = Number(this.manifest.width || 1);
    this.mapHeight = Number(this.manifest.height || 1);
    this.tileSize = Number(this.manifest.tileSize || 512);
    this.maxZoom = Number(this.manifest.maxZoom || 0);
    this.levels = this.manifest.levels || [];
    this.sets = this.manifest.sets || { clean: '/assets/tiles/clean/z{z}/{x}_{y}.webp' };

    for (const el of [this.stage, this.imageLayer, this.objectLayer]) {
      el.style.width = this.mapWidth + 'px';
      el.style.height = this.mapHeight + 'px';
    }
    this._layers = [];
    this.baseLayer = this._createTileLayer(this.setName, this.imageLayer, 1);

    this._resizeObserver = new ResizeObserver(() => this.fit(false));
    this._resizeObserver.observe(this.root);
    this.fit(false);
  }

  addTileOverlay(setName, opacity = 0.45) {
    const layerEl = document.createElement('div');
    layerEl.className = 'tilemap-image-layer tilemap-overlay-layer';
    layerEl.style.width = this.mapWidth + 'px';
    layerEl.style.height = this.mapHeight + 'px';
    layerEl.style.opacity = opacity;
    layerEl.style.pointerEvents = 'none';
    this.stage.insertBefore(layerEl, this.objectLayer);
    const layer = this._createTileLayer(setName, layerEl, opacity);
    this.render();
    return layer;
  }

  setOverlayOpacity(layer, opacity) {
    if (!layer?.el) return;
    layer.el.style.opacity = opacity;
  }

  setOverlayVisible(layer, visible) {
    if (!layer?.el) return;
    layer.el.style.display = visible ? 'block' : 'none';
  }

  _createTileLayer(setName, el, opacity) {
    const layer = { setName, el, opacity, nodes: new Map(), visibleKey: '' };
    this._layers.push(layer);
    return layer;
  }

  _viewportScale() {
    const v = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--ph-scale'));
    return Number.isFinite(v) && v > 0 ? v : 1;
  }

  _rootSize() {
    return { w: this.root.clientWidth, h: this.root.clientHeight };
  }

  _clientToRootLocal(clientX, clientY) {
    const rect = this.root.getBoundingClientRect();
    const s = this._viewportScale();
    return {
      x: (clientX - rect.left) / s,
      y: (clientY - rect.top) / s
    };
  }

  _coverScale(w, h) {
    return Math.max(w / this.mapWidth, h / this.mapHeight);
  }

  fit(options = false) {
    const opts = typeof options === 'boolean'
      ? { randomFocus: options }
      : (options || {});
    const { w, h } = this._rootSize();
    if (!w || !h) return;

    const cover = this._coverScale(w, h);
    this.minScale = Math.max(cover, 0.02);
    this.maxScale = Math.max(this.minScale * 8, 1.25);
    this.scale = this.minScale;

    if (opts.randomFocus) {
      this.focus(Math.random() * this.mapWidth, Math.random() * this.mapHeight, this.minScale * 1.55);
      return;
    }

    const focusNx = opts.focusNx ?? 0.5;
    const focusNy = opts.focusNy ?? 0.48;
    this.focus(focusNx * this.mapWidth, focusNy * this.mapHeight, this.minScale);
  }

  focus(mx, my, scale = this.scale) {
    const { w, h } = this._rootSize();
    this.scale = Math.min(this.maxScale, Math.max(this.minScale, scale));
    this.x = w / 2 - mx * this.scale;
    this.y = h / 2 - my * this.scale;
    this.clamp();
    this.scheduleRender();
  }

  zoomBy(factor, cx, cy) {
    const { w, h } = this._rootSize();
    cx ??= w / 2;
    cy ??= h / 2;
    const beforeX = (cx - this.x) / this.scale;
    const beforeY = (cy - this.y) / this.scale;
    this.scale = Math.min(this.maxScale, Math.max(this.minScale, this.scale * factor));
    this.x = cx - beforeX * this.scale;
    this.y = cy - beforeY * this.scale;
    this.clamp();
    this.scheduleRender();
  }

  screenToMap(clientX, clientY) {
    const { x: sx, y: sy } = this._clientToRootLocal(clientX, clientY);
    const mx = (sx - this.x) / this.scale;
    const my = (sy - this.y) / this.scale;
    return { x: mx, y: my, sx, sy, nx: mx / this.mapWidth, ny: my / this.mapHeight };
  }

  clamp() {
    const { w, h } = this._rootSize();
    const mw = this.mapWidth * this.scale;
    const mh = this.mapHeight * this.scale;
    this.x = mw <= w ? (w - mw) / 2 : Math.min(0, Math.max(w - mw, this.x));
    this.y = mh <= h ? (h - mh) / 2 : Math.min(0, Math.max(h - mh, this.y));
  }

  scheduleRender() {
    cancelAnimationFrame(this._raf);
    this._raf = requestAnimationFrame(() => this.render());
  }

  render() {
    this.stage.style.transform = `translate3d(${this.x}px, ${this.y}px, 0) scale(${this.scale})`;
    this._renderTiles();
    this.onTransform?.(this);
  }

  _levelForScale() {
    const dpr = Math.min(2, Math.max(1, window.devicePixelRatio || 1));
    const screenScale = this.scale * this._viewportScale() * dpr;
    const fallback = this.levels[0] || { z: 0, width: this.mapWidth, height: this.mapHeight, cols: 1, rows: 1, scale: 1 };

    // Pick the sharpest level whose tiles are still large enough on screen.
    // The old "desired scale" rule picked z0/z1 at cover zoom → only 4–12 giant
    // tiles visible, so seams looked like a black grid.
    for (let i = this.levels.length - 1; i >= 0; i--) {
      const level = this.levels[i];
      const levelScaleX = level.width / this.mapWidth;
      const mapPixelsPerTile = this.tileSize / levelScaleX;
      const screenPixelsPerTile = mapPixelsPerTile * screenScale;
      if (screenPixelsPerTile >= 36) return level;
    }

    return fallback;
  }

  _url(setName, z, x, y) {
    const template = this.sets?.[setName] || this.sets?.clean || '/assets/tiles/clean/z{z}/{x}_{y}.webp';
    return template.replace('{z}', z).replace('{x}', x).replace('{y}', y);
  }

  _renderTiles() {
    if (!this.levels?.length) return;
    const level = this._levelForScale();
    const levelScaleX = level.width / this.mapWidth;
    const levelScaleY = level.height / this.mapHeight;
    const { w, h } = this._rootSize();
    const viewLeft = Math.max(0, -this.x / this.scale);
    const viewTop = Math.max(0, -this.y / this.scale);
    const viewRight = Math.min(this.mapWidth, (w - this.x) / this.scale);
    const viewBottom = Math.min(this.mapHeight, (h - this.y) / this.scale);
    const t = this.tileSize;
    const buffer = 1;
    const x0 = Math.max(0, Math.floor(viewLeft * levelScaleX / t) - buffer);
    const y0 = Math.max(0, Math.floor(viewTop * levelScaleY / t) - buffer);
    const x1 = Math.min(level.cols - 1, Math.floor(viewRight * levelScaleX / t) + buffer);
    const y1 = Math.min(level.rows - 1, Math.floor(viewBottom * levelScaleY / t) + buffer);

    for (const layer of this._layers) {
      if (layer.el.style.display === 'none') continue;
      const keep = new Set();
      for (let ty = y0; ty <= y1; ty++) {
        for (let tx = x0; tx <= x1; tx++) {
          const key = `${level.z}/${tx}/${ty}`;
          keep.add(key);
          let node = layer.nodes.get(key);
          if (!node) {
            node = document.createElement('img');
            node.className = 'map-tile';
            node.decoding = 'async';
            node.loading = 'lazy';
            node.draggable = false;
            node.alt = '';
            node.src = this._url(layer.setName, level.z, tx, ty);
            layer.nodes.set(key, node);
            layer.el.appendChild(node);
          }
          const leftL = tx * t;
          const topL = ty * t;
          const rightL = Math.min(level.width, leftL + t);
          const bottomL = Math.min(level.height, topL + t);
          const bleed = 1;
          node.style.left = (leftL / levelScaleX) + 'px';
          node.style.top = (topL / levelScaleY) + 'px';
          node.style.width = ((rightL - leftL) / levelScaleX + bleed) + 'px';
          node.style.height = ((bottomL - topL) / levelScaleY + bleed) + 'px';
        }
      }
      for (const [key, node] of layer.nodes) {
        if (!keep.has(key)) {
          node.remove();
          layer.nodes.delete(key);
        }
      }
    }
  }

  _bindEvents() {
    this.root.addEventListener('wheel', e => {
      e.preventDefault();
      const factor = e.deltaY < 0 ? 1.15 : 1 / 1.15;
      const local = this._clientToRootLocal(e.clientX, e.clientY);
      this.zoomBy(factor, local.x, local.y);
    }, { passive: false });

    this.root.addEventListener('pointerdown', e => {
      if (e.button !== 0) return;
      this.root.setPointerCapture(e.pointerId);
      const p = this.screenToMap(e.clientX, e.clientY);
      const canPan = !this.lockPanAtMin || this.scale >= this.minScale * 0.9999;
      this._drag = { id:e.pointerId, sx:e.clientX, sy:e.clientY, x:this.x, y:this.y, mx:p.x, my:p.y, moved:false, canPan };
    });

    this.root.addEventListener('pointermove', e => {
      if (!this._drag || this._drag.id !== e.pointerId) return;
      const s = this._viewportScale();
      const dx = (e.clientX - this._drag.sx) / s;
      const dy = (e.clientY - this._drag.sy) / s;
      if (Math.abs(dx) + Math.abs(dy) > 4) this._drag.moved = true;
      if (this._drag.canPan) {
        this.x = this._drag.x + dx;
        this.y = this._drag.y + dy;
        this.clamp();
        this.scheduleRender();
      }
    });

    const up = e => {
      if (!this._drag || this._drag.id !== e.pointerId) return;
      const d = this._drag;
      this._drag = null;
      if (!d.moved && this.onClickMap) {
        this.onClickMap({ x:d.mx, y:d.my, nx:d.mx / this.mapWidth, ny:d.my / this.mapHeight, originalEvent:e });
      }
    };
    this.root.addEventListener('pointerup', up);
    this.root.addEventListener('pointercancel', () => { this._drag = null; });
  }

  destroy() {
    cancelAnimationFrame(this._raf);
    this._resizeObserver?.disconnect();
    this._resizeObserver = null;
    for (const layer of this._layers) {
      for (const node of layer.nodes.values()) node.remove();
      layer.nodes.clear();
    }
    this._layers = [];
    if (this.root?.isConnected) this.root.replaceChildren();
    this.root = null;
  }
}

import { TileMap } from './tilemap.js?v=20260621c';
import { bindButtonClickSound, initAudio, playSfx, setMuted, syncBgm, unlockAudio } from './audio.js?v=20260621-bgm';
import { DESIGN_HEIGHT, DESIGN_WIDTH, initViewport, visibleViewportRect } from './viewport.js?v=20260621c';

const $ = sel => document.querySelector(sel);
const app = document.getElementById('app');
const UI = '/assets/ui/';
const PLASTY = '/assets/plasty/';
const BUILD_TAG = '20260621-maproot-fix-c';
const MAP_ROOT_ID = 'game-map-root';
const STAGE_W = DESIGN_WIDTH;
const STAGE_H = DESIGN_HEIGHT;
const CLS_DESIGN_W = 930;
const CLS_DESIGN_H = 680;
const BACKDROP_HOME = UI + 'home-bg.png';
const BTN_FULLSCREEN = UI + 'btn-fullscreen.png?v=7';
const BTN_CONTINUE = UI + 'btn-continue.png?v=5';
const STORY_INTRO = UI + 'story-intro.png?v=3';
const MAP_START_FOCUS = { focusNx: 0.5, focusNy: 0.48 };
const TRASH_ASSETS = '/assets/trash/';
const BIN_GAME_MAP = { hard_recycle: 'low-value', hardRecycle: 'low-value' };
const STORAGE = 'plasticHunterLeaderboardCleanV3';

const bins = {
  recycle: { name: 'Tái chế', img: UI + 'bin-recycle.png' },
  reuse: { name: 'Tái sử dụng', img: UI + 'bin-reuse.png' },
  'low-value': { name: 'Rác nhựa khó tái chế', img: UI + 'bin-low-value.png' },
  contaminated: { name: 'Rác nhựa ô nhiễm', img: UI + 'bin-contaminated.png' }
};

const state = {
  screen: 'loading',
  data: null,
  map: null,
  playerName: localStorage.getItem('plasticHunterName') || '',
  score: 0,
  timeLeft: 300,
  timer: null,
  timerPaused: false,
  selected: null,
  foundTrash: new Set(),
  foundPieces: new Set(),
  foundFacts: new Set(),
  scoreSaved: false,
  gameEnded: false,
  muted: false,
  hintIndex: 0,
  guideReturn: 'home'
};

let viewportCtl = null;
let renderGameGen = 0;
let fullscreenListenersBound = false;
let pseudoFullscreenGranted = false;
let fullscreenPaused = false;
let zoomHintCleanup = null;

function isFullscreenActive() {
  return !!(document.fullscreenElement || document.webkitFullscreenElement || document.mozFullScreenElement);
}

function isPseudoFullscreenActive() {
  return document.documentElement.classList.contains('ph-pseudo-fullscreen');
}

function isBrowserFullscreenViaF11() {
  const h = window.innerHeight;
  const w = window.innerWidth;
  return h >= screen.height - 4 && w >= screen.width - 4;
}

function isMobileLike() {
  return /iPhone|iPad|iPod|Android|Mobile/i.test(navigator.userAgent);
}

function isPlayAllowed() {
  if (isFullscreenActive() || isBrowserFullscreenViaF11()) return true;
  return pseudoFullscreenGranted && isPseudoFullscreenActive();
}

function disablePseudoFullscreen() {
  pseudoFullscreenGranted = false;
  document.documentElement.classList.remove('ph-pseudo-fullscreen');
}

function enablePseudoFullscreen() {
  pseudoFullscreenGranted = true;
  document.documentElement.classList.add('ph-pseudo-fullscreen');
  window.scrollTo(0, 1);
  setTimeout(() => window.scrollTo(0, 0), 60);
  viewportCtl?.refresh?.();
  syncFullscreenGate();
  return true;
}

function closeFullscreenPrompt() {
  $('#phViewport')?.querySelector('.fullscreen-prompt-root')?.remove();
}

function showFullscreenPrompt() {
  if (isPlayAllowed()) return;
  ensureViewportShell();
  if ($('#phViewport')?.querySelector('.fullscreen-prompt-root')) return;

  const root = document.createElement('div');
  root.className = 'fullscreen-prompt-root';
  root.setAttribute('role', 'dialog');
  root.setAttribute('aria-modal', 'true');
  root.setAttribute('aria-label', 'Phóng to màn hình');
  root.innerHTML = `<div class="fullscreen-prompt-backdrop" aria-hidden="true"></div>
    <div class="fullscreen-prompt-card panel-card">
      ${img(PLASTY + 'plasty-wisdom.png', 'Plasty', 'fullscreen-prompt-plasty')}
      <p class="fullscreen-prompt-text">Để có trải nghiệm trò chơi tốt nhất, vui lòng bấm nút bên dưới.</p>
      <div class="fullscreen-prompt-actions">
        ${assetButton(BTN_FULLSCREEN, 'Phóng to màn hình', 'fullscreen', 'receive-message-btn fullscreen-prompt-btn')}
      </div>
    </div>`;
  $('#phViewport').appendChild(root);

  const fsBtn = root.querySelector('[data-action="fullscreen"]');
  bindButtonClickSound(fsBtn);
  fsBtn?.addEventListener('click', () => {
    unlockAudio();
    requestGameFullscreen();
  });
}

function enforceFullscreenLock() {
  if (state.screen !== 'game' || state.gameEnded || isPlayAllowed()) return;
  if (!state.timerPaused && state.timer) {
    pauseTimer();
    fullscreenPaused = true;
  }
  mapRootEl()?.classList.add('map-locked');
}

function releaseFullscreenLock() {
  if (state.screen === 'game' && fullscreenPaused) {
    fullscreenPaused = false;
    resumeTimer();
  }
  if (state.screen === 'game') mapRootEl()?.classList.remove('map-locked');
}

function syncFullscreenGate() {
  const vp = $('#phViewport');
  if (!vp) return;
  if (isPlayAllowed()) {
    closeFullscreenPrompt();
    releaseFullscreenLock();
    vp.classList.remove('ph-fullscreen-required');
    return;
  }
  if (!pseudoFullscreenGranted) disablePseudoFullscreen();
  vp.classList.add('ph-fullscreen-required');
  showFullscreenPrompt();
  enforceFullscreenLock();
}

function blockPlayWithoutFullscreen(action) {
  if (isPlayAllowed()) return false;
  const playActions = new Set(['story', 'name', 'start', 'replay']);
  if (playActions.has(action) || state.screen === 'game') {
    syncFullscreenGate();
    toast('Bắt buộc phóng to màn hình mới được chơi.');
    return true;
  }
  return false;
}

async function requestNativeFullscreen(el) {
  if (el.requestFullscreen) {
    await el.requestFullscreen({ navigationUI: 'hide' });
    return true;
  }
  if (el.webkitRequestFullscreen) {
    await el.webkitRequestFullscreen(Element.ALLOW_KEYBOARD_INPUT);
    return true;
  }
  if (el.mozRequestFullScreen) {
    await el.mozRequestFullScreen();
    return true;
  }
  if (el.msRequestFullscreen) {
    await el.msRequestFullscreen();
    return true;
  }
  return false;
}

async function requestGameFullscreen() {
  if (isPlayAllowed()) return true;

  const candidates = [
    document.documentElement,
    $('#phViewport'),
    $('#app'),
    document.body
  ].filter(Boolean);

  for (const el of candidates) {
    try {
      if (await requestNativeFullscreen(el)) {
        viewportCtl?.refresh?.();
        syncFullscreenGate();
        return true;
      }
    } catch { /* try next target */ }
  }

  // Native fullscreen often fails on desktop (policy/iframe); pseudo mode still unlocks play.
  if (enablePseudoFullscreen()) return true;

  toast('Không phóng to được. Hãy bấm F11 hoặc dùng menu trình duyệt để vào toàn màn hình.');
  syncFullscreenGate();
  return false;
}

async function exitGameFullscreen() {
  if (!isFullscreenActive()) return;
  const exit = document.exitFullscreen?.bind(document)
    || document.webkitExitFullscreen?.bind(document)
    || document.msExitFullscreen?.bind(document);
  if (!exit) return;
  try {
    await exit();
    viewportCtl?.refresh?.();
  } catch { /* ignore */ }
}

function bindFullscreenListeners() {
  if (fullscreenListenersBound) return;
  fullscreenListenersBound = true;
  const onChange = () => {
    viewportCtl?.refresh?.();
    syncFullscreenGate();
  };
  document.addEventListener('fullscreenchange', onChange);
  document.addEventListener('webkitfullscreenchange', onChange);
  document.addEventListener('mozfullscreenchange', onChange);
  window.addEventListener('resize', onChange);
  window.visualViewport?.addEventListener('resize', onChange);
}

const esc = (s = '') => String(s).replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]));
const img = (src, alt = '', cls = '') => `<img class="${cls}" src="${src}" alt="${esc(alt)}" draggable="false" />`;
const assetButton = (src, label, action, cls = 'asset-btn') => `<button class="${cls}" data-action="${action}" aria-label="${esc(label)}">${img(src, label)}</button>`;
const textButton = (label, action, cls = 'ui-btn') => `<button class="${cls}" data-action="${action}">${esc(label)}</button>`;
const RESULT_SVG = {
  home: '<svg class="result-btn-icon result-btn-icon--svg" viewBox="0 0 24 24" aria-hidden="true"><path fill="#1f57b8" d="M12 3.2 20.2 10.4V20h-5.6v-5.8H9.4V20H3.8v-9.6z"/></svg>'
};
const RESULT_STAT_ICONS = {
  items: UI + 'result-stat-items.png?v=removebg',
  pieces: UI + 'result-stat-piece.png?v=removebg'
};
const resultStatIcon = src => img(src, '', 'result-stat-icon');
const iconTextButton = (label, action, iconHtml, cls = 'ui-btn') =>
  `<button class="${cls}" data-action="${action}">${iconHtml}<span>${esc(label)}</span></button>`;
const resultStatBox = (iconHtml, text) =>
  `<div class="result-stat-box">${iconHtml}<span>${esc(text)}</span></div>`;
const fmtTime = sec => `${String(Math.floor(Math.max(0, sec) / 60)).padStart(2,'0')}:${String(Math.max(0, sec) % 60).padStart(2,'0')}`;
const fmtScore = score => `${score} điểm`;
const fmtResultScore = score => `${Number(score).toLocaleString('vi-VN')} điểm`;
const binName = id => bins[id]?.name || id || 'Chưa có dữ liệu';
const getItem = id => state.data.itemsById[id];
const getHotspot = id => state.data.hotspots.find(h => h.id === id);
const sliceInfo = h => state.data?.sliceManifest?.items?.[h.id] || null;
const sliceSrc = h => sliceInfo(h)?.src || `/assets/slices/${encodeURIComponent(h.id)}.webp`;
const allTrashHotspots = () => state.data.hotspots.filter(h => h.type === 'trash' && h.trashId);
const activeTrashHotspots = () => allTrashHotspots().filter(h => !state.foundTrash.has(h.id));
const totalTrash = () => allTrashHotspots().length || 50;

async function loadData() {
  const [items, hotspots, facts, config, modalLayout] = await Promise.all([
    fetch('/data/trash-items.json').then(r => r.json()),
    fetch('/data/hotspots.json').then(r => r.json()),
    fetch('/data/facts.json').then(r => r.json()),
    fetch('/data/game-config.json').then(r => r.json()),
    fetch('/data/modal-layout.json').then(r => r.json())
  ]);
  state.data = {
    items: items.items || [],
    itemsById: Object.fromEntries((items.items || []).map(x => [x.id, x])),
    hotspots: hotspots.hotspots || [],
    facts: facts.facts || [],
    factsById: Object.fromEntries((facts.facts || []).map(x => [x.id, x])),
    sliceManifest: await fetch('/assets/slices/manifest.json', { cache: 'no-cache' }).then(r => r.ok ? r.json() : { items:{} }).catch(() => ({ items:{} })),
    config,
    modalLayout
  };
}

function ensureViewportShell(force = false) {
  if (!force && $('#phStage') && $('#phScreenHost') && $('#phViewport')) return;
  if (!app) throw new Error('Thiếu #app trong index.html');
  viewportCtl?.destroy?.();
  viewportCtl = null;
  app.className = 'ph-app';
  app.innerHTML = `<div class="ph-viewport" id="phViewport">
    <div class="ph-viewport-backdrop" id="phViewportBackdrop" aria-hidden="true"></div>
    <div class="ph-viewport-backdrop-veil" id="phViewportBackdropVeil" aria-hidden="true"></div>
    <div class="ph-stage" id="phStage">
      <div id="phScreenHost"></div>
      <div id="toastRoot" class="toast-root" aria-live="polite"></div>
    </div>
  </div>`;
  preloadBackdropAssets();
  bindFullscreenListeners();
  viewportCtl = initViewport({
    stage: $('#phStage'),
    viewport: $('#phViewport'),
    getScaleMode: () => (state.screen === 'game' ? 'cover' : 'contain'),
    onResize: () => {
      state.map?.fit(false);
      refreshClassificationScale();
    }
  });
  syncViewportBackdrop();
}

function preloadBackdropAssets() {
  const el = new Image();
  el.src = BACKDROP_HOME;
}

function syncViewportBackdrop() {
  const vp = $('#phViewport');
  const backdrop = $('#phViewportBackdrop');
  if (!vp || !backdrop) return;

  const isGame = state.screen === 'game';
  vp.classList.toggle('ph-viewport--game', isGame);
  vp.classList.toggle('ph-viewport--home', !isGame);
  vp.classList.toggle('ph-viewport--stage-cover', isGame);

  if (isGame) {
    backdrop.style.setProperty('--ph-backdrop-image', 'none');
  } else {
    backdrop.style.setProperty('--ph-backdrop-image', `url("${BACKDROP_HOME}")`);
  }

  viewportCtl?.refresh?.();
}

function screenHost() {
  ensureViewportShell();
  let host = document.getElementById('phScreenHost');
  if (!host) {
    ensureViewportShell(true);
    host = document.getElementById('phScreenHost');
  }
  return host;
}

function mapRootEl() {
  return state.map?.root || document.getElementById(MAP_ROOT_ID);
}

function dismissZoomHint() {
  zoomHintCleanup?.();
  zoomHintCleanup = null;
  const root = document.querySelector('.zoom-hint-root');
  if (!root) return;
  root.classList.add('zoom-hint-out');
  setTimeout(() => root.remove(), 340);
}

function showZoomHint() {
  dismissZoomHint();
  const gameScreen = document.querySelector('.game-screen');
  if (!gameScreen || state.screen !== 'game') return;

  const root = document.createElement('div');
  root.className = 'zoom-hint-root';
  root.setAttribute('role', 'status');
  root.setAttribute('aria-live', 'polite');
  root.setAttribute('aria-label', 'Hướng dẫn phóng to thu nhỏ bản đồ');
  root.innerHTML = `<div class="zoom-hint-shade" aria-hidden="true"></div>
    <div class="zoom-hint-card panel-card">
      <div class="zoom-hint-hero" aria-hidden="true">
        <div class="zoom-hint-map-demo">
          <div class="zoom-hint-map-grid"></div>
          <div class="zoom-hint-map-pulse"></div>
        </div>
        <div class="zoom-hint-mouse">
          <div class="zoom-hint-mouse-shell">
            <div class="zoom-hint-wheel-track">
              <div class="zoom-hint-wheel-knob"></div>
            </div>
            <span class="zoom-hint-mouse-btn zoom-hint-mouse-btn-l"></span>
            <span class="zoom-hint-mouse-btn zoom-hint-mouse-btn-r"></span>
          </div>
        </div>
        <div class="zoom-hint-flow">
          <span class="zoom-hint-cue zoom-hint-cue-up"><i></i>Phóng to</span>
          <span class="zoom-hint-cue zoom-hint-cue-down"><i></i>Thu nhỏ</span>
        </div>
      </div>
      <p class="zoom-hint-title">Lăn chuột để zoom bản đồ</p>
      <p class="zoom-hint-sub">Lăn lên phóng to · Lăn xuống thu nhỏ</p>
      <span class="zoom-hint-tap">Bấm hoặc lăn chuột để bắt đầu</span>
    </div>`;
  gameScreen.appendChild(root);
  requestAnimationFrame(() => root.classList.add('zoom-hint-in'));

  const onWheel = () => dismissZoomHint();
  const onClick = e => {
    if (e.target.closest('#hud')) return;
    dismissZoomHint();
  };
  const onKey = e => { if (e.key === 'Escape') dismissZoomHint(); };

  gameScreen.addEventListener('wheel', onWheel, { passive: true, capture: true });
  root.addEventListener('click', onClick);
  document.addEventListener('keydown', onKey);
  const autoTimer = setTimeout(dismissZoomHint, 12000);

  zoomHintCleanup = () => {
    clearTimeout(autoTimer);
    gameScreen.removeEventListener('wheel', onWheel, { capture: true });
    root.removeEventListener('click', onClick);
    document.removeEventListener('keydown', onKey);
  };
}

function mountGameScreen(host) {
  dismissZoomHint();
  state.map?.destroy?.();
  state.map = null;
  host.replaceChildren();

  const section = document.createElement('section');
  section.className = 'screen game-screen';

  const mapEl = document.createElement('div');
  mapEl.id = MAP_ROOT_ID;
  mapEl.className = 'map-root';

  const hud = document.createElement('div');
  hud.id = 'hud';
  hud.className = 'hud';

  const modalRoot = document.createElement('div');
  modalRoot.id = 'modalRoot';

  section.append(mapEl, hud, modalRoot);
  host.appendChild(section);
  return mapEl;
}

function setScreen(name) {
  if (['story', 'name', 'game'].includes(name) && !isPlayAllowed()) {
    syncFullscreenGate();
    return;
  }
  state.screen = name;
  syncViewportBackdrop();
  render();
  syncFullscreenGate();
  syncBgm(name);
}

function leaveToHome() {
  dismissZoomHint();
  if (state.screen === 'game') {
    renderGameGen += 1;
    state.map?.destroy?.();
    state.map = null;
    clearInterval(state.timer);
    state.timer = null;
    state.timerPaused = false;
    document.querySelectorAll('.leaderboard-open').forEach(el => el.classList.remove('leaderboard-open'));
    document.querySelectorAll('.leaderboard-overlay').forEach(el => el.remove());
    const m = $('#modalRoot');
    if (m) m.innerHTML = '';
  }
  closeResultModal();
  setScreen('home');
}

function bindActions(root = document) {
  root.querySelectorAll('[data-action]').forEach(btn => {
    bindButtonClickSound(btn);
    btn.onclick = () => {
      unlockAudio();
      const a = btn.dataset.action;
      if (blockPlayWithoutFullscreen(a)) return;
      if (a === 'home') return leaveToHome();
      if (a === 'story') return setScreen('story');
      if (a === 'name') return setScreen('name');
      if (a === 'start') return startFromName();
      if (a === 'guide') return showGuide(state.screen === 'game' ? 'game' : 'home');
      if (a === 'knowledge') return showPlasticTypes();
      if (a === 'leaderboard') return showLeaderboard();
      if (a === 'exit') return toast('Bạn có thể đóng tab trình duyệt để thoát game.');
      if (a === 'continue') return closeModal();
      if (a === 'zoom-in') { dismissZoomHint(); return state.map?.zoomBy(1.24); }
      if (a === 'zoom-out') { dismissZoomHint(); return state.map?.zoomBy(1 / 1.24); }
      if (a === 'hint') return useHint();
      if (a === 'sound') return toggleSound(btn);
      if (a === 'message' || a === 'open-message') return showMessageAssembly();
      if (a === 'message-split') return playMessageSplit();
      if (a === 'save-score') return saveCurrentScore(btn);
      if (a === 'replay') { closeResultModal(); return startGame(); }
      if (a === 'clear-scores') { localStorage.removeItem(STORAGE); return showLeaderboard(); }
    };
  });
}

function render() {
  if (state.screen === 'loading') return renderLoading();
  if (state.screen === 'home') return renderHome();
  if (state.screen === 'story') return renderStory();
  if (state.screen === 'name') return renderName();
  if (state.screen === 'game') return renderGame();
  if (state.screen === 'result') return setScreen('home');
}

function renderLoading() {
  screenHost().innerHTML = `<section class="screen scene-screen loading-screen">
    <div class="loading-content">
      ${img(UI + 'logo.png', 'Thợ Săn Nhựa', 'loading-logo')}
      ${img(UI + 'loading-plasty.png', 'Plasty loading', 'loading-plasty')}
      <div class="fake-loading"><div></div><span>Loading...</span></div>
    </div>
  </section>`;
}

function renderHome() {
  screenHost().innerHTML = `<section class="screen scene-screen home-screen">
    <div class="home-content">
      ${img(UI + 'logo.png', 'Thợ Săn Nhựa', 'home-logo')}
      <div class="home-menu">
        ${assetButton(UI + 'btn-play.png', 'Chơi ngay', 'story', 'menu-img-btn')}
        ${assetButton(UI + 'btn-guide.png', 'Hướng dẫn', 'guide', 'menu-img-btn')}
        ${assetButton(UI + 'btn-leaderboard.png', 'Bảng xếp hạng', 'leaderboard', 'menu-img-btn')}
        ${assetButton(UI + 'btn-exit.png', 'Thoát', 'exit', 'menu-img-btn danger')}
      </div>
    </div>
    <div class="build-tag" title="Phiên bản build hiện tại">${BUILD_TAG}</div>
  </section>`;
  bindActions(screenHost());
}

function renderStory() {
  screenHost().innerHTML = `<section class="screen scene-screen story-screen">
    ${img(UI + 'logo-line.png', 'Thợ Săn Nhựa', 'story-logo')}
    <div class="story-intro-wrap">
      ${img(STORY_INTRO, 'Giới thiệu Thợ Săn Nhựa', 'story-intro-art')}
      ${assetButton(UI + 'btn-ready.png', 'Sẵn sàng', 'name', 'story-ready')}
    </div>
    <button class="round-back" data-action="home">${img(UI + 'back.png', 'Quay lại')}</button>
  </section>`;
  bindActions(screenHost());
}

function renderName() {
  screenHost().innerHTML = `<section class="screen scene-screen name-screen">
    ${img(UI + 'logo-line.png', 'Thợ Săn Nhựa', 'story-logo')}
    <div class="name-card">
      <h2>Danh tính thợ săn</h2>
      <input id="nameInput" type="text" maxlength="24" placeholder="Nhập tên của bạn" value="${esc(state.playerName)}" />
      ${assetButton(UI + 'btn-start.png', 'Bắt đầu', 'start', 'name-start')}
    </div>
    <button class="round-back" data-action="home">${img(UI + 'back.png', 'Quay lại')}</button>
  </section>`;
  bindActions(screenHost());
  $('#nameInput')?.focus();
}

function startFromName() {
  const val = ($('#nameInput')?.value || '').trim().slice(0, 24) || 'Thợ săn nhựa';
  state.playerName = val;
  localStorage.setItem('plasticHunterName', val);
  startGame();
}

function startGame() {
  state.map?.destroy?.();
  state.map = null;
  state.score = 0;
  state.timeLeft = state.data.config.timeLimitSeconds || 300;
  state.foundTrash = new Set();
  state.foundPieces = new Set();
  state.foundFacts = new Set();
  state.scoreSaved = false;
  state.gameEnded = false;
  setScreen('game');
  startTimer();
}

function startTimer() {
  clearInterval(state.timer);
  state.timerPaused = false;
  state.timer = setInterval(() => {
    state.timeLeft -= 1;
    updateHud();
    if (state.timeLeft <= 0) endGame('time');
  }, 1000);
}

function pauseTimer() {
  if (state.screen !== 'game' || state.timerPaused || state.gameEnded) return;
  clearInterval(state.timer);
  state.timer = null;
  state.timerPaused = true;
}

function resumeTimer() {
  if (state.screen !== 'game' || !state.timerPaused || state.gameEnded) return;
  startTimer();
}

function endGame() {
  clearInterval(state.timer);
  state.timer = null;
  state.timerPaused = false;
  state.gameEnded = true;
  showResultModal();
}

async function renderGame() {
  const gen = ++renderGameGen;
  const host = screenHost();
  if (!host) {
    toast('Không tìm thấy khung game. Nhấn Ctrl+F5 để tải lại trang.', 6000);
    return;
  }

  const mapEl = mountGameScreen(host);
  if (!(mapEl instanceof HTMLElement)) {
    toast('Không tạo được vùng bản đồ. Nhấn Ctrl+F5 để tải lại trang.', 6000);
    return;
  }

  try {
    state.map = new TileMap(mapEl, { setName: 'clean', lockPanAtMin: false, onClickMap: handleMapClick });
    await state.map.load();
    if (gen !== renderGameGen || state.screen !== 'game') return;

    state.map.fit(MAP_START_FOCUS);
    renderMapObjects();
    requestAnimationFrame(() => {
      if (gen === renderGameGen && state.screen === 'game') state.map?.fit(MAP_START_FOCUS);
    });
    renderHud();
    requestAnimationFrame(() => {
      if (gen === renderGameGen && state.screen === 'game') showZoomHint();
    });
  } catch (err) {
    if (gen !== renderGameGen) return;
    console.error('[Thợ Săn Nhựa] renderGame failed:', err);
    toast(`Không tải được bản đồ: ${err.message}`, 8000);
    leaveToHome();
  }
}

function renderHud() {
  const hud = document.getElementById('hud');
  if (!hud) return;
  hud.innerHTML = `<div class="hud-left">
    ${hudBox('timer', fmtTime(state.timeLeft), UI + 'hud-timer.png')}
    ${hudBox('items', `${state.foundTrash.size}/${totalTrash()}`, UI + 'hud-items.png')}
    ${hudBox('pieces', `${state.foundPieces.size}/4`, UI + 'hud-pieces.png', state.foundPieces.size >= 4 ? 'open-message' : null)}
    ${hudBox('score', fmtScore(state.score), UI + 'hud-score.png')}
  </div>
  <div class="hud-right">
    ${assetButton(UI + 'btn-zoom-in.png', 'Phóng to', 'zoom-in', 'round-img-btn')}
    ${assetButton(UI + 'btn-zoom-out.png', 'Thu nhỏ', 'zoom-out', 'round-img-btn')}
    ${assetButton(UI + 'btn-leader-round.png', 'Bảng xếp hạng', 'leaderboard', 'round-img-btn')}
    ${assetButton(UI + 'btn-guide-round.png', 'Hướng dẫn', 'guide', 'round-img-btn')}
    ${assetButton(UI + 'btn-hint.png', 'Bảng 7 loại nhựa', 'knowledge', 'round-img-btn')}
    ${assetButton(UI + 'btn-sound.png', 'Âm thanh', 'sound', 'round-img-btn')}
    ${assetButton(UI + 'back.png', 'Quay lại', 'home', 'round-img-btn hud-back-btn')}
  </div>`;
  bindActions(hud);
}

function hudBox(id, value, bg, action = null) {
  const cls = action ? `hud-box ${id} hud-clickable` : `hud-box ${id}`;
  const attrs = action ? ` data-action="${action}" title="Mở thông điệp"` : '';
  return `<div class="${cls}" style="background-image:url('${bg}')" ${attrs}><span>${esc(value)}</span></div>`;
}

function updateHud() {
  if (state.screen !== 'game') return;
  $('#hud .timer span') && ($('#hud .timer span').textContent = fmtTime(state.timeLeft));
  $('#hud .items span') && ($('#hud .items span').textContent = `${state.foundTrash.size}/${totalTrash()}`);
  $('#hud .score span') && ($('#hud .score span').textContent = fmtScore(state.score));
  const piecesBox = $('#hud .pieces');
  if (piecesBox) {
    piecesBox.querySelector('span').textContent = `${state.foundPieces.size}/4`;
    if (state.foundPieces.size >= 4) {
      piecesBox.classList.add('hud-clickable');
      piecesBox.dataset.action = 'open-message';
      piecesBox.title = 'Mở thông điệp';
      bindActions(piecesBox);
    } else {
      piecesBox.classList.remove('hud-clickable');
      delete piecesBox.dataset.action;
      piecesBox.removeAttribute('title');
    }
  }
}

function renderMapObjects() {
  if (!state.map) return;
  const layer = state.map.objectLayer;
  layer.innerHTML = '';
  for (const h of state.data.hotspots) {
    if (h.type === 'trash') {
      if (!h.trashId || state.foundTrash.has(h.id)) continue;
      const it = getItem(h.trashId);
      if (!it) continue;
      layer.appendChild(makeCropObject(h, it.name, () => selectTrash(h.id)));
    }
    if (h.type === 'puzzle') {
      if (state.foundPieces.has(h.id)) continue;
      const n = (h.pieceId || 'piece_01').replace(/\D/g, '') || '1';
      const el = makeCropObject(h, 'Mảnh ghép', () => collectPiece(h.id));
      el.classList.add('puzzle-object');
      const fallback = el.querySelector('img');
      fallback.onerror = () => { fallback.src = UI + `message-piece-${Number(n)}.png`; fallback.style.objectFit = 'contain'; };
      layer.appendChild(el);
    }
    if (h.type === 'fact') {
      const prop = factPropDisplay(h);
      if (prop) layer.appendChild(makeFactProp(h, prop));
    }
  }
}

const FACT_PROP_FALLBACK = {
  fact_08: { src: '/assets/facts/trash-bags.png', scaleW: 2.2, scaleH: 2.6 }
};

function factPropDisplay(h) {
  const fb = FACT_PROP_FALLBACK[h.factId];
  const src = h.propImage || fb?.src;
  if (!src) return null;
  const w = h.propW ?? Math.max(h.w * (fb?.scaleW ?? 2.2), 0.04);
  const ht = h.propH ?? Math.max(h.h * (fb?.scaleH ?? 2.6), 0.05);
  return {
    src,
    x: h.propX ?? h.x,
    y: h.propY ?? h.y,
    w,
    h: ht
  };
}

function makeFactProp(h, prop) {
  const p = prop || factPropDisplay(h);
  if (!p) return null;
  const wrap = document.createElement('div');
  wrap.className = 'map-object fact-prop-object';
  wrap.dataset.id = h.id;
  wrap.style.pointerEvents = 'none';
  wrap.style.left = (p.x * state.map.mapWidth) + 'px';
  wrap.style.top = (p.y * state.map.mapHeight) + 'px';
  wrap.style.width = Math.max(24, p.w * state.map.mapWidth) + 'px';
  wrap.style.height = Math.max(24, p.h * state.map.mapHeight) + 'px';
  wrap.innerHTML = `<img src="${esc(p.src)}" alt="" draggable="false" />`;
  return wrap;
}

function makeCropObject(h, label, onclick) {
  const el = document.createElement('button');
  const si = sliceInfo(h) || h;
  el.className = 'map-object crop-object';
  el.dataset.id = h.id;
  el.style.left = (Number(si.x ?? h.x) * state.map.mapWidth) + 'px';
  el.style.top = (Number(si.y ?? h.y) * state.map.mapHeight) + 'px';
  el.style.width = Math.max(12, Number(si.w ?? h.w) * state.map.mapWidth) + 'px';
  el.style.height = Math.max(12, Number(si.h ?? h.h) * state.map.mapHeight) + 'px';
  el.innerHTML = `<img src="${sliceSrc(h)}" alt="${esc(label)}" draggable="false" />`;
  el.onclick = e => { e.stopPropagation(); onclick(); };
  return el;
}

function handleMapClick(pt) {
  if (!isPlayAllowed()) return syncFullscreenGate();
  unlockAudio();
  const h = hitTest(pt.nx, pt.ny);
  if (!h) return;
  if (h.type === 'trash') selectTrash(h.id);
  if (h.type === 'puzzle') collectPiece(h.id);
  if (h.type === 'fact') showFact(h);
}

function hitTest(nx, ny) {
  return [...state.data.hotspots].reverse().find(h => nx >= h.x - h.w / 2 && nx <= h.x + h.w / 2 && ny >= h.y - h.h / 2 && ny <= h.y + h.h / 2 && !(h.type === 'trash' && state.foundTrash.has(h.id)) && !(h.type === 'puzzle' && state.foundPieces.has(h.id)) && h.type !== 'disabled');
}

function itemPreviewSrc(it) {
  if (!it) return TRASH_ASSETS + 'placeholder.png';
  if (it.image) return it.image.startsWith('/') ? it.image : TRASH_ASSETS + it.image;
  if (it.imageOriginal) return TRASH_ASSETS + it.imageOriginal;
  return TRASH_ASSETS + 'placeholder.png';
}

const normalizeBinId = id => BIN_GAME_MAP[id] || id;

function popupLayout() {
  return state.data?.modalLayout || {};
}

function getSharedLayout() {
  const L = popupLayout();
  return L.targetLayout?.shared || L.sharedModal || {};
}

function getScreenLayout(name) {
  const L = popupLayout();
  return L.targetLayout?.screens?.[name] || L.screens?.[name] || {};
}

function parsePct(v, fallback = 50) {
  if (v == null || v === '') return fallback;
  return parseFloat(String(v).replace('%', '')) || fallback;
}

function layoutToBox(spec = {}) {
  const pos = spec.position || {};
  const size = spec.size || {};
  return {
    x: parsePct(pos.x ?? spec.x),
    y: parsePct(pos.y ?? spec.y),
    width: size.width != null ? parsePct(size.width) : undefined,
    height: size.height != null ? parsePct(size.height) : undefined,
    zIndex: spec.zIndex,
    anchor: spec.anchor || 'center'
  };
}

function phBoxStyle(box = {}) {
  const anchor = box.anchor || 'center';
  const parts = [`left:${box.x ?? 50}%`, `top:${box.y ?? 50}%`];
  if (box.width != null) parts.push(`width:${box.width}%`);
  if (box.height != null) parts.push(`height:${box.height}%`);
  if (box.zIndex != null) parts.push(`z-index:${box.zIndex}`);
  if (anchor === 'top-center') parts.push('transform:translate(-50%,0)');
  else if (anchor === 'center') parts.push('transform:translate(-50%,-50%)');
  return parts.join(';');
}

function classificationSlotPx() {
  const shared = getSharedLayout();
  const frameSpec = shared.modalFrame || shared.modal || {};
  const pos = frameSpec.position || { x: 50, y: 55 };
  const size = frameSpec.size || { width: 94, height: 88 };
  return {
    x: parsePct(pos.x, 50),
    y: parsePct(pos.y, 55),
    width: (parsePct(size.width ?? frameSpec.width, 94) / 100) * STAGE_W,
    height: (parsePct(size.height ?? frameSpec.height, 88) / 100) * STAGE_H
  };
}

function visibleStageDesignRect() {
  const viewport = $('#phViewport');
  if (!viewport) {
    return { left: 0, top: 0, width: STAGE_W, height: STAGE_H };
  }

  const visible = visibleViewportRect(viewport);
  const scaleW = visible.width / STAGE_W;
  const scaleH = visible.height / STAGE_H;
  const stageScale = state.screen === 'game'
    ? Math.max(scaleW, scaleH)
    : Math.min(scaleW, scaleH);

  const renderedW = STAGE_W * stageScale;
  const renderedH = STAGE_H * stageScale;
  const stageLeft = visible.left + (visible.width - renderedW) / 2;
  const stageTop = visible.top + (visible.height - renderedH) / 2;

  const left = Math.max(0, -stageLeft / stageScale);
  const top = Math.max(0, -stageTop / stageScale);
  const right = Math.min(STAGE_W, (visible.width - stageLeft) / stageScale);
  const bottom = Math.min(STAGE_H, (visible.height - stageTop) / stageScale);

  return {
    left,
    top,
    width: Math.max(1, right - left),
    height: Math.max(1, bottom - top)
  };
}

function classificationPlacement() {
  const slot = classificationSlotPx();
  const vis = visibleStageDesignRect();
  const safeX = 16;
  const safeY = 16;

  const availableW = Math.max(1, vis.width - safeX * 2);
  const availableH = Math.max(1, vis.height - safeY * 2);
  const fitScale = Math.min(
    1,
    availableW / CLS_DESIGN_W,
    availableH / CLS_DESIGN_H
  );
  const renderedW = CLS_DESIGN_W * fitScale;
  const renderedH = CLS_DESIGN_H * fitScale;
  const halfW = renderedW / 2;
  const halfH = renderedH / 2;

  let centerX = (slot.x / 100) * STAGE_W;
  let centerY = (slot.y / 100) * STAGE_H;
  const minX = vis.left + safeX + halfW;
  const maxX = vis.left + vis.width - safeX - halfW;
  const minY = vis.top + safeY + halfH;
  const maxY = vis.top + vis.height - safeY - halfH;

  if (minX <= maxX) centerX = Math.max(minX, Math.min(maxX, centerX));
  else centerX = vis.left + vis.width / 2;

  if (minY <= maxY) centerY = Math.max(minY, Math.min(maxY, centerY));
  else centerY = vis.top + vis.height / 2;

  return { centerX, centerY, fitScale };
}

function applyClassificationPlacement(modalEl) {
  if (!modalEl) return;
  const place = classificationPlacement();
  modalEl.style.left = `${(place.centerX / STAGE_W) * 100}%`;
  modalEl.style.top = `${(place.centerY / STAGE_H) * 100}%`;
  modalEl.style.transformOrigin = '50% 50%';
  modalEl.style.transform = `translate(-50%, -50%) scale(${place.fitScale})`;
}

function refreshClassificationScale() {
  applyClassificationPlacement($('#modalRoot .ph-modal--classification'));
}

function openClassificationModal(screenId, bodyHtml) {
  const shared = getSharedLayout();
  const overlay = shared.gameBackdrop?.dimOverlay?.opacity ?? shared.backdrop?.overlayOpacity ?? 0.25;
  const place = classificationPlacement();
  $('#modalRoot').innerHTML = `<div class="modal-backdrop ph-trash-backdrop" style="background:rgba(0,0,0,${overlay})!important">
    <div class="ph-modal ph-modal--classification ph-cls-scaler" id="${esc(screenId)}" style="left:${(place.centerX / STAGE_W) * 100}%;top:${(place.centerY / STAGE_H) * 100}%;transform-origin:50% 50%;transform:translate(-50%,-50%) scale(${place.fitScale})">
      <div class="ph-cls-design">
        <div class="ph-modal-frame" aria-hidden="true"></div>
        <button class="ph-modal-close close-btn" data-action="continue" aria-label="Đóng">${img(UI + 'btn-close.png', 'Đóng')}</button>
        <div class="ph-modal-content">${bodyHtml}</div>
      </div>
    </div>
  </div>`;
  requestAnimationFrame(refreshClassificationScale);
}

function openTrashModal(screenClass, screenId, bodyHtml) {
  const shared = getSharedLayout();
  const frameSpec = shared.modalFrame || shared.modal || {};
  const pos = frameSpec.position || { x: 50, y: 58 };
  const size = frameSpec.size || { width: 88, height: 76 };
  const modalW = parsePct(size.width ?? frameSpec.width, 88);
  const modalH = parsePct(size.height ?? frameSpec.height, 76);
  const modalX = parsePct(pos.x, 50);
  const modalY = parsePct(pos.y, 58);
  const frameInset = parsePct(frameSpec.innerBorder?.inset, 2);
  const overlay = shared.gameBackdrop?.dimOverlay?.opacity ?? shared.backdrop?.overlayOpacity ?? 0.25;
  const closeBtn = shared.closeButton || {};
  const closeBox = {
    x: parsePct(closeBtn.position?.x, 92.5),
    y: parsePct(closeBtn.position?.y, 6.5),
    width: parsePct(closeBtn.size?.width, 5.8),
    height: parsePct(closeBtn.size?.height, 8.5),
    zIndex: closeBtn.zIndex ?? 100,
    anchor: 'top-center'
  };
  const decorItems = shared.decorations?.items || [];
  const decorHtml = decorItems.map(d => {
    const cls = d.type === 'sparkle' ? 'ph-sparkle' : 'ph-lines';
    return `<span class="${cls}" style="left:${parsePct(d.position?.x)}%;top:${parsePct(d.position?.y)}%"></span>`;
  }).join('');
  $('#modalRoot').innerHTML = `<div class="modal-backdrop ph-trash-backdrop" style="background:rgba(0,0,0,${overlay})!important">
    <div class="ph-modal ${screenClass}" id="${esc(screenId)}" style="left:${modalX}%;top:${modalY}%;width:${modalW}%;height:${modalH}%;transform:translate(-50%,-50%)">
      <div class="ph-modal-frame" style="inset:${frameInset}%">
        <button class="ph-modal-close close-btn" data-action="continue" aria-label="Đóng" style="${phBoxStyle(closeBox)};z-index:${closeBox.zIndex}">${img(UI + 'btn-close.png', 'Đóng')}</button>
        <div class="ph-modal-decor" aria-hidden="true">${decorHtml}</div>
        <div class="ph-modal-content">${bodyHtml}</div>
      </div>
    </div>
  </div>`;
}

function selectTrash(id) {
  const h = getHotspot(id);
  const it = getItem(h?.trashId);
  if (!h || !it) return;
  playSfx('pickup');
  state.selected = { hotspot: h, item: it };
  showClassification(it);
}

function getClassificationBins(screen) {
  const fromLayout = screen?.elements?.bins?.items || screen?.layout?.bins?.items;
  const fallback = [
    { id: 'recycle', label: 'Nhựa tái chế' },
    { id: 'reuse', label: 'Nhựa tái sử dụng' },
    { id: 'hardRecycle', label: 'Nhựa khó tái chế' },
    { id: 'contaminated', label: 'Nhựa ô nhiễm' }
  ];
  const items = Array.isArray(fromLayout) && fromLayout.length ? fromLayout : fallback;
  return items.map(item => ({ ...item, id: item.id === 'hard_recycle' ? 'hardRecycle' : item.id }));
}

function showClassification(it) {
  const preview = itemPreviewSrc(it);
  const screen = getScreenLayout('classification');
  const instruction = screen.elements?.instructionText?.text || screen.layout?.instructionText?.text || 'Hãy phân loại vật phẩm nhựa vào thùng phù hợp';
  const binsHtml = getClassificationBins(screen).map(b => {
    const gameId = normalizeBinId(b.id);
    const binDef = bins[gameId] || { name: b.label || b.id, img: UI + 'bin-recycle.png' };
    return `<button class="ph-bin-choice" data-bin="${esc(b.id)}" title="${esc(binDef.name)}" aria-label="${esc(binDef.name)}">
      <img src="${binDef.img}" alt="${esc(binDef.name)}" draggable="false" />
    </button>`;
  }).join('');

  openClassificationModal(screen.id || 'classification-popup', `
    <div class="ph-classification-layout">
      <h2 class="ph-cls-title">${esc(it.name)}</h2>
      <div class="ph-trash-card">
        <img class="ph-trash-art" src="${preview}" alt="${esc(it.name)}" draggable="false" onerror="this.onerror=null;this.style.display='none';this.closest('.ph-trash-card').classList.add('ph-trash-card--missing')" />
      </div>
      <p class="ph-cls-instruction"><span class="ph-instr-mark" aria-hidden="true"></span><span class="ph-instr-text">${esc(instruction)}</span><span class="ph-instr-mark" aria-hidden="true"></span></p>
      <div class="ph-bin-row">${binsHtml}</div>
    </div>
  `);
  const root = $('#modalRoot');
  root.querySelector('[data-action="continue"]').onclick = closeModal;
  root.querySelectorAll('[data-bin]').forEach(btn => btn.onclick = () => answer(btn.dataset.bin));
}

function answer(chosen) {
  unlockAudio();
  playSfx('bin');
  const { hotspot: h, item: it } = state.selected;
  const normalized = normalizeBinId(chosen);
  const correct = normalized === it.bin;
  state.score += correct ? state.data.config.scoreCorrect : state.data.config.scoreWrong;
  if (correct) {
    state.foundTrash.add(h.id);
    renderMapObjects();
    updateHud();
    showFeedback('correct', it);
    if (state.foundTrash.size >= totalTrash()) setTimeout(() => endGame('complete'), 300);
    return;
  }
  updateHud();
  showFeedback('wrong', it);
}

function showFeedback(variant, it) {
  playSfx(variant === 'correct' ? 'correct' : 'wrong');
  const screen = getScreenLayout('feedback');
  const variantData = screen.variantMap?.[variant] || {};
  const title = variantData.title || (variant === 'correct' ? 'Chúc mừng bạn đã phân loại đúng' : 'Bạn phân loại sai rồi, nhựa này cần được xử lí theo cách khác!');
  const charSrc = variantData.characterImage || `${PLASTY}plasty-${variant === 'correct' ? 'v' : 'x'}.png`;
  const titleWidth = variantData.titleBoxWidth ?? (variant === 'correct' ? 68 : 88);
  const titleHtml = esc(title);
  const explainText = it.explanation || it.shortExplanation || '';

  openTrashModal(`ph-modal--feedback ph-modal--feedback-${variant}`, screen.id || 'answer-feedback-popup', `
    <div class="ph-feedback-layout" data-variant="${esc(variant)}">
      <img class="ph-feedback-char" src="${charSrc}" alt="Plasty" draggable="false" />
      <div class="ph-feedback-panel">
        <div class="ph-result-title" style="--ph-result-title-w:${titleWidth}%"><span>${titleHtml}</span></div>
        <div class="ph-explain-box"><div class="ph-explain-inner"><p>${esc(explainText)}</p></div></div>
      </div>
    </div>
  `);
  $('#modalRoot [data-action="continue"]').onclick = closeModal;
}

function shorten(text, max = 170) {
  text = String(text || '').trim();
  if (text.length <= max) return text;
  return text.slice(0, max - 1).trim() + '…';
}

function closeModal() {
  closeLeaderboard();
}

function closeLeaderboard() {
  resumeTimer();
  document.querySelectorAll('.leaderboard-open').forEach(el => el.classList.remove('leaderboard-open'));
  document.querySelectorAll('.leaderboard-overlay').forEach(el => el.remove());
  const m = $('#modalRoot');
  const restoreResult = state.gameEnded && state.screen === 'game';
  if (m && !restoreResult) m.innerHTML = '';
  if (restoreResult) {
    if (!m.querySelector('.result-popup')) showResultModal();
    else mapRootEl()?.classList.add('map-locked');
  } else {
    mapRootEl()?.classList.remove('map-locked');
  }
}

function closeResultModal() {
  state.gameEnded = false;
  mapRootEl()?.classList.remove('map-locked');
  document.querySelector('.game-screen')?.classList.remove('result-open');
  const m = $('#modalRoot');
  if (m?.querySelector('.result-popup')) m.innerHTML = '';
}

function buildResultHtml() {
  const r = rankInfo(state.score);
  const badge = r.icon || UI + 'rank-badge-1.png';
  const piecesTotal = state.data?.config?.totalPieces || 4;
  return `<div class="modal-backdrop result-backdrop">
    <div class="result-popup" role="dialog" aria-label="Kết quả lượt chơi">
      <button type="button" class="result-close" data-action="result-close" aria-label="Đóng">${img(UI + 'btn-close.png', 'Đóng')}</button>
      <div class="result-popup-inner">
        <div class="result-head-group">
          ${img(UI + 'logo-line.png', 'Thợ Săn Nhựa', 'result-popup-logo')}
        </div>
        <div class="result-hero-group">
          <div class="result-score">${fmtResultScore(state.score)}</div>
          <div class="result-badge-wrap">
            <div class="result-badge-fx" aria-hidden="true">
              <span class="result-badge-glow"></span>
              <span class="result-badge-ray"></span>
              <span class="result-badge-sparkle s1"></span>
              <span class="result-badge-sparkle s2"></span>
              <span class="result-badge-sparkle s3"></span>
              <span class="result-badge-sparkle s4"></span>
              <span class="result-badge-sparkle s5"></span>
              <span class="result-badge-sparkle s6"></span>
            </div>
            <div class="result-badge-slot">${img(badge, r.name, 'result-badge-img')}</div>
          </div>
          <h2 class="result-rank-name">${esc(r.name)}</h2>
        </div>
        <div class="result-controls-group">
          <div class="result-stats-row">
            ${resultStatBox(resultStatIcon(RESULT_STAT_ICONS.items), `${state.foundTrash.size}/${totalTrash()} vật phẩm`)}
            ${resultStatBox(resultStatIcon(RESULT_STAT_ICONS.pieces), `${state.foundPieces.size}/${piecesTotal} mảnh`)}
          </div>
          <div class="result-save-row">
            <input id="saveName" type="text" maxlength="24" value="${esc(state.playerName)}" placeholder="Tên người chơi" aria-label="Tên người chơi" />
            ${textButton('Lưu điểm', 'save-score', 'primary result-save-btn')}
          </div>
          <div class="result-nav-row">
            ${iconTextButton('Trang chủ', 'home', RESULT_SVG.home, 'secondary result-nav-btn')}
            ${iconTextButton('Xem BXH', 'leaderboard', img(UI + 'btn-leader-round.png', '', 'result-btn-icon'), 'secondary result-nav-btn')}
            ${iconTextButton('Chơi lại', 'replay', img(UI + 'btn-replay.png', '', 'result-btn-icon'), 'secondary result-nav-btn')}
          </div>
        </div>
      </div>
    </div>
  </div>`;
}

function showResultModal() {
  if (state.screen !== 'game') return;
  mapRootEl()?.classList.add('map-locked');
  document.querySelector('.game-screen')?.classList.add('result-open');
  $('#modalRoot').innerHTML = buildResultHtml();
  bindActions($('#modalRoot'));
  $('#modalRoot [data-action="result-close"]')?.addEventListener('click', () => {
    closeResultModal();
    setScreen('home');
  });
}

function collectPiece(id) {
  if (state.foundPieces.has(id)) return;
  playSfx('pickup');
  state.foundPieces.add(id);
  state.score += state.data.config.scorePiece;
  renderMapObjects();
  updateHud();
  const n = state.foundPieces.size;
  if (n >= 4) {
    toast('Đã ghép đủ 4 mảnh thông điệp!');
    setTimeout(() => showMessageAssembly(), 350);
    return;
  }
  $('#modalRoot').innerHTML = `<div class="modal-backdrop"><div class="piece-modal panel-card">
    <button class="close-btn" data-action="continue">${img(UI + 'btn-close.png', 'Đóng')}</button>
    <h2>Nhặt được mảnh ghép!</h2>
    <div class="piece-preview">${[1, 2, 3, 4].map(i => `<img class="${i <= n ? 'active' : ''}" src="${UI}message-piece-${i}.png" />`).join('')}</div>
    <p>Tiến độ: <b>${n}/4</b> mảnh ghép • +50 điểm</p>
    <div class="piece-actions">${assetButton(BTN_CONTINUE, 'Nhận', 'continue', 'receive-message-btn piece-continue-btn')}</div>
  </div></div>`;
  bindActions($('#modalRoot'));
}

const MESSAGE_ASSETS = {
  globeComplete: UI + 'message-globe-complete.png',
  globeLeft: UI + 'message-globe-half-left.png',
  globeRight: UI + 'message-globe-half-right.png',
  messageBanner: UI + 'thong-diep.png',
  messageCut: UI + 'thong-diep-cut.png'
};
/** banner 4732×1520 | puzzle 936+920 | cut 3572px khớp banner tại x576 */
const MESSAGE_LAYOUT = { bannerW: 4732, bannerH: 1520, leftW: 936, rightW: 920, cutLeft: 576, cutW: 3572 };
let messageAnimating = false;

function preloadMessageAssets() {
  Object.values(MESSAGE_ASSETS).forEach(src => {
    const el = new Image();
    el.src = src;
  });
}

function showMessageAssembly() {
  if (state.foundPieces.size < 4) return toast('Bạn cần thu đủ 4 mảnh ghép để mở thông điệp.');
  messageAnimating = false;
  mapRootEl()?.classList.add('map-locked');
  preloadMessageAssets();
  const { bannerW, leftW, rightW, cutLeft, cutW } = MESSAGE_LAYOUT;
  const globe = MESSAGE_ASSETS.globeComplete;
  const gapW = bannerW - leftW - rightW;
  const closedPct = ((leftW + rightW) / bannerW * 100).toFixed(4);
  const clipPct = ((1 - (leftW + rightW) / bannerW) / 2 * 100).toFixed(4);
  const cutLeftPct = (cutLeft / bannerW * 100).toFixed(4);
  const cutRightPct = ((bannerW - cutLeft - cutW) / bannerW * 100).toFixed(4);
  const cutWidthPct = (cutW / bannerW * 100).toFixed(4);
  $('#modalRoot').innerHTML = `<div class="modal-backdrop message-stage-backdrop"><div class="message-flow" id="messageFlow" style="--piece-left:${(leftW / bannerW * 100).toFixed(4)}%;--piece-right:${(rightW / bannerW * 100).toFixed(4)}%;--cut-left:${cutLeftPct}%;--cut-right:${cutRightPct}%;--cut-width:${cutWidthPct}%;--closed-span:${closedPct}%;--clip-side:${clipPct}%">
    <div class="message-canvas">
      <div class="message-reveal-stage">
        <div class="message-reveal-viewport">
          <div class="message-banner-center" aria-hidden="true">
            ${img(MESSAGE_ASSETS.messageCut, 'Thông điệp', 'message-cut-img')}
          </div>
          <div class="shutter-panel shutter-left" aria-hidden="true">${img(MESSAGE_ASSETS.globeLeft, '', 'shutter-piece')}</div>
          <div class="shutter-panel shutter-right" aria-hidden="true">${img(MESSAGE_ASSETS.globeRight, '', 'shutter-piece')}</div>
          ${img(globe, '4 mảnh ghép hoàn chỉnh', 'message-globe-idle')}
        </div>
        <div class="message-claim-wrap" aria-hidden="true">
          ${assetButton(UI + 'btn-claim.png', 'Nhận', 'continue', 'claim-message-btn')}
        </div>
      </div>
      ${assetButton(UI + 'btn-receive-message.png', 'Nhận thông điệp', 'message-split', 'receive-message-btn')}
    </div>
  </div></div>`;
  bindActions($('#modalRoot'));
}

function playMessageSplit() {
  if (messageAnimating) return;
  const flow = $('#messageFlow');
  if (!flow) return;
  playSfx('message');
  messageAnimating = true;
  flow.querySelectorAll('.shutter-panel').forEach(el => el.setAttribute('aria-hidden', 'false'));
  flow.querySelector('.message-banner-center')?.setAttribute('aria-hidden', 'false');
  flow.querySelector('.message-claim-wrap')?.setAttribute('aria-hidden', 'false');
  requestAnimationFrame(() => {
    requestAnimationFrame(() => flow.classList.add('splitting'));
  });
  flow.addEventListener('animationend', onMessageFlowEnd);
}

function onMessageFlowEnd(e) {
  if (e.target?.id !== 'messageFlow' || e.animationName !== 'revealTimeline') return;
  const flow = $('#messageFlow');
  flow?.classList.add('split-done');
  flow?.removeEventListener('animationend', onMessageFlowEnd);
  messageAnimating = false;
}

function resolveFactForHotspot(h) {
  if (!h?.factId) return null;
  const byId = state.data?.factsById?.[h.factId];
  if (byId) return byId;
  const idx = Number(String(h.factId).replace(/\D/g, '')) - 1;
  if (idx >= 0 && state.data?.facts?.[idx]) return state.data.facts[idx];
  return null;
}

function showFact(h) {
  const fact = resolveFactForHotspot(h);
  if (!fact) {
    toast('Vùng này chưa gắn fact. Mở editor và chọn Fact ID cho hotspot.', 4000);
    return;
  }
  playSfx('pickup');
  state.foundFacts.add(fact.id);
  toast(fact.text, 5500);
}

function useHint() {
  const list = activeTrashHotspots();
  if (!list.length) return toast('Bạn đã xử lý hết các rác có thể tìm thấy.');
  const h = list[state.hintIndex++ % list.length];
  state.map.focus(h.x * state.map.mapWidth, h.y * state.map.mapHeight, Math.max(state.map.scale, state.map.minScale * 2.2));
  const dot = document.createElement('div');
  dot.className = 'hint-pulse';
  dot.style.left = (h.x * state.map.mapWidth) + 'px';
  dot.style.top = (h.y * state.map.mapHeight) + 'px';
  state.map.objectLayer.appendChild(dot);
  setTimeout(() => dot.remove(), 2200);
}

function toggleSound(btn) {
  state.muted = !state.muted;
  setMuted(state.muted);
  btn.querySelector('img').src = UI + (state.muted ? 'btn-sound-off.png' : 'btn-sound.png');
}

function showGuide(returnTo = 'home') {
  state.guideReturn = returnTo;
  const modalHtml = `<div class="guide-image-modal">
    <button class="close-btn" data-action="continue">${img(UI + 'btn-close.png', 'Đóng')}</button>
    <img class="guide-full" src="${UI}guide.png" alt="Hướng dẫn chơi và luật chơi" />
  </div>`;

  if (returnTo === 'game') {
    $('#modalRoot').innerHTML = `<div class="modal-backdrop guide-overlay">${modalHtml}</div>`;
    $('#modalRoot [data-action="continue"]').onclick = closeModal;
    return;
  }

  const host = screenHost().querySelector('.screen') || screenHost();
  host.classList.add('guide-open');
  let overlay = host.querySelector(':scope > .guide-overlay-root');
  if (!overlay) {
    overlay = document.createElement('div');
    overlay.className = 'guide-overlay-root';
    host.appendChild(overlay);
  }
  overlay.innerHTML = `<div class="modal-backdrop guide-overlay guide-backdrop--home">${modalHtml}</div>`;
  overlay.querySelector('[data-action="continue"]').onclick = () => {
    overlay.remove();
    host.classList.remove('guide-open');
  };
}

function showPlasticTypes() {
  if (state.screen === 'game') {
    $('#modalRoot').innerHTML = `<div class="modal-backdrop guide-overlay"><div class="knowledge-modal guide-image-modal">
      <button class="close-btn" data-action="continue">${img(UI + 'btn-close.png', 'Đóng')}</button>
      ${img(UI + 'plastic-types.png', 'Bảng 7 loại nhựa', 'guide-full')}
    </div></div>`;
    $('#modalRoot [data-action="continue"]').onclick = closeModal;
    return;
  }

  const host = screenHost().querySelector('.screen') || screenHost();
  host.classList.add('guide-open');
  let overlay = host.querySelector(':scope > .guide-overlay-root');
  if (!overlay) {
    overlay = document.createElement('div');
    overlay.className = 'guide-overlay-root';
    host.appendChild(overlay);
  }
  overlay.innerHTML = `<div class="modal-backdrop guide-overlay guide-backdrop--home"><div class="knowledge-modal guide-image-modal">
    <button class="close-btn" data-action="continue">${img(UI + 'btn-close.png', 'Đóng')}</button>
    ${img(UI + 'plastic-types.png', 'Bảng 7 loại nhựa', 'guide-full')}
  </div></div>`;
  overlay.querySelector('[data-action="continue"]').onclick = () => {
    overlay.remove();
    host.classList.remove('guide-open');
  };
}

function rankInfo(score) {
  const ranks = state.data.config.ranks || [];
  return [...ranks].reverse().find(r => score >= r.minScore) || ranks[0] || { name:'Thợ săn tập sự', icon:UI+'rank-badge-1.png', description:'' };
}

function getScores() {
  try { return JSON.parse(localStorage.getItem(STORAGE) || '[]'); } catch { return []; }
}
function setScores(scores) { localStorage.setItem(STORAGE, JSON.stringify(scores)); }

function saveCurrentScore(btn) {
  if (state.scoreSaved) return toast('Điểm lượt này đã được lưu rồi.');
  const name = ($('#saveName')?.value || state.playerName || 'Thợ săn nhựa').trim().slice(0, 24) || 'Thợ săn nhựa';
  state.playerName = name;
  localStorage.setItem('plasticHunterName', name);
  const scores = getScores();
  scores.push({ name, score: state.score, rank: rankInfo(state.score).name, date: new Date().toLocaleString('vi-VN') });
  scores.sort((a, b) => b.score - a.score);
  setScores(scores);
  state.scoreSaved = true;
  if (btn) { btn.disabled = true; btn.textContent = 'Đã lưu'; }
  toast('Đã lưu điểm vào bảng xếp hạng!');
}

function renderLeaderRank(index) {
  if (index < 3) return `<img src="${UI}rank-${index + 1}.png" alt="Hạng ${index + 1}" />`;
  return `<span class="leader-rank-badge">${index + 1}</span>`;
}

function buildLeaderboardHtml(ctx) {
  const scores = getScores();
  const rows = scores.length
    ? scores.map((s, i) => `<div class="leader-row">
        <span class="leader-rank">${renderLeaderRank(i)}</span>
        <span class="leader-name" title="${esc(s.name)}">${esc(s.name)}</span>
        <span class="leader-score">${s.score}</span>
      </div>`).join('')
    : `<div class="leader-empty">
        <p>Chưa có điểm nào.</p>
        <p>Hãy chơi một lượt và lưu điểm nhé!</p>
      </div>`;
  const backdropClass = ctx === 'game' ? 'leaderboard-backdrop--game' : 'leaderboard-backdrop--home';
  return `<div class="modal-backdrop leaderboard-backdrop ${backdropClass}">
    <div class="leaderboard-modal" role="dialog" aria-label="Bảng xếp hạng">
      <img class="leader-frame" src="${UI}leaderboard-frame.png" alt="" draggable="false" />
      <button type="button" class="leader-close" data-action="leaderboard-close" aria-label="Đóng">${img(UI + 'btn-close.png', 'Đóng')}</button>
      <div class="leaderboard-panel">
        <div class="leader-head">
          <span class="leader-head-rank" aria-hidden="true"></span>
          <span class="leader-head-name">DANH TÍNH THỢ SĂN</span>
          <span class="leader-head-score">ĐIỂM</span>
        </div>
        <div class="leader-list-scroll">${scores.length ? `<div class="leader-list">${rows}</div>` : rows}</div>
      </div>
      <button type="button" class="leader-replay-btn" data-action="leaderboard-replay" aria-label="${ctx === 'game' ? 'Chơi lại' : 'Chơi ngay'}">${img(UI + 'btn-replay.png', ctx === 'game' ? 'Chơi lại' : 'Chơi ngay')}</button>
    </div>
  </div>`;
}

function bindLeaderboard(root, ctx) {
  root.querySelector('[data-action="leaderboard-close"]')?.addEventListener('click', closeLeaderboard);
  root.querySelector('[data-action="leaderboard-replay"]')?.addEventListener('click', () => {
    closeLeaderboard();
    if (ctx === 'game') startGame();
    else setScreen('name');
  });
  const scroll = root.querySelector('.leader-list-scroll');
  scroll?.addEventListener('wheel', e => e.stopPropagation(), { passive: true });
}

function showLeaderboard() {
  const ctx = state.screen;
  const html = buildLeaderboardHtml(ctx);

  if (ctx === 'game') {
    pauseTimer();
    mapRootEl()?.classList.add('map-locked');
    $('#modalRoot').innerHTML = html;
    bindLeaderboard($('#modalRoot'), ctx);
    return;
  }

  const host = screenHost().querySelector('.screen') || screenHost();
  host.classList.add('leaderboard-open');
  let overlay = host.querySelector(':scope > .leaderboard-overlay');
  if (!overlay) {
    overlay = document.createElement('div');
    overlay.className = 'leaderboard-overlay';
    host.appendChild(overlay);
  }
  overlay.innerHTML = html;
  bindLeaderboard(overlay, ctx);
}

function toast(text, ms = 3000) {
  ensureViewportShell();
  const root = $('#toastRoot');
  const el = document.createElement('div');
  el.className = 'toast';
  el.textContent = text;
  root.appendChild(el);
  setTimeout(() => el.remove(), ms);
}

function applyPreviewFlags() {
  const params = new URLSearchParams(location.search);
  if (!params.has('preview-message')) return;
  state.data.hotspots.filter(h => h.type === 'puzzle').forEach(h => state.foundPieces.add(h.id));
  setTimeout(() => showMessageAssembly(), 1400);
}

(async function boot() {
  try {
    console.info('[Thợ Săn Nhựa] Build:', BUILD_TAG, '— mở F12 > Console nếu không thấy thay đổi, thử Ctrl+F5');
    initAudio();
    await loadData();
    applyPreviewFlags();
    ensureViewportShell();
    renderLoading();
    setTimeout(() => {
      setScreen('home');
      syncFullscreenGate();
    }, 1000);
  } catch (err) {
    console.error(err);
    app.innerHTML = `<pre style="padding:20px;color:#fff;background:#111;height:100vh;white-space:pre-wrap">Game error: ${esc(err.message)}</pre>`;
  }
})();

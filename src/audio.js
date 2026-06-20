const SOUND = '/assets/sound/';

const TRACKS = {
  bgm: `${SOUND}nhac_nen.mp3`,
  click: `${SOUND}click_nut.mp3`,
  pickup: `${SOUND}nhat_nhua.mp3`,
  bin: `${SOUND}luc_nem_rac_vao_thung.mp3`,
  correct: `${SOUND}phan_loai_dung.mp3`,
  wrong: `${SOUND}phan_loai_sai.mp3`,
  message: `${SOUND}luc_mo_thong_diep.mp3`
};

const BGM_SCREENS = new Set(['home', 'story', 'name', 'game']);
const VOLUME = { bgm: 0.48, sfx: 0.68 };
const NO_CLICK = new Set(['sound', 'message-split']);

let muted = false;
let unlocked = false;
let bgmEl = null;
let currentScreen = 'loading';
const sfx = {};

function preloadSfx(name) {
  const el = new Audio(TRACKS[name]);
  el.preload = 'auto';
  el.volume = VOLUME.sfx;
  el.load();
  sfx[name] = el;
}

function playClick() {
  const el = sfx.click;
  if (!el || muted || !unlocked) return;
  try {
    if (el.paused) {
      el.currentTime = 0;
      void el.play();
      return;
    }
    const burst = el.cloneNode();
    burst.volume = VOLUME.sfx;
    void burst.play();
  } catch (_) {}
}

export function initAudio() {
  bgmEl = new Audio(TRACKS.bgm);
  bgmEl.loop = true;
  bgmEl.volume = VOLUME.bgm;
  bgmEl.preload = 'auto';
  Object.keys(TRACKS).forEach(name => {
    if (name !== 'bgm') preloadSfx(name);
  });
}

export function unlockAudio() {
  if (unlocked) return;
  unlocked = true;
  const el = sfx.click;
  if (!el) {
    syncBgm(currentScreen);
    return;
  }
  const vol = el.volume;
  el.volume = 0.001;
  el.play()
    .then(() => {
      el.pause();
      el.currentTime = 0;
      el.volume = vol;
      syncBgm(currentScreen);
    })
    .catch(() => syncBgm(currentScreen));
}

export function bindButtonClickSound(btn) {
  if (!btn || btn.dataset.phClickBound) return;
  btn.dataset.phClickBound = '1';
  btn.addEventListener('pointerdown', e => {
    if (e.button !== 0) return;
    unlockAudio();
    const action = btn.dataset.action;
    if (!action || NO_CLICK.has(action)) return;
    playClick();
  }, { passive: true });
}

export function setMuted(value) {
  muted = !!value;
  if (!bgmEl) return;
  if (muted) bgmEl.pause();
  else if (unlocked && BGM_SCREENS.has(currentScreen)) bgmEl.play().catch(() => {});
}

export function syncBgm(screen) {
  currentScreen = screen;
  if (!bgmEl || !unlocked || muted) {
    bgmEl?.pause();
    return;
  }
  if (!BGM_SCREENS.has(screen)) {
    bgmEl.pause();
    return;
  }
  if (bgmEl.paused) bgmEl.play().catch(() => {});
}

export function playSfx(name) {
  if (muted || !unlocked || !TRACKS[name]) return;
  if (name === 'click') return playClick();
  const base = sfx[name];
  if (!base) return;
  const el = base.cloneNode();
  el.volume = VOLUME.sfx;
  el.play().catch(() => {});
}
/**
 * One fixed 1280×720 design coordinate system for the whole game.
 *
 * The browser, Windows DPI and browser zoom may change the visible CSS
 * viewport, but they never change the internal game layout. Menu screens use a
 * home backdrop behind a contain-scaled stage; ingame the stage uses cover and
 * the real tile map camera uses cover zoom inside map-root.
 */
export const DESIGN_WIDTH = 1280;
export const DESIGN_HEIGHT = 720;

export function visibleViewportRect(viewport) {
  const layoutRect = viewport.getBoundingClientRect();
  const layoutWidth = layoutRect.width || viewport.clientWidth || window.innerWidth;
  const layoutHeight = layoutRect.height || viewport.clientHeight || window.innerHeight;
  const visual = window.visualViewport;

  // Desktop browser zoom normally changes the layout viewport dimensions.
  // Pinch zoom can additionally shrink/offset the visual viewport. Supporting
  // both makes the stage deterministic from 25% through 500% zoom.
  const width = visual?.width ? Math.min(layoutWidth, visual.width) : layoutWidth;
  const height = visual?.height ? Math.min(layoutHeight, visual.height) : layoutHeight;
  const left = visual?.offsetLeft || 0;
  const top = visual?.offsetTop || 0;

  return {
    width: Math.max(1, width),
    height: Math.max(1, height),
    left,
    top
  };
}

export function initViewport({ stage, viewport, onResize, getScaleMode }) {
  if (!stage || !viewport) return { destroy() {}, refresh() {} };

  let raf = 0;
  let lastKey = '';

  const applyNow = () => {
    raf = 0;

    const visible = visibleViewportRect(viewport);
    const scaleW = visible.width / DESIGN_WIDTH;
    const scaleH = visible.height / DESIGN_HEIGHT;
    const mode = getScaleMode?.() ?? 'contain';
    const rawScale = mode === 'cover'
      ? Math.max(scaleW, scaleH)
      : Math.min(scaleW, scaleH);
    const scale = Math.max(0.01, Math.round(rawScale * 100000) / 100000);

    viewport.dataset.stageScale = mode;

    const renderedWidth = DESIGN_WIDTH * scale;
    const renderedHeight = DESIGN_HEIGHT * scale;
    const stageLeft = visible.left + (visible.width - renderedWidth) / 2;
    const stageTop = visible.top + (visible.height - renderedHeight) / 2;

    stage.style.width = `${DESIGN_WIDTH}px`;
    stage.style.height = `${DESIGN_HEIGHT}px`;
    stage.style.left = '0px';
    stage.style.top = '0px';
    stage.style.transformOrigin = '0 0';
    stage.style.transform = `translate3d(${stageLeft}px, ${stageTop}px, 0) scale(${scale})`;

    const root = document.documentElement;
    root.style.setProperty('--ph-design-w', String(DESIGN_WIDTH));
    root.style.setProperty('--ph-design-h', String(DESIGN_HEIGHT));
    // These are design units, deliberately independent of the live viewport.
    root.style.setProperty('--ph-vw', `${DESIGN_WIDTH / 100}px`);
    root.style.setProperty('--ph-vh', `${DESIGN_HEIGHT / 100}px`);
    root.style.setProperty('--ph-scale', String(scale));
    root.style.setProperty('--ph-stage-left', `${stageLeft}px`);
    root.style.setProperty('--ph-stage-top', `${stageTop}px`);

    const visibleDesignW = visible.width / scale;
    const visibleDesignH = visible.height / scale;
    const cropX = mode === 'cover' ? Math.max(0, (DESIGN_WIDTH - visibleDesignW) / 2) : 0;
    const cropY = mode === 'cover' ? Math.max(0, (DESIGN_HEIGHT - visibleDesignH) / 2) : 0;
    root.style.setProperty('--ph-crop-x', `${cropX}px`);
    root.style.setProperty('--ph-crop-y', `${cropY}px`);

    const key = `${scale}|${stageLeft.toFixed(3)}|${stageTop.toFixed(3)}|${visible.width.toFixed(3)}|${visible.height.toFixed(3)}`;
    if (key !== lastKey) {
      lastKey = key;
      onResize?.(scale, visible);
    }
  };

  const apply = () => {
    cancelAnimationFrame(raf);
    raf = requestAnimationFrame(applyNow);
  };

  const resizeObserver = new ResizeObserver(apply);
  resizeObserver.observe(viewport);

  window.addEventListener('resize', apply, { passive: true });
  window.addEventListener('orientationchange', apply, { passive: true });
  window.addEventListener('pageshow', apply, { passive: true });
  window.visualViewport?.addEventListener('resize', apply, { passive: true });
  window.visualViewport?.addEventListener('scroll', apply, { passive: true });

  // A downloaded webfont can trigger a late reflow. Re-apply the outer scale
  // afterwards without changing any internal coordinates.
  document.fonts?.ready?.then(apply).catch(() => {});
  apply();

  return {
    refresh: apply,
    destroy() {
      cancelAnimationFrame(raf);
      resizeObserver.disconnect();
      window.removeEventListener('resize', apply);
      window.removeEventListener('orientationchange', apply);
      window.removeEventListener('pageshow', apply);
      window.visualViewport?.removeEventListener('resize', apply);
      window.visualViewport?.removeEventListener('scroll', apply);
    }
  };
}

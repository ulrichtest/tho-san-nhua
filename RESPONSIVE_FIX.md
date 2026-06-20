# Zoom / DPI invariant layout

The player-facing game now uses one fixed 1280×720 design stage.

- Browser zoom, Windows display scaling, resolution and aspect ratio only change the single outer stage scale.
- HUD, maps, popups, leaderboard and result screens keep the same internal positions and proportions.
- The stage is centered with letterboxing when the viewport aspect ratio differs.
- Live viewport media queries no longer replace the classification layout on shorter laptops.
- The viewport scale is recalculated on resize, browser zoom, orientation changes, visual viewport changes and late webfont loading.
- The classification popup keeps a fixed 1178×634 design size at every zoom level.

Build tag: `20260620-zoom-invariant-stage-v1`

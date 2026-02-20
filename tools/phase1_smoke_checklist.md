# Phase 1 Smoke Checklist

## Boot and Menu
- [ ] Main menu opens without console error.
- [ ] Patch notes render and latest version entry is visible.
- [ ] New Game opens map select.
- [ ] Continue loads if save exists.

## In-Game Core
- [ ] Start wave works from button and space key.
- [ ] Pause/resume works from space key and pause menu buttons.
- [ ] Speed slider and speed cycle button stay in sync.
- [ ] Game over modal buttons work.

## Selection and Upgrade
- [ ] Tower select shows Selected panel values.
- [ ] Upgrade button applies level/stat changes.
- [ ] Fast upgrade works and stops at milestone/modal.
- [ ] Milestone modal hover preview updates Selected panel live.
- [ ] Sell removes tower and refunds expected gold.

## Combat and Performance
- [ ] Wave spawn continues normally.
- [ ] Projectiles still hit and retarget.
- [ ] Ring effects still apply on-hit behavior.
- [ ] No visible stutter spike introduced by recent changes.
- [ ] `window.__armtdPerf = true` shows console PERF lines and HUD text.

## Save and Progress
- [ ] Save & Quit from pause writes run save.
- [ ] Continue restores run state correctly.
- [ ] Map stars/progress update after clear.
- [ ] Custom map play/load flow still works.

## Audio and Settings
- [ ] Click/shoot/wave SFX still play.
- [ ] Mute toggle works from settings and shortcut.
- [ ] Keybind changes persist after reload.

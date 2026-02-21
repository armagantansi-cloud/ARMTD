# Phase 2 Smoke Checklist

## Registry and Data Flow
- [ ] Boot succeeds and no module-init crash appears in console.
- [ ] Main menu map cards render from registry catalog (titles/images correct).
- [ ] Shop tower order matches codex/stat order (single-source order consistency).
- [ ] Gameplay can start on Map 1 and Map 2 without regression.

## Save Schema and Migration
- [ ] Existing v1 run save can be loaded via Continue.
- [ ] After loading legacy save, next Continue uses v2 save schema.
- [ ] Save & Quit still writes valid run save.
- [ ] Continue still restores map/towers/wave/coreHP/gold correctly.

## Progression and Unlock
- [ ] Map unlock still follows expected campaign progression.
- [ ] Campaign clear updates map stars/max wave and progression state.
- [ ] Codex entries remain interactable and lock-state rendering is stable.
- [ ] Main menu remains responsive after campaign clear event.

## Event/Message Layer
- [ ] No runtime errors from event bus on wave start/end transitions.
- [ ] Tower build/level-up flow works and milestone modal still appears.
- [ ] Prestige unlock flow still triggers visual/log behavior.
- [ ] Game Over -> Main Menu flow still works through event subscription path.

## Regression Guard
- [ ] `npm run check:syntax` passes.
- [ ] `npm run check:phase2` passes.
- [ ] `npm run phase2:verify` passes.

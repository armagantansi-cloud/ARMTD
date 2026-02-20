# Phase 1 Perf Baseline

## Goal
Collect comparable runtime metrics before/after performance changes using built-in sampler.

## How to capture
1. Open game in browser.
2. Open DevTools console.
3. Run:
   - `window.__armtdPerf = true`
4. Start a run and keep the same scenario each time:
   - same map
   - same wave window (example: wave 35-45)
   - same speed (example: 2.0x)
   - similar tower composition
5. Watch either console `[PERF] ...` lines or top-right perf HUD.
6. Record 20-30 seconds average.
7. Disable sampler when done:
   - `window.__armtdPerf = false`

## Metrics
- `fps`
- `frame ms`
- `update ms`
- `draw ms`
- `ui ms`

## Baseline Table
| Date | Build | Scenario | fps | frame ms | update ms | draw ms | ui ms | Notes |
|---|---|---|---:|---:|---:|---:|---:|---|
| 2026-02-20 | v0.2.58 | Fill this row |  |  |  |  |  |  |

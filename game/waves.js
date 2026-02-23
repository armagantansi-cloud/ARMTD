import { CFG } from "./config.js";
import { clamp } from "./utils.js";

let ENDLESS_EXPONENTIAL_SCALING = false;
const MAX_ENEMIES_PER_WAVE = 70;
// Conservative tuning:
// Keep overcap identity (count overflow -> stat pressure),
// but soften defense/speed growth to avoid pre-100 defensive spikes.
const OVERCAP_WEIGHTS = { hp: 0.30, armor: 0.04, mr: 0.04, speed: 0.02 };

function getWaveEnemyCap(wave){
  const w = Math.max(1, Math.floor(Number(wave) || 1));
  if (w <= 105) return MAX_ENEMIES_PER_WAVE;
  // 105+ waves grow enemy cap gradually instead of a sudden jump.
  return MAX_ENEMIES_PER_WAVE + Math.floor((w - 105) * 1.2);
}

function pre100PowerRamp(wave){
  const w = Math.max(1, wave);
  if (w <= 10) {
    // Wave 1 -> 10: early onboarding is a bit softer.
    const t = (w - 1) / 9;
    return 1 + t * 0.72; // 1.00x -> 1.72x
  }
  if (w <= 100) {
    // Wave 11 -> 100: stronger and increasingly accelerating difficulty.
    // Non-linear curve increases both growth rate and its growth.
    const t = (w - 10) / 90; // 0..1
    const accel = Math.pow(t, 1.28);
    return 2.02 + t * 4.20 + accel * 1.90; // 2.02x -> 8.12x
  }
  // 100+ keeps existing late/endless model, with updated pre-100 settle point.
  return 8.12;
}

function scaleForWave(base, wave) {
    const w = Math.max(1, wave);
    const t1 = Math.max(0, w - 20);   // mid start
    const t30 = Math.max(0, w - 30);  // post-30 boost
    const t2 = Math.max(0, w - 50);   // late start
    const t3 = Math.max(0, w - 100);  // end start

    const hpMult     = 1
      + (w - 1) * 0.20
      + Math.pow(w-1, 1.18) * 0.016
      + Math.pow(t1, 1.20) * 0.060
      + Math.pow(t30, 1.15) * 0.050
      + Math.pow(t2, 1.28) * 0.120
      + Math.pow(t3, 1.38) * 0.180;

    const defMult    = 1
      + (w - 1) * 0.20
      + Math.pow(w-1, 1.18) * 0.019
      + Math.pow(t1, 1.20) * 0.095
      + Math.pow(t30, 1.15) * 0.068
      + Math.pow(t2, 1.30) * 0.230
      + Math.pow(t3, 1.40) * 0.420;

    const speedMult  = 1
      + (w - 1) * 0.007
      + t1 * 0.0018
      + t30 * 0.0015
      + t2 * 0.0022
      + t3 * 0.0032;

    const wealthMult = 1
      + (w - 1) * 0.16
      + t1 * 0.020
      + t30 * 0.010
      + t2 * 0.035
      + t3 * 0.050;

    let hp = base.HP * hpMult;
    let speed = base.Speed * speedMult;
    let armor = base.Armor * defMult;
    const defMultHalf = 1 + (defMult - 1) * 0.5;
    let mr = base.MR * 0.5 * defMultHalf;
    let wealth = base.Wealth * wealthMult;
    if (w === 1) wealth *= 1.8; // Tutorial easing: extra economy only on wave 1.

    const rampMul = pre100PowerRamp(w);
    hp *= rampMul;
    armor *= rampMul;
    const rampMulHalf = 1 + (rampMul - 1) * 0.5;
    mr *= rampMulHalf;

    if (ENDLESS_EXPONENTIAL_SCALING && w > 100) {
      const t = w - 100;
      hp *= Math.pow(1.42, t);
      armor *= Math.pow(1.18, t);
      mr *= Math.pow(1.18, t);
      speed *= Math.pow(1.012, t);
      wealth *= Math.pow(1.30, t);
    }

    return {
      HP: Math.round(hp),
      Speed: speed,
      Armor: Math.round(armor),
      MR: Math.round(mr),
      Wealth: Math.round(wealth)
    };
  }

  function spawnIntervalForWave(wave){
    const w = Math.max(1, wave);
    const t1 = Math.max(0, w - CFG.SPAWN_INTERVAL_MID_START);
    const t2 = Math.max(0, w - CFG.SPAWN_INTERVAL_LATE_START);
    const t3 = Math.max(0, w - CFG.SPAWN_INTERVAL_END_START);

    let interval = CFG.SPAWN_INTERVAL_BASE
      - t1 * CFG.SPAWN_INTERVAL_MID_STEP
      - t2 * CFG.SPAWN_INTERVAL_LATE_STEP
      - t3 * CFG.SPAWN_INTERVAL_END_STEP;

    // Keep wave 50 as baseline pacing: slower before 50, faster after 50.
    // We widen the deviation to make early waves noticeably calmer and late waves denser.
    const BASELINE_WAVE = 50;
    const EARLY_MAX_INTERVAL = CFG.SPAWN_INTERVAL_BASE * 1.55;
    const LATE_MIN_INTERVAL = CFG.SPAWN_INTERVAL_MIN * 0.72;
    if (w < BASELINE_WAVE) {
      const earlyT = (BASELINE_WAVE - w) / (BASELINE_WAVE - 1);
      interval *= (1 + 0.55 * earlyT);
    } else if (w > BASELINE_WAVE) {
      const lateT = clamp((w - BASELINE_WAVE) / 70, 0, 1);
      interval *= (1 - 0.45 * lateT);
    }

    interval = clamp(interval, LATE_MIN_INTERVAL, EARLY_MAX_INTERVAL);
    return interval;
  }

  function burstEveryForWave(wave){
    if (wave < CFG.SPAWN_BURST_START_WAVE) return 0;
    const steps = Math.floor((wave - CFG.SPAWN_BURST_START_WAVE) / CFG.SPAWN_BURST_EVERY_STEP_WAVES);
    const every = Math.max(CFG.SPAWN_BURST_EVERY_MIN, CFG.SPAWN_BURST_EVERY_BASE - steps);
    return every;
  }

  function waveModifiers(wave){
    let resistType = null;
    if (wave >= CFG.RESIST_WAVE_START && wave % CFG.RESIST_WAVE_EVERY === 0 && wave % 10 !== 0) {
      // Alternate only across actually-applied resist waves.
      // (The old formula always produced "mr" with the current cadence.)
      const altIdx = Math.floor((wave - (CFG.RESIST_WAVE_START + CFG.RESIST_WAVE_EVERY)) / 10);
      resistType = (altIdx % 2 === 0) ? "armor" : "mr";
    }
    const overcap = getOvercapStatMul(wave);
    return { resistType, overcap };
  }

  function getRawWavePlan(wave){
    if (wave % 10 === 0) {
      const count = 1;

      const escortBase = Math.min(12, Math.floor(2 + wave / 12));
      const escortTankRatio = clamp(0.25 + (wave - 20) * 0.004, 0.25, 0.55);
      const escortTank = Math.round(escortBase * escortTankRatio);
      const escortRunner = Math.max(0, escortBase - escortTank);

      const parts = [{ type:"boss", count }];
      if (escortRunner > 0) parts.push({ type:"runner", count: escortRunner });
      if (escortTank > 0) parts.push({ type:"tank", count: escortTank });
      return parts;
    }
    const post30Bonus = Math.floor(Math.max(0, wave - 25) * 0.9);
    const total = 12 + wave * 3 + post30Bonus;
    const tankRatio = clamp((wave - 3) * 0.05, 0, 0.45);
    const tankCount = Math.round(total * tankRatio);
    let runnerCount = total - tankCount;

    let siphonCount = 0;
    if (wave >= CFG.MANA_BURN_START_WAVE) {
      const burnRatio = clamp((wave - CFG.MANA_BURN_START_WAVE) * CFG.MANA_BURN_RATIO_PER_WAVE, 0, CFG.MANA_BURN_RATIO_MAX);
      siphonCount = Math.round(total * burnRatio);
      runnerCount = Math.max(0, runnerCount - siphonCount);
    }

    const parts = [
      { type: "runner", count: runnerCount },
      { type: "tank",   count: tankCount },
      { type: "siphon", count: siphonCount }
    ].filter(x => x.count > 0);

    return parts;
  }

  function planTotal(parts){
    return parts.reduce((sum, p) => sum + (Math.max(0, Number(p?.count) || 0)), 0);
  }

  function capPlanToMax(parts, maxCount){
    const total = planTotal(parts);
    if (total <= maxCount) return parts.map(p => ({ ...p }));

    const ratio = maxCount / Math.max(1, total);
    const scaled = parts.map((p, idx) => {
      const raw = Math.max(0, (Number(p.count) || 0) * ratio);
      const base = Math.floor(raw);
      return { idx, type: p.type, count: base, frac: raw - base };
    });

    let used = scaled.reduce((sum, p) => sum + p.count, 0);
    let remain = Math.max(0, maxCount - used);
    scaled.sort((a,b) => b.frac - a.frac || b.count - a.count || a.idx - b.idx);
    for (let i = 0; i < scaled.length && remain > 0; i += 1) {
      scaled[i].count += 1;
      remain -= 1;
    }
    scaled.sort((a,b) => a.idx - b.idx);
    return scaled.filter(p => p.count > 0).map(p => ({ type: p.type, count: p.count }));
  }

  function getOvercapStatMul(wave){
    if (wave > 105) {
      return { hp: 1, armor: 1, mr: 1, speed: 1, pressure: 0 };
    }
    const rawTotal = planTotal(getRawWavePlan(wave));
    if (rawTotal <= MAX_ENEMIES_PER_WAVE) {
      return { hp: 1, armor: 1, mr: 1, speed: 1, pressure: 0 };
    }
    const overflowRatio = (rawTotal - MAX_ENEMIES_PER_WAVE) / MAX_ENEMIES_PER_WAVE;
    const budget = Math.min(7, overflowRatio * 1.8);
    return {
      hp: 1 + budget * OVERCAP_WEIGHTS.hp,
      armor: 1 + budget * OVERCAP_WEIGHTS.armor,
      mr: 1 + budget * OVERCAP_WEIGHTS.mr,
      speed: 1 + budget * OVERCAP_WEIGHTS.speed,
      pressure: overflowRatio
    };
  }

  function wavePlan(wave) {
    return capPlanToMax(getRawWavePlan(wave), getWaveEnemyCap(wave));
  }

  
class WaveState {
    constructor(waveNum){
      this.waveNum = waveNum;
      this.plan = wavePlan(waveNum);
      this.cursor = 0;
      this.remainingInPart = this.plan.length ? this.plan[0].count : 0;

      this.spawnInterval = spawnIntervalForWave(waveNum);
      const waveCap = getWaveEnemyCap(waveNum);
      const total = this.plan.reduce((sum, p) => sum + p.count, 0);
      if (total > waveCap) {
        const over = Math.min(1, (total - waveCap) / Math.max(1, waveCap));
        this.spawnInterval *= (1 - 0.35 * over);
      }
      this.burstEvery = burstEveryForWave(waveNum);
      this.spawnedCount = 0;
      this.spawnTimer = 0;

      this.finished = false;
    }

    nextPart(){
      this.cursor += 1;
      if(this.cursor >= this.plan.length){
        this.finished = true;
        return;
      }
      this.remainingInPart = this.plan[this.cursor].count;
    }
  }

  // =========================================================
  // Game
  // =========================================================
  
export { scaleForWave, wavePlan, waveModifiers, WaveState, getWaveEnemyCap };
export function setEndlessScalingEnabled(enabled){
  ENDLESS_EXPONENTIAL_SCALING = !!enabled;
}

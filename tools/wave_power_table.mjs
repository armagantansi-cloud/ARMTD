import fs from "node:fs";
import path from "node:path";
import { wavePlan, waveModifiers, scaleForWave } from "../game/waves.js";
import { ENEMY_TYPES, computePrevWaveTotals } from "../game/enemies.js";

const MAX_WAVE = Number.isFinite(Number(process.argv[2])) ? Math.max(1, Math.floor(Number(process.argv[2]))) : 200;

// Strength weights per enemy type (fixed constants for wave score).
const ENEMY_POINTS = {
  runner: 1.0,
  tank: 2.8,
  siphon: 2.4,
  boss: 14.0
};

// Relative importance of scaling factors in point computation.
const SCALE_WEIGHTS = {
  hp: 0.55,
  armor: 0.15,
  mr: 0.15,
  speed: 0.15
};

function toCounts(plan){
  const out = { runner: 0, tank: 0, siphon: 0, boss: 0 };
  for (const p of plan) {
    if (!p || !out.hasOwnProperty(p.type)) continue;
    out[p.type] += Math.max(0, Number(p.count) || 0);
  }
  return out;
}

function bossHpMultiplierForWave(wave){
  if (wave % 10 !== 0) return 1;
  const prev = Math.max(1, wave - 1);
  const prevTotals = computePrevWaveTotals(prev);
  const prevHp = Math.max(1, Number(prevTotals.totalHP) || 1);
  const baseBossHp = Math.max(1, ENEMY_TYPES.boss.HP);
  return prevHp / baseBossHp;
}

const rows = [];
let prevScore = 0;
for (let wave = 1; wave <= MAX_WAVE; wave += 1) {
  const counts = toCounts(wavePlan(wave));
  const overcap = waveModifiers(wave)?.overcap || { hp: 1, armor: 1, mr: 1, speed: 1 };
  let score = 0;
  for (const type of Object.keys(ENEMY_POINTS)) {
    const count = counts[type] || 0;
    if (count <= 0) continue;
    const base = ENEMY_TYPES[type];
    const scaled = scaleForWave(base, wave);

    const hpMul = (scaled.HP / Math.max(1, base.HP)) * Math.max(1, overcap.hp || 1);
    const armorMul = (scaled.Armor / Math.max(1, base.Armor)) * Math.max(1, overcap.armor || 1);
    // Runtime softens MR overcap (only 50% of the overcap delta is applied).
    const mrOvercapMul = 1 + (Math.max(1, overcap.mr || 1) - 1) * 0.5;
    const mrMul = (scaled.MR / Math.max(1, base.MR)) * mrOvercapMul;
    const speedMul = (scaled.Speed / Math.max(1e-6, base.Speed)) * Math.max(1, overcap.speed || 1);
    let scaleMul =
      (hpMul * SCALE_WEIGHTS.hp) +
      (armorMul * SCALE_WEIGHTS.armor) +
      (mrMul * SCALE_WEIGHTS.mr) +
      (speedMul * SCALE_WEIGHTS.speed);

    // In-game boss HP is custom: previous wave's non-boss total HP.
    if (type === "boss") {
      scaleMul *= bossHpMultiplierForWave(wave);
    }

    score += count * ENEMY_POINTS[type] * scaleMul;
  }
  rows.push({ wave, score, prevScore });
  prevScore = score;
}

const header = [
  `# Wave Power Table (1-${MAX_WAVE})`,
  ``,
  `Base points: Runner=${ENEMY_POINTS.runner}, Tank=${ENEMY_POINTS.tank}, Siphon=${ENEMY_POINTS.siphon}, Boss=${ENEMY_POINTS.boss}`,
  `Scaling weights: HP=${SCALE_WEIGHTS.hp}, Armor=${SCALE_WEIGHTS.armor}, MR=${SCALE_WEIGHTS.mr}, Speed=${SCALE_WEIGHTS.speed}`,
  `Boss HP rule: On boss waves, boss HP uses previous wave total non-boss HP (same as game logic).`,
  ``,
  `| Wave | Prev Wave Points | Power Points (Scaled) |`,
  `|---:|---:|---:|`
];

const body = rows.map((r) =>
  `| ${r.wave} | ${r.prevScore.toFixed(1)} | ${r.score.toFixed(1)} |`
);

const md = [...header, ...body, ""].join("\n");
const outPath = path.resolve(process.cwd(), "tools", "wave_power_table.md");
fs.writeFileSync(outPath, md, "utf8");
console.log(`Wrote ${outPath}`);

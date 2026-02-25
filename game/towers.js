import { CFG } from "./config.js";
import { clamp, dist2, randInt, now, formatCompact, pickN } from "./utils.js";
import { applyPhysicalDamage, applyMagicDamage } from "./damage.js";
import {
  acquireFloatingText,
  acquireEffectLine,
  acquireEffectRing,
  acquireProjectile,
  acquireFreeProjectile
} from "./projectiles.js";
import { SFX } from "./audio.js";

const MILESTONES = new Set([5,10,15,20]);

  function milestoneTier(level){
    if (level===5) return 1;
    if (level===10) return 2;
    if (level===15) return 3;
    if (level===20) return 4;
    return 0;
  }

  function tierASPct(tier){
    if (tier===1) return 0.16;
    if (tier===2) return 0.22;
    if (tier===3) return 0.30;
    return 0.45;
  }
  function tierADPct(tier){
    if (tier===1) return 0.22;
    if (tier===2) return 0.30;
    if (tier===3) return 0.42;
    return 0.70;
  }
  function tierMagicPct(tier){
    if (tier===1) return 0.20;
    if (tier===2) return 0.28;
    if (tier===3) return 0.38;
    return 0.60;
  }
  function tierRangePct(tier){
    if (tier===1) return 0.10;
    if (tier===2) return 0.14;
    if (tier===3) return 0.20;
    return 0.30;
  }

  function magicPower(tLike){
    const base = tLike?.magicBonus ?? 0;
    const mul = tLike?.perks?.magMul ?? 1;
    const peelMul = tLike?.peelBuffs?.mag?.mul ?? 1;
    return base * mul * peelMul;
  }

  function peelBuffPower(tLike){
    const lvl = Math.max(1, tLike?.level ?? 1);
    const minPct = 0.20 + (lvl - 1) * 0.05; // Lv1: +20%, Lv21: +120% (worst case floor)
    const magic = Math.max(0, magicPower(tLike));
    const actualMagLuckMul = tLike?.specialMagicActualMul ?? 1;
    const expectedMagLuckMul = Math.max(1e-6, tLike?.specialMagicExpectedMul ?? 1);
    const rarityRatio = actualMagLuckMul / expectedMagLuckMul;

    // Floor is guaranteed by level. Magic/luck only add bonus above the floor.
    const magicBonusMul = 1 + (magic / 500) * (0.10 + 0.10 * rarityRatio);
    const luckBonusMul = 1 + Math.max(0, rarityRatio - 1) * 0.35;
    const raw = minPct * magicBonusMul * luckBonusMul;
    return clamp(raw, minPct, 10.0); // hard cap: +1000%
  }

  function peelBounceCountFromAD(adRange, adMul=1){
    const avg = ((adRange?.[0] ?? 0) + (adRange?.[1] ?? 0)) / 2;
    const raw = Math.round(avg * adMul);
    return clamp(raw, CFG.PEEL_BOUNCE_MIN, CFG.PEEL_BOUNCE_MAX);
  }

  function archerPowerShotBonus(tLike){
    const lvl = tLike?.level ?? 1;
    const magic = magicPower(tLike);
    // Stronger magic-scaling identity for Archer skill.
    return 1.45 + (lvl-1)*0.038 + magic*0.085;
  }

  const POISON_SKILL_AD_DOT_SCALE = 0.080;

  function breakerAutoShred(tLike){
    const lvl = tLike?.level ?? 1;
    const magic = magicPower(tLike);
    return 8 + Math.floor((lvl-1)/2) + Math.floor(magic/2.8);
  }

  function breakerBombProfile(tLike){
    const lvl = tLike?.level ?? 1;
    const magic = magicPower(tLike);
    const radius = 1.48 + (lvl-1)*0.026 + magic*0.0010;
    const shred = 10 + Math.floor((lvl-1)/2) + Math.floor(magic/2.2);
    const magicDamage = (16 + (lvl-1)*1.35 + magic*0.95) * (tLike?.perks?.dmgMul ?? 1);
    return { radius, shred, magicDamage };
  }

  function breakerArmorBonus(armor){
    // Keep breaker anti-armor identity, but avoid extreme first-hit spikes on very high armor.
    const clampedArmor = Math.max(0, armor);
    return Math.round(Math.sqrt(clampedArmor) * 1.15);
  }

  function toxicSurgeProfile(tLike){
    const magic = magicPower(tLike);
    const stacksBonus = 2 + Math.floor(magic/30);
    const perTickBoost = 1.10 + magic * 0.005;
    return { stacksBonus, perTickBoost };
  }

  function blizzardSlowProfile(tLike){
    const lvl = tLike?.level ?? 1;
    const magic = magicPower(tLike);
    const slowPct = clamp(0.16 + (lvl-1)*0.010 + magic*0.0014, 0.16, 0.99);
    const dur = 0.85 + (lvl-1)*0.020 + magic*0.004;
    return { slowPct, duration: dur };
  }

  function mageChainMultiplier(level){
    const lv = clamp(level ?? 1, 1, CFG.TOWER_MAX_LEVEL);
    return 0.50 + (lv - 1) * (0.49 / (CFG.TOWER_MAX_LEVEL - 1));
  }

  // =========================================================
  // Tower defs
  //  - Mana/Hit sert nerf (1/3)
  //  - Sniper carepackage: mana tabanlı
  //  - Poison kalıcı (DOT kalır)
  // =========================================================
  
const MODES = {
    as:  { key:"as",  name:"Attack Speed +",  desc:"Attack speed artırır." },
    ad:  { key:"ad", name:"Attack Damage +", desc:"Attack damage artırır." },
    mag: { key:"mag",name:"Magic +", desc:"Magic artırır (skill gücü ve magic damage)." },
    rng: { key:"rng",name:"Range +", desc:"Range artırır." }
  };

  const TARGET_MODES = ["first", "last", "strongest", "pure", "random"];
  const TARGET_MODE_LABELS = {
    first: "First",
    last: "Last",
    strongest: "Strongest",
    pure: "Pure",
    random: "Random"
  };

  const SPECIAL_RARITIES = [
    { id:"common",   label:"Common",        chance:0.499, pct:0.20 },
    { id:"uncommon", label:"Uncommon",      chance:0.30,  pct:0.40 },
    { id:"rare",     label:"Rare",          chance:0.13,  pct:0.60 },
    { id:"epic",     label:"Epic",          chance:0.06,  pct:0.80 },
    { id:"legendary",label:"Legendary",     chance:0.01,  pct:1.00 },
    { id:"mythical", label:"Mythical Story",chance:0.001, pct:1.20 }
  ];
  const SPECIAL_MYTHIC_OTHER_PCT = 1.20;
  let SPECIAL_FORCE_LEGENDARY = false;
  const SPECIAL_MYTHIC_CHANCE = (SPECIAL_RARITIES.find(r => r.id === "mythical")?.chance) ?? 0;
  const SPECIAL_EXPECTED_MAG_PCT = SPECIAL_RARITIES.reduce((sum, r) => sum + r.chance * r.pct, 0);
  const SPECIAL_EXPECTED_MAG_MUL = 1 + SPECIAL_EXPECTED_MAG_PCT; // 1.357
  const SPECIAL_EXPECTED_OTHER_MAG_MUL = 1 + (SPECIAL_MYTHIC_CHANCE * SPECIAL_MYTHIC_OTHER_PCT); // 1.0012

  function rollSpecialRarity(){
    if (SPECIAL_FORCE_LEGENDARY) {
      return SPECIAL_RARITIES.find(r => r.id === "legendary") || SPECIAL_RARITIES[0];
    }
    const r = Math.random();
    let acc = 0;
    for (const rarity of SPECIAL_RARITIES) {
      acc += rarity.chance;
      if (r <= acc) return rarity;
    }
    return SPECIAL_RARITIES[0];
  }

  function setSpecialLegendaryMode(enabled){
    SPECIAL_FORCE_LEGENDARY = !!enabled;
  }

  function buildChoicesForTower(tower, tier){
    const stats = ["ad","as","mag"];

    const spec = {
      ad:  { short:"AD",  label:"Attack Damage", desc:"Increases attack damage and hit power.", apply:(t,p)=>{ t.perks.adMul *= (1+p); } },
      as:  { short:"AS",  label:"Attack Speed",  desc:"Increases attack speed and fire rate.",   apply:(t,p)=>{ t.perks.asMul *= (1+p); } },
      mag: { short:"MAG", label:"Magic",         desc:"Increases magic and skill power.",        apply:(t,p)=>{ t.perks.magMul *= (1+p); } }
    };

    return stats.map(code => {
      const rarity = rollSpecialRarity();
      const stat = spec[code];

      if (rarity.id === "mythical") {
        const pctMain = Math.round(rarity.pct * 100);
        const pctOther = Math.round(SPECIAL_MYTHIC_OTHER_PCT * 100);
        return {
          code,
          rarityId: rarity.id,
          title: `${rarity.label} ${stat.label} +${pctMain}%`,
          body: `Extra: other two stats +${pctOther}%.`,
          tier,
          apply:(t)=>{
            if (code === "ad") t.perks.adMul *= (1 + rarity.pct);
            if (code === "mag") t.perks.magMul *= (1 + rarity.pct);
            if (code === "as") t.perks.asMul *= (1 + rarity.pct);
            if (code !== "ad") t.perks.adMul *= (1 + SPECIAL_MYTHIC_OTHER_PCT);
            if (code !== "mag") t.perks.magMul *= (1 + SPECIAL_MYTHIC_OTHER_PCT);
            if (code !== "as") t.perks.asMul *= (1 + SPECIAL_MYTHIC_OTHER_PCT);
            if (code === "mag") {
              t.specialMagicActualMul *= (1 + rarity.pct);
              t.specialMagicExpectedMul *= SPECIAL_EXPECTED_MAG_MUL;
            } else {
              t.specialMagicActualMul *= (1 + SPECIAL_MYTHIC_OTHER_PCT);
              t.specialMagicExpectedMul *= SPECIAL_EXPECTED_OTHER_MAG_MUL;
            }
            if (!t.specialUpgrades) t.specialUpgrades = [];
            t.specialUpgrades = t.specialUpgrades.filter(u => u.tier !== tier);
            t.specialUpgrades.push({ tier, title: `${stat.label} +${pctMain}%`, rarityId: rarity.id });
          }
        };
      }

      const pct = Math.round(rarity.pct * 100);
      return {
        code,
        rarityId: rarity.id,
        title: `${rarity.label} ${stat.label} +${pct}%`,
        body: stat.desc,
        tier,
        apply:(t)=>{
          stat.apply(t, rarity.pct);
          if (code === "mag") {
            t.specialMagicActualMul *= (1 + rarity.pct);
            t.specialMagicExpectedMul *= SPECIAL_EXPECTED_MAG_MUL;
          } else {
            t.specialMagicExpectedMul *= SPECIAL_EXPECTED_OTHER_MAG_MUL;
          }
          if (!t.specialUpgrades) t.specialUpgrades = [];
          t.specialUpgrades = t.specialUpgrades.filter(u => u.tier !== tier);
          t.specialUpgrades.push({ tier, title: `${stat.label} +${pct}%`, rarityId: rarity.id });
        }
      };
    });
  }

  // =========================================================
  // Tower
  // =========================================================
  
function gainCurve(levelBefore) {
    if (levelBefore <= 1) return 0.70;
    if (levelBefore <= 2) return 0.34;
    if (levelBefore <= 4) return 0.21;
    if (levelBefore <= 7) return 0.13;
    if (levelBefore <= 11) return 0.085;
    if (levelBefore <= 15) return 0.056;
    if (levelBefore <= 18) return 0.040;
    return 0.028;
  }
  function upgradeCostCurve(baseCost, levelBefore) {
    const l = levelBefore;
    return Math.round(baseCost * (0.55 + Math.pow(l, 1.25) * 0.55));
  }

  function scaledGain(levelBefore){
    let g = gainCurve(levelBefore);
    if (levelBefore === 19) g *= 1.35;
    if (levelBefore === 20) g *= 1.75;
    return g;
  }

  function sniperSecondaryScaledGain(secondaryLevel){
    const sec = Math.max(0, Math.floor(Number(secondaryLevel) || 0));
    if (sec <= 0) return 0;
    return 0.01;
  }

  function applyUpgradeGain(tower, g){
    const adGainMul = (tower.def.id === "sniper")
      ? (1 + g*1.35)
      : (tower.def.id === "archer")
        ? (1 + g*0.88)
        : (1 + g);
    tower.AD = [
      Math.round(tower.AD[0] * adGainMul),
      Math.round(tower.AD[1] * adGainMul)
    ];
    tower.baseAS *= (1 + g*0.22);
    tower.baseRange += (0.10 + g*0.10);
    tower.critChance = clamp(tower.critChance + g*0.010, 0, 0.45);

    const magicMult =
      (tower.def.id === "mage") ? (1 + g*0.42)
      : (tower.def.id === "breaker") ? (1 + g*0.95)
      : (tower.def.id === "archer") ? (1 + g*0.40)
      : (1 + g*0.30);
    tower.magicBonus = Math.round(tower.magicBonus * magicMult);

    if (tower.def.id !== "sniper") {
      tower.manaRegen *= (1 + g*0.16);
      tower.manaOnHit *= (1 + g*0.12);
    }
    tower.armorPenPct = clamp(tower.armorPenPct + g*0.020, 0, 0.75);
    tower.magicPenFlat += Math.round(g*2);

    if(tower.maxMana>0) tower.mana = clamp(tower.mana, 0, tower.maxMana);
  }

  
const TOWER_DEFS = [
    {
      id: "peel",
      name: "Peel Tower",
      cost: 11000,
      size: 2,
      autoAttackDesc: "Fires support bolts that grant a random short buff to a nearby tower.",
      skillName: "Core Uplink",
      skillManaCost: 60,
      behavior: "support",
      base: {
        AD: [1,1], AS: 0.20, Range: 3.0,
        CrC: 0.00, CrD: 1.50,
        MD: 112,
        MaR: 4.5, manaOnHit: 0.0,
        ArP: 0.00, MaP: 0
      },
      skill: (tower) => null,
      skillDesc: (tLike) => {
        return `Core Uplink grants wave-end Core HP and Gold based on cast count. Both rewards scale with Magic.`;
      },
      projectile: { speedTilesPerSec: CFG.PEEL_PROJECTILE_SPEED },
      prestige: { mana: 1000, name: "Linkforge",
        desc: "Randomly grants +1 level to one other prestige tower (can exceed 21)."
      }
    },
    {
      id: "archer",
      name: "Archer Tower",
      cost: 60,
      autoAttackDesc: "Fast physical single-target shots.",
      skillName: "Power Shot",
      skillManaCost: 30,
      behavior: "projectile",
      base: {
        AD: [28,34], AS: 1.20, Range: 3.9,
        CrC: 0.14, CrD: 1.90,
        MD: 10,
        MaR: 4.8, manaOnHit: 14.0 * CFG.MANA_ON_HIT_NERF_MULT,
        ArP: 0.10, MaP: 0
      },
      skill: (tower) => {
        if (tower.mana < tower.maxMana) return null;
        tower.mana = 0;
        const bonus = archerPowerShotBonus(tower);
        return { kind:"powershot", bonusPhysicalMultiplier: bonus };
      },
      skillDesc: (tLike) => {
        const bonus = archerPowerShotBonus(tLike);
        return `Next hit deals x${bonus.toFixed(2)} damage.`;
      },
      projectile: { speedTilesPerSec: 8.8 },

      prestige: { mana: 300, name: "Rapid Volley",
        desc: "For 12s, all Archer Towers on the map gain Attack Speed x4."
      }
    },
    {
      id: "mage",
      name: "Mage Tower",
      cost: 85,
      autoAttackDesc: "Magic bolts for steady single-target damage.",
      skillName: "Chain Bolt",
      skillManaCost: 40,
      behavior: "projectile",
      base: {
        AD: [12,18], AS: 1.24, Range: 4.05,
        CrC: 0.13, CrD: 1.80,
        MD: 48,
        MaR: 5.0, manaOnHit: 14.0 * CFG.MANA_ON_HIT_NERF_MULT,
        ArP: 0.00, MaP: 12
      },
      skill: (tower) => {
        if (tower.mana < tower.maxMana) return null;
        tower.mana = 0;

        const magic = magicPower(tower);
        const jumps = 2 + Math.floor((tower.level-1)/3) + Math.floor(magic/110);
        const mult  = mageChainMultiplier(tower.level);
        const radius= 2.45 + (tower.level-1)*0.03 + magic*0.0012;

        return { kind:"chain", chain: { jumps, radiusTiles: radius, multiplier: mult } };
      },
      skillDesc: (tLike) => {
        const lvl = tLike.level ?? 1;
        const magic = magicPower(tLike);
        const jumps = 2 + Math.floor((lvl-1)/3) + Math.floor(magic/110);
        const mult  = mageChainMultiplier(lvl);
        const radius= 2.45 + (lvl-1)*0.03 + magic*0.0012;
        return `Chain Bolt: ${jumps} jumps in ${radius.toFixed(2)} range. Each jump keeps x${mult.toFixed(2)} damage (max x0.99).`;
      },
      projectile: { speedTilesPerSec: 7.2 },

      prestige: { mana: 400, name: "Arcstorm",
        desc: "For a magic-scaled duration, towers in range gain magic-scaled mana generation (regen, on-hit, prestige)."
      }
    },
    {
      id: "breaker",
      name: "Breaker Tower",
      cost: 200,
      autoAttackDesc: "Each auto hit permanently shreds target Armor.",
      skillName: "Shatter Bomb",
      skillManaCost: 25,
      behavior: "projectile",
      base: {
        AD: [38,52], AS: 1.14, Range: 3.3,
        CrC: 0.08, CrD: 1.60,
        MD: 42,
        MaR: 5.0, manaOnHit: 18.0 * CFG.MANA_ON_HIT_NERF_MULT,
        ArP: 0.11, MaP: 0
      },
      skill: (tower) => {
        if (tower.mana < tower.maxMana) return null;
        tower.mana = 0;
        const p = breakerBombProfile(tower);
        return { kind:"breakerBomb", radiusTiles: p.radius, shredFlat: p.shred, magicDamage: p.magicDamage };
      },
      skillDesc: (tLike) => {
        const p = breakerBombProfile(tLike);
        return `Throws an AOE bomb: ${Math.round(p.magicDamage)} magic damage in ${p.radius.toFixed(2)} radius and Armor Shred ${p.shred}.`;
      },
      projectile: { speedTilesPerSec: 7.4 },

      prestige: { mana: 500, name: "Shatter Field",
        desc: "For 12s, each attack hits all enemies in range. Armor can go negative (they take extra damage)."
      }
    },
    {
      id: "blizzard",
      name: "Blizzard Tower",
      cost: 175,
      autoAttackDesc: "Auto attacks apply slow on hit.",
      skillName: "Frost Pulse",
      skillManaCost: 36,
      behavior: "projectile",
      base: {
        AD: [26,36], AS: 1.12, Range: 2.95,
        CrC: 0.06, CrD: 1.35,
        MD: 46,
        MaR: 3.6, manaOnHit: 14.0 * CFG.MANA_ON_HIT_NERF_MULT,
        ArP: 0.07, MaP: 8
      },
      skill: (tower) => {
        if (tower.mana < tower.maxMana) return null;
        tower.mana = 0;
        const p = blizzardSlowProfile(tower);
        return { kind:"frostPulse", slowPct: p.slowPct, duration: p.duration };
      },
      skillDesc: (tLike) => {
        const p = blizzardSlowProfile(tLike);
        const magic = magicPower(tLike);
        const pulseMagicDamage = (8 + magic * 0.85) * (tLike?.perks?.dmgMul ?? 1);
        return `Emits a Frost Pulse: ${Math.round(p.slowPct*100)}% slow for ${p.duration.toFixed(2)}s and ${Math.round(pulseMagicDamage)} magic damage.`;
      },
      projectile: { speedTilesPerSec: 6.9 },

      prestige: { mana: 600, name: "Frostbite",
        desc: "Roots one enemy in ice for 3.0s and deals magic-scaled damage over 3s."
      }
    },
    {
      id: "poison",
      name: "Poison Tower",
      cost: 250,
      autoAttackDesc: "Each hit adds +1 poison stack. Each stack deals DOT.",
      skillName: "Toxic Surge",
      skillManaCost: 35,
      behavior: "projectile",
      base: {
        AD: [8,12], AS: 1.16, Range: 3.55,
        CrC: 0.05, CrD: 1.50,
        MD: 40,
        MaR: 6.2, manaOnHit: 18.0 * CFG.MANA_ON_HIT_NERF_MULT,
        ArP: 0.00, MaP: 14
      },
      skill: (tower) => {
        if (tower.mana < tower.maxMana) return null;
        tower.mana = 0;
        const { stacksBonus, perTickBoost } = toxicSurgeProfile(tower);

        return { kind:"toxic", stacksBonus, perTickBoost };
      },
      skillDesc: (tLike) => {
        const lvl = tLike.level ?? 1;
        const { stacksBonus, perTickBoost } = toxicSurgeProfile(tLike);

        const dmgMul = (tLike?.perks?.dmgMul || 1);
        const avgAd = (((tLike?.AD?.[0] ?? 0) + (tLike?.AD?.[1] ?? 0)) / 2) * (tLike?.perks?.adMul ?? 1);
        const basePerTick = (2.0 + (lvl-1)*0.18) * dmgMul;
        const totalPerTick = basePerTick + (avgAd * POISON_SKILL_AD_DOT_SCALE);

        return `Toxic Surge: +${stacksBonus} instant stacks and DOT x${perTickBoost.toFixed(2)}. Current DOT/stack: ${totalPerTick.toFixed(1)} (AD included).`;
      },
      projectile: { speedTilesPerSec: 7.6 },

      prestige: { mana: 800, name: "Plague Bomb",
        desc: "Giant poison bomb keeps damaging and stacking poison while traveling, erupts at impact, then keeps flying."
      }
    },
    {
      id: "sniper",
      name: "Sniper Tower",
      cost: 1500,
      autoAttackDesc: "Very long-range heavy shots. Basic hit briefly applies 100% slow (0.1s).",
      skillName: "Overlevel",
      skillManaCost: 300,
      behavior: "projectile",
      base: {
        AD: [1050,1450], AS: 0.25, Range: 6.6,
        CrC: 0.22, CrD: 2.20,
        MD: 6,
        MaR: 2.0, manaOnHit: 0.6,
        ArP: 0.22, MaP: 0
      },
      skill: (tower) => {
        if (tower.mana < tower.maxMana) return null;
        tower.mana = 0;
        return { kind:"overlevel" };
      },
      skillDesc: (tLike) => {
        return `At full mana, gains +1 Secondary Level (unlimited).`;
      },
      projectile: { speedTilesPerSec: 12.5 },

      prestige: { mana: 1000, name: "Carepackage",
        desc: "Prestige trigger grants x15 Carepackage gold payout."
      }
    }
  ];

  // =========================================================
  // Map object
  // =========================================================
  
class Tower {
    constructor(def, gx, gy, game) {
      this.def=def;
      this.gx=gx; this.gy=gy;
      this.size = def.size ?? 1;
      this.x=gx+(this.size/2); this.y=gy+(this.size/2);
      this.game = game;

      this.level=1;
      this.spentGold=def.cost;

      this.cooldown=0;
      this.damageDealt=0;
      this.kills=0;

      const b=def.base;
      this.AD=[...b.AD];
      this.baseAS=b.AS;
      this.baseRange=b.Range;
      this.critChance=b.CrC;
      this.critDmg=b.CrD;
      this.magicBonus=b.MD;
      this.manaRegen=b.MaR;
      this.manaOnHit=b.manaOnHit;
      this.armorPenPct=b.ArP;
      this.magicPenFlat=b.MaP;

      // Primary mana (skill mana)
      this.maxMana = def.skillManaCost;
      this.mana = 0;

      // Prestige mana (level 21)
      this.prestigeMaxMana = def.prestige?.mana ?? 0;
      this.prestigeMana = 0;
      this.prestigeActive = 0; // remaining seconds

      // Archer prestige: temporary AS buff
      this.tempASMul = 1;

      // Mage prestige: chain mode flag
      this.forceChainAll = false;

      // Breaker prestige: cleave-all-in-range
      this.cleaveAll = false;

      // Targeting
      this.targetMode = "first";
      this.lockedTarget = null;

      // Sniper: unlimited secondary level for normal skill overlevel
      this.secondaryLevel = 0;

      this.perks = {
        asMul: 1,
        adMul: 1,
        magMul: 1,
        dmgMul: 1
      };

      this.peelBuffs = {};
      this.facing = 1;
      this.specialUpgrades = [];
      this.specialMagicActualMul = 1;
      this.specialMagicExpectedMul = 1;

      this._lastShotWasCrit = false;
    }

    isPrestige(){ return this.level >= CFG.PRESTIGE_LEVEL; }
    maxNormalLevel(){ return CFG.TOWER_MAX_LEVEL; }

    peelMul(kind){
      return this.peelBuffs?.[kind]?.mul ?? 1;
    }
    hasPeelBuff(kind){
      return (this.peelBuffs?.[kind]?.time ?? 0) > 0;
    }
    applyPeelBuff(kind, power, duration, source){
      if (!this.peelBuffs) this.peelBuffs = {};
      const mul = (kind === "purge") ? 1 : (1 + power);
      const existing = this.peelBuffs[kind];
      if (existing) {
        existing.time = Math.max(existing.time, duration);
        existing.maxTime = Math.max(existing.maxTime ?? 0, duration);
        existing.mul = mul;
        existing.power = power;
        existing.source = source || existing.source;
        return;
      }
      this.peelBuffs[kind] = { time: duration, maxTime: duration, mul, power, source };
    }
    updatePeelBuffs(dt){
      if (!this.peelBuffs) return;
      for (const [key, buff] of Object.entries(this.peelBuffs)) {
        buff.time -= dt;
        if (buff.time <= 0) delete this.peelBuffs[key];
      }
    }
    getBounceCount(){
      return peelBounceCountFromAD(this.AD, this.perks.adMul * this.peelMul("ad"));
    }

    getProjectileSpeed(){
      const base = this.def.projectile?.speedTilesPerSec ?? 7.0;
      const scale = 1 + (this.level - 1) * 0.025;
      return base * scale * 1.15;
    }

    get AS(){
      return Math.max(0.05, this.baseAS * this.perks.asMul * this.tempASMul * this.peelMul("as"));
    }
    get range(){
      const base = Math.max(1, this.baseRange);
      const mul = this.peelMul("rng");
      const bonus = (base - 1) * mul;
      return Math.max(1, 1 + bonus);
    }

    canUpgrade(){
      if (this.def.id === "sniper" && this.isPrestige()) return false;
      if (this.level < CFG.TOWER_MAX_LEVEL) return true;
      if (this.level === CFG.TOWER_MAX_LEVEL) {
        return this.game.canPrestigeUpgrade(this);
      }
      return false;
    }

    upgradeCost(){
      if (this.level < CFG.TOWER_MAX_LEVEL) {
        if (this.level === CFG.TOWER_MAX_LEVEL - 1) {
          const cost19 = upgradeCostCurve(this.def.cost, this.level);
          return cost19 * 2;
        }
        return upgradeCostCurve(this.def.cost, this.level);
      }
      if (this.level === CFG.TOWER_MAX_LEVEL) {
        const cost19 = upgradeCostCurve(this.def.cost, CFG.TOWER_MAX_LEVEL - 1);
        const cost20 = cost19 * 2;
        return cost20 * 2;
      }
      return Infinity;
    }

    manaGainOnHit(){
      if (this.maxMana <= 0) return;
      const gainMult = this._manaGainTempMul || 1;
      this.mana += this.manaOnHit * gainMult;
      this.mana = clamp(this.mana, 0, this.maxMana);
    }

    upgradeBaseStats(allowOverCap=false){
      const lvlBefore=this.level;

      if (!allowOverCap) {
        if (!this.canUpgrade()) return;
      }

      // 20 -> 21 prestige upgrade
      if (!allowOverCap && this.level === CFG.TOWER_MAX_LEVEL) {
        const g = scaledGain(lvlBefore);
        this.level = CFG.PRESTIGE_LEVEL;
        // prestige mana starts empty
        this.prestigeMana = 0;
        this.prestigeActive = 0;
        this.tempASMul = 1;
        this.forceChainAll = false;
        this.cleaveAll = false;
        applyUpgradeGain(this, g);
        this.game.refreshUI(true);
        return;
      }

      // normal upgrade (or sniper overcap)
      this.level += 1;

      const g = scaledGain(lvlBefore);
      applyUpgradeGain(this, g);
    }

    applySecondaryLevelGain(){
      this.secondaryLevel += 1;
      const g = sniperSecondaryScaledGain(this.secondaryLevel);
      if (g <= 0) return;
      const mul = 1 + g;
      const low = Math.max(1, Math.round(this.AD[0] * mul));
      const high = Math.max(low, Math.round(this.AD[1] * mul));
      this.AD = [low, high];
      this.magicBonus = Math.max(0, Math.round(this.magicBonus * mul));
    }

    usesTimedPrestige(){
      return this.def.id === "archer"
        || this.def.id === "mage"
        || this.def.id === "breaker"
        || this.def.id === "blizzard";
    }

    expectedDamageAgainst(enemy){
      if (this.def.id === "peel") return 0;
      const avgAD = (this.AD[0] + this.AD[1]) / 2;
      let phys = avgAD * this.perks.adMul * this.peelMul("ad");
      let mag = (this.magicBonus || 0) * this.perks.magMul * this.peelMul("mag");

      if(this.def.id==="breaker") phys += breakerArmorBonus(enemy.armor);

      const expectedCritMult = 1 + this.critChance * (this.critDmg - 1);
      phys *= expectedCritMult;
      mag  *= expectedCritMult;

      phys *= this.perks.dmgMul;
      mag  *= this.perks.dmgMul;

      if(this.maxMana>0 && this.mana>=this.maxMana && this.def.id==="archer"){
        const bonus = archerPowerShotBonus(this);
        phys *= bonus;
      }

      const dealtPhys = applyPhysicalDamage(phys, enemy.armor, this.armorPenPct);
      const dealtMag = applyMagicDamage(mag, enemy.mr, this.magicPenFlat);
      return dealtPhys + dealtMag;
    }

    getTargetModeLabel(){
      return TARGET_MODE_LABELS[this.targetMode] || "First";
    }

    cycleTargetMode(dir){
      const cur = TARGET_MODES.indexOf(this.targetMode);
      const idx = (cur < 0 ? 0 : cur);
      const step = (dir >= 0) ? 1 : -1;
      const next = (idx + step + TARGET_MODES.length) % TARGET_MODES.length;
      this.targetMode = TARGET_MODES[next];
      this.lockedTarget = null;
      return this.targetMode;
    }

    isValidTarget(enemy, r2){
      if (!enemy || enemy.dead || enemy.reachedExit) return false;
      return dist2(this.x, this.y, enemy.x, enemy.y) <= r2;
    }

    ownDebuffScore(enemy){
      if (!enemy) return 0;
      if (this.def.id === "breaker") {
        return enemy.armorShredByTower?.get(this) ?? 0;
      }
      if (this.def.id === "poison") {
        return enemy.poisonByTower?.get(this) ?? 0;
      }
      if (this.def.id === "blizzard" || this.def.id === "sniper") {
        const slow = enemy.slowByTower?.get(this);
        const slowScore = (slow?.pct ?? 0) * 10 + (slow?.time ?? 0);
        const frostScore = (enemy.frostbiteSource === this)
          ? (enemy.frostbiteTime + enemy.frostbiteDotTime)
          : 0;
        return slowScore + frostScore;
      }
      return 0;
    }

    purePriority(enemy, game){
      if (!enemy) return -Infinity;

      // Breaker pure: prioritize the highest current armor target.
      if (this.def.id === "breaker") {
        return enemy.armor;
      }

      // Blizzard pure: prioritize the fastest current target.
      if (this.def.id === "blizzard") {
        const hasBlizzardPrestige = !!game?.anyBlizzardPrestigeActive;
        const effectiveSlowPct = hasBlizzardPrestige
          ? Math.max(0, enemy.slowPct || 0)
          : clamp(enemy.slowPct || 0, 0, CFG.SLOW_MAX_PCT);
        const slowMul = Math.max(0, 1 - effectiveSlowPct);
        return Math.min(10, (enemy.baseSpeed || 0) * slowMul);
      }

      // Poison pure: prioritize the least-poisoned target.
      if (this.def.id === "poison") {
        return -(enemy.poisonStacks || 0);
      }

      // Default pure: least own debuff pressure.
      return -this.ownDebuffScore(enemy);
    }

    chooseTarget(game){
      const r2=this.range*this.range;
      const mode = this.targetMode || "first";

      if (mode !== "pure" && this.isValidTarget(this.lockedTarget, r2)) {
        return this.lockedTarget;
      }
      if (mode !== "pure") this.lockedTarget = null;

      const nearby = (typeof game.getEnemiesInRange === "function")
        ? game.getEnemiesInRange(this.x, this.y, this.range)
        : game.enemies;
      const candidates = [];
      for(const e of nearby){
        if (!this.isValidTarget(e, r2)) continue;
        candidates.push(e);
      }
      if (!candidates.length) return null;

      const pickByPath = (wantLast=false) => {
        let best = null;
        for (const e of candidates) {
          if (!best) { best = e; continue; }
          if (wantLast) {
            if (e.pathIndex < best.pathIndex) best = e;
          } else if (e.pathIndex > best.pathIndex) {
            best = e;
          }
        }
        return best;
      };

      let picked = null;
      if (mode === "last") {
        picked = pickByPath(true);
      } else if (mode === "strongest") {
        for (const e of candidates) {
          if (!picked || e.hp > picked.hp) picked = e;
        }
      } else if (mode === "random") {
        picked = candidates[Math.floor(Math.random() * candidates.length)] || null;
      } else if (mode === "pure") {
        let bestScore = -Infinity;
        for (const e of candidates) {
          const score = this.purePriority(e, game);
          if (!picked || score > bestScore + 1e-6) {
            picked = e;
            bestScore = score;
            continue;
          }
          if (Math.abs(score - bestScore) <= 1e-6) {
            if (e.pathIndex > picked.pathIndex) picked = e;
            else if (e.pathIndex === picked.pathIndex && e.hp > picked.hp) picked = e;
          }
        }
      } else {
        picked = pickByPath(false);
      }

      if (mode !== "pure") this.lockedTarget = picked || null;
      return picked;
    }

    pickNearestPeelTarget(game, fromTower, { firstHop=false, hitSet=null, segments=[] } = {}){
      const segIntersects = (a1, a2, b1, b2) => {
        const cross = (p, q, r) => ((q.x - p.x) * (r.y - p.y)) - ((q.y - p.y) * (r.x - p.x));
        const between = (a, b, c) => (Math.min(a, b) - 1e-7 <= c && c <= Math.max(a, b) + 1e-7);
        const c1 = cross(a1, a2, b1);
        const c2 = cross(a1, a2, b2);
        const c3 = cross(b1, b2, a1);
        const c4 = cross(b1, b2, a2);
        if (((c1 > 0 && c2 < 0) || (c1 < 0 && c2 > 0)) && ((c3 > 0 && c4 < 0) || (c3 < 0 && c4 > 0))) return true;
        if (Math.abs(c1) <= 1e-7 && between(a1.x, a2.x, b1.x) && between(a1.y, a2.y, b1.y)) return true;
        if (Math.abs(c2) <= 1e-7 && between(a1.x, a2.x, b2.x) && between(a1.y, a2.y, b2.y)) return true;
        if (Math.abs(c3) <= 1e-7 && between(b1.x, b2.x, a1.x) && between(b1.y, b2.y, a1.y)) return true;
        if (Math.abs(c4) <= 1e-7 && between(b1.x, b2.x, a2.x) && between(b1.y, b2.y, a2.y)) return true;
        return false;
      };

      let candidates = [];
      const peelRange2 = this.range * this.range;
      for (const t of game.towers) {
        if (t === fromTower) continue;
        if (t === this) continue; // self only via forced final hop
        if (hitSet?.has(t)) continue;
        if (firstHop && dist2(this.x, this.y, t.x, t.y) > peelRange2) continue;
        const d2 = dist2(fromTower.x, fromTower.y, t.x, t.y);
        const proposed = { a: { x: fromTower.x, y: fromTower.y }, b: { x: t.x, y: t.y } };
        const intersects = segments.some(s => {
          const shareEndpoint =
            (Math.abs(s.a.x - proposed.a.x) < 1e-7 && Math.abs(s.a.y - proposed.a.y) < 1e-7) ||
            (Math.abs(s.b.x - proposed.a.x) < 1e-7 && Math.abs(s.b.y - proposed.a.y) < 1e-7) ||
            (Math.abs(s.a.x - proposed.b.x) < 1e-7 && Math.abs(s.a.y - proposed.b.y) < 1e-7) ||
            (Math.abs(s.b.x - proposed.b.x) < 1e-7 && Math.abs(s.b.y - proposed.b.y) < 1e-7);
          if (shareEndpoint) return false;
          return segIntersects(s.a, s.b, proposed.a, proposed.b);
        });
        candidates.push({ tower: t, d2, intersects });
      }
      if (!candidates.length) return null;
      let pool = candidates.filter(c => !c.intersects);
      if (!pool.length) pool = candidates;
      let bestD2 = Math.min(...pool.map(c => c.d2));
      const ties = pool.filter(c => Math.abs(c.d2 - bestD2) <= 1e-7).map(c => c.tower);
      return ties[Math.floor(Math.random() * ties.length)] || null;
    }

    supportShoot(game){
      const buffTypes = ["ad","as","rng","mag"];
      const skillReady = (this.maxMana > 0 && this.mana >= this.maxMana);
      const buffType = buffTypes[Math.floor(Math.random() * buffTypes.length)];

      const bounce = this.getBounceCount();
      if (bounce <= 0) return;

      if (skillReady) {
        this.mana = 0;
        this.castCoreUplink(game);
      }

      const hitSet = new Set();
      const first = this.pickNearestPeelTarget(game, this, { firstHop: true, hitSet });
      if (!first) return;

      const power = peelBuffPower(this);
      const duration = this.level + 2;
      const colorMap = {
        ad: "rgba(239,68,68,0.95)",
        as: "rgba(34,197,94,0.95)",
        rng: "rgba(251,146,60,0.95)",
        mag: "rgba(99,102,241,0.95)"
      };
      const shapeMap = {
        ad: "diamond",
        as: "dagger",
        rng: "rings",
        mag: "star"
      };
      const color = colorMap[buffType] || "rgba(14,165,233,0.95)";
      const shape = shapeMap[buffType] || "circle";
      const totalHops = bounce;
      const launchFinalReturn = (fromTower) => {
        if (!fromTower || fromTower === this) return;
        if (!game.towers.includes(fromTower) || !game.towers.includes(this)) return;
        const backProj = acquireFreeProjectile(
          fromTower.x, fromTower.y,
          this.x, this.y,
          this.getProjectileSpeed(),
          { color, radius: 0.11, shape },
          () => {
            if (!game.towers.includes(this)) return;
            this.applyPeelBuff(buffType, power, duration, fromTower);
          },
          {
            stopOnArrive: true,
            curve: true,
            curveArcMul: 0.60,
            curveArcMaxTiles: 2.60,
            curveSign: 1
          }
        );
        game.projectiles.push(backProj);
      };
      const launchHop = (fromTower, hopIdx) => {
        if (!game.towers.includes(fromTower)) return;
        if (hopIdx > totalHops) {
          launchFinalReturn(fromTower);
          return;
        }

        const segments = launchHop._segments || (launchHop._segments = []);
        const isFirst = hopIdx === 1;
        let target = this.pickNearestPeelTarget(game, fromTower, { firstHop: isFirst, hitSet, segments });
        if (!target) {
          launchFinalReturn(fromTower);
          return;
        }

        const proj = acquireFreeProjectile(
          fromTower.x, fromTower.y,
          target.x, target.y,
          this.getProjectileSpeed(),
          { color, radius: 0.11, shape },
          () => {
            if (!game.towers.includes(target)) {
              launchFinalReturn(fromTower);
              return;
            }
            target.applyPeelBuff(buffType, power, duration, fromTower);
            hitSet.add(target);
            segments.push({ a: { x: fromTower.x, y: fromTower.y }, b: { x: target.x, y: target.y } });
            if (hopIdx >= totalHops) {
              launchFinalReturn(target);
              return;
            }
            launchHop(target, hopIdx + 1);
          },
          {
            stopOnArrive: true,
            curve: true,
            curveArcMul: 0.60,
            curveArcMaxTiles: 2.60,
            curveSign: 1
          }
        );
        game.projectiles.push(proj);
      };

      launchHop(this, 1);
    }

    castCoreUplink(game){
      if (!game) return false;
      if (typeof game.recordPeelUplinkCast === "function") {
        game.recordPeelUplinkCast();
      }
      game.effects.push(acquireEffectRing(this.x, this.y, this.range * 0.40, 6.0, 0.25, "rgba(56,189,248,0.75)"));
      game.floaters.push(acquireFloatingText(this.x, this.y - 0.35, "UPLINK", 0.55, 12, false, false));
      return true;
    }

    update(dt, game){
      // Prestige mana: süreyle dolar
      if (this.isPrestige()) {
        const gainMult = this._manaGainTempMul || 1;
        const fillPerSec = (this.prestigeMaxMana / CFG.PRESTIGE_RECHARGE_TIME_SEC) * gainMult;
        this.prestigeMana = clamp(this.prestigeMana + fillPerSec * dt, 0, this.prestigeMaxMana);

        if (this.prestigeActive > 0) {
          this.prestigeActive -= dt;
          if (this.prestigeActive <= 0) {
            this.prestigeActive = 0;
            // Buffları kapat
            this.forceChainAll = false;
            this.cleaveAll = false;
          }
        }

        // Tetikle
        const ready = this.prestigeMana >= this.prestigeMaxMana;
        if (ready) {
          const canCastNow = this.usesTimedPrestige() ? (this.prestigeActive === 0) : true;
          if (canCastNow) {
            const casted = this.triggerPrestige(game);
            if (casted) this.prestigeMana = 0;
          }
        }
      }

      // Primary mana
      if(this.maxMana>0){
        const gainMult = this._manaGainTempMul || 1;
        this.mana += this.manaRegen * gainMult * dt;
        this.mana = clamp(this.mana, 0, this.maxMana);
      }

      this.updatePeelBuffs(dt);

      if(this.cooldown>0) this.cooldown -= dt;
      if(this.cooldown>0) return;

      if (this.def.behavior === "support") {
        this.supportShoot(game);
        this.cooldown = 1/this.AS;
        return;
      }

      if(this.def.behavior==="pulse"){
        const pulseRes = this.def.pulse ? this.def.pulse(this) : null;
        if(!pulseRes){ this.cooldown = 1/this.AS; return; }

        if (this.def.id === "blizzard" && this.prestigeActive > 0) {
          const r2 = this.range * this.range;
          let target = null;
          for (const e of game.enemies) {
            if (e.dead || e.reachedExit) continue;
            if (e.frostbiteTime > 0 || e.frostbiteDotTime > 0) continue;
            if (dist2(this.x, this.y, e.x, e.y) > r2) continue;
            if (!target || e.pathIndex > target.pathIndex) target = e;
          }
          if (target) {
            const magic = magicPower(this);
            const dur = 3.0;
            const perTick = (2.0 + magic * 1.75) * this.perks.dmgMul;
            target.applyFrostbite(dur, perTick, this, this.magicPenFlat);
          }
        }

        const makeRing = () => {
          const ringSpeed = Math.max(3.5, this.range*4.0);
          game.rings.push(acquireEffectRing(
            this.x, this.y,
            this.range,
            ringSpeed,
            0.35,
            "rgba(56,189,248,0.60)",
            (enemy)=> enemy.applySlow(pulseRes.slowPct, pulseRes.duration),
            5.8
          ));
        };

        makeRing();

        this.cooldown = 1/this.AS;
        return;
      }

      // Breaker prestige: cleave (her atakta tüm düşmanlara vur)
      if (this.cleaveAll) {
        this.cleaveShootAll(game);
        this.cooldown = 1/this.AS;
        return;
      }

      if (this.def.id === "mage" && this.isPrestige()) {
        this.cooldown = 1/this.AS;
        return;
      }

      const target=this.chooseTarget(game);
      if(!target) return;

      this.shoot(target, game);
      this.cooldown = 1/this.AS;
    }

    triggerPrestige(game){
      if (this.usesTimedPrestige()) this.prestigeActive = CFG.PRESTIGE_ACTIVE_SEC;
      else this.prestigeActive = 0;
      SFX.prestige();
      if (this.def.prestige?.name) {
        const modeText = this.usesTimedPrestige() ? "Prestige active" : "Prestige cast";
        game.logEvent(`${modeText}: ${this.def.name} • ${this.def.prestige.name}`);
        game.centerQueue.push({ text: this.def.prestige.name, life:2.0 });
      }

      if (this.def.id === "archer") {
        this.tempASMul = 4.0;
        return true;
      }

      if (this.def.id === "mage") {
        const magic = magicPower(this);
        this.forceChainAll = false;
        this.prestigeActive = CFG.PRESTIGE_ACTIVE_SEC + Math.min(18, magic * 0.05);
        return true;
      }

      if (this.def.id === "breaker") {
        this.cleaveAll = true;
        return true;
      }

      if (this.def.id === "peel") {
        const candidates = game.towers.filter(t => t !== this && t.level >= CFG.PRESTIGE_LEVEL);
        if (!candidates.length) {
          return false;
        }
        const pick = candidates[Math.floor(Math.random() * candidates.length)];
        pick.upgradeBaseStats(true);
        game.centerQueue.push({ text:`${this.def.prestige?.name || "Linkforge"} +1 ${pick.def.name}`, life:2.0 });
        return true;
      }

      if (this.def.id === "blizzard") {
        return true;
      }

      if (this.def.id === "poison") {
        this.poisonPrestigeBomb(game);
        return true;
      }

      if (this.def.id === "sniper") {
        const magic = magicPower(this);
        const base = CFG.SNIPER_CAREPACKAGE_BASE_GOLD + (game.currentWave * CFG.SNIPER_CAREPACKAGE_PER_WAVE);
        const gold = Math.round(base * (1 + magic * 0.010) * 15);
        game.gold += gold;
        game.floaters.push(acquireFloatingText(game.map.exit.x+0.5, game.map.exit.y+0.5, `📦 +${formatCompact(gold)}`, 1.1, 18, false, false));
        game.centerQueue.push({ text:`Carepackage +${gold}g`, life:2.0 });
        game.logEvent(`Carepackage (Prestige): +${gold}`);
        return true;
      }
      return false;
    }

    cleaveShootAll(game){
      const r2=this.range*this.range;
      const targets = [];
      for (const e of game.enemies) {
        if (e.dead || e.reachedExit) continue;
        if (dist2(this.x,this.y,e.x,e.y) <= r2) targets.push(e);
      }
      if (targets.length === 0) return;

      // her hedefe aynı atış
      for (const e of targets) {
        this.shoot(e, game, true);
      }
    }

    poisonPrestigeBomb(game){
      // Devasa bombayı en öndeki düşmanın üstüne at (yoksa çıkışa)
      let anchor = null;
      for (const e of game.enemies) {
        if (e.dead || e.reachedExit) continue;
        if (!anchor || e.pathIndex > anchor.pathIndex) anchor = e;
      }
      const ax = anchor ? anchor.x : (game.map.exit.x+0.5);
      const ay = anchor ? anchor.y : (game.map.exit.y+0.5);

      const magic = magicPower(this);
      const { stacksBonus, perTickBoost } = toxicSurgeProfile(this);
      const basePerTick = (2.0 + (this.level-1)*0.18) * this.perks.dmgMul;
      const prestigePoisonMul = 4.2 + magic * 0.0105;
      const perTick = basePerTick * perTickBoost * prestigePoisonMul;

      const applyToxicSurge = (enemy) => {
        const burstStacks = 8 + (stacksBonus * 4) + Math.floor(magic / 16);
        enemy.applyPoison(burstStacks, perTick, this, this.magicPenFlat);
        const passMagic = (95 + magic * 5.8) * this.perks.dmgMul;
        const dealt = enemy.takeDamage(0, passMagic, this.armorPenPct, this.magicPenFlat, this, true);
        this.damageDealt += dealt;
        game.effects.push(acquireEffectLine(enemy.x-0.12, enemy.y, enemy.x+0.12, enemy.y, 0.18, "rgba(34,197,94,0.95)", 3));
      };

      const spawnRing = () => {
        const ringRadius = CFG.POISON_BOMB_RADIUS_TILES * 1.35;
        const ringSpeed = Math.max(7.6, ringRadius * 8.4);
        game.rings.push(acquireEffectRing(
          ax, ay,
          ringRadius,
          ringSpeed,
          0.45,
          "rgba(34,197,94,0.70)",
          (enemy) => applyToxicSurge(enemy)
        ));
      };

      // yavaş ve görünür projectile (patlama sonrası da yönünde ilerlemeye devam eder)
      const proj = acquireFreeProjectile(
        this.x, this.y,
        ax, ay,
        CFG.POISON_PRESTIGE_PROJECTILE_SPEED,
        { color:"rgba(34,197,94,0.90)", radius:CFG.POISON_PRESTIGE_PASS_RADIUS_TILES },
        () => spawnRing(),
        {
          stopOnArrive: false,
          continueDirectionOnArrive: true,
          passRadiusTiles: CFG.POISON_PRESTIGE_PASS_RADIUS_TILES * 1.45,
          onPass: (enemy) => applyToxicSurge(enemy),
          passRepeatSec: 0.07
        }
      );
      game.projectiles.push(proj);

      game.centerQueue.push({ text: this.def.prestige?.name || "Plague Bomb", life:2.0 });
    }

    shoot(enemy, game, isCleave=false){
      SFX.shoot();
      if (this.def.id === "archer" || this.def.id === "breaker" || this.def.id === "sniper") {
        if (enemy?.x < this.x) this.facing = -1;
        else this.facing = 1;
      }
      let phys = randInt(this.AD[0], this.AD[1]) * this.perks.adMul * this.peelMul("ad");
      let mag = (this.magicBonus || 0) * this.perks.magMul * this.peelMul("mag");

      if(this.def.id==="breaker") phys += breakerArmorBonus(enemy.armor);

      const isCrit = Math.random() < this.critChance;
      this._lastShotWasCrit = isCrit;
      if(isCrit){ phys *= this.critDmg; mag *= this.critDmg; }

      phys *= this.perks.dmgMul;
      mag  *= this.perks.dmgMul;

      // Archer normal skill
      let skillRes = this.def.skill ? this.def.skill(this) : null;

      // Mage prestige: tüm atışlar chain
      if (this.def.id === "mage" && this.forceChainAll) {
        const magic = magicPower(this);
        const jumps = 3 + Math.floor((this.level-1)/2) + Math.floor(magic/110);
        const mult  = mageChainMultiplier(this.level);
        const radius= 2.65 + (this.level-1)*0.03 + magic*0.0012;
        skillRes = { kind:"chain", chain: { jumps, radiusTiles: radius, multiplier: mult } };
      }

      if (skillRes?.kind === "overlevel") {
        this.applySecondaryLevelGain();
        game.centerQueue.push({ text:`Overlevel +1 (S:${this.secondaryLevel})`, life:1.8 });
      }

      const fireOnce = (skillResLocal, targetEnemy) => {
        const target = targetEnemy || enemy;
        let pPhys=phys;
        let pMag=mag;

        if(skillResLocal?.bonusPhysicalMultiplier) pPhys *= skillResLocal.bonusPhysicalMultiplier;

        let visual = { color:"rgba(255,255,255,0.88)", radius:0.11 };
        if (this.def.id==="archer")  visual = { color:"rgba(186,230,253,0.98)", radius:0.10 };
        if (this.def.id==="mage")    visual = { color:"rgba(99,102,241,0.98)", radius:0.125 };
        if (this.def.id==="breaker") visual = { color:"rgba(239,68,68,0.98)", radius:0.13 };
        if (this.def.id==="poison")  visual = { color:"rgba(34,197,94,0.98)", radius:0.13 };
        if (this.def.id==="sniper")  visual = {
          color:"rgba(248,250,252,0.99)",
          radius:0.08,
          trail: {
            color: "rgba(226,232,240,0.92)",
            life: 0.36,
            size: 0.10,
            rise: 0.32,
            spawnEvery: 0.012
          }
        };
        if (skillResLocal?.kind==="powershot") visual = { color:"rgba(125,211,252,0.99)", radius:0.155 };
        if (this.def.id === "poison" && skillResLocal?.kind === "toxic") {
          visual = {
            color:"rgba(22,101,52,0.99)",
            radius:0.19,
            trail: {
              color: "rgba(21,128,61,0.62)",
              life: 0.28,
              size: 0.13,
              rise: 0.18,
              spawnEvery: 0.015
            }
          };
        }

        const projSpeed = (this.def.id === "sniper")
          ? Math.max(40, this.getProjectileSpeed() * 6.5)
          : this.getProjectileSpeed();
        const expected = this.expectedDamageAgainst(target);
        const floatColor = (this.def.id === "archer" && skillResLocal?.kind === "powershot")
          ? "rgba(96,165,250,0.98)"
          : null;

        const payload = {
          physRaw: pPhys,
          magicRaw: pMag,
          armorPenPct: this.armorPenPct,
          magicPenFlat: this.magicPenFlat,
          floatColor,
          onHit: (hitEnemy, g, dealt, srcTower) => {

            // Breaker auto attack: always shred
            if (this.def.id === "breaker") {
              const autoShred = breakerAutoShred(this);
              hitEnemy.applyArmorShred(autoShred, srcTower);
              game.effects.push(acquireEffectLine(hitEnemy.x, hitEnemy.y-0.06, hitEnemy.x, hitEnemy.y+0.06, 0.20, "rgba(239,68,68,0.9)", 3));
            }

            // Breaker skill: AOE bomb with damage + armor shred
            if (skillResLocal?.kind === "breakerBomb") {
              const radiusTiles = Math.max(0.8, skillResLocal.radiusTiles || 1.8);
              const rr2 = radiusTiles * radiusTiles;
              game.rings.push(acquireEffectRing(
                hitEnemy.x, hitEnemy.y,
                radiusTiles,
                Math.max(6.0, radiusTiles * 8.0),
                0.32,
                "rgba(239,68,68,0.72)",
                (e) => {
                  const d2 = dist2(hitEnemy.x, hitEnemy.y, e.x, e.y);
                  if (d2 > rr2) return;
                  e.applyArmorShred(skillResLocal.shredFlat || 0, srcTower);
                  const d = e.takeDamage(0, skillResLocal.magicDamage || 0, this.armorPenPct, this.magicPenFlat, this, true);
                  this.damageDealt += d;
                },
                5.2
              ));
            }

            // Poison: kalıcı stack
            if (this.def.id === "poison") {
              const avgAd = ((this.AD[0] + this.AD[1]) / 2) * this.perks.adMul * this.peelMul("ad");
              const baseTick = ((2.0 + (this.level-1)*0.18) * this.perks.dmgMul) + (avgAd * POISON_SKILL_AD_DOT_SCALE);
              let stacksAdd = 1;

              if (skillResLocal?.kind === "toxic") {
                stacksAdd += skillResLocal.stacksBonus;
              }

              let perTick = baseTick;
              if (skillResLocal?.kind === "toxic") {
                perTick *= skillResLocal.perTickBoost;
              }

              hitEnemy.applyPoison(stacksAdd, perTick, srcTower, this.magicPenFlat);
              game.effects.push(acquireEffectLine(hitEnemy.x-0.12, hitEnemy.y, hitEnemy.x+0.12, hitEnemy.y, 0.18, "rgba(34,197,94,0.95)", 3));
            }

            // Blizzard: auto attacks always apply slow
            if (this.def.id === "blizzard") {
              const bp = blizzardSlowProfile(this);
              hitEnemy.applySlow(bp.slowPct, bp.duration, srcTower);

              if (this.prestigeActive > 0 && hitEnemy.frostbiteTime <= 0 && hitEnemy.frostbiteDotTime <= 0) {
                const magic = magicPower(this);
                const dur = 3.0;
                const perTick = (2.0 + magic * 1.75) * this.perks.dmgMul;
                hitEnemy.applyFrostbite(dur, perTick, this, this.magicPenFlat);
              }
            }

            // Sniper: mini-stun (0.1s %100 slow)
            if (this.def.id === "sniper") {
              hitEnemy.applySlow(1.0, 0.10, srcTower);
              game.effects.push(acquireEffectLine(this.x, this.y, hitEnemy.x, hitEnemy.y, 0.10, "rgba(248,250,252,0.92)", 2));
            }

            // Mage chain: MAGIC ONLY
            if (skillResLocal?.kind === "chain" && skillResLocal.chain) {
              const { jumps, radiusTiles, multiplier } = skillResLocal.chain;
              let remaining = Math.max(0, jumps);
              let current = hitEnemy;
              const hitSet = new Set([hitEnemy]);
              const rr2 = radiusTiles * radiusTiles;
              const chainMult = Math.min(multiplier, 0.99);
              let prevDealtCap = Math.max(0, dealt);
              let chainRawMag = pMag * chainMult;
              const hopDelay = clamp(0.17 / Math.max(0.25, this.AS), 0.03, 0.22);

              const doHop = () => {
                if (remaining <= 0 || !current || current.reachedExit) return;
                if (prevDealtCap <= 0 || chainRawMag <= 0) return;

                let next = null;
                let bestD2 = Infinity;
                for (const e of game.enemies) {
                  if (e.dead || e.reachedExit || e === current || hitSet.has(e)) continue;
                  const d2 = dist2(current.x, current.y, e.x, e.y);
                  if (d2 <= rr2 && d2 < bestD2) {
                    bestD2 = d2;
                    next = e;
                  }
                }
                if (!next) return;

                game.effects.push(acquireEffectLine(current.x, current.y, next.x, next.y, 0.58, "rgba(56,189,248,1.0)", 6));
                game.effects.push(acquireEffectLine(current.x, current.y, next.x, next.y, 0.36, "rgba(186,230,253,0.95)", 2));
                game.rings.push(acquireEffectRing(next.x, next.y, 0.62, 6.8, 0.30, "rgba(125,211,252,0.95)"));
                next.applySlow(0.18, 0.45, srcTower);

                let rawMag = chainRawMag;
                const vulnMul = next._blizVulnMul || 1;
                const predicted = applyMagicDamage(rawMag, next.mr, this.magicPenFlat) * vulnMul;
                if (predicted > prevDealtCap && predicted > 0) {
                  rawMag *= (prevDealtCap / predicted);
                }

                const chainDealt = next.takeDamage(0, rawMag, this.armorPenPct, this.magicPenFlat, srcTower, true);
                if (srcTower) srcTower.damageDealt += chainDealt;
                prevDealtCap = Math.min(prevDealtCap, chainDealt);
                current = next;
                hitSet.add(next);
                remaining -= 1;
                chainRawMag *= chainMult;

                if (remaining > 0) {
                  if (typeof game.deferAction === "function") game.deferAction(hopDelay, doHop);
                  else doHop();
                }
              };

              if (remaining > 0) {
                if (typeof game.deferAction === "function") game.deferAction(hopDelay, doHop);
                else doHop();
              }
            }
          }
        };

        if (skillResLocal?.kind === "frostPulse") {
          game.rings.push(acquireEffectRing(
            this.x, this.y,
            this.range,
            Math.max(3.5, this.range * 4.0),
            0.35,
            "rgba(56,189,248,0.72)",
            (e)=> {
              e.applySlow(skillResLocal.slowPct, skillResLocal.duration, this);
              const rollAD = randInt(this.AD[0], this.AD[1]) * this.perks.adMul * this.peelMul("ad");
              const basePulseMagic = (8 + magicPower(this) * 0.85) * this.perks.magMul * this.peelMul("mag");
              let pulseMag = (basePulseMagic + rollAD * 0.35) * this.perks.dmgMul;
              const pulseCrit = Math.random() < this.critChance;
              if (pulseCrit) pulseMag *= this.critDmg;
              this._lastShotWasCrit = pulseCrit;
              const d = e.takeDamage(0, pulseMag, this.armorPenPct, this.magicPenFlat, this, true);
              this.damageDealt += d;
            },
            5.8
          ));
        }

        game.projectiles.push(acquireProjectile(this.x, this.y, target, projSpeed, payload, visual, expected, this));
      };

      fireOnce(skillRes, enemy);
    }
  }

  // =========================================================
  // Wave-based state
  // =========================================================
  
export {
  MILESTONES,
  milestoneTier,
  tierASPct,
  tierADPct,
  tierMagicPct,
  peelBuffPower,
  peelBounceCountFromAD,
  MODES,
  buildChoicesForTower,
  setSpecialLegendaryMode,
  gainCurve,
  upgradeCostCurve,
  TOWER_DEFS,
  Tower
};

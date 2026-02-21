import { CFG } from "./config.js";
import { clamp, dist2, now, formatCompact, pickN } from "./utils.js";
import { SFX } from "./audio.js";
import { GameMap } from "./map.js";
import { Enemy, computePrevWaveTotals, listEnemyModifiers } from "./enemies.js";
import { scaleForWave, waveModifiers, WaveState, setEndlessScalingEnabled, getWaveEnemyCap } from "./waves.js";
import { Tower, milestoneTier, buildChoicesForTower, gainCurve, upgradeCostCurve, peelBuffPower, peelBounceCountFromAD } from "./towers.js";
import { openModal, closeModal, isModalOpen } from "./ui.js";
import { createGameUiAdapter } from "./ui_adapter.js";
import { SpatialIndex } from "./spatial_index.js";
import { CONTENT_REGISTRY } from "./content_registry.js";
import { GAME_EVENTS, createEventBus } from "./events.js";
import {
  releaseAnyProjectile,
  releaseAnyEffect,
  releaseEffectRing,
  releaseFloatingText
} from "./projectiles.js";

const BOSS_SKILL_INFO = {
  cleanse: { name: "Cleanse", color: "rgba(59,130,246,0.85)" },
  heal: { name: "Heal", color: "rgba(34,197,94,0.88)" },
  summon: { name: "Summon", color: "rgba(168,85,247,0.85)" }
};

const MAP_BG_BY_MAP = {
  0: {
    src: "assets/ARMTD_NEO.png",
    crop: { x: 0.0, y: 0.0, w: 1.0, h: 1.0 },
    scale: 1.0
  },
  1: {
    src: "assets/ARTMTD_XENO.png",
    crop: { x: 0.0, y: 0.0, w: 1.0, h: 1.0 },
    scale: 1.0
  }
};

const ARCHER_SPRITE = {
  src: "assets/archer.png"
};

const MAGE_SPRITE = {
  src: "assets/mage.png"
};

const BREAKER_SPRITE = {
  src: "assets/breaker.png"
};

const BLIZZARD_SPRITE = {
  src: "assets/blizzard.png"
};

const POISON_SPRITE = {
  src: "assets/poison.png"
};

const SNIPER_SPRITE = {
  src: "assets/sniper.png"
};

const PEEL_SPRITE = {
  src: "assets/peel.png"
};

const PEEL_BUFF_INFO = {
  ad: { name: "AD", color: "rgba(239,68,68,0.95)" },
  as: { name: "AS", color: "rgba(34,197,94,0.95)" },
  rng: { name: "RANGE", color: "rgba(251,146,60,0.95)" },
  mag: { name: "MAGIC", color: "rgba(99,102,241,0.95)" },
  purge: { name: "PURGE", color: "rgba(14,165,233,0.95)" }
};

// Versioning: patch (right) for every update, minor (middle) for big updates.
// Major (left) is increased manually.
const GAME_VERSION = "0.2.72";
const LOG_TIPS = [
  "Tip: Discover each tower's unique skill and prestige skill.",
  "Tip: Towers can reach level 20. Sometimes even higher.",
  "Tip: Towers gain mana over time and also gain mana when they attack.",
  "Tip: Mix different tower roles to keep your defense balanced.",
  "Tip: Damage + Attack Speed is strong, but other combos can carry too.",
  "Tip: Save gold before boss waves so you can react quickly.",
  "Tip: Upgrade key towers first, then fill gaps with utility.",
  "Tip: Mana-focused setups can keep skills active more often.",
  "Tip: Don't overbuild early; reserve economy for key upgrades.",
  "Tip: Try to activate prestige a bit before pressure spikes."
];
const START_GOLD_BASE = 150;
const START_GOLD_REWARD_KEY = "armtd_start_gold_reward_v1";
const START_CORE_HP = 25;
const RUN_SAVE_SCHEMA = 2;
const RUN_SAVE_MIN_SUPPORTED_SCHEMA = 1;
const PERSISTENT_STATS_KEY = "armtd_stats_lifetime_v1";
const TOWER_DEF_BY_ID = CONTENT_REGISTRY.towers.byId;

function getStartingGold(){
  try {
    return localStorage.getItem(START_GOLD_REWARD_KEY) === "1" ? 180 : START_GOLD_BASE;
  } catch (_) {
    return START_GOLD_BASE;
  }
}

function buildTowerCounter(seed = 0){
  const out = {};
  for (const def of CONTENT_REGISTRY.towers.list) out[def.id] = seed;
  return out;
}

function clampNumber(v, min=0, fallback=0){
  const n = Number(v);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, n);
}

function normalizeGridCell(v){
  const n = Math.floor(Number(v) || 0);
  if (n === 1 || n === 2) return n;
  return 0;
}

function compactInPlace(arr, keep, onDrop){
  let w = 0;
  for (let r = 0; r < arr.length; r += 1) {
    const item = arr[r];
    if (!keep(item, r)) {
      if (onDrop) onDrop(item, r);
      continue;
    }
    if (w !== r) arr[w] = item;
    w += 1;
  }
  arr.length = w;
  return arr;
}

function addRoundRectPath(ctx, x, y, w, h, r){
  if (typeof ctx.roundRect === "function") {
    ctx.roundRect(x, y, w, h, r);
    return;
  }
  ctx.rect(x, y, w, h);
}

function magePrestigeAuraMulFromMagic(magic){
  const m = Math.max(0, Number(magic) || 0);
  return 5 + Math.pow(m / 260, 0.76) * 2.10;
}

function magePrestigeAuraRangeBonusFromMagic(magic){
  const m = Math.max(0, Number(magic) || 0);
  return Math.pow(m / 600, 0.60) * 0.45;
}

function createEmptyRunStats(){
  return {
    totalKills: 0,
    totalDamage: 0,
    maxSingleHit: 0,
    maxWaveSeen: 0,
    towerBuildCounts: buildTowerCounter(0),
    towerKillCounts: buildTowerCounter(0),
    towerDamage: buildTowerCounter(0)
  };
}

function readPersistentStats(){
  try {
    const raw = localStorage.getItem(PERSISTENT_STATS_KEY);
    if (!raw) return createEmptyRunStats();
    return normalizeRunStats(JSON.parse(raw));
  } catch (_) {
    return createEmptyRunStats();
  }
}

function writePersistentStats(stats){
  try {
    localStorage.setItem(PERSISTENT_STATS_KEY, JSON.stringify(normalizeRunStats(stats)));
  } catch (_) {}
}

function createEmptyRunQuestState(){
  return {
    coreDamaged: false,
    sniperPurchased: false,
    campaignCleared: false,
    clearedAtWave: 0
  };
}

function normalizeTowerCounter(raw){
  const out = buildTowerCounter(0);
  if (!raw || typeof raw !== "object") return out;
  for (const def of CONTENT_REGISTRY.towers.list) {
    out[def.id] = Math.floor(clampNumber(raw[def.id], 0, 0));
  }
  return out;
}

function normalizeRunStats(raw){
  const base = createEmptyRunStats();
  if (!raw || typeof raw !== "object") return base;
  base.totalKills = Math.floor(clampNumber(raw.totalKills, 0, 0));
  base.totalDamage = clampNumber(raw.totalDamage, 0, 0);
  base.maxSingleHit = clampNumber(raw.maxSingleHit, 0, 0);
  base.maxWaveSeen = Math.floor(clampNumber(raw.maxWaveSeen, 0, 0));
  base.towerBuildCounts = normalizeTowerCounter(raw.towerBuildCounts);
  base.towerKillCounts = normalizeTowerCounter(raw.towerKillCounts);
  base.towerDamage = normalizeTowerCounter(raw.towerDamage);
  return base;
}

function normalizeRunQuestState(raw){
  const base = createEmptyRunQuestState();
  if (!raw || typeof raw !== "object") return base;
  base.coreDamaged = !!raw.coreDamaged;
  base.sniperPurchased = !!raw.sniperPurchased;
  base.campaignCleared = !!raw.campaignCleared;
  base.clearedAtWave = Math.floor(clampNumber(raw.clearedAtWave, 0, 0));
  return base;
}

function normalizeMapDef(raw){
  if (!raw || typeof raw !== "object") return null;
  const gridW = Math.max(4, Math.min(40, Math.floor(clampNumber(raw.gridW, 4, 20))));
  const gridH = Math.max(4, Math.min(30, Math.floor(clampNumber(raw.gridH, 4, 15))));
  const srcGrid = Array.isArray(raw.grid) ? raw.grid : [];
  const grid = Array.from({ length: gridH }, (_, y) => {
    const row = Array.isArray(srcGrid[y]) ? srcGrid[y] : [];
    return Array.from({ length: gridW }, (_, x) => normalizeGridCell(row[x]));
  });
  const entrance = {
    x: Math.max(0, Math.min(gridW - 1, Math.floor(clampNumber(raw.entrance?.x, 0, 0)))),
    y: Math.max(0, Math.min(gridH - 1, Math.floor(clampNumber(raw.entrance?.y, 0, 0))))
  };
  const exit = {
    x: Math.max(0, Math.min(gridW - 1, Math.floor(clampNumber(raw.exit?.x, 0, gridW - 1)))),
    y: Math.max(0, Math.min(gridH - 1, Math.floor(clampNumber(raw.exit?.y, 0, gridH - 1))))
  };
  grid[entrance.y][entrance.x] = 1;
  grid[exit.y][exit.x] = 1;
  return {
    name: String(raw.name || "Custom Map"),
    gridW,
    gridH,
    entrance,
    exit,
    grid,
    hazards: []
  };
}

function getCampaignMapCount(){
  return Math.max(1, Math.floor(Number(CONTENT_REGISTRY.maps.count) || 0));
}

function clampCampaignMapIndex(raw){
  const max = Math.max(0, getCampaignMapCount() - 1);
  return Math.min(max, Math.max(0, Math.floor(clampNumber(raw, 0, 0))));
}

function getCampaignMapDef(rawIndex){
  const safe = clampCampaignMapIndex(rawIndex);
  return CONTENT_REGISTRY.maps.get(safe) || CONTENT_REGISTRY.maps.get(0);
}

function createRunSaveMeta(raw){
  const src = raw && typeof raw === "object" ? raw : {};
  const migratedFromSchema = Number.isFinite(Number(src.migratedFromSchema))
    ? Math.floor(Number(src.migratedFromSchema))
    : null;
  const migratedAt = Number.isFinite(Number(src.migratedAt))
    ? Math.floor(Number(src.migratedAt))
    : null;
  return {
    source: String(src.source || "runtime"),
    migratedFromSchema,
    migratedAt
  };
}

function migrateRunSaveV1ToV2(raw){
  if (!raw || typeof raw !== "object") return null;
  const base = { ...raw };
  base.schema = 2;
  base.gameVersion = String(base.gameVersion || "unknown");
  base.savedAt = Math.floor(clampNumber(base.savedAt, 0, Date.now()));
  base.meta = createRunSaveMeta({
    source: "runtime",
    migratedFromSchema: 1,
    migratedAt: Date.now()
  });
  return base;
}

function migrateRunSaveToCurrent(raw){
  if (!raw || typeof raw !== "object") return null;
  const schema = Math.floor(clampNumber(raw.schema, 0, 0));
  if (schema > RUN_SAVE_SCHEMA || schema < RUN_SAVE_MIN_SUPPORTED_SCHEMA) return null;
  if (schema === RUN_SAVE_SCHEMA) return raw;
  let out = raw;
  let cursor = schema;
  while (cursor < RUN_SAVE_SCHEMA) {
    if (cursor === 1) {
      out = migrateRunSaveV1ToV2(out);
      cursor = 2;
      continue;
    }
    return null;
  }
  return out;
}

function normalizeRunSaveData(raw){
  const migrated = migrateRunSaveToCurrent(raw);
  if (!migrated || typeof migrated !== "object") return null;
  const customMapDef = normalizeMapDef(migrated.customMapDef);
  const isCustomMapRun = !!migrated.isCustomMapRun && !!customMapDef;
  const stats = normalizeRunStats(migrated.stats);
  const totalKills = Math.floor(clampNumber(migrated.totalKills, 0, 0));
  stats.totalKills = Math.max(stats.totalKills, totalKills);
  return {
    schema: RUN_SAVE_SCHEMA,
    gameVersion: String(migrated.gameVersion || "unknown"),
    savedAt: Math.floor(clampNumber(migrated.savedAt, 0, Date.now())),
    mapIndex: clampCampaignMapIndex(migrated.mapIndex),
    gold: Math.floor(clampNumber(migrated.gold, 0, getStartingGold())),
    coreHP: clampNumber(migrated.coreHP, 0, START_CORE_HP),
    totalKills,
    resumeWave: Math.floor(clampNumber(migrated.resumeWave, 0, 0)),
    started: !!migrated.started,
    endlessMode: !!migrated.endlessMode,
    isCustomMapRun,
    customMapDef: isCustomMapRun ? customMapDef : null,
    towers: Array.isArray(migrated.towers) ? migrated.towers : [],
    stats,
    questState: normalizeRunQuestState(migrated.questState),
    meta: createRunSaveMeta(migrated.meta)
  };
}

class Game {
    constructor(canvas){
      this.cv=canvas;
      this.ctx=canvas.getContext("2d");

      this.mapIndex=0;
      this.map=new GameMap(getCampaignMapDef(this.mapIndex));
      this.isCustomMapRun = false;
      this.useMapBackground = true;

      this.gold=getStartingGold();
      this.coreHP=START_CORE_HP;
      this.totalKills=0;

      this.currentWave = 0;
      this.nextWaveNum = 1;
      this.wavesActive = [];

      this.started=false;
      this.autoQueueDelay=0.35;
      this.autoQueueTimer=0;

      this.towers=[];
      this.enemies=[];
      this.projectiles=[];
      this.effects=[];
      this.rings=[];
      this.enemySpatial = new SpatialIndex(1.5);
      this.towerSpatial = new SpatialIndex(1.5);
      this._enemyRangeScratch = [];
      this._towerRangeScratch = [];

      this.floaters=[];        // damage/gold text (enemy Ã¼zerinde)
      this.centerQueue=[];     // ekran ortasÄ± ardÄ±ÅŸÄ±k yazÄ±lar
      this.deferredActions=[]; // delayed gameplay steps (chain/bounce)

      this.selectedTowerDef=null;
      this.selectedTowerInstance=null;
      this.selectedEnemy=null;
      this.hoverGrid=null;

      this.gameSpeed=1.0;
      this.prevSpeedBeforeModal=1.0;
      this.screenShakeTime = 0;
      this.screenShakeMaxTime = 0;
      this.screenShakePower = 0;

      this.gameOver=false;
      this.highKills=[];

      this.anyBreakerPrestigeActive = false;
      this.anyBlizzardPrestigeActive = false;
      this.peelUplinkCastsByWave = {};
      this.lastUplinkRewardWave = 0;
      this.waveEndUplinkNotice = null;
      this.waveStartCheckpoint = null;
      this.nextWaveNowGoldBuff = { mult: 1, timeLeft: 0, maxTime: 0 };
      this._prevWaveActive = false;
      this.endlessMode = false;
      this.campaignWinShown = false;
      this.winModalOpen = false;
      this.runStartMs = performance.now();
      this.runClearSec = 0;
      this._lastLoadMigrationFromSchema = null;
      this.runStats = createEmptyRunStats();
      this.lifetimeStats = readPersistentStats();
      this.runQuestState = createEmptyRunQuestState();
      this._campaignClearNotified = false;
      this.onCampaignClear = null;
      this.events = createEventBus();
      setEndlessScalingEnabled(false);

      this.uiAdapter = createGameUiAdapter(document);
      const ui = this.uiAdapter.refs;
      this.logEl = ui.logLines;
      this.logMax = 80;
      this.logTitleEl = ui.hudLogTitle;
      this._startLogged = false;
      this.hoverSpecialChoice = null;
      this.uiHover = { upgrade:false, fast:false };
      // UI refresh throttling: avoid rebuilding large DOM panels every frame.
      this._uiDirty = true;
      this._uiRefreshTimer = 0;
      this._uiRefreshInterval = 1 / 12;
      // Lifetime stats persistence throttling: avoid localStorage writes on every hit/kill.
      this._statsDirty = false;
      this._statsFlushTimer = 0;
      this._statsFlushInterval = 1.0;
      this._perfAcc = { sec: 0, frames: 0, frameMs: 0, updateMs: 0, drawMs: 0, uiMs: 0 };
      this.seenModifierIds = new Set();
      this.modifierIntroOpen = false;
      this.modifierIntroPrevSpeed = 1.0;
      this.infoModalsEnabled = true;
      this.modifierIntroAutoCloseTimer = null;
      this.modifierIntroBack = ui.modifierIntroBack;
      this.modifierIntroTitle = ui.modifierIntroTitle;
      this.modifierIntroText = ui.modifierIntroText;
      this.modifierIntroIcon = ui.modifierIntroIcon;
      this.modifierIntroCloseBtn = ui.modifierIntroClose;
      if (this.modifierIntroCloseBtn) {
        this.modifierIntroCloseBtn.onclick = () => this.closeModifierIntro();
      }
      this.winBack = ui.winBack;
      this.winTime = ui.winTime;
      this.winEndBtn = ui.winEndBtn;
      this.winEndlessBtn = ui.winEndlessBtn;
      if (this.winEndBtn) this.winEndBtn.onclick = () => this.endRunAfterWin();
      if (this.winEndlessBtn) this.winEndlessBtn.onclick = () => this.enterEndlessMode();
      this.gameOverBack = ui.gameOverBack;
      this.gameOverRestartBtn = ui.gameOverRestartBtn;
      this.gameOverMainMenuBtn = ui.gameOverMainMenuBtn;
      this.hudGoldEl = ui.hudGold;
      this.hudCoreHpEl = ui.hudCoreHp;
      this.hudKillsEl = ui.hudKills;
      this.hudWaveEl = ui.hudWave;
      this.hudMobsEl = ui.hudMobs;
      this.mapNameEl = ui.mapName;
      this.startWaveBtnEl = ui.startWaveBtn;
      this.nextWaveNowBtnEl = ui.nextWaveNowBtn;
      this.selectedInfoHudEl = ui.selectedInfoHud;
      this.upgradeBtnHudEl = ui.upgradeBtnHud;
      this.fastUpgradeBtnHudEl = ui.fastUpgradeBtnHud;
      this.sellBtnHudEl = ui.sellBtnHud;
      this.onGameOverMainMenu = null;
      if (this.gameOverRestartBtn) this.gameOverRestartBtn.onclick = () => this.restart();
      if (this.gameOverMainMenuBtn) {
        this.gameOverMainMenuBtn.onclick = () => {
          this.hideGameOverModal();
          this.emitGameEvent(GAME_EVENTS.GAME_OVER_MAIN_MENU, {
            waveNum: Math.max(0, this.currentWave || 0),
            totalKills: Math.max(0, this.totalKills || 0)
          });
          if (typeof this.onGameOverMainMenu === "function") this.onGameOverMainMenu();
        };
      }

      this.mapBg = new Image();
      this.mapBgReady = false;
      this.mapBg.onload = () => { this.mapBgReady = true; };
      this.refreshMapBackground();

      this.archerSprite = new Image();
      this.archerSpriteReady = false;
      this.archerSprite.onload = () => { this.archerSpriteReady = true; };
      this.archerSprite.src = ARCHER_SPRITE.src;

      this.mageSprite = new Image();
      this.mageSpriteReady = false;
      this.mageSprite.onload = () => { this.mageSpriteReady = true; };
      this.mageSprite.src = MAGE_SPRITE.src;

      this.breakerSprite = new Image();
      this.breakerSpriteReady = false;
      this.breakerSprite.onload = () => { this.breakerSpriteReady = true; };
      this.breakerSprite.src = BREAKER_SPRITE.src;

      this.blizzardSprite = new Image();
      this.blizzardSpriteReady = false;
      this.blizzardSprite.onload = () => { this.blizzardSpriteReady = true; };
      this.blizzardSprite.src = BLIZZARD_SPRITE.src;

      this.poisonSprite = new Image();
      this.poisonSpriteReady = false;
      this.poisonSprite.onload = () => { this.poisonSpriteReady = true; };
      this.poisonSprite.src = POISON_SPRITE.src;

      this.sniperSprite = new Image();
      this.sniperSpriteReady = false;
      this.sniperSprite.onload = () => { this.sniperSpriteReady = true; };
      this.sniperSprite.src = SNIPER_SPRITE.src;

      this.peelSprite = new Image();
      this.peelSpriteReady = false;
      this.peelSprite.onload = () => { this.peelSpriteReady = true; };
      this.peelSprite.src = PEEL_SPRITE.src;

      this.resizeCanvasToDisplaySize();
      window.addEventListener("resize", ()=>this.resizeCanvasToDisplaySize());
      window.addEventListener("beforeunload", () => this.persistLifetimeStats(true));

      this.lastT=now();
      SFX.bindAutoUnlock();
      this.bindInput();
      this.refreshUI(true);
      if (this.logTitleEl) this.logTitleEl.textContent = `Log ${GAME_VERSION}`;
      this.logEvent(`Build ${GAME_VERSION} loaded.`);
      this.logEvent("Shortcuts enabled. Ready.");
      this.loop();
    }

    getMapBackgroundDef(){
      return MAP_BG_BY_MAP[this.mapIndex] || MAP_BG_BY_MAP[0];
    }

    refreshMapBackground(){
      const bgDef = this.getMapBackgroundDef();
      if (!bgDef?.src) return;
      this.mapBgReady = false;
      this.mapBg.src = bgDef.src;
    }

    canPrestigeUpgrade(tower){
      // New rule: no global condition. Only 1 prestige tower per type is allowed.
      if (!tower) return true;
      return !this.towers.some(t =>
        t !== tower &&
        t.def.id === tower.def.id &&
        t.level >= CFG.PRESTIGE_LEVEL
      );
    }

    clearSelection(){
      this.selectedTowerInstance = null;
      this.selectedEnemy = null;
      this.hoverGrid = null;
    }

    clearPlacement(){
      this.selectedTowerDef = null;
      this.hoverGrid = null;
    }

    deferAction(delaySec, fn){
      if (typeof fn !== "function") return;
      this.deferredActions.push({
        t: Math.max(0, Number(delaySec) || 0),
        fn
      });
    }

    syncSpeedUI(v){
      this.uiAdapter.syncSpeed(v);
    }

    addScreenShake(power=0.06, duration=0.20){
      const p = Math.max(0, Number(power) || 0);
      const d = Math.max(0, Number(duration) || 0);
      if (p <= 0 || d <= 0) return;
      this.screenShakePower = Math.max(this.screenShakePower, p);
      this.screenShakeTime = Math.max(this.screenShakeTime, d);
      this.screenShakeMaxTime = Math.max(this.screenShakeMaxTime, this.screenShakeTime);
    }

    getScreenShakeOffset(){
      if (this.screenShakeTime <= 0 || this.screenShakePower <= 0) return { x: 0, y: 0 };
      const fade = (this.screenShakeMaxTime > 0)
        ? clamp(this.screenShakeTime / this.screenShakeMaxTime, 0, 1)
        : 0;
      const amp = this.tileSize * this.screenShakePower * fade;
      const a = Math.random() * Math.PI * 2;
      return { x: Math.cos(a) * amp, y: Math.sin(a) * amp };
    }

    drawModifierIntroIcon(modifier){
      if (!this.modifierIntroIcon) return;
      const c = this.modifierIntroIcon;
      const ctx = c.getContext("2d");
      if (!ctx) return;
      ctx.clearRect(0, 0, c.width, c.height);
      const cx = c.width * 0.5;
      const cy = c.height * 0.5;
      const size = Math.min(c.width, c.height) * 0.34;
      if (modifier?.iconKind === "affix") {
        this.drawAffixIcon(ctx, modifier.iconId, cx, cy, size);
      } else {
        this.drawStatusIcon(ctx, modifier?.iconId || "resist", cx, cy, size);
      }
    }

    showModifierIntro(modifier){
      if (!this.infoModalsEnabled) return;
      if (!modifier || !this.modifierIntroBack || this.modifierIntroOpen) return;
      this.modifierIntroOpen = true;
      this.modifierIntroPrevSpeed = this.gameSpeed;
      this.gameSpeed = 0;
      this.syncSpeedUI(0);
      if (this.modifierIntroTitle) this.modifierIntroTitle.textContent = `New Modifier: ${modifier.name}`;
      if (this.modifierIntroText) this.modifierIntroText.textContent = modifier.desc || "This modifier changes enemy behavior.";
      this.drawModifierIntroIcon(modifier);
      this.modifierIntroBack.style.display = "flex";
      if (this.modifierIntroAutoCloseTimer) clearTimeout(this.modifierIntroAutoCloseTimer);
      this.modifierIntroAutoCloseTimer = setTimeout(() => this.closeModifierIntro(), 5000);
    }

    closeModifierIntro(){
      if (!this.modifierIntroOpen) return;
      this.modifierIntroOpen = false;
      if (this.modifierIntroAutoCloseTimer) {
        clearTimeout(this.modifierIntroAutoCloseTimer);
        this.modifierIntroAutoCloseTimer = null;
      }
      if (this.modifierIntroBack) this.modifierIntroBack.style.display = "none";
      this.gameSpeed = this.modifierIntroPrevSpeed;
      this.syncSpeedUI(this.gameSpeed);
    }

    saveHighKills(){
      const key="td_highkills_v2";
      let arr=[];
      try{ arr=JSON.parse(localStorage.getItem(key)||"[]"); }catch{}
      arr.push(this.totalKills);
      arr = arr.filter(n=>Number.isFinite(n)).map(n=>Math.floor(n));
      arr.sort((a,b)=>b-a);
      arr = arr.slice(0,10);
      localStorage.setItem(key, JSON.stringify(arr));
      this.highKills = arr;
    }

    resetRunStats(){
      this.runStats = createEmptyRunStats();
    }

    persistLifetimeStats(force=false){
      if (!force) {
        this._statsDirty = true;
        return;
      }
      writePersistentStats(this.lifetimeStats);
      this._statsDirty = false;
      this._statsFlushTimer = 0;
    }

    resetRunQuestState(){
      this.runQuestState = createEmptyRunQuestState();
      this._campaignClearNotified = false;
    }

    updateMaxWaveSeen(waveNum){
      const wave = Math.floor(clampNumber(waveNum, 0, 0));
      if (wave <= 0) return;
      this.runStats.maxWaveSeen = Math.max(this.runStats.maxWaveSeen, wave);
      this.lifetimeStats.maxWaveSeen = Math.max(this.lifetimeStats.maxWaveSeen, wave);
      this.persistLifetimeStats();
    }

    recordTowerBuilt(towerId){
      if (!towerId || !this.runStats?.towerBuildCounts) return;
      if (!(towerId in this.runStats.towerBuildCounts)) return;
      this.runStats.towerBuildCounts[towerId] += 1;
      if (towerId in this.lifetimeStats.towerBuildCounts) {
        this.lifetimeStats.towerBuildCounts[towerId] += 1;
        this.persistLifetimeStats();
      }
      this.emitGameEvent(GAME_EVENTS.TOWER_BUILT, {
        towerId: String(towerId),
        runCount: this.runStats.towerBuildCounts[towerId] || 0,
        lifetimeCount: this.lifetimeStats.towerBuildCounts[towerId] || 0
      });
    }

    recordDamage(amount, sourceTower=null){
      const dealt = clampNumber(amount, 0, 0);
      if (dealt <= 0) return;
      this.runStats.totalDamage += dealt;
      this.runStats.maxSingleHit = Math.max(this.runStats.maxSingleHit, dealt);
      this.lifetimeStats.totalDamage += dealt;
      this.lifetimeStats.maxSingleHit = Math.max(this.lifetimeStats.maxSingleHit, dealt);
      const towerId = sourceTower?.def?.id;
      if (towerId && towerId in this.runStats.towerDamage) {
        this.runStats.towerDamage[towerId] += dealt;
      }
      if (towerId && towerId in this.lifetimeStats.towerDamage) {
        this.lifetimeStats.towerDamage[towerId] += dealt;
      }
      this.persistLifetimeStats();
    }

    recordKill(sourceTower=null){
      this.runStats.totalKills = Math.max(this.runStats.totalKills + 1, this.totalKills);
      this.lifetimeStats.totalKills += 1;
      const towerId = sourceTower?.def?.id;
      if (towerId && towerId in this.runStats.towerKillCounts) {
        this.runStats.towerKillCounts[towerId] += 1;
      }
      if (towerId && towerId in this.lifetimeStats.towerKillCounts) {
        this.lifetimeStats.towerKillCounts[towerId] += 1;
      }
      this.persistLifetimeStats();
      this.emitGameEvent(GAME_EVENTS.ENEMY_KILLED, {
        sourceTowerId: towerId ? String(towerId) : null,
        runTotalKills: this.runStats.totalKills,
        lifetimeTotalKills: this.lifetimeStats.totalKills
      });
    }

    getStatsSnapshot(){
      return normalizeRunStats(this.runStats);
    }

    getLifetimeStatsSnapshot(){
      return normalizeRunStats(this.lifetimeStats);
    }

    hardResetPersistentStats(){
      this.lifetimeStats = createEmptyRunStats();
      this.highKills = [];
      this.persistLifetimeStats(true);
      try { localStorage.setItem("td_highkills_v2", "[]"); } catch (_) {}
    }

    getRunQuestSnapshot(){
      return normalizeRunQuestState(this.runQuestState);
    }

    onEvent(eventName, handler){
      return this.events.on(eventName, handler);
    }

    onceEvent(eventName, handler){
      return this.events.once(eventName, handler);
    }

    emitGameEvent(eventName, payload = {}){
      this.events.emit(eventName, {
        event: String(eventName || ""),
        time: performance.now(),
        ...payload
      });
    }

    notifyTowerLevelChanged(tower, fromLevel, reason = "upgrade"){
      if (!tower || !tower.def?.id) return;
      const prevLevel = Math.max(0, Math.floor(Number(fromLevel) || 0));
      const nextLevel = Math.max(0, Math.floor(Number(tower.level) || 0));
      if (nextLevel <= prevLevel) return;
      this.emitGameEvent(GAME_EVENTS.TOWER_LEVEL_UP, {
        towerId: tower.def.id,
        fromLevel: prevLevel,
        toLevel: nextLevel,
        reason
      });
      if (prevLevel < CFG.PRESTIGE_LEVEL && nextLevel >= CFG.PRESTIGE_LEVEL) {
        this.emitGameEvent(GAME_EVENTS.TOWER_PRESTIGE_UNLOCKED, {
          towerId: tower.def.id,
          fromLevel: prevLevel,
          toLevel: nextLevel,
          reason
        });
      }
    }

    getLastLoadMigrationSchema(){
      return this._lastLoadMigrationFromSchema;
    }

    evaluateCampaignStars(){
      const quest = this.getRunQuestSnapshot();
      const cleared = quest.campaignCleared || this.currentWave >= 100;
      return {
        star1: !!cleared,
        star2: !!cleared && !quest.coreDamaged,
        star3: !!cleared && !quest.sniperPurchased
      };
    }

    notifyCampaignClearOnce(){
      if (this._campaignClearNotified) return;
      this._campaignClearNotified = true;
      const payload = {
        mapIndex: this.mapIndex,
        isCustomMapRun: !!this.isCustomMapRun,
        stars: this.evaluateCampaignStars(),
        maxWave: Math.max(0, Math.floor(this.currentWave || 0)),
        questState: this.getRunQuestSnapshot()
      };
      this.emitGameEvent(GAME_EVENTS.CAMPAIGN_CLEARED, payload);
      if (typeof this.onCampaignClear !== "function") return;
      this.onCampaignClear(payload);
    }

    getCurrentMapDef(){
      return {
        name: String(this.map?.name || "Custom Map"),
        gridW: Math.max(1, Math.floor(this.map?.w || 20)),
        gridH: Math.max(1, Math.floor(this.map?.h || 15)),
        entrance: {
          x: Math.floor(clampNumber(this.map?.entrance?.x, 0, 0)),
          y: Math.floor(clampNumber(this.map?.entrance?.y, 0, 0))
        },
        exit: {
          x: Math.floor(clampNumber(this.map?.exit?.x, 0, 0)),
          y: Math.floor(clampNumber(this.map?.exit?.y, 0, 0))
        },
        grid: Array.isArray(this.map?.grid)
          ? this.map.grid.map(row => Array.isArray(row) ? row.map(v => normalizeGridCell(v)) : [])
          : [],
        hazards: []
      };
    }

    serializeTower(tower){
      if (!tower?.def?.id) return null;
      return {
        id: tower.def.id,
        gx: Math.floor(clampNumber(tower.gx, 0, 0)),
        gy: Math.floor(clampNumber(tower.gy, 0, 0)),
        level: Math.floor(clampNumber(tower.level, 1, 1)),
        spentGold: Math.floor(clampNumber(tower.spentGold, 0, tower.def.cost || 0)),
        cooldown: clampNumber(tower.cooldown, 0, 0),
        damageDealt: clampNumber(tower.damageDealt, 0, 0),
        kills: Math.floor(clampNumber(tower.kills, 0, 0)),
        AD: [
          Math.floor(clampNumber(tower.AD?.[0], 1, tower.def.base?.AD?.[0] ?? 1)),
          Math.floor(clampNumber(tower.AD?.[1], 1, tower.def.base?.AD?.[1] ?? 1))
        ],
        baseAS: clampNumber(tower.baseAS, 0.05, tower.def.base?.AS ?? 1),
        baseRange: clampNumber(tower.baseRange, 1, tower.def.base?.Range ?? 1),
        critChance: clamp(clampNumber(tower.critChance, 0, tower.def.base?.CrC ?? 0), 0, 1),
        critDmg: clampNumber(tower.critDmg, 1, tower.def.base?.CrD ?? 1.5),
        magicBonus: clampNumber(tower.magicBonus, 0, tower.def.base?.MD ?? 0),
        manaRegen: clampNumber(tower.manaRegen, 0, tower.def.base?.MaR ?? 0),
        manaOnHit: clampNumber(tower.manaOnHit, 0, tower.def.base?.manaOnHit ?? 0),
        armorPenPct: clamp(clampNumber(tower.armorPenPct, 0, tower.def.base?.ArP ?? 0), 0, 2),
        magicPenFlat: clampNumber(tower.magicPenFlat, 0, tower.def.base?.MaP ?? 0),
        maxMana: clampNumber(tower.maxMana, 0, tower.def.skillManaCost ?? 0),
        mana: clampNumber(tower.mana, 0, 0),
        prestigeMaxMana: clampNumber(tower.prestigeMaxMana, 0, tower.def.prestige?.mana ?? 0),
        prestigeMana: clampNumber(tower.prestigeMana, 0, 0),
        prestigeActive: clampNumber(tower.prestigeActive, 0, 0),
        tempASMul: clampNumber(tower.tempASMul, 0.05, 1),
        forceChainAll: !!tower.forceChainAll,
        cleaveAll: !!tower.cleaveAll,
        targetMode: String(tower.targetMode || "first"),
        secondaryLevel: Math.floor(clampNumber(tower.secondaryLevel, 0, 0)),
        perks: {
          asMul: clampNumber(tower.perks?.asMul, 0.05, 1),
          adMul: clampNumber(tower.perks?.adMul, 0.05, 1),
          magMul: clampNumber(tower.perks?.magMul, 0.05, 1),
          dmgMul: clampNumber(tower.perks?.dmgMul, 0.05, 1)
        },
        facing: tower.facing === -1 ? -1 : 1,
        specialUpgrades: Array.isArray(tower.specialUpgrades)
          ? tower.specialUpgrades.map(upg => ({
              tier: Math.floor(clampNumber(upg?.tier, 1, 1)),
              title: String(upg?.title || ""),
              rarityId: String(upg?.rarityId || "common")
            }))
          : [],
        specialMagicActualMul: clampNumber(tower.specialMagicActualMul, 0.05, 1),
        specialMagicExpectedMul: clampNumber(tower.specialMagicExpectedMul, 0.05, 1)
      };
    }

    restoreTowerState(raw){
      if (!raw || typeof raw !== "object") return null;
      const def = TOWER_DEF_BY_ID.get(String(raw.id || ""));
      if (!def) return null;
      const gx = Math.floor(clampNumber(raw.gx, 0, 0));
      const gy = Math.floor(clampNumber(raw.gy, 0, 0));
      if (!this.canPlaceTowerAt(gx, gy, def)) return null;

      const tower = new Tower(def, gx, gy, this);
      tower.level = Math.floor(clampNumber(raw.level, 1, 1));
      tower.spentGold = Math.floor(clampNumber(raw.spentGold, 0, def.cost || 0));
      tower.cooldown = clampNumber(raw.cooldown, 0, 0);
      tower.damageDealt = clampNumber(raw.damageDealt, 0, 0);
      tower.kills = Math.floor(clampNumber(raw.kills, 0, 0));
      const adLow = Math.floor(clampNumber(raw.AD?.[0], 1, def.base.AD[0]));
      const adHigh = Math.floor(clampNumber(raw.AD?.[1], adLow, def.base.AD[1]));
      tower.AD = [adLow, Math.max(adLow, adHigh)];
      tower.baseAS = clampNumber(raw.baseAS, 0.05, def.base.AS);
      tower.baseRange = clampNumber(raw.baseRange, 1, def.base.Range);
      tower.critChance = clamp(clampNumber(raw.critChance, 0, def.base.CrC), 0, 1);
      tower.critDmg = clampNumber(raw.critDmg, 1, def.base.CrD);
      tower.magicBonus = clampNumber(raw.magicBonus, 0, def.base.MD);
      tower.manaRegen = clampNumber(raw.manaRegen, 0, def.base.MaR);
      tower.manaOnHit = clampNumber(raw.manaOnHit, 0, def.base.manaOnHit);
      tower.armorPenPct = clamp(clampNumber(raw.armorPenPct, 0, def.base.ArP), 0, 2);
      tower.magicPenFlat = clampNumber(raw.magicPenFlat, 0, def.base.MaP);
      tower.maxMana = clampNumber(raw.maxMana, 0, def.skillManaCost ?? 0);
      tower.mana = clamp(clampNumber(raw.mana, 0, 0), 0, tower.maxMana || 0);
      tower.prestigeMaxMana = clampNumber(raw.prestigeMaxMana, 0, def.prestige?.mana ?? 0);
      tower.prestigeMana = clamp(clampNumber(raw.prestigeMana, 0, 0), 0, tower.prestigeMaxMana || 0);
      tower.prestigeActive = clampNumber(raw.prestigeActive, 0, 0);
      tower.tempASMul = clampNumber(raw.tempASMul, 0.05, 1);
      tower.forceChainAll = !!raw.forceChainAll;
      tower.cleaveAll = !!raw.cleaveAll;
      tower.targetMode = String(raw.targetMode || "first");
      tower.lockedTarget = null;
      tower.secondaryLevel = Math.floor(clampNumber(raw.secondaryLevel, 0, 0));
      tower.perks = {
        asMul: clampNumber(raw.perks?.asMul, 0.05, 1),
        adMul: clampNumber(raw.perks?.adMul, 0.05, 1),
        magMul: clampNumber(raw.perks?.magMul, 0.05, 1),
        dmgMul: clampNumber(raw.perks?.dmgMul, 0.05, 1)
      };
      tower.peelBuffs = {};
      tower.facing = raw.facing === -1 ? -1 : 1;
      tower.specialUpgrades = Array.isArray(raw.specialUpgrades)
        ? raw.specialUpgrades.map(upg => ({
            tier: Math.floor(clampNumber(upg?.tier, 1, 1)),
            title: String(upg?.title || ""),
            rarityId: String(upg?.rarityId || "common")
          }))
        : [];
      tower.specialMagicActualMul = clampNumber(raw.specialMagicActualMul, 0.05, 1);
      tower.specialMagicExpectedMul = clampNumber(raw.specialMagicExpectedMul, 0.05, 1);
      return tower;
    }

    createRunStateSnapshot(resumeWave){
      this.updateMaxWaveSeen(Math.max(this.currentWave, resumeWave));
      this.runStats.totalKills = Math.max(this.runStats.totalKills, this.totalKills);
      return {
        mapIndex: clampCampaignMapIndex(this.mapIndex),
        gold: Math.floor(clampNumber(this.gold, 0, getStartingGold())),
        coreHP: clampNumber(this.coreHP, 0, START_CORE_HP),
        totalKills: Math.floor(clampNumber(this.totalKills, 0, 0)),
        resumeWave,
        started: !!this.started && resumeWave > 0,
        endlessMode: !!this.endlessMode,
        isCustomMapRun: !!this.isCustomMapRun,
        customMapDef: this.isCustomMapRun ? normalizeMapDef(this.getCurrentMapDef()) : null,
        towers: this.towers.map(t => this.serializeTower(t)).filter(Boolean),
        stats: this.getStatsSnapshot(),
        questState: this.getRunQuestSnapshot()
      };
    }

    createRunSaveData(){
      const activeWave = this.isWaveActive();
      const resumeWave = (!this.started)
        ? 0
        : Math.max(1, activeWave ? this.currentWave : this.nextWaveNum);
      const useCheckpoint = activeWave
        && this.waveStartCheckpoint
        && this.waveStartCheckpoint.resumeWave === resumeWave;
      const state = useCheckpoint
        ? this.waveStartCheckpoint
        : this.createRunStateSnapshot(resumeWave);
      return {
        schema: RUN_SAVE_SCHEMA,
        gameVersion: GAME_VERSION,
        savedAt: Date.now(),
        meta: createRunSaveMeta({ source: "runtime" }),
        ...state
      };
    }

    loadRunSave(saveData){
      const normalizedSave = normalizeRunSaveData(saveData);
      if (!normalizedSave) return false;
      this._lastLoadMigrationFromSchema = normalizedSave.meta?.migratedFromSchema;

      this.restart();

      const safeMap = clampCampaignMapIndex(normalizedSave.mapIndex);
      const saveCustomMap = normalizeMapDef(normalizedSave.customMapDef);
      this.mapIndex = safeMap;
      if (saveCustomMap) {
        this.map = new GameMap(saveCustomMap);
        this.isCustomMapRun = true;
      } else {
        this.map = new GameMap(getCampaignMapDef(this.mapIndex));
        this.isCustomMapRun = false;
      }
      this.useMapBackground = !this.isCustomMapRun;
      this.refreshMapBackground();

      this.gold = Math.floor(clampNumber(normalizedSave.gold, 0, getStartingGold()));
      this.coreHP = clampNumber(normalizedSave.coreHP, 0, START_CORE_HP);
      this.totalKills = Math.floor(clampNumber(normalizedSave.totalKills, 0, 0));
      this.runStats = normalizeRunStats(normalizedSave.stats);
      this.runStats.totalKills = Math.max(this.runStats.totalKills, this.totalKills);
      this.runQuestState = normalizeRunQuestState(normalizedSave.questState);
      this._campaignClearNotified = false;

      const towersRaw = Array.isArray(normalizedSave.towers) ? normalizedSave.towers : [];
      this.towers = [];
      for (const tRaw of towersRaw) {
        const restored = this.restoreTowerState(tRaw);
        if (restored) this.towers.push(restored);
      }

      this.enemies = [];
      this.projectiles = [];
      this.effects = [];
      this.rings = [];
      this.floaters = [];
      this.centerQueue = [];
      this.deferredActions = [];
      this.selectedTowerDef = null;
      this.clearSelection();
      this.selectedEnemy = null;
      this.hoverGrid = null;
      this.peelUplinkCastsByWave = {};
      this.lastUplinkRewardWave = 0;
      this.waveEndUplinkNotice = null;
      this.waveStartCheckpoint = null;
      this.nextWaveNowGoldBuff = { mult: 1, timeLeft: 0, maxTime: 0 };
      this._prevWaveActive = false;
      this.seenModifierIds = new Set();
      this.closeModifierIntro();
      this.hideWinModal();
      this.gameOver = false;
      this.started = false;
      this.autoQueueTimer = 0;
      this.currentWave = 0;
      this.nextWaveNum = 1;
      this.wavesActive = [];

      this.endlessMode = !!normalizedSave.endlessMode;
      setEndlessScalingEnabled(this.endlessMode);
      this.campaignWinShown = false;
      this.runStartMs = performance.now();

      const resumeWave = Math.floor(clampNumber(normalizedSave.resumeWave, 0, 0));
      if (resumeWave > 0) {
        this.jumpToWaveForTest(resumeWave);
        this.centerQueue.push({ text: `Continue: Wave ${resumeWave}`, life: 1.8 });
        this.logEvent(`Continue loaded from wave ${resumeWave}.`);
      } else {
        this.logEvent("Save loaded.");
        this.refreshUI(true);
      }
      if (Number.isFinite(this._lastLoadMigrationFromSchema) && this._lastLoadMigrationFromSchema > 0) {
        this.logEvent(`Save migrated: v${this._lastLoadMigrationFromSchema} -> v${RUN_SAVE_SCHEMA}.`);
      }
      this.updateMaxWaveSeen(Math.max(resumeWave, this.currentWave));
      return true;
    }

    startFreshRun(options = {}){
      const safeMap = clampCampaignMapIndex(options?.mapIndex);
      this.mapIndex = safeMap;
      const customMapDef = normalizeMapDef(options?.customMapDef);
      if (customMapDef) {
        this.map = new GameMap(customMapDef);
        this.isCustomMapRun = true;
      } else {
        this.map = new GameMap(getCampaignMapDef(this.mapIndex));
        this.isCustomMapRun = false;
      }
      this.useMapBackground = !this.isCustomMapRun;
      this.refreshMapBackground();
      this.restart();
      this.resetRunStats();
      this.resetRunQuestState();
      this.logEvent("New run started.");
      this.refreshUI(true);
    }

    showWinModal(){
      if (this.winModalOpen) return;
      this.winModalOpen = true;
      this.runClearSec = Math.max(0, Math.round((performance.now() - this.runStartMs) / 1000));
      const mm = Math.floor(this.runClearSec / 60);
      const ss = this.runClearSec % 60;
      if (this.winTime) this.winTime.textContent = `${mm}:${String(ss).padStart(2,"0")}`;
      if (this.winBack) this.winBack.style.display = "flex";
      this.prevSpeedBeforeModal = this.gameSpeed;
      this.gameSpeed = 0;
      this.syncSpeedUI(0);
    }

    hideWinModal(){
      if (!this.winModalOpen) return;
      this.winModalOpen = false;
      if (this.winBack) this.winBack.style.display = "none";
      const restore = Math.max(0.1, this.prevSpeedBeforeModal || 1.0);
      this.gameSpeed = restore;
      this.syncSpeedUI(this.gameSpeed);
    }

    endRunAfterWin(){
      this.hideWinModal();
      this.logEvent("Run ended after campaign clear.");
      this.setGameOver();
      this.refreshUI(true);
    }

    enterEndlessMode(){
      this.endlessMode = true;
      setEndlessScalingEnabled(true);
      this.hideWinModal();
      const msg = "You finished the main content. From this point, balance may be unfair. Good luck.";
      this.centerQueue.push({ text: "ENDLESS MODE", life: 2.2 });
      this.logEvent(msg);
      this.refreshUI(true);
    }

    maybeShowModifierIntro(enemy){
      if (!enemy || this.modifierIntroOpen || isModalOpen()) return;
      const modifier = listEnemyModifiers(enemy)[0] || null;
      if (!modifier) return;
      const key = String(modifier.id || modifier.name || "");
      if (!key || this.seenModifierIds.has(key)) return;
      this.seenModifierIds.add(key);
      this.showModifierIntro(modifier);
    }

    changeMap(){
      const mapCount = getCampaignMapCount();
      this.mapIndex = (this.mapIndex + 1) % mapCount;
      this.map = new GameMap(getCampaignMapDef(this.mapIndex));
      this.isCustomMapRun = false;
      this.useMapBackground = true;
      this.refreshMapBackground();

      this.enemies=[];
      this.projectiles=[];
      this.effects=[];
      this.rings=[];
      this.floaters=[];
      this.centerQueue=[];
      this.deferredActions=[];
      this.screenShakeTime = 0;
      this.screenShakeMaxTime = 0;
      this.screenShakePower = 0;
      this.wavesActive=[];
      this.currentWave=0;
      this.nextWaveNum=1;
      this.started=false;
      this._startLogged = false;
      this.autoQueueTimer=0;
      this.clearSelection();
      this.peelUplinkCastsByWave = {};
      this.lastUplinkRewardWave = 0;
      this.waveEndUplinkNotice = null;
      this.waveStartCheckpoint = null;
      this._prevWaveActive = false;
      this.endlessMode = false;
      this.campaignWinShown = false;
      this.hideWinModal();
      this.runStartMs = performance.now();
      this.gameSpeed = 1.0;
      this.syncSpeedUI(this.gameSpeed);
      setEndlessScalingEnabled(false);
      this.resetRunStats();
      this.resetRunQuestState();
      this.seenModifierIds = new Set();
      this.closeModifierIntro();
      this.refreshUI(true);
    }

    resizeCanvasToDisplaySize(){
      const rect=this.cv.getBoundingClientRect();
      const dpr=window.devicePixelRatio || 1;
      const newW=Math.max(2, Math.floor(rect.width * dpr));
      const newH=Math.max(2, Math.floor(rect.height * dpr));
      if(this.cv.width !== newW || this.cv.height !== newH){
        this.cv.width=newW;
        this.cv.height=newH;
      }
      this.ctx.imageSmoothingEnabled = true;
      this.ctx.imageSmoothingQuality = "high";
      this.tileSize=Math.floor(Math.min(this.cv.width/this.map.w, this.cv.height/this.map.h));
      this.offsetX = Math.floor((this.cv.width - this.tileSize*this.map.w)/2);
		this.offsetY = Math.floor((this.cv.height - this.tileSize*this.map.h)/2);

		// 300px saÄŸa kaydÄ±r (CSS px -> canvas px)

    }

    isWaveActive(){
      const anyWave = this.wavesActive.some(w => !w.finished);
      const anyEnemy = this.enemies.some(e => !e.dead && !e.reachedExit);
      return anyWave || anyEnemy;
    }

    queueWave(waveNum){
      const w = new WaveState(waveNum);
      if (this.endlessMode && waveNum > 100) {
        const gradualMul = 1 + Math.min(0.35, Math.max(0, waveNum - 105) * 0.005);
        const nonBoss = w.plan
          .filter(p => p.type !== "boss")
          .map(p => ({ ...p, count: Math.max(1, Math.round(p.count * gradualMul)) }));
        nonBoss.push({ type: "boss", count: 1 });
        w.plan = nonBoss;
        w.cursor = 0;
        w.remainingInPart = w.plan.length ? w.plan[0].count : 0;
        const waveCap = getWaveEnemyCap(waveNum);
        const total = w.plan.reduce((sum, p) => sum + p.count, 0);
        if (total > waveCap) {
          const over = Math.min(1, (total - waveCap) / Math.max(1, waveCap));
          w.spawnInterval *= (1 - 0.35 * over);
        }
      }
      this.wavesActive.push(w);
      this.currentWave = Math.max(this.currentWave, waveNum);
      this.nextWaveNum = Math.max(this.nextWaveNum, waveNum+1);
      this.updateMaxWaveSeen(this.currentWave);
      this.waveStartCheckpoint = this.createRunStateSnapshot(Math.max(1, waveNum));
      if (!this.peelUplinkCastsByWave[waveNum]) this.peelUplinkCastsByWave[waveNum] = 0;
      SFX.wave(waveNum);
      if (Math.random() < 0.35) {
        const line = LOG_TIPS[Math.floor(Math.random() * LOG_TIPS.length)];
        this.logEvent(line);
      }
      this.emitGameEvent(GAME_EVENTS.WAVE_STARTED, {
        waveNum,
        nextWaveNum: this.nextWaveNum,
        endlessMode: !!this.endlessMode
      });

      this.refreshUI(true);
    }

    start(){
      if(this.gameOver) return;
      if(this.started) return;
      this.started=true;
      this.runStartMs = performance.now();
      if (!this._startLogged) {
        this._startLogged = true;
        this.logEvent("Signal online: towers are operational.");
      }
      this.queueWave(this.nextWaveNum);
      this.emitGameEvent(GAME_EVENTS.RUN_STARTED, {
        mapIndex: this.mapIndex,
        isCustomMapRun: !!this.isCustomMapRun
      });
    }

    nextWaveNow(){
      if(this.gameOver) return;
      if(this.winModalOpen) return;
      if(!this.started){ this.start(); return; }
      const alive = this.enemies.filter(e => !e.dead && !e.reachedExit).length;
      const step = Math.max(1, Math.ceil(Math.max(1, alive) / 10));
      const buff = {
        mult: 1.1 + (step - 1) * 0.1,
        duration: (alive <= 10) ? 5.0 : 10.0
      };
      this.nextWaveNowGoldBuff.mult = Math.max(this.nextWaveNowGoldBuff.mult, buff.mult);
      this.nextWaveNowGoldBuff.timeLeft = Math.max(this.nextWaveNowGoldBuff.timeLeft, buff.duration);
      this.nextWaveNowGoldBuff.maxTime = Math.max(this.nextWaveNowGoldBuff.maxTime, this.nextWaveNowGoldBuff.timeLeft);
      this.logEvent(`Next Wave Now: ${buff.mult.toFixed(1)}x gold for ${buff.duration.toFixed(0)}s (alive mobs: ${alive})`);
      this.queueWave(this.nextWaveNum);
    }

    jumpToWaveForTest(waveNum){
      if (this.gameOver) return;
      const w = Math.max(1, Math.floor(waveNum || 1));
      this.enemies = [];
      this.projectiles = [];
      this.effects = [];
      this.rings = [];
      this.floaters = [];
      this.wavesActive = [];
      this.currentWave = Math.max(0, w - 1);
      this.nextWaveNum = w;
      this.started = true;
      this.autoQueueTimer = 0;
      this.queueWave(w);
    }

    autoQueueIfNeeded(dt){
      if(!this.started || this.gameOver) return;
      if(this.isWaveActive()){
        this.autoQueueTimer=0;
        return;
      }
      if (!this.endlessMode && !this.campaignWinShown && this.currentWave >= 100) {
        this.campaignWinShown = true;
        this.runQuestState.campaignCleared = true;
        this.runQuestState.clearedAtWave = Math.max(this.runQuestState.clearedAtWave, this.currentWave);
        this.notifyCampaignClearOnce();
        this.showWinModal();
        return;
      }
      this.autoQueueTimer += dt;
      if(this.autoQueueTimer >= this.autoQueueDelay){
        this.autoQueueTimer=0;
        this.queueWave(this.nextWaveNum);
      }
    }

    recordPeelUplinkCast(){
      const waveNum = Math.max(1, this.currentWave || 1);
      this.peelUplinkCastsByWave[waveNum] = (this.peelUplinkCastsByWave[waveNum] || 0) + 1;
    }

    getPeelUplinkCasts(waveNum){
      const n = waveNum ?? this.currentWave;
      return this.peelUplinkCastsByWave[n] || 0;
    }

    resolvePeelUplinkWaveEnd(){
      const waveNum = this.currentWave;
      if (!waveNum || waveNum <= this.lastUplinkRewardWave) return;
      const casts = this.getPeelUplinkCasts(waveNum);
      this.lastUplinkRewardWave = waveNum;
      delete this.peelUplinkCastsByWave[waveNum];
      if (casts <= 0) return;

      const peel = this.towers.find(t => t.def?.id === "peel");
      const peelMagic = peel
        ? Math.round((peel.magicBonus || 0) * (peel.perks?.magMul ?? 1) * (peel.peelMul?.("mag") ?? 1))
        : 0;
      const coreMul = 1 + Math.min(0.60, peelMagic / 2500); // up to +60%
      const goldMul = 1 + Math.min(0.80, peelMagic / 1800); // up to +80%

      const coreGain = Math.max(1, Math.round(casts * coreMul));
      const goldPerCast = Math.max(12, Math.round(8 + waveNum * 2.2));
      const goldGain = Math.max(1, Math.round(casts * goldPerCast * goldMul));
      this.coreHP += coreGain;
      this.gold += goldGain;
      this.waveEndUplinkNotice = {
        life: 3.6,
        maxLife: 3.6,
        waveNum,
        casts,
        coreGain,
        goldGain
      };
      this.logEvent(`Core Uplink payout: Wave ${waveNum} | casts ${casts} | Magic ${peelMagic} | +${coreGain} Core | +${goldGain} Gold`);
    }

    findNearestPathIndex(x,y){
      const path = this.map.path || [];
      let bestIdx = 0;
      let bestD2 = Infinity;
      for (let i=0; i<path.length; i++) {
        const p = path[i];
        const d2 = dist2(x, y, p.x+0.5, p.y+0.5);
        if (d2 < bestD2) { bestD2 = d2; bestIdx = i; }
      }
      return bestIdx;
    }

    spawnEnemy(typeId, waveNum, opts={}){
      const enemy = new Enemy(this.map, typeId, waveNum, this, opts.customBossStats ?? null, opts.waveMods ?? null);
      if (opts.pos) {
        enemy.x = opts.pos.x;
        enemy.y = opts.pos.y;
        enemy.pathIndex = this.findNearestPathIndex(enemy.x, enemy.y);
      }
      this.enemies.push(enemy);
      return enemy;
    }

    spawnBossAdds(boss, count){
      if (!boss || count <= 0) return;
      const tankRatio = clamp(0.25 + (boss.wave - 30) * 0.004, 0.25, 0.55);
      const tankCount = Math.round(count * tankRatio);
      const runnerCount = Math.max(0, count - tankCount);
      const basePos = { x: boss.x, y: boss.y };
      const mods = { ...waveModifiers(boss.wave), noAffix: true };

      const spawnAt = (typeId) => {
        const jx = (Math.random()-0.5) * 0.45;
        const jy = (Math.random()-0.5) * 0.45;
        this.spawnEnemy(typeId, boss.wave, { pos: { x: basePos.x + jx, y: basePos.y + jy }, waveMods: mods });
      };

      for (let i=0; i<runnerCount; i++) spawnAt("runner");
      for (let i=0; i<tankCount; i++) spawnAt("tank");
    }

    spawnVolatileMinions(enemy, count){
      if (!enemy || count <= 0) return;
      const mods = { ...waveModifiers(enemy.wave), noAffix: true };
      for (let i=0; i<count; i++) {
        const jx = (Math.random()-0.5) * 0.35;
        const jy = (Math.random()-0.5) * 0.35;
        this.spawnEnemy("runner", enemy.wave, { pos: { x: enemy.x + jx, y: enemy.y + jy }, waveMods: mods });
      }
    }

    rebuildTowerSpatialIndex(){
      this.towerSpatial.rebuild(this.towers, t => !!t);
    }

    rebuildEnemySpatialIndex(){
      this.enemySpatial.rebuild(this.enemies, e => !!e && !e.dead && !e.reachedExit);
    }

    getEnemiesInRange(x, y, radius, out = null){
      const buf = out || this._enemyRangeScratch;
      if (!this.enemySpatial) {
        buf.length = 0;
        const r2 = radius * radius;
        for (const e of this.enemies) {
          if (!e || e.dead || e.reachedExit) continue;
          if (dist2(x, y, e.x, e.y) <= r2) buf.push(e);
        }
        return buf;
      }
      return this.enemySpatial.queryCircle(x, y, radius, buf);
    }

    getTowersInRange(x, y, radius, out = null){
      const buf = out || this._towerRangeScratch;
      if (!this.towerSpatial) {
        buf.length = 0;
        const r2 = radius * radius;
        for (const t of this.towers) {
          if (!t) continue;
          if (dist2(x, y, t.x, t.y) <= r2) buf.push(t);
        }
        return buf;
      }
      return this.towerSpatial.queryCircle(x, y, radius, buf);
    }

    getBossNextSkill(enemy){
      if (!enemy?.bossSkills) return null;
      const debuffed = (enemy.poisonStacks > 0) || (enemy.slowPct > 0.2) || (enemy.frostbiteTime > 0) || (enemy.frostbiteDotTime > 0);
      const eligible = {
        cleanse: debuffed,
        heal: enemy.hp < enemy.maxHP,
        summon: true
      };
      const skills = Object.values(enemy.bossSkills).filter(s => s.active);
      if (!skills.length) return null;
      let best = null;
      for (const s of skills) {
        if (!eligible[s.id]) continue;
        if (!best || s.timer < best.timer) best = s;
      }
      if (best) return best;
      return skills.reduce((min, s) => (s.timer < min.timer ? s : min), skills[0]);
    }

    eventToCanvasXY(ev){
      const rect=this.cv.getBoundingClientRect();
      const sx=this.cv.width/rect.width;
      const sy=this.cv.height/rect.height;
      return { x:(ev.clientX-rect.left)*sx, y:(ev.clientY-rect.top)*sy };
    }
    screenToGrid(mx,my){
      const x=Math.floor((mx - this.offsetX)/this.tileSize);
      const y=Math.floor((my - this.offsetY)/this.tileSize);
      if(x<0||y<0||x>=this.map.w||y>=this.map.h) return null;
      return {x,y};
    }
    canPlaceTowerAt(gx, gy, def){
      if(!def) return false;
      if(def.id === "peel" && this.towers.some(t => t.def.id === "peel")) return false;
      const size = def.size ?? 1;
      for (let dy=0; dy<size; dy++) {
        for (let dx=0; dx<size; dx++) {
          const tx = gx + dx;
          const ty = gy + dy;
          if (!this.map.inBounds(tx, ty) || !this.map.isBuildable(tx, ty)) return false;
          if (this.towerAtGrid(tx, ty)) return false;
        }
      }
      return true;
    }
    towerOccupies(t, gx, gy){
      const size = t.size ?? 1;
      return gx >= t.gx && gx < t.gx + size && gy >= t.gy && gy < t.gy + size;
    }
    towerAtGrid(gx,gy){
      return this.towers.find(t => this.towerOccupies(t, gx, gy)) || null;
    }
    enemyAtCanvas(mx,my){
      const r=this.tileSize*0.30;
      const r2=r*r;
      for(let i=this.enemies.length-1;i>=0;i--){
        const e=this.enemies[i];
        if(e.dead || e.reachedExit) continue;
        const ex=this.offsetX + e.x*this.tileSize;
        const ey=this.offsetY + e.y*this.tileSize;
        const dx=mx-ex, dy=my-ey;
        if(dx*dx+dy*dy <= r2) return e;
      }
      return null;
    }
    getTowerTargetUiRects(t){
      if (!t || t !== this.selectedTowerInstance) return null;
      const sizeTiles = t.size ?? 1;
      const sizePx = this.tileSize * sizeTiles;
      const towerPx = this.offsetX + t.gx*this.tileSize;
      const towerPy = this.offsetY + t.gy*this.tileSize;
      const panelH = Math.max(24, Math.round(this.tileSize * 0.50));
      const btnW = Math.max(24, Math.round(this.tileSize * 0.50));
      const btnH = panelH;
      const centerW = Math.max(84, Math.round(sizePx * 1.6));
      const gap = 6;
      const totalW = btnW + gap + centerW + gap + btnW;
      const rawStartX = (towerPx + sizePx/2) - totalW/2;
      const startX = clamp(rawStartX, 4, Math.max(4, this.cv.width - totalW - 4));
      const baseY = clamp(towerPy + sizePx + 8, 4, Math.max(4, this.cv.height - panelH - 4));
      return {
        left: { x: startX, y: baseY, w: btnW, h: btnH },
        center: { x: startX + btnW + gap, y: baseY, w: centerW, h: btnH },
        right: { x: startX + btnW + gap + centerW + gap, y: baseY, w: btnW, h: btnH }
      };
    }
    pointInRect(mx, my, r){
      return !!r && mx >= r.x && mx <= (r.x + r.w) && my >= r.y && my <= (r.y + r.h);
    }
    drawSelectedTargetPanel(ctx){
      const t = this.selectedTowerInstance;
      if (!t) return;
      const rects = this.getTowerTargetUiRects(t);
      if (!rects) return;
      const drawBtn = (r, text, active=false) => {
        const grd = ctx.createLinearGradient(r.x, r.y, r.x, r.y + r.h);
        if (active) {
          grd.addColorStop(0, "rgba(30,58,138,0.90)");
          grd.addColorStop(1, "rgba(14,116,144,0.92)");
        } else {
          grd.addColorStop(0, "rgba(15,23,42,0.92)");
          grd.addColorStop(1, "rgba(30,41,59,0.94)");
        }
        ctx.fillStyle = grd;
        ctx.strokeStyle = active ? "rgba(125,211,252,0.95)" : "rgba(148,163,184,0.90)";
        ctx.lineWidth = 2;
        ctx.fillRect(r.x, r.y, r.w, r.h);
        ctx.strokeRect(r.x+1, r.y+1, r.w-2, r.h-2);
        ctx.fillStyle = "rgba(241,245,249,0.98)";
        ctx.font = active
          ? `700 ${Math.max(12, Math.floor(r.h*0.50))}px system-ui`
          : `700 ${Math.max(14, Math.floor(r.h*0.62))}px system-ui`;
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(text, r.x + r.w/2, r.y + r.h/2 + 0.5);
      };
      drawBtn(rects.left, "<");
      drawBtn(rects.center, t.getTargetModeLabel(), true);
      drawBtn(rects.right, ">");
    }

    bindInput(){
      this.cv.addEventListener("mousemove",(ev)=>{
        if(!this.selectedTowerDef){ this.hoverGrid=null; return; }
        const {x:mx,y:my}=this.eventToCanvasXY(ev);
        this.hoverGrid = this.screenToGrid(mx,my);
      });
      this.cv.addEventListener("mouseleave",()=>{
        this.hoverGrid = null;
      });
      this.cv.addEventListener("contextmenu",(ev)=>{
        ev.preventDefault();
        this.clearPlacement();
        this.clearSelection();
        this.selectedEnemy = null;
        this.selectedTowerInstance = null;
        this.refreshUI(true);
      });
      this.cv.addEventListener("click",(ev)=>{
        if(this.gameOver) return;
        if (isModalOpen()) return;

        const {x:mx,y:my}=this.eventToCanvasXY(ev);
        const targetUi = this.getTowerTargetUiRects(this.selectedTowerInstance);
        if (targetUi) {
          if (this.pointInRect(mx, my, targetUi.left)) {
            this.selectedTowerInstance.cycleTargetMode(-1);
            this.refreshUI(true);
            return;
          }
          if (this.pointInRect(mx, my, targetUi.right)) {
            this.selectedTowerInstance.cycleTargetMode(1);
            this.refreshUI(true);
            return;
          }
        }

        const g=this.screenToGrid(mx,my);
        if(!g) return;

        const clickedEnemy=this.enemyAtCanvas(mx,my);
        if(clickedEnemy){
          this.selectedEnemy=clickedEnemy;
          this.selectedTowerInstance=null;
          this.clearPlacement();
          this.refreshUI(true);
          return;
        }

        const clickedTower=this.towerAtGrid(g.x,g.y);
        if(clickedTower){
          this.selectedTowerInstance=clickedTower;
          this.selectedEnemy=null;
          this.clearPlacement();
          this.refreshUI(true);
          return;
        }

        this.clearSelection();

        if(!this.selectedTowerDef){ this.refreshUI(true); return; }
        if (!this.canPlaceTowerAt(g.x, g.y, this.selectedTowerDef)) {
          if (this.selectedTowerDef.id === "peel" && this.towers.some(t => t.def.id === "peel")) {
          this.logEvent("Peel Tower limit: 1");
          }
          this.refreshUI(true);
          return;
        }

        const cost=this.selectedTowerDef.cost;
        if(this.gold < cost){ this.refreshUI(true); return; }

        this.gold -= cost;
        this.towers.push(new Tower(this.selectedTowerDef, g.x, g.y, this));
        this.recordTowerBuilt(this.selectedTowerDef.id);
        if (this.selectedTowerDef.id === "sniper") this.runQuestState.sniperPurchased = true;
        SFX.place();
        this.refreshUI(true);
      });
    }

    sellSelectedTower(){
      const t=this.selectedTowerInstance;
      if(!t) return;
      const refund=Math.round(t.spentGold*0.50);
      this.gold += refund;
      this.towers = this.towers.filter(x=>x!==t);
      this.selectedTowerInstance=null;
      SFX.sell();
      this.refreshUI(true);
    }

    openMilestoneModal(tower){
      const tier = milestoneTier(tower.level);
      if (!tier) return;
      this.uiHover.upgrade = false;
      this.uiHover.fast = false;

      const choices = buildChoicesForTower(tower, tier);

      openModal(
        `${tower.def.name} - Lv ${tower.level} Special Upgrade <span class="tierBadge">Tier ${tier}</span>`,
        `Choose 1 option.`,
        choices,
        (choice) => {
          this.hoverSpecialChoice = null;
          choice.apply(tower);
          this.emitGameEvent(GAME_EVENTS.TOWER_SPECIAL_UPGRADE_CHOSEN, {
            towerId: tower.def?.id || null,
            towerLevel: tower.level,
            tier,
            rarityId: String(choice?.rarityId || "common"),
            title: String(choice?.title || "")
          });
          closeModal();
          this.gameSpeed = this.prevSpeedBeforeModal;
          this.syncSpeedUI(this.gameSpeed);
          this.refreshUI(true);
        },
        (choice) => {
          this.hoverSpecialChoice = choice || null;
          this.refreshUI(true);
        }
      );

      this.prevSpeedBeforeModal = this.gameSpeed;
      this.gameSpeed = 0;
      this.syncSpeedUI(0);
    }

    setGameOver(){
      if(this.gameOver) return;
      this.hideWinModal();
      this.gameOver=true;
      this.showGameOverModal();
      SFX.gameOver();
      this.logEvent("GAME OVER. Core has fallen.");
      this.emitGameEvent(GAME_EVENTS.GAME_OVER, {
        waveNum: Math.max(0, this.currentWave || 0),
        totalKills: Math.max(0, this.totalKills || 0)
      });
      this.saveHighKills();
    }

    showGameOverModal(){
      if (this.gameOverBack) this.gameOverBack.style.display = "flex";
    }

    hideGameOverModal(){
      if (this.gameOverBack) this.gameOverBack.style.display = "none";
    }

    restart(){
      this.gold=getStartingGold();
      this.coreHP=START_CORE_HP;
      this.totalKills=0;

      this.currentWave=0;
      this.nextWaveNum=1;
      this.wavesActive=[];

      this.started=false;
      this._startLogged = false;
      this.autoQueueTimer=0;

      this.towers=[];
      this.enemies=[];
      this.projectiles=[];
      this.effects=[];
      this.rings=[];
      this.floaters=[];
      this.centerQueue=[];
      this.deferredActions=[];
      this.screenShakeTime = 0;
      this.screenShakeMaxTime = 0;
      this.screenShakePower = 0;

      this.selectedTowerDef=null;
      this.clearSelection();
      this.peelUplinkCastsByWave = {};
      this.lastUplinkRewardWave = 0;
      this.waveEndUplinkNotice = null;
      this.waveStartCheckpoint = null;
      this._prevWaveActive = false;
      this.endlessMode = false;
      this.campaignWinShown = false;
      this.hideWinModal();
      this.hideGameOverModal();
      this.runStartMs = performance.now();
      this.gameSpeed = 1.0;
      this.syncSpeedUI(this.gameSpeed);
      setEndlessScalingEnabled(false);
      this.resetRunStats();
      this.seenModifierIds = new Set();
      this.closeModifierIntro();

      this.gameOver=false;
      this.emitGameEvent(GAME_EVENTS.RUN_RESTARTED, {
        mapIndex: this.mapIndex,
        isCustomMapRun: !!this.isCustomMapRun
      });
      this.refreshUI(true);
    }

    update(dt){
      this._statsFlushTimer += Math.max(0, Number(dt) || 0);
      if (this._statsDirty && this._statsFlushTimer >= this._statsFlushInterval) {
        this.persistLifetimeStats(true);
      }

      if(this.gameOver) return;

      if (this.screenShakeTime > 0) {
        this.screenShakeTime = Math.max(0, this.screenShakeTime - dt);
        if (this.screenShakeTime <= 0) {
          this.screenShakePower = 0;
          this.screenShakeMaxTime = 0;
        }
      }

      const sdt = dt * this.gameSpeed;
      if(sdt <= 0) return;

      this.autoQueueIfNeeded(sdt);

      // Waves spawn
      for(const w of this.wavesActive){
        if(w.finished) continue;

        w.spawnTimer -= sdt;
        if(w.spawnTimer <= 0){
          while(!w.finished && w.remainingInPart <= 0){
            w.nextPart();
          }
          if(w.finished) continue;

          const part = w.plan[w.cursor];
          const typeId = part.type;

          const mods = waveModifiers(w.waveNum);
          let enemy = null;

          if(typeId === "boss"){
            const isBigBoss = (w.waveNum % 100 === 0);
            const bossGroupCount = Math.max(1, Math.floor(w.waveNum/10));
            const wealthMult = isBigBoss ? bossGroupCount : 1.0;

            const prev = Math.max(1, w.waveNum-1);
            const hpByPrevWave = Math.max(1, Math.round(computePrevWaveTotals(prev).totalHP));
            let hp = hpByPrevWave;
            if (w.waveNum === 100 && !isBigBoss) hp *= 10;
            const totals = computePrevWaveTotals(prev);
            const wealth = Math.max(50, Math.round(totals.totalWealth * wealthMult));

            const scaledBoss = scaleForWave({Armor:40,MR:18,HP:1,Speed:0.62,Wealth:1}, w.waveNum);
            const armor = Math.round(scaledBoss.Armor);
            const mr = Math.round(scaledBoss.MR);
            const speed = isBigBoss ? 0.48 : 0.62;

            const custom = { HP: hp, Speed: speed, Armor: armor, MR: mr, Wealth: wealth };
            enemy = this.spawnEnemy("boss", w.waveNum, { customBossStats: custom, waveMods: mods });
          } else {
            enemy = this.spawnEnemy(typeId, w.waveNum, { waveMods: mods });
          }
          if (enemy) this.maybeShowModifierIntro(enemy);

          w.remainingInPart -= 1;
          w.spawnedCount += 1;
          const burst = (w.burstEvery > 0) && (w.spawnedCount % w.burstEvery === 0);
          w.spawnTimer = w.spawnInterval * (burst ? CFG.SPAWN_BURST_INTERVAL_MUL : 1);
        }
      }

      this.rebuildTowerSpatialIndex();

      // Enemies move
      for(const e of this.enemies){
        const wasExit=e.reachedExit;
        e.update(sdt);
        if(!wasExit && e.reachedExit){
          const hitWave = Math.max(this.currentWave, Math.floor(Number(e.wave) || this.currentWave));
          const coreHitMul = hitWave > 105 ? 5 : 1;
          const dmg = (e.isBoss ? 5 : 1) * coreHitMul;
          this.coreHP -= dmg;
          if(this.coreHP<0) this.coreHP=0;
          this.runQuestState.coreDamaged = true;
          this.logEvent(`Core hit: -${dmg} HP (HP: ${this.coreHP})`);
        }
      }

      this.rebuildEnemySpatialIndex();

      // Prestige flags
      this.anyBreakerPrestigeActive = this.towers.some(t => t.def.id==="breaker" && t.prestigeActive > 0);
      this.anyBlizzardPrestigeActive = this.towers.some(t => t.def.id==="blizzard" && t.prestigeActive > 0);

      // Archer prestige aura: mapteki tÃ¼m archerlara AS x4
      const anyArcherPrestigeActive = this.towers.some(t => t.def.id==="archer" && t.prestigeActive > 0);
      for (const t of this.towers) {
        if (t.def.id === "archer") t.tempASMul = anyArcherPrestigeActive ? 4.0 : 1.0;
      }

      // Mage prestige aura: towers in range gain mana generation (scaled by Mage magic).
      let hasMageAura = false;
      for (const t of this.towers) {
        t._manaGainTempMul = 1;
        if (t.def.id === "mage" && t.prestigeActive > 0) hasMageAura = true;
      }
      if (hasMageAura) {
        for (const m of this.towers) {
          if (m.def.id !== "mage" || m.prestigeActive <= 0) continue;
          const magic = Math.max(0, (m.magicBonus || 0) * (m.perks?.magMul ?? 1) * (m.peelMul?.("mag") ?? 1));
          const auraMul = magePrestigeAuraMulFromMagic(magic);
          const auraRange = m.range + magePrestigeAuraRangeBonusFromMagic(magic);
          const inRange = this.getTowersInRange(m.x, m.y, auraRange, this._towerRangeScratch);
          for (const t of inRange) {
            if (t === m) continue;
            t._manaGainTempMul = Math.max(t._manaGainTempMul, auraMul);
          }
        }
      }

      // Blizzard prestige aura removed (Frostbite replaces it)

      // Towers update
      for(const t of this.towers){
        t.update(sdt, this);
      }

      // Projectiles + effects
      for(const p of this.projectiles) p.update(sdt, this);
      compactInPlace(this.projectiles, p => !p.dead, releaseAnyProjectile);

      if (this.deferredActions.length) {
        const pending = this.deferredActions;
        this.deferredActions = [];
        for (const act of pending) {
          act.t -= sdt;
          if (act.t <= 0) {
            try { act.fn(); } catch (_) {}
          } else {
            this.deferredActions.push(act);
          }
        }
      }

      for(const fx of this.effects) fx.update(sdt);
      compactInPlace(this.effects, fx => !fx.dead, releaseAnyEffect);

      for(const r of this.rings) r.update(sdt, this);
      compactInPlace(this.rings, r => !r.dead, releaseEffectRing);

      // Floaters
      for (const f of this.floaters) f.update(sdt);
      compactInPlace(this.floaters, f => !f.dead, releaseFloatingText);

      // Center queue (delay destekli)
      for (const c of this.centerQueue) {
        // Keep announcement visibility independent from game speed.
        if (!c._normalized) {
          c.life = Math.max(2.0, c.life ?? 0);
          c.delay = c.delay ?? 0;
          c.maxLife = Math.max(c.maxLife ?? 0, c.life);
          c._normalized = true;
        }
        c.delay = (c.delay ?? 0) - dt;
        if ((c.delay ?? 0) < 0) c.life -= dt;
      }
      compactInPlace(this.centerQueue, c => (c.life ?? 0) > 0);

      if (this.nextWaveNowGoldBuff.timeLeft > 0) {
        this.nextWaveNowGoldBuff.timeLeft = Math.max(0, this.nextWaveNowGoldBuff.timeLeft - sdt);
        if (this.nextWaveNowGoldBuff.timeLeft <= 0) {
          this.nextWaveNowGoldBuff.mult = 1;
          this.nextWaveNowGoldBuff.maxTime = 0;
        }
      }

      // Reward dead enemies
      let goldGained = 0;
      const goldMul = (this.nextWaveNowGoldBuff.timeLeft > 0) ? Math.max(1, this.nextWaveNowGoldBuff.mult || 1) : 1;
      for(const e of this.enemies){
        if(e.dead && !e._rewarded){
          e._rewarded=true;
          const gain = Math.max(0, Math.round(e.wealth * goldMul));
          this.gold += gain;
          goldGained += gain;
        }
      }
      if (goldGained > 0) SFX.gold(goldGained);

      compactInPlace(this.enemies, e => !(e.dead || e.reachedExit));
      compactInPlace(this.wavesActive, w => !w.finished);

      if (this.waveEndUplinkNotice) {
        this.waveEndUplinkNotice.life -= dt;
        if (this.waveEndUplinkNotice.life <= 0) this.waveEndUplinkNotice = null;
      }

      const waveActiveNow = this.isWaveActive();
      if (this._prevWaveActive && !waveActiveNow) {
        this.resolvePeelUplinkWaveEnd();
        this.emitGameEvent(GAME_EVENTS.WAVE_ENDED, {
          waveNum: Math.max(0, this.currentWave || 0),
          nextWaveNum: Math.max(1, this.nextWaveNum || 1),
          endlessMode: !!this.endlessMode
        });
      }
      this._prevWaveActive = waveActiveNow;

      if(this.selectedEnemy && (this.selectedEnemy.dead || this.selectedEnemy.reachedExit)){
        this.selectedEnemy=null;
      }

      this._uiDirty = true;

      if(this.coreHP<=0){
        this.coreHP=0;
        this.setGameOver();
      }

    }

    logEvent(text){
      if (!this.logEl) return;
      const atBottom = (this.logEl.scrollTop + this.logEl.clientHeight) >= (this.logEl.scrollHeight - 8);
      const line = document.createElement("div");
      line.className = "logLine";
      line.textContent = text;
      if (text === "Signal online: towers are operational.") {
        line.classList.add("logCheatToggle");
        line.title = "Toggle test panel";
        line.addEventListener("click", () => this.uiAdapter.toggleCheatPanel());
      }
      this.logEl.appendChild(line);

      while (this.logEl.children.length > this.logMax) {
        this.logEl.removeChild(this.logEl.firstChild);
      }

      if (atBottom) {
        this.logEl.scrollTop = this.logEl.scrollHeight;
      }
    }

    // =========================================================
    // DRAW
    // =========================================================
    drawTowerIcon(ctx, t, cx, cy, sizePx){
      ctx.save();
      ctx.translate(cx, cy);

      const tNow = performance.now() / 1000;
      const isGold = (t.level >= CFG.TOWER_MAX_LEVEL);
      const isPrestige = (t.level >= CFG.PRESTIGE_LEVEL);

      if (isPrestige) {
        const pulse = 0.55 + 0.45 * Math.sin(tNow * 5.0);
        ctx.shadowBlur = 26 + 30 * pulse;
        ctx.shadowColor = `rgba(56,189,248,${0.55 + 0.35 * pulse})`;
      } else if (isGold) {
        const pulse = 0.55 + 0.45 * Math.sin(tNow * 5.0);
        ctx.shadowBlur = 18 + 22 * pulse;
        ctx.shadowColor = `rgba(250,204,21,${0.45 + 0.35 * pulse})`;
      }

      const stroke = "rgba(15,23,42,0.90)";

      let archerCol = "rgba(251,146,60,0.95)";
      let mageCol   = "rgba(99,102,241,0.98)";
      let breakerCol= "rgba(239,68,68,0.95)";
      let blizCol   = "rgba(56,189,248,0.95)";
      let poisonCol = "rgba(34,197,94,0.96)";
      let sniperCol = "rgba(248,250,252,0.95)";

      if (t.level >= CFG.PRESTIGE_LEVEL){
        // prestige: mavi tonu
        archerCol = mageCol = breakerCol = blizCol = poisonCol = sniperCol = "rgba(140,210,255,0.98)";
      } else if(t.level >= CFG.TOWER_MAX_LEVEL){
        archerCol = mageCol = breakerCol = blizCol = poisonCol = sniperCol = "rgba(250,204,21,0.98)";
      }

      ctx.lineWidth = Math.max(2, Math.floor(sizePx*0.10));
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      const s = sizePx;

        const scaleMap = {
          archer: 0.85,
          mage: 0.75,
          breaker: 0.80,
          poison: 0.85,
          blizzard: 1.25,
          sniper: 1.10,
          peel: 0.65
        };
        const towerScale = scaleMap[t.def.id] ?? 1.0;
        const baseScale = 1.90 * towerScale;
        const maxW = sizePx * baseScale;
        const maxH = sizePx * baseScale;
        const baseY = (sizePx * 0.5) - 2;
        const drawSprite = (img, facing=1) => {
          const scale = Math.min(maxW / img.width, maxH / img.height);
          const drawW = img.width * scale;
          const drawH = img.height * scale;
          const drawX = -drawW / 2;
          const drawY = baseY - drawH;
          ctx.save();
          ctx.scale(facing, 1);
          const fx = (facing === -1) ? (-drawX - drawW) : drawX;
          ctx.drawImage(img, fx, drawY, drawW, drawH);
          ctx.restore();
        };

        if (t.def.id === "archer" && this.archerSpriteReady && this.archerSprite) {
          drawSprite(this.archerSprite, t.facing || 1);
          ctx.restore();
          return;
        }
        if (t.def.id === "mage" && this.mageSpriteReady && this.mageSprite) {
          drawSprite(this.mageSprite, 1);
          ctx.restore();
          return;
        }
        if (t.def.id === "breaker" && this.breakerSpriteReady && this.breakerSprite) {
          drawSprite(this.breakerSprite, t.facing || 1);
          ctx.restore();
          return;
        }
        if (t.def.id === "blizzard" && this.blizzardSpriteReady && this.blizzardSprite) {
          drawSprite(this.blizzardSprite, 1);
          ctx.restore();
          return;
        }
        if (t.def.id === "poison" && this.poisonSpriteReady && this.poisonSprite) {
          drawSprite(this.poisonSprite, 1);
          ctx.restore();
          return;
        }
        if (t.def.id === "sniper" && this.sniperSpriteReady && this.sniperSprite) {
          drawSprite(this.sniperSprite, t.facing || 1);
          ctx.restore();
          return;
        }
        if (t.def.id === "peel" && this.peelSpriteReady && this.peelSprite) {
          drawSprite(this.peelSprite, 1);
          ctx.restore();
          return;
        }

        if (t.def.id === "archer") {
          ctx.strokeStyle = archerCol;
          ctx.beginPath();
          ctx.arc(0, 0, s*0.35, -Math.PI/2, Math.PI/2);
          ctx.stroke();

        ctx.strokeStyle = "rgba(255,255,255,0.85)";
        ctx.lineWidth = Math.max(1.5, Math.floor(sizePx*0.06));
        ctx.beginPath();
        ctx.moveTo(0, -s*0.35);
        ctx.lineTo(s*0.22, 0);
        ctx.lineTo(0, s*0.35);
        ctx.stroke();

        ctx.strokeStyle = archerCol;
        ctx.lineWidth = Math.max(2, Math.floor(sizePx*0.08));
        ctx.beginPath();
        ctx.moveTo(-s*0.15, 0);
        ctx.lineTo(s*0.35, 0);
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(s*0.35, 0);
        ctx.lineTo(s*0.25, -s*0.08);
        ctx.lineTo(s*0.25,  s*0.08);
        ctx.closePath();
        ctx.fillStyle = archerCol;
        ctx.fill();
        } else if (t.def.id === "mage") {
          ctx.strokeStyle = mageCol;
          ctx.lineWidth = Math.max(2, Math.floor(sizePx*0.08));
          ctx.beginPath();
          ctx.moveTo(-s*0.25, s*0.25);
          ctx.lineTo(s*0.15, -s*0.25);
          ctx.stroke();

          ctx.fillStyle = "rgba(56,189,248,0.95)";
          ctx.strokeStyle = stroke;
          ctx.lineWidth = Math.max(1.5, Math.floor(sizePx*0.05));
          ctx.beginPath();
          ctx.arc(s*0.20, -s*0.30, s*0.10, 0, Math.PI*2);
          ctx.fill();
          ctx.stroke();
        } else if (t.def.id === "breaker") {
        ctx.fillStyle = breakerCol;
        ctx.strokeStyle = stroke;
        ctx.lineWidth = Math.max(1.5, Math.floor(sizePx*0.05));

        ctx.beginPath();
        addRoundRectPath(ctx, -s*0.20, -s*0.10, s*0.40, s*0.28, s*0.08);
        ctx.fill();
        ctx.stroke();

        ctx.fillStyle = "rgba(255,255,255,0.85)";
        ctx.beginPath();
        addRoundRectPath(ctx, s*0.05, -s*0.20, s*0.28, s*0.16, s*0.06);
        ctx.fill();
        ctx.stroke();
        } else if (t.def.id === "blizzard") {
          ctx.strokeStyle = blizCol;
          ctx.lineWidth = Math.max(2, Math.floor(sizePx*0.08));
          const len = s*0.33;
          const drawArm = (ang) => {
            ctx.save();
            ctx.rotate(ang);
            ctx.beginPath();
            ctx.moveTo(-len, 0);
            ctx.lineTo(len, 0);
            ctx.stroke();
            ctx.restore();
          };
          drawArm(0);
          drawArm(Math.PI/3);
          drawArm(-Math.PI/3);
        } else if (t.def.id === "poison") {
          ctx.fillStyle = poisonCol;
          ctx.strokeStyle = stroke;
          ctx.lineWidth = Math.max(1.5, Math.floor(sizePx*0.05));
          ctx.beginPath();
          ctx.moveTo(0, -s*0.35);
          ctx.quadraticCurveTo(s*0.28, -s*0.05, 0, s*0.35);
          ctx.quadraticCurveTo(-s*0.28, -s*0.05, 0, -s*0.35);
          ctx.closePath();
          ctx.fill();
          ctx.stroke();
        } else if (t.def.id === "sniper") {
          ctx.strokeStyle = sniperCol;
          ctx.lineWidth = Math.max(2, Math.floor(sizePx*0.07));
          ctx.beginPath();
          ctx.arc(0, 0, s*0.22, 0, Math.PI*2);
          ctx.stroke();

          ctx.lineWidth = Math.max(1.5, Math.floor(sizePx*0.05));
          ctx.beginPath();
          ctx.moveTo(-s*0.30, 0); ctx.lineTo(s*0.30, 0);
          ctx.moveTo(0, -s*0.30); ctx.lineTo(0, s*0.30);
          ctx.stroke();
        }

      ctx.restore();
    }

    drawLevelBadge(ctx, level, px, py, size, color="rgba(250,204,21,0.95)", primaryPct=0, prestigePct=0){
      const r = size*0.16;
      const cx = px + size*0.18;
      const cy = py + size*0.18;
      const fillPct = clamp(primaryPct, 0, 1);
      const isPrestige = level >= CFG.PRESTIGE_LEVEL;

      ctx.save();
      ctx.shadowBlur = isPrestige ? 12 : 6;
      ctx.shadowColor = isPrestige ? "rgba(96,165,250,0.72)" : "rgba(250,204,21,0.28)";
      ctx.fillStyle = color;
      ctx.strokeStyle = "rgba(15,23,42,0.95)";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, Math.PI*2);
      ctx.fill();
      ctx.stroke();
      ctx.restore();

      // Primary skill fill (bottom -> top)
      ctx.save();
      ctx.beginPath();
      ctx.arc(cx, cy, r-1.2, 0, Math.PI*2);
      ctx.clip();
      ctx.fillStyle = "rgba(56,189,248,0.88)";
      const h = (r*2) * fillPct;
      ctx.fillRect(cx-r, cy+r-h, r*2, h);
      ctx.restore();

      ctx.fillStyle = "rgba(15,23,42,0.98)";
      ctx.font = `bold ${Math.max(12, Math.floor(size*0.20))}px system-ui`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(String(level), cx, cy+0.5);

      if (isPrestige) {
        const pr = r * 0.72;
        const pcx = cx - r * 1.25;
        const pcy = cy + r * 1.00;
        const pFill = clamp(prestigePct, 0, 1);
        const pulse = 0.62 + 0.38 * Math.sin((performance.now() / 1000) * 5.0);

        ctx.fillStyle = "rgba(250,204,21,0.35)";
        ctx.strokeStyle = "rgba(147,197,253,0.95)";
        ctx.lineWidth = 1.9;
        ctx.beginPath();
        ctx.arc(pcx, pcy, pr, 0, Math.PI*2);
        ctx.fill();
        ctx.stroke();

        ctx.strokeStyle = `rgba(125,211,252,${0.45 + 0.45 * pulse})`;
        ctx.lineWidth = 2.2;
        ctx.beginPath();
        ctx.arc(pcx, pcy, pr + 1.2 + pulse * 0.6, 0, Math.PI*2);
        ctx.stroke();

        ctx.save();
        ctx.beginPath();
        ctx.arc(pcx, pcy, pr-1, 0, Math.PI*2);
        ctx.clip();
        ctx.fillStyle = "rgba(250,204,21,0.95)";
        const ph = (pr*2) * pFill;
        ctx.fillRect(pcx-pr, pcy+pr-ph, pr*2, ph);
        ctx.restore();
      }
    }

    drawAffixIcon(ctx, affixId, cx, cy, size){
      ctx.save();
      ctx.translate(cx, cy);
      ctx.lineWidth = 2;
      ctx.strokeStyle = "rgba(255,255,255,0.85)";
      ctx.fillStyle = "rgba(15,23,42,0.60)";

      if (affixId === "armored") {
        ctx.beginPath();
        ctx.moveTo(0, -size*0.9);
        ctx.lineTo(size*0.7, -size*0.2);
        ctx.lineTo(size*0.45, size*0.9);
        ctx.lineTo(-size*0.45, size*0.9);
        ctx.lineTo(-size*0.7, -size*0.2);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
      } else if (affixId === "arcane") {
        ctx.beginPath();
        ctx.moveTo(0, -size);
        ctx.lineTo(size, 0);
        ctx.lineTo(0, size);
        ctx.lineTo(-size, 0);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
      } else if (affixId === "swift") {
        ctx.beginPath();
        ctx.moveTo(-size*0.9, -size*0.5);
        ctx.lineTo(0, 0);
        ctx.lineTo(-size*0.9, size*0.5);
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(0, -size*0.5);
        ctx.lineTo(size*0.9, 0);
        ctx.lineTo(0, size*0.5);
        ctx.stroke();
      } else if (affixId === "regen") {
        ctx.beginPath();
        ctx.moveTo(-size*0.2, -size);
        ctx.lineTo(size*0.2, -size);
        ctx.lineTo(size*0.2, -size*0.2);
        ctx.lineTo(size, -size*0.2);
        ctx.lineTo(size, size*0.2);
        ctx.lineTo(size*0.2, size*0.2);
        ctx.lineTo(size*0.2, size);
        ctx.lineTo(-size*0.2, size);
        ctx.lineTo(-size*0.2, size*0.2);
        ctx.lineTo(-size, size*0.2);
        ctx.lineTo(-size, -size*0.2);
        ctx.lineTo(-size*0.2, -size*0.2);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
      } else if (affixId === "volatile") {
        ctx.beginPath();
        for (let i=0; i<6; i++){
          const a = (Math.PI * 2 * i) / 6;
          const r = (i % 2 === 0) ? size : size * 0.45;
          ctx.lineTo(Math.cos(a) * r, Math.sin(a) * r);
        }
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
      }

      ctx.restore();
    }

    drawStatusIcon(ctx, kind, cx, cy, size){
      ctx.save();
      ctx.translate(cx, cy);
      ctx.lineWidth = 2;
      const colors = {
        resist: "rgba(59,130,246,0.85)",
        plate: "rgba(251,146,60,0.85)",
        shield: "rgba(56,189,248,0.85)",
        decay: "rgba(34,197,94,0.85)"
      };
      ctx.strokeStyle = colors[kind] || "rgba(255,255,255,0.8)";
      ctx.fillStyle = "rgba(15,23,42,0.55)";

      if (kind === "resist") {
        ctx.beginPath();
        ctx.arc(0, 0, size*0.9, 0, Math.PI*2);
        ctx.stroke();
      } else if (kind === "plate") {
        ctx.beginPath();
        ctx.rect(-size, -size*0.6, size*2, size*1.2);
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(-size*0.6, -size*0.2);
        ctx.lineTo(size*0.6, -size*0.2);
        ctx.moveTo(-size*0.6, size*0.2);
        ctx.lineTo(size*0.6, size*0.2);
        ctx.stroke();
      } else if (kind === "shield") {
        ctx.beginPath();
        ctx.moveTo(0, -size);
        ctx.lineTo(size*0.8, -size*0.2);
        ctx.lineTo(size*0.5, size);
        ctx.lineTo(-size*0.5, size);
        ctx.lineTo(-size*0.8, -size*0.2);
        ctx.closePath();
        ctx.stroke();
      } else if (kind === "decay") {
        ctx.beginPath();
        ctx.moveTo(0, -size);
        ctx.quadraticCurveTo(size*0.8, -size*0.2, 0, size);
        ctx.quadraticCurveTo(-size*0.8, -size*0.2, 0, -size);
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(-size*0.4, size*0.9);
        ctx.lineTo(size*0.4, size*0.9);
        ctx.stroke();
      }

      ctx.restore();
    }

    draw(){
      const ctx=this.ctx;
      ctx.clearRect(0,0,this.cv.width,this.cv.height);
      const baseOffsetX = this.offsetX;
      const baseOffsetY = this.offsetY;
      const shake = this.getScreenShakeOffset();
      if (shake.x !== 0 || shake.y !== 0) {
        this.offsetX = baseOffsetX + shake.x;
        this.offsetY = baseOffsetY + shake.y;
      }

      if (this.useMapBackground && this.mapBgReady && this.mapBg && this.tileSize > 0) {
        const ox = this.offsetX;
        const oy = this.offsetY;
        const w = this.map.w * this.tileSize;
        const h = this.map.h * this.tileSize;
        const bgDef = this.getMapBackgroundDef();
        const crop = bgDef.crop || { x: 0, y: 0, w: 1, h: 1 };
        const sx = Math.round(this.mapBg.width * crop.x);
        const sy = Math.round(this.mapBg.height * crop.y);
        const sw = Math.round(this.mapBg.width * crop.w);
        const sh = Math.round(this.mapBg.height * crop.h);
        const scale = bgDef.scale ?? 1;
        const dw = w * scale;
        const dh = h * scale;
        const dx = ox + (w - dw) / 2;
        const dy = oy + (h - dh) / 2;
        ctx.drawImage(this.mapBg, sx, sy, sw, sh, dx, dy, dw, dh);
        // no path glow overlay
      }

      // grid
      for(let y=0;y<this.map.h;y++){
        for(let x=0;x<this.map.w;x++){
          const px=this.offsetX + x*this.tileSize;
          const py=this.offsetY + y*this.tileSize;
          const isPath=this.map.isPath(x,y);
          const isObstacle = this.map.isObstacle ? this.map.isObstacle(x, y) : (this.map.grid?.[y]?.[x] === 2);
          ctx.fillStyle = isPath
            ? "rgba(255,255,255,0.10)"
            : (isObstacle ? "rgba(249,115,22,0.20)" : "rgba(255,255,255,0.03)");
          ctx.fillRect(px,py,this.tileSize,this.tileSize);
          if (isObstacle) {
            const pad = Math.max(4, this.tileSize * 0.24);
            ctx.strokeStyle = "rgba(255,237,213,0.95)";
            ctx.lineWidth = Math.max(2, this.tileSize * 0.08);
            ctx.beginPath();
            ctx.moveTo(px + pad, py + pad);
            ctx.lineTo(px + this.tileSize - pad, py + this.tileSize - pad);
            ctx.moveTo(px + this.tileSize - pad, py + pad);
            ctx.lineTo(px + pad, py + this.tileSize - pad);
            ctx.stroke();
          }

        }
      }

      // grid lines
      ctx.strokeStyle="rgba(255,255,255,0.06)";
      ctx.lineWidth=1;
      const ox=this.offsetX + 0.5;
      const oy=this.offsetY + 0.5;

      for(let x=0;x<=this.map.w;x++){
        const px=ox + x*this.tileSize;
        ctx.beginPath();
        ctx.moveTo(px, oy);
        ctx.lineTo(px, oy + this.map.h*this.tileSize);
        ctx.stroke();
      }
      for(let y=0;y<=this.map.h;y++){
        const py=oy + y*this.tileSize;
        ctx.beginPath();
        ctx.moveTo(ox, py);
        ctx.lineTo(ox + this.map.w*this.tileSize, py);
        ctx.stroke();
      }

      // entrance/exit
      const drawMarker=(gx,gy,color)=>{
        const px=this.offsetX + gx*this.tileSize;
        const py=this.offsetY + gy*this.tileSize;
        ctx.fillStyle=color;
        ctx.fillRect(px+2,py+2,this.tileSize-4,this.tileSize-4);
      };
      drawMarker(this.map.entrance.x,this.map.entrance.y,"rgba(34,197,94,0.35)");
      drawMarker(this.map.exit.x,this.map.exit.y,"rgba(239,68,68,0.35)");

      // selected tower range
      if(this.selectedTowerInstance){
        const t=this.selectedTowerInstance;
        const cx=this.offsetX + t.x*this.tileSize;
        const cy=this.offsetY + t.y*this.tileSize;
        ctx.strokeStyle="rgba(56,189,248,0.25)";
        ctx.lineWidth=2;
        ctx.beginPath();
        ctx.arc(cx,cy,t.range*this.tileSize,0,Math.PI*2);
        ctx.stroke();
      }

      if(this.selectedTowerDef && this.hoverGrid){
        const d = this.selectedTowerDef;
        const g = this.hoverGrid;
        const canPlace = this.canPlaceTowerAt(g.x, g.y, d);
        const sizeTiles = d.size ?? 1;
        const px = this.offsetX + g.x*this.tileSize;
        const py = this.offsetY + g.y*this.tileSize;
        const w = this.tileSize * sizeTiles;
        const h = this.tileSize * sizeTiles;
        const cx = px + w/2;
        const cy = py + h/2;
        const range = Math.max(0, d.base?.Range ?? 0);

        ctx.fillStyle = canPlace ? "rgba(34,197,94,0.18)" : "rgba(239,68,68,0.20)";
        ctx.fillRect(px, py, w, h);
        ctx.strokeStyle = canPlace ? "rgba(34,197,94,0.60)" : "rgba(239,68,68,0.70)";
        ctx.lineWidth = 2;
        ctx.strokeRect(px+1, py+1, w-2, h-2);

        if (range > 0) {
          ctx.strokeStyle = canPlace ? "rgba(56,189,248,0.35)" : "rgba(239,68,68,0.30)";
          ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.arc(cx, cy, range*this.tileSize, 0, Math.PI*2);
          ctx.stroke();
        }

        const ghostTower = { def: d, level: 1, x: g.x + sizeTiles/2, y: g.y + sizeTiles/2, size: sizeTiles };
        ctx.save();
        ctx.globalAlpha = 0.55;
        this.drawTowerIcon(ctx, ghostTower, cx, cy, this.tileSize*0.90*(sizeTiles ?? 1));
        ctx.restore();
      }

      // rings
      for(const r of this.rings){
        const cx=this.offsetX + r.x*this.tileSize;
        const cy=this.offsetY + r.y*this.tileSize;
        const a=r.alpha();
        ctx.strokeStyle = r.color.replace(/[\d.]+\)$/,""+(0.10+0.50*a)+")");
        ctx.lineWidth = r.width ?? 3;
        ctx.beginPath();
        ctx.arc(cx,cy,r.r*this.tileSize,0,Math.PI*2);
        ctx.stroke();
      }

      // peel buff links
      const tNow = now();
      for (const t of this.towers) {
        const buffs = t.peelBuffs ? Object.entries(t.peelBuffs).filter(([, b]) => b.time > 0) : [];
        if (!buffs.length) continue;
        for (let i = 0; i < buffs.length; i++) {
          const [kind, buff] = buffs[i];
          const source = buff.source;
          if (!source || !this.towers.includes(source)) continue;
          const info = PEEL_BUFF_INFO[kind] || { color: "rgba(14,165,233,0.95)" };
          const total = buff.maxTime ?? CFG.PEEL_BUFF_DURATION;
          const a = clamp(buff.time / total, 0, 1);
          const pulse = 0.55 + 0.45 * Math.sin(tNow * 8.0 + i);
          const ax = this.offsetX + source.x * this.tileSize;
          const ay = this.offsetY + source.y * this.tileSize;
          const bx = this.offsetX + t.x * this.tileSize;
          const by = this.offsetY + t.y * this.tileSize;
          const mx = (ax + bx) * 0.5;
          const my = (ay + by) * 0.5;
          const dx = bx - ax;
          const dy = by - ay;
          const len = Math.max(0.0001, Math.hypot(dx, dy));
          const nx = -dy / len;
          const ny = dx / len;
          const arc = Math.min(this.tileSize * 2.60, len * 0.60);
          const cx = mx + nx * arc;
          const cy = my + ny * arc;

          ctx.strokeStyle = info.color.replace(/[\d.]+\)$/,""+(0.18 + 0.35 * a * pulse)+")");
          ctx.lineWidth = 4;
          ctx.beginPath();
          ctx.moveTo(ax, ay);
          ctx.quadraticCurveTo(cx, cy, bx, by);
          ctx.stroke();

          ctx.strokeStyle = info.color.replace(/[\d.]+\)$/,""+(0.55 + 0.35 * a)+")");
          ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.moveTo(ax, ay);
          ctx.quadraticCurveTo(cx, cy, bx, by);
          ctx.stroke();
        }
      }

      // towers
      const drawTowers = [...this.towers].sort((a,b)=>{
        if (a.y !== b.y) return a.y - b.y;
        return a.x - b.x;
      });
      const towerOverlayQueue = [];
      for(const t of drawTowers){
        const px=this.offsetX + t.gx*this.tileSize;
        const py=this.offsetY + t.gy*this.tileSize;
        const sizeTiles = t.size ?? 1;
        const cx=px + (this.tileSize*sizeTiles)/2;
        const cy=py + (this.tileSize*sizeTiles)/2;

        const sizePx = this.tileSize * (t.size ?? 1);
        if(t===this.selectedTowerInstance){
          ctx.strokeStyle="rgba(56,189,248,0.55)";
          ctx.lineWidth=2;
          ctx.beginPath();
          ctx.rect(px+2,py+2,sizePx-4,sizePx-4);
          ctx.stroke();
        }

        // LV20+ aura
        if (t.level >= CFG.TOWER_MAX_LEVEL) {
          const isPrestige = t.level >= CFG.PRESTIGE_LEVEL;
          const pulse = 0.55 + 0.45 * Math.sin(tNow * (isPrestige ? 5.2 : 4.4));
          const alphaBase = isPrestige ? 0.14 : 0.10;
          const alphaPulse = isPrestige ? 0.16 : 0.12;
          const col = isPrestige
            ? `rgba(56,189,248,${alphaBase + alphaPulse * pulse})`
            : `rgba(250,204,21,${alphaBase + alphaPulse * pulse})`;
          ctx.fillStyle = col;
          ctx.beginPath();
          ctx.arc(cx, cy, this.tileSize * (0.42 + 0.08 * pulse) * (t.size ?? 1), 0, Math.PI * 2);
          ctx.fill();
        }

        const peelEntries = t.peelBuffs ? Object.entries(t.peelBuffs).filter(([, b]) => b.time > 0) : [];
        if (peelEntries.length) {
          peelEntries.sort((a,b)=>a[0].localeCompare(b[0]));
          let idx = 0;
          for (const [kind, buff] of peelEntries) {
            const info = PEEL_BUFF_INFO[kind] || { color: "rgba(14,165,233,0.95)" };
            const total = buff.maxTime ?? CFG.PEEL_BUFF_DURATION;
            const a = clamp(buff.time / total, 0, 1);
            const ringBase = this.tileSize * 0.34 * (t.size ?? 1);
            const ringGap = this.tileSize * 0.06;
            const r = ringBase + idx * ringGap;
            ctx.strokeStyle = info.color.replace(/[\d.]+\)$/,""+(0.25 + 0.35 * a)+")");
            ctx.lineWidth = 2;
            ctx.beginPath();
            ctx.arc(cx, cy, r, 0, Math.PI*2);
            ctx.stroke();
            idx += 1;
          }
        }

        this.drawTowerIcon(ctx,t,cx,cy,this.tileSize*0.90*(t.size ?? 1));

        towerOverlayQueue.push({ t, px, py, sizePx });

      }

      for (const item of towerOverlayQueue) {
        const t = item.t;
        const px = item.px;
        const py = item.py;
        const sizePx = item.sizePx;
        const primaryPct = (t.maxMana > 0) ? clamp(t.mana / t.maxMana, 0, 1) : 0;
        const prestigePct = (t.level >= CFG.PRESTIGE_LEVEL && t.prestigeMaxMana > 0)
          ? clamp(t.prestigeMana / t.prestigeMaxMana, 0, 1)
          : 0;
        const badgeCol = (t.level >= CFG.PRESTIGE_LEVEL) ? "rgba(165,210,255,0.95)" : "rgba(250,204,21,0.95)";
        this.drawLevelBadge(ctx, t.level, px, py, this.tileSize, badgeCol, primaryPct, prestigePct);

        if (t.def.id === "sniper" && (t.secondaryLevel ?? 0) > 0) {
          const rr = this.tileSize * 0.12;
          const rcx = px + sizePx - rr - 4;
          const rcy = py + rr + 4;
          const over100 = (t.secondaryLevel ?? 0) >= 100;
          ctx.fillStyle = over100 ? "rgba(34,197,94,0.55)" : "rgba(34,197,94,0.38)";
          ctx.strokeStyle = "rgba(34,197,94,0.95)";
          ctx.lineWidth = 1.8;
          if (over100) {
            ctx.save();
            ctx.shadowBlur = Math.max(8, rr * 2.4);
            ctx.shadowColor = "rgba(34,197,94,0.72)";
          }
          ctx.beginPath();
          ctx.arc(rcx, rcy, rr, 0, Math.PI*2);
          ctx.fill();
          ctx.stroke();
          if (over100) ctx.restore();
          ctx.fillStyle = "rgba(220,252,231,0.98)";
          ctx.font = `700 ${Math.max(10, Math.floor(this.tileSize*0.16))}px system-ui`;
          ctx.textAlign = "center";
          ctx.textBaseline = "middle";
          ctx.fillText(String(t.secondaryLevel), rcx, rcy+0.5);
        }
      }

      // enemies
      for(const e of this.enemies){
        const px=this.offsetX + e.x*this.tileSize;
        const py=this.offsetY + e.y*this.tileSize;

        const hpScale = clamp((0.85 + Math.log2(Math.max(16, e.maxHP))/12) * 1.12, 0.95, 1.7);
        const bossScale = e.isBoss ? 1.6 : 1.0;

        const walkFreq = 4.0 + e.baseSpeed*2.5;
        const walkAmp = 0.05 + e.baseSpeed*0.015;
        const pulse = 1 + Math.sin((tNow - e.birthT)*walkFreq) * walkAmp;

        const radius = this.tileSize * 0.23 * hpScale * bossScale * pulse;

        if (e.typeId === "siphon") {
          const auraR = CFG.MANA_BURN_AURA_RADIUS_TILES * this.tileSize;
          ctx.strokeStyle = "rgba(14,165,233,0.30)";
          ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.arc(px, py, auraR, 0, Math.PI*2);
          ctx.stroke();
        }

        ctx.fillStyle="rgba(0,0,0,0.30)";
        ctx.beginPath();
        ctx.ellipse(px, py + radius*0.98, radius*0.92, radius*0.36, 0, 0, Math.PI*2);
        ctx.fill();

        const palette = e.isBoss
          ? { bright:"rgba(255,248,178,0.98)", mid:"rgba(250,204,21,0.92)", deep:"rgba(133,77,14,0.96)", rim:"rgba(254,240,138,0.95)" }
          : (e.typeId==="tank")
            ? { bright:"rgba(241,245,249,0.95)", mid:"rgba(148,163,184,0.90)", deep:"rgba(51,65,85,0.95)", rim:"rgba(226,232,240,0.90)" }
            : (e.typeId==="siphon")
              ? { bright:"rgba(186,230,253,0.97)", mid:"rgba(14,165,233,0.92)", deep:"rgba(12,74,110,0.96)", rim:"rgba(125,211,252,0.92)" }
              : { bright:"rgba(251,207,232,0.96)", mid:"rgba(236,72,153,0.90)", deep:"rgba(131,24,67,0.96)", rim:"rgba(251,113,133,0.90)" };

        const bodyGrad = ctx.createRadialGradient(
          px - radius*0.38, py - radius*0.40, radius*0.10,
          px, py, radius*1.08
        );
        bodyGrad.addColorStop(0.00, palette.bright);
        bodyGrad.addColorStop(0.22, palette.mid);
        bodyGrad.addColorStop(0.66, palette.mid.replace(/[\d.]+\)$/,"0.78)"));
        bodyGrad.addColorStop(1.00, palette.deep);

        ctx.save();
        ctx.beginPath();
        ctx.arc(px, py, radius, 0, Math.PI*2);
        ctx.clip();
        ctx.fillStyle = bodyGrad;
        ctx.fillRect(px - radius - 2, py - radius - 2, radius*2 + 4, radius*2 + 4);

        const bounceGrad = ctx.createLinearGradient(px - radius*0.6, py - radius*0.2, px + radius*0.9, py + radius*0.8);
        bounceGrad.addColorStop(0.00, "rgba(255,255,255,0.00)");
        bounceGrad.addColorStop(0.65, "rgba(255,255,255,0.05)");
        bounceGrad.addColorStop(1.00, "rgba(255,255,255,0.18)");
        ctx.fillStyle = bounceGrad;
        ctx.fillRect(px - radius - 2, py - radius - 2, radius*2 + 4, radius*2 + 4);

        ctx.globalAlpha = 0.90;
        ctx.fillStyle = "rgba(255,255,255,0.72)";
        ctx.beginPath();
        ctx.ellipse(px - radius*0.34, py - radius*0.36, radius*0.27, radius*0.18, -0.42, 0, Math.PI*2);
        ctx.fill();
        ctx.globalAlpha = 0.55;
        ctx.fillStyle = "rgba(255,255,255,0.35)";
        ctx.beginPath();
        ctx.ellipse(px - radius*0.14, py - radius*0.16, radius*0.13, radius*0.08, -0.36, 0, Math.PI*2);
        ctx.fill();

        ctx.globalAlpha = 0.38;
        ctx.fillStyle = "rgba(2,6,23,0.88)";
        ctx.beginPath();
        ctx.arc(px + radius*0.32, py + radius*0.28, radius*0.52, 0, Math.PI*2);
        ctx.fill();
        ctx.globalAlpha = 1;
        ctx.restore();

        ctx.lineWidth = Math.max(2, Math.floor(radius * 0.18));
        ctx.strokeStyle = "rgba(15,23,42,0.88)";
        ctx.beginPath();
        ctx.arc(px, py, radius, 0, Math.PI*2);
        ctx.stroke();
        ctx.lineWidth = Math.max(1, Math.floor(radius * 0.09));
        ctx.strokeStyle = palette.rim;
        ctx.beginPath();
        ctx.arc(px, py, radius*0.94, -0.20, Math.PI*1.54);
        ctx.stroke();

        const hpPct=clamp(e.hp/e.maxHP,0,1);
        ctx.fillStyle="rgba(34,197,94,0.75)";
        ctx.fillRect(px-radius, py-radius-10, (radius*2)*hpPct, 4);
        ctx.fillStyle="rgba(255,255,255,0.12)";
        ctx.fillRect(px-radius+(radius*2)*hpPct, py-radius-10, (radius*2)*(1-hpPct), 4);
        ctx.strokeStyle="rgba(15,23,42,0.85)";
        ctx.lineWidth=1;
        ctx.strokeRect(px-radius, py-radius-10, radius*2, 4);

        if (e.isBoss && e.bossSkills) {
          const activeSkills = Object.values(e.bossSkills).filter(s => s.active);
          if (activeSkills.length) {
            let i = 0;
            for (const s of activeSkills) {
              const info = BOSS_SKILL_INFO[s.id] || { name: s.name, color: "rgba(168,85,247,0.70)" };
              const cd = s.cd || 1;
              const progress = clamp(1 - (s.timer || 0) / cd, 0, 1);
              const barH = 14;
              const barY = py + radius + 8 + i * (barH + 4);
              ctx.fillStyle=info.color;
              ctx.fillRect(px-radius, barY, (radius*2)*progress, barH);
              ctx.fillStyle="rgba(255,255,255,0.10)";
              ctx.fillRect(px-radius+(radius*2)*progress, barY, (radius*2)*(1-progress), barH);
              ctx.strokeStyle="rgba(15,23,42,0.85)";
              ctx.lineWidth=1;
              ctx.strokeRect(px-radius, barY, radius*2, barH);

              const label = `${info.name}`;
              let skillFont = Math.max(6, Math.floor(radius*0.30));
              const maxW = Math.max(14, radius * 2 - 6);
              do {
                ctx.font = `700 ${skillFont}px system-ui`;
                if (ctx.measureText(label).width <= maxW || skillFont <= 6) break;
                skillFont -= 1;
              } while (skillFont >= 6);
              ctx.textAlign = "center";
              ctx.textBaseline = "middle";
              ctx.fillStyle = "rgba(15,23,42,0.85)";
              ctx.fillText(label, px + 1, barY + barH / 2 + 0.5);
              ctx.fillStyle = "rgba(255,255,255,0.95)";
              ctx.fillText(label, px, barY + barH / 2);
              i += 1;
            }
          }
        }

        const primaryModifier = listEnemyModifiers(e)[0] || null;
        if (primaryModifier) {
          const iconY = py;
          const iconSize = Math.max(8, Math.floor(radius*0.72));
          const badgeR = iconSize * 0.78;
          ctx.save();
          ctx.shadowBlur = Math.max(6, badgeR * 1.8);
          ctx.shadowColor = "rgba(255,255,255,0.45)";
          ctx.fillStyle = "rgba(15,23,42,0.60)";
          ctx.beginPath();
          ctx.arc(px, iconY, badgeR, 0, Math.PI*2);
          ctx.fill();
          ctx.restore();
          ctx.strokeStyle = "rgba(255,255,255,0.82)";
          ctx.lineWidth = Math.max(1.6, badgeR * 0.12);
          ctx.beginPath();
          ctx.arc(px, iconY, badgeR, 0, Math.PI*2);
          ctx.stroke();
          if (primaryModifier.iconKind === "affix") {
            this.drawAffixIcon(ctx, primaryModifier.iconId, px, iconY, iconSize);
          } else {
            this.drawStatusIcon(ctx, primaryModifier.iconId || "resist", px, iconY, iconSize * 0.95);
          }
        }

        const zeroArmor = e.armor <= 0.01;
        if (e.armorShredFlat > 0 || zeroArmor) {
          const pulse = 0.55 + 0.45 * Math.sin((tNow - e.birthT) * 8.2);
          const s = radius * (zeroArmor ? (0.70 + 0.08 * pulse) : 0.56);
          const darkW = Math.max(3, radius * 0.16);
          const brightW = Math.max(1.8, radius * 0.08);

          ctx.save();
          ctx.lineCap = "round";
          ctx.lineJoin = "round";
          ctx.shadowBlur = zeroArmor ? Math.max(12, radius * 0.9) : Math.max(6, radius * 0.45);
          ctx.shadowColor = zeroArmor
            ? `rgba(251,113,133,${0.30 + 0.35 * pulse})`
            : "rgba(239,68,68,0.30)";

          if (zeroArmor) {
            ctx.strokeStyle = `rgba(251,113,133,${0.22 + 0.22 * pulse})`;
            ctx.lineWidth = Math.max(2.4, radius * 0.11);
            ctx.beginPath();
            ctx.arc(px, py, radius * 1.02, 0, Math.PI * 2);
            ctx.stroke();
          }

          ctx.strokeStyle = "rgba(15,23,42,0.92)";
          ctx.lineWidth = darkW;
          ctx.beginPath();
          ctx.moveTo(px - s, py - s); ctx.lineTo(px + s, py + s);
          ctx.moveTo(px + s, py - s); ctx.lineTo(px - s, py + s);
          ctx.stroke();

          ctx.strokeStyle = zeroArmor
            ? `rgba(254,205,211,${0.90 + 0.08 * pulse})`
            : "rgba(248,113,113,0.98)";
          ctx.lineWidth = brightW;
          ctx.beginPath();
          ctx.moveTo(px - s, py - s); ctx.lineTo(px + s, py + s);
          ctx.moveTo(px + s, py - s); ctx.lineTo(px - s, py + s);
          ctx.stroke();

          ctx.restore();
        }

        if(e.slowTime>0){
          ctx.strokeStyle="rgba(255,255,255,0.85)";
          ctx.lineWidth=2;
          ctx.beginPath();
          ctx.arc(px,py,radius*1.25,0,Math.PI*2);
          ctx.stroke();
        }

        if(e.frostbiteTime>0 || e.frostbiteDotTime>0){
          const baseW = radius*1.05;
          const baseH = radius*0.50;
          const cx = px;
          const cy = py + radius*0.95;
          const skew = radius*0.22;
          const semiR = baseW*0.38;

          ctx.fillStyle="rgba(248,250,252,0.70)";
          ctx.strokeStyle="rgba(255,255,255,0.90)";
          ctx.lineWidth=2;

          ctx.beginPath();
          ctx.moveTo(cx - baseW + skew, cy - baseH);
          ctx.lineTo(cx + baseW + skew, cy - baseH);
          ctx.lineTo(cx + baseW - skew, cy + baseH);
          ctx.lineTo(cx - baseW - skew, cy + baseH);
          ctx.closePath();
          ctx.fill();
          ctx.stroke();

          ctx.fillStyle="rgba(15,23,42,0.20)";
          ctx.beginPath();
          ctx.arc(cx, cy - baseH, semiR, 0, Math.PI, true);
          ctx.fill();
        }

        if(e.poisonStacks > 0){
          const pp = 0.55 + 0.45*Math.sin((tNow - e.birthT)*9.0);
          ctx.fillStyle = `rgba(34,197,94,${0.06 + 0.10*pp})`;
          ctx.beginPath();
          ctx.arc(px, py, radius*1.35, 0, Math.PI*2);
          ctx.fill();

          ctx.font = `bold ${Math.max(10, Math.floor(radius*0.9))}px system-ui`;
          ctx.textAlign = "center";
          ctx.textBaseline = "middle";
          ctx.fillStyle = "rgba(34,197,94,0.98)";
          const dps = Math.round(e.poisonStacks * e.poisonPerTick * (1 - (e.poisonResist || 0)) * 10);
          ctx.fillText(String(dps), px, py - radius*1.55);
        }

        if(e===this.selectedEnemy){
          ctx.strokeStyle="rgba(250,204,21,0.85)";
          ctx.lineWidth=2;
          ctx.beginPath();
          ctx.arc(px,py,radius*1.35,0,Math.PI*2);
          ctx.stroke();
        }

      }

      // HP bars are always drawn last so debuff visuals and sprites cannot cover them.
      for (const e of this.enemies) {
        const px=this.offsetX + e.x*this.tileSize;
        const py=this.offsetY + e.y*this.tileSize;
        const hpScale = clamp((0.85 + Math.log2(Math.max(16, e.maxHP))/12) * 1.12, 0.95, 1.7);
        const bossScale = e.isBoss ? 1.6 : 1.0;
        const walkFreq = 4.0 + e.baseSpeed*2.5;
        const walkAmp = 0.05 + e.baseSpeed*0.015;
        const pulse = 1 + Math.sin((tNow - e.birthT)*walkFreq) * walkAmp;
        const radius = this.tileSize * 0.23 * hpScale * bossScale * pulse;
        const hpPct = clamp(e.hp / e.maxHP, 0, 1);
        ctx.fillStyle="rgba(34,197,94,0.78)";
        ctx.fillRect(px-radius, py-radius-10, (radius*2)*hpPct, 4);
        ctx.fillStyle="rgba(255,255,255,0.12)";
        ctx.fillRect(px-radius+(radius*2)*hpPct, py-radius-10, (radius*2)*(1-hpPct), 4);
        ctx.strokeStyle="rgba(15,23,42,0.90)";
        ctx.lineWidth=1;
        ctx.strokeRect(px-radius, py-radius-10, radius*2, 4);
      }

      const brightenRgba = (rgba, mix=0.42, alpha=0.98) => {
        const m = rgba.match(/rgba?\(([^)]+)\)/i);
        if (!m) return `rgba(255,255,255,${alpha})`;
        const parts = m[1].split(",").map(s => s.trim());
        const r = clamp(parseFloat(parts[0]) || 255, 0, 255);
        const g = clamp(parseFloat(parts[1]) || 255, 0, 255);
        const b = clamp(parseFloat(parts[2]) || 255, 0, 255);
        const lr = Math.round(r + (255 - r) * mix);
        const lg = Math.round(g + (255 - g) * mix);
        const lb = Math.round(b + (255 - b) * mix);
        return `rgba(${lr},${lg},${lb},${alpha})`;
      };
      const traceProjectileShape = (shape, radius) => {
        if (shape === "diamond") {
          ctx.moveTo(0, -radius*1.10);
          ctx.lineTo(radius*0.90, 0);
          ctx.lineTo(0, radius*1.10);
          ctx.lineTo(-radius*0.90, 0);
          ctx.closePath();
          return;
        }
        if (shape === "star") {
          const outer = radius * 1.12;
          const inner = radius * 0.48;
          const spikes = 5;
          for (let i = 0; i < spikes * 2; i += 1) {
            const rr = (i % 2 === 0) ? outer : inner;
            const a = -Math.PI / 2 + (Math.PI * i) / spikes;
            const x = Math.cos(a) * rr;
            const y = Math.sin(a) * rr;
            if (i === 0) ctx.moveTo(x, y);
            else ctx.lineTo(x, y);
          }
          ctx.closePath();
          return;
        }
        if (shape === "dagger") {
          ctx.moveTo(0, -radius*1.28);
          ctx.lineTo(radius*0.58, radius*0.14);
          ctx.lineTo(radius*0.22, radius*0.14);
          ctx.lineTo(radius*0.22, radius*1.14);
          ctx.lineTo(-radius*0.22, radius*1.14);
          ctx.lineTo(-radius*0.22, radius*0.14);
          ctx.lineTo(-radius*0.58, radius*0.14);
          ctx.closePath();
          return;
        }
        if (shape === "rings") {
          ctx.arc(0, 0, radius, 0, Math.PI*2);
          return;
        }
        ctx.arc(0, 0, radius, 0, Math.PI*2);
      };

      // projectiles
      for(const p of this.projectiles){
        if (p.trailNodes?.length) {
          for (const n of p.trailNodes) {
            const tx = this.offsetX + n.x * this.tileSize;
            const ty = this.offsetY + n.y * this.tileSize;
            const ta = clamp((n.life > 0 ? (n.t / n.life) : 0), 0, 1);
            const tr = Math.max(1.2, n.size * this.tileSize * (0.80 + (1 - ta) * 0.40));
            const c = (n.color || "rgba(226,232,240,0.90)").replace(/[\d.]+\)$/, `${(ta * 0.60).toFixed(3)})`);
            ctx.save();
            ctx.shadowBlur = Math.max(4, tr * 1.8);
            ctx.shadowColor = c;
            ctx.fillStyle = c;
            ctx.beginPath();
            ctx.arc(tx, ty, tr, 0, Math.PI*2);
            ctx.fill();
            ctx.restore();
          }
        }

        const px=this.offsetX + p.x*this.tileSize;
        const py=this.offsetY + p.y*this.tileSize;
        const baseCol = p.visual?.color || "rgba(255,255,255,0.90)";
        const rimCol = brightenRgba(baseCol, 0.44, 0.98);
        const r=(p.visual?.radius ?? 0.11)*this.tileSize*1.18;
        const shape = p.visual?.shape || "circle";
        if (r <= 0.01 || p._spent) continue;
        let angle = 0;
        if (shape === "dagger") {
          let dx = p._dirX ?? 0;
          let dy = p._dirY ?? -1;
          if (p.t && !p.t.dead && !p.t.reachedExit) {
            dx = p.t.x - p.x;
            dy = p.t.y - p.y;
          }
          angle = Math.atan2(dy, dx) + Math.PI / 2;
        }

        ctx.save();
        ctx.translate(px, py);
        ctx.rotate(angle);

        // Outer neon glow
        ctx.save();
        ctx.shadowBlur = Math.max(11, r * 3.1);
        ctx.shadowColor = baseCol;
        ctx.fillStyle = baseCol.replace(/[\d.]+\)$/,"0.22)");
        ctx.beginPath();
        traceProjectileShape(shape, r*1.52);
        ctx.fill();
        ctx.restore();

        // Bright rim
        ctx.lineWidth = Math.max(2.2, r * 0.34);
        ctx.strokeStyle = rimCol;
        ctx.beginPath();
        traceProjectileShape(shape, r);
        ctx.stroke();
        if (shape === "rings") {
          ctx.lineWidth = Math.max(1.6, r * 0.24);
          ctx.beginPath();
          ctx.arc(0, 0, r * 0.52, 0, Math.PI*2);
          ctx.stroke();
        }

        // Translucent core
        ctx.fillStyle = baseCol.replace(/[\d.]+\)$/,"0.33)");
        ctx.beginPath();
        traceProjectileShape(shape, r*0.92);
        ctx.fill();
        ctx.restore();
      }

      // lines
      for(const fx of this.effects){
        const ax=this.offsetX + fx.ax*this.tileSize;
        const ay=this.offsetY + fx.ay*this.tileSize;
        const bx=this.offsetX + fx.bx*this.tileSize;
        const by=this.offsetY + fx.by*this.tileSize;
        const a=fx.alpha();
        ctx.strokeStyle=fx.color.replace(/[\d.]+\)$/,""+a+")");
        ctx.lineWidth=fx.width;
        ctx.beginPath();
        ctx.moveTo(ax,ay); ctx.lineTo(bx,by);
        ctx.stroke();
      }

      // floating texts
      for (const f of this.floaters) {
        const a = f.alpha();
        const px=this.offsetX + f.x*this.tileSize;
        const py=this.offsetY + f.y*this.tileSize;

        ctx.save();
        ctx.globalAlpha = a;

        const drawSize = f.isCrit ? Math.round(f.size * 1.35) : f.size;
        ctx.font = `bold ${drawSize}px system-ui`;
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";

        // hafif outline
        ctx.lineWidth = f.isCrit ? 6 : 4;
        ctx.strokeStyle = "rgba(0,0,0,0.55)";
        ctx.strokeText(f.text, px, py);

        ctx.fillStyle = f.isCrit ? "rgba(250,204,21,0.95)" : "rgba(232,238,252,0.92)";
        ctx.fillText(f.text, px, py);
        ctx.restore();
      }

      const drawNeonBox = (x, y, w, h, title, value, sub, accent, alpha=1) => {
        ctx.save();
        ctx.globalAlpha = alpha;
        ctx.fillStyle = "rgba(10,20,35,0.48)";
        ctx.strokeStyle = accent;
        ctx.lineWidth = 3;
        ctx.shadowBlur = 18;
        ctx.shadowColor = accent;
        ctx.fillRect(x, y, w, h);
        ctx.strokeRect(x, y, w, h);

        ctx.shadowBlur = 0;
        ctx.fillStyle = "rgba(255,255,255,0.92)";
        ctx.textAlign = "center";
        const hasTitle = !!(title && String(title).trim().length > 0);
        if (hasTitle) {
          ctx.font = "bold 14px system-ui";
          ctx.fillText(title, x + w/2, y + 24);
        }
        ctx.font = "bold 24px system-ui";
        ctx.fillText(value, x + w/2, y + (hasTitle ? 58 : 50));
        if (sub) {
          ctx.font = "12px system-ui";
          ctx.fillStyle = "rgba(186,230,253,0.95)";
          ctx.fillText(sub, x + w/2, y + (hasTitle ? 84 : 78));
        }
        ctx.restore();
      };

      // center queue in neon box format
      const active = this.centerQueue.filter(c => (c.delay ?? 0) <= 0);
      if (active.length) {
        const top = active[0];
        const maxLife = Math.max(2.0, top.maxLife ?? top.life ?? 2.0);
        const a = clamp((top.life ?? 0) / maxLife, 0, 1);
        const w = 420;
        const h = 104;
        const x = this.cv.width/2 - w/2;
        const y = this.cv.height*0.10;
        drawNeonBox(x, y, w, h, "", `${top.text}`, "", "rgba(250,204,21,0.95)", a);
      }

      if (this.waveEndUplinkNotice) {
        const n = this.waveEndUplinkNotice;
        const a = clamp((n.life ?? 0) / (n.maxLife ?? 3.6), 0, 1);
        const size = 148;
        const peel = this.towers.find(t => t.def?.id === "peel");
        const peelCx = peel ? (this.offsetX + peel.x * this.tileSize) : (this.cv.width/2);
        const peelCy = peel ? (this.offsetY + peel.y * this.tileSize) : (this.cv.height*0.42);
        const peelHalfPx = peel ? ((peel.size ?? 1) * this.tileSize * 0.5) : (this.tileSize * 0.5);
        const gap = peelHalfPx + 26;
        const y = clamp(peelCy - size*0.5, 20, this.cv.height - size - 20);
        const leftX = clamp(peelCx - gap - size, 20, this.cv.width - size - 20);
        const rightX = clamp(peelCx + gap, 20, this.cv.width - size - 20);
        drawNeonBox(leftX, y, size, size, "CORE UPLINK", `+${formatCompact(n.coreGain)} HP`, `Wave ${n.waveNum} • ${n.casts} casts`, "rgba(56,189,248,0.95)", a);
        drawNeonBox(rightX, y, size, size, "GOLD PAYOUT", `+${formatCompact(n.goldGain)}g`, `Wave ${n.waveNum} • ${n.casts} casts`, "rgba(250,204,21,0.95)", a);
      }

      // Selected tower target panel is drawn last so it stays in front.
      this.drawSelectedTargetPanel(ctx);

      // Game over
      if(this.gameOver){
        ctx.fillStyle="rgba(0,0,0,0.62)";
        ctx.fillRect(0,0,this.cv.width,this.cv.height);

        ctx.fillStyle="rgba(255,255,255,0.95)";
        ctx.font="bold 44px system-ui";
        ctx.textAlign="center";
        ctx.fillText("GAME OVER", this.cv.width/2, this.cv.height/2 - 120);

        ctx.font="16px system-ui";
        ctx.fillText("Highest Kills (Top 10)", this.cv.width/2, this.cv.height/2 - 86);

        const list=this.highKills || [];
        ctx.font="14px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace";
        let y=this.cv.height/2 - 60;
        for(let i=0;i<list.length;i++){
          ctx.fillText(`${i+1}. ${list[i]}`, this.cv.width/2, y);
          y += 18;
        }
      }

      this.offsetX = baseOffsetX;
      this.offsetY = baseOffsetY;
    }

    refreshUI(force=false){
      if (!force) {
        this._uiDirty = true;
        return;
      }
      this._uiDirty = false;
      this._uiRefreshTimer = 0;
      // HUD stats (canvas iÃ§i ama DOM)
      if (this.hudGoldEl) this.hudGoldEl.textContent=formatCompact(this.gold);
      if (this.hudCoreHpEl) this.hudCoreHpEl.textContent=formatCompact(this.coreHP);
      if (this.hudKillsEl) this.hudKillsEl.textContent=this.totalKills;
      if (this.hudWaveEl) this.hudWaveEl.textContent=this.currentWave;

      let alive = 0;
      for (const e of this.enemies) {
        if (!e.dead && !e.reachedExit) alive += 1;
      }
      let remaining = 0;
      for (const w of this.wavesActive) {
        if (w.finished) continue;
        remaining += w.remainingInPart;
        for (let i=w.cursor+1; i<w.plan.length; i++) {
          remaining += w.plan[i].count;
        }
      }
      if (this.hudMobsEl) this.hudMobsEl.textContent=`${alive} / ${remaining}`;

      if (this.mapNameEl) this.mapNameEl.textContent=this.map.name;

      const startBtn=this.startWaveBtnEl;
      const nextBtn=this.nextWaveNowBtnEl;
      if (startBtn) {
        startBtn.disabled = this.started || this.gameOver || this.winModalOpen;
        startBtn.style.display = this.started ? "none" : "";
      }
      if (nextBtn) {
        nextBtn.disabled = (!this.started) || this.gameOver || this.winModalOpen;
        nextBtn.classList.toggle("expanded", !!this.started);
        const buff = this.nextWaveNowGoldBuff || { mult: 1, timeLeft: 0, maxTime: 0 };
        const active = buff.timeLeft > 0 && buff.mult > 1;
        const ratio = active && buff.maxTime > 0 ? clamp(buff.timeLeft / buff.maxTime, 0, 1) : 0;
        const glow = active ? clamp((buff.mult - 1) / 1.2, 0, 1.2) : 0;
        nextBtn.style.setProperty("--next-wave-fill", ratio.toFixed(4));
        nextBtn.style.setProperty("--next-wave-glow", glow.toFixed(4));
        const label = active
          ? `Next Wave Now • ${buff.mult.toFixed(1)}x Gold • ${buff.timeLeft.toFixed(1)}s`
          : "Next Wave Now";
        nextBtn.innerHTML = `<span>${label}</span>`;
      }

      const info=this.selectedInfoHudEl;
      const upBtn=this.upgradeBtnHudEl;
      const fastBtn=this.fastUpgradeBtnHudEl;
      const sellBtn=this.sellBtnHudEl;
      if (!info || !upBtn || !sellBtn) return;
      const calcFastUpgradeCost = (t) => {
        if (!t) return null;
        const target = Math.min(CFG.TOWER_MAX_LEVEL, (Math.floor(t.level / 5) + 1) * 5);
        if (t.level >= target) return null;
        let lvl = t.level;
        let total = 0;
        while (lvl < target) {
          const cost = (lvl === CFG.TOWER_MAX_LEVEL - 1)
            ? (upgradeCostCurve(t.def.cost, lvl) * 2)
            : upgradeCostCurve(t.def.cost, lvl);
          total += cost;
          lvl += 1;
        }
        return total;
      };
      const buildSimTowerState = (t, steps = 0, specialChoice = null) => {
        if (!t) return null;
        const peelAs = t.peelMul("as");
        const peelAd = t.peelMul("ad");
        const peelMag = t.peelMul("mag");
        const sim = {
          def: t.def,
          level: t.level,
          AD: [t.AD[0], t.AD[1]],
          baseAS: t.baseAS,
          magicBonus: t.magicBonus,
          manaOnHit: t.manaOnHit,
          perks: {
            adMul: t.perks.adMul,
            asMul: t.perks.asMul,
            magMul: t.perks.magMul,
            dmgMul: t.perks.dmgMul
          },
          tempASMul: t.tempASMul,
          peelBuffs: { mag: { mul: peelMag } },
          specialMagicActualMul: t.specialMagicActualMul,
          specialMagicExpectedMul: t.specialMagicExpectedMul,
          specialUpgrades: Array.isArray(t.specialUpgrades) ? [...t.specialUpgrades] : []
        };

        const count = Math.max(0, Math.floor(steps));
        for (let i = 0; i < count; i += 1) {
          const lvlBefore = sim.level;
          let g = gainCurve(lvlBefore);
          if (lvlBefore === 19) g *= 2;
          if (lvlBefore === 20) g *= 4;
          const adGainMul = (sim.def.id === "sniper")
            ? (1 + g * 1.35)
            : (sim.def.id === "archer")
              ? (1 + g * 0.88)
              : (1 + g);
          sim.AD = [
            Math.round(sim.AD[0] * adGainMul),
            Math.round(sim.AD[1] * adGainMul)
          ];
          sim.baseAS *= (1 + g * 0.22);
          const magicMult = (sim.def.id === "mage")
            ? (1 + g * 0.42)
            : (sim.def.id === "breaker")
              ? (1 + g * 0.95)
            : (sim.def.id === "archer")
              ? (1 + g * 0.40)
              : (1 + g * 0.30);
          sim.magicBonus = Math.round(sim.magicBonus * magicMult);
          if (sim.def.id !== "sniper") sim.manaOnHit *= (1 + g * 0.12);
          sim.level = (lvlBefore === CFG.TOWER_MAX_LEVEL) ? CFG.PRESTIGE_LEVEL : (lvlBefore + 1);
        }

        if (specialChoice && typeof specialChoice.apply === "function") {
          try {
            specialChoice.apply(sim);
          } catch (_) {
            // Ignore invalid preview application and keep baseline values.
          }
        }

        const adLow = Math.round(sim.AD[0] * sim.perks.adMul * sim.perks.dmgMul * peelAd);
        const adHigh = Math.round(sim.AD[1] * sim.perks.adMul * sim.perks.dmgMul * peelAd);
        const as = Math.max(0.05, sim.baseAS * sim.perks.asMul * sim.tempASMul * peelAs);
        const magic = Math.round(sim.magicBonus * sim.perks.magMul * sim.perks.dmgMul * peelMag);
        const bounce = sim.def.id === "peel" ? peelBounceCountFromAD(sim.AD, sim.perks.adMul) : 0;
        const skillText = (sim.def.skillDesc ? sim.def.skillDesc(sim) : "—");
        const peelPower = (sim.def.id === "peel") ? Math.round(peelBuffPower(sim) * 100) : 0;

        return { level: sim.level, adLow, adHigh, as, magic, manaHit: sim.manaOnHit, bounce, skillText, peelPower };
      };
      const resetFastBtn = () => {
        if (!fastBtn) return;
        fastBtn.disabled = true;
        fastBtn.textContent = "Fast Upgrade (X)";
        fastBtn.title = "";
      };
      resetFastBtn();

      if(this.gameOver){
        info.innerHTML = `
          <div class="selRow"><div class="k">Status</div><div class="v"><b>GAME OVER</b></div></div>
          <div class="selRow"><div class="k">Kills</div><div class="v">${this.totalKills}</div></div>
          <div class="selRow"><div class="k">Top 10</div><div class="v">${(this.highKills||[]).join(", ")}</div></div>
        `;
        upBtn.disabled=true;
        upBtn.title="";
        sellBtn.disabled=true;
        sellBtn.textContent="Sell (C)";
        sellBtn.classList.remove("good");
        sellBtn.classList.add("danger");
        upBtn.textContent="Upgrade (Z)";
        return;
      }else{
        sellBtn.classList.remove("good");
        sellBtn.classList.add("danger");
      }

      // Enemy selected
      if(this.selectedEnemy){
        const e=this.selectedEnemy;
        const type = e.isBoss ? "Boss" : (CONTENT_REGISTRY.enemies.get(e.typeId)?.name ?? e.typeId);
        const modifiers = listEnemyModifiers(e);
        const modifier = modifiers[0] || null;
        const modifierLine = modifier
          ? `<div class="selRow"><div class="k">Modifier</div><div class="v">${modifier.name}</div></div>`
          : "";
        let bossSkillLines = "";
        let bossNextLine = "";
        if (e.isBoss && e.bossSkills) {
          const skills = Object.values(e.bossSkills).filter(s => s.active);
          const nextSkill = this.getBossNextSkill(e) || skills[0];
          if (nextSkill) {
            const nextInfo = BOSS_SKILL_INFO[nextSkill.id] || { name: nextSkill.name, color: "rgba(168,85,247,0.85)" };
            bossNextLine = `<div class="selRow"><div class="k">Next Skill</div><div class="v"><span style="color:${nextInfo.color}">■</span> ${nextInfo.name}</div></div>`;
          }

          for (const s of skills) {
            const info = BOSS_SKILL_INFO[s.id] || { name: s.name, color: "rgba(168,85,247,0.85)" };
            const remain = Math.max(0, s.timer).toFixed(1);
            const ready = (s.timer <= 0) ? "ready" : `${remain}s`;
            const pct = Math.round(clamp(1 - (s.timer || 0) / s.cd, 0, 1) * 100);
            bossSkillLines += `<div class="selRow"><div class="k"><span style="color:${info.color}">■</span> ${info.name}</div><div class="v">${pct}% (${ready})</div></div>`;
          }
        }
        const bossLastLine = (e.isBoss && e.lastBossSkill)
          ? `<div class="selRow"><div class="k">Last Skill</div><div class="v">${e.lastBossSkill}</div></div>`
          : "";
        const skillStatusLine = (e.isBoss)
          ? (() => {
              const debuffed = (e.poisonStacks > 0) || (e.slowPct > 0.2) || (e.frostbiteTime > 0) || (e.frostbiteDotTime > 0);
              const cleanse = debuffed ? "ready" : "needs debuff";
              const heal = (e.hp < e.maxHP) ? "ready" : "full hp";
              const summon = "ready";
              return `<div class="selRow"><div class="k">Skills</div><div class="v">Cleanse: ${cleanse} • Heal: ${heal} • Summon: ${summon}</div></div>`;
            })()
          : "";
        const modifierDescLine = modifier
          ? `<div class="selHint"><b>Modifier</b>: ${modifier.desc}</div>`
          : "";
        const bossDescLine = (e.isBoss) ? `<div class="selHint"><b>Boss Skills</b>: Cleanse (removes debuffs), Heal (recovers HP), Summon (spawns minions).</div>` : "";
        const armorState = (e.armor <= 0.01)
          ? "X: BROKEN"
          : `X:${Math.round(e.armorShredFlat)}`;

        info.innerHTML = `
          <div class="selRow"><div class="k">Enemy</div><div class="v">${type}</div></div>
          <div class="selRow"><div class="k">HP</div><div class="v">${formatCompact(e.hp)} / ${formatCompact(e.maxHP)}</div></div>
          <div class="selRow"><div class="k">Armor</div><div class="v">${e.armor.toFixed(0)} (${armorState})</div></div>
          <div class="selRow"><div class="k">Speed</div><div class="v">${(e.rootTime > 0 ? 0 : (e.baseSpeed*(1-e.slowPct))).toFixed(2)}</div></div>
          <div class="selRow"><div class="k">Slow</div><div class="v">%${Math.round(e.slowPct*100)} / ${e.slowTime.toFixed(1)}s</div></div>
          <div class="selRow"><div class="k">Root</div><div class="v">${e.rootTime > 0 ? `${e.rootTime.toFixed(1)}s` : "No"}</div></div>
          <div class="selRow"><div class="k">Poison</div><div class="v">${Math.round(e.poisonStacks)} stack</div></div>
          ${modifierLine}
          ${bossNextLine}
          ${bossSkillLines}
          ${bossLastLine}
          ${skillStatusLine}
          <div class="selRow"><div class="k">Wealth</div><div class="v">${formatCompact(e.wealth)}</div></div>
          <div class="selRow"><div class="k">Incoming(est)</div><div class="v">${formatCompact(e.incomingEstimate)}</div></div>
          ${modifierDescLine}
          ${bossDescLine}
        `;
        upBtn.disabled=true; upBtn.textContent="Upgrade (Z)"; upBtn.title="";
        resetFastBtn();
        sellBtn.disabled=true; sellBtn.textContent="Sell (C)";
        return;
      }

      // Tower selected
      if(this.selectedTowerInstance){
        const t=this.selectedTowerInstance;
        const canUp=t.canUpgrade();
        const cost=canUp ? t.upgradeCost() : null;
        const refund=Math.round(t.spentGold*0.50);
        const fastCost = canUp ? calcFastUpgradeCost(t) : null;
        const totalDamage = this.towers.reduce((sum, tw) => sum + (tw.damageDealt || 0), 0);
        const dmgPct = totalDamage > 0 ? (t.damageDealt / totalDamage) * 100 : 0;
        const isPeel = t.def.id === "peel";
        const baseView = buildSimTowerState(t, 0, null);
        const uplinkCastsLine = isPeel
          ? `<div class="selRow"><div class="k">Uplink Casts (Wave)</div><div class="v">${this.getPeelUplinkCasts(this.currentWave)}</div></div>`
          : ``;
        const peelBuffs = t.peelBuffs ? Object.entries(t.peelBuffs).filter(([, b]) => b.time > 0) : [];
        const peelBuffLine = peelBuffs.length
          ? `<div class="selRow"><div class="k">Peel Buffs</div><div class="v">${peelBuffs.map(([k,b]) => {
              const info = PEEL_BUFF_INFO[k] || { name: k.toUpperCase() };
              const pct = (k === "purge") ? "" : ` +${Math.round((b.power||0)*100)}%`;
              return `${info.name}${pct} (${b.time.toFixed(1)}s)`;
            }).join(" • ")}</div></div>`
          : ``;
        const baseSkillTextRaw = baseView?.skillText || "—";
        const autoAttackText = t.def.autoAttackDesc || "—";
        const skillText = baseSkillTextRaw.replaceAll("\n","<br/>");
        const prestigeText = t.def.prestige ? `${t.def.prestige.name}: ${t.def.prestige.desc}` : "—";

        const primaryManaLine = (t.maxMana>0)
          ? `${t.mana.toFixed(0)}/${t.maxMana}`
          : "—";

        const prestigeManaLine = (t.level>=CFG.PRESTIGE_LEVEL && t.prestigeMaxMana>0)
          ? `${t.prestigeMana.toFixed(0)}/${t.prestigeMaxMana} (${(t.prestigeActive>0? `ACTIVE ${t.prestigeActive.toFixed(1)}s` : "ready in ~"+Math.max(0, (t.prestigeMaxMana - t.prestigeMana)/(t.prestigeMaxMana/CFG.PRESTIGE_RECHARGE_TIME_SEC)).toFixed(0)+"s")})`
          : "";
        const damageSummary = `${formatCompact(t.damageDealt)} / ${t.kills} (${dmgPct.toFixed(1)}%)`;

        let specialSummary = "";
        if (t.specialUpgrades && t.specialUpgrades.length) {
          const sorted = [...t.specialUpgrades].sort((a,b)=>a.tier-b.tier);
          specialSummary = `
            <div class="selUpgrades">
              <div class="selUpgradesTitle">Special Upgrades</div>
              ${sorted.map(u => `
                <div class="selUpgradeItem rarity-${u.rarityId || "common"}">
                  <div class="selUpgradeTier">Tier ${u.tier}</div>
                  <div class="selUpgradeText">${u.title}</div>
                </div>
              `).join("")}
            </div>
          `;
        }

        const levelClass = (t.level >= CFG.PRESTIGE_LEVEL)
          ? "selTowerLevel selTowerLevelPrestige"
          : (t.level === CFG.TOWER_MAX_LEVEL ? "selTowerLevel selTowerLevelMax" : "selTowerLevel");
        const nameClass = (t.level >= CFG.PRESTIGE_LEVEL)
          ? "selTowerName selTowerNamePrestige"
          : (t.level === CFG.TOWER_MAX_LEVEL ? "selTowerName selTowerNameMax" : "selTowerName");
        const secondaryClass = (t.def.id === "sniper" && (t.secondaryLevel ?? 0) >= 100)
          ? "selTowerSecondary selTowerSecondaryOver"
          : "selTowerSecondary";
        const fastTarget = Math.min(CFG.TOWER_MAX_LEVEL, (Math.floor(t.level / 5) + 1) * 5);
        const fastSteps = Math.max(0, fastTarget - t.level);
        const hoverSpecial = (isModalOpen() && this.hoverSpecialChoice) ? this.hoverSpecialChoice : null;
        const hoverUpgrade = canUp && !!this.uiHover?.upgrade;
        const hoverFast = canUp && !!this.uiHover?.fast;
        const previewSteps = hoverSpecial
          ? 0
          : (hoverUpgrade
          ? 1
          : (hoverFast && fastSteps > 0 ? fastSteps : 0));
        const previewView = (hoverSpecial || (canUp && previewSteps > 0))
          ? buildSimTowerState(t, previewSteps, hoverSpecial)
          : null;
        const levelPreview = (previewView && baseView && (previewView.level - baseView.level) !== 0)
          ? `<span class="selPlus"> (+${previewView.level - baseView.level})</span>`
          : "";
        const compactSigned = (n) => `${n >= 0 ? "+" : "-"}${formatCompact(Math.abs(n))}`;
        const adDiffLow = (previewView && baseView) ? (previewView.adLow - baseView.adLow) : 0;
        const adDiffHigh = (previewView && baseView) ? (previewView.adHigh - baseView.adHigh) : 0;
        const adPreview = (previewView && baseView && t.def.id !== "peel" && (adDiffLow !== 0 || adDiffHigh !== 0))
          ? `<span class="selPlus"> (${compactSigned(adDiffLow)}-${compactSigned(adDiffHigh)})</span>`
          : "";
        const bouncePreview = (previewView && baseView && t.def.id === "peel" && (previewView.bounce - baseView.bounce) !== 0)
          ? `<span class="selPlus"> (+${previewView.bounce - baseView.bounce})</span>`
          : "";
        const asPreview = (previewView && baseView && Math.abs(previewView.as - baseView.as) > 0.0001)
          ? `<span class="selPlus"> (+${(previewView.as - baseView.as).toFixed(2)})</span>`
          : "";
        const magicPreview = (previewView && baseView && (previewView.magic - baseView.magic) !== 0)
          ? `<span class="selPlus"> (+${previewView.magic - baseView.magic})</span>`
          : "";
        const manaHitPreview = (previewView && baseView && Math.abs(previewView.manaHit - baseView.manaHit) > 0.0001)
          ? `<span class="selPlus"> (+${(previewView.manaHit - baseView.manaHit).toFixed(2)})</span>`
          : "";
        const adValue = (t.def.id === "peel")
          ? `${baseView?.bounce ?? t.getBounceCount()}${bouncePreview}`
          : `${formatCompact(baseView?.adLow ?? 0)}-${formatCompact(baseView?.adHigh ?? 0)}${adPreview}`;
        const asValue = `${(baseView?.as ?? t.AS).toFixed(2)}${asPreview}`;
        const magicValue = `${baseView?.magic ?? Math.round(t.magicBonus * t.perks.magMul * t.perks.dmgMul * t.peelMul("mag"))}${magicPreview}`;
        const manaHitValue = `${(baseView?.manaHit ?? t.manaOnHit).toFixed(2)}${manaHitPreview}`;
        const peelPowerPreview = (isPeel && previewView && baseView && (previewView.peelPower - baseView.peelPower) !== 0)
          ? `<span class="selPlus"> (+${previewView.peelPower - baseView.peelPower}%)</span>`
          : "";
        const peelPowerLine = isPeel
          ? `<div class="selRow"><div class="k">Buff Power</div><div class="v">+${baseView?.peelPower ?? Math.round(peelBuffPower(t)*100)}%${peelPowerPreview}</div></div>`
          : ``;
        const magePrestigeBuffLine = (t.def.id === "mage" && t.level >= CFG.PRESTIGE_LEVEL)
          ? (() => {
              const magic = Math.max(0, (t.magicBonus || 0) * (t.perks?.magMul ?? 1) * t.peelMul("mag"));
              const auraMul = magePrestigeAuraMulFromMagic(magic);
              const auraRange = t.range + magePrestigeAuraRangeBonusFromMagic(magic);
              return `<div class="selHint"><b>Mage Prestige Buff</b>: Mana x${auraMul.toFixed(2)} in ${auraRange.toFixed(2)} range.</div>`;
            })()
          : ``;
        const buildSkillInlinePreview = (towerId, baseRaw, previewRaw) => {
          if (!previewRaw || previewRaw === baseRaw) return "";
          const parts = [];
          if (towerId === "archer") {
            const bx = /x(\d+(?:\.\d+)?)/.exec(baseRaw);
            const px = /x(\d+(?:\.\d+)?)/.exec(previewRaw);
            if (bx && px) {
              const b = Number(bx[1]);
              const p = Number(px[1]);
              if (Number.isFinite(b) && Number.isFinite(p) && Math.abs(p - b) > 0.0001) {
                return `<span class="skillPreviewInline">(x${p.toFixed(2)})</span>`;
              }
            }
            return "";
          }
          if (towerId === "mage") {
            const b = /(\d+)\s+jumps\s+in\s+([\d.]+)\s+range[\s\S]*x([\d.]+)/i.exec(baseRaw);
            const p = /(\d+)\s+jumps\s+in\s+([\d.]+)\s+range[\s\S]*x([\d.]+)/i.exec(previewRaw);
            if (b && p) {
              const dJ = Number(p[1]) - Number(b[1]);
              const dR = Number(p[2]) - Number(b[2]);
              const dM = Number(p[3]) - Number(b[3]);
              if (dJ !== 0) parts.push(`Chains +${dJ}`);
              if (Math.abs(dR) > 0.0001) parts.push(`Radius +${dR.toFixed(2)}`);
              if (Math.abs(dM) > 0.0001) parts.push(`Jump x +${dM.toFixed(2)}`);
            }
          } else if (towerId === "breaker") {
            const b = /in\s+([\d.]+)\s+radius[\s\S]*Armor Shred\s+(\d+)/i.exec(baseRaw);
            const p = /in\s+([\d.]+)\s+radius[\s\S]*Armor Shred\s+(\d+)/i.exec(previewRaw);
            if (b && p) {
              const dRadius = Number(p[1]) - Number(b[1]);
              const dShred = Number(p[2]) - Number(b[2]);
              if (Math.abs(dRadius) > 0.0001) parts.push(`Radius +${dRadius.toFixed(2)}`);
              if (dShred !== 0) parts.push(`Armor Shred +${dShred}`);
            }
          } else if (towerId === "blizzard") {
            const b = /(\d+)% slow for ([\d.]+)s[\s\S]*?(\d+) magic damage/i.exec(baseRaw);
            const p = /(\d+)% slow for ([\d.]+)s[\s\S]*?(\d+) magic damage/i.exec(previewRaw);
            if (b && p) {
              const dSlow = Number(p[1]) - Number(b[1]);
              const dDur = Number(p[2]) - Number(b[2]);
              const dDmg = Number(p[3]) - Number(b[3]);
              if (dSlow !== 0) parts.push(`Slow +${dSlow}%`);
              if (Math.abs(dDur) > 0.0001) parts.push(`Duration +${dDur.toFixed(2)}s`);
              if (dDmg !== 0) parts.push(`Pulse DMG +${dDmg}`);
            }
          } else if (towerId === "poison") {
            const b = /\+(\d+)[\s\S]*?x([\d.]+)[\s\S]*?DOT\/stack:\s*([\d.]+)/i.exec(baseRaw);
            const p = /\+(\d+)[\s\S]*?x([\d.]+)[\s\S]*?DOT\/stack:\s*([\d.]+)/i.exec(previewRaw);
            if (b && p) {
              const dStacks = Number(p[1]) - Number(b[1]);
              const dMult = Number(p[2]) - Number(b[2]);
              const dTick = Number(p[3]) - Number(b[3]);
              if (Math.abs(dTick) > 0.0001) parts.push(`DOT/stack +${dTick.toFixed(1)}`);
              if (dStacks !== 0) parts.push(`Surge stacks +${dStacks}`);
              if (Math.abs(dMult) > 0.0001) parts.push(`DOT x +${dMult.toFixed(2)}`);
            }
          } else if (towerId === "peel") {
            const dMagic = (previewView && baseView) ? (previewView.magic - baseView.magic) : 0;
            if (dMagic !== 0) parts.push(`Magic +${dMagic}`);
            const dBuff = (previewView && baseView) ? (previewView.peelPower - baseView.peelPower) : 0;
            if (dBuff !== 0) parts.push(`Buff Power +${dBuff}%`);
          }
          return parts.length ? `<span class="skillPreviewInline">(${parts.join(", ")})</span>` : "";
        };

        let skillTextWithPreview = skillText;
        let skillPreviewSlot = "&nbsp;";
        if (previewView && baseView) {
          const previewSkillRaw = previewView.skillText || "";
          const inlinePreview = buildSkillInlinePreview(t.def.id, baseSkillTextRaw, previewSkillRaw);
          if (inlinePreview) {
            if (t.def.id === "archer") {
              const baseX = /x(\d+(?:\.\d+)?)/.exec(baseSkillTextRaw);
              if (baseX) {
                const oldTok = `x${baseX[1]}`;
                const newTok = `x${baseX[1]} ${inlinePreview}`;
                skillTextWithPreview = skillText.replace(oldTok, newTok);
              }
            } else {
              skillPreviewSlot = inlinePreview;
            }
          }
        }

        info.innerHTML = `
          <div class="selRow"><div class="k">Tower</div><div class="v"><span class="${nameClass}">${t.def.name}</span></div></div>
          <div class="selRow"><div class="k">Level</div><div class="v"><span class="${levelClass}">${t.level}</span>${levelPreview}</div></div>
          ${t.def.id==="sniper" ? `<div class="selRow"><div class="k">Secondary Lv</div><div class="v"><span class="${secondaryClass}">${t.secondaryLevel ?? 0}</span></div></div>` : ``}
          <div class="selRow"><div class="k">${t.def.id === "peel" ? "Bounce" : "AD"}</div><div class="v">${adValue}</div></div>
          <div class="selRow"><div class="k">AS</div><div class="v">${asValue}</div></div>
          <div class="selRow"><div class="k">Magic</div><div class="v">${magicValue}</div></div>
          ${peelPowerLine}
          ${uplinkCastsLine}
          <div class="selRow"><div class="k">Mana</div><div class="v">${primaryManaLine}</div></div>
          <div class="selRow"><div class="k">Mana/Hit</div><div class="v">${manaHitValue}</div></div>
          <div class="selRow"><div class="k">Damage / Kills</div><div class="v">${damageSummary}</div></div>
          ${t.level>=CFG.PRESTIGE_LEVEL ? `<div class="selRow"><div class="k">Prestige Mana</div><div class="v">${prestigeManaLine}</div></div>` : ``}
          ${peelBuffLine}

          <div class="selHint"><b>Auto Attack</b>: ${autoAttackText}</div>
          <div class="selHint"><b>${t.def.skillName}</b>: ${skillTextWithPreview}<span class="skillPreviewSlot">${skillPreviewSlot}</span></div>
          ${t.level>=CFG.PRESTIGE_LEVEL ? `<div class="selHint"><b>Prestige</b>: ${prestigeText}</div>` : ``}
          ${magePrestigeBuffLine}
          ${specialSummary}
        `;

        upBtn.disabled = (!canUp) || (this.gold < cost) || isModalOpen();
        upBtn.textContent = canUp ? `Upgrade (Z) ${cost}` : "MAX";
        upBtn.title = "";
        if (fastBtn) {
          const canFast = !!fastCost && this.gold >= fastCost && !isModalOpen();
          fastBtn.disabled = !canFast;
          fastBtn.textContent = fastCost ? `Fast Upgrade (X) ${fastCost}` : "Fast Upgrade (X)";
          fastBtn.title = "";
        }
        sellBtn.disabled = isModalOpen();
        sellBtn.textContent = `Sell (C) +${refund}`;
        return;
      }

      // Only tower selected from shop
      if(this.selectedTowerDef){
        const d=this.selectedTowerDef;
        const b=d.base;
        const autoAttackText = d.autoAttackDesc || "—";
        const desc=(d.skillDesc ? d.skillDesc({level:1, magicBonus:d.base.MD, perks:{magMul:1, dmgMul:1}}) : "—").replaceAll("\n","<br/>");
        const manaLine = (d.skillManaCost>0) ? `${d.skillManaCost}` : (d.id==="sniper" ? "Carepackage" : "—");
        const isPeel = d.id === "peel";
        const baseBounce = isPeel ? peelBounceCountFromAD(b.AD, 1) : 0;
        const adLine = isPeel
          ? `<div class="selRow"><div class="k">Bounce</div><div class="v">${baseBounce}</div></div>`
          : `<div class="selRow"><div class="k">AD</div><div class="v">${formatCompact(b.AD[0])}-${formatCompact(b.AD[1])}</div></div>`;
        const peelPowerLine = isPeel
          ? `<div class="selRow"><div class="k">Buff Power</div><div class="v">+${Math.round(peelBuffPower({ magicBonus: b.MD, perks:{ magMul:1 } })*100)}%</div></div>`
          : ``;
        info.innerHTML = `
          <div class="selRow"><div class="k">Tower</div><div class="v"><b>${d.name}</b></div></div>
          <div class="selRow"><div class="k">Cost</div><div class="v">${d.cost}</div></div>
          ${adLine}
          <div class="selRow"><div class="k">AS</div><div class="v">${b.AS.toFixed(2)}</div></div>
          <div class="selRow"><div class="k">Range</div><div class="v">${b.Range.toFixed(2)}</div></div>
          <div class="selRow"><div class="k">Crit</div><div class="v">${(b.CrC*100).toFixed(1)}% / x${b.CrD.toFixed(2)}</div></div>
          <div class="selRow"><div class="k">Magic</div><div class="v">${b.MD}</div></div>
          ${peelPowerLine}
          <div class="selRow"><div class="k">Skill Mana</div><div class="v">${manaLine}</div></div>
          <div class="selRow"><div class="k">Mana Regen</div><div class="v">${b.MaR.toFixed(1)}/s</div></div>
          <div class="selRow"><div class="k">Mana/Hit</div><div class="v">${b.manaOnHit.toFixed(2)}</div></div>
          <div class="selRow"><div class="k">ArP</div><div class="v">${(b.ArP*100).toFixed(0)}%</div></div>
          <div class="selRow"><div class="k">MaP</div><div class="v">${b.MaP}</div></div>
          <div class="selHint"><b>Auto Attack</b>: ${autoAttackText}</div>
          <div class="selHint"><b>${d.skillName}</b>: ${desc}</div>
        `;
        upBtn.disabled=true; upBtn.textContent="Upgrade (Z)"; upBtn.title="";
        resetFastBtn();
        sellBtn.disabled=true; sellBtn.textContent="Sell (C)";
        return;
      }

      info.textContent="—";
      upBtn.disabled=true; upBtn.textContent="Upgrade (Z)"; upBtn.title="";
      resetFastBtn();
      sellBtn.disabled=true; sellBtn.textContent="Sell (C)";
    }
    loop(){
      const t=now();
      const dt=clamp(t-this.lastT,0,0.05);
      this.lastT=t;
      const perfEnabled = !!window.__armtdPerf;
      const perfHud = this.uiAdapter?.refs?.perfHud || null;
      if (perfHud) perfHud.style.display = perfEnabled ? "block" : "none";
      const perfFrameStart = perfEnabled ? performance.now() : 0;
      let perfStart = 0;

      this.resizeCanvasToDisplaySize();

      if (perfEnabled) perfStart = performance.now();
      this.update(dt);
      if (perfEnabled) this._perfAcc.updateMs += (performance.now() - perfStart);

      if (perfEnabled) perfStart = performance.now();
      this.draw();
      if (perfEnabled) this._perfAcc.drawMs += (performance.now() - perfStart);

      this._uiRefreshTimer += dt;
      if (this._uiDirty && this._uiRefreshTimer >= this._uiRefreshInterval) {
        if (perfEnabled) perfStart = performance.now();
        this.refreshUI(true);
        if (perfEnabled) this._perfAcc.uiMs += (performance.now() - perfStart);
      }

      if (perfEnabled) {
        const acc = this._perfAcc;
        acc.sec += dt;
        acc.frames += 1;
        acc.frameMs += (performance.now() - perfFrameStart);
        if (acc.sec >= 1.0) {
          const inv = 1 / Math.max(1, acc.frames);
          const summary = `fps:${(acc.frames / acc.sec).toFixed(1)} frame:${(acc.frameMs * inv).toFixed(2)}ms update:${(acc.updateMs * inv).toFixed(2)}ms draw:${(acc.drawMs * inv).toFixed(2)}ms ui:${(acc.uiMs * inv).toFixed(2)}ms`;
          console.debug(
            `[PERF] ${summary}`
          );
          if (perfHud) perfHud.textContent = summary;
          acc.sec = 0;
          acc.frames = 0;
          acc.frameMs = 0;
          acc.updateMs = 0;
          acc.drawMs = 0;
          acc.uiMs = 0;
        }
      } else if (this._perfAcc.frames > 0) {
        if (perfHud) perfHud.textContent = "";
        this._perfAcc.sec = 0;
        this._perfAcc.frames = 0;
        this._perfAcc.frameMs = 0;
        this._perfAcc.updateMs = 0;
        this._perfAcc.drawMs = 0;
        this._perfAcc.uiMs = 0;
      }

      requestAnimationFrame(()=>this.loop());
    }
  }

  // =========================================================
  // Modal logic
  // =========================================================
  
export { Game, GAME_VERSION, RUN_SAVE_SCHEMA };

import { CONTENT_REGISTRY } from "./content_registry.js";

const PROGRESSION_SCHEMA = 1;
const PROGRESSION_KEY = "armtd_progression_v1";

function clampInt(v, min = 0, fallback = 0){
  const n = Number(v);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.floor(n));
}

function cloneBoolMap(raw){
  const out = {};
  if (!raw || typeof raw !== "object") return out;
  for (const [k, v] of Object.entries(raw)) {
    out[String(k)] = !!v;
  }
  return out;
}

function createDefaultProgressionState(){
  return {
    schema: PROGRESSION_SCHEMA,
    updatedAt: Date.now(),
    unlocks: {
      maps: { "0": true },
      codex: {},
      towers: {}
    },
    stats: {
      campaignClears: 0,
      maxClearedMap: 0
    }
  };
}

function normalizeProgressionState(raw){
  const base = createDefaultProgressionState();
  if (!raw || typeof raw !== "object") return base;
  if (clampInt(raw.schema, 0, 0) !== PROGRESSION_SCHEMA) return base;
  base.updatedAt = clampInt(raw.updatedAt, 0, Date.now());
  const unlocks = raw.unlocks && typeof raw.unlocks === "object" ? raw.unlocks : {};
  base.unlocks.maps = cloneBoolMap(unlocks.maps);
  base.unlocks.codex = cloneBoolMap(unlocks.codex);
  base.unlocks.towers = cloneBoolMap(unlocks.towers);
  base.unlocks.maps["0"] = true;
  const stats = raw.stats && typeof raw.stats === "object" ? raw.stats : {};
  base.stats.campaignClears = clampInt(stats.campaignClears, 0, 0);
  base.stats.maxClearedMap = clampInt(stats.maxClearedMap, 0, 0);
  return base;
}

function readProgressionState(){
  try {
    const raw = localStorage.getItem(PROGRESSION_KEY);
    if (!raw) return createDefaultProgressionState();
    return normalizeProgressionState(JSON.parse(raw));
  } catch (_) {
    return createDefaultProgressionState();
  }
}

function writeProgressionState(state){
  try {
    const safe = normalizeProgressionState(state);
    safe.updatedAt = Date.now();
    localStorage.setItem(PROGRESSION_KEY, JSON.stringify(safe));
  } catch (_) {}
}

function applyCampaignClearToProgression(state, payload = {}){
  const out = normalizeProgressionState(state);
  const mapIndex = clampInt(payload.mapIndex, 0, 0);
  const stars = payload.stars && typeof payload.stars === "object" ? payload.stars : {};
  out.stats.campaignClears += 1;
  out.stats.maxClearedMap = Math.max(out.stats.maxClearedMap, mapIndex);
  if (!!stars.star1) {
    const nextMap = mapIndex + 1;
    const maxCard = Math.max(0, clampInt(CONTENT_REGISTRY.maps.campaignCardCount, 1, 1) - 1);
    if (nextMap <= maxCard) out.unlocks.maps[String(nextMap)] = true;
  }
  out.updatedAt = Date.now();
  return out;
}

function isMapCardUnlockedByProgression(mapIndex, mapProgress, progressionState){
  const idx = clampInt(mapIndex, 0, 0);
  if (idx <= 0) return true;
  const progression = normalizeProgressionState(progressionState);
  const direct = progression.unlocks.maps[String(idx)];
  if (direct === true) return true;
  if (direct === false) return false;
  const prev = mapProgress?.maps?.[idx - 1];
  return !!prev?.stars?.star1;
}

function isCodexEntryUnlockedByProgression(codexId, progressionState){
  const key = String(codexId || "");
  if (!key) return false;
  const progression = normalizeProgressionState(progressionState);
  const value = progression.unlocks.codex[key];
  if (value === false) return false;
  return true;
}

export {
  PROGRESSION_SCHEMA,
  PROGRESSION_KEY,
  createDefaultProgressionState,
  normalizeProgressionState,
  readProgressionState,
  writeProgressionState,
  applyCampaignClearToProgression,
  isMapCardUnlockedByProgression,
  isCodexEntryUnlockedByProgression
};

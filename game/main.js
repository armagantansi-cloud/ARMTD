import { Game, GAME_VERSION } from "./game.js";
import { initUI } from "./ui.js";
import { SFX } from "./audio.js";
import { GameMap } from "./map.js";
import { CONTENT_REGISTRY } from "./content_registry.js";
import {
  KEYBIND_DEFS,
  cloneSettings,
  defaultCodeForAction,
  formatKeyCode,
  loadSettings,
  saveSettings
} from "./preferences.js";

const RUN_SAVE_KEY = "armtd_run_save_v1";
const MAP_PROGRESS_KEY = "armtd_map_progress_v1";
const MAP_PROGRESS_SCHEMA = 1;
const MAP_CARD_COUNT = 9;
const MAP_PAGE_SIZE = 5;
const MAP_EDITOR_W = 20;
const MAP_EDITOR_H = 15;
const MAP_EDITOR_MIN_PATH = 16;
const MAP_EDITOR_X_CODES = "abcdefghijklmnopqrst";
const MAP_EDITOR_Y_CODES = "0123456789!?#*=";
const CUSTOM_MAPS_KEY = "armtd_custom_maps_v1";
const CUSTOM_MAPS_SCHEMA = 1;
const PERSISTENT_STATS_KEY = "armtd_stats_lifetime_v1";
const HIGH_KILLS_KEY = "td_highkills_v2";
const RELEASE_RESET_KEY = "armtd_release_reset_0_2_33";
const START_GOLD_REWARD_KEY = "armtd_start_gold_reward_v1";
const START_GOLD_REWARD_BONUS = 30;
const MENU_CODEX_DRAW_ALPHA = 0.98;

const canvas = document.getElementById("c");
const bootVersionLabel = document.getElementById("menuVersionLabel");
if (bootVersionLabel) bootVersionLabel.textContent = `v${GAME_VERSION}`;
applyReleaseDataResetIfNeeded();
const game = new Game(canvas);

try {
  const arr = JSON.parse(localStorage.getItem(HIGH_KILLS_KEY) || "[]");
  game.highKills = Array.isArray(arr) ? arr : [];
} catch (_) {
  game.highKills = [];
}

let settings = cloneSettings(loadSettings());
applyAudioSettings();

let pauseMenuOpen = false;
let pauseResumeSpeed = 1.0;
let keybindCaptureAction = null;
let keybindCaptureHandler = null;
let confirmAcceptAction = null;
let dragState = null;
let mapEditorCodeMode = null;
let activeMenuCodexId = null;
let mapSelectPage = 0;
const mapEditorState = {
  tool: "path",
  dragPaint: false,
  grid: Array.from({ length: MAP_EDITOR_H }, () => Array.from({ length: MAP_EDITOR_W }, () => 0)),
  spawn: null,
  core: null,
  hover: null
};

const bodyEl = document.body;
const menuVersionLabel = document.getElementById("menuVersionLabel");
const menuPatchNotes = document.getElementById("menuPatchNotes");
const menuCodexPanel = document.getElementById("menuCodexPanel");
const menuCodexDetailBack = document.getElementById("menuCodexDetailBack");
const menuCodexDetailType = document.getElementById("menuCodexDetailType");
const menuCodexDetailTitle = document.getElementById("menuCodexDetailTitle");
const menuCodexDetailRows = document.getElementById("menuCodexDetailRows");
const menuCodexDetailNotes = document.getElementById("menuCodexDetailNotes");
const menuCodexDetailImage = document.getElementById("menuCodexDetailImage");
const menuCodexDetailCanvas = document.getElementById("menuCodexDetailCanvas");
const menuCodexDetailCloseBtn = document.getElementById("menuCodexDetailCloseBtn");
const menuCodexTabTowers = document.getElementById("menuCodexTabTowers");
const menuCodexTabMobs = document.getElementById("menuCodexTabMobs");
const menuCodexTabMods = document.getElementById("menuCodexTabMods");
const menuCodexPrevBtn = document.getElementById("menuCodexPrevBtn");
const menuCodexNextBtn = document.getElementById("menuCodexNextBtn");
const menuNewGameBtn = document.getElementById("menuNewGameBtn");
const menuContinueBtn = document.getElementById("menuContinueBtn");
const menuSettingsBtn = document.getElementById("menuSettingsBtn");
const menuStatsBtn = document.getElementById("menuStatsBtn");
const fullscreenHintBtn = document.getElementById("fullscreenHintBtn");
const mapSelectGrid = document.getElementById("mapSelectGrid");
const mapSelectPrevBtn = document.getElementById("mapSelectPrevBtn");
const mapSelectNextBtn = document.getElementById("mapSelectNextBtn");
const mapEditorOpenBtn = document.getElementById("mapEditorOpenBtn");
const customMapsOpenBtn = document.getElementById("customMapsOpenBtn");
const mapSelectBackBtn = document.getElementById("mapSelectBackBtn");
const customMapsBackBtn = document.getElementById("customMapsBackBtn");
const customMapsGrid = document.getElementById("customMapsGrid");
const mapEditorBackBtn = document.getElementById("mapEditorBackBtn");
const mapEditorCanvas = document.getElementById("mapEditorCanvas");
const mapEditorStatus = document.getElementById("mapEditorStatus");
const mapEditorToolPathBtn = document.getElementById("mapEditorToolPathBtn");
const mapEditorToolSpawnBtn = document.getElementById("mapEditorToolSpawnBtn");
const mapEditorToolCoreBtn = document.getElementById("mapEditorToolCoreBtn");
const mapEditorToolObstacleBtn = document.getElementById("mapEditorToolObstacleBtn");
const mapEditorToolEraseBtn = document.getElementById("mapEditorToolEraseBtn");
const mapEditorClearBtn = document.getElementById("mapEditorClearBtn");
const mapEditorExportBtn = document.getElementById("mapEditorExportBtn");
const mapEditorImportBtn = document.getElementById("mapEditorImportBtn");
const mapEditorPlayBtn = document.getElementById("mapEditorPlayBtn");
const mapEditorNameInput = document.getElementById("mapEditorNameInput");
const mapCodeBack = document.getElementById("mapCodeBack");
const mapCodeTitle = document.getElementById("mapCodeTitle");
const mapCodeSub = document.getElementById("mapCodeSub");
const mapCodeInput = document.getElementById("mapCodeInput");
const mapCodeCopyBtn = document.getElementById("mapCodeCopyBtn");
const mapCodeApplyBtn = document.getElementById("mapCodeApplyBtn");
const mapCodeCloseBtn = document.getElementById("mapCodeCloseBtn");

const settingsBack = document.getElementById("settingsBack");
const settingsCloseBtn = document.getElementById("settingsCloseBtn");
const settingsVolumeSlider = document.getElementById("settingsVolumeSlider");
const settingsVolumeValue = document.getElementById("settingsVolumeValue");
const settingsMuteBtn = document.getElementById("settingsMuteBtn");
const settingsResetKeybindsBtn = document.getElementById("settingsResetKeybindsBtn");
const settingsKeybindList = document.getElementById("settingsKeybindList");

const statsBack = document.getElementById("statsBack");
const statsCloseBtn = document.getElementById("statsCloseBtn");
const statsHardResetBtn = document.getElementById("statsHardResetBtn");
const statsSummaryGrid = document.getElementById("statsSummaryGrid");
const statsTowerRows = document.getElementById("statsTowerRows");

const confirmBack = document.getElementById("confirmBack");
const confirmTitle = document.getElementById("confirmTitle");
const confirmText = document.getElementById("confirmText");
const confirmCancelBtn = document.getElementById("confirmCancelBtn");
const confirmAcceptBtn = document.getElementById("confirmAcceptBtn");

const pauseMenuLayer = document.getElementById("pauseMenuLayer");
const pauseMenuPanel = document.getElementById("pauseMenuPanel");
const pauseMenuHandle = document.getElementById("pauseMenuHandle");
const pauseSaveQuitBtn = document.getElementById("pauseSaveQuitBtn");
const pauseSettingsBtn = document.getElementById("pauseSettingsBtn");
const pauseResumeBtn = document.getElementById("pauseResumeBtn");
game.onCampaignClear = handleCampaignClear;
game.onGameOverMainMenu = () => {
  if (!game.isCustomMapRun) {
    updateMapProgressMaxWave(game.mapIndex, game.getStatsSnapshot().maxWaveSeen);
  }
  closePauseMenuVisual();
  showMainMenu();
};

initUI(game, {
  getKeybinds: () => settings.keybinds,
  onMuteToggle: (muted) => {
    settings.audio.muted = !!muted;
    persistSettings(false);
    syncSettingsUI();
  },
  onPauseToggle: (ctx) => {
    if (isMainMenuOpen() || game.gameOver) return;
    if (pauseMenuOpen) {
      resumeFromPause(ctx);
      return;
    }
    openPauseMenu(ctx);
  },
  onClearSelection: () => {
    if (!pauseMenuOpen) return false;
    resumeFromPause(null);
    return true;
  }
});

bindMainMenu();
bindMenuCodex();
bindMapSelect();
bindMapEditor();
bindSettingsModal();
bindStatsModal();
bindConfirmModal();
bindPauseMenu();

if (menuVersionLabel) menuVersionLabel.textContent = `v${GAME_VERSION}`;
renderMenuPatchNotes();
updateContinueButton();
syncSettingsUI();
resetMapEditorBlank();
queueMicrotask(() => {
  showMainMenu();
});

function clamp(v, min, max){
  return Math.max(min, Math.min(max, v));
}

function isTextInputTarget(target){
  if (!(target instanceof Element)) return false;
  const tag = target.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || target.isContentEditable;
}

function applyReleaseDataResetIfNeeded(){
  try {
    const done = localStorage.getItem(RELEASE_RESET_KEY);
    if (done === "1") return;
    localStorage.removeItem(PERSISTENT_STATS_KEY);
    localStorage.removeItem(HIGH_KILLS_KEY);
    localStorage.removeItem(MAP_PROGRESS_KEY);
    localStorage.removeItem(RUN_SAVE_KEY);
    localStorage.setItem(RELEASE_RESET_KEY, "1");
  } catch (_) {}
}

function towerDefsPeelLast(){
  const order = ["archer", "mage", "blizzard", "breaker", "poison", "sniper", "peel"];
  const byId = CONTENT_REGISTRY.towers.byId;
  return order.map(id => byId.get(id)).filter(Boolean);
}

function getMapCatalog(){
  const firstMap = CONTENT_REGISTRY.maps.get(0);
  const secondMap = CONTENT_REGISTRY.maps.get(1);
  const firstName = firstMap?.name ? String(firstMap.name) : "Map 1";
  const secondName = secondMap?.name ? String(secondMap.name) : "Map 2";
  return [
    { id: 0, title: firstName, playable: true, mapIndex: 0, image: "assets/ARMTD_NEO.png" },
    { id: 1, title: secondName, playable: !!secondMap, mapIndex: secondMap ? 1 : null, image: "assets/ARTMTD_XENO.png" },
    { id: 2, title: "Template Map 3", playable: false, mapIndex: null, image: "" },
    { id: 3, title: "Template Map 4", playable: false, mapIndex: null, image: "" },
    { id: 4, title: "Template Map 5", playable: false, mapIndex: null, image: "" },
    { id: 5, title: "Template Map 6", playable: false, mapIndex: null, image: "" },
    { id: 6, title: "Template Map 7", playable: false, mapIndex: null, image: "" },
    { id: 7, title: "Template Map 8", playable: false, mapIndex: null, image: "" },
    { id: 8, title: "Template Map 9", playable: false, mapIndex: null, image: "" }
  ];
}

function createDefaultMapProgress(){
  return {
    schema: MAP_PROGRESS_SCHEMA,
    updatedAt: Date.now(),
    maps: Array.from({ length: MAP_CARD_COUNT }, () => ({
      maxWave: 0,
      stars: { star1: false, star2: false, star3: false }
    }))
  };
}

function normalizeMapProgress(raw){
  const base = createDefaultMapProgress();
  if (!raw || typeof raw !== "object") return base;
  if (Math.floor(Number(raw.schema) || 0) !== MAP_PROGRESS_SCHEMA) return base;
  const maps = Array.isArray(raw.maps) ? raw.maps : [];
  for (let i = 0; i < MAP_CARD_COUNT; i += 1) {
    const src = maps[i] && typeof maps[i] === "object" ? maps[i] : null;
    const maxWave = Math.max(0, Math.floor(Number(src?.maxWave) || 0));
    const starsRaw = src?.stars && typeof src.stars === "object" ? src.stars : {};
    base.maps[i] = {
      maxWave,
      stars: {
        star1: !!starsRaw.star1,
        star2: !!starsRaw.star2,
        star3: !!starsRaw.star3
      }
    };
  }
  return base;
}

function readMapProgress(){
  try {
    const raw = localStorage.getItem(MAP_PROGRESS_KEY);
    if (!raw) return createDefaultMapProgress();
    return normalizeMapProgress(JSON.parse(raw));
  } catch (_) {
    return createDefaultMapProgress();
  }
}

function writeMapProgress(data){
  try {
    const safe = normalizeMapProgress(data);
    safe.updatedAt = Date.now();
    localStorage.setItem(MAP_PROGRESS_KEY, JSON.stringify(safe));
  } catch (_) {}
}

function updateMapProgressMaxWave(mapCardIndex, wave){
  const idx = Math.max(0, Math.min(MAP_CARD_COUNT - 1, Math.floor(Number(mapCardIndex) || 0)));
  const maxWave = Math.max(0, Math.floor(Number(wave) || 0));
  const progress = readMapProgress();
  progress.maps[idx].maxWave = Math.max(progress.maps[idx].maxWave, maxWave);
  writeMapProgress(progress);
}

function normalizeCustomMapName(name){
  const raw = String(name || "").trim();
  if (!raw) return "Custom Map";
  return raw.slice(0, 48);
}

function createDefaultCustomMapsStore(){
  return {
    schema: CUSTOM_MAPS_SCHEMA,
    maps: []
  };
}

function normalizeCustomMapsStore(raw){
  const base = createDefaultCustomMapsStore();
  if (!raw || typeof raw !== "object") return base;
  if (Math.floor(Number(raw.schema) || 0) !== CUSTOM_MAPS_SCHEMA) return base;
  const rows = Array.isArray(raw.maps) ? raw.maps : [];
  base.maps = rows
    .filter(r => r && typeof r === "object")
    .map(r => ({
      id: String(r.id || `cm_${Date.now()}_${Math.floor(Math.random() * 10000)}`),
      name: normalizeCustomMapName(r.name),
      code: String(r.code || ""),
      lastPlayedAt: Math.max(0, Math.floor(Number(r.lastPlayedAt) || 0)),
      createdAt: Math.max(0, Math.floor(Number(r.createdAt) || 0))
    }))
    .filter(r => r.code.length > 0);
  return base;
}

function readCustomMapsStore(){
  try {
    const raw = localStorage.getItem(CUSTOM_MAPS_KEY);
    if (!raw) return createDefaultCustomMapsStore();
    return normalizeCustomMapsStore(JSON.parse(raw));
  } catch (_) {
    return createDefaultCustomMapsStore();
  }
}

function writeCustomMapsStore(data){
  try {
    localStorage.setItem(CUSTOM_MAPS_KEY, JSON.stringify(normalizeCustomMapsStore(data)));
  } catch (_) {}
}

function upsertPlayedCustomMap({ name, code }){
  const safeName = normalizeCustomMapName(name);
  const safeCode = String(code || "").trim();
  if (!safeCode) return;
  const store = readCustomMapsStore();
  const nowTs = Date.now();
  const idx = store.maps.findIndex(m => m.code === safeCode);
  if (idx >= 0) {
    store.maps[idx].name = safeName;
    store.maps[idx].lastPlayedAt = nowTs;
  } else {
    store.maps.unshift({
      id: `cm_${nowTs}_${Math.floor(Math.random() * 100000)}`,
      name: safeName,
      code: safeCode,
      lastPlayedAt: nowTs,
      createdAt: nowTs
    });
  }
  store.maps.sort((a, b) => (b.lastPlayedAt - a.lastPlayedAt) || (b.createdAt - a.createdAt));
  store.maps = store.maps.slice(0, 100);
  writeCustomMapsStore(store);
}

function formatPlayedAt(ts){
  if (!Number.isFinite(ts) || ts <= 0) return "Unknown";
  try {
    return new Date(ts).toLocaleString("en-US", {
      year: "numeric",
      month: "short",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit"
    });
  } catch (_) {
    return "Unknown";
  }
}

function handleCampaignClear(payload){
  if (payload?.isCustomMapRun) return;
  const idx = Math.max(0, Math.min(MAP_CARD_COUNT - 1, Math.floor(Number(payload?.mapIndex) || 0)));
  const stars = payload?.stars && typeof payload.stars === "object" ? payload.stars : {};
  const maxWave = Math.max(0, Math.floor(Number(payload?.maxWave) || 0));
  const progress = readMapProgress();
  const item = progress.maps[idx];
  item.maxWave = Math.max(item.maxWave, maxWave);
  item.stars.star1 = item.stars.star1 || !!stars.star1;
  item.stars.star2 = item.stars.star2 || !!stars.star2;
  item.stars.star3 = item.stars.star3 || !!stars.star3;
  writeMapProgress(progress);
}

function isMapUnlocked(mapIndex, progress){
  if (mapIndex <= 0) return true;
  const prev = progress.maps[mapIndex - 1];
  return !!prev?.stars?.star1;
}

function escapeHtml(text){
  return String(text || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll("\"", "&quot;")
    .replaceAll("'", "&#39;");
}

function getStarConditionText(starNo){
  if (starNo === 1) return "Clear wave 100 or higher.";
  if (starNo === 2) return "Clear wave 100+ without core HP loss.";
  return "Clear wave 100+ without buying Sniper Tower.";
}

function renderStarNode(starClass, lit, starNo){
  const done = lit ? `<span class="mapStarDone">Done</span>` : "";
  return `
    <span class="mapStarWrap ${starClass}">
      <span class="mapStar ${starClass} ${lit ? "lit" : ""}">★</span>
      <span class="mapStarTip">${escapeHtml(getStarConditionText(starNo))}${done}</span>
    </span>
  `;
}

function createEmptyEditorGrid(){
  return Array.from({ length: MAP_EDITOR_H }, () => Array.from({ length: MAP_EDITOR_W }, () => 0));
}

function cloneEditorGrid(grid){
  return Array.from({ length: MAP_EDITOR_H }, (_, y) => {
    const row = Array.isArray(grid?.[y]) ? grid[y] : [];
    return Array.from({ length: MAP_EDITOR_W }, (_, x) => {
      const v = Math.floor(Number(row[x]) || 0);
      if (v === 1 || v === 2) return v;
      return 0;
    });
  });
}

function resetMapEditorBlank(){
  mapEditorState.grid = createEmptyEditorGrid();
  mapEditorState.spawn = null;
  mapEditorState.core = null;
  mapEditorState.hover = null;
  mapEditorState.dragPaint = false;
  setMapEditorTool("path");
  if (mapEditorNameInput) mapEditorNameInput.value = "Custom Map";
  refreshMapEditorStatus();
  renderMapEditor();
}

function setMapEditorStatus(text, isError = false){
  if (!mapEditorStatus) return;
  mapEditorStatus.textContent = text || "";
  mapEditorStatus.style.color = isError ? "rgba(248,113,113,0.98)" : "rgba(187,247,208,0.96)";
}

function setMapEditorTool(tool){
  mapEditorState.tool = tool;
  const pairs = [
    [mapEditorToolPathBtn, "path"],
    [mapEditorToolSpawnBtn, "spawn"],
    [mapEditorToolCoreBtn, "core"],
    [mapEditorToolObstacleBtn, "obstacle"],
    [mapEditorToolEraseBtn, "erase"]
  ];
  for (const [btn, id] of pairs) {
    if (!btn) continue;
    btn.classList.toggle("active", id === tool);
  }
}

function mapEditorGetMetrics(){
  if (!mapEditorCanvas) return null;
  const rect = mapEditorCanvas.getBoundingClientRect();
  if (rect.width <= 2 || rect.height <= 2) return null;
  const dpr = window.devicePixelRatio || 1;
  const targetW = Math.max(2, Math.floor(rect.width * dpr));
  const targetH = Math.max(2, Math.floor(rect.height * dpr));
  if (mapEditorCanvas.width !== targetW || mapEditorCanvas.height !== targetH) {
    mapEditorCanvas.width = targetW;
    mapEditorCanvas.height = targetH;
  }
  const pad = Math.max(12, Math.floor(Math.min(targetW, targetH) * 0.03));
  const cell = Math.max(8, Math.floor(Math.min((targetW - pad * 2) / MAP_EDITOR_W, (targetH - pad * 2) / MAP_EDITOR_H)));
  const gridW = cell * MAP_EDITOR_W;
  const gridH = cell * MAP_EDITOR_H;
  const ox = Math.floor((targetW - gridW) * 0.5);
  const oy = Math.floor((targetH - gridH) * 0.5);
  return { rect, dpr, cell, gridW, gridH, ox, oy, targetW, targetH };
}

function mapEditorPointToCell(ev){
  const m = mapEditorGetMetrics();
  if (!m) return null;
  const px = (ev.clientX - m.rect.left) * m.dpr;
  const py = (ev.clientY - m.rect.top) * m.dpr;
  if (px < m.ox || py < m.oy || px >= m.ox + m.gridW || py >= m.oy + m.gridH) return null;
  const gx = Math.floor((px - m.ox) / m.cell);
  const gy = Math.floor((py - m.oy) / m.cell);
  if (gx < 0 || gy < 0 || gx >= MAP_EDITOR_W || gy >= MAP_EDITOR_H) return null;
  return { x: gx, y: gy };
}

function mapEditorApplyTool(cell){
  if (!cell) return;
  const { x, y } = cell;
  if (mapEditorState.tool === "path") {
    mapEditorState.grid[y][x] = 1;
    return;
  }
  if (mapEditorState.tool === "obstacle") {
    mapEditorState.grid[y][x] = 2;
    return;
  }
  if (mapEditorState.tool === "erase") {
    mapEditorState.grid[y][x] = 0;
    if (mapEditorState.spawn && mapEditorState.spawn.x === x && mapEditorState.spawn.y === y) mapEditorState.spawn = null;
    if (mapEditorState.core && mapEditorState.core.x === x && mapEditorState.core.y === y) mapEditorState.core = null;
    return;
  }
  if (mapEditorState.tool === "spawn") {
    mapEditorState.spawn = { x, y };
    return;
  }
  if (mapEditorState.tool === "core") {
    mapEditorState.core = { x, y };
  }
}

function mapEditorPathCount(){
  let total = 0;
  for (let y = 0; y < MAP_EDITOR_H; y += 1) {
    for (let x = 0; x < MAP_EDITOR_W; x += 1) {
      if (mapEditorState.grid[y][x] === 1) total += 1;
    }
  }
  return total;
}

function mapEditorIsPassable(x, y){
  if (x < 0 || y < 0 || x >= MAP_EDITOR_W || y >= MAP_EDITOR_H) return false;
  if (mapEditorState.grid[y][x] === 1) return true;
  if (mapEditorState.spawn && x === mapEditorState.spawn.x && y === mapEditorState.spawn.y) return true;
  if (mapEditorState.core && x === mapEditorState.core.x && y === mapEditorState.core.y) return true;
  return false;
}

function mapEditorConnected(){
  if (!mapEditorState.spawn || !mapEditorState.core) return false;
  const start = mapEditorState.spawn;
  const goal = mapEditorState.core;
  const q = [{ x: start.x, y: start.y }];
  const seen = new Set([`${start.x},${start.y}`]);
  const dirs = [[1, 0], [-1, 0], [0, 1], [0, -1]];
  while (q.length) {
    const cur = q.shift();
    if (cur.x === goal.x && cur.y === goal.y) return true;
    for (const [dx, dy] of dirs) {
      const nx = cur.x + dx;
      const ny = cur.y + dy;
      const key = `${nx},${ny}`;
      if (seen.has(key)) continue;
      if (!mapEditorIsPassable(nx, ny)) continue;
      seen.add(key);
      q.push({ x: nx, y: ny });
    }
  }
  return false;
}

function buildMapDefFromEditor(){
  if (!mapEditorState.spawn || !mapEditorState.core) return null;
  const grid = cloneEditorGrid(mapEditorState.grid);
  const spawn = { x: mapEditorState.spawn.x, y: mapEditorState.spawn.y };
  const core = { x: mapEditorState.core.x, y: mapEditorState.core.y };
  grid[spawn.y][spawn.x] = 1;
  grid[core.y][core.x] = 1;
  return {
    name: normalizeCustomMapName(mapEditorNameInput?.value || "Custom Map"),
    gridW: MAP_EDITOR_W,
    gridH: MAP_EDITOR_H,
    entrance: spawn,
    exit: core,
    grid,
    hazards: []
  };
}

function validateMapEditorState(){
  const issues = [];
  const pathCount = mapEditorPathCount();
  if (!mapEditorState.spawn) issues.push("Spawn is required.");
  if (!mapEditorState.core) issues.push("Core is required.");
  if (pathCount < MAP_EDITOR_MIN_PATH) {
    issues.push(`At least ${MAP_EDITOR_MIN_PATH} path cells required (${pathCount}).`);
  }
  if (mapEditorState.spawn && mapEditorState.core && mapEditorState.spawn.x === mapEditorState.core.x && mapEditorState.spawn.y === mapEditorState.core.y) {
    issues.push("Spawn and Core cannot be on the same tile.");
  }
  if (mapEditorState.spawn && mapEditorState.core && !mapEditorConnected()) {
    issues.push("Spawn and Core must be connected by passable tiles.");
  }
  const mapDef = buildMapDefFromEditor();
  if (mapDef) {
    const gameMap = new GameMap(mapDef);
    if (!Array.isArray(gameMap.path) || gameMap.path.length < 2) {
      issues.push("Path resolver could not build a valid route.");
    }
  }
  return {
    ok: issues.length === 0,
    issues,
    pathCount
  };
}

function refreshMapEditorStatus(){
  const v = validateMapEditorState();
  if (!v.ok) {
    setMapEditorStatus(v.issues[0], true);
    return v;
  }
  setMapEditorStatus(`Ready • Path cells: ${v.pathCount} • Playable route found.`, false);
  return v;
}

function renderMapEditor(){
  if (!mapEditorCanvas) return;
  const m = mapEditorGetMetrics();
  if (!m) return;
  const ctx = mapEditorCanvas.getContext("2d");
  if (!ctx) return;

  ctx.clearRect(0, 0, m.targetW, m.targetH);
  ctx.fillStyle = "rgba(2,6,23,0.96)";
  ctx.fillRect(0, 0, m.targetW, m.targetH);

  ctx.fillStyle = "rgba(125,211,252,0.88)";
  ctx.font = `${Math.max(10, Math.floor(m.cell * 0.34))}px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  for (let x = 0; x < MAP_EDITOR_W; x += 1) {
    const px = m.ox + x * m.cell + m.cell * 0.5;
    ctx.fillText(MAP_EDITOR_X_CODES[x], px, m.oy - Math.max(10, Math.floor(m.cell * 0.35)));
  }
  ctx.textAlign = "right";
  for (let y = 0; y < MAP_EDITOR_H; y += 1) {
    const py = m.oy + y * m.cell + m.cell * 0.5;
    ctx.fillText(MAP_EDITOR_Y_CODES[y], m.ox - Math.max(8, Math.floor(m.cell * 0.3)), py);
  }

  for (let y = 0; y < MAP_EDITOR_H; y += 1) {
    for (let x = 0; x < MAP_EDITOR_W; x += 1) {
      const px = m.ox + x * m.cell;
      const py = m.oy + y * m.cell;
      const cellType = mapEditorState.grid[y][x];
      const isPath = cellType === 1;
      const isObstacle = cellType === 2;
      ctx.fillStyle = isPath
        ? "rgba(56,189,248,0.32)"
        : (isObstacle ? "rgba(251,146,60,0.22)" : "rgba(15,23,42,0.78)");
      ctx.fillRect(px, py, m.cell, m.cell);
      ctx.strokeStyle = "rgba(148,163,184,0.25)";
      ctx.lineWidth = 1;
      ctx.strokeRect(px + 0.5, py + 0.5, m.cell - 1, m.cell - 1);
    }
  }

  const drawMarker = (pos, text, color) => {
    const px = m.ox + pos.x * m.cell;
    const py = m.oy + pos.y * m.cell;
    ctx.fillStyle = color;
    ctx.fillRect(px + 2, py + 2, m.cell - 4, m.cell - 4);
    ctx.fillStyle = "rgba(2,6,23,0.95)";
    ctx.font = `${Math.max(12, Math.floor(m.cell * 0.52))}px Rajdhani, sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(text, px + m.cell * 0.5, py + m.cell * 0.53);
  };

  if (mapEditorState.spawn) drawMarker(mapEditorState.spawn, "S", "rgba(74,222,128,0.95)");
  if (mapEditorState.core) drawMarker(mapEditorState.core, "C", "rgba(248,113,113,0.95)");

  if (mapEditorState.hover) {
    const px = m.ox + mapEditorState.hover.x * m.cell;
    const py = m.oy + mapEditorState.hover.y * m.cell;
    ctx.strokeStyle = "rgba(251,191,36,0.96)";
    ctx.lineWidth = 2;
    ctx.strokeRect(px + 1, py + 1, m.cell - 2, m.cell - 2);
  }
}

function encodeEditorMapCode(){
  if (!mapEditorState.spawn || !mapEditorState.core) throw new Error("Spawn and Core are required for export.");
  const tokens = [];
  tokens.push(`${MAP_EDITOR_X_CODES[mapEditorState.spawn.x]}${MAP_EDITOR_Y_CODES[mapEditorState.spawn.y]}S`);
  tokens.push(`${MAP_EDITOR_X_CODES[mapEditorState.core.x]}${MAP_EDITOR_Y_CODES[mapEditorState.core.y]}C`);
  for (let y = 0; y < MAP_EDITOR_H; y += 1) {
    for (let x = 0; x < MAP_EDITOR_W; x += 1) {
      if (mapEditorState.grid[y][x] === 1) {
        tokens.push(`${MAP_EDITOR_X_CODES[x]}${MAP_EDITOR_Y_CODES[y]}W`);
      } else if (mapEditorState.grid[y][x] === 2) {
        tokens.push(`${MAP_EDITOR_X_CODES[x]}${MAP_EDITOR_Y_CODES[y]}O`);
      }
    }
  }
  const mapName = normalizeCustomMapName(mapEditorNameInput?.value || "Custom Map");
  return `ARMTD1|N=${encodeURIComponent(mapName)}|D=${tokens.join(",")}`;
}

function parseMapCode(rawCode){
  const raw = String(rawCode || "").trim();
  if (!raw) throw new Error("Empty map code.");
  let mapName = "Custom Map";
  let dataPart = raw;

  if (raw.startsWith("ARMTD1|")) {
    const segments = raw.split("|").slice(1);
    for (const seg of segments) {
      const [k, ...rest] = seg.split("=");
      const value = rest.join("=");
      if (k === "N") {
        try { mapName = normalizeCustomMapName(decodeURIComponent(value || "")); } catch (_) {}
      }
      if (k === "D") dataPart = value || "";
    }
  } else if (raw.includes(":")) {
    dataPart = raw.slice(raw.indexOf(":") + 1);
  }

  const parts = dataPart.split(",").map(p => p.trim()).filter(Boolean);
  if (!parts.length) throw new Error("Invalid map code.");

  const nextGrid = createEmptyEditorGrid();
  let spawn = null;
  let core = null;

  for (const token of parts) {
    const m = token.match(/^([a-t])([0-9!?#*=])([scwo])$/i);
    if (!m) continue;
    const x = MAP_EDITOR_X_CODES.indexOf(String(m[1]).toLowerCase());
    const y = MAP_EDITOR_Y_CODES.indexOf(m[2]);
    if (x < 0 || y < 0) continue;
    const t = String(m[3]).toUpperCase();
    if (t === "S") spawn = { x, y };
    if (t === "C") core = { x, y };
    if (t === "W") nextGrid[y][x] = 1;
    if (t === "O") nextGrid[y][x] = 2;
  }

  if (!spawn || !core) throw new Error("Code must include both Spawn (S) and Core (C).");
  return { name: mapName, grid: nextGrid, spawn, core };
}

function decodeEditorMapCode(code){
  const raw = String(code || "").trim();
  const parsed = parseMapCode(raw);
  mapEditorState.grid = parsed.grid;
  mapEditorState.spawn = parsed.spawn;
  mapEditorState.core = parsed.core;
  if (mapEditorNameInput) mapEditorNameInput.value = normalizeCustomMapName(parsed.name);
}

function openMapCodeModal(mode, code = ""){
  mapEditorCodeMode = mode;
  if (!mapCodeBack) return false;
  if (mapCodeTitle) mapCodeTitle.textContent = mode === "import" ? "Import Map Code" : "Export Map Code";
  if (mapCodeSub) mapCodeSub.textContent = mode === "import"
    ? "Paste a map code and press Load."
    : "Copy and share this map code.";
  if (mapCodeInput) {
    mapCodeInput.value = code || "";
    mapCodeInput.readOnly = mode !== "import";
  }
  if (mapCodeCopyBtn) mapCodeCopyBtn.style.display = mode === "import" ? "none" : "";
  if (mapCodeApplyBtn) mapCodeApplyBtn.style.display = mode === "import" ? "" : "none";
  mapCodeBack.classList.remove("hidden");
  if (mapCodeInput) {
    mapCodeInput.focus();
    mapCodeInput.select();
  }
  return true;
}

function closeMapCodeModal(){
  mapEditorCodeMode = null;
  if (!mapCodeBack) return;
  mapCodeBack.classList.add("hidden");
}

function isMainMenuOpen(){
  return bodyEl.classList.contains("mainMenuOpen");
}

function setMenuRouteState(mode){
  bodyEl.classList.remove("mainMenuOpen", "mapSelectOpen", "customMapsOpen", "mapEditorOpen");
  if (mode === "game") return;
  bodyEl.classList.add("mainMenuOpen");
  if (mode === "mapSelect") bodyEl.classList.add("mapSelectOpen");
  if (mode === "customMaps") {
    bodyEl.classList.add("mapSelectOpen");
    bodyEl.classList.add("customMapsOpen");
  }
  if (mode === "mapEditor") {
    bodyEl.classList.add("mapSelectOpen");
    bodyEl.classList.add("mapEditorOpen");
  }
}

function showMainMenu(){
  closeMenuCodexDetail();
  setMenuRouteState("main");
  hideCustomMaps();
  hideMapEditorPage();
  hideMapSelect();
}

function hideMainMenu(){
  closeMenuCodexDetail();
  setMenuRouteState("game");
  hideCustomMaps();
  hideMapEditorPage();
  hideMapSelect();
}

function hasStartGoldRewardClaimed(){
  try {
    return localStorage.getItem(START_GOLD_REWARD_KEY) === "1";
  } catch (_) {
    return false;
  }
}

function claimStartGoldReward(){
  try {
    localStorage.setItem(START_GOLD_REWARD_KEY, "1");
  } catch (_) {}
}

function getStartGoldRewardText(claimed){
  if (claimed) return `Starting Gold +${START_GOLD_REWARD_BONUS} Permanent • Reward Claimed`;
  return `You reached the end. Tap to claim your permanent Starting Gold +${START_GOLD_REWARD_BONUS} reward.`;
}

const MENU_CODEX_DETAIL_DATA = {
  "tower:archer": {
    group: "Tower",
    title: "Archer Tower",
    visual: { kind: "tower", image: "assets/archer.png" },
    rows: [
      { k: "Auto", v: "Fast single-target physical arrows, reliable for early wave cleanup." },
      { k: "Skill", v: "Loads a stronger follow-up shot to burst priority enemies." },
      { k: "Prestige", v: "Opens a rapid-volley window so Archers spike together." }
    ],
    notes: [
      "Low micro overhead, stable damage profile.",
      "Works best when focused on consistent lane pressure."
    ]
  },
  "tower:mage": {
    group: "Tower",
    title: "Mage Tower",
    visual: { kind: "tower", image: "assets/mage.png" },
    rows: [
      { k: "Auto", v: "Casts steady magic bolts early game, then stops basic attacking after Level 21." },
      { k: "Skill", v: "Chain Bolt jumps across nearby enemies for wave control." },
      { k: "Prestige", v: "Creates a caster-focused aura around itself for nearby towers." }
    ],
    notes: [
      "Important: after Level 21, Mage play is skill/aura-driven instead of auto-hit driven.",
      "Use it when you want magic control and scaling utility together."
    ]
  },
  "tower:breaker": {
    group: "Tower",
    title: "Breaker Tower",
    visual: { kind: "tower", image: "assets/breaker.png" },
    rows: [
      { k: "Auto", v: "Naturally shreds armor with each hit." },
      { k: "Skill", v: "Shatter blast punishes armored packs and opens burst windows." },
      { k: "Prestige", v: "Turns pressure into wider cleave-style area control." }
    ],
    notes: [
      "Primary anti-armor role in most team comps.",
      "Pairs well with physical carries that need armor broken first."
    ]
  },
  "tower:blizzard": {
    group: "Tower",
    title: "Blizzard Tower",
    visual: { kind: "tower", image: "assets/blizzard.png" },
    rows: [
      { k: "Auto", v: "Applies slow every hit to shape enemy path tempo." },
      { k: "Skill", v: "Frost pulse adds area slow plus magic pressure." },
      { k: "Prestige", v: "Upgrades control into hard lockdown behavior." }
    ],
    notes: [
      "Core crowd-control pick.",
      "Best used to create safe windows for high-damage towers."
    ]
  },
  "tower:poison": {
    group: "Tower",
    title: "Poison Tower",
    visual: { kind: "tower", image: "assets/poison.png" },
    rows: [
      { k: "Auto", v: "Builds poison stacks over time." },
      { k: "Skill", v: "Spikes existing stacks to accelerate ticking damage." },
      { k: "Prestige", v: "Spreads plague pressure through clustered enemies." }
    ],
    notes: [
      "Excels in sustained fights.",
      "Needs time-on-target to reach full value."
    ]
  },
  "tower:sniper": {
    group: "Tower",
    title: "Sniper Tower",
    visual: { kind: "tower", image: "assets/sniper.png" },
    rows: [
      { k: "Auto", v: "Very long-range heavy single shots." },
      { k: "Skill", v: "Overlevel path grants permanent side growth over time." },
      { k: "Prestige", v: "Care package timing gives economy tempo swings." }
    ],
    notes: [
      "High impact on priority targets.",
      "Best on lanes where long range can stay active constantly."
    ]
  },
  "tower:peel": {
    group: "Tower",
    title: "Peel Tower",
    visual: { kind: "tower", image: "assets/peel.png" },
    rows: [
      { k: "Auto", v: "Fires support links that buff allied towers." },
      { k: "Skill", v: "Core uplink supports economy and survivability at wave end." },
      { k: "Prestige", v: "Pushes another prestige tower forward for team scaling." }
    ],
    notes: [
      "Support identity over direct DPS.",
      "Value scales with surrounding tower quality."
    ]
  },
  "mob:runner": {
    group: "Mob",
    title: "Runner",
    visual: { kind: "mob", mobType: "runner" },
    rows: [
      { k: "Role", v: "Fast baseline enemy used as the main lane pressure unit." },
      { k: "Pressure", v: "Punishes weak cleanup and late retargeting." },
      { k: "Counter", v: "Reliable single-target towers and path control." }
    ],
    notes: [
      "Appears frequently, defines pacing.",
      "Can become dangerous in high-density waves."
    ]
  },
  "mob:tank": {
    group: "Mob",
    title: "Tank",
    visual: { kind: "mob", mobType: "tank" },
    rows: [
      { k: "Role", v: "Durable frontline unit with high staying power." },
      { k: "Pressure", v: "Soaks burst and extends combat duration for the whole wave." },
      { k: "Counter", v: "Armor break, sustained DPS, and timed skill bursts." }
    ],
    notes: [
      "Gives cover to faster mobs behind it."
    ]
  },
  "mob:siphon": {
    group: "Mob",
    title: "Siphon",
    visual: { kind: "mob", mobType: "siphon" },
    rows: [
      { k: "Role", v: "Utility enemy that burns nearby tower mana." },
      { k: "Pressure", v: "Disrupts skill cycles and prestige uptime." },
      { k: "Counter", v: "Early focus fire before it reaches your core setup." }
    ],
    notes: [
      "Aura pressure is stronger in dense fights."
    ]
  },
  "mob:boss": {
    group: "Mob",
    title: "Boss",
    visual: { kind: "mob", mobType: "boss" },
    rows: [
      { k: "Role", v: "Wave anchor with advanced survivability." },
      { k: "Pressure", v: "Can cleanse debuffs, heal, and summon adds." },
      { k: "Counter", v: "Layered control plus coordinated burst windows." }
    ],
    notes: [
      "Boss fights test comp balance more than raw DPS."
    ]
  },
  "effect:armored": {
    group: "Mob Effect",
    title: "Armored",
    visual: { kind: "effect", affixId: "armored", sampleMob: "tank" },
    rows: [
      { k: "Effect", v: "Adds extra armor and toughness." },
      { k: "Pressure", v: "Physical damage loses efficiency without shred support." },
      { k: "Counter", v: "Use Breaker-style armor break and mixed damage." }
    ],
    notes: [
      "Shown on a sample enemy with affix icon."
    ]
  },
  "effect:arcane": {
    group: "Mob Effect",
    title: "Arcane",
    visual: { kind: "effect", affixId: "arcane", sampleMob: "runner" },
    rows: [
      { k: "Effect", v: "Adds magic resistance and extra survival." },
      { k: "Pressure", v: "Magic burst loses value against this target." },
      { k: "Counter", v: "Shift damage profile or increase penetration support." }
    ],
    notes: [
      "Good reminder to keep mixed damage options."
    ]
  },
  "effect:swift": {
    group: "Mob Effect",
    title: "Swift",
    visual: { kind: "effect", affixId: "swift", sampleMob: "runner" },
    rows: [
      { k: "Effect", v: "Increases movement speed and slow resistance." },
      { k: "Pressure", v: "Reduces path-control value and creates leak risk." },
      { k: "Counter", v: "Front-loaded damage and hard control timing." }
    ],
    notes: [
      "Fast targets punish delayed target switching."
    ]
  },
  "effect:regen": {
    group: "Mob Effect",
    title: "Regenerating",
    visual: { kind: "effect", affixId: "regen", sampleMob: "tank" },
    rows: [
      { k: "Effect", v: "Regenerates HP while alive." },
      { k: "Pressure", v: "Low sustained DPS fails to finish targets." },
      { k: "Counter", v: "Keep continuous damage pressure and anti-tank focus." }
    ],
    notes: [
      "The longer it survives, the more value it gains."
    ]
  },
  "effect:volatile": {
    group: "Mob Effect",
    title: "Volatile",
    visual: { kind: "effect", affixId: "volatile", sampleMob: "runner" },
    rows: [
      { k: "Effect", v: "Can split pressure by spawning units on death." },
      { k: "Pressure", v: "Punishes weak cleanup and poor kill positioning." },
      { k: "Counter", v: "Prioritize stable AOE cleanup around death points." }
    ],
    notes: [
      "Treat kill timing as part of path control."
    ]
  }
};

const MENU_CODEX_TAB_ORDER = ["tower", "mob", "effect"];
const MENU_CODEX_IDS_BY_TAB = {
  tower: [
    "tower:archer",
    "tower:mage",
    "tower:blizzard",
    "tower:breaker",
    "tower:poison",
    "tower:sniper",
    "tower:peel"
  ],
  mob: [
    "mob:runner",
    "mob:tank",
    "mob:siphon",
    "mob:boss"
  ],
  effect: [
    "effect:armored",
    "effect:arcane",
    "effect:swift",
    "effect:regen",
    "effect:volatile"
  ]
};
const MENU_CODEX_LINEAR_IDS = [
  ...MENU_CODEX_IDS_BY_TAB.tower,
  ...MENU_CODEX_IDS_BY_TAB.mob,
  ...MENU_CODEX_IDS_BY_TAB.effect
];

const CODEX_MOB_PALETTE = {
  runner: { bright: "rgba(251,207,232,0.96)", mid: "rgba(236,72,153,0.90)", deep: "rgba(131,24,67,0.96)", rim: "rgba(251,113,133,0.92)" },
  tank: { bright: "rgba(241,245,249,0.96)", mid: "rgba(148,163,184,0.90)", deep: "rgba(51,65,85,0.96)", rim: "rgba(226,232,240,0.92)" },
  siphon: { bright: "rgba(186,230,253,0.97)", mid: "rgba(14,165,233,0.90)", deep: "rgba(12,74,110,0.96)", rim: "rgba(125,211,252,0.92)" },
  boss: { bright: "rgba(255,248,178,0.98)", mid: "rgba(250,204,21,0.92)", deep: "rgba(133,77,14,0.96)", rim: "rgba(254,240,138,0.95)" }
};

function getMenuCodexEntry(id){
  return MENU_CODEX_DETAIL_DATA[String(id || "").trim()] || null;
}

function getCodexTabFromId(id){
  const key = String(id || "");
  if (key.startsWith("tower:")) return "tower";
  if (key.startsWith("mob:")) return "mob";
  if (key.startsWith("effect:")) return "effect";
  return "tower";
}

function getCodexTabButtons(){
  return [
    { tab: "tower", el: menuCodexTabTowers },
    { tab: "mob", el: menuCodexTabMobs },
    { tab: "effect", el: menuCodexTabMods }
  ];
}

function setActiveCodexTab(tabId){
  for (const row of getCodexTabButtons()) {
    if (!row.el) continue;
    row.el.classList.toggle("active", row.tab === tabId);
    row.el.setAttribute("aria-selected", row.tab === tabId ? "true" : "false");
  }
}

function getCodexLinearIndex(id){
  return MENU_CODEX_LINEAR_IDS.indexOf(String(id || ""));
}

function getCodexNeighborId(step){
  const idx = getCodexLinearIndex(activeMenuCodexId);
  const total = MENU_CODEX_LINEAR_IDS.length;
  if (total <= 0) return null;
  if (idx < 0) return MENU_CODEX_LINEAR_IDS[0] || null;
  let nextIdx = idx + step;
  if (nextIdx < 0) nextIdx = total - 1;
  if (nextIdx >= total) nextIdx = 0;
  return MENU_CODEX_LINEAR_IDS[nextIdx];
}

function updateCodexPagerState(){
  const hasEntries = MENU_CODEX_LINEAR_IDS.length > 0;
  if (menuCodexPrevBtn) menuCodexPrevBtn.disabled = !hasEntries;
  if (menuCodexNextBtn) menuCodexNextBtn.disabled = !hasEntries;
}

function ensureCodexCanvasSize(){
  if (!menuCodexDetailCanvas) return null;
  const rect = menuCodexDetailCanvas.getBoundingClientRect();
  if (rect.width <= 2 || rect.height <= 2) return null;
  const dpr = window.devicePixelRatio || 1;
  const w = Math.max(8, Math.floor(rect.width * dpr));
  const h = Math.max(8, Math.floor(rect.height * dpr));
  if (menuCodexDetailCanvas.width !== w || menuCodexDetailCanvas.height !== h) {
    menuCodexDetailCanvas.width = w;
    menuCodexDetailCanvas.height = h;
  }
  return { w, h };
}

function drawCodexAffixIcon(ctx, affixId, cx, cy, size){
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
    for (let i=0; i<6; i+=1) {
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

function drawCodexMobPreview(mobType, affixId = null){
  const sizeInfo = ensureCodexCanvasSize();
  if (!sizeInfo || !menuCodexDetailCanvas) return;
  const ctx = menuCodexDetailCanvas.getContext("2d");
  if (!ctx) return;
  const { w, h } = sizeInfo;
  const palette = CODEX_MOB_PALETTE[mobType] || CODEX_MOB_PALETTE.runner;

  ctx.clearRect(0, 0, w, h);
  const bg = ctx.createLinearGradient(0, 0, w, h);
  bg.addColorStop(0, "rgba(2,6,23,0.98)");
  bg.addColorStop(1, "rgba(15,23,42,0.92)");
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, w, h);

  const cx = w * 0.54;
  const cy = h * 0.56;
  const radius = Math.min(w, h) * (mobType === "boss" ? 0.19 : 0.16);

  if (mobType === "siphon") {
    ctx.strokeStyle = "rgba(14,165,233,0.28)";
    ctx.lineWidth = Math.max(2, radius * 0.14);
    ctx.beginPath();
    ctx.arc(cx, cy, radius * 2.35, 0, Math.PI * 2);
    ctx.stroke();
  }

  const shadowY = cy + radius * 1.02;
  ctx.fillStyle = "rgba(0,0,0,0.30)";
  ctx.beginPath();
  ctx.ellipse(cx, shadowY, radius * 0.95, radius * 0.36, 0, 0, Math.PI * 2);
  ctx.fill();

  const orb = ctx.createRadialGradient(
    cx - radius * 0.40, cy - radius * 0.45, radius * 0.12,
    cx, cy, radius * 1.06
  );
  orb.addColorStop(0.00, palette.bright);
  orb.addColorStop(0.30, palette.mid);
  orb.addColorStop(1.00, palette.deep);
  ctx.fillStyle = orb;
  ctx.beginPath();
  ctx.arc(cx, cy, radius, 0, Math.PI * 2);
  ctx.fill();

  ctx.strokeStyle = "rgba(15,23,42,0.88)";
  ctx.lineWidth = Math.max(2, radius * 0.17);
  ctx.beginPath();
  ctx.arc(cx, cy, radius, 0, Math.PI * 2);
  ctx.stroke();

  ctx.strokeStyle = palette.rim;
  ctx.lineWidth = Math.max(1, radius * 0.09);
  ctx.beginPath();
  ctx.arc(cx, cy, radius * 0.94, -0.20, Math.PI * 1.54);
  ctx.stroke();

  ctx.fillStyle = "rgba(255,255,255,0.72)";
  ctx.beginPath();
  ctx.ellipse(cx - radius * 0.36, cy - radius * 0.34, radius * 0.28, radius * 0.17, -0.42, 0, Math.PI * 2);
  ctx.fill();

  const hpW = radius * 2.0;
  const hpX = cx - hpW * 0.5;
  const hpY = cy - radius - Math.max(16, radius * 0.48);
  ctx.fillStyle = "rgba(34,197,94,0.78)";
  ctx.fillRect(hpX, hpY, hpW * 0.78, 5);
  ctx.fillStyle = "rgba(255,255,255,0.12)";
  ctx.fillRect(hpX + hpW * 0.78, hpY, hpW * 0.22, 5);
  ctx.strokeStyle = "rgba(15,23,42,0.85)";
  ctx.lineWidth = 1;
  ctx.strokeRect(hpX, hpY, hpW, 5);

  if (affixId) {
    const badgeR = Math.max(16, radius * 0.66);
    const bx = cx + radius * 0.98;
    const by = cy - radius * 0.84;
    ctx.fillStyle = "rgba(15,23,42,0.72)";
    ctx.beginPath();
    ctx.arc(bx, by, badgeR, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = "rgba(255,255,255,0.84)";
    ctx.lineWidth = Math.max(2, badgeR * 0.12);
    ctx.beginPath();
    ctx.arc(bx, by, badgeR, 0, Math.PI * 2);
    ctx.stroke();
    drawCodexAffixIcon(ctx, affixId, bx, by, badgeR * 0.64);
  }

  const label = String(mobType || "runner").toUpperCase();
  ctx.font = `700 ${Math.max(12, Math.floor(radius * 0.36))}px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace`;
  ctx.textAlign = "left";
  ctx.textBaseline = "top";
  ctx.fillStyle = `rgba(186,230,253,${MENU_CODEX_DRAW_ALPHA})`;
  ctx.fillText(label, Math.max(12, w * 0.05), Math.max(10, h * 0.06));
}

function renderMenuCodexVisual(entry){
  if (!entry?.visual || !menuCodexDetailImage || !menuCodexDetailCanvas) return;
  const visual = entry.visual;
  if (visual.kind === "tower") {
    menuCodexDetailCanvas.style.display = "none";
    menuCodexDetailImage.style.display = "block";
    menuCodexDetailImage.src = visual.image;
    return;
  }
  menuCodexDetailImage.style.display = "none";
  menuCodexDetailCanvas.style.display = "block";
  if (visual.kind === "mob") {
    drawCodexMobPreview(visual.mobType || "runner", null);
    return;
  }
  if (visual.kind === "effect") {
    drawCodexMobPreview(visual.sampleMob || "runner", visual.affixId || null);
  }
}

function closeMenuCodexDetail(){
  activeMenuCodexId = null;
  bodyEl.classList.remove("menuCodexDetailOpen");
  setActiveCodexTab("tower");
  if (menuCodexDetailImage) {
    menuCodexDetailImage.style.display = "none";
    menuCodexDetailImage.removeAttribute("src");
  }
  if (menuCodexDetailCanvas) menuCodexDetailCanvas.style.display = "none";
  updateCodexPagerState();
}

function openMenuCodexDetail(id){
  const entry = getMenuCodexEntry(id);
  if (!entry || !menuCodexDetailTitle || !menuCodexDetailRows || !menuCodexDetailNotes) return;
  activeMenuCodexId = id;
  setActiveCodexTab(getCodexTabFromId(id));
  if (menuCodexDetailType) menuCodexDetailType.textContent = entry.group || "Codex";
  menuCodexDetailTitle.textContent = entry.title || "Codex Detail";
  menuCodexDetailRows.innerHTML = (entry.rows || []).map((row) => `
    <div class="menuCodexDetailRow">
      <div class="k">${escapeHtml(row.k || "")}:</div>
      <div class="v">${escapeHtml(row.v || "")}</div>
    </div>
  `).join("");
  menuCodexDetailNotes.innerHTML = (entry.notes || []).map((note) => `<li>${escapeHtml(note)}</li>`).join("");
  renderMenuCodexVisual(entry);
  updateCodexPagerState();
  bodyEl.classList.add("menuCodexDetailOpen");
}

function bindMenuCodex(){
  if (menuCodexPanel) {
    menuCodexPanel.addEventListener("click", (ev) => {
      const target = ev.target instanceof Element ? ev.target.closest("[data-codex-id]") : null;
      if (!target) return;
      const id = String(target.getAttribute("data-codex-id") || "");
      if (!id) return;
      ev.preventDefault();
      ev.stopPropagation();
      openMenuCodexDetail(id);
    });
  }
  if (menuCodexDetailCloseBtn) {
    menuCodexDetailCloseBtn.onclick = () => closeMenuCodexDetail();
  }
  if (menuCodexDetailBack) {
    menuCodexDetailBack.addEventListener("pointerdown", (ev) => {
      if (ev.target === menuCodexDetailBack) closeMenuCodexDetail();
    });
  }
  for (const row of getCodexTabButtons()) {
    if (!row.el) continue;
    row.el.onclick = () => {
      const targetList = MENU_CODEX_IDS_BY_TAB[row.tab] || [];
      if (!targetList.length) return;
      if (activeMenuCodexId && getCodexTabFromId(activeMenuCodexId) === row.tab) {
        openMenuCodexDetail(activeMenuCodexId);
        return;
      }
      openMenuCodexDetail(targetList[0]);
    };
  }
  if (menuCodexPrevBtn) {
    menuCodexPrevBtn.onclick = () => {
      const prevId = getCodexNeighborId(-1);
      if (!prevId) return;
      openMenuCodexDetail(prevId);
    };
  }
  if (menuCodexNextBtn) {
    menuCodexNextBtn.onclick = () => {
      const nextId = getCodexNeighborId(1);
      if (!nextId) return;
      openMenuCodexDetail(nextId);
    };
  }
  window.addEventListener("keydown", (ev) => {
    if (ev.code === "Escape" && activeMenuCodexId && isMainMenuOpen()) {
      closeMenuCodexDetail();
      return;
    }
    if (!activeMenuCodexId || !isMainMenuOpen() || !bodyEl.classList.contains("menuCodexDetailOpen")) return;
    if (ev.code === "ArrowLeft") {
      const prevId = getCodexNeighborId(-1);
      if (prevId) {
        openMenuCodexDetail(prevId);
        ev.preventDefault();
      }
    } else if (ev.code === "ArrowRight") {
      const nextId = getCodexNeighborId(1);
      if (nextId) {
        openMenuCodexDetail(nextId);
        ev.preventDefault();
      }
    }
  });
  window.addEventListener("resize", () => {
    if (!activeMenuCodexId) return;
    const entry = getMenuCodexEntry(activeMenuCodexId);
    if (!entry) return;
    renderMenuCodexVisual(entry);
  });
}

function renderMenuPatchNotes(){
  if (!menuPatchNotes) return;
  const patchHistory = [
    {
      version: "0.2.31",
      notes: [
        "Wave scaling pass: armor/mr pressure and overcap spikes were reduced and re-tuned.",
        "Target Pure mode was upgraded: Breaker -> highest armor, Blizzard -> fastest, Poison -> least poisoned.",
        "Enemy debuff readability pass: armor break X mark and improved anti-armor feedback were added.",
        "Pause menu flow updated (Resume top, Quit bottom) and UX polish completed.",
        "Peel support link pathing switched to curved travel, now with stronger outer curvature visuals.",
        "Peel buff projectiles now have unique shapes: Range circle, AD diamond, MAG star, AS dagger.",
        "Number readability pass: K/M/B/T compact formatting added across damage, hp, income and ui stats.",
        "Crit readability improved with larger impact text and clearer hit feedback.",
        "Boss death now triggers a subtle screen shake.",
        "Prestige systems reworked: Poison massively buffed, Mage prestige aura now magic-scaled, trigger timing fixed.",
        "Tower balance recap: Archer nerf, Sniper rebalanced, Breaker magic scaling heavily buffed, projectile speed pass."
      ]
    },
    {
      version: "0.2.32",
      notes: [
        "Patch notes now keep previous versions and append new updates at the bottom.",
        "Slow resistance was nerfed; Blizzard prestige root now ignores slow resistance and applies true root + vulnerability.",
        "Breaker bomb AOE and magic damage were nerfed while armor shred identity is preserved.",
        "Peel curve travel and live buff-link arc were aligned; Range buff projectile icon is now concentric rings.",
        "After wave 105, 70-mob cap is removed and wave pressure is multiplied x5.",
        "Level-up gain curve now has stronger diminishing returns at higher levels.",
        "Mage prestige aura x30 hard cap removed; growth made harder but uncapped.",
        "Health scaling and resist-wave HP inflation were revisited and softened."
      ]
    },
    {
      version: "0.2.33",
      notes: [
        "Peel projectile speed was reduced by 50% for cleaner support pacing.",
        "Map Editor gained Obstacle tool (O): orange X tile, included in map code/export/import.",
        "Obstacle tiles now block tower placement in both custom and runtime-loaded maps.",
        "Release stats reset key updated; lifetime stats/high-kills/progress/save are wiped once on first boot.",
        "Startup stability fix for Itch builds: roundRect fallback added to prevent constructor-time crash."
      ]
    },
    {
      version: "0.2.34",
      notes: [
        "Wave 105+ pacing reworked: enemy count now grows gradually instead of instant over-spike.",
        "Clarified 5x rule applied to core-hit damage only (post-105), not global enemy stat inflation.",
        "Map Editor obstacle visual simplified: removed X mark, now light orange fill tile.",
        "Mythical Story now grants +120% to all three stats.",
        "Main menu got two side info modals: rarity chances (left) and clickable codex (right).",
        "Tower sell refund reduced from 70% to 50%."
      ]
    },
    {
      version: "0.2.35",
      notes: [
        "Codex expanded: each tower now explains auto attack, skill and prestige skill in plain language.",
        "Main-menu side modals are now interaction-isolated to menu state only.",
        "Overlay transition safety pass: hidden menu side panels no longer block in-game clicks.",
        "UI interaction cleanup for cross-screen modal switching."
      ]
    },
    {
      version: "0.2.36",
      notes: [
        "Tower codex text now uses line-by-line Auto / Skill / Prestige format with bold labels.",
        "Important gameplay behavior notes were highlighted (example: Mage transitions into pure caster mode at high level).",
        "Patch notes are now sorted from newest to oldest again.",
        "A one-time permanent reward CTA was added at the bottom: claim to unlock Starting Gold +30 (150 -> 180)."
      ]
    },
    {
      version: "0.2.37",
      notes: [
        "Main-menu codex details were redesigned into a spacious panel layout.",
        "Detail view now uses left-side explanations and right-side visuals for clarity.",
        "Tower detail pages now show tower sprites directly from assets.",
        "Mob and Mob Effect pages now render sample enemy visuals with modifier icon previews."
      ]
    },
    {
      version: "0.2.38",
      notes: [
        "Codex detail got category tabs (Towers, Mobs, Modifications) and Previous/Next navigation arrows.",
        "Arrow navigation now moves through entries in sequence and updates the selected tab automatically.",
        "Mob Effect icon rendering was aligned with in-game modifier icon shapes.",
        "Overlay isolation was hardened so hidden map/custom/editor screens cannot be clicked from other pages."
      ]
    },
    {
      version: "0.2.39",
      notes: [
        "Codex pager buttons moved to fixed left/right positions, centered vertically on the detail modal.",
        "Pager now uses circular arrow-only controls without Previous/Next text.",
        "Codex navigation is now circular (looping from last to first and first to last)."
      ]
    },
    {
      version: "0.2.40",
      notes: [
        "Main-menu route state handling was unified to prevent overlapping invisible screens.",
        "Map Select / Custom Maps / Map Editor overlays now activate only when Main Menu is active.",
        "Hidden overlay click-through and stale class conflicts were cleaned up for safer modal navigation."
      ]
    },
    {
      version: "0.2.41",
      notes: [
        "Overlay safety pass hardened: hidden codex/map/custom/editor layers now use display:none when inactive.",
        "Visibility and pointer isolation were strengthened to eliminate hidden click-capture edge cases.",
        "Main-menu interaction reliability improved for New Game and map flow buttons."
      ]
    },
    {
      version: "0.2.42",
      notes: [
        "Boot-time TDZ crash fixed: initial main-menu open now runs after module initialization.",
        "Resolved startup ReferenceError chain that blocked New Game and Codex interaction.",
        "Added inline favicon to remove local dev 404 console noise."
      ]
    },
    {
      version: "0.2.43",
      notes: [
        "Codex left/right arrows were moved closer to the modal and perfectly centered inside circular buttons.",
        "Map Select now includes matching circular left/right pager arrows for future 5+ map pages.",
        "Map list rendering now supports page-based navigation and loops between pages."
      ]
    },
    {
      version: "0.2.44",
      notes: [
        "Codex arrow buttons were pulled to modal-edge proximity (about 20-30px inset) and remain centered.",
        "Map Select now includes Template Maps 6/7/8/9 and supports horizontal-style paging with left/right arrows.",
        "Map pagination now uses a fixed 5-card page size so arrows remain active when total maps exceed five."
      ]
    },
    {
      version: "0.2.45",
      notes: [
        "Codex and Map pager arrows were redesigned with a heavier, more weighted circular style.",
        "Arrow glyphs were updated from plain lines to bold filled icons for stronger readability.",
        "In-game Space behavior changed: first press now starts the run, later presses toggle pause/resume."
      ]
    },
    {
      version: "0.2.46",
      notes: [
        "Codex pager arrows were moved outside the modal frame instead of sitting inside the content area.",
        "Map Select pager arrows now match the same outside-of-modal placement.",
        "Mobile offsets were tuned so arrows stay outside while remaining visible and clickable."
      ]
    },
    {
      version: "0.2.47",
      notes: [
        "Fixed arrow clipping: Codex detail card now allows overflow so outside-positioned arrows stay visible.",
        "Map Select container now allows overflow for the same outside-arrow visibility behavior.",
        "Resolved the modal-edge blocking issue that was cutting off arrow controls."
      ]
    },
    {
      version: "0.2.48",
      notes: [
        "Versioning rule is now enforced in workflow: every update increments patch by +1; major updates can increment minor.",
        "Main-screen Patch Notes now include a concise summary for each update.",
        "Patch Notes order remains newest to oldest."
      ]
    },
    {
      version: "0.2.49",
      notes: [
        "Game Speed panel is now English and the Speed label is clickable: it cycles 1x -> 2x -> 3x while keeping the slider in sync.",
        "Wave spawn pacing now treats wave 50 as baseline: earlier waves spawn slower, later waves spawn faster.",
        "Mage Chain Bolt bug fixed: skill chaining can now continue even if the first hit kills the target.",
        "Poison Tower Toxic Surge projectile now uses a larger, darker visual than regular auto attacks.",
        "Tower balance/pricing updated: Breaker cost is now 200, Poison cost is now 250.",
        "Tower order updated where relevant (shop, shortcuts, codex): Blizzard now appears before Breaker."
      ]
    },
    {
      version: "0.2.50",
      notes: [
        "Wave 50 remains baseline spawn pacing, but deviation is expanded: pre-50 is significantly slower, post-50 is significantly faster than before.",
        "Spawn interval clamp bounds are now dynamic for early/late pacing, fixing the old cap that suppressed early-wave slowdown."
      ]
    },
    {
      version: "0.2.51",
      notes: [
        "First refactor step started: heavy main HUD/selection UI refresh is no longer hard-called every frame.",
        "Game now uses a dirty + throttled UI refresh model (about 12 Hz) while keeping forced immediate refreshes for direct user actions.",
        "This reduces avoidable DOM churn and creates a safe base for the next performance refactor steps."
      ]
    },
    {
      version: "0.2.52",
      notes: [
        "Second refactor step started: lifetime statistics persistence no longer writes to localStorage on every hit/kill event.",
        "Game now marks stats dirty and flushes them at a fixed interval, including a final flush on page unload.",
        "This removes high-frequency storage churn from hot combat paths while preserving stats integrity."
      ]
    },
    {
      version: "0.2.53",
      notes: [
        "Third refactor step started: core HUD/button element lookups are now cached once in Game constructor.",
        "refreshUI now reuses cached references instead of repeating multiple document.getElementById queries each UI pass.",
        "This trims per-refresh DOM query overhead and keeps the UI refresh path tighter."
      ]
    },
    {
      version: "0.2.54",
      notes: [
        "Phase 1 refactor started: hot-path array cleanup now uses in-place compaction instead of repeated per-frame filter allocations.",
        "Main loop now includes an optional lightweight performance sampler (set window.__armtdPerf = true to print fps/update/draw/ui timings in console).",
        "HUD alive-count path was tightened to avoid temporary array allocation during UI refresh."
      ]
    },
    {
      version: "0.2.55",
      notes: [
        "Phase 1 continues: Game-side DOM access is now routed through a dedicated UI adapter module for cleaner boundary separation.",
        "Speed slider/label syncing and cheat-panel toggle flow were moved behind the adapter, reducing direct document.getElementById usage in gameplay core.",
        "This keeps behavior identical while preparing a safer path for deeper UI/gameplay decoupling."
      ]
    },
    {
      version: "0.2.56",
      notes: [
        "Phase 1 telemetry improved: performance sampling can now also render to an optional on-screen HUD in addition to console output.",
        "Enable sampling with window.__armtdPerf = true; fps/frame/update/draw/ui metrics are refreshed once per second.",
        "Perf HUD element visibility is now managed through the UI adapter boundary."
      ]
    },
    {
      version: "0.2.57",
      notes: [
        "Phase 1 spatial query groundwork added: gameplay now has a lightweight grid-based spatial index for radius lookups.",
        "Tower target selection and mana-burn / mage-aura range checks now use spatial queries instead of full-list scans where applicable.",
        "This is a low-risk foundation step to reduce hot-path query cost before deeper targeting/projectile optimizations."
      ]
    },
    {
      version: "0.2.58",
      notes: [
        "Phase 1 hot-path pass expanded: projectile/ring enemy scans now use spatial queries where possible.",
        "EffectRing hit checks, projectile retargeting, drift collision candidate selection and pass-radius checks were moved off full enemy-list loops.",
        "This further reduces combat-frame query cost while preserving existing gameplay behavior."
      ]
    },
    {
      version: "0.2.59",
      notes: [
        "Bugfix: Special Upgrade hover preview in Selected panel now updates live again while modal is open.",
        "Hover-change callback now forces an immediate UI refresh so preview stats/skill deltas render without waiting for gameplay ticks."
      ]
    },
    {
      version: "0.2.60",
      notes: [
        "Phase 1 closing tooling added: repository now includes a standard syntax-check script (tools/check_syntax.mjs) with package scripts.",
        "Perf baseline capture guide and smoke checklist docs were added under tools/ for repeatable validation after each optimization pass.",
        "This closes Phase 1 verification loop: optimize, measure, and run smoke checks with a shared workflow."
      ]
    },
    {
      version: "0.2.61",
      notes: [
        "Phase 2 groundwork started: central content registry module added for tower/enemy/map definition lookups.",
        "Game/main lookup paths now read through the registry for tower stat counters, save tower restore, map catalog and enemy type naming.",
        "This creates a low-risk data-driven spine for upcoming unlock/content-pack/save-versioning refactors."
      ]
    },
    {
      version: "0.2.62",
      notes: [
        "Phase 2 registry migration continued: shop tower listing in UI now reads from CONTENT_REGISTRY instead of direct tower defs import.",
        "Tower ordering and visuals are unchanged; this is a dependency-boundary cleanup step for safer future content expansion.",
        "Version and main-screen patch notes were updated to keep incremental refactor history consistent."
      ]
    }
  ];
  const orderedPatchHistory = [...patchHistory].reverse();
  const rewardClaimed = hasStartGoldRewardClaimed();
  menuPatchNotes.innerHTML = `
    <div class="menuPatchNotesTitle">Patch Notes <span class="menuPatchNotesArrow">▼</span></div>
    <div class="menuPatchNotesMore">
      ${orderedPatchHistory.map(section => `
        <div class="menuPatchNotesHint">v${escapeHtml(section.version)}</div>
        <ul>${section.notes.map(n => `<li>${escapeHtml(n)}</li>`).join("")}</ul>
      `).join("")}
      <div class="menuPatchRewardWrap">
        <button
          type="button"
          class="menuPatchRewardBtn${rewardClaimed ? " claimed" : ""}"
          data-start-gold-reward="1"
          ${rewardClaimed ? "disabled" : ""}
        >${escapeHtml(getStartGoldRewardText(rewardClaimed))}</button>
      </div>
    </div>
  `;
  const rewardBtn = menuPatchNotes.querySelector("[data-start-gold-reward]");
  if (rewardBtn) {
    rewardBtn.addEventListener("click", (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      if (hasStartGoldRewardClaimed()) return;
      claimStartGoldReward();
      rewardBtn.disabled = true;
      rewardBtn.classList.add("claimed");
      rewardBtn.textContent = getStartGoldRewardText(true);
      if (typeof game?.logEvent === "function") {
        game.logEvent(`Permanent reward unlocked: Starting Gold +${START_GOLD_REWARD_BONUS}.`);
      }
    });
  }
  menuPatchNotes.onclick = (ev) => {
    if (ev.target instanceof Element && ev.target.closest(".menuPatchRewardWrap")) return;
    menuPatchNotes.classList.toggle("expanded");
  };
}

function openMapSelect(){
  closeMenuCodexDetail();
  hideCustomMaps();
  hideMapEditorPage();
  mapSelectPage = 0;
  renderMapSelect();
  setMenuRouteState("mapSelect");
}

function hideMapSelect(){
  closeMenuCodexDetail();
  bodyEl.classList.remove("mapSelectOpen", "customMapsOpen", "mapEditorOpen");
  hideCustomMaps();
}

function openCustomMaps(){
  closeMenuCodexDetail();
  renderCustomMaps();
  setMenuRouteState("customMaps");
}

function hideCustomMaps(){
  closeMenuCodexDetail();
  bodyEl.classList.remove("customMapsOpen");
}

function renderCustomMaps(){
  if (!customMapsGrid) return;
  const store = readCustomMapsStore();
  if (!store.maps.length) {
    customMapsGrid.innerHTML = `<div class="customMapsEmpty">No custom maps played yet. Open Map Editor and press Play to add one.</div>`;
    return;
  }
  customMapsGrid.innerHTML = store.maps.map((m) => `
    <div class="customMapCard" data-custom-map-id="${escapeHtml(m.id)}">
      <div class="customMapName">${escapeHtml(m.name)}</div>
      <div class="customMapMeta">Last Played: ${escapeHtml(formatPlayedAt(m.lastPlayedAt))}</div>
      <div class="customMapActions">
        <button type="button" class="good" data-custom-map-play="${escapeHtml(m.id)}">Play</button>
        <button type="button" data-custom-map-load="${escapeHtml(m.id)}">Load To Editor</button>
      </div>
    </div>
  `).join("");
}

function openMapEditorPage(){
  closeMenuCodexDetail();
  hideCustomMaps();
  setMenuRouteState("mapEditor");
  closeMapCodeModal();
  mapEditorState.dragPaint = false;
  refreshMapEditorStatus();
  renderMapEditor();
}

function hideMapEditorPage(){
  closeMenuCodexDetail();
  bodyEl.classList.remove("mapEditorOpen");
  mapEditorState.dragPaint = false;
  mapEditorState.hover = null;
  closeMapCodeModal();
}

function renderMapSelect(){
  if (!mapSelectGrid) return;
  const catalog = getMapCatalog();
  const pageSize = Math.max(1, MAP_PAGE_SIZE);
  const totalPages = Math.max(1, Math.ceil(catalog.length / pageSize));
  mapSelectPage = Math.max(0, Math.min(totalPages - 1, Math.floor(mapSelectPage)));
  const start = mapSelectPage * pageSize;
  const pageRows = catalog.slice(start, start + pageSize);
  const progress = readMapProgress();
  mapSelectGrid.innerHTML = pageRows.map((entry, localIdx) => {
    const idx = start + localIdx;
    const unlocked = isMapUnlocked(idx, progress);
    const cardProgress = progress.maps[idx];
    const star1 = !!cardProgress?.stars?.star1;
    const star2 = !!cardProgress?.stars?.star2;
    const star3 = !!cardProgress?.stars?.star3;
    const maxWave = Math.max(0, Math.floor(Number(cardProgress?.maxWave) || 0));
    const playable = !!entry.playable && unlocked;
    const lockText = unlocked
      ? (entry.playable ? "Playable" : "Template")
      : "Win previous map";
    const bgStyle = entry.image
      ? `style="background-image:url('${escapeHtml(entry.image)}')"`
      : "";
    return `
      <button class="mapCard ${playable ? "playable" : "locked"}" type="button" data-map-card="${idx}">
        <div class="mapCardImage" ${bgStyle}></div>
        <div class="mapCardShade"></div>
        <div class="mapCardName">${escapeHtml(entry.title)}</div>
        <div class="mapCardStars">
          ${renderStarNode("star2", star2, 2)}
          ${renderStarNode("star1", star1, 1)}
          ${renderStarNode("star3", star3, 3)}
        </div>
        <div class="mapCardStats">Max Wave: ${maxWave}</div>
        <div class="mapCardLock">${escapeHtml(lockText)}</div>
      </button>
    `;
  }).join("");

  const hasMultiPage = totalPages > 1;
  if (mapSelectPrevBtn) {
    mapSelectPrevBtn.classList.toggle("hidden", !hasMultiPage);
    mapSelectPrevBtn.disabled = !hasMultiPage;
  }
  if (mapSelectNextBtn) {
    mapSelectNextBtn.classList.toggle("hidden", !hasMultiPage);
    mapSelectNextBtn.disabled = !hasMultiPage;
  }
}

function readRunSave(){
  try {
    const raw = localStorage.getItem(RUN_SAVE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return null;
    return parsed;
  } catch (_) {
    return null;
  }
}

function writeRunSave(data){
  try {
    localStorage.setItem(RUN_SAVE_KEY, JSON.stringify(data));
  } catch (_) {}
}

function clearRunSave(){
  try {
    localStorage.removeItem(RUN_SAVE_KEY);
  } catch (_) {}
}

function updateContinueButton(){
  if (menuContinueBtn) menuContinueBtn.disabled = !readRunSave();
}

function applyAudioSettings(){
  const vol = Number(settings.audio?.volume);
  const safeVol = Number.isFinite(vol) ? clamp(vol, 0, 1) : 0.18;
  const muted = !!settings.audio?.muted;
  SFX.setVolume(safeVol);
  SFX.setMuted(muted);
  settings.audio.volume = safeVol;
  settings.audio.muted = muted;
}

function persistSettings(applyAudio = true){
  settings = cloneSettings(saveSettings(settings));
  if (applyAudio) applyAudioSettings();
}

function bindMainMenu(){
  if (menuNewGameBtn) {
    menuNewGameBtn.onclick = () => {
      const openMaps = () => {
        clearRunSave();
        updateContinueButton();
        closePauseMenuVisual();
        openMapSelect();
      };
      if (readRunSave()) {
        openConfirm(
          "New Game?",
          "Saved progress will be overwritten. Open map selection?",
          "Open Maps",
          openMaps
        );
      } else {
        openMaps();
      }
    };
  }

  if (menuContinueBtn) {
    menuContinueBtn.onclick = () => {
      const saveData = readRunSave();
      if (!saveData) {
        updateContinueButton();
        return;
      }
      if (!game.loadRunSave(saveData)) {
        clearRunSave();
        updateContinueButton();
        return;
      }
      closePauseMenuVisual();
      if (!game.isCustomMapRun) {
        updateMapProgressMaxWave(game.mapIndex, Math.max(game.currentWave, game.getStatsSnapshot().maxWaveSeen));
      }
      hideMainMenu();
    };
  }

  if (menuSettingsBtn) menuSettingsBtn.onclick = () => openSettings();
  if (menuStatsBtn) menuStatsBtn.onclick = () => openStatistics();

  if (fullscreenHintBtn) {
    fullscreenHintBtn.onclick = () => {
      const root = document.documentElement;
      const req = root.requestFullscreen || root.webkitRequestFullscreen || root.msRequestFullscreen;
      if (typeof req === "function") req.call(root);
    };
  }
}

function bindMapSelect(){
  if (mapSelectBackBtn) {
    mapSelectBackBtn.onclick = () => {
      hideMapEditorPage();
      hideMapSelect();
    };
  }

  if (mapEditorOpenBtn) {
    mapEditorOpenBtn.onclick = () => {
      resetMapEditorBlank();
      openMapEditorPage();
    };
  }

  if (customMapsOpenBtn) {
    customMapsOpenBtn.onclick = () => {
      hideMapEditorPage();
      openCustomMaps();
    };
  }

  if (customMapsBackBtn) {
    customMapsBackBtn.onclick = () => {
      hideCustomMaps();
    };
  }

  if (mapEditorBackBtn) {
    mapEditorBackBtn.onclick = () => {
      hideMapEditorPage();
    };
  }

  if (mapSelectPrevBtn) {
    mapSelectPrevBtn.onclick = () => {
      const totalPages = Math.max(1, Math.ceil(getMapCatalog().length / Math.max(1, MAP_PAGE_SIZE)));
      if (totalPages <= 1) return;
      mapSelectPage = (mapSelectPage - 1 + totalPages) % totalPages;
      renderMapSelect();
    };
  }

  if (mapSelectNextBtn) {
    mapSelectNextBtn.onclick = () => {
      const totalPages = Math.max(1, Math.ceil(getMapCatalog().length / Math.max(1, MAP_PAGE_SIZE)));
      if (totalPages <= 1) return;
      mapSelectPage = (mapSelectPage + 1) % totalPages;
      renderMapSelect();
    };
  }

  if (mapSelectGrid) {
    mapSelectGrid.addEventListener("click", (ev) => {
      const target = ev.target instanceof Element ? ev.target.closest("[data-map-card]") : null;
      if (!target) return;
      const cardIndex = Math.max(0, Math.floor(Number(target.getAttribute("data-map-card")) || 0));
      const mapDef = getMapCatalog()[cardIndex];
      const progress = readMapProgress();
      if (!isMapUnlocked(cardIndex, progress)) return;
      if (!mapDef?.playable) return;
      closePauseMenuVisual();
      game.startFreshRun({ mapIndex: Math.max(0, Math.floor(Number(mapDef.mapIndex) || 0)) });
      hideMainMenu();
    });
  }

  if (customMapsGrid) {
    customMapsGrid.addEventListener("click", (ev) => {
      const target = ev.target instanceof Element ? ev.target : null;
      if (!target) return;
      const playBtn = target.closest("[data-custom-map-play]");
      const loadBtn = target.closest("[data-custom-map-load]");
      if (!playBtn && !loadBtn) return;
      const id = String((playBtn || loadBtn)?.getAttribute(playBtn ? "data-custom-map-play" : "data-custom-map-load") || "");
      if (!id) return;
      const store = readCustomMapsStore();
      const entry = store.maps.find(m => m.id === id);
      if (!entry) return;

      try {
        const parsed = parseMapCode(entry.code);
        if (loadBtn) {
          decodeEditorMapCode(entry.code);
          hideCustomMaps();
          openMapEditorPage();
          refreshMapEditorStatus();
          renderMapEditor();
          return;
        }
        clearRunSave();
        updateContinueButton();
        closePauseMenuVisual();
        upsertPlayedCustomMap({ name: parsed.name, code: entry.code });
        game.startFreshRun({
          customMapDef: {
            name: parsed.name,
            gridW: MAP_EDITOR_W,
            gridH: MAP_EDITOR_H,
            entrance: parsed.spawn,
            exit: parsed.core,
            grid: parsed.grid,
            hazards: []
          },
          mapIndex: 0
        });
        hideMainMenu();
      } catch (_) {
        setMapEditorStatus("Custom map code is invalid.", true);
      }
    });
  }
}

function bindMapEditor(){
  if (mapEditorToolPathBtn) mapEditorToolPathBtn.onclick = () => setMapEditorTool("path");
  if (mapEditorToolSpawnBtn) mapEditorToolSpawnBtn.onclick = () => setMapEditorTool("spawn");
  if (mapEditorToolCoreBtn) mapEditorToolCoreBtn.onclick = () => setMapEditorTool("core");
  if (mapEditorToolObstacleBtn) mapEditorToolObstacleBtn.onclick = () => setMapEditorTool("obstacle");
  if (mapEditorToolEraseBtn) mapEditorToolEraseBtn.onclick = () => setMapEditorTool("erase");

  if (mapEditorClearBtn) {
    mapEditorClearBtn.onclick = () => {
      mapEditorState.grid = createEmptyEditorGrid();
      mapEditorState.spawn = null;
      mapEditorState.core = null;
      if (mapEditorNameInput) mapEditorNameInput.value = "Custom Map";
      refreshMapEditorStatus();
      renderMapEditor();
    };
  }

  if (mapEditorExportBtn) {
    mapEditorExportBtn.onclick = () => {
      const v = refreshMapEditorStatus();
      if (!v.ok) {
        const msg = v.issues?.[0] || "Map is not valid for export.";
        setMapEditorStatus(msg, true);
        return;
      }
      try {
        const code = encodeEditorMapCode();
        const opened = openMapCodeModal("export", code);
        if (!opened) {
          try {
            if (navigator?.clipboard?.writeText) {
              navigator.clipboard.writeText(code).catch(() => {});
            }
          } catch (_) {}
          try { window.prompt("Copy map code:", code); } catch (_) {}
        }
        setMapEditorStatus("Map code generated.", false);
      } catch (err) {
        const msg = (err && typeof err.message === "string") ? err.message : "Export failed.";
        setMapEditorStatus(msg, true);
      }
    };
  }

  if (mapEditorImportBtn) {
    mapEditorImportBtn.onclick = () => {
      if (openMapCodeModal("import", "")) {
        setMapEditorStatus("Paste a map code and press Load.", false);
        return;
      }
      const raw = window.prompt("Paste map code:");
      if (!raw) return;
      try {
        decodeEditorMapCode(raw);
        refreshMapEditorStatus();
        renderMapEditor();
        setMapEditorStatus("Map code imported.", false);
      } catch (err) {
        const msg = (err && typeof err.message === "string") ? err.message : "Invalid map code.";
        setMapEditorStatus(msg, true);
      }
    };
  }

  if (mapEditorNameInput) {
    mapEditorNameInput.addEventListener("blur", () => {
      mapEditorNameInput.value = normalizeCustomMapName(mapEditorNameInput.value);
    });
  }

  if (mapEditorPlayBtn) {
    mapEditorPlayBtn.onclick = () => {
      const v = refreshMapEditorStatus();
      if (!v.ok) return;
      clearRunSave();
      updateContinueButton();
      closePauseMenuVisual();
      closeMapCodeModal();
      const mapDef = buildMapDefFromEditor();
      if (!mapDef) {
        setMapEditorStatus("Spawn and Core are required.", true);
        return;
      }
      const mapCode = encodeEditorMapCode();
      upsertPlayedCustomMap({ name: mapDef.name, code: mapCode });
      game.startFreshRun({ customMapDef: mapDef, mapIndex: 0 });
      hideMainMenu();
    };
  }

  if (mapCodeCloseBtn) mapCodeCloseBtn.onclick = () => closeMapCodeModal();
  if (mapCodeCopyBtn) {
    mapCodeCopyBtn.onclick = async () => {
      const text = mapCodeInput?.value || "";
      if (!text) return;
      try {
        await navigator.clipboard.writeText(text);
        setMapEditorStatus("Map code copied.", false);
      } catch (_) {
        try {
          if (mapCodeInput) {
            mapCodeInput.focus();
            mapCodeInput.select();
            document.execCommand("copy");
            setMapEditorStatus("Map code copied.", false);
            return;
          }
        } catch (_) {}
        setMapEditorStatus("Clipboard copy failed.", true);
      }
    };
  }
  if (mapCodeApplyBtn) {
    mapCodeApplyBtn.onclick = () => {
      try {
        decodeEditorMapCode(mapCodeInput?.value || "");
        closeMapCodeModal();
        refreshMapEditorStatus();
        renderMapEditor();
      } catch (err) {
        const msg = (err && typeof err.message === "string") ? err.message : "Invalid map code.";
        setMapEditorStatus(msg, true);
      }
    };
  }

  if (mapEditorCanvas) {
    mapEditorCanvas.addEventListener("pointerdown", (ev) => {
      if (ev.button !== 0) return;
      const cell = mapEditorPointToCell(ev);
      if (!cell) return;
      mapEditorState.hover = cell;
      mapEditorApplyTool(cell);
      mapEditorState.dragPaint = (mapEditorState.tool === "path" || mapEditorState.tool === "obstacle" || mapEditorState.tool === "erase");
      if (mapEditorCanvas.setPointerCapture) mapEditorCanvas.setPointerCapture(ev.pointerId);
      refreshMapEditorStatus();
      renderMapEditor();
      ev.preventDefault();
    });

    mapEditorCanvas.addEventListener("pointermove", (ev) => {
      const cell = mapEditorPointToCell(ev);
      mapEditorState.hover = cell;
      if (mapEditorState.dragPaint && cell) {
        mapEditorApplyTool(cell);
        refreshMapEditorStatus();
      }
      renderMapEditor();
    });

    const stopDraw = () => { mapEditorState.dragPaint = false; };
    mapEditorCanvas.addEventListener("pointerup", stopDraw);
    mapEditorCanvas.addEventListener("pointercancel", stopDraw);
    mapEditorCanvas.addEventListener("pointerleave", () => {
      mapEditorState.hover = null;
      renderMapEditor();
    });
  }

  window.addEventListener("resize", () => {
    if (!bodyEl.classList.contains("mapEditorOpen")) return;
    renderMapEditor();
  });

  window.addEventListener("keydown", (ev) => {
    if (!bodyEl.classList.contains("mapEditorOpen")) return;
    if (isTextInputTarget(ev.target)) return;
    if (ev.code === "KeyW") {
      setMapEditorTool("path");
      ev.preventDefault();
      return;
    }
    if (ev.code === "KeyS") {
      setMapEditorTool("spawn");
      ev.preventDefault();
      return;
    }
    if (ev.code === "KeyC") {
      setMapEditorTool("core");
      ev.preventDefault();
      return;
    }
    if (ev.code === "KeyO") {
      setMapEditorTool("obstacle");
      ev.preventDefault();
      return;
    }
    if (ev.code === "KeyD" || ev.code === "Delete" || ev.code === "Backspace") {
      setMapEditorTool("erase");
      ev.preventDefault();
    }
  });
}

function bindSettingsModal(){
  if (settingsCloseBtn) settingsCloseBtn.onclick = () => closeSettings();
  if (settingsBack) {
    settingsBack.addEventListener("pointerdown", (ev) => {
      if (ev.target === settingsBack) closeSettings();
    });
  }

  if (settingsVolumeSlider) {
    settingsVolumeSlider.addEventListener("input", () => {
      const pct = clamp(Number(settingsVolumeSlider.value), 0, 100);
      settings.audio.volume = pct / 100;
      if (settings.audio.volume > 0 && settings.audio.muted) settings.audio.muted = false;
      persistSettings(true);
      syncSettingsUI();
    });
  }

  if (settingsMuteBtn) {
    settingsMuteBtn.onclick = () => {
      settings.audio.muted = !settings.audio.muted;
      persistSettings(true);
      syncSettingsUI();
    };
  }

  if (settingsResetKeybindsBtn) {
    settingsResetKeybindsBtn.onclick = () => {
      for (const def of KEYBIND_DEFS) settings.keybinds[def.id] = def.defaultCode;
      persistSettings(false);
      renderKeybindRows();
    };
  }
}

function syncSettingsUI(){
  const volPct = Math.round(clamp(settings.audio.volume * 100, 0, 100));
  if (settingsVolumeSlider) settingsVolumeSlider.value = String(volPct);
  if (settingsVolumeValue) settingsVolumeValue.textContent = `${volPct}%`;
  if (settingsMuteBtn) settingsMuteBtn.textContent = settings.audio.muted ? "Unmute" : "Mute";
}

function openSettings(){
  stopKeybindCapture();
  syncSettingsUI();
  renderKeybindRows();
  if (settingsBack) settingsBack.style.display = "flex";
}

function closeSettings(){
  stopKeybindCapture();
  if (settingsBack) settingsBack.style.display = "none";
}

function renderKeybindRows(){
  if (!settingsKeybindList) return;
  settingsKeybindList.innerHTML = "";
  for (const def of KEYBIND_DEFS) {
    const row = document.createElement("div");
    row.className = "settingsKeybindRow";
    if (keybindCaptureAction === def.id) row.classList.add("capture");

    const label = document.createElement("div");
    label.className = "settingsKeybindLabel";
    label.textContent = def.label;

    const controls = document.createElement("div");
    controls.className = "settingsKeybindControls";

    const value = document.createElement("span");
    value.className = "settingsKeybindValue keyBadge";
    value.textContent = keybindCaptureAction === def.id
      ? "Press key..."
      : formatKeyCode(settings.keybinds[def.id]);

    const changeBtn = document.createElement("button");
    changeBtn.className = "settingsSmallBtn";
    changeBtn.textContent = keybindCaptureAction === def.id ? "..." : "Change";
    changeBtn.onclick = () => startKeybindCapture(def.id);

    const resetBtn = document.createElement("button");
    resetBtn.className = "settingsSmallBtn";
    resetBtn.textContent = "Reset";
    resetBtn.onclick = () => {
      settings.keybinds[def.id] = defaultCodeForAction(def.id);
      persistSettings(false);
      renderKeybindRows();
    };

    controls.appendChild(value);
    controls.appendChild(changeBtn);
    controls.appendChild(resetBtn);
    row.appendChild(label);
    row.appendChild(controls);
    settingsKeybindList.appendChild(row);
  }
}

function normalizeCapturedCode(ev){
  const rawCode = (typeof ev?.code === "string") ? ev.code.trim() : "";
  if (rawCode && rawCode !== "Unidentified") return rawCode;

  const key = (typeof ev?.key === "string") ? ev.key.trim() : "";
  if (!key) return null;
  if (key === " ") return "Space";
  if (key === "Esc") return "Escape";
  if (key === "Escape") return "Escape";
  if (key === "Enter") return "Enter";
  if (/^[a-zA-Z]$/.test(key)) return `Key${key.toUpperCase()}`;
  if (/^[0-9]$/.test(key)) return `Digit${key}`;

  const keyMap = {
    "`": "Backquote",
    "-": "Minus",
    "=": "Equal",
    "[": "BracketLeft",
    "]": "BracketRight",
    ";": "Semicolon",
    "'": "Quote",
    ",": "Comma",
    ".": "Period",
    "/": "Slash",
    "\\": "Backslash"
  };
  return keyMap[key] || null;
}

function startKeybindCapture(actionId){
  keybindCaptureAction = actionId;
  renderKeybindRows();
  if (keybindCaptureHandler) return;
  keybindCaptureHandler = (ev) => {
    if (!keybindCaptureAction) return;
    const code = normalizeCapturedCode(ev);
    if (!code) return;
    if (code === "ShiftLeft" || code === "ShiftRight" || code === "ControlLeft" || code === "ControlRight" || code === "AltLeft" || code === "AltRight" || code === "MetaLeft" || code === "MetaRight") return;
    ev.preventDefault();
    ev.stopPropagation();
    settings.keybinds[keybindCaptureAction] = code;
    persistSettings(false);
    stopKeybindCapture();
    renderKeybindRows();
  };
  window.addEventListener("keydown", keybindCaptureHandler, true);
}

function stopKeybindCapture(){
  if (keybindCaptureHandler) {
    window.removeEventListener("keydown", keybindCaptureHandler, true);
    keybindCaptureHandler = null;
  }
  keybindCaptureAction = null;
}

function bindStatsModal(){
  if (statsCloseBtn) statsCloseBtn.onclick = () => closeStatistics();
  if (statsHardResetBtn) {
    statsHardResetBtn.onclick = () => {
      openConfirm(
        "Hard Reset Statistics?",
        "This will permanently clear all lifetime statistics. This cannot be undone.",
        "Hard Reset",
        () => {
          if (typeof game.hardResetPersistentStats === "function") {
            game.hardResetPersistentStats();
          }
          openStatistics();
        }
      );
    };
  }
  if (statsBack) {
    statsBack.addEventListener("pointerdown", (ev) => {
      if (ev.target === statsBack) closeStatistics();
    });
  }
}

function openStatistics(){
  try {
    const stats = (typeof game.getLifetimeStatsSnapshot === "function")
      ? game.getLifetimeStatsSnapshot()
      : game.getStatsSnapshot();
    const numberFmt = new Intl.NumberFormat("tr-TR");
    const asInt = (v) => Math.floor(Number.isFinite(Number(v)) ? Number(v) : 0);
    const asNum = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);

    const totalKills = asInt(stats.totalKills);
    const totalDamage = asNum(stats.totalDamage);
    const maxSingleHit = asNum(stats.maxSingleHit);
    const maxWaveSeen = asInt(stats.maxWaveSeen);

    if (statsSummaryGrid) {
      statsSummaryGrid.innerHTML = [
        ["Total Kills", numberFmt.format(totalKills)],
        ["Total Damage", numberFmt.format(Math.round(totalDamage))],
        ["Max Single Hit", numberFmt.format(Math.round(maxSingleHit))],
        ["Max Seen Wave", numberFmt.format(maxWaveSeen)]
      ].map(([k, v]) => `
        <div class="statsSummaryItem">
          <span class="k">${k}</span>
          <span class="v">${v}</span>
        </div>
      `).join("");
    }

    const builds = stats.towerBuildCounts || {};
    const kills = stats.towerKillCounts || {};
    const damage = stats.towerDamage || {};
    const defs = towerDefsPeelLast();
    const totalBuilt = defs.reduce((sum, def) => sum + asInt(builds[def.id]), 0);

    if (statsTowerRows) {
      const rows = defs.map(def => {
        const built = asInt(builds[def.id]);
        const killCount = asInt(kills[def.id]);
        const dmg = asNum(damage[def.id]);
        const usagePct = totalBuilt > 0 ? (built / totalBuilt) * 100 : 0;
        return { id: def.id, name: def.name, built, killCount, dmg, usagePct };
      }).sort((a, b) => {
        if (a.id === "peel" && b.id !== "peel") return 1;
        if (b.id === "peel" && a.id !== "peel") return -1;
        return (b.built - a.built) || (b.dmg - a.dmg);
      });

      statsTowerRows.innerHTML = rows.map(r => `
        <div class="statsTowerRow">
          <div class="statsTowerTop">
            <span class="statsTowerName">${r.name}</span>
            <span class="statsTowerMeta">${numberFmt.format(r.built)} built • ${r.usagePct.toFixed(1)}%</span>
          </div>
          <div class="statsTowerBar"><div class="statsTowerFill" style="width:${r.usagePct.toFixed(1)}%"></div></div>
          <div class="statsTowerBottom">
            <span>Damage: ${numberFmt.format(Math.round(r.dmg))}</span>
            <span>Kills: ${numberFmt.format(r.killCount)}</span>
          </div>
        </div>
      `).join("");
    }

    if (statsBack) statsBack.style.display = "flex";
  } catch (err) {
    console.error("Statistics open failed:", err);
  }
}

function closeStatistics(){
  if (statsBack) statsBack.style.display = "none";
}

function bindConfirmModal(){
  if (confirmCancelBtn) confirmCancelBtn.onclick = () => closeConfirm();
  if (confirmAcceptBtn) {
    confirmAcceptBtn.onclick = () => {
      const action = confirmAcceptAction;
      closeConfirm();
      if (typeof action === "function") action();
    };
  }
  if (confirmBack) {
    confirmBack.addEventListener("pointerdown", (ev) => {
      if (ev.target === confirmBack) closeConfirm();
    });
  }
}

function openConfirm(title, text, acceptLabel, onAccept){
  confirmAcceptAction = (typeof onAccept === "function") ? onAccept : null;
  if (confirmTitle) confirmTitle.textContent = title || "Are you sure?";
  if (confirmText) confirmText.textContent = text || "";
  if (confirmAcceptBtn) confirmAcceptBtn.textContent = acceptLabel || "Confirm";
  if (confirmBack) confirmBack.style.display = "flex";
}

function closeConfirm(){
  confirmAcceptAction = null;
  if (confirmBack) confirmBack.style.display = "none";
}

function bindPauseMenu(){
  if (pauseResumeBtn) pauseResumeBtn.onclick = () => resumeFromPause(null);
  if (pauseSettingsBtn) pauseSettingsBtn.onclick = () => openSettings();
  if (pauseSaveQuitBtn) {
    pauseSaveQuitBtn.onclick = () => {
      const saveData = game.createRunSaveData();
      writeRunSave(saveData);
      if (!game.isCustomMapRun) {
        updateMapProgressMaxWave(saveData.mapIndex, Math.max(saveData.resumeWave, saveData?.stats?.maxWaveSeen || 0));
      }
      updateContinueButton();
      closePauseMenuVisual();
      game.gameSpeed = 0;
      game.syncSpeedUI(0);
      showMainMenu();
    };
  }

  if (pauseMenuHandle && pauseMenuPanel) {
    pauseMenuHandle.addEventListener("pointerdown", (ev) => {
      if (ev.button !== 0) return;
      const rect = pauseMenuPanel.getBoundingClientRect();
      dragState = {
        id: ev.pointerId,
        offsetX: ev.clientX - rect.left,
        offsetY: ev.clientY - rect.top
      };
      pauseMenuPanel.style.transform = "none";
      if (pauseMenuPanel.setPointerCapture) pauseMenuPanel.setPointerCapture(ev.pointerId);
      ev.preventDefault();
    });
  }

  window.addEventListener("pointermove", (ev) => {
    if (!dragState || !pauseMenuPanel || dragState.id !== ev.pointerId) return;
    const maxX = window.innerWidth - pauseMenuPanel.offsetWidth - 8;
    const maxY = window.innerHeight - pauseMenuPanel.offsetHeight - 8;
    const x = clamp(ev.clientX - dragState.offsetX, 8, Math.max(8, maxX));
    const y = clamp(ev.clientY - dragState.offsetY, 8, Math.max(8, maxY));
    pauseMenuPanel.style.left = `${x}px`;
    pauseMenuPanel.style.top = `${y}px`;
    pauseMenuPanel.style.transform = "none";
  });

  const stopDrag = () => { dragState = null; };
  window.addEventListener("pointerup", stopDrag);
  window.addEventListener("pointercancel", stopDrag);
  window.addEventListener("resize", clampPausePanelToViewport);
}

function clampPausePanelToViewport(){
  if (!pauseMenuPanel) return;
  const rect = pauseMenuPanel.getBoundingClientRect();
  const maxX = window.innerWidth - rect.width - 8;
  const maxY = window.innerHeight - rect.height - 8;
  const x = clamp(rect.left, 8, Math.max(8, maxX));
  const y = clamp(rect.top, 8, Math.max(8, maxY));
  pauseMenuPanel.style.left = `${x}px`;
  pauseMenuPanel.style.top = `${y}px`;
  pauseMenuPanel.style.transform = "none";
}

function ensurePausePanelPosition(){
  if (!pauseMenuPanel) return;
  const rect = pauseMenuPanel.getBoundingClientRect();
  const x = clamp((window.innerWidth - rect.width) * 0.5, 8, Math.max(8, window.innerWidth - rect.width - 8));
  const y = clamp(window.innerHeight * 0.16, 8, Math.max(8, window.innerHeight - rect.height - 8));
  if (!pauseMenuPanel.dataset.positioned) {
    pauseMenuPanel.style.left = `${x}px`;
    pauseMenuPanel.style.top = `${y}px`;
    pauseMenuPanel.style.transform = "none";
    pauseMenuPanel.dataset.positioned = "1";
  }
}

function closePauseMenuVisual(){
  pauseMenuOpen = false;
  if (pauseMenuLayer) pauseMenuLayer.classList.remove("open");
}

function openPauseMenu(ctx){
  if (game.gameSpeed > 0) {
    pauseResumeSpeed = game.gameSpeed;
  } else if (ctx?.getLastNonZeroSpeed) {
    pauseResumeSpeed = Math.max(0.1, ctx.getLastNonZeroSpeed() || pauseResumeSpeed || 1.0);
  }
  pauseResumeSpeed = Math.max(0.1, pauseResumeSpeed || 1.0);

  if (ctx?.setLastNonZeroSpeed) ctx.setLastNonZeroSpeed(pauseResumeSpeed);
  if (ctx?.setSpeed) ctx.setSpeed(0);
  else {
    game.gameSpeed = 0;
    game.syncSpeedUI(0);
  }

  pauseMenuOpen = true;
  if (pauseMenuLayer) pauseMenuLayer.classList.add("open");
  ensurePausePanelPosition();
}

function resumeFromPause(ctx){
  if (!pauseMenuOpen) return;
  const resume = Math.max(0.1, pauseResumeSpeed || 1.0);
  closePauseMenuVisual();
  if (ctx?.setLastNonZeroSpeed) ctx.setLastNonZeroSpeed(resume);
  if (ctx?.setSpeed) ctx.setSpeed(resume);
  else {
    game.gameSpeed = resume;
    game.syncSpeedUI(resume);
  }
}

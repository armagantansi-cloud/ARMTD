import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const ROOT = process.cwd();

function read(rel){
  return readFileSync(join(ROOT, rel), "utf8");
}

function has(text, pattern){
  return pattern.test(text);
}

const checks = [];

function addCheck(name, pass, details = ""){
  checks.push({ name, pass, details });
}

function ensureFile(rel){
  addCheck(`file exists: ${rel}`, existsSync(join(ROOT, rel)));
}

ensureFile("game/content_registry.js");
ensureFile("game/progression.js");
ensureFile("game/events.js");
ensureFile("game/game.js");
ensureFile("game/main.js");
ensureFile("game/ui.js");
ensureFile("tools/phase2_smoke_checklist.md");

const game = read("game/game.js");
const main = read("game/main.js");
const ui = read("game/ui.js");
const registry = read("game/content_registry.js");
const progression = read("game/progression.js");
const events = read("game/events.js");

addCheck(
  "registry defines unified content entry point",
  has(registry, /const CONTENT_REGISTRY\s*=\s*Object\.freeze\(/)
    && has(registry, /towers:\s*Object\.freeze\(/)
    && has(registry, /maps:\s*Object\.freeze\(/)
    && has(registry, /enemies:\s*Object\.freeze\(/)
);

addCheck(
  "main/ui/game use content registry",
  has(game, /from "\.\/content_registry\.js"/)
    && has(main, /from "\.\/content_registry\.js"/)
    && has(ui, /from "\.\/content_registry\.js"/)
);

addCheck(
  "phase2 removed direct content table coupling in main/ui/game",
  !has(game, /import\s*\{[^}]*\bTOWER_DEFS\b[^}]*\}\s*from\s*"\.\/towers\.js"/)
    && !has(game, /import\s*\{[^}]*\bENEMY_TYPES\b[^}]*\}\s*from\s*"\.\/enemies\.js"/)
    && !has(game, /import\s*\{[^}]*\bMAP_POOL\b[^}]*\}\s*from\s*"\.\/map\.js"/)
    && !has(main, /import\s*\{[^}]*\bTOWER_DEFS\b[^}]*\}\s*from\s*"\.\/towers\.js"/)
    && !has(main, /import\s*\{[^}]*\bENEMY_TYPES\b[^}]*\}\s*from\s*"\.\/enemies\.js"/)
    && !has(main, /import\s*\{[^}]*\bMAP_POOL\b[^}]*\}\s*from\s*"\.\/map\.js"/)
    && !has(ui, /import\s*\{[^}]*\bTOWER_DEFS\b[^}]*\}\s*from\s*"\.\/towers\.js"/)
    && !has(ui, /import\s*\{[^}]*\bENEMY_TYPES\b[^}]*\}\s*from\s*"\.\/enemies\.js"/)
    && !has(ui, /import\s*\{[^}]*\bMAP_POOL\b[^}]*\}\s*from\s*"\.\/map\.js"/)
);

addCheck(
  "run save schema upgraded and migration path exists",
  has(game, /const RUN_SAVE_SCHEMA = 2;/)
    && has(game, /migrateRunSaveV1ToV2/)
    && has(game, /migrateRunSaveToCurrent/)
    && has(main, /createRunSaveData\(\)/)
);

addCheck(
  "progression module is connected to map/codex unlock gates",
  has(main, /from "\.\/progression\.js"/)
    && has(main, /isMapCardUnlockedByProgression/)
    && has(main, /isCodexEntryUnlockedByProgression/)
    && has(main, /syncMenuCodexEntryLocks\(/)
    && has(progression, /applyCampaignClearToProgression/)
);

addCheck(
  "event bus exists and runtime emits gameplay events",
  has(events, /createEventBus/)
    && has(game, /this\.events = createEventBus\(\)/)
    && has(game, /emitGameEvent\(GAME_EVENTS\.WAVE_STARTED/)
    && has(game, /emitGameEvent\(GAME_EVENTS\.WAVE_ENDED/)
    && has(game, /emitGameEvent\(GAME_EVENTS\.CAMPAIGN_CLEARED/)
);

addCheck(
  "main-menu progression flow subscribes to gameplay events",
  has(main, /game\.onEvent\(GAME_EVENTS\.CAMPAIGN_CLEARED,\s*handleCampaignClear\)/)
    && has(main, /game\.onEvent\(GAME_EVENTS\.GAME_OVER_MAIN_MENU,\s*handleGameOverMainMenu\)/)
);

const failed = checks.filter((c) => !c.pass);

for (const c of checks) {
  const prefix = c.pass ? "[ok] " : "[fail] ";
  console.log(prefix + c.name + (c.details ? ` (${c.details})` : ""));
}

if (failed.length) {
  console.error(`\n[check:phase2] failed ${failed.length}/${checks.length} checks`);
  process.exit(1);
}

console.log(`\n[check:phase2] passed ${checks.length}/${checks.length} checks`);

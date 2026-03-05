import { CFG } from "./config.js";
import { GAME_EVENTS } from "./events.js";
import { upgradeCostCurve } from "./towers.js";
import { CONTENT_REGISTRY } from "./content_registry.js";

const ARCHER_POS = Object.freeze({ x: 7, y: 5 });
const MAGE_POS = Object.freeze({ x: 8, y: 5 });
const TUTORIAL_STEP_ORDER = Object.freeze([
  "gold_intro",
  "core_intro",
  "wave_mobs_intro",
  "shop_intro",
  "archer_place_intro",
  "archer_stat_ad",
  "archer_stat_as",
  "archer_stat_range",
  "archer_stat_crit",
  "archer_stat_magic",
  "archer_stat_mana_regen",
  "archer_stat_mana_hit",
  "archer_power_shot_intro",
  "archer_upgrade_intro",
  "start_wave_intro",
  "enemy_select_intro",
  "enemy_hp_intro",
  "enemy_armor_intro",
  "enemy_speed_intro",
  "enemy_debuff_intro",
  "enemy_wealth_intro",
  "mage_place_intro",
  "mage_level_orb_intro",
  "fast_upgrade_intro",
  "special_upgrade_intro"
]);

function clamp(v, min, max){
  return Math.max(min, Math.min(max, v));
}

function rectFromElement(el){
  if (!(el instanceof Element)) return null;
  const r = el.getBoundingClientRect();
  if (!Number.isFinite(r.left) || r.width <= 0 || r.height <= 0) return null;
  return {
    left: r.left,
    top: r.top,
    right: r.right,
    bottom: r.bottom,
    width: r.width,
    height: r.height
  };
}

function normalizeRect(raw){
  if (!raw || typeof raw !== "object") return null;
  const left = Number(raw.left);
  const top = Number(raw.top);
  const width = Number(raw.width);
  const height = Number(raw.height);
  if (!Number.isFinite(left) || !Number.isFinite(top) || !Number.isFinite(width) || !Number.isFinite(height)) return null;
  if (width <= 0 || height <= 0) return null;
  return {
    left,
    top,
    width,
    height,
    right: left + width,
    bottom: top + height
  };
}

function viewportRect(){
  const w = Math.max(1, window.innerWidth || 0);
  const h = Math.max(1, window.innerHeight || 0);
  return { left: 0, top: 0, width: w, height: h, right: w, bottom: h };
}

function nearestRectCorner(rawRect, fromX, fromY){
  const r = normalizeRect(rawRect);
  if (!r) return null;
  const corners = [
    { x: r.left, y: r.top },
    { x: r.right, y: r.top },
    { x: r.left, y: r.bottom },
    { x: r.right, y: r.bottom }
  ];
  let best = corners[0];
  let bestD = Infinity;
  for (const corner of corners) {
    const dx = corner.x - fromX;
    const dy = corner.y - fromY;
    const d = (dx * dx) + (dy * dy);
    if (d < bestD) {
      bestD = d;
      best = corner;
    }
  }
  return best;
}

function inflateRect(rawRect, padX = 0, padY = padX){
  const r = normalizeRect(rawRect);
  if (!r) return null;
  const px = Math.max(0, Number(padX) || 0);
  const py = Math.max(0, Number(padY) || 0);
  return {
    left: r.left - px,
    top: r.top - py,
    right: r.right + px,
    bottom: r.bottom + py,
    width: r.width + px * 2,
    height: r.height + py * 2
  };
}

function unionRects(a, b){
  const ra = normalizeRect(a);
  const rb = normalizeRect(b);
  if (!ra) return rb;
  if (!rb) return ra;
  const left = Math.min(ra.left, rb.left);
  const top = Math.min(ra.top, rb.top);
  const right = Math.max(ra.right, rb.right);
  const bottom = Math.max(ra.bottom, rb.bottom);
  return {
    left,
    top,
    right,
    bottom,
    width: right - left,
    height: bottom - top
  };
}

function isPointInRect(x, y, rect){
  const r = normalizeRect(rect);
  if (!r) return false;
  return x >= r.left && x <= r.right && y >= r.top && y <= r.bottom;
}

function toRect(target){
  if (!target) return null;
  if (target instanceof Element) return rectFromElement(target);
  return normalizeRect(target);
}

function firstAliveEnemy(game){
  if (!game || !Array.isArray(game.enemies)) return null;
  for (const enemy of game.enemies) {
    if (!enemy?.dead && !enemy?.reachedExit) return enemy;
  }
  return null;
}

function gridRectToViewport(game, gx, gy, size = 1, options = {}){
  if (!game?.cv) return null;
  const cv = game.cv;
  const cvRect = cv.getBoundingClientRect();
  if (!cvRect || cvRect.width <= 0 || cvRect.height <= 0) return null;
  const tile = Number(game.tileSize) || 0;
  if (tile <= 0) return null;
  const sx = cvRect.width / Math.max(1, cv.width);
  const sy = cvRect.height / Math.max(1, cv.height);
  const x = cvRect.left + (game.offsetX + gx * tile) * sx;
  const y = cvRect.top + (game.offsetY + gy * tile) * sy;
  const baseW = Math.max(4, tile * Math.max(1, size) * sx);
  const baseH = Math.max(4, tile * Math.max(1, size) * sy);
  const stretchY = Math.max(1, Number(options?.stretchY) || 1.42);
  const extraH = baseH * (stretchY - 1);
  const yShift = extraH * 0.5;
  const top = y - yShift;
  const h = baseH + extraH;
  return { left: x, top, width: baseW, height: h, right: x + baseW, bottom: top + h };
}

function enemyRectToViewport(game, enemy){
  if (!game?.cv || !enemy) return null;
  const cvRect = game.cv.getBoundingClientRect();
  if (!cvRect || cvRect.width <= 0 || cvRect.height <= 0) return null;
  const tile = Number(game.tileSize) || 0;
  if (tile <= 0) return null;
  const sx = cvRect.width / Math.max(1, game.cv.width);
  const sy = cvRect.height / Math.max(1, game.cv.height);
  const cx = cvRect.left + (game.offsetX + enemy.x * tile) * sx;
  const cy = cvRect.top + (game.offsetY + enemy.y * tile) * sy;
  const r = Math.max(10, tile * 0.36 * Math.max(sx, sy));
  return {
    left: cx - r,
    top: cy - r,
    width: r * 2,
    height: r * 2,
    right: cx + r,
    bottom: cy + r
  };
}

function selectedInfoRowByLabel(labelText){
  const rows = Array.from(document.querySelectorAll("#selectedInfoHud .selRow"));
  const wanted = String(labelText || "").trim().toLowerCase();
  return rows.find((row) => {
    const key = row.querySelector(".k");
    if (!key) return false;
    const text = String(key.textContent || "").trim().toLowerCase();
    return text === wanted || text.startsWith(wanted);
  }) || null;
}

function selectedInfoRowsUnion(labels){
  let out = null;
  for (const label of labels) {
    out = unionRects(out, rectFromElement(selectedInfoRowByLabel(label)));
  }
  return out;
}

function hudStatCardRect(statValueId){
  const valueEl = document.getElementById(statValueId);
  if (!valueEl) return null;
  const card = valueEl.closest(".statItem");
  return rectFromElement(card || valueEl);
}

function normalizeCompletedStepIds(list){
  const out = [];
  const seen = new Set();
  if (!Array.isArray(list)) return out;
  for (const raw of list) {
    const id = String(raw || "").trim();
    if (!id || seen.has(id)) continue;
    seen.add(id);
    out.push(id);
  }
  return out;
}

function createOverlay(){
  const root = document.createElement("div");
  root.id = "tutorialOverlay";
  root.className = "tutorialOverlay hidden";
  root.innerHTML = `
    <div class="tutorialShade tutorialShadeTop"></div>
    <div class="tutorialShade tutorialShadeBottom"></div>
    <div class="tutorialShade tutorialShadeLeft"></div>
    <div class="tutorialShade tutorialShadeRight"></div>
    <div class="tutorialSpotlight"></div>
    <div class="tutorialArrow"></div>
    <div class="tutorialCard">
      <div class="tutorialCardTitle"></div>
      <div class="tutorialCardBody"></div>
      <div class="tutorialCardHint"></div>
    </div>
  `;
  document.body.appendChild(root);
  return {
    root,
    shades: {
      top: root.querySelector(".tutorialShadeTop"),
      bottom: root.querySelector(".tutorialShadeBottom"),
      left: root.querySelector(".tutorialShadeLeft"),
      right: root.querySelector(".tutorialShadeRight")
    },
    spotlight: root.querySelector(".tutorialSpotlight"),
    arrow: root.querySelector(".tutorialArrow"),
    card: root.querySelector(".tutorialCard"),
    cardTitle: root.querySelector(".tutorialCardTitle"),
    cardBody: root.querySelector(".tutorialCardBody"),
    cardHint: root.querySelector(".tutorialCardHint")
  };
}

function createTutorialController(options = {}){
  const game = options.game;
  const getSettings = (typeof options.getSettings === "function")
    ? options.getSettings
    : () => ({ tutorial: { enabled: true, completedStepIds: [] } });
  const commitSettings = (typeof options.commitSettings === "function")
    ? options.commitSettings
    : () => {};
  const isMainMenuOpen = (typeof options.isMainMenuOpen === "function")
    ? options.isMainMenuOpen
    : () => false;

  const overlay = createOverlay();
  const state = {
    gameplayVisible: false,
    activeStepId: null,
    activeStep: null,
    activeTargetRect: null,
    activeClickRect: null,
    pauseRestoreSpeed: 1,
    pauseOwned: false,
    runStartedAtMs: 0,
    rafId: 0,
    fastUpgradeAnchor: null,
    suppressAdvanceUntil: 0
  };

  const mageDef = (typeof CONTENT_REGISTRY?.towers?.get === "function")
    ? CONTENT_REGISTRY.towers.get("mage")
    : (CONTENT_REGISTRY?.towers?.byId instanceof Map
      ? CONTENT_REGISTRY.towers.byId.get("mage")
      : null);
  const mageCost = Math.max(0, Number(mageDef?.cost) || 0);
  const ctx = {
    game,
    getArcherTower: () => game.towers.find(t => t?.def?.id === "archer" && t.gx === ARCHER_POS.x && t.gy === ARCHER_POS.y) || null,
    getMageTower: () => game.towers.find(t => t?.def?.id === "mage" && t.gx === MAGE_POS.x && t.gy === MAGE_POS.y) || null,
    getAliveEnemy: () => firstAliveEnemy(game),
    isModalOpen: () => {
      const modalBack = document.getElementById("modalBack");
      return !!modalBack && modalBack.style.display === "flex";
    },
    getFastUpgradeAnchor: () => state.fastUpgradeAnchor
  };

  function listCompleted(){
    return normalizeCompletedStepIds(getSettings()?.tutorial?.completedStepIds);
  }

  function isCompleted(stepId){
    return listCompleted().includes(stepId);
  }

  function markCompleted(stepId){
    if (!stepId) return;
    const prev = listCompleted();
    if (prev.includes(stepId)) return;
    const next = [...prev, stepId];
    commitSettings((settings) => {
      if (!settings.tutorial || typeof settings.tutorial !== "object") settings.tutorial = {};
      settings.tutorial.completedStepIds = next;
    });
  }

  function isEnabled(){
    return getSettings()?.tutorial?.enabled !== false;
  }

  function shouldRunTutorial(){
    if (!state.gameplayVisible) return false;
    if (isMainMenuOpen()) return false;
    return isEnabled();
  }

  function setTutorialPause(active){
    if (active) {
      if (state.pauseOwned) return;
      state.pauseOwned = true;
      state.pauseRestoreSpeed = Math.max(0.1, Number(game.gameSpeed) || 1);
      game.gameSpeed = 0;
      game.syncSpeedUI(0);
      return;
    }
    if (!state.pauseOwned) return;
    state.pauseOwned = false;
    if (game.gameOver || isMainMenuOpen()) return;
    const restore = Math.max(0.1, Number(state.pauseRestoreSpeed) || 1);
    game.gameSpeed = restore;
    game.syncSpeedUI(restore);
  }

  function setTutorialSpecialChoiceMode(active){
    if (!game || typeof game !== "object") return;
    game.tutorialForceFixedSpecialChoices = !!active;
  }

  function hideOverlay(){
    overlay.root.classList.remove("visible");
    overlay.root.classList.add("hidden");
  }

  function showOverlay(){
    overlay.root.classList.add("visible");
    overlay.root.classList.remove("hidden");
  }

  function applyShadeRects(targetRect){
    const pad = 8;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const target = normalizeRect(targetRect)
      ? {
          left: clamp(targetRect.left - pad, 0, vw),
          top: clamp(targetRect.top - pad, 0, vh),
          right: clamp(targetRect.right + pad, 0, vw),
          bottom: clamp(targetRect.bottom + pad, 0, vh)
        }
      : null;
    if (!target || target.right <= target.left || target.bottom <= target.top) {
      overlay.shades.top.style.cssText = "left:0px;top:0px;width:0px;height:0px;";
      overlay.shades.bottom.style.cssText = "left:0px;top:0px;width:0px;height:0px;";
      overlay.shades.left.style.cssText = "left:0px;top:0px;width:0px;height:0px;";
      overlay.shades.right.style.cssText = "left:0px;top:0px;width:0px;height:0px;";
      overlay.spotlight.style.display = "none";
      return;
    }

    overlay.shades.top.style.cssText = `left:0px;top:0px;width:${vw}px;height:${Math.max(0, target.top)}px;`;
    overlay.shades.bottom.style.cssText = `left:0px;top:${target.bottom}px;width:${vw}px;height:${Math.max(0, vh - target.bottom)}px;`;
    overlay.shades.left.style.cssText = `left:0px;top:${target.top}px;width:${Math.max(0, target.left)}px;height:${Math.max(0, target.bottom - target.top)}px;`;
    overlay.shades.right.style.cssText = `left:${target.right}px;top:${target.top}px;width:${Math.max(0, vw - target.right)}px;height:${Math.max(0, target.bottom - target.top)}px;`;
    overlay.spotlight.style.display = "";
    overlay.spotlight.style.left = `${target.left}px`;
    overlay.spotlight.style.top = `${target.top}px`;
    overlay.spotlight.style.width = `${Math.max(8, target.right - target.left)}px`;
    overlay.spotlight.style.height = `${Math.max(8, target.bottom - target.top)}px`;
  }

  function positionCardAndArrow(targetRect){
    const card = overlay.card;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const target = normalizeRect(targetRect);
    if (!target) {
      card.style.left = `${Math.max(12, (vw - card.offsetWidth) * 0.5)}px`;
      card.style.top = `${Math.max(12, vh - card.offsetHeight - 16)}px`;
      overlay.arrow.style.display = "none";
      return;
    }

    const pad = 14;
    const gap = 26;
    const cardW = Math.min(400, Math.max(280, Math.floor(vw * 0.40)));
    card.style.width = `${cardW}px`;

    const targetCx = target.left + target.width / 2;
    const targetCy = target.top + target.height / 2;
    const preferRight = targetCx < vw * 0.56;
    let x = preferRight ? (target.right + gap) : (target.left - cardW - gap);
    if (!preferRight) x -= 72;
    x += 24;
    x = clamp(x, pad, vw - cardW - pad);

    let y = clamp(targetCy - 120, pad, vh - card.offsetHeight - pad);
    const nearHorizontal = Math.abs((x + cardW / 2) - targetCx) < 120;
    if (nearHorizontal) {
      y = targetCy < (vh * 0.55)
        ? clamp(target.bottom + gap, pad, vh - card.offsetHeight - pad)
        : clamp(target.top - card.offsetHeight - gap, pad, vh - card.offsetHeight - pad);
      x = clamp(targetCx - cardW / 2, pad, vw - cardW - pad);
    }

    card.style.left = `${x}px`;
    card.style.top = `${y}px`;

    const cardRect = card.getBoundingClientRect();
    let startX = cardRect.left + cardRect.width * 0.5;
    let startY = cardRect.top + cardRect.height * 0.5;

    if (cardRect.right <= target.left) {
      startX = cardRect.right;
      startY = clamp(target.top + 16, cardRect.top + 12, cardRect.bottom - 12);
    } else if (cardRect.left >= target.right) {
      startX = cardRect.left;
      startY = clamp(target.top + 16, cardRect.top + 12, cardRect.bottom - 12);
    } else if (cardRect.bottom <= target.top) {
      startX = clamp(target.left + 16, cardRect.left + 12, cardRect.right - 12);
      startY = cardRect.bottom;
    } else if (cardRect.top >= target.bottom) {
      startX = clamp(target.left + 16, cardRect.left + 12, cardRect.right - 12);
      startY = cardRect.top;
    }

    const nearestCorner = nearestRectCorner(target, startX, startY);
    if (!nearestCorner) {
      overlay.arrow.style.display = "none";
      return;
    }
    const endX = nearestCorner.x;
    const endY = nearestCorner.y;

    const dx = endX - startX;
    const dy = endY - startY;
    const len = Math.hypot(dx, dy);
    if (!Number.isFinite(len) || len < 6) {
      overlay.arrow.style.display = "none";
      return;
    }
    const angle = Math.atan2(dy, dx) * (180 / Math.PI);
    overlay.arrow.style.display = "";
    overlay.arrow.style.left = `${startX}px`;
    overlay.arrow.style.top = `${startY}px`;
    overlay.arrow.style.width = `${len}px`;
    overlay.arrow.style.transform = `rotate(${angle}deg)`;
  }

  function findFastUpgradeAnchor(){
    const selected = game.selectedTowerInstance;
    const towers = Array.isArray(game.towers) ? game.towers : [];
    const ordered = selected ? [selected, ...towers.filter(t => t !== selected)] : towers;
    for (const tower of ordered) {
      if (!tower || typeof tower.canUpgrade !== "function") continue;
      if (!tower.canUpgrade()) continue;
      const target = Math.min(CFG.TOWER_MAX_LEVEL, (Math.floor(tower.level / 5) + 1) * 5);
      if (tower.level >= target) continue;
      let total = 0;
      for (let lvl = tower.level; lvl < target; lvl += 1) {
        const stepCost = (lvl === CFG.TOWER_MAX_LEVEL - 1)
          ? upgradeCostCurve(tower.def.cost, lvl) * 2
          : upgradeCostCurve(tower.def.cost, lvl);
        total += stepCost;
      }
      if (total <= 0) continue;
      if (game.gold < total) continue;
      return {
        towerId: tower.def?.id || null,
        gx: tower.gx,
        gy: tower.gy,
        cost: total
      };
    }
    return null;
  }

  function ensureTowerSelectedByAnchor(anchor){
    if (!anchor) return;
    const t = game.towers.find((tw) => tw?.def?.id === anchor.towerId && tw.gx === anchor.gx && tw.gy === anchor.gy);
    if (!t) return;
    game.selectedEnemy = null;
    game.selectedTowerDef = null;
    game.selectedTowerInstance = t;
    game.refreshUI(true);
  }

  function createTowerRowClickStep({ title, body, label }){
    return {
      title,
      body,
      hint: "Click the highlighted stat row.",
      ready: () => !!ctx.getArcherTower(),
      onActivate: () => {
        const archer = ctx.getArcherTower();
        if (!archer) return;
        game.selectedEnemy = null;
        game.selectedTowerDef = null;
        game.selectedTowerInstance = archer;
        game.refreshUI(true);
      },
      target: () => selectedInfoRowByLabel(label),
      clickToComplete: true,
      consumeClick: true
    };
  }

  function createEnemyRowClickStep({ title, body }, labels){
    return {
      title,
      body,
      hint: "Click the highlighted row.",
      ready: () => !!game.selectedEnemy && !game.selectedEnemy.dead && !game.selectedEnemy.reachedExit,
      target: () => selectedInfoRowsUnion(labels),
      clickToComplete: true,
      consumeClick: true
    };
  }

  function stepDefs(){
    return {
      gold_intro: {
        title: "Gold",
        body: "Gold is your main resource. You earn it from enemy kills and some tower skills. Use it for tower purchases and upgrades.",
        hint: "Click the highlighted Gold value.",
        ready: () => !game.started,
        target: () => hudStatCardRect("hud_gold"),
        clickToComplete: true,
        consumeClick: true
      },
      core_intro: {
        title: "Core",
        body: "Core is your health. Normal enemies deal 1 damage, bosses deal 5. If Core reaches zero, the run ends. After wave 100, Core damage scales much harder.",
        hint: "Click the highlighted Core value.",
        ready: () => !game.started,
        target: () => hudStatCardRect("hud_corehp"),
        clickToComplete: true,
        consumeClick: true
      },
      wave_mobs_intro: {
        title: "Wave & Mobs",
        body: "Wave shows your current wave. Mobs shows alive and remaining enemies for the current wave flow. Every 10th wave is a boss wave.",
        hint: "Click the highlighted Wave/Mobs area.",
        ready: () => !game.started,
        target: () => unionRects(hudStatCardRect("hud_wave"), hudStatCardRect("hud_mobs")),
        clickToComplete: true,
        consumeClick: true
      },
      shop_intro: {
        title: "Tower Shop",
        body: "Build towers from this shop. Different towers provide different roles, so composition and placement matter.",
        hint: "Click the highlighted shop section.",
        ready: () => !game.started,
        target: () => document.querySelector(".shopPanel > h2"),
        clickTarget: () => document.querySelector(".shopPanel"),
        clickToComplete: true,
        consumeClick: true
      },
      archer_place_intro: {
        title: "Place Archer Tower",
        body: () => (game.selectedTowerDef?.id === "archer")
          ? "Now place Archer at the highlighted tile."
          : "Select Archer Tower in the shop first.",
        hint: () => (game.selectedTowerDef?.id === "archer")
          ? "Place Archer on the highlighted tile."
          : "Click Archer in the shop.",
        ready: () => !game.started,
        target: () => {
          if (game.selectedTowerDef?.id === "archer") return gridRectToViewport(game, ARCHER_POS.x, ARCHER_POS.y, 1, { stretchY: 1.55 });
          const archerBtn = document.querySelector('#shop .towerBtn[data-theme="archer"]');
          return inflateRect(rectFromElement(archerBtn), 14, 10);
        },
        clickTarget: () => {
          if (game.selectedTowerDef?.id === "archer") return gridRectToViewport(game, ARCHER_POS.x, ARCHER_POS.y, 1, { stretchY: 1.55 });
          return rectFromElement(document.querySelector('#shop .towerBtn[data-theme="archer"]'));
        },
        allowAction: (actionId, payload) => {
          if (actionId === "set_game_speed") return false;
          if (actionId === "shop_select_tower") return payload?.towerId === "archer";
          if (actionId === "canvas_place_tower") {
            return payload?.towerId === "archer" && payload?.gx === ARCHER_POS.x && payload?.gy === ARCHER_POS.y;
          }
          return false;
        },
        onAction: (actionId, payload) => (
          actionId === "canvas_place_tower"
          && payload?.towerId === "archer"
          && payload?.gx === ARCHER_POS.x
          && payload?.gy === ARCHER_POS.y
        ),
        onEvent: (eventName, payload) => (
          eventName === GAME_EVENTS.TOWER_BUILT
          && payload?.towerId === "archer"
          && payload?.gx === ARCHER_POS.x
          && payload?.gy === ARCHER_POS.y
        )
      },
      archer_stat_ad: createTowerRowClickStep({
        title: "AD",
        body: "AD is the core auto-attack stat. Archer deals random damage inside this range on each shot.",
        label: "AD"
      }),
      archer_stat_as: createTowerRowClickStep({
        title: "AS",
        body: "AS is attacks per second. Higher AS means more hits and faster mana gain from hits.",
        label: "AS"
      }),
      archer_stat_range: createTowerRowClickStep({
        title: "Range",
        body: "Range determines how far the tower can target enemies.",
        label: "Range"
      }),
      archer_stat_crit: createTowerRowClickStep({
        title: "Crit",
        body: "Crit shows critical hit chance and crit multiplier.",
        label: "Crit"
      }),
      archer_stat_magic: createTowerRowClickStep({
        title: "Magic",
        body: "Magic is the main scaling source for standard skills and can also support auto-attack related effects.",
        label: "Magic"
      }),
      archer_stat_mana_regen: createTowerRowClickStep({
        title: "Mana Regen",
        body: "Mana Regen is passive mana gained per second for skill casting.",
        label: "Mana Regen"
      }),
      archer_stat_mana_hit: createTowerRowClickStep({
        title: "Mana/Hit",
        body: "Mana/Hit is mana gained from each auto attack. Faster attack speed triggers it more often.",
        label: "Mana/Hit"
      }),
      archer_power_shot_intro: {
        title: "Power Shot",
        body: "When Archer mana is full, it uses Power Shot. The next shot deals x2.6 damage. Combined with Crit, it can produce high burst.",
        hint: "Click Archer on the highlighted tile.",
        ready: () => !!ctx.getArcherTower(),
        target: () => gridRectToViewport(game, ARCHER_POS.x, ARCHER_POS.y, 1, { stretchY: 1.55 }),
        allowAction: (actionId, payload) => (
          actionId === "canvas_select_tower"
          && payload?.towerId === "archer"
          && payload?.gx === ARCHER_POS.x
          && payload?.gy === ARCHER_POS.y
        ),
        onAction: (actionId, payload) => (
          actionId === "canvas_select_tower"
          && payload?.towerId === "archer"
          && payload?.gx === ARCHER_POS.x
          && payload?.gy === ARCHER_POS.y
        )
      },
      archer_upgrade_intro: {
        title: "Upgrade",
        body: "Upgrade strengthens this tower and improves all base combat stats.",
        hint: "Use the highlighted Upgrade button.",
        ready: () => {
          const tower = ctx.getArcherTower();
          if (!tower) return false;
          if (!tower.canUpgrade()) return false;
          return game.gold >= tower.upgradeCost();
        },
        onActivate: () => {
          const tower = ctx.getArcherTower() || game.towers.find(t => t?.def?.id === "archer") || null;
          if (!tower) return;
          game.selectedEnemy = null;
          game.selectedTowerDef = null;
          game.selectedTowerInstance = tower;
          game.refreshUI(true);
        },
        onRender: () => {
          const tower = ctx.getArcherTower() || game.towers.find(t => t?.def?.id === "archer") || null;
          if (!tower) return;
          if (game.selectedTowerInstance !== tower || game.selectedEnemy || game.selectedTowerDef) {
            game.selectedEnemy = null;
            game.selectedTowerDef = null;
            game.selectedTowerInstance = tower;
            game.refreshUI(true);
          }
          const upBtn = document.getElementById("upgradeBtnHud");
          if (upBtn && tower.canUpgrade() && game.gold >= tower.upgradeCost()) {
            upBtn.disabled = false;
          }
        },
        target: () => document.getElementById("upgradeBtnHud"),
        allowAction: () => true,
        onAction: (actionId, payload) => (
          actionId === "upgrade_selected_tower"
          && payload?.towerId === "archer"
          && Number(payload?.toLevel) > Number(payload?.fromLevel)
        ),
        onEvent: (eventName, payload) => eventName === GAME_EVENTS.TOWER_LEVEL_UP && payload?.towerId === "archer"
      },
      start_wave_intro: {
        title: "Start",
        body: "Start begins the wave and sends enemies.",
        hint: "Click Start.",
        ready: () => !game.started,
        target: () => document.getElementById("startWaveBtn"),
        autoComplete: () => !!game.started,
        clickToComplete: true,
        consumeClick: false,
        allowAction: (actionId) => actionId === "start_wave_button" || actionId === "start_wave",
        onAction: (actionId) => actionId === "start_wave_button" || actionId === "start_wave",
        onEvent: (eventName) => eventName === GAME_EVENTS.RUN_STARTED
      },
      enemy_select_intro: {
        title: "Enemy Select",
        body: "Enemies are now on the field. Select one enemy to inspect its stats.",
        hint: "Click the highlighted enemy.",
        ready: () => {
          if (!game.started) return false;
          const alive = ctx.getAliveEnemy();
          if (!alive) return false;
          return (performance.now() - state.runStartedAtMs) >= 1000;
        },
        target: () => enemyRectToViewport(game, ctx.getAliveEnemy()),
        allowAction: (actionId) => actionId === "canvas_select_enemy",
        onAction: (actionId) => actionId === "canvas_select_enemy"
      },
      enemy_hp_intro: createEnemyRowClickStep({ title: "Enemy HP", body: "HP is enemy health. When HP reaches zero, the enemy dies." }, ["HP"]),
      enemy_armor_intro: createEnemyRowClickStep({ title: "Enemy Armor", body: "Armor blocks part of incoming physical damage." }, ["Armor"]),
      enemy_speed_intro: createEnemyRowClickStep({ title: "Enemy Speed", body: "Speed determines how fast the enemy moves toward your Core." }, ["Speed"]),
      enemy_debuff_intro: createEnemyRowClickStep({ title: "Slow, Root, Poison", body: "These rows show active debuff states." }, ["Slow", "Root", "Poison"]),
      enemy_wealth_intro: createEnemyRowClickStep({ title: "Enemy Wealth", body: "Wealth is gold rewarded when this enemy dies." }, ["Wealth"]),
      mage_place_intro: {
        title: "Place Mage Tower",
        body: () => (game.selectedTowerDef?.id === "mage")
          ? "Place Mage on the highlighted tile to the right of Archer."
          : "Mage is now affordable. Select Mage in the shop.",
        hint: () => (game.selectedTowerDef?.id === "mage")
          ? "Place Mage on the highlighted tile."
          : "Click Mage in the shop.",
        ready: () => {
          if (!game.started) return false;
          if (!ctx.getArcherTower()) return false;
          if (ctx.getMageTower()) return false;
          return game.gold >= mageCost;
        },
        target: () => {
          if (game.selectedTowerDef?.id === "mage") return gridRectToViewport(game, MAGE_POS.x, MAGE_POS.y, 1, { stretchY: 1.55 });
          return document.querySelector('#shop .towerBtn[data-theme="mage"]');
        },
        allowAction: (actionId, payload) => {
          if (actionId === "shop_select_tower") return payload?.towerId === "mage";
          if (actionId === "canvas_place_tower") {
            return payload?.towerId === "mage" && payload?.gx === MAGE_POS.x && payload?.gy === MAGE_POS.y;
          }
          return false;
        },
        onAction: (actionId, payload) => (
          actionId === "canvas_place_tower"
          && payload?.towerId === "mage"
          && payload?.gx === MAGE_POS.x
          && payload?.gy === MAGE_POS.y
        ),
        onEvent: (eventName, payload) => (
          eventName === GAME_EVENTS.TOWER_BUILT
          && payload?.towerId === "mage"
          && payload?.gx === MAGE_POS.x
          && payload?.gy === MAGE_POS.y
        )
      },
      mage_level_orb_intro: {
        title: "Level Orb",
        body: "This orb shows tower level. The fill behind it shows how close the tower is to skill cast.",
        hint: "Click anywhere to continue.",
        ready: () => {
          const mage = ctx.getMageTower();
          if (!mage) return false;
          return (mage.mana || 0) >= 15;
        },
        target: () => gridRectToViewport(game, MAGE_POS.x, MAGE_POS.y, 1, { stretchY: 1.55 }),
        clickTarget: () => viewportRect(),
        clickToComplete: true,
        consumeClick: true
      },
      fast_upgrade_intro: {
        title: "Fast Upgrade",
        body: "Fast Upgrade pushes a tower to the next level milestone in one click.",
        hint: "Click Fast Upgrade.",
        ready: () => {
          state.fastUpgradeAnchor = findFastUpgradeAnchor();
          return !!state.fastUpgradeAnchor;
        },
        onActivate: () => ensureTowerSelectedByAnchor(state.fastUpgradeAnchor),
        target: () => document.getElementById("fastUpgradeBtnHud"),
        allowAction: (actionId) => actionId === "fast_upgrade_selected_tower",
        onAction: (actionId, payload) => (
          actionId === "fast_upgrade_selected_tower"
          && Number(payload?.toLevel) > Number(payload?.fromLevel)
        )
      },
      special_upgrade_intro: {
        title: "Special Upgrades",
        body: "Towers receive Special Upgrades at levels 5, 10, 15 and 20. Attack Damage and Attack Speed improve their stats directly. Magic increases skill scaling. Hover options to preview impacts in Selected.",
        hint: "Click the highlighted Special Upgrade panel.",
        ready: () => ctx.isModalOpen(),
        autoComplete: () => !ctx.isModalOpen(),
        onActivate: () => {
          document.body.classList.add("tutorialSpecialSelectedPeek");
        },
        onDeactivate: () => {
          document.body.classList.remove("tutorialSpecialSelectedPeek");
        },
        target: () => document.querySelector("#modalBack .modal"),
        onEvent: (eventName) => eventName === GAME_EVENTS.TOWER_SPECIAL_UPGRADE_CHOSEN
      }
    };
  }

  function deactivateActiveStep(){
    const current = state.activeStep;
    if (current && typeof current.onDeactivate === "function") {
      try { current.onDeactivate(ctx); } catch (_) {}
    }
    state.activeStepId = null;
    state.activeStep = null;
    state.activeTargetRect = null;
    state.activeClickRect = null;
    hideOverlay();
    setTutorialPause(false);
    setTutorialSpecialChoiceMode(false);
  }

  function activateStep(stepId, step){
    if (!stepId || !step) return;
    if (state.activeStepId === stepId) return;
    deactivateActiveStep();
    state.activeStepId = stepId;
    state.activeStep = step;
    if (typeof step.onActivate === "function") {
      try { step.onActivate(ctx); } catch (_) {}
    }
    if (step.pause !== false) setTutorialPause(true);
    else setTutorialPause(false);
    renderActiveStep();
  }

  function resolveStepText(step, key){
    const raw = step?.[key];
    if (typeof raw === "function") return String(raw(ctx) || "");
    return String(raw || "");
  }

  function renderActiveStep(){
    const step = state.activeStep;
    if (!step) {
      hideOverlay();
      return;
    }
    if (typeof step.onRender === "function") {
      try { step.onRender(ctx); } catch (_) {}
    }
    const target = toRect(typeof step.target === "function" ? step.target(ctx) : step.target);
    const clickTarget = toRect(typeof step.clickTarget === "function" ? step.clickTarget(ctx) : (step.clickTarget || target));
    state.activeTargetRect = target;
    state.activeClickRect = clickTarget || target;
    overlay.cardTitle.textContent = resolveStepText(step, "title");
    overlay.cardBody.textContent = resolveStepText(step, "body");
    overlay.cardHint.textContent = resolveStepText(step, "hint");
    applyShadeRects(target);
    showOverlay();
    positionCardAndArrow(target);
    overlay.arrow.style.display = "none";
  }

  function completeActiveStep(reason){
    const stepId = state.activeStepId;
    if (!stepId) return;
    markCompleted(stepId);
    state.suppressAdvanceUntil = performance.now() + 20;
    deactivateActiveStep();
    void reason;
  }

  function nextPendingStep(){
    const defs = stepDefs();
    for (const stepId of TUTORIAL_STEP_ORDER) {
      if (isCompleted(stepId)) continue;
      const step = defs[stepId];
      if (!step) continue;
      const ready = (typeof step.ready === "function") ? !!step.ready(ctx) : true;
      if (!ready) return null;
      return { stepId, step };
    }
    return null;
  }

  function runScheduler(){
    if (!shouldRunTutorial()) {
      deactivateActiveStep();
      return;
    }
    if (performance.now() < state.suppressAdvanceUntil) {
      if (state.activeStep) renderActiveStep();
      return;
    }
    if (state.activeStepId) {
      const autoDone = (typeof state.activeStep?.autoComplete === "function")
        ? !!state.activeStep.autoComplete(ctx)
        : false;
      if (autoDone) {
        completeActiveStep("auto");
        return;
      }
      renderActiveStep();
      return;
    }
    const next = nextPendingStep();
    if (!next) {
      deactivateActiveStep();
      return;
    }
    activateStep(next.stepId, next.step);
  }

  function frameLoop(){
    runScheduler();
    state.rafId = requestAnimationFrame(frameLoop);
  }

  function canAction(actionId, payload){
    if (!shouldRunTutorial()) return true;
    if (!state.activeStep) return true;
    if (actionId === "set_game_speed") return false;
    const step = state.activeStep;
    if (typeof step.allowAction !== "function") return false;
    try {
      return step.allowAction(actionId, payload || {}, ctx) !== false;
    } catch (_) {
      return false;
    }
  }

  function onAction(actionId, payload){
    if (!shouldRunTutorial()) return;
    if (!state.activeStep) return;
    const step = state.activeStep;
    if (typeof step.onAction !== "function") return;
    let done = false;
    try {
      done = !!step.onAction(actionId, payload || {}, ctx);
    } catch (_) {
      done = false;
    }
    if (done) completeActiveStep(`action:${actionId}`);
    else renderActiveStep();
  }

  function onEvent(eventName, payload){
    if (eventName === GAME_EVENTS.RUN_STARTED) {
      state.runStartedAtMs = performance.now();
    }
    if (eventName === GAME_EVENTS.TOWER_SPECIAL_UPGRADE_OPENED) {
      const forceFixed = shouldRunTutorial() && !isCompleted("special_upgrade_intro");
      setTutorialSpecialChoiceMode(forceFixed);
    } else if (eventName === GAME_EVENTS.TOWER_SPECIAL_UPGRADE_CHOSEN) {
      setTutorialSpecialChoiceMode(false);
    }
    if (!shouldRunTutorial()) return;
    if (!state.activeStep) return;
    const step = state.activeStep;
    if (typeof step.onEvent !== "function") return;
    let done = false;
    try {
      done = !!step.onEvent(eventName, payload || {}, ctx);
    } catch (_) {
      done = false;
    }
    if (done) completeActiveStep(`event:${eventName}`);
    else renderActiveStep();
  }

  function onGlobalPointerDown(ev){
    if (!state.activeStep) return;
    if (!shouldRunTutorial()) return;
    const step = state.activeStep;
    if (!step.clickToComplete) return;
    const rect = state.activeClickRect || state.activeTargetRect;
    if (!rect) return;
    const inside = isPointInRect(ev.clientX, ev.clientY, rect);
    if (!inside) {
      ev.preventDefault();
      ev.stopPropagation();
      return;
    }
    if (step.consumeClick !== false) {
      ev.preventDefault();
      ev.stopPropagation();
    }
    completeActiveStep("click");
  }

  function onEnterGameplay(){
    state.gameplayVisible = true;
    state.suppressAdvanceUntil = 0;
    runScheduler();
  }

  function onEnterMainMenu(){
    state.gameplayVisible = false;
    deactivateActiveStep();
  }

  function resetProgress(){
    commitSettings((settings) => {
      if (!settings.tutorial || typeof settings.tutorial !== "object") settings.tutorial = {};
      settings.tutorial.completedStepIds = [];
    });
    state.suppressAdvanceUntil = 0;
    deactivateActiveStep();
    runScheduler();
  }

  function handleSettingsChanged(){
    state.suppressAdvanceUntil = 0;
    if (!isEnabled()) deactivateActiveStep();
    else runScheduler();
  }

  const unsubs = [
    game.onEvent(GAME_EVENTS.RUN_STARTED, (payload) => onEvent(GAME_EVENTS.RUN_STARTED, payload)),
    game.onEvent(GAME_EVENTS.TOWER_BUILT, (payload) => onEvent(GAME_EVENTS.TOWER_BUILT, payload)),
    game.onEvent(GAME_EVENTS.TOWER_LEVEL_UP, (payload) => onEvent(GAME_EVENTS.TOWER_LEVEL_UP, payload)),
    game.onEvent(GAME_EVENTS.TOWER_SPECIAL_UPGRADE_OPENED, (payload) => onEvent(GAME_EVENTS.TOWER_SPECIAL_UPGRADE_OPENED, payload)),
    game.onEvent(GAME_EVENTS.TOWER_SPECIAL_UPGRADE_CHOSEN, (payload) => onEvent(GAME_EVENTS.TOWER_SPECIAL_UPGRADE_CHOSEN, payload)),
    game.onEvent(GAME_EVENTS.WAVE_STARTED, (payload) => onEvent(GAME_EVENTS.WAVE_STARTED, payload))
  ];

  window.addEventListener("pointerdown", onGlobalPointerDown, true);
  frameLoop();

  return Object.freeze({
    canAction,
    onAction,
    onEnterGameplay,
    onEnterMainMenu,
    resetProgress,
    handleSettingsChanged,
    destroy(){
      if (state.rafId) cancelAnimationFrame(state.rafId);
      window.removeEventListener("pointerdown", onGlobalPointerDown, true);
      for (const off of unsubs) {
        try { off(); } catch (_) {}
      }
      deactivateActiveStep();
      if (overlay.root?.parentNode) overlay.root.parentNode.removeChild(overlay.root);
    }
  });
}

export { createTutorialController, TUTORIAL_STEP_ORDER };

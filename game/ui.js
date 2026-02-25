import { CFG } from "./config.js";
import { MILESTONES, setSpecialLegendaryMode } from "./towers.js";
import { SFX } from "./audio.js";
import { DEFAULT_KEYBINDS, TOWER_SHORTCUT_ACTIONS, isActionPressed } from "./preferences.js";
import { CONTENT_REGISTRY } from "./content_registry.js";

let modalBack = null;
let modalTitle = null;
let modalSub = null;
let choiceGrid = null;
let modalOpen = false;
let modalOnPick = null;
let modalOnHover = null;

function setSelectedHudModalFocus(active){
  const selectedHud = document.getElementById("hudSelected");
  if (!selectedHud) return;
  selectedHud.classList.toggle("modalSelectedFocus", !!active);
}

function initModal(){
  if (modalBack) return;
  modalBack = document.getElementById("modalBack");
  modalTitle = document.getElementById("modalTitle");
  modalSub = document.getElementById("modalSub");
  choiceGrid = document.getElementById("choiceGrid");
}

export function isModalOpen(){
  return modalOpen;
}

export function openModal(title, sub, choices, onPick, onHover){
  initModal();
  modalOpen=true;
  modalOnHover = (typeof onHover === "function") ? onHover : null;
  modalTitle.innerHTML=title;
  modalSub.textContent=sub;
  choiceGrid.innerHTML="";
  setSelectedHudModalFocus(true);
  let lastHoverIdx = -1;
  const updateHover = (idx) => {
    if (idx === lastHoverIdx) return;
    lastHoverIdx = idx;
    if (!modalOnHover) return;
    modalOnHover((idx >= 0 && idx < choices.length) ? choices[idx] : null);
  };

  for(let i=0; i<choices.length; i+=1){
    const c = choices[i];
    const btn=document.createElement("div");
    const rarityClass = c?.rarityId ? `rarity-${c.rarityId}` : "";
    btn.className = `choiceBtn ${rarityClass}`.trim();
    btn.dataset.choiceIdx = String(i);
    btn.innerHTML = `
      <div class="choiceTitle">${c.title}</div>
      <div class="choiceBody">${c.body}</div>
    `;
    btn.onclick=()=>{
      updateHover(-1);
      if(modalOnPick) modalOnPick(c);
    };
    choiceGrid.appendChild(btn);
  }
  choiceGrid.onpointermove = (ev) => {
    const target = ev.target;
    if (!(target instanceof Element)) return;
    const card = target.closest(".choiceBtn");
    if (!card) { updateHover(-1); return; }
    const idx = Number(card.dataset.choiceIdx);
    updateHover(Number.isFinite(idx) ? idx : -1);
  };
  choiceGrid.onpointerleave = () => updateHover(-1);

  modalOnPick=onPick;
  modalBack.style.display="flex";
}

export function closeModal(){
  modalOpen=false;
  modalOnPick=null;
  if (modalOnHover) modalOnHover(null);
  modalOnHover = null;
  if (choiceGrid) {
    choiceGrid.onpointermove = null;
    choiceGrid.onpointerleave = null;
  }
  setSelectedHudModalFocus(false);
  modalBack.style.display="none";
}

export function initUI(game, options={}){
  initModal();
  const getKeybinds = () => (typeof options.getKeybinds === "function"
    ? options.getKeybinds()
    : DEFAULT_KEYBINDS);
  const actionPressed = (actionId, ev) => isActionPressed(actionId, ev, getKeybinds());

  if (!window.__armtdClickSfxBound) {
    window.__armtdClickSfxBound = true;
    document.addEventListener("pointerdown", (ev) => {
      if (ev.button !== 0) return;
      const target = ev.target;
      if (!(target instanceof Element)) return;
      const hit = target.closest("button, .choiceBtn, canvas");
      if (!hit) return;
      if (hit.matches("button:disabled")) return;
      SFX.click();
    }, true);
  }

  const shop=document.getElementById("shop");
  const shopButtons=[];
  const cheatPanel = document.getElementById("cheatPanel");
  const cheatGoldBtn = document.getElementById("cheatGoldBtn");
  const cheatHpBtn = document.getElementById("cheatHpBtn");
  const cheatLegendaryBtn = document.getElementById("cheatLegendaryBtn");
  const cheatWaveInput = document.getElementById("cheatWaveInput");
  const cheatWaveGoBtn = document.getElementById("cheatWaveGoBtn");
  const cheatSpeed10Btn = document.getElementById("cheatSpeed10Btn");
  const infoModalToggle = document.getElementById("infoModalToggle");
  const getOrderedTowerDefs = () => CONTENT_REGISTRY.towers.orderedList();
  let forceLegendary = false;
  function renderShop(){
    shop.innerHTML="";
    shopButtons.length=0;
    const markMap = {
      peel: "PL",
      archer: "AR",
      mage: "MG",
      breaker: "BR",
      blizzard: "BZ",
      poison: "PS",
      sniper: "SN"
    };
    const defs = getOrderedTowerDefs();
    for(let i=0; i<defs.length; i++){
      const def = defs[i];
      const btn=document.createElement("button");
      btn.className="towerBtn";
      btn.dataset.theme = def.id;
      btn.dataset.mark = markMap[def.id] || def.name.slice(0,2).toUpperCase();
      btn.innerHTML=`
        <div class="towerHead">
          <div class="towerName">${def.name}</div>
          <div class="towerCost">${def.cost}</div>
        </div>
        <div class="towerSkill">${def.skillName}</div>
      `;
      btn.onclick=()=>selectTower(def, btn);
      shop.appendChild(btn);
      shopButtons.push(btn);
    }
  }
  renderShop();

  document.getElementById("startWaveBtn").onclick = () => game.start();
  document.getElementById("nextWaveNowBtn").onclick = () => game.nextWaveNow();
  const nextMapBtn = document.getElementById("nextMapBtn");
  if (nextMapBtn) nextMapBtn.onclick = () => game.changeMap();
  if (cheatGoldBtn) cheatGoldBtn.onclick = () => { game.gold += 1000000; game.refreshUI(true); };
  if (cheatHpBtn) cheatHpBtn.onclick = () => { game.coreHP += 1000; game.refreshUI(true); };
  if (cheatLegendaryBtn) {
    cheatLegendaryBtn.onclick = () => {
      forceLegendary = !forceLegendary;
      setSpecialLegendaryMode(forceLegendary);
      cheatLegendaryBtn.classList.toggle("active", forceLegendary);
      cheatLegendaryBtn.textContent = forceLegendary ? "Legendary ON" : "Legendary";
    };
  }
  if (cheatWaveGoBtn && cheatWaveInput) {
    cheatWaveGoBtn.onclick = () => {
      const w = Math.max(1, parseInt(cheatWaveInput.value || "1", 10) || 1);
      game.jumpToWaveForTest(w);
      game.refreshUI(true);
    };
  }
  if (cheatSpeed10Btn) {
    cheatSpeed10Btn.onclick = () => {
      setSpeed(10, { allowCheat: true });
      game.refreshUI(true);
    };
  }
  if (infoModalToggle) {
    const syncInfoBtn = () => {
      infoModalToggle.classList.toggle("on", !!game.infoModalsEnabled);
      infoModalToggle.title = game.infoModalsEnabled ? "Info Modals: ON" : "Info Modals: OFF";
    };
    syncInfoBtn();
    infoModalToggle.onclick = () => {
      game.infoModalsEnabled = !game.infoModalsEnabled;
      if (!game.infoModalsEnabled && game.modifierIntroOpen) game.closeModifierIntro();
      syncInfoBtn();
    };
  }

  const upgradeSelected = () => {
    if(game.gameOver) return;
    if(modalOpen) return;

    const t=game.selectedTowerInstance;
    if(!t) return;
    if(!t.canUpgrade()) return;

    const cost=t.upgradeCost();
    if(game.gold < cost) return;

    game.gold -= cost;
    t.spentGold += cost;

    const lvlBefore = t.level;
    t.upgradeBaseStats(false);
    if (typeof game.notifyTowerLevelChanged === "function") {
      game.notifyTowerLevelChanged(t, lvlBefore, "manual_upgrade");
    }

    // Normal milestone modal
    if (t.level !== CFG.PRESTIGE_LEVEL && MILESTONES.has(t.level)) {
      game.openMilestoneModal(t);
    }

    // Prestige upgrade mesajı
    if (lvlBefore === CFG.TOWER_MAX_LEVEL && t.level === CFG.PRESTIGE_LEVEL) {
      game.centerQueue.push({ text:`${t.def.name} Prestige Unlocked`, life:1.6 });
    }

    game.refreshUI(true);
  };

  document.getElementById("upgradeBtnHud").onclick = () => upgradeSelected();
  const fastUpgradeBtnHud = document.getElementById("fastUpgradeBtnHud");
  if (fastUpgradeBtnHud) fastUpgradeBtnHud.onclick = () => upgradeToNextMultipleOfFive();
  const upgradeBtnHud = document.getElementById("upgradeBtnHud");
  if (upgradeBtnHud) {
    upgradeBtnHud.addEventListener("pointerenter", () => { game.uiHover.upgrade = true; });
    upgradeBtnHud.addEventListener("pointerleave", () => { game.uiHover.upgrade = false; });
  }
  if (fastUpgradeBtnHud) {
    fastUpgradeBtnHud.addEventListener("pointerenter", () => { game.uiHover.fast = true; });
    fastUpgradeBtnHud.addEventListener("pointerleave", () => { game.uiHover.fast = false; });
  }

  const sellBtnHud=document.getElementById("sellBtnHud");
  const sellSelected = () => {
    if(modalOpen) return;
    if(game.gameOver) return;
    game.sellSelectedTower();
  };
  sellBtnHud.onclick = () => sellSelected();

  const speedSlider=document.getElementById("speedSlider");
  const speedLabel=document.getElementById("speedLabel");
  const speedCycleBtn=document.getElementById("speedCycleBtn");
  const MAX_PUBLIC_GAME_SPEED = 3;
  const MAX_CHEAT_GAME_SPEED = 10;
  const SPEED_CYCLE_VALUES = [1, 2, 3];
  let lastNonZeroSpeed = 1.0;
  function setSpeed(v, options = {}){
    if(modalOpen) return;
    const raw = Number(v) || 0;
    const allowCheat = !!options.allowCheat
      || ((raw > MAX_PUBLIC_GAME_SPEED) && (game.gameSpeed > MAX_PUBLIC_GAME_SPEED || lastNonZeroSpeed > MAX_PUBLIC_GAME_SPEED));
    const cap = allowCheat ? MAX_CHEAT_GAME_SPEED : MAX_PUBLIC_GAME_SPEED;
    const next = Math.min(cap, Math.max(0, raw));
    game.gameSpeed=next;
    if (next > 0) lastNonZeroSpeed = next;
    speedSlider.value = Math.min(MAX_PUBLIC_GAME_SPEED, next).toFixed(1);
    speedLabel.textContent=`${next.toFixed(1)}x`;
  }
  speedSlider.addEventListener("input", ()=>setSpeed(parseFloat(speedSlider.value)));
  if (speedCycleBtn) {
    speedCycleBtn.addEventListener("click", () => {
      if (modalOpen) return;
      const current = Math.max(0, Number(game.gameSpeed) || 0);
      let next = SPEED_CYCLE_VALUES[0];
      let found = false;
      for (const speed of SPEED_CYCLE_VALUES) {
        if (current < speed - 0.001) {
          next = speed;
          found = true;
          break;
        }
      }
      if (!found) next = SPEED_CYCLE_VALUES[0];
      setSpeed(next);
    });
  }
  setSpeed(1.0);

  function clearSelection(){
    game.selectedTowerDef=null;
    game.selectedTowerInstance=null;
    game.selectedEnemy=null;
    game.selectedHazard=null;
    for (const b of shopButtons) b.classList.remove("active");
    game.refreshUI(true);
  }

  function selectTower(def, btn){
    game.selectedTowerDef=def;
    game.selectedTowerInstance=null;
    game.selectedEnemy=null;
    game.selectedHazard=null;
    for (const b of shopButtons) b.classList.remove("active");
    if (btn) btn.classList.add("active");
    game.refreshUI(true);
  }

  function upgradeToNextMultipleOfFive(){
    const t=game.selectedTowerInstance;
    if(!t) return;
    if(!t.canUpgrade()) return;
    if(modalOpen) return;

    const nextTarget = Math.min(20, (Math.floor(t.level / 5) + 1) * 5);
    if (t.level >= nextTarget) return;

    while (t.level < nextTarget) {
      const cost=t.upgradeCost();
      if(game.gold < cost) break;
      game.gold -= cost;
      t.spentGold += cost;
      const lvlBefore = t.level;
      t.upgradeBaseStats(false);
      if (typeof game.notifyTowerLevelChanged === "function") {
        game.notifyTowerLevelChanged(t, lvlBefore, "fast_upgrade");
      }

      if (t.level !== CFG.PRESTIGE_LEVEL && MILESTONES.has(t.level)) {
        game.openMilestoneModal(t);
        break;
      }

      if (lvlBefore === CFG.TOWER_MAX_LEVEL && t.level === CFG.PRESTIGE_LEVEL) {
        game.centerQueue.push({ text:`${t.def.name} Prestige Unlocked`, life:1.6 });
      }

      if (modalOpen) break;
      if(!t.canUpgrade()) break;
    }

    game.refreshUI(true);
  }

  window.addEventListener("keydown", (ev) => {
    if (modalOpen) return;
    if (ev.repeat) return;
    if (document.body.classList.contains("mainMenuOpen")) return;
    const settingsBackEl = document.getElementById("settingsBack");
    const statsBackEl = document.getElementById("statsBack");
    const confirmBackEl = document.getElementById("confirmBack");
    if (settingsBackEl?.style?.display === "flex") return;
    if (statsBackEl?.style?.display === "flex") return;
    if (confirmBackEl?.style?.display === "flex") return;

    const towerShortcutIdx = TOWER_SHORTCUT_ACTIONS.findIndex(actionId => actionPressed(actionId, ev));
    if (towerShortcutIdx >= 0) {
      const idx = towerShortcutIdx;
      const shortcutDefs = getOrderedTowerDefs();
      const def = shortcutDefs[idx];
      if (def) {
        const btnIdx = shopButtons.findIndex(b => b?.dataset?.theme === def.id);
        selectTower(def, btnIdx >= 0 ? shopButtons[btnIdx] : null);
      }
      return;
    }

    if (actionPressed("upgrade", ev)) {
      upgradeSelected();
      return;
    }
    if (actionPressed("sell", ev)) {
      sellSelected();
      return;
    }
    if (actionPressed("fast_upgrade", ev)) {
      upgradeToNextMultipleOfFive();
      return;
    }
    if (actionPressed("mute", ev)) {
      const muted = SFX.toggleMuted();
      if (typeof options.onMuteToggle === "function") options.onMuteToggle(muted);
      game.logEvent(muted ? "SFX muted." : "SFX unmuted.");
      return;
    }
    if (actionPressed("pause_menu", ev)) {
      ev.preventDefault();
      if (!game.started && !game.gameOver) {
        game.start();
        return;
      }
      if (typeof options.onPauseToggle === "function") {
        options.onPauseToggle({
          setSpeed,
          getCurrentSpeed: () => game.gameSpeed,
          getLastNonZeroSpeed: () => lastNonZeroSpeed,
          setLastNonZeroSpeed: (v) => {
            const n = Number(v);
            if (Number.isFinite(n) && n > 0) lastNonZeroSpeed = n;
          }
        });
      } else if (game.gameSpeed > 0) {
        lastNonZeroSpeed = game.gameSpeed;
        speedSlider.value = "0";
        setSpeed(0);
      } else {
        const resumeSpeed = Math.max(0.1, lastNonZeroSpeed || 1.0);
        speedSlider.value = String(Math.min(MAX_PUBLIC_GAME_SPEED, resumeSpeed));
        setSpeed(resumeSpeed, { allowCheat: resumeSpeed > MAX_PUBLIC_GAME_SPEED });
      }
      return;
    }
    if (actionPressed("clear_selection", ev)) {
      if (typeof options.onClearSelection === "function") {
        const consumed = options.onClearSelection();
        if (consumed) return;
      }
      clearSelection();
      return;
    }
    return;
  });
}



const GAME_UI_IDS = {
  logLines: "logLines",
  hudLogTitle: "hudLogTitle",
  modifierIntroBack: "modifierIntroBack",
  modifierIntroTitle: "modifierIntroTitle",
  modifierIntroText: "modifierIntroText",
  modifierIntroIcon: "modifierIntroIcon",
  modifierIntroClose: "modifierIntroClose",
  winBack: "winBack",
  winTime: "winTime",
  winEndBtn: "winEndBtn",
  winEndlessBtn: "winEndlessBtn",
  gameOverBack: "gameOverBack",
  gameOverRestartBtn: "gameOverRestartBtn",
  gameOverMainMenuBtn: "gameOverMainMenuBtn",
  hudGold: "hud_gold",
  hudCoreHp: "hud_corehp",
  hudKills: "hud_kills",
  hudWave: "hud_wave",
  hudMobs: "hud_mobs",
  mapName: "mapName",
  startWaveBtn: "startWaveBtn",
  nextWaveNowBtn: "nextWaveNowBtn",
  selectedInfoHud: "selectedInfoHud",
  upgradeBtnHud: "upgradeBtnHud",
  fastUpgradeBtnHud: "fastUpgradeBtnHud",
  sellBtnHud: "sellBtnHud",
  speedSlider: "speedSlider",
  speedLabel: "speedLabel",
  cheatPanel: "cheatPanel"
};

function createGameUiAdapter(doc = document){
  const refs = {};
  for (const [key, id] of Object.entries(GAME_UI_IDS)) {
    refs[key] = doc.getElementById(id);
  }

  return {
    refs,
    syncSpeed(value){
      const n = Number(value);
      const speed = Number.isFinite(n) ? n : 1;
      if (refs.speedSlider) refs.speedSlider.value = speed.toFixed(1);
      if (refs.speedLabel) refs.speedLabel.textContent = `${speed.toFixed(1)}x`;
    },
    toggleCheatPanel(){
      if (refs.cheatPanel) refs.cheatPanel.classList.toggle("hidden");
    }
  };
}

export { createGameUiAdapter };

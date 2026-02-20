const SETTINGS_KEY = "armtd_settings_v1";

const KEYBIND_DEFS = [
  { id: "tower_1", label: "Tower Slot 1", defaultCode: "Digit1" },
  { id: "tower_2", label: "Tower Slot 2", defaultCode: "Digit2" },
  { id: "tower_3", label: "Tower Slot 3", defaultCode: "Digit3" },
  { id: "tower_4", label: "Tower Slot 4", defaultCode: "Digit4" },
  { id: "tower_5", label: "Tower Slot 5", defaultCode: "Digit5" },
  { id: "tower_6", label: "Tower Slot 6", defaultCode: "Digit6" },
  { id: "tower_7", label: "Tower Slot 7", defaultCode: "Digit7" },
  { id: "tower_8", label: "Tower Slot 8", defaultCode: "Digit8" },
  { id: "tower_9", label: "Tower Slot 9", defaultCode: "Digit9" },
  { id: "tower_10", label: "Tower Slot 10", defaultCode: "Digit0" },
  { id: "upgrade", label: "Upgrade", defaultCode: "KeyZ" },
  { id: "fast_upgrade", label: "Fast Upgrade", defaultCode: "KeyX" },
  { id: "sell", label: "Sell / Restart", defaultCode: "KeyC" },
  { id: "mute", label: "Mute Toggle", defaultCode: "KeyM" },
  { id: "pause_menu", label: "Pause / Resume Menu", defaultCode: "Space" },
  { id: "clear_selection", label: "Clear Selection", defaultCode: "Escape" }
];

const TOWER_SHORTCUT_ACTIONS = KEYBIND_DEFS
  .map(d => d.id)
  .filter(id => id.startsWith("tower_"));

const DEFAULT_KEYBINDS = KEYBIND_DEFS.reduce((acc, def) => {
  acc[def.id] = def.defaultCode;
  return acc;
}, {});

const DEFAULT_SETTINGS = {
  keybinds: { ...DEFAULT_KEYBINDS },
  audio: {
    muted: false,
    volume: 0.18
  }
};

function clamp(v, min, max){
  return Math.max(min, Math.min(max, v));
}

function normalizeCode(code, fallback){
  if (typeof code !== "string") return fallback;
  const value = code.trim();
  if (!value) return fallback;
  return value;
}

function normalizeKeybinds(input){
  const raw = input && typeof input === "object" ? input : {};
  const out = {};
  for (const def of KEYBIND_DEFS) {
    out[def.id] = normalizeCode(raw[def.id], def.defaultCode);
  }
  return out;
}

function normalizeAudio(input){
  const raw = input && typeof input === "object" ? input : {};
  return {
    muted: !!raw.muted,
    volume: clamp(Number(raw.volume), 0, 1)
  };
}

function normalizeSettings(input){
  const raw = input && typeof input === "object" ? input : {};
  const normalized = {
    keybinds: normalizeKeybinds(raw.keybinds),
    audio: normalizeAudio(raw.audio)
  };
  if (!Number.isFinite(normalized.audio.volume)) {
    normalized.audio.volume = DEFAULT_SETTINGS.audio.volume;
  }
  return normalized;
}

function cloneSettings(input){
  return normalizeSettings(input);
}

function loadSettings(){
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (!raw) return cloneSettings(DEFAULT_SETTINGS);
    const parsed = JSON.parse(raw);
    return normalizeSettings(parsed);
  } catch (_) {
    return cloneSettings(DEFAULT_SETTINGS);
  }
}

function saveSettings(settings){
  const payload = normalizeSettings(settings);
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(payload));
  } catch (_) {
    // Ignore quota/storage errors.
  }
  return payload;
}

function defaultCodeForAction(actionId){
  const def = KEYBIND_DEFS.find(x => x.id === actionId);
  return def ? def.defaultCode : null;
}

function formatKeyCode(code){
  if (!code) return "Unbound";
  if (code.startsWith("Key") && code.length === 4) return code.slice(3).toUpperCase();
  if (code.startsWith("Digit")) return code.slice(5);
  if (code.startsWith("Numpad")) return `Num ${code.slice(6)}`;
  if (code === "Space") return "Space";
  if (code === "Escape") return "Esc";
  if (code.startsWith("Arrow")) return code.replace("Arrow", "");
  if (code === "Backquote") return "`";
  if (code === "Minus") return "-";
  if (code === "Equal") return "=";
  if (code === "BracketLeft") return "[";
  if (code === "BracketRight") return "]";
  if (code === "Semicolon") return ";";
  if (code === "Quote") return "'";
  if (code === "Comma") return ",";
  if (code === "Period") return ".";
  if (code === "Slash") return "/";
  if (code === "Backslash") return "\\";
  return code;
}

function isActionPressed(actionId, ev, keybinds){
  const binds = keybinds || DEFAULT_KEYBINDS;
  const code = binds[actionId];
  return !!code && ev?.code === code;
}

export {
  SETTINGS_KEY,
  KEYBIND_DEFS,
  TOWER_SHORTCUT_ACTIONS,
  DEFAULT_KEYBINDS,
  DEFAULT_SETTINGS,
  cloneSettings,
  loadSettings,
  saveSettings,
  defaultCodeForAction,
  formatKeyCode,
  isActionPressed,
  normalizeSettings
};

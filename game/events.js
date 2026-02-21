const GAME_EVENTS = Object.freeze({
  RUN_STARTED: "run_started",
  RUN_RESTARTED: "run_restarted",
  GAME_OVER: "game_over",
  GAME_OVER_MAIN_MENU: "game_over_main_menu",
  WAVE_STARTED: "wave_started",
  WAVE_ENDED: "wave_ended",
  TOWER_BUILT: "tower_built",
  TOWER_LEVEL_UP: "tower_level_up",
  TOWER_PRESTIGE_UNLOCKED: "tower_prestige_unlocked",
  TOWER_SPECIAL_UPGRADE_CHOSEN: "tower_special_upgrade_chosen",
  ENEMY_KILLED: "enemy_killed",
  CAMPAIGN_CLEARED: "campaign_cleared"
});

function createEventBus(){
  const listeners = new Map();

  function on(eventName, handler){
    const key = String(eventName || "").trim();
    if (!key || typeof handler !== "function") return () => {};
    let set = listeners.get(key);
    if (!set) {
      set = new Set();
      listeners.set(key, set);
    }
    set.add(handler);
    return () => off(key, handler);
  }

  function off(eventName, handler){
    const key = String(eventName || "").trim();
    const set = listeners.get(key);
    if (!set) return false;
    const removed = set.delete(handler);
    if (!set.size) listeners.delete(key);
    return removed;
  }

  function once(eventName, handler){
    if (typeof handler !== "function") return () => {};
    const wrap = (payload) => {
      off(eventName, wrap);
      handler(payload);
    };
    return on(eventName, wrap);
  }

  function emit(eventName, payload){
    const key = String(eventName || "").trim();
    const set = listeners.get(key);
    if (!set || !set.size) return 0;
    let delivered = 0;
    for (const fn of [...set]) {
      try {
        fn(payload);
      } catch (err) {
        console.error(`[events] listener failed for "${key}"`, err);
      }
      delivered += 1;
    }
    return delivered;
  }

  function clear(eventName){
    if (eventName === undefined) {
      listeners.clear();
      return;
    }
    listeners.delete(String(eventName || "").trim());
  }

  return Object.freeze({ on, off, once, emit, clear });
}

export { GAME_EVENTS, createEventBus };

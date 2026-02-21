import { TOWER_DEFS } from "./towers.js";
import { ENEMY_TYPES } from "./enemies.js";
import { MAP_POOL } from "./map.js";

const TOWER_DISPLAY_ORDER = Object.freeze(["archer", "mage", "blizzard", "breaker", "poison", "sniper", "peel"]);
const TOWER_BY_ID = new Map(TOWER_DEFS.map((def) => [String(def.id), def]));
const ENEMY_BY_ID = new Map(Object.entries(ENEMY_TYPES).map(([id, def]) => [String(id), def]));
const MAP_BY_INDEX = new Map(MAP_POOL.map((def, index) => [index, def]));

function mapIndexFrom(value){
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  return Math.floor(n);
}

const CONTENT_REGISTRY = Object.freeze({
  towers: Object.freeze({
    list: TOWER_DEFS,
    byId: TOWER_BY_ID,
    ids: Object.freeze(TOWER_DEFS.map((def) => String(def.id))),
    orderedIds: TOWER_DISPLAY_ORDER,
    get(id){
      return TOWER_BY_ID.get(String(id ?? "")) || null;
    },
    orderedList(order = TOWER_DISPLAY_ORDER){
      return order.map((id) => TOWER_BY_ID.get(String(id))).filter(Boolean);
    }
  }),
  enemies: Object.freeze({
    byId: ENEMY_BY_ID,
    ids: Object.freeze([...ENEMY_BY_ID.keys()]),
    get(id){
      return ENEMY_BY_ID.get(String(id ?? "")) || null;
    }
  }),
  maps: Object.freeze({
    list: MAP_POOL,
    byIndex: MAP_BY_INDEX,
    count: MAP_POOL.length,
    get(index){
      const key = mapIndexFrom(index);
      if (key === null) return null;
      return MAP_BY_INDEX.get(key) || null;
    }
  })
});

export { CONTENT_REGISTRY };

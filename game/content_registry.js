import { TOWER_DEFS } from "./towers.js";
import { ENEMY_TYPES } from "./enemies.js";
import { MAP_POOL } from "./map.js";

const TOWER_DISPLAY_ORDER = Object.freeze(["archer", "mage", "blizzard", "breaker", "poison", "sniper", "peel"]);
const CAMPAIGN_MAP_CARD_DEFS = Object.freeze([
  Object.freeze({ id: 0, mapIndex: 0, defaultTitle: "Map 1", dynamicMapTitle: true, forcePlayable: true, image: "assets/ARMTD_NEO.png" }),
  Object.freeze({ id: 1, mapIndex: 1, defaultTitle: "Map 2", dynamicMapTitle: true, forcePlayable: false, image: "assets/ARTMTD_XENO.png" }),
  Object.freeze({ id: 2, mapIndex: null, defaultTitle: "Template Map 3", dynamicMapTitle: false, forcePlayable: false, image: "" }),
  Object.freeze({ id: 3, mapIndex: null, defaultTitle: "Template Map 4", dynamicMapTitle: false, forcePlayable: false, image: "" }),
  Object.freeze({ id: 4, mapIndex: null, defaultTitle: "Template Map 5", dynamicMapTitle: false, forcePlayable: false, image: "" }),
  Object.freeze({ id: 5, mapIndex: null, defaultTitle: "Template Map 6", dynamicMapTitle: false, forcePlayable: false, image: "" }),
  Object.freeze({ id: 6, mapIndex: null, defaultTitle: "Template Map 7", dynamicMapTitle: false, forcePlayable: false, image: "" }),
  Object.freeze({ id: 7, mapIndex: null, defaultTitle: "Template Map 8", dynamicMapTitle: false, forcePlayable: false, image: "" }),
  Object.freeze({ id: 8, mapIndex: null, defaultTitle: "Template Map 9", dynamicMapTitle: false, forcePlayable: false, image: "" })
]);
const TOWER_BY_ID = new Map(TOWER_DEFS.map((def) => [String(def.id), def]));
const ENEMY_BY_ID = new Map(Object.entries(ENEMY_TYPES).map(([id, def]) => [String(id), def]));
const MAP_BY_INDEX = new Map(MAP_POOL.map((def, index) => [index, def]));

function mapIndexFrom(value){
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  return Math.floor(n);
}

function buildCampaignCard(template){
  const hasPlayableIndex = Number.isFinite(template?.mapIndex);
  const mapDef = hasPlayableIndex ? (MAP_BY_INDEX.get(template.mapIndex) || null) : null;
  const playable = !!template?.forcePlayable || !!mapDef;
  const title = (template?.dynamicMapTitle && mapDef?.name)
    ? String(mapDef.name)
    : String(template?.defaultTitle || "Map");
  return {
    id: Number(template?.id) || 0,
    title,
    playable,
    mapIndex: playable && hasPlayableIndex ? template.mapIndex : null,
    image: String(template?.image || "")
  };
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
    campaignCardDefs: CAMPAIGN_MAP_CARD_DEFS,
    campaignCardCount: CAMPAIGN_MAP_CARD_DEFS.length,
    get(index){
      const key = mapIndexFrom(index);
      if (key === null) return null;
      return MAP_BY_INDEX.get(key) || null;
    },
    getCampaignCard(cardIndex){
      const key = mapIndexFrom(cardIndex);
      if (key === null) return null;
      const template = CAMPAIGN_MAP_CARD_DEFS[key];
      if (!template) return null;
      return buildCampaignCard(template);
    },
    getCampaignCatalog(){
      return CAMPAIGN_MAP_CARD_DEFS.map(buildCampaignCard);
    }
  })
});

export { CONTENT_REGISTRY };

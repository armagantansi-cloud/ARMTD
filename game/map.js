function buildSMap(w = 20, h = 15) {
  const g = Array.from({ length: h }, () => Array.from({ length: w }, () => 0));
  const mark = (x, y) => { if (x >= 0 && y >= 0 && x < w && y < h) g[y][x] = 1; };

  for (let x = 0; x <= 5; x += 1) mark(x, 7);
  for (let y = 7; y >= 3; y -= 1) mark(5, y);
  for (let x = 5; x <= 14; x += 1) mark(x, 3);
  for (let y = 3; y <= 10; y += 1) mark(14, y);
  for (let y = 10; y >= 7; y -= 1) mark(18, y);
  for (let x = 15; x <= 18; x += 1) mark(x, 10);
  mark(5, 4);
  mark(6, 3);
  mark(13, 3);
  mark(14, 4);

  return g;
}

const MAP_CODE_W = 20;
const MAP_CODE_H = 15;
const MAP_CODE_X = "abcdefghijklmnopqrst";
const MAP_CODE_Y = "0123456789!?#*=";

function buildEmptyMapCodeGrid() {
  return Array.from({ length: MAP_CODE_H }, () => Array.from({ length: MAP_CODE_W }, () => 0));
}

function decodeCampaignMapCode(rawCode) {
  const raw = String(rawCode || "").trim();
  if (!raw) throw new Error("Empty campaign map code.");

  let mapName = "Campaign Map";
  let dataPart = raw;
  if (raw.startsWith("ARMTD1|")) {
    const segments = raw.split("|").slice(1);
    for (const seg of segments) {
      const [k, ...rest] = seg.split("=");
      const value = rest.join("=");
      if (k === "N") {
        try { mapName = decodeURIComponent(value || "Campaign Map"); } catch (_) {}
      }
      if (k === "D") dataPart = value || "";
    }
  }

  const parts = dataPart.split(",").map(p => p.trim()).filter(Boolean);
  if (!parts.length) throw new Error("Invalid campaign map code.");

  const grid = buildEmptyMapCodeGrid();
  let spawn = null;
  let core = null;

  for (const token of parts) {
    const m = token.match(/^([a-t])([0-9!?#*=])([scwo])$/i);
    if (!m) continue;
    const x = MAP_CODE_X.indexOf(String(m[1]).toLowerCase());
    const y = MAP_CODE_Y.indexOf(m[2]);
    if (x < 0 || y < 0) continue;
    const t = String(m[3]).toUpperCase();
    if (t === "S") spawn = { x, y };
    if (t === "C") core = { x, y };
    if (t === "W") grid[y][x] = 1;
    if (t === "O") grid[y][x] = 2;
  }

  if (!spawn || !core) throw new Error("Campaign map code must include Spawn and Core.");

  return {
    name: String(mapName || "Campaign Map"),
    gridW: MAP_CODE_W,
    gridH: MAP_CODE_H,
    entrance: { x: spawn.x, y: spawn.y },
    exit: { x: core.x, y: core.y },
    grid,
    hazards: []
  };
}

const XENO_MAP_CODE = "ARMTD1|N=Xeno|D=b2S,s*C,g1W,h1W,i1W,j1W,k1W,l1W,m1W,n1W,o1W,p1W,q1W,r1W,d2W,f2W,g2W,r2W,s2W,b3W,d3W,f3W,j3W,k3W,l3W,o3W,p3W,s3W,b4W,d4W,f4W,i4W,j4W,l4W,m4W,p4W,q4W,s4W,b5W,d5W,f5W,h5W,i5W,m5W,n5W,p5W,q5W,s5W,b6W,d6W,f6W,h6W,n6W,s6W,b7W,d7W,f7W,h7W,n7W,q7W,r7W,s7W,b8W,f8W,h8W,i8W,n8W,q8W,b9W,c9W,d9W,f9W,i9W,j9W,k9W,l9W,m9W,n9W,o9W,p9W,q9W,s9W,d!W,f!W,n!W,s!W,c?W,d?W,f?W,h?W,i?W,j?W,k?W,l?W,n?W,q?W,r?W,s?W,c#W,f#W,h#W,i#W,j#W,k#W,l#W,n#W,o#W,c*W,d*W,e*W,f*W,h*W,i*W,j*W,k*W,l*W,o*W,p*W,q*W,r*W,s*W";

const MAP_POOL = [
  {
    name: "Neo City - S",
    gridW: 20,
    gridH: 15,
    entrance: { x: 0, y: 7 },
    exit: { x: 18, y: 7 },
    grid: buildSMap(20, 15),
    hazards: []
  },
  decodeCampaignMapCode(XENO_MAP_CODE)
];

const DIRS = [
  { x: 1, y: 0 },  // right
  { x: 0, y: 1 },  // down
  { x: -1, y: 0 }, // left
  { x: 0, y: -1 }  // up
];

const DIR_SCORE_ORDER = [0, 1, 3, 2];

class GameMap {
  constructor(def) {
    this.name = String(def?.name || "Custom Map");
    this.w = Math.max(1, Math.floor(def?.gridW || 20));
    this.h = Math.max(1, Math.floor(def?.gridH || 15));
    this.grid = Array.isArray(def?.grid)
      ? def.grid.map(row => Array.isArray(row)
        ? row.map(v => {
            const cell = Math.floor(Number(v) || 0);
            if (cell === 1 || cell === 2) return cell;
            return 0;
          })
        : Array.from({ length: this.w }, () => 0))
      : Array.from({ length: this.h }, () => Array.from({ length: this.w }, () => 0));
    this.entrance = {
      x: Math.max(0, Math.min(this.w - 1, Math.floor(def?.entrance?.x || 0))),
      y: Math.max(0, Math.min(this.h - 1, Math.floor(def?.entrance?.y || 0)))
    };
    this.exit = {
      x: Math.max(0, Math.min(this.w - 1, Math.floor(def?.exit?.x || (this.w - 1)))),
      y: Math.max(0, Math.min(this.h - 1, Math.floor(def?.exit?.y || (this.h - 1))))
    };
    this.path = this.buildPath();
  }

  inBounds(x, y) { return x >= 0 && y >= 0 && x < this.w && y < this.h; }
  isPath(x, y) { return this.grid[y][x] === 1; }
  isObstacle(x, y) { return this.grid[y][x] === 2; }
  isBuildable(x, y) { return this.grid[y][x] === 0; }

  isPassable(x, y, start, goal) {
    if (!this.inBounds(x, y)) return false;
    if (x === start.x && y === start.y) return true;
    if (x === goal.x && y === goal.y) return true;
    return this.isPath(x, y);
  }

  buildDistanceToGoal(start, goal) {
    const q = [{ x: goal.x, y: goal.y }];
    const dist = new Map();
    const k0 = `${goal.x},${goal.y}`;
    dist.set(k0, 0);

    while (q.length) {
      const cur = q.shift();
      const curKey = `${cur.x},${cur.y}`;
      const d = dist.get(curKey) || 0;
      for (const dir of DIRS) {
        const nx = cur.x + dir.x;
        const ny = cur.y + dir.y;
        if (!this.isPassable(nx, ny, start, goal)) continue;
        const nk = `${nx},${ny}`;
        if (dist.has(nk)) continue;
        dist.set(nk, d + 1);
        q.push({ x: nx, y: ny });
      }
    }
    return dist;
  }

  buildPathBfs(start, goal) {
    const q = [{ x: start.x, y: start.y }];
    const prev = new Map();
    const key = (p) => `${p.x},${p.y}`;
    prev.set(key(start), null);

    while (q.length) {
      const cur = q.shift();
      if (cur.x === goal.x && cur.y === goal.y) break;
      for (const dir of DIRS) {
        const nx = cur.x + dir.x;
        const ny = cur.y + dir.y;
        if (!this.isPassable(nx, ny, start, goal)) continue;
        const nk = `${nx},${ny}`;
        if (prev.has(nk)) continue;
        prev.set(nk, cur);
        q.push({ x: nx, y: ny });
      }
    }

    const kGoal = key(goal);
    if (!prev.has(kGoal)) {
      const fallback = [];
      for (let x = start.x; x <= goal.x; x += 1) fallback.push({ x, y: start.y });
      return fallback.length ? fallback : [{ x: start.x, y: start.y }];
    }

    const path = [];
    let cur = goal;
    while (cur) {
      path.push({ x: cur.x, y: cur.y });
      cur = prev.get(key(cur));
    }
    path.reverse();
    return path;
  }

  buildPathDirectional(start, goal, dist) {
    const goalKey = `${goal.x},${goal.y}`;
    if (!dist.has(goalKey)) return null;

    const startKey = `${start.x},${start.y}`;
    if (!dist.has(startKey)) return null;

    const path = [{ x: start.x, y: start.y }];
    let current = { x: start.x, y: start.y };
    let currentDir = null;
    const stateVisit = new Map();
    let safety = Math.max(80, this.w * this.h * 22);

    while (safety-- > 0) {
      if (current.x === goal.x && current.y === goal.y) return path;

      const neighbors = [];
      for (let dirIndex = 0; dirIndex < DIRS.length; dirIndex += 1) {
        const d = DIRS[dirIndex];
        const nx = current.x + d.x;
        const ny = current.y + d.y;
        if (!this.isPassable(nx, ny, start, goal)) continue;
        const nk = `${nx},${ny}`;
        const goalDist = dist.has(nk) ? dist.get(nk) : Number.POSITIVE_INFINITY;
        neighbors.push({ dirIndex, x: nx, y: ny, nk, goalDist });
      }
      if (!neighbors.length) return null;

      let candidates = neighbors;
      if (currentDir !== null && neighbors.length > 1) {
        const backDir = (currentDir + 2) % 4;
        const noBack = neighbors.filter(n => n.dirIndex !== backDir);
        if (noBack.length) candidates = noBack;
      }

      let chosen = null;
      if (currentDir !== null) {
        chosen = candidates.find(n => n.dirIndex === currentDir) || null;
      }

      if (!chosen) {
        const priority = currentDir === null
          ? DIR_SCORE_ORDER
          : [currentDir, (currentDir + 1) % 4, (currentDir + 3) % 4, (currentDir + 2) % 4];
        const dirRank = new Map(priority.map((d, idx) => [d, idx]));
        candidates.sort((a, b) => {
          if (a.goalDist !== b.goalDist) return a.goalDist - b.goalDist;
          return (dirRank.get(a.dirIndex) || 99) - (dirRank.get(b.dirIndex) || 99);
        });
        chosen = candidates[0];
      }

      if (!chosen || !Number.isFinite(chosen.goalDist)) return null;

      const sk = `${chosen.x},${chosen.y},${chosen.dirIndex}`;
      const seen = (stateVisit.get(sk) || 0) + 1;
      stateVisit.set(sk, seen);
      if (seen > 3) return null;

      current = { x: chosen.x, y: chosen.y };
      currentDir = chosen.dirIndex;
      path.push({ x: current.x, y: current.y });
      if (path.length > this.w * this.h * 4) return null;
    }

    return null;
  }

  buildPath() {
    const start = this.entrance;
    const goal = this.exit;
    if (start.x === goal.x && start.y === goal.y) return [{ x: start.x, y: start.y }];

    const dist = this.buildDistanceToGoal(start, goal);
    const directional = this.buildPathDirectional(start, goal, dist);
    if (directional && directional.length >= 2) return directional;

    return this.buildPathBfs(start, goal);
  }
}

export { buildSMap, MAP_POOL, GameMap };

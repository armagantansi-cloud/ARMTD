import { CFG } from "./config.js";
import { clamp, dist2 } from "./utils.js";

const FLOATING_TEXT_POOL_LIMIT = 512;
const EFFECT_LINE_POOL_LIMIT = 512;
const EFFECT_RING_POOL_LIMIT = 256;
const PROJECTILE_POOL_LIMIT = 512;
const FREE_PROJECTILE_POOL_LIMIT = 512;

const floatingTextPool = [];
const effectLinePool = [];
const effectRingPool = [];
const projectilePool = [];
const freeProjectilePool = [];

function pushToPool(pool, item, limit){
  if (!item) return;
  if (pool.length >= limit) return;
  pool.push(item);
}

class FloatingText {
    constructor(x,y,text, life=CFG.FLOAT_TEXT_LIFE, size=14, isCrit=false, isCenter=false){
      this.reset(x, y, text, life, size, isCrit, isCenter);
    }

    reset(x,y,text, life=CFG.FLOAT_TEXT_LIFE, size=14, isCrit=false, isCenter=false){
      this.x=x; this.y=y;
      this.text=text;
      this.life=life;
      this.t=life;
      this.size=size;
      this.isCrit=isCrit;
      this.isCenter=isCenter;
      this.dead=false;

      const safeLife = Math.max(0.0001, life || CFG.FLOAT_TEXT_LIFE || 1);
      const jitterX = (Math.random()*2-1) * CFG.FLOAT_TEXT_SPREAD;
      this.vx = jitterX;
      this.vy = -CFG.FLOAT_TEXT_RISE / safeLife;
      return this;
    }
    update(dt){
      this.t -= dt;
      this.x += this.vx * dt;
      this.y += this.vy * dt;
      if(this.t<=0) this.dead=true;
    }
    alpha(){ return clamp(this.t/this.life, 0, 1); }
  }

  // =========================================================
  // Enemy
  // =========================================================
  
class EffectLine {
    constructor(ax,ay,bx,by,lifetime,color,width=3){
      this.reset(ax, ay, bx, by, lifetime, color, width);
    }

    reset(ax,ay,bx,by,lifetime,color,width=3){
      this.ax=ax; this.ay=ay; this.bx=bx; this.by=by;
      this.t=lifetime; this.life=lifetime;
      this.color=color; this.width=width;
      this.dead=false;
      return this;
    }
    update(dt){ this.t-=dt; if(this.t<=0) this.dead=true; }
    alpha(){ return clamp(this.t/this.life, 0, 1); }
  }

  class EffectRing {
    constructor(x,y, maxRadiusTiles, speedTilesPerSec, lifetime, color, onHit, width=3){
      this.hitSet=new Set();
      this._enemyRangeScratch = [];
      this.reset(x, y, maxRadiusTiles, speedTilesPerSec, lifetime, color, onHit, width);
    }

    reset(x,y, maxRadiusTiles, speedTilesPerSec, lifetime, color, onHit, width=3){
      this.x=x; this.y=y;
      this.r=0;
      this.maxR=maxRadiusTiles;
      this.speed=speedTilesPerSec;
      this.t=lifetime; this.life=lifetime;
      this.color=color;
      this.width = width;
      this.dead=false;
      this.onHit=onHit;
      this.hitSet.clear();
      this._enemyRangeScratch.length = 0;
      return this;
    }
    update(dt, game){
      this.t -= dt;
      this.r += this.speed*dt;
      if (this.r >= this.maxR) this.r = this.maxR;

      if (this.onHit) {
        const nearby = (typeof game.getEnemiesInRange === "function")
          ? game.getEnemiesInRange(this.x, this.y, this.r, this._enemyRangeScratch)
          : game.enemies;
        const rr2=this.r*this.r;
        for(const e of nearby){
          if(e.dead || e.reachedExit) continue;
          if(this.hitSet.has(e)) continue;
          const d2=dist2(this.x,this.y,e.x,e.y);
          if(d2 <= rr2){
            this.hitSet.add(e);
            this.onHit(e, game);
          }
        }
      }

      if(this.t <= 0 || this.r >= this.maxR){
        if (this.t <= -0.05) this.dead=true;
      }
    }
    alpha(){ return clamp(this.t/this.life, 0, 1); }
  }

  // =========================================================
  // Projectile
  // =========================================================
  
  class Projectile {
    constructor(x,y,target,speed,payload,visual,expectedDealt,sourceTower){
      this.trailNodes = [];
      this._enemyRangeScratch = [];
      this._counted = false;
      this._spent = false;
      this.t = null;
      this.expectedDealt = 0;
      this.reset(x, y, target, speed, payload, visual, expectedDealt, sourceTower);
    }

    reset(x,y,target,speed,payload,visual,expectedDealt,sourceTower){
      this.detachIncoming();
      this.x=x; this.y=y;
      this.t=target;
      this.speed=speed;
      this.payload=payload;
      this.visual=visual;
      this.dead=false;

      this.expectedDealt=expectedDealt ?? 0;
      this.sourceTower=sourceTower ?? null;
      this._spent = false;

      this.trailCfg = visual?.trail ?? null;
      this.trailNodes.length = 0;
      this._trailSpawnTimer = 0;
      this._drift = false;
      this._dirX = 1;
      this._dirY = 0;
      if (target && !target.dead && !target.reachedExit) {
        const dx = target.x - x;
        const dy = target.y - y;
        const d = Math.hypot(dx, dy) || 1;
        this._dirX = dx / d;
        this._dirY = dy / d;
      }

      this._counted=false;
      if (this.t && !this.t.dead && !this.t.reachedExit) {
        this.t.incomingEstimate += this.expectedDealt;
        this._counted=true;
      }
      this._enemyRangeScratch.length = 0;
      return this;
    }

    updateTrail(dt){
      if (!this.trailCfg) return;

      const nodes = this.trailNodes;
      let w = 0;
      for (let r = 0; r < nodes.length; r += 1) {
        const n = nodes[r];
        n.t -= dt;
        n.y -= n.rise * dt;
        if (n.t <= 0) continue;
        if (w !== r) nodes[w] = n;
        w += 1;
      }
      nodes.length = w;

      if (this._spent) return;

      const spawnEvery = Math.max(0.004, this.trailCfg.spawnEvery ?? 0.016);
      this._trailSpawnTimer -= dt;
      while (this._trailSpawnTimer <= 0) {
        const life = Math.max(0.08, this.trailCfg.life ?? 0.26);
        this.trailNodes.push({
          x: this.x,
          y: this.y,
          t: life,
          life,
          size: Math.max(0.02, this.trailCfg.size ?? 0.08),
          color: this.trailCfg.color ?? "rgba(226,232,240,0.90)",
          rise: Math.max(0.02, this.trailCfg.rise ?? 0.20)
        });
        this._trailSpawnTimer += spawnEvery;
      }
    }

    detachIncoming(){
      if(this._counted && this.t){
        this.t.incomingEstimate = Math.max(0, this.t.incomingEstimate - this.expectedDealt);
      }
      this._counted=false;
    }

    tryRetarget(game){
      const maxRadius = 3.0;
      const maxR2=maxRadius*maxRadius;
      const nearby = (typeof game.getEnemiesInRange === "function")
        ? game.getEnemiesInRange(this.x, this.y, maxRadius, this._enemyRangeScratch)
        : game.enemies;
      let best=null, bestD2=Infinity;
      for(const e of nearby){
        if(e.dead || e.reachedExit) continue;
        const d2=dist2(this.x,this.y,e.x,e.y);
        if(d2 <= maxR2 && d2 < bestD2){ best=e; bestD2=d2; }
      }
      if(!best) return false;

      this.detachIncoming();
      this.t = best;
      best.incomingEstimate += this.expectedDealt;
      this._counted=true;
      return true;
    }

    beginDrift(game){
      this.detachIncoming();
      this.t = null;
      this._drift = true;
      const margin = 1.0;
      if (this.x < -margin || this.y < -margin || this.x > game.map.w + margin || this.y > game.map.h + margin) {
        this._spent = true;
        if (!this.trailCfg || this.trailNodes.length === 0) this.dead = true;
      }
    }

    applyHitTarget(target, game){
      const dealt = target.takeDamage(
        this.payload.physRaw,
        this.payload.magicRaw,
        this.payload.armorPenPct,
        this.payload.magicPenFlat,
        this.sourceTower,
        true
      );

      if(this.sourceTower){
        this.sourceTower.manaGainOnHit();
        this.sourceTower.damageDealt += dealt;
      }

      if(this.payload.onHit) this.payload.onHit(target, game, dealt, this.sourceTower);
      this._spent = true;
      if (!this.trailCfg || this.trailNodes.length === 0) this.dead=true;
    }

    findDriftCollision(game, ax, ay, bx, by){
      const hitR = Math.max(0.18, (this.visual?.radius ?? 0.11) * 1.6);
      const vx = bx - ax;
      const vy = by - ay;
      const vv = vx*vx + vy*vy;
      const segLen = Math.hypot(vx, vy);
      const qx = (ax + bx) * 0.5;
      const qy = (ay + by) * 0.5;
      const qRadius = (segLen * 0.5) + hitR;
      const nearby = (typeof game.getEnemiesInRange === "function")
        ? game.getEnemiesInRange(qx, qy, qRadius, this._enemyRangeScratch)
        : game.enemies;
      let best = null;
      let bestT = Infinity;
      for (const e of nearby) {
        if (!e || e.dead || e.reachedExit) continue;
        let t = 0;
        if (vv > 1e-8) {
          t = ((e.x - ax) * vx + (e.y - ay) * vy) / vv;
          t = clamp(t, 0, 1);
        }
        const px = ax + vx * t;
        const py = ay + vy * t;
        if (dist2(px, py, e.x, e.y) <= hitR * hitR) {
          if (t < bestT) {
            bestT = t;
            best = e;
          }
        }
      }
      return best;
    }

    update(dt, game){
      if(this.dead) return;
      this.updateTrail(dt);
      if (this._spent) {
        if (this.trailNodes.length === 0) this.dead = true;
        return;
      }

      if (this._drift) {
        const ox = this.x;
        const oy = this.y;
        this.x += this._dirX * this.speed * dt;
        this.y += this._dirY * this.speed * dt;
        const hitEnemy = this.findDriftCollision(game, ox, oy, this.x, this.y);
        if (hitEnemy) {
          this.applyHitTarget(hitEnemy, game);
          return;
        }
        const margin = 1.0;
        if (this.x < -margin || this.y < -margin || this.x > game.map.w + margin || this.y > game.map.h + margin) {
          this._spent = true;
          if (!this.trailCfg || this.trailNodes.length === 0) this.dead = true;
        }
        return;
      }

      if(!this.t || this.t.dead || this.t.reachedExit){
        const ok=this.tryRetarget(game);
        if(!ok) this.beginDrift(game);
        return;
      }

      const dx=this.t.x-this.x, dy=this.t.y-this.y;
      const d=Math.hypot(dx,dy);
      if (d > 0.0001) {
        this._dirX = dx / d;
        this._dirY = dy / d;
      }
      const step=this.speed*dt;

      if(d<0.12 || step>=d){
        this.detachIncoming();
        this.applyHitTarget(this.t, game);
      }else{
        this.x += (dx/d)*step;
        this.y += (dy/d)*step;
      }
    }
  }

  class FreeProjectile {
    constructor(x,y,tx,ty,speed,visual,onArrive, options={}){
      this._passHitSet = new Set();
      this._passLastHit = new Map();
      this._enemyRangeScratch = [];
      this.reset(x, y, tx, ty, speed, visual, onArrive, options);
    }

    reset(x,y,tx,ty,speed,visual,onArrive, options={}){
      this.x=x; this.y=y;
      this.tx=tx; this.ty=ty;
      this.speed=speed;
      this.visual=visual;
      this.onArrive=onArrive;
      this.dead=false;
      this._arrived=false;
      this._dirX=0;
      this._dirY=0;
      this._stopOnArrive = options.stopOnArrive ?? false;
      this._onPass = options.onPass ?? null;
      this._passRadius = options.passRadiusTiles ?? 0;
      this._passRepeatSec = Math.max(0, options.passRepeatSec ?? 0);
      this._passHitSet.clear();
      this._passLastHit.clear();
      this._enemyRangeScratch.length = 0;
      this._curveT = 0;
      this._curve = null;

      if (options.curve === true) {
        const dx = this.tx - this.x;
        const dy = this.ty - this.y;
        const len = Math.hypot(dx, dy) || 1;
        const nx = -dy / len;
        const ny = dx / len;
        const sign = (options.curveSign === -1 || options.curveSign === 1)
          ? options.curveSign
          : (Math.random() < 0.5 ? -1 : 1);
        const arcMul = Math.max(0, options.curveArcMul ?? 0.30);
        const arcMax = Math.max(0.10, options.curveArcMaxTiles ?? 1.35);
        const arc = Math.min(arcMax, len * arcMul) * sign;
        const cx = (this.x + this.tx) * 0.5 + nx * arc;
        const cy = (this.y + this.ty) * 0.5 + ny * arc;
        const curveLen = this.approxCurveLength(this.x, this.y, cx, cy, this.tx, this.ty);
        this._curve = { x0: this.x, y0: this.y, cx, cy, x1: this.tx, y1: this.ty, len: curveLen };
      }
      return this;
    }

    approxCurveLength(x0, y0, cx, cy, x1, y1){
      let px = x0;
      let py = y0;
      let total = 0;
      const steps = 12;
      for (let i = 1; i <= steps; i += 1) {
        const t = i / steps;
        const omt = 1 - t;
        const x = omt*omt*x0 + 2*omt*t*cx + t*t*x1;
        const y = omt*omt*y0 + 2*omt*t*cy + t*t*y1;
        total += Math.hypot(x - px, y - py);
        px = x;
        py = y;
      }
      return Math.max(0.0001, total);
    }

    arrive(game){
      this.x = this.tx;
      this.y = this.ty;
      this._arrived = true;
      if (this.onArrive) this.onArrive(game, this);
      if (this._stopOnArrive) {
        this.dead = true;
        return;
      }
      const ex = game.map.exit.x + 0.5;
      const ey = game.map.exit.y + 0.5;
      const edx = ex - this.x;
      const edy = ey - this.y;
      const el = Math.hypot(edx, edy) || 1;
      this._dirX = edx / el;
      this._dirY = edy / el;
    }

    update(dt, game){
      if(this.dead) return;

      if(!this._arrived){
        const step = this.speed * dt;

        if (this._curve) {
          this._curveT = Math.min(1, this._curveT + step / this._curve.len);
          const t = this._curveT;
          const omt = 1 - t;
          this.x = omt*omt*this._curve.x0 + 2*omt*t*this._curve.cx + t*t*this._curve.x1;
          this.y = omt*omt*this._curve.y0 + 2*omt*t*this._curve.cy + t*t*this._curve.y1;
          if (t >= 0.999) {
            this.arrive(game);
            return;
          }
        }else{
          const dx = this.tx - this.x;
          const dy = this.ty - this.y;
          const d = Math.hypot(dx, dy);
          if (d < 0.12 || step >= d) {
            this.arrive(game);
            return;
          }
          this.x += (dx / d) * step;
          this.y += (dy / d) * step;
        }

        if (this._onPass && this._passRadius > 0) {
          const rr2 = this._passRadius * this._passRadius;
          const nowSec = performance.now() / 1000;
          const nearby = (typeof game.getEnemiesInRange === "function")
            ? game.getEnemiesInRange(this.x, this.y, this._passRadius, this._enemyRangeScratch)
            : game.enemies;
          for (const e of nearby) {
            if (e.dead || e.reachedExit) continue;
            if (dist2(this.x, this.y, e.x, e.y) <= rr2) {
              if (this._passRepeatSec <= 0) {
                if (this._passHitSet.has(e)) continue;
                this._passHitSet.add(e);
                this._onPass(e, game, this);
              } else {
                const prev = this._passLastHit.get(e) ?? -Infinity;
                if ((nowSec - prev) < this._passRepeatSec) continue;
                this._passLastHit.set(e, nowSec);
                this._onPass(e, game, this);
              }
            }
          }
        }
        return;
      }

      this.x += this._dirX*this.speed*dt;
      this.y += this._dirY*this.speed*dt;
      const margin=1.0;
      if(this.x < -margin || this.y < -margin || this.x > game.map.w+margin || this.y > game.map.h+margin){
        this.dead=true;
      }
    }
  }

function acquireFloatingText(x,y,text, life=CFG.FLOAT_TEXT_LIFE, size=14, isCrit=false, isCenter=false){
  const item = floatingTextPool.pop();
  if (item) return item.reset(x, y, text, life, size, isCrit, isCenter);
  return new FloatingText(x, y, text, life, size, isCrit, isCenter);
}

function releaseFloatingText(item){
  if (!item) return;
  item.dead = true;
  item.text = "";
  item.t = 0;
  item.life = 1;
  item.isCrit = false;
  item.isCenter = false;
  pushToPool(floatingTextPool, item, FLOATING_TEXT_POOL_LIMIT);
}

function acquireEffectLine(ax,ay,bx,by,lifetime,color,width=3){
  const item = effectLinePool.pop();
  if (item) return item.reset(ax, ay, bx, by, lifetime, color, width);
  return new EffectLine(ax, ay, bx, by, lifetime, color, width);
}

function releaseEffectLine(item){
  if (!item) return;
  item.dead = true;
  item.color = null;
  item.t = 0;
  item.life = 1;
  pushToPool(effectLinePool, item, EFFECT_LINE_POOL_LIMIT);
}

function acquireEffectRing(x,y, maxRadiusTiles, speedTilesPerSec, lifetime, color, onHit, width=3){
  const item = effectRingPool.pop();
  if (item) return item.reset(x, y, maxRadiusTiles, speedTilesPerSec, lifetime, color, onHit, width);
  return new EffectRing(x, y, maxRadiusTiles, speedTilesPerSec, lifetime, color, onHit, width);
}

function releaseEffectRing(item){
  if (!item) return;
  item.dead = true;
  item.onHit = null;
  item.t = 0;
  item.life = 1;
  item.hitSet.clear();
  item._enemyRangeScratch.length = 0;
  pushToPool(effectRingPool, item, EFFECT_RING_POOL_LIMIT);
}

function acquireProjectile(x,y,target,speed,payload,visual,expectedDealt,sourceTower){
  const item = projectilePool.pop();
  if (item) return item.reset(x, y, target, speed, payload, visual, expectedDealt, sourceTower);
  return new Projectile(x, y, target, speed, payload, visual, expectedDealt, sourceTower);
}

function releaseProjectile(item){
  if (!item) return;
  item.detachIncoming();
  item.dead = true;
  item.t = null;
  item.payload = null;
  item.visual = null;
  item.trailCfg = null;
  item.sourceTower = null;
  item._spent = false;
  item._drift = false;
  item.expectedDealt = 0;
  item.trailNodes.length = 0;
  item._enemyRangeScratch.length = 0;
  pushToPool(projectilePool, item, PROJECTILE_POOL_LIMIT);
}

function acquireFreeProjectile(x,y,tx,ty,speed,visual,onArrive, options={}){
  const item = freeProjectilePool.pop();
  if (item) return item.reset(x, y, tx, ty, speed, visual, onArrive, options);
  return new FreeProjectile(x, y, tx, ty, speed, visual, onArrive, options);
}

function releaseFreeProjectile(item){
  if (!item) return;
  item.dead = true;
  item.visual = null;
  item.onArrive = null;
  item._onPass = null;
  item._curve = null;
  item._curveT = 0;
  item._passHitSet.clear();
  item._passLastHit.clear();
  item._enemyRangeScratch.length = 0;
  pushToPool(freeProjectilePool, item, FREE_PROJECTILE_POOL_LIMIT);
}

function releaseAnyEffect(item){
  if (!item) return;
  if (item instanceof EffectLine) {
    releaseEffectLine(item);
    return;
  }
  if (item instanceof EffectRing) {
    releaseEffectRing(item);
  }
}

function releaseAnyProjectile(item){
  if (!item) return;
  if (item instanceof Projectile) {
    releaseProjectile(item);
    return;
  }
  if (item instanceof FreeProjectile) {
    releaseFreeProjectile(item);
  }
}

  // =========================================================
  // Special upgrade system (milestones)
  // =========================================================
  
export {
  FloatingText,
  EffectLine,
  EffectRing,
  Projectile,
  FreeProjectile,
  acquireFloatingText,
  releaseFloatingText,
  acquireEffectLine,
  releaseEffectLine,
  acquireEffectRing,
  releaseEffectRing,
  acquireProjectile,
  releaseProjectile,
  acquireFreeProjectile,
  releaseFreeProjectile,
  releaseAnyEffect,
  releaseAnyProjectile
};

import { CFG } from "./config.js";
import { clamp, dist2, now, formatCompact, pickN } from "./utils.js";
import { applyPhysicalDamage, applyMagicDamage } from "./damage.js";
import { scaleForWave, wavePlan } from "./waves.js";
import { acquireFloatingText } from "./projectiles.js";

const ENEMY_TYPES = {
    runner: { name:"Runner", HP: 155, Speed: 1.30, Armor: 7, MR: 10, Wealth: 10 },
    tank:   { name:"Tank",   HP: 380, Speed: 0.78, Armor: 20, MR: 14, Wealth: 16 },
    siphon: { name:"Siphoner", HP: 230, Speed: 0.95, Armor: 6, MR: 18, Wealth: 20 },
    boss:   { name:"Boss",   HP: 999, Speed: 0.30, Armor: 26, MR: 18, Wealth: 999 }
  };

const ENEMY_AFFIXES = [
    { id:"armored", name:"Armored" },
    { id:"arcane", name:"Arcane" },
    { id:"swift", name:"Swift" },
    { id:"regen", name:"Regenerating" },
    { id:"volatile", name:"Volatile" }
  ];

const AFFIX_INFO = {
    armored: { name: "Armored", desc: "Increases Armor and HP." },
    arcane: { name: "Arcane", desc: "Increases MR and HP." },
    swift: { name: "Swift", desc: "Increases speed and slow resistance." },
    regen: { name: "Regenerating", desc: "Regenerates HP over time." },
    volatile: { name: "Volatile", desc: "Spawns minions on death." }
  };

  // Wave'e gore elit ozellik (affix) verilip verilmeyecegini belirler.
  // Donus: secilen affix id listesi (su an en fazla 1 adet).
  function rollAffixes(wave, isBoss){
    if (wave < CFG.ELITE_START_WAVE) return [];
    let chance = CFG.ELITE_CHANCE_BASE + (wave - CFG.ELITE_START_WAVE) * CFG.ELITE_CHANCE_PER_WAVE;
    chance = Math.min(chance, CFG.ELITE_CHANCE_MAX);
    if (isBoss) chance *= CFG.ELITE_BOSS_CHANCE_MULT;
    if (Math.random() > chance) return [];

    const ids = ENEMY_AFFIXES.map(a => a.id);
    return pickN(ids, Math.min(1, ids.length));
  }

// Ayni anda birden fazla affix olursa toplam etkiyi kontrollu azaltir.
function affixPowerScale(count){
    if (count <= 1) return 1;
    const scale = 1 - (count - 1) * CFG.AFFIX_MULTI_SCALE_STEP;
    return clamp(scale, CFG.AFFIX_MULTI_SCALE_MIN, 1);
  }

// Affix gucune wave ilerledikce ufak bir carpani ekler (ust sinirli).
function modifierWaveScale(wave){
    const w = Math.max(CFG.ELITE_START_WAVE, wave || 0);
    const bonus = (w - CFG.ELITE_START_WAVE) * 0.002;
    return clamp(1 + bonus, 1, 1.18);
  }

// Dusmanin UI'da gosterilecek aktif modifier ozetini uretir.
// Oncelik puanina gore siralayıp en yuksek oncelikli tek kaydi dondurur.
function listEnemyModifiers(enemy){
    const entries = [];
    const affixId = (enemy?.affixIds && enemy.affixIds.length) ? enemy.affixIds[0] : null;
    if (affixId) {
      const info = AFFIX_INFO[affixId] || { name: affixId, desc: "" };
      entries.push({ id: `affix:${affixId}`, name: info.name, desc: info.desc, iconKind: "affix", iconId: affixId, priority: 80 });
    }
    if (enemy?.resistWaveType) {
      const t = enemy.resistWaveType === "armor" ? "Armor" : "MR";
      entries.push({
        id: `resistWave:${enemy.resistWaveType}`,
        name: `Resist Wave (${t} boost)`,
        desc: `This wave is focused on ${t} resistance.`,
        iconKind: "status",
        iconId: "resist",
        priority: 60
      });
    }
    if (enemy?.typeId === "siphon") {
      entries.push({
        id: "manaBurn",
        name: `Mana Burn (Aura ${CFG.MANA_BURN_AURA_RADIUS_TILES.toFixed(1)} tile)`,
        desc: "Reduces mana and prestige mana of nearby towers.",
        iconKind: "status",
        iconId: "decay",
        priority: 40
      });
    }
    if (!entries.length) return [];
    entries.sort((a,b) => b.priority - a.priority);
    return [entries[0]];
  }

  // =========================================================
  // Scaling (late game harder)
  // =========================================================
  
function computePrevWaveTotals(prevWave) {
    // Onceki wave planindaki boss disi birimlerin toplam HP ve odulunu hesaplar.
    const plan = wavePlan(prevWave).filter(p=>p.type!=="boss");
    let totalHP=0, totalWealth=0;
    for (const p of plan) {
      const base = ENEMY_TYPES[p.type];
      const s = scaleForWave(base, prevWave);
      totalHP += s.HP * p.count;
      totalWealth += s.Wealth * p.count;
    }
    return { totalHP, totalWealth };
  }

  // =========================================================
  // Tower milestones + special upgrades
  // =========================================================
  
  class Enemy {
    // Enemy olusumu - MOB GUCLENME PIPELINE:
    // 1) Ilk taban stati cikar:
    //    - Normal dusmanda scaleForWave(base, wave) kullanilir.
    //    - Boss + customBossStats varsa disaridan gelen stat birebir alinir.
    // 2) Wave modlarini uygula (constructor seviyesinde birinci katman buff):
    //    - overcap: dalga limiti asildiginda adet yerine stat carpani ile zorluk artar.
    //    - resist wave: o dalganin temasina gore armor veya MR ekstra buyur, HP de desteklenir.
    // 3) _baseStats snapshot'i al:
    //    - recomputeModifiers her cagrida bu snapshot'tan baslar.
    //    - Boylece ayni buff tekrar tekrar ustune binmez (double dip engellenir).
    // 4) recomputeModifiers ile ikinci katman guclenme:
    //    - affix etkileri, debuff direncleri, poison decay vb. runtime modifier'lar uygulanir.
    // 5) Son olarak hareket/CC/DOT/boss skill gibi combat-state alanlari initialize edilir.
    constructor(map, typeId, wave, game, customBossStats=null, waveMods=null) {
      this.map = map;
      this.game = game;
      this.typeId = typeId;
      this.wave = wave;

      const base = ENEMY_TYPES[typeId];

      if (typeId === "boss" && customBossStats) {
        this.maxHP = customBossStats.HP;
        this.hp = customBossStats.HP;
        this.baseSpeed = customBossStats.Speed;
        this.baseArmor = customBossStats.Armor;
        this.baseMR = customBossStats.MR;
        this.wealth = customBossStats.Wealth;
        this.isBoss = true;
      } else {
        const s = scaleForWave(base, wave);
        this.maxHP = s.HP;
        this.hp = s.HP;
        this.baseSpeed = s.Speed;
        this.baseArmor = s.Armor;
        this.baseMR = s.MR;
        this.wealth = s.Wealth;
        this.isBoss = false;
      }

      // Overcap guclenmesi:
      // - waveMods.overcap varsa HP/Armor/MR/Speed carpani uygulanir.
      // - HP ve Armor tam carpani alir.
      // - MR carpani yumusatilir (yalnizca %50 etkili artis) ki buyu hasari tamamen dusmesin.
      // - Bu katman "taban" guclenme sayildigi icin _baseStats'e islenir.
      const overcap = waveMods?.overcap;
      if (overcap) {
        this.maxHP = Math.max(1, Math.round(this.maxHP * Math.max(1, overcap.hp || 1)));
        this.hp = this.maxHP;
        this.baseArmor = Math.max(0, Math.round(this.baseArmor * Math.max(1, overcap.armor || 1)));
        const mrOvercapMul = 1 + (Math.max(1, overcap.mr || 1) - 1) * 0.5;
        this.baseMR = Math.max(0, Math.round(this.baseMR * mrOvercapMul));
        this.baseSpeed = this.baseSpeed * Math.max(1, overcap.speed || 1);
      }

      // Resistance wave guclenmesi:
      // - resistType "armor" ise zırh, "mr" ise buyu direnci odakli dalga olur.
      // - Defans artis yuzdesi wave ile lineer buyur ama CFG.RESIST_WAVE_DEF_PCT_MAX ile sinirlanir.
      // - Armor dalgasinda tam defPct, MR dalgasinda yari katsayi (defPct*0.5) uygulanir.
      // - Ek olarak bu dalga tipinde HP de yuzdesel buyutulur; burst'a karsi yasama suresi artar.
      this.resistWaveType = waveMods?.resistType || null;
      if (this.resistWaveType) {
        const defPctRaw = CFG.RESIST_WAVE_DEF_PCT_BASE + Math.max(0, wave - CFG.RESIST_WAVE_START) * CFG.RESIST_WAVE_DEF_PCT_PER_WAVE;
        const defPct = Math.min(defPctRaw, CFG.RESIST_WAVE_DEF_PCT_MAX);
        if (this.resistWaveType === "armor") {
          this.baseArmor = Math.round(this.baseArmor * (1 + defPct));
        } else if (this.resistWaveType === "mr") {
          this.baseMR = Math.round(this.baseMR * (1 + defPct * 0.5));
        }
        this.maxHP = Math.round(this.maxHP * (1 + CFG.RESIST_WAVE_HP_PCT));
        this.hp = this.maxHP;
      }

      // Not: bu snapshot, "ham taban + wave bazli guclenme" durumudur.
      // Affix gibi degisken etkiler bu nesneden tekrar turetilir.
      this._baseStats = {
        maxHP: this.maxHP,
        baseArmor: this.baseArmor,
        baseMR: this.baseMR,
        baseSpeed: this.baseSpeed,
        wealth: this.wealth
      };

      // Elite affixes
      this.affixIds = (waveMods?.noAffix ? [] : rollAffixes(wave, this.isBoss)).slice(0, 1);
      this.regenPerSec = 0;
      this.volatileSpawnCount = 0;
      this.wealthBonusPct = 0;

      // Unified enemy modifiers (affix + wave buffs + passive buffs)
      this.recomputeModifiers({ preserveRatios: false });

      // Mana burn aura
      this.manaBurn = (typeId === "siphon")
        ? { radius: CFG.MANA_BURN_AURA_RADIUS_TILES }
        : null;

      this.armorShredFlat = 0;   // (X)
      this.slowPct = 0;
      this.slowTime = 0;
      this.rootTime = 0;
      this.slows = [];
      this.slowByTower = new Map();
      this.armorShredByTower = new Map();
      this.poisonByTower = new Map();

      // Poison (kalıcı)
      this.poisonStacks = 0;
      this.poisonTickCD = CFG.POISON_TICK_CD;
      this.poisonTickTimer = this.poisonTickCD;
      this.poisonPerTick = 0;
      this.poisonSource = null;
      this.poisonMagicPen = 0;

      // Frostbite (Blizzard prestige)
      this.frostbiteTime = 0;
      this.frostbiteDotTime = 0;
      this.frostbiteTickCD = CFG.FROSTBITE_TICK_CD;
      this.frostbiteTickTimer = this.frostbiteTickCD;
      this.frostbitePerTick = 0;
      this.frostbiteSource = null;
      this.frostbiteMagicPen = 0;
      this._blizVulnMul = 1;

      this.incomingEstimate = 0;
      this._towerRangeScratch = [];

      this.bossSkills = null;
      if (this.isBoss) {
        const init = (cd) => cd * (0.6 + Math.random() * 0.4);
        this.bossSkills = {
          cleanse: { id: "cleanse", name: "Cleanse", cd: CFG.BOSS_SKILL_CLEANSE_CD, timer: init(CFG.BOSS_SKILL_CLEANSE_CD) },
          heal:    { id: "heal",    name: "Heal",    cd: CFG.BOSS_SKILL_HEAL_CD,    timer: init(CFG.BOSS_SKILL_HEAL_CD) },
          summon:  { id: "summon",  name: "Summon",  cd: CFG.BOSS_SKILL_SUMMON_CD,  timer: init(CFG.BOSS_SKILL_SUMMON_CD) }
        };
        const ids = ["cleanse","heal","summon"];
        let activeCount = 1;
        if (wave >= 80) activeCount = 3;
        else if (wave >= 40) activeCount = 2;
        const active = new Set(pickN(ids, activeCount));
        this.bossActiveSkills = active;
        for (const id of ids) {
          this.bossSkills[id].active = active.has(id);
        }
      }

      this.pathIndex=0;
      const p0 = map.path[0];
      this.x=p0.x+0.5; this.y=p0.y+0.5;

      this.reachedExit=false;
      this.dead=false;
      this._rewarded=false;
      this.lastHitTower = null;
      this.lastBossSkill = null;

      this.birthT = now();
    }

    // Etkin armor degeri:
    // raw = baseArmor - armorShredFlat.
    // - Normal durumda armor 0 altina inmez; fiziksel hasari "asiri" arttirmayi engeller.
    // - anyBreakerPrestigeActive aktifse negatif armor'a izin verilir; bu durumda fiziksel hasar
    //   formulu negatif armor'u da gorur ve hasar carpani yukselebilir.
    get armor() {
      const raw = this.baseArmor - this.armorShredFlat;
      return this.game.anyBreakerPrestigeActive ? raw : Math.max(0, raw);
    }
    get mr() {
      return this.baseMR;
    }

    // Armor shred ekler:
    // - armorShredFlat toplam duz zırh azaltim havuzudur (yuzdesel degil, flat).
    // - sourceTower verilirse katkı tower bazinda Map'te tutulur.
    // - Bu takip, ileride "hangi kule ne kadar shred uyguladi" analizi/temizligi icin kullanilir.
    applyArmorShred(flat, sourceTower=null) {
      this.armorShredFlat = this.armorShredFlat + flat;
      if (sourceTower) {
        const prev = this.armorShredByTower.get(sourceTower) || 0;
        this.armorShredByTower.set(sourceTower, prev + flat);
      }
    }

    // Slow uygular:
    // - Dirence gore etkili slow'u hesaplar,
    // - Global listede ve tower-kaynakli tabloda saklar,
    // - O anki en yuksek slow degerlerini gunceller.
    applySlow(pct, duration, sourceTower=null, ignoreResist=false) {
      if (duration <= 0 || pct <= 0) return;
      const resist = ignoreResist ? 0 : clamp(this.slowResist, 0, 0.70);
      const effPct = pct * (1 - resist);
      if (effPct <= 0) return;
      this.slows.push({ pct: effPct, time: duration });
      if (sourceTower) {
        const prev = this.slowByTower.get(sourceTower);
        if (!prev) this.slowByTower.set(sourceTower, { pct: effPct, time: duration });
        else {
          prev.pct = Math.max(prev.pct, effPct);
          prev.time = Math.max(prev.time, duration);
        }
      }
      if (effPct > this.slowPct) this.slowPct = effPct;
      if (duration > this.slowTime) this.slowTime = duration;
    }

    // Poison stack ekler/gunceller.
    // En yuksek tick gucu ve magic penetration degerini korur.
    applyPoison(stacksAdd, perTickPerStack, sourceTower, magicPenFlat=0){
      this.poisonStacks += stacksAdd;
      this.poisonStacks = Math.max(0, this.poisonStacks);
      if (sourceTower) {
        const prev = this.poisonByTower.get(sourceTower) || 0;
        this.poisonByTower.set(sourceTower, Math.max(0, prev + stacksAdd));
      }

      this.poisonPerTick = Math.max(this.poisonPerTick, perTickPerStack);
      this.poisonSource = sourceTower || this.poisonSource;
      this.poisonMagicPen = Math.max(this.poisonMagicPen, magicPenFlat);

      this.poisonTickTimer = Math.min(this.poisonTickTimer, CFG.POISON_TICK_MIN);
    }

    // Frostbite tek seferde uygulanir (zaten aktifse tekrar uygulanmaz).
    // Sure ve DOT degeri direnclere gore ayarlanir; ayrica tam slow verir.
    applyFrostbite(duration, perTick, sourceTower, magicPenFlat=0){
      if (this.frostbiteTime > 0 || this.frostbiteDotTime > 0) return false;
      if (duration <= 0 || perTick <= 0) return false;
      const durAdj = duration;
      const tickAdj = perTick * (1 - clamp(this.poisonResist, 0, 0.40) * 0.35);
      this.frostbiteTime = durAdj;
      this.rootTime = Math.max(this.rootTime, durAdj);
      this.frostbiteDotTime = CFG.FROSTBITE_DOT_DURATION;
      this.frostbiteTickTimer = this.frostbiteTickCD;
      this.frostbitePerTick = tickAdj;
      this.frostbiteSource = sourceTower || this.frostbiteSource;
      this.frostbiteMagicPen = Math.max(this.frostbiteMagicPen, magicPenFlat);
      this.applySlow(1.0, durAdj, sourceTower, true);
      this._blizVulnMul = Math.max(this._blizVulnMul || 1, 1.15);
      return true;
    }

    // Mob guclenme - ikinci katman hesap:
    // Asama A) _baseStats'e resetle:
    //   Her hesap temiz tabandan baslar; bir onceki hesapta gelen affix etkisi birikmez.
    // Asama B) Affix etkilerini uygula:
    //   armor/mr/speed/hp/regen/summon gibi istatistikler affix id'sine gore degisir.
    // Asama C) Wave'e bagli dogal debuff direncini ekle:
    //   slowResist ve poisonResist wave ilerledikce artar, max degerlerle clamp edilir.
    // Asama D) Ek ekonomi/denge:
    //   wealth bonus ve poison decay gibi gec oyun dengeleme alanlari guncellenir.
    // Asama E) HP oranini koru:
    //   preserveRatios=true ise mevcut HP%, yeni maxHP'ye map edilerek adil gecis saglanir.
    recomputeModifiers({ preserveRatios=true } = {}){
      if (!this._baseStats) return;
      const hpRatio = preserveRatios && this.maxHP > 0 ? (this.hp / this.maxHP) : 1;

      this.baseArmor = this._baseStats.baseArmor;
      this.baseMR = this._baseStats.baseMR;
      this.baseSpeed = this._baseStats.baseSpeed;
      this.maxHP = this._baseStats.maxHP;
      this.wealth = this._baseStats.wealth;

      this.regenPerSec = 0;
      this.volatileSpawnCount = 0;
      this.wealthBonusPct = 0;

      // Bu projede aktif tasarim: bir dusmanda en fazla 1 affix aktif tutuluyor.
      this.affixIds = (this.affixIds || []).slice(0, 1);
      // Affix guc carpani = coklu-affix dengelemesi * wave tabanli bonus.
      const affixScale = affixPowerScale(this.affixIds.length) * modifierWaveScale(this.wave);
      const allowAffixHpBoost = !this.isBoss;
      for (const id of this.affixIds) {
        if (id === "armored") {
          // Armored: fiziksel tanklilik icin armor'u buyutur.
          // Boss'ta HP eklemesi kapali tutularak boss HP'nin patlamasi engellenir.
          this.baseArmor = Math.round(this.baseArmor * (1 + CFG.AFFIX_ARMORED_ARMOR_PCT * affixScale));
          if (allowAffixHpBoost) {
            this.maxHP = Math.round(this.maxHP * (1 + CFG.AFFIX_ARMORED_HP_PCT * affixScale));
          }
          this.wealthBonusPct += 0.20;
        } else if (id === "arcane") {
          // Arcane: buyu direncini buyutur, normal dusmanda HP destegi de ekler.
          this.baseMR = Math.round(this.baseMR * (1 + CFG.AFFIX_ARCANE_MR_PCT * affixScale));
          if (allowAffixHpBoost) {
            this.maxHP = Math.round(this.maxHP * (1 + CFG.AFFIX_ARCANE_HP_PCT * affixScale));
          }
          this.wealthBonusPct += 0.20;
        } else if (id === "swift") {
          this.baseSpeed = this.baseSpeed * (1 + CFG.AFFIX_SWIFT_SPEED_PCT * affixScale);
          this.wealthBonusPct += 0.25;
        } else if (id === "regen") {
          this.regenPerSec = this.maxHP * CFG.AFFIX_REGEN_PCT_PER_SEC * affixScale;
          this.wealthBonusPct += 0.20;
        } else if (id === "volatile") {
          const extra = Math.floor(this.wave / CFG.AFFIX_VOLATILE_SPAWN_WAVE_STEP);
          const raw = (CFG.AFFIX_VOLATILE_SPAWN_BASE + extra) * affixScale;
          this.volatileSpawnCount = Math.min(6, Math.max(1, Math.round(raw)));
          this.wealthBonusPct += 0.25;
        }
      }

      if (this.wealthBonusPct > 0) {
        this.wealth = Math.round(this.wealth * (1 + this.wealthBonusPct));
      }

      const debuffW = Math.max(0, this.wave - CFG.DEBUFF_RESIST_START_WAVE);
      // Wave bazli "dogal" CC direnci:
      // Yukseldikce slow/poison etkileri dusman uzerinde daha az etkili olur.
      this.slowResist = Math.min(CFG.SLOW_RESIST_MAX, debuffW * CFG.SLOW_RESIST_PER_WAVE);
      this.poisonResist = Math.min(CFG.POISON_RESIST_MAX, debuffW * CFG.POISON_RESIST_PER_WAVE);
      if (this.affixIds.includes("swift")) {
        // Swift affix, mevcut slow direncinin ustune ek direnç verir.
        this.slowResist = Math.min(0.70, this.slowResist + CFG.AFFIX_SWIFT_SLOW_RESIST * affixScale);
      }

      this.poisonDecayPerSec = 0;
      if (this.wave >= CFG.POISON_DECAY_START_WAVE) {
        const decay = (this.wave - CFG.POISON_DECAY_START_WAVE) * CFG.POISON_DECAY_PER_WAVE;
        this.poisonDecayPerSec = Math.min(CFG.POISON_DECAY_MAX_PER_SEC, decay);
      }

      if (this.dead) {
        this.hp = 0;
      } else {
        this.hp = clamp(this.maxHP * hpRatio, 1, this.maxHP);
      }

    }

    // Rastgele bir affix siler ve statlari yeniden hesaplar.
    dispelOneAffix(){
      if (!this.affixIds || this.affixIds.length === 0) return null;
      const idx = Math.floor(Math.random() * this.affixIds.length);
      const removed = this.affixIds.splice(idx, 1)[0];
      this.recomputeModifiers();
      return removed;
    }

    // Frame update akisi:
    // 1) Boss skill timer/aktif skill,
    // 2) Slow/regen/poison/frostbite durumlari,
    // 3) Hareket ve yol takibi,
    // 4) Varsa mana-burn aura etkisi.
    update(dt){
      if(this.dead || this.reachedExit) return;

      if (this.isBoss && this.bossSkills) {
        for (const s of Object.values(this.bossSkills)) {
          if (!s.active) continue;
          s.timer -= dt;
        }
        const skillId = this.chooseBossSkill();
        if (skillId) this.castBossSkill(skillId);
      }

      // Slow listesi: sure dusur, aktifleri topla, max slow'u sec.
      if (this.slows.length) {
        let maxPct = 0;
        let maxTime = 0;
        for (const s of this.slows) {
          s.time -= dt;
          if (s.time > 0) {
            if (s.pct > maxPct) maxPct = s.pct;
            if (s.time > maxTime) maxTime = s.time;
          }
        }
        this.slows = this.slows.filter(s => s.time > 0);
        this.slowPct = maxPct;
        this.slowTime = maxTime;
      } else {
        this.slowPct = 0;
        this.slowTime = 0;
      }
      if (this.slowByTower.size) {
        for (const [tower, debuff] of this.slowByTower.entries()) {
          debuff.time -= dt;
          if (debuff.time <= 0) this.slowByTower.delete(tower);
        }
      }

      // Affix kaynakli regen.
      if (this.regenPerSec > 0 && this.hp > 0) {
        this.hp = Math.min(this.maxHP, this.hp + this.regenPerSec * dt);
      }

      // Yuksek wave'de poison stackleri zamanla dusur.
      if (this.poisonDecayPerSec > 0 && this.poisonStacks > 0) {
        const decay = Math.min(this.poisonStacks, this.poisonDecayPerSec * dt);
        if (decay > 0 && this.poisonByTower.size) {
          const totalByTower = Array.from(this.poisonByTower.values()).reduce((a,b)=>a+b, 0);
          if (totalByTower > 0) {
            for (const [tower, stacks] of this.poisonByTower.entries()) {
              const reduced = decay * (stacks / totalByTower);
              const next = Math.max(0, stacks - reduced);
              if (next <= 0.0001) this.poisonByTower.delete(tower);
              else this.poisonByTower.set(tower, next);
            }
          }
        }
        this.poisonStacks = Math.max(0, this.poisonStacks - this.poisonDecayPerSec * dt);
      }

      // Poison tick (kalıcı): stack varsa her 0.1s vurur
      if (this.poisonStacks > 0) {
        this.poisonTickTimer -= dt;
        while (this.poisonTickTimer <= 0 && !this.dead) {
          this.poisonTickTimer += this.poisonTickCD;

          const rawMagic = this.poisonStacks * this.poisonPerTick * (1 - this.poisonResist);
          const dealt = this.takeDamage(0, rawMagic, 0, this.poisonMagicPen, this.poisonSource, false, true);

          if (this.poisonSource) {
            this.poisonSource.damageDealt += dealt;
            // DOT’dan mana kazandırmıyoruz (istenirse açılabilir)
          }
        }
      }

      // Frostbite DOT
      // Frostbite DOT tickleri.
      if (this.frostbiteDotTime > 0) {
        this.frostbiteDotTime = Math.max(0, this.frostbiteDotTime - dt);
        this.frostbiteTickTimer -= dt;
        while (this.frostbiteTickTimer <= 0 && !this.dead && this.frostbiteDotTime > 0) {
          this.frostbiteTickTimer += this.frostbiteTickCD;
          const dealt = this.takeDamage(0, this.frostbitePerTick, 0, this.frostbiteMagicPen, this.frostbiteSource, false, true);
          if (this.frostbiteSource) {
            this.frostbiteSource.damageDealt += dealt;
          }
          if (this.game && dealt > 0.5) {
            this.game.floaters.push(acquireFloatingText(this.x, this.y - 0.35, `${formatCompact(dealt)}`, CFG.FLOAT_TEXT_LIFE, CFG.FLOAT_TEXT_SIZE, false, false));
          }
        }
      }

      if (this.frostbiteTime > 0) {
        this.frostbiteTime = Math.max(0, this.frostbiteTime - dt);
      }
      if (this.rootTime > 0) {
        this.rootTime = Math.max(0, this.rootTime - dt);
      }
      if (this.frostbiteTime <= 0 && this.frostbiteDotTime <= 0) {
        this._blizVulnMul = 1;
      }

      // Etkin slow'a gore hiz carpani hesapla.
      const hasBlizzardPrestige = !!this.game?.anyBlizzardPrestigeActive;
      const effectiveSlowPct = hasBlizzardPrestige
        ? Math.max(0, this.slowPct)
        : clamp(this.slowPct, 0, CFG.SLOW_MAX_PCT);
      const slowMul = Math.max(0, 1 - effectiveSlowPct);
      const speed = (this.rootTime > 0)
        ? 0
        : Math.min(10, this.baseSpeed * slowMul);

      // Path uzerinde bir sonraki node'a dogru ilerle.
      const path=this.map.path;
      const targetIdx=Math.min(this.pathIndex+1, path.length-1);
      const t=path[targetIdx];
      const tx=t.x+0.5, ty=t.y+0.5;

      const dx=tx-this.x, dy=ty-this.y;
      const d=Math.hypot(dx,dy);
      if(d<0.001){
        this.pathIndex=targetIdx;
        if(this.pathIndex>=path.length-1) this.reachedExit=true;
        return;
      }
      const step=speed*dt;
      if(step>=d){
        this.x=tx; this.y=ty;
        this.pathIndex=targetIdx;
        if(this.pathIndex>=path.length-1) this.reachedExit=true;
      }else{
        this.x+=(dx/d)*step;
        this.y+=(dy/d)*step;
      }

      // Siphon aura: menzil icindeki tower manasini azalt.
      if (this.manaBurn && this.game?.towers?.length) {
        const canQuery = typeof this.game.getTowersInRange === "function";
        const towers = canQuery
          ? this.game.getTowersInRange(this.x, this.y, this.manaBurn.radius, this._towerRangeScratch)
          : this.game.towers;
        const r2 = this.manaBurn.radius * this.manaBurn.radius;
        for (const t of towers) {
          if (!canQuery && dist2(this.x, this.y, t.x, t.y) > r2) continue;
          if (t.maxMana > 0) {
            const drain = Math.min(CFG.MANA_BURN_FLAT_PER_SEC, t.maxMana * CFG.MANA_BURN_PCT_PER_SEC);
            t.mana = Math.max(0, t.mana - drain * dt);
          }
          // prestige mana etkilenmez
        }
      }
    }

    // Hasar cozumleme:
    // 1) Fiziksel kisim:
    //    applyPhysicalDamage(physRaw, this.armor, armorPenPct)
    //    - this.armor: baseArmor - shred ve gerekirse negatif armor kurali.
    //    - armorPenPct: saldirinin zırh delme yuzdesi.
    // 2) Buyu kisim:
    //    applyMagicDamage(magicRaw, this.mr, magicPenFlat)
    // 3) Global savunmasiz kalma carpani (blizzard vuln) eklenir.
    // 4) Son hasar HP'den duser; floater/kill/summon gibi yan etkiler tetiklenir.
    takeDamage(physRaw, magicRaw, armorPenPct, magicPenFlat, sourceTower, showFloat=true, isDot=false) {
      if(this.dead) return 0;

      let dealt=0;
      if(physRaw>0) dealt += applyPhysicalDamage(physRaw, this.armor, armorPenPct);
      if(magicRaw>0) dealt += applyMagicDamage(magicRaw, this.mr, magicPenFlat);
      const vulnMul = this._blizVulnMul || 1;
      dealt *= vulnMul;
      if (this.game?.recordDamage) this.game.recordDamage(dealt, sourceTower || null);

      this.hp -= dealt;
      if (sourceTower) this.lastHitTower = sourceTower;

      if (showFloat && dealt > 0.5 && this.game) {
        const isCrit = !!sourceTower?._lastShotWasCrit;
        const txt = isCrit ? `💥 ${formatCompact(dealt)}` : `${formatCompact(dealt)}`;
        this.game.floaters.push(acquireFloatingText(this.x, this.y - 0.35, txt, CFG.FLOAT_TEXT_LIFE, isCrit ? CFG.FLOAT_TEXT_CRIT_SIZE : CFG.FLOAT_TEXT_SIZE, isCrit, false));
      }

      if(this.hp<=0){
        this.hp=0;
        if (this.isBoss && this.game?.addScreenShake) {
          this.game.addScreenShake(0.08, 0.24);
        }
        this.dead=true;
        if (this.affixIds.includes("volatile") && !this._volatileSpawned && this.game) {
          this._volatileSpawned = true;
          this.game.spawnVolatileMinions(this, this.volatileSpawnCount);
        }
        if (this.lastHitTower) {
          this.lastHitTower.kills += 1;
          this.lastHitTower.game.totalKills += 1;
          if (this.lastHitTower.game?.recordKill) this.lastHitTower.game.recordKill(this.lastHitTower);
        }
      }
      return dealt;
    }

    // Boss AI karar sirasi: cleanse > heal > summon.
    chooseBossSkill(){
      if (!this.bossSkills) return null;
      const debuffed = (this.poisonStacks > 0) || (this.slowPct > 0.2) || (this.frostbiteTime > 0) || (this.frostbiteDotTime > 0);

      const cleanse = this.bossSkills.cleanse;
      if (cleanse && cleanse.active && cleanse.timer <= 0 && debuffed) return "cleanse";

      const heal = this.bossSkills.heal;
      if (heal && heal.active && heal.timer <= 0 && this.hp < this.maxHP) return "heal";

      const summon = this.bossSkills.summon;
      if (summon && summon.active && summon.timer <= 0) return "summon";

      return null;
    }

    // Secilen boss skill'inin etkisini uygular ve cooldown resetler.
    castBossSkill(skillId){
      if (!skillId) return;

      if (skillId === "cleanse") {
        this.lastBossSkill = "Cleanse";
        this.slows = [];
        this.slowPct = 0;
        this.slowTime = 0;
        this.slowByTower.clear();
        this.poisonStacks *= CFG.BOSS_CLEANSE_POISON_KEEP_PCT;
        if (this.poisonByTower.size) {
          for (const [tower, stacks] of this.poisonByTower.entries()) {
            const next = stacks * CFG.BOSS_CLEANSE_POISON_KEEP_PCT;
            if (next <= 0.0001) this.poisonByTower.delete(tower);
            else this.poisonByTower.set(tower, next);
          }
        }
        this.frostbiteTime = 0;
        this.frostbiteDotTime = 0;
        if (this.bossSkills?.cleanse) this.bossSkills.cleanse.timer = this.bossSkills.cleanse.cd;
        if (this.game) {
          this.game.floaters.push(acquireFloatingText(this.x, this.y - 0.6, "CLEANSE", 0.9, 14, false, false));
        }
        return;
      }
      if (skillId === "heal") {
        this.lastBossSkill = "Heal";
        const amount = Math.max(1, Math.round(this.maxHP * CFG.BOSS_HEAL_PCT));
        this.hp = Math.min(this.maxHP, this.hp + amount);
        if (this.bossSkills?.heal) this.bossSkills.heal.timer = this.bossSkills.heal.cd;
        if (this.game) {
          this.game.floaters.push(acquireFloatingText(this.x, this.y - 0.6, `HEAL +${amount}`, 0.9, 14, false, false));
        }
        return;
      }
      if (skillId === "summon" && this.game) {
        this.lastBossSkill = "Summon";
        const extra = Math.floor(this.wave / 30) * CFG.BOSS_SUMMON_PER_30_WAVES;
        const count = CFG.BOSS_SUMMON_BASE + extra;
        this.game.spawnBossAdds(this, count);
        if (this.bossSkills?.summon) this.bossSkills.summon.timer = this.bossSkills.summon.cd;
        this.game.floaters.push(acquireFloatingText(this.x, this.y - 0.6, `SUMMON x${count}`, 0.9, 14, false, false));
      }
    }
  }

  // =========================================================
  // Effects
  // =========================================================
  
export { ENEMY_TYPES, computePrevWaveTotals, listEnemyModifiers, Enemy };

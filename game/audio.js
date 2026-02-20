const SFX = (() => {
  let ctx = null;
  let master = null;
  let muted = false;
  let volume = 0.18;
  const last = new Map();

  const clamp = (v, min, max) => Math.max(min, Math.min(max, v));

  const applyMasterGain = () => {
    if (!master) return;
    master.gain.value = muted ? 0 : volume;
  };

  const ensureCtx = () => {
    if (!ctx) {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      ctx = new Ctx();
      master = ctx.createGain();
      applyMasterGain();
      master.connect(ctx.destination);
    }
    return ctx;
  };

  const canPlay = (key, minInterval) => {
    const t = performance.now() / 1000;
    const prev = last.get(key) || 0;
    if (t - prev < minInterval) return false;
    last.set(key, t);
    return true;
  };

  const tone = (opts) => {
    if (muted) return;
    const c = ensureCtx();
    const t = c.currentTime;
    const o = c.createOscillator();
    const g = c.createGain();

    o.type = opts.type || "sine";
    o.frequency.setValueAtTime(opts.freq, t);
    if (opts.detune) o.detune.setValueAtTime(opts.detune, t);
    if (opts.curve) {
      o.frequency.exponentialRampToValueAtTime(
        Math.max(30, opts.freq * (1 + opts.curve)),
        t + opts.dur
      );
    }

    g.gain.value = 0.0001;
    o.connect(g);
    g.connect(master);

    const attack = opts.attack ?? 0.002;
    const decay = opts.decay ?? opts.dur;
    const vol = opts.vol ?? 0.25;
    g.gain.exponentialRampToValueAtTime(vol, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + attack + decay);

    o.start(t);
    o.stop(t + attack + decay + 0.02);
  };

  const wave = (waveNum) => {
    if (waveNum % 10 === 0) {
      if (!canPlay("waveBoss", 0.2)) return;
      tone({ freq: 120, type: "sawtooth", dur: 0.18, vol: 0.5, attack: 0.005, decay: 0.22, curve: -0.08 });
      return;
    }
    if (!canPlay("wave", 0.2)) return;
    tone({ freq: 420, type: "triangle", dur: 0.08, vol: 0.32, attack: 0.002, decay: 0.08, curve: -0.15 });
  };

  const place = () => {
    if (!canPlay("place", 0.05)) return;
    tone({ freq: 520, type: "square", dur: 0.04, vol: 0.22, attack: 0.001, decay: 0.05, curve: -0.1 });
  };

  const sell = () => {
    if (!canPlay("sell", 0.05)) return;
    tone({ freq: 220, type: "triangle", dur: 0.06, vol: 0.24, attack: 0.002, decay: 0.07, curve: -0.12 });
  };

  const shoot = () => {
    const t = performance.now() / 1000;
    const prev = last.get("shoot") || 0;
    if (t - prev < 0.07) return;
    if (Math.random() > 0.18) return;
    last.set("shoot", t);
    tone({ freq: 780 + Math.random() * 120, type: "sine", dur: 0.02, vol: 0.07, attack: 0.001, decay: 0.03, curve: -0.25 });
  };

  const gold = (amount = 1) => {
    if (!canPlay("gold", 0.08)) return;
    const mult = Math.min(4, Math.max(1, amount));
    tone({ freq: 620 + mult * 30, type: "triangle", dur: 0.05, vol: 0.18, attack: 0.001, decay: 0.05, curve: 0.06 });
  };

  const gameOver = () => {
    if (!canPlay("gameOver", 0.5)) return;
    tone({ freq: 220, type: "sawtooth", dur: 0.22, vol: 0.35, attack: 0.005, decay: 0.26, curve: -0.2 });
    setTimeout(() => {
      tone({ freq: 160, type: "sine", dur: 0.24, vol: 0.32, attack: 0.005, decay: 0.3, curve: -0.25 });
    }, 120);
  };

  const prestige = () => {
    if (!canPlay("prestige", 0.6)) return;
    tone({ freq: 420, type: "triangle", dur: 0.10, vol: 0.30, attack: 0.003, decay: 0.12, curve: 0.08 });
    setTimeout(() => {
      tone({ freq: 560, type: "triangle", dur: 0.10, vol: 0.28, attack: 0.003, decay: 0.12, curve: 0.10 });
    }, 90);
    setTimeout(() => {
      tone({ freq: 700, type: "triangle", dur: 0.12, vol: 0.26, attack: 0.003, decay: 0.14, curve: 0.12 });
    }, 180);
  };

  const click = () => {
    if (!canPlay("click", 0.03)) return;
    if (Math.random() < 0.5) {
      // Variant A: bright metallic tick
      tone({ freq: 1680 + Math.random() * 140, type: "square", dur: 0.012, vol: 0.072, attack: 0.001, decay: 0.015, curve: -0.42 });
      setTimeout(() => {
        tone({ freq: 1120 + Math.random() * 90, type: "triangle", dur: 0.010, vol: 0.045, attack: 0.001, decay: 0.012, curve: -0.30 });
      }, 7);
      return;
    }
    // Variant B: short metal tap with slightly lower body
    tone({ freq: 1480 + Math.random() * 120, type: "sawtooth", dur: 0.013, vol: 0.068, attack: 0.001, decay: 0.016, curve: -0.36 });
    setTimeout(() => {
      tone({ freq: 920 + Math.random() * 70, type: "square", dur: 0.010, vol: 0.041, attack: 0.001, decay: 0.012, curve: -0.24 });
    }, 8);
  };

  const unlock = () => {
    const c = ensureCtx();
    if (c.state === "suspended") c.resume();
  };

  const setMuted = (v) => {
    muted = !!v;
    applyMasterGain();
  };

  const toggleMuted = () => {
    setMuted(!muted);
    return muted;
  };

  const isMuted = () => muted;

  const setVolume = (v) => {
    const n = Number(v);
    if (!Number.isFinite(n)) return volume;
    volume = clamp(n, 0, 1);
    applyMasterGain();
    return volume;
  };

  const getVolume = () => volume;

  const bindAutoUnlock = () => {
    if (bindAutoUnlock._done) return;
    bindAutoUnlock._done = true;
    const handler = () => {
      unlock();
      window.removeEventListener("pointerdown", handler);
      window.removeEventListener("keydown", handler);
    };
    window.addEventListener("pointerdown", handler, { once: true });
    window.addEventListener("keydown", handler, { once: true });
  };

  return {
    wave,
    place,
    sell,
    shoot,
    gold,
    gameOver,
    prestige,
    click,
    unlock,
    bindAutoUnlock,
    setMuted,
    toggleMuted,
    isMuted,
    setVolume,
    getVolume
  };
})();

export { SFX };

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

const MUSIC = (() => {
  let muted = false;
  let volume = 0.20;
  let source = "";
  let audio = null;
  let ctx = null;
  let master = null;
  let scheduler = null;
  let nextChordTime = 0;
  let chordIndex = 0;
  const activeVoices = new Set();
  const CHORD_SEC = 7.2;
  const LOOKAHEAD_SEC = 0.8;
  const SCHEDULER_MS = 120;

  const clamp = (v, min, max) => Math.max(min, Math.min(max, v));
  const midiToHz = (midi) => 440 * Math.pow(2, (midi - 69) / 12);

  const CHORDS = [
    { name: "Cm", notes: [48, 51, 55, 60], pulse: 36 },
    { name: "EbMaj7", notes: [51, 55, 58, 62], pulse: 39 },
    { name: "AbMaj9", notes: [44, 48, 51, 58], pulse: 32 },
    { name: "Bb7sus4", notes: [46, 51, 53, 56], pulse: 34 }
  ];

  const ensureAudio = () => {
    if (audio) return audio;
    audio = new Audio();
    audio.loop = true;
    audio.preload = "auto";
    audio.playsInline = true;
    applyState();
    if (source) audio.src = source;
    return audio;
  };

  const ensureCtx = () => {
    if (!ctx) {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      if (!Ctx) return null;
      ctx = new Ctx();
      master = ctx.createGain();
      master.connect(ctx.destination);
    }
    return ctx;
  };

  const applyState = () => {
    if (!audio) return;
    audio.volume = muted ? 0 : volume;
    audio.muted = false;
  };

  const applySynthGain = () => {
    if (!master || !ctx) return;
    const t = ctx.currentTime;
    master.gain.setTargetAtTime(muted ? 0 : volume, t, 0.05);
  };

  const releaseVoice = (voice) => {
    if (!voice) return;
    activeVoices.delete(voice);
    try { voice.osc.onended = null; } catch (_) {}
    try { voice.osc.disconnect(); } catch (_) {}
    try { voice.filter?.disconnect(); } catch (_) {}
    try { voice.gain.disconnect(); } catch (_) {}
  };

  const trackVoice = (osc, filter, gain) => {
    const voice = { osc, filter, gain };
    activeVoices.add(voice);
    osc.onended = () => releaseVoice(voice);
    return voice;
  };

  const stopAllVoices = () => {
    for (const voice of Array.from(activeVoices)) {
      try { voice.osc.stop(); } catch (_) {}
      releaseVoice(voice);
    }
    activeVoices.clear();
  };

  const spawnPadVoice = (freq, startTime, chordDur, detune = 0, amp = 0.09) => {
    const c = ensureCtx();
    if (!c || !master) return;

    const osc = c.createOscillator();
    const filter = c.createBiquadFilter();
    const gain = c.createGain();
    const life = chordDur + 1.0;
    const endTime = startTime + life;

    osc.type = "sawtooth";
    osc.frequency.setValueAtTime(freq, startTime);
    if (detune) osc.detune.setValueAtTime(detune, startTime);

    filter.type = "lowpass";
    filter.Q.value = 0.75;
    filter.frequency.setValueAtTime(820, startTime);
    filter.frequency.linearRampToValueAtTime(1180, startTime + Math.min(2.6, chordDur * 0.45));

    gain.gain.setValueAtTime(0.0001, startTime);
    gain.gain.exponentialRampToValueAtTime(Math.max(0.001, amp), startTime + 1.8);
    gain.gain.linearRampToValueAtTime(Math.max(0.001, amp * 0.82), startTime + chordDur * 0.72);
    gain.gain.exponentialRampToValueAtTime(0.0001, endTime);

    osc.connect(filter);
    filter.connect(gain);
    gain.connect(master);

    trackVoice(osc, filter, gain);
    osc.start(startTime);
    osc.stop(endTime + 0.02);
  };

  const spawnPulse = (freq, startTime) => {
    const c = ensureCtx();
    if (!c || !master) return;
    const osc = c.createOscillator();
    const filter = c.createBiquadFilter();
    const gain = c.createGain();
    const dur = 0.32;
    const endTime = startTime + dur;

    osc.type = "triangle";
    osc.frequency.setValueAtTime(freq, startTime);
    osc.frequency.exponentialRampToValueAtTime(Math.max(24, freq * 0.93), endTime);

    filter.type = "lowpass";
    filter.Q.value = 0.4;
    filter.frequency.setValueAtTime(640, startTime);
    filter.frequency.linearRampToValueAtTime(420, endTime);

    gain.gain.setValueAtTime(0.0001, startTime);
    gain.gain.exponentialRampToValueAtTime(0.07, startTime + 0.08);
    gain.gain.exponentialRampToValueAtTime(0.0001, endTime);

    osc.connect(filter);
    filter.connect(gain);
    gain.connect(master);

    trackVoice(osc, filter, gain);
    osc.start(startTime);
    osc.stop(endTime + 0.02);
  };

  const scheduleChord = (when, chordDef) => {
    if (!chordDef) return;
    const notes = chordDef.notes || [];
    if (!notes.length) return;
    const pulseRoot = midiToHz(chordDef.pulse || notes[0]);
    for (let i = 0; i < notes.length; i += 1) {
      const hz = midiToHz(notes[i]);
      const detune = (i % 2 === 0 ? -3.5 : 2.7);
      spawnPadVoice(hz, when, CHORD_SEC * 0.92, detune, 0.085);
      if (i <= 1) {
        spawnPadVoice(hz * 2, when + 0.14, CHORD_SEC * 0.78, -detune * 0.5, 0.045);
      }
    }

    const pulseOffsets = [0.35, 2.05, 3.8, 5.55];
    for (const off of pulseOffsets) {
      spawnPulse(pulseRoot, when + off);
    }
  };

  const scheduleTick = () => {
    const c = ensureCtx();
    if (!c || muted || volume <= 0) return;
    if (c.state === "suspended") return;

    while (nextChordTime < c.currentTime + LOOKAHEAD_SEC) {
      const chord = CHORDS[chordIndex];
      scheduleChord(nextChordTime, chord);
      nextChordTime += CHORD_SEC;
      chordIndex = (chordIndex + 1) % CHORDS.length;
    }
  };

  const startSynthLoop = () => {
    const c = ensureCtx();
    if (!c) return false;
    applySynthGain();
    if (c.state === "suspended") c.resume().catch(() => {});
    if (!Number.isFinite(nextChordTime) || nextChordTime < c.currentTime - 0.5) {
      nextChordTime = c.currentTime + 0.12;
      chordIndex = 0;
    }
    if (!scheduler) {
      scheduleTick();
      scheduler = setInterval(scheduleTick, SCHEDULER_MS);
    }
    return true;
  };

  const stopSynthLoop = () => {
    if (scheduler) {
      clearInterval(scheduler);
      scheduler = null;
    }
    stopAllVoices();
    nextChordTime = 0;
    chordIndex = 0;
  };

  const setSource = (src) => {
    source = String(src || "").trim();
    if (!source) {
      if (audio) audio.removeAttribute("src");
      return source;
    }

    const a = ensureAudio();
    if (source) {
      try {
        const nextSrc = new URL(source, window.location.href).toString();
        if (a.src !== nextSrc) a.src = nextSrc;
      } catch (_) {
        if (a.src !== source) a.src = source;
      }
    }
    return source;
  };

  const play = () => {
    if (source) {
      const a = ensureAudio();
      if (!a.src && !source) return false;
      applyState();
      a.play().catch(() => {});
      return true;
    }
    return startSynthLoop();
  };

  const pause = () => {
    if (audio) audio.pause();
    stopSynthLoop();
  };

  const setMuted = (v) => {
    muted = !!v;
    applyState();
    applySynthGain();
    if (muted) stopAllVoices();
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
    applyState();
    applySynthGain();
    if (volume <= 0) stopAllVoices();
    return volume;
  };

  const getVolume = () => volume;

  return {
    setSource,
    play,
    pause,
    setMuted,
    toggleMuted,
    isMuted,
    setVolume,
    getVolume
  };
})();

export { SFX, MUSIC };

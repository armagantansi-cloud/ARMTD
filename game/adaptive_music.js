function createAdaptiveMusicEngine(){
  let ctx = null;
  let master = null;
  let muted = false;
  let volume = 0.20;
  let scene = "menu";
  let currentWave = 0;
  let bossWaveActive = false;
  let bossBassUntil = 0;
  let pendingBossBoostSec = 0;
  let scheduler = null;
  let nextSectionTime = 0;
  let chordCursor = 0;
  let phraseCursor = 0;
  const activeVoices = new Set();

  const SECTION_BASE_SEC = 7.6;
  const LOOKAHEAD_SEC = 0.9;
  const SCHEDULER_MS = 120;
  const NAT_MINOR_OFFSETS = [0, 2, 3, 5, 7, 8, 10];
  const CHORDS = [
    { name: "Cm", notes: [48, 51, 55, 60], root: 48 },
    { name: "EbMaj7", notes: [51, 55, 58, 62], root: 51 },
    { name: "AbMaj9", notes: [44, 48, 51, 58], root: 44 },
    { name: "Bb7sus4", notes: [46, 51, 53, 56], root: 46 }
  ];

  const clamp = (v, min, max) => Math.max(min, Math.min(max, v));
  const midiToHz = (midi) => 440 * Math.pow(2, (midi - 69) / 12);

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

  const applyMasterGain = () => {
    if (!master || !ctx) return;
    const target = muted ? 0 : clamp(volume, 0, 1);
    master.gain.setTargetAtTime(target, ctx.currentTime, 0.06);
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

  const spawnVoice = (opts) => {
    const c = ensureCtx();
    if (!c || !master) return;
    const start = Math.max(c.currentTime, opts.startTime);
    const end = Math.max(start + 0.08, opts.endTime);
    const osc = c.createOscillator();
    const filter = c.createBiquadFilter();
    const gain = c.createGain();

    osc.type = opts.type || "sawtooth";
    osc.frequency.setValueAtTime(Math.max(18, opts.freq), start);
    if (Number.isFinite(opts.detune)) {
      osc.detune.setValueAtTime(opts.detune, start);
    }
    if (Number.isFinite(opts.freqEnd) && opts.freqEnd > 0) {
      osc.frequency.exponentialRampToValueAtTime(Math.max(18, opts.freqEnd), end);
    }

    filter.type = opts.filterType || "lowpass";
    filter.Q.value = Number.isFinite(opts.filterQ) ? opts.filterQ : 0.72;
    const f0 = Math.max(40, Number(opts.filterStart) || 900);
    filter.frequency.setValueAtTime(f0, start);
    if (Number.isFinite(opts.filterEnd)) {
      filter.frequency.linearRampToValueAtTime(Math.max(40, opts.filterEnd), end);
    }

    const peak = Math.max(0.0008, Number(opts.peak) || 0.06);
    const attack = Math.max(0.01, Number(opts.attack) || 0.08);
    const hold = Math.max(0, Number(opts.hold) || 0);
    const release = Math.max(0.05, Number(opts.release) || 0.35);
    const attackEnd = Math.min(end, start + attack);
    const holdEnd = Math.min(end, attackEnd + hold);
    const releaseStart = Math.min(end, Math.max(holdEnd, end - release));

    gain.gain.setValueAtTime(0.0001, start);
    gain.gain.exponentialRampToValueAtTime(peak, attackEnd);
    gain.gain.setValueAtTime(peak, holdEnd);
    gain.gain.linearRampToValueAtTime(peak * 0.78, releaseStart);
    gain.gain.exponentialRampToValueAtTime(0.0001, end);

    osc.connect(filter);
    filter.connect(gain);
    gain.connect(master);

    trackVoice(osc, filter, gain);
    osc.start(start);
    osc.stop(end + 0.02);
  };

  const computeTempoMul = (timeSec) => {
    if (scene === "menu") return 0.72;
    const waveNorm = clamp((currentWave - 1) / 120, 0, 1);
    let mul = 0.86 + waveNorm * 0.82;
    if (bossWaveActive || timeSec < bossBassUntil) mul += 0.09;
    return clamp(mul, 0.68, 1.90);
  };

  const shouldUseArp = () => {
    if (scene === "menu") return (phraseCursor % 5) === 2;
    if (currentWave < 8) return (phraseCursor % 7) === 3;
    if (currentWave < 24) return (phraseCursor % 4) === 1;
    return (phraseCursor % 3) !== 0;
  };

  const schedulePad = (noteMidi, startTime, chordSec) => {
    const freq = midiToHz(noteMidi);
    spawnVoice({
      type: "sawtooth",
      freq,
      detune: -2.8,
      startTime,
      endTime: startTime + chordSec * 0.95,
      peak: 0.08,
      attack: 1.6,
      release: 1.2,
      filterStart: 780,
      filterEnd: 1120
    });
    spawnVoice({
      type: "triangle",
      freq: freq * 1.997,
      detune: 2.1,
      startTime: startTime + 0.06,
      endTime: startTime + chordSec * 0.78,
      peak: 0.034,
      attack: 0.92,
      release: 0.9,
      filterStart: 1040,
      filterEnd: 1560
    });
  };

  const scheduleBass = (noteMidi, startTime, chordSec, bossDrop) => {
    const drop = bossDrop ? 12 : 0;
    const root = noteMidi - drop;
    const rootFreq = midiToHz(root);
    const peak = bossDrop ? 0.14 : 0.095;
    spawnVoice({
      type: "sine",
      freq: rootFreq,
      freqEnd: rootFreq * 0.97,
      startTime,
      endTime: startTime + chordSec * 0.82,
      peak,
      attack: 0.14,
      release: 0.72,
      filterStart: 320,
      filterEnd: 210,
      filterQ: 0.45
    });
    spawnVoice({
      type: "triangle",
      freq: rootFreq * 0.998,
      startTime: startTime + chordSec * 0.48,
      endTime: startTime + chordSec * 0.92,
      peak: peak * 0.70,
      attack: 0.12,
      release: 0.44,
      filterStart: 280,
      filterEnd: 180,
      filterQ: 0.35
    });
  };

  const schedulePulse = (noteMidi, startTime, tempoMul) => {
    const freq = midiToHz(noteMidi);
    spawnVoice({
      type: "triangle",
      freq,
      freqEnd: Math.max(20, freq * 0.93),
      startTime,
      endTime: startTime + clamp(0.34 / Math.max(0.7, tempoMul), 0.15, 0.42),
      peak: 0.064,
      attack: 0.05,
      release: 0.20,
      filterStart: 620,
      filterEnd: 390,
      filterQ: 0.42
    });
  };

  const scheduleArp = (chord, startTime, chordSec, tempoMul) => {
    const pattern = [0, 1, 2, 3, 2, 1, 0, 2, 1, 3];
    const stepSec = clamp(0.36 / Math.max(0.7, tempoMul), 0.15, 0.40);
    const horizon = startTime + chordSec * 0.72;
    for (let i = 0; i < pattern.length; i += 1) {
      const t = startTime + i * stepSec;
      if (t >= horizon) break;
      const noteIdx = pattern[i] % chord.notes.length;
      const octave = (i % 4 === 3) ? 12 : ((i % 4 === 0) ? 0 : 24);
      const midi = chord.notes[noteIdx] + octave;
      const freq = midiToHz(midi);
      spawnVoice({
        type: "square",
        freq,
        startTime: t,
        endTime: t + stepSec * 0.86,
        peak: 0.034,
        attack: 0.01,
        release: stepSec * 0.66,
        filterStart: 2100,
        filterEnd: 1250,
        filterQ: 0.8
      });
    }
  };

  const scheduleLead = (chord, startTime, chordSec, tempoMul) => {
    const stepSec = clamp(0.62 / Math.max(0.75, tempoMul), 0.24, 0.72);
    const noteCount = clamp(Math.round(chordSec / stepSec), 2, 6);
    for (let i = 0; i < noteCount; i += 1) {
      const t = startTime + chordSec * 0.16 + i * stepSec;
      const scaleOff = NAT_MINOR_OFFSETS[(phraseCursor + i * 2) % NAT_MINOR_OFFSETS.length];
      const midi = 72 + scaleOff + ((i % 2) ? 12 : 0);
      const freq = midiToHz(midi);
      spawnVoice({
        type: "triangle",
        freq,
        startTime: t,
        endTime: t + stepSec * 0.82,
        peak: 0.025,
        attack: 0.03,
        release: stepSec * 0.56,
        filterStart: 1700,
        filterEnd: 1300,
        filterQ: 0.62
      });
    }
  };

  const scheduleSection = (startTime) => {
    const c = ensureCtx();
    if (!c) return;
    if (pendingBossBoostSec > 0) {
      bossBassUntil = Math.max(bossBassUntil, c.currentTime + pendingBossBoostSec);
      pendingBossBoostSec = 0;
    }

    const tempoMul = computeTempoMul(startTime);
    const chordSec = clamp(SECTION_BASE_SEC / tempoMul, 3.2, 10.5);
    const chord = CHORDS[chordCursor % CHORDS.length];
    const bossDrop = bossWaveActive || (startTime < bossBassUntil);

    for (const note of chord.notes) schedulePad(note, startTime, chordSec);
    scheduleBass(chord.root, startTime, chordSec, bossDrop);

    const pulseCount = clamp(Math.round(3 + tempoMul * 1.7), 2, 7);
    for (let i = 0; i < pulseCount; i += 1) {
      const off = (chordSec * 0.82) * (i / Math.max(1, pulseCount - 1));
      schedulePulse(chord.root + 12, startTime + off, tempoMul);
    }

    if (shouldUseArp()) {
      scheduleArp(chord, startTime + chordSec * 0.08, chordSec, tempoMul);
    } else {
      scheduleLead(chord, startTime, chordSec, tempoMul);
    }

    nextSectionTime = startTime + chordSec;
    chordCursor += 1;
    phraseCursor += 1;
  };

  const scheduleTick = () => {
    const c = ensureCtx();
    if (!c) return;
    if (c.state === "suspended") return;
    if (muted || volume <= 0) return;
    while (nextSectionTime < c.currentTime + LOOKAHEAD_SEC) {
      const start = Math.max(nextSectionTime, c.currentTime + 0.05);
      scheduleSection(start);
    }
  };

  const play = () => {
    const c = ensureCtx();
    if (!c) return false;
    if (c.state === "suspended") c.resume().catch(() => {});
    applyMasterGain();
    if (!Number.isFinite(nextSectionTime) || nextSectionTime <= 0) {
      nextSectionTime = c.currentTime + 0.09;
    }
    if (!scheduler) {
      scheduleTick();
      scheduler = setInterval(scheduleTick, SCHEDULER_MS);
    }
    return true;
  };

  const pause = () => {
    if (scheduler) {
      clearInterval(scheduler);
      scheduler = null;
    }
    stopAllVoices();
    nextSectionTime = 0;
  };

  const setMuted = (v) => {
    muted = !!v;
    applyMasterGain();
    if (muted) stopAllVoices();
  };

  const setVolume = (v) => {
    const n = Number(v);
    if (!Number.isFinite(n)) return volume;
    volume = clamp(n, 0, 1);
    applyMasterGain();
    if (volume <= 0) stopAllVoices();
    return volume;
  };

  const setScene = (nextScene) => {
    scene = (nextScene === "game") ? "game" : "menu";
    if (scene === "menu") {
      bossWaveActive = false;
    }
  };

  const onRunStarted = () => {
    setScene("game");
    currentWave = Math.max(1, currentWave || 1);
    bossWaveActive = false;
  };

  const onRunRestarted = () => {
    setScene("game");
    currentWave = 1;
    bossWaveActive = false;
    bossBassUntil = 0;
    pendingBossBoostSec = 0;
  };

  const onGameOver = () => {
    setScene("menu");
    bossWaveActive = false;
    bossBassUntil = 0;
    pendingBossBoostSec = 0;
  };

  const onWaveStart = ({ waveNum, isBossWave=false } = {}) => {
    const w = Math.max(1, Math.floor(Number(waveNum) || 1));
    currentWave = w;
    setScene("game");
    if (isBossWave) {
      bossWaveActive = true;
      if (ctx) {
        bossBassUntil = Math.max(bossBassUntil, ctx.currentTime + 5.0);
      } else {
        pendingBossBoostSec = Math.max(pendingBossBoostSec, 5.0);
      }
    }
  };

  const onWaveEnd = ({ isBossWave=false } = {}) => {
    if (!bossWaveActive && !isBossWave) return;
    bossWaveActive = false;
    if (ctx) {
      bossBassUntil = Math.max(bossBassUntil, ctx.currentTime + 5.0);
    } else {
      pendingBossBoostSec = Math.max(pendingBossBoostSec, 5.0);
    }
  };

  return {
    play,
    pause,
    setMuted,
    setVolume,
    setScene,
    onRunStarted,
    onRunRestarted,
    onGameOver,
    onWaveStart,
    onWaveEnd
  };
}

export { createAdaptiveMusicEngine };


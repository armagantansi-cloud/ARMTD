function createAdaptiveMusicEngine(){
  const TUNING = Object.freeze({
    tempo: Object.freeze({
      menuBaseMul: 0.62,
      gameBaseMul: 0.84,
      gameLinearMul: 0.66,
      gameCurveMul: 1.18,
      gameMaxMul: 2.45,
      waveNormDenom: 120,
      endgameStartWave: 80,
      endgameExtraMax: 0.26,
      bossTempoBonus: 0.12
    }),
    arrangement: Object.freeze({
      baseSectionSec: 9.6,
      minSectionSec: 2.8,
      maxSectionSec: 12.0,
      lookAheadSec: 1.25,
      schedulerMs: 100,
      chordSequence: Object.freeze([0, 1, 2, 3, 4, 2, 3, 1, 4, 0]),
      menuArpChance: 0.35,
      earlyArpChance: 0.30,
      midArpChance: 0.48,
      lateArpChance: 0.66,
      driveLayerStartWave: 70
    }),
    boss: Object.freeze({
      bassDropSemitones: 12,
      bassMinHoldSec: 5.0
    }),
    damageShift: Object.freeze({
      semitones: 2,
      holdSec: 6.0
    }),
    levels: Object.freeze({
      padPeak: 0.078,
      bassPeak: 0.104,
      pulsePeak: 0.066,
      arpPeak: 0.034,
      leadPeak: 0.030,
      drivePeak: 0.025
    })
  });

  const CHORDS = [
    { name: "Cm", root: 48, notes: [48, 51, 55, 60] },
    { name: "Bb", root: 46, notes: [46, 50, 53, 58] },
    { name: "Ab", root: 44, notes: [44, 48, 51, 56] },
    { name: "Eb", root: 51, notes: [51, 55, 58, 63] },
    { name: "Gm", root: 43, notes: [43, 46, 50, 55] }
  ];

  const NAT_MINOR_OFFSETS = [0, 2, 3, 5, 7, 8, 10];

  let ctx = null;
  let master = null;
  let muted = false;
  let volume = 0.20;
  let scene = "menu";
  let currentWave = 1;
  let bossWaveActive = false;
  let bossBassUntil = 0;
  let pendingBossBoostSec = 0;
  let keyShiftUntil = 0;
  let pendingKeyShiftSec = 0;
  let scheduler = null;
  let nextSectionTime = 0;
  let sectionCursor = 0;
  const activeVoices = new Set();

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
    const end = Math.max(start + 0.06, opts.endTime);

    const osc = c.createOscillator();
    const filter = c.createBiquadFilter();
    const gain = c.createGain();

    osc.type = opts.type || "sawtooth";
    osc.frequency.setValueAtTime(Math.max(18, opts.freq), start);
    if (Number.isFinite(opts.detune)) osc.detune.setValueAtTime(opts.detune, start);
    if (Number.isFinite(opts.freqEnd) && opts.freqEnd > 0) {
      osc.frequency.exponentialRampToValueAtTime(Math.max(18, opts.freqEnd), end);
    }

    filter.type = opts.filterType || "lowpass";
    filter.Q.value = Number.isFinite(opts.filterQ) ? opts.filterQ : 0.68;
    filter.frequency.setValueAtTime(Math.max(40, Number(opts.filterStart) || 900), start);
    if (Number.isFinite(opts.filterEnd)) {
      filter.frequency.linearRampToValueAtTime(Math.max(40, opts.filterEnd), end);
    }

    const peak = Math.max(0.0008, Number(opts.peak) || 0.04);
    const attack = Math.max(0.01, Number(opts.attack) || 0.08);
    const hold = Math.max(0, Number(opts.hold) || 0);
    const release = Math.max(0.05, Number(opts.release) || 0.25);
    const attackEnd = Math.min(end, start + attack);
    const holdEnd = Math.min(end, attackEnd + hold);
    const releaseStart = Math.min(end, Math.max(holdEnd, end - release));

    gain.gain.setValueAtTime(0.0001, start);
    gain.gain.exponentialRampToValueAtTime(peak, attackEnd);
    gain.gain.setValueAtTime(peak, holdEnd);
    gain.gain.linearRampToValueAtTime(peak * 0.82, releaseStart);
    gain.gain.exponentialRampToValueAtTime(0.0001, end);

    osc.connect(filter);
    filter.connect(gain);
    gain.connect(master);

    trackVoice(osc, filter, gain);
    osc.start(start);
    osc.stop(end + 0.02);
  };

  const computeTempoMul = (timeSec) => {
    if (scene !== "game") return TUNING.tempo.menuBaseMul;
    const wNorm = clamp((currentWave - 1) / TUNING.tempo.waveNormDenom, 0, 1);
    let mul = TUNING.tempo.gameBaseMul
      + (TUNING.tempo.gameLinearMul * wNorm)
      + (TUNING.tempo.gameCurveMul * wNorm * wNorm);
    if (currentWave >= TUNING.tempo.endgameStartWave) {
      const endNorm = clamp((currentWave - TUNING.tempo.endgameStartWave) / 50, 0, 1);
      mul += TUNING.tempo.endgameExtraMax * endNorm * endNorm;
    }
    if (bossWaveActive || timeSec < bossBassUntil) mul += TUNING.tempo.bossTempoBonus;
    return clamp(mul, TUNING.tempo.menuBaseMul, TUNING.tempo.gameMaxMul);
  };

  const shouldUseArp = () => {
    const wave = Math.max(1, currentWave);
    let chance = TUNING.arrangement.menuArpChance;
    if (scene === "game") {
      chance = wave < 12
        ? TUNING.arrangement.earlyArpChance
        : (wave < 45 ? TUNING.arrangement.midArpChance : TUNING.arrangement.lateArpChance);
    }
    const seeded = Math.abs(Math.sin((sectionCursor + 1) * 23.917));
    return seeded < chance;
  };

  const shouldUseDriveLayer = () => {
    if (scene !== "game") return false;
    if (currentWave >= TUNING.arrangement.driveLayerStartWave) return true;
    return bossWaveActive;
  };

  const getActiveShift = (timeSec) => {
    return (timeSec < keyShiftUntil) ? TUNING.damageShift.semitones : 0;
  };

  const shiftChord = (chord, semitones = 0) => {
    if (!semitones) return chord;
    return {
      ...chord,
      root: chord.root + semitones,
      notes: chord.notes.map(n => n + semitones)
    };
  };

  const schedulePad = (midi, start, lenSec) => {
    const f = midiToHz(midi);
    spawnVoice({
      type: "sawtooth",
      freq: f,
      detune: -2.7,
      startTime: start,
      endTime: start + lenSec * 0.92,
      peak: TUNING.levels.padPeak,
      attack: 1.4,
      release: 1.05,
      filterStart: 760,
      filterEnd: 1180,
      filterQ: 0.72
    });
    spawnVoice({
      type: "triangle",
      freq: f * 1.997,
      detune: 2.0,
      startTime: start + 0.08,
      endTime: start + lenSec * 0.76,
      peak: TUNING.levels.padPeak * 0.44,
      attack: 0.9,
      release: 0.8,
      filterStart: 1120,
      filterEnd: 1640,
      filterQ: 0.54
    });
  };

  const scheduleBass = (rootMidi, start, lenSec, bossDrop) => {
    const drop = bossDrop ? TUNING.boss.bassDropSemitones : 0;
    const midi = rootMidi - drop;
    const f = midiToHz(midi);
    const peak = bossDrop ? TUNING.levels.bassPeak * 1.34 : TUNING.levels.bassPeak;
    spawnVoice({
      type: "sine",
      freq: f,
      freqEnd: f * 0.97,
      startTime: start,
      endTime: start + lenSec * 0.84,
      peak,
      attack: 0.12,
      release: 0.62,
      filterStart: 320,
      filterEnd: 190,
      filterQ: 0.46
    });
    spawnVoice({
      type: "triangle",
      freq: f * 0.997,
      startTime: start + lenSec * 0.46,
      endTime: start + lenSec * 0.94,
      peak: peak * 0.64,
      attack: 0.10,
      release: 0.42,
      filterStart: 260,
      filterEnd: 170,
      filterQ: 0.34
    });
  };

  const schedulePulse = (rootMidi, start, tempoMul, count, lenSec) => {
    const f = midiToHz(rootMidi + 12);
    const hitDur = clamp(0.30 / Math.max(0.7, tempoMul), 0.11, 0.38);
    for (let i = 0; i < count; i += 1) {
      const t = start + (lenSec * 0.84) * (i / Math.max(1, count - 1));
      spawnVoice({
        type: "triangle",
        freq: f,
        freqEnd: f * 0.93,
        startTime: t,
        endTime: t + hitDur,
        peak: TUNING.levels.pulsePeak,
        attack: 0.04,
        release: hitDur * 0.64,
        filterStart: 640,
        filterEnd: 390,
        filterQ: 0.42
      });
    }
  };

  const scheduleArp = (chord, start, lenSec, tempoMul) => {
    const pattern = [0, 1, 2, 3, 2, 1, 0, 2, 1, 3, 2, 0];
    const step = clamp(0.34 / Math.max(0.75, tempoMul), 0.10, 0.36);
    const endAt = start + lenSec * 0.82;
    for (let i = 0; i < pattern.length; i += 1) {
      const t = start + i * step;
      if (t >= endAt) break;
      const noteIdx = pattern[i] % chord.notes.length;
      const oct = (i % 4 === 3) ? 12 : ((i % 4 === 1) ? 24 : 0);
      const midi = chord.notes[noteIdx] + oct;
      const f = midiToHz(midi);
      spawnVoice({
        type: "square",
        freq: f,
        startTime: t,
        endTime: t + step * 0.82,
        peak: TUNING.levels.arpPeak,
        attack: 0.01,
        release: step * 0.60,
        filterStart: 2200,
        filterEnd: 1320,
        filterQ: 0.84
      });
    }
  };

  const scheduleLead = (start, lenSec, tempoMul) => {
    const step = clamp(0.56 / Math.max(0.72, tempoMul), 0.17, 0.68);
    const count = clamp(Math.round((lenSec * 0.76) / step), 2, 8);
    for (let i = 0; i < count; i += 1) {
      const t = start + lenSec * 0.16 + i * step;
      const scaleOff = NAT_MINOR_OFFSETS[(sectionCursor + i * 2) % NAT_MINOR_OFFSETS.length];
      const midi = 72 + scaleOff + ((i % 3) === 1 ? 12 : 0);
      const f = midiToHz(midi);
      spawnVoice({
        type: "triangle",
        freq: f,
        startTime: t,
        endTime: t + step * 0.78,
        peak: TUNING.levels.leadPeak,
        attack: 0.03,
        release: step * 0.56,
        filterStart: 1760,
        filterEnd: 1340,
        filterQ: 0.64
      });
    }
  };

  const scheduleDrive = (rootMidi, start, lenSec, tempoMul) => {
    const f = midiToHz(rootMidi + 24);
    const step = clamp(0.23 / Math.max(0.82, tempoMul), 0.08, 0.24);
    const startAt = start + lenSec * 0.22;
    const endAt = start + lenSec * 0.90;
    for (let t = startAt; t < endAt; t += step) {
      spawnVoice({
        type: "sawtooth",
        freq: f,
        freqEnd: f * 1.01,
        startTime: t,
        endTime: t + step * 0.66,
        peak: TUNING.levels.drivePeak,
        attack: 0.006,
        release: step * 0.46,
        filterStart: 3200,
        filterEnd: 2100,
        filterQ: 0.92
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
    if (pendingKeyShiftSec > 0) {
      keyShiftUntil = Math.max(keyShiftUntil, c.currentTime + pendingKeyShiftSec);
      pendingKeyShiftSec = 0;
    }

    const tempoMul = computeTempoMul(startTime);
    const lenSec = clamp(
      TUNING.arrangement.baseSectionSec / tempoMul,
      TUNING.arrangement.minSectionSec,
      TUNING.arrangement.maxSectionSec
    );
    const seq = TUNING.arrangement.chordSequence;
    const chordBase = CHORDS[seq[sectionCursor % seq.length] % CHORDS.length];
    const shift = getActiveShift(startTime);
    const chord = shiftChord(chordBase, shift);
    const bossDrop = bossWaveActive || (startTime < bossBassUntil);

    for (const note of chord.notes) schedulePad(note, startTime, lenSec);
    scheduleBass(chord.root, startTime, lenSec, bossDrop);

    const pulseCount = clamp(Math.round(3 + tempoMul * 1.95), 2, 9);
    schedulePulse(chord.root, startTime, tempoMul, pulseCount, lenSec);

    if (shouldUseArp()) scheduleArp(chord, startTime + lenSec * 0.04, lenSec, tempoMul);
    else scheduleLead(startTime, lenSec, tempoMul);

    if (shouldUseDriveLayer()) scheduleDrive(chord.root, startTime, lenSec, tempoMul);

    nextSectionTime = startTime + lenSec;
    sectionCursor += 1;
  };

  const scheduleTick = () => {
    const c = ensureCtx();
    if (!c) return;
    if (c.state === "suspended") return;
    if (muted || volume <= 0) return;
    while (nextSectionTime < c.currentTime + TUNING.arrangement.lookAheadSec) {
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
      nextSectionTime = c.currentTime + 0.10;
    }
    if (!scheduler) {
      scheduleTick();
      scheduler = setInterval(scheduleTick, TUNING.arrangement.schedulerMs);
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
      currentWave = 1;
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
    keyShiftUntil = 0;
    pendingKeyShiftSec = 0;
    sectionCursor = 0;
  };

  const onGameOver = () => {
    setScene("menu");
    bossWaveActive = false;
    bossBassUntil = 0;
    pendingBossBoostSec = 0;
    keyShiftUntil = 0;
    pendingKeyShiftSec = 0;
  };

  const onWaveStart = ({ waveNum, isBossWave=false } = {}) => {
    currentWave = Math.max(1, Math.floor(Number(waveNum) || 1));
    setScene("game");
    if (isBossWave) {
      bossWaveActive = true;
      if (ctx) bossBassUntil = Math.max(bossBassUntil, ctx.currentTime + TUNING.boss.bassMinHoldSec);
      else pendingBossBoostSec = Math.max(pendingBossBoostSec, TUNING.boss.bassMinHoldSec);
    }
  };

  const onWaveEnd = ({ isBossWave=false } = {}) => {
    if (!bossWaveActive && !isBossWave) return;
    bossWaveActive = false;
    if (ctx) bossBassUntil = Math.max(bossBassUntil, ctx.currentTime + TUNING.boss.bassMinHoldSec);
    else pendingBossBoostSec = Math.max(pendingBossBoostSec, TUNING.boss.bassMinHoldSec);
  };

  const onCoreDamaged = () => {
    if (ctx) keyShiftUntil = Math.max(keyShiftUntil, ctx.currentTime + TUNING.damageShift.holdSec);
    else pendingKeyShiftSec = Math.max(pendingKeyShiftSec, TUNING.damageShift.holdSec);
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
    onWaveEnd,
    onCoreDamaged
  };
}

export { createAdaptiveMusicEngine };


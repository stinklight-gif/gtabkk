// =============================================================================
// AUDIO — procedural Web Audio (engine loopers, SFX, car radio). Standalone.
// =============================================================================

export function makeAudio() {
  const ctx = new (window.AudioContext || window.webkitAudioContext)();
  const master = ctx.createGain(); master.gain.value = 0.55; master.connect(ctx.destination);
  // Engine bus: all vehicle engine loops route here so the radio can duck them
  // as a group when music is playing in-car.
  const engineBus = ctx.createGain(); engineBus.gain.value = 1.0; engineBus.connect(master);

  // simple beep helper
  function blip({freq=440, dur=0.15, type='sine', gain=0.2, attack=0.005, release=0.05, freqEnd=null}) {
    const t = ctx.currentTime;
    const o = ctx.createOscillator(); o.type = type; o.frequency.setValueAtTime(freq, t);
    if (freqEnd != null) o.frequency.exponentialRampToValueAtTime(Math.max(20, freqEnd), t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(gain, t + attack);
    g.gain.linearRampToValueAtTime(0.0001, t + dur + release);
    o.connect(g).connect(master);
    o.start(t); o.stop(t + dur + release + 0.02);
  }

  function noise(dur=0.2, gain=0.15, lp=2000) {
    const t = ctx.currentTime;
    const buf = ctx.createBuffer(1, Math.floor(ctx.sampleRate * dur), ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    const src = ctx.createBufferSource(); src.buffer = buf;
    const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = lp;
    const g = ctx.createGain();
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    src.connect(f).connect(g).connect(master);
    src.start(t);
  }

  // 7-Eleven door chime — iconic ding-dong (Bb5 then F5)
  function chime() {
    blip({freq: 932, dur: 0.18, type: 'sine', gain: 0.25, attack: 0.01, release: 0.25});
    setTimeout(() => blip({freq: 698, dur: 0.28, type: 'sine', gain: 0.25, attack: 0.01, release: 0.4}), 220);
  }

  // Temple bell — low partial + harmonic
  function bell() {
    blip({freq: 196, dur: 1.6, type: 'sine', gain: 0.35, attack: 0.01, release: 0.8});
    blip({freq: 392, dur: 1.4, type: 'sine', gain: 0.18, attack: 0.01, release: 0.7});
    blip({freq: 588, dur: 1.0, type: 'sine', gain: 0.08, attack: 0.01, release: 0.5});
  }

  // Engine looper — looped buffer per vehicle, pitch-shifted by speed
  function engineLoop({rpmBase=80, harsh=false, dest=null} = {}) {
    const o1 = ctx.createOscillator(); o1.type = 'sawtooth'; o1.frequency.value = rpmBase;
    const o2 = ctx.createOscillator(); o2.type = 'square';   o2.frequency.value = rpmBase * 0.5;
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = harsh ? 1800 : 900;
    const g  = ctx.createGain(); g.gain.value = 0;
    o1.connect(lp); o2.connect(lp); lp.connect(g).connect(dest || engineBus);
    o1.start(); o2.start();
    return {
      set(speed01, on, throttle = 0) {
        const gp = window.GAME && window.GAME.gameplay;
        let rpm01 = Math.max(0, Math.min(1, speed01 * 0.65 + (on ? 0.12 : 0) + throttle * 0.28));
        if (gp && gp.fakeRpm) {
          const gears = 5, gIdx = Math.min(gears - 1, Math.floor(speed01 * gears));
          const inGear = speed01 * gears - gIdx;
          rpm01 = Math.max(0, Math.min(1, 0.18 + gIdx * 0.08 + inGear * 0.55 + throttle * 0.2));
        }
        const target = on ? 0.08 + rpm01 * 0.20 : 0;
        g.gain.setTargetAtTime(target, ctx.currentTime, 0.1);
        const f = rpmBase + rpm01 * (harsh ? 420 : 220);
        o1.frequency.setTargetAtTime(f, ctx.currentTime, 0.08);
        o2.frequency.setTargetAtTime(f * 0.5, ctx.currentTime, 0.08);
      },
      kill() { try { o1.stop(); o2.stop(); g.disconnect(); } catch {} }
    };
  }

  // Tuk-tuk two-stroke — needs the buzz
  function tukTukLoop() {
    const o = ctx.createOscillator(); o.type = 'sawtooth'; o.frequency.value = 50;
    const lfo = ctx.createOscillator(); lfo.type = 'square'; lfo.frequency.value = 18;
    const lfog = ctx.createGain(); lfog.gain.value = 28;
    lfo.connect(lfog).connect(o.frequency);
    const lp = ctx.createBiquadFilter(); lp.type = 'bandpass'; lp.frequency.value = 600; lp.Q.value = 1.2;
    const g  = ctx.createGain(); g.gain.value = 0;
    o.connect(lp).connect(g).connect(engineBus);
    o.start(); lfo.start();
    return {
      set(speed01, on, throttle = 0) {
        const rpm01 = Math.max(0, Math.min(1, speed01 * 0.7 + throttle * 0.3));
        const target = on ? 0.10 + rpm01 * 0.18 : 0;
        g.gain.setTargetAtTime(target, ctx.currentTime, 0.1);
        const f = 50 + rpm01 * 90;
        o.frequency.setTargetAtTime(f, ctx.currentTime, 0.08);
        lfo.frequency.setTargetAtTime(15 + rpm01 * 22, ctx.currentTime, 0.1);
      },
      kill() { try { o.stop(); lfo.stop(); g.disconnect(); } catch {} }
    };
  }

  // Footstep, punch, pistol shot, hit, ricochet, siren
  function step(wet=false, hard=false)  { noise(0.05, wet ? 0.18 : hard ? 0.14 : 0.10, hard ? 5200 : wet ? 4000 : 1200); }
  function scrape() { noise(0.10, 0.10, 900); }
  function btsChime() {
    blip({freq: 784, dur: 0.12, type: 'sine', gain: 0.14, release: 0.18});
    setTimeout(() => blip({freq: 988, dur: 0.16, type: 'sine', gain: 0.12, release: 0.22}), 140);
    setTimeout(() => noise(0.18, 0.08, 900), 280);
  }
  function punch()           { noise(0.06, 0.25, 800); blip({freq:120, dur:0.06, type:'sine', gain:0.18, freqEnd:60}); }
  function kick()            { noise(0.10, 0.30, 600); blip({freq:90, dur:0.10, type:'sine', gain:0.22, freqEnd:40}); }
  function hit()             { noise(0.08, 0.30, 1500); blip({freq:200, dur:0.05, type:'triangle', gain:0.15, freqEnd:80}); }
  function shot()            { noise(0.12, 0.45, 3000); blip({freq:1800, dur:0.04, type:'square', gain:0.2, freqEnd:200}); }
  function ricochet()        { blip({freq:2400, dur:0.18, type:'sawtooth', gain:0.08, freqEnd:1200}); }
  function reload()          { blip({freq:300, dur:0.05, type:'square', gain:0.12}); setTimeout(()=>blip({freq:200, dur:0.07, type:'square', gain:0.12}), 220); }
  function whistle()         { blip({freq:1800, dur:0.4, type:'sine', gain:0.18}); }
  function siren()           {
    const t = ctx.currentTime;
    const o = ctx.createOscillator(); o.type = 'sine';
    const g = ctx.createGain(); g.gain.value = 0.0;
    g.gain.setValueAtTime(0.0, t);
    g.gain.linearRampToValueAtTime(0.16, t + 0.05);
    g.gain.linearRampToValueAtTime(0.0001, t + 0.95);
    o.frequency.setValueAtTime(700, t);
    o.frequency.linearRampToValueAtTime(1200, t + 0.45);
    o.frequency.linearRampToValueAtTime(700, t + 0.9);
    o.connect(g).connect(copPanner);
    o.start(t); o.stop(t + 1.0);
  }
  function thunder() { noise(1.5, 0.45, 400); }
  function rumble() { noise(1.2, 0.06, 110); }   // low BTS pass-by rumble
  function rainBed() {
    // continuous filtered noise loop for rain
    const buf = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = (Math.random()*2-1) * 0.6;
    const src = ctx.createBufferSource(); src.buffer = buf; src.loop = true;
    const f = ctx.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = 2200; f.Q.value = 0.6;
    const g = ctx.createGain(); g.gain.value = 0;
    src.connect(f).connect(g).connect(master);
    src.start();
    return { setLevel: v => g.gain.setTargetAtTime(v, ctx.currentTime, 0.5) };
  }
  function ambienceBed() {
    // distant city — low-frequency hum + occasional honks
    const o = ctx.createOscillator(); o.type='sine'; o.frequency.value=58;
    const g = ctx.createGain(); g.gain.value=0.045;
    o.connect(g).connect(master); o.start();
    return {};
  }

  // ---- Car radio: procedural stations scheduled ahead of ctx time ----
  // A lookahead step-sequencer. Each station has a tempo + a pattern(step,time)
  // that schedules notes onto the shared radio bus. tick() runs it while active.
  function makeRadio() {
    const bus = ctx.createGain(); bus.gain.value = 0; bus.connect(master);
    const N = 261.63; // C4
    const nt = s => N * Math.pow(2, s / 12);
    function tone(time, freq, dur, type, gain, freqEnd) {
      const o = ctx.createOscillator(); o.type = type; o.frequency.setValueAtTime(freq, time);
      if (freqEnd) o.frequency.exponentialRampToValueAtTime(Math.max(20, freqEnd), time + dur);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, time);
      g.gain.linearRampToValueAtTime(gain, time + 0.01);
      g.gain.exponentialRampToValueAtTime(0.0006, time + dur);
      o.connect(g).connect(bus); o.start(time); o.stop(time + dur + 0.03);
    }
    function nz(time, dur, gain, lp, bp) {
      const len = Math.max(1, Math.floor(ctx.sampleRate * dur));
      const buf = ctx.createBuffer(1, len, ctx.sampleRate);
      const d = buf.getChannelData(0); for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
      const src = ctx.createBufferSource(); src.buffer = buf;
      const f = ctx.createBiquadFilter();
      if (bp) { f.type = 'bandpass'; f.frequency.value = bp; f.Q.value = 1.0; }
      else { f.type = 'lowpass'; f.frequency.value = lp || 5000; }
      const g = ctx.createGain(); g.gain.setValueAtTime(gain, time); g.gain.exponentialRampToValueAtTime(0.0006, time + dur);
      src.connect(f).connect(g).connect(bus); src.start(time); src.stop(time + dur + 0.02);
    }
    const kick = (t, g = 0.55) => tone(t, 132, 0.18, 'sine', g, 46);
    const snare = (t, g = 0.32) => { nz(t, 0.16, g, 3200); tone(t, 190, 0.07, 'triangle', g * 0.4, 90); };
    const hat = (t, g = 0.10) => nz(t, 0.028, g, 9000);

    // Station patterns. Pentatonic-ish so random steps stay consonant.
    const lukLead = [0, 4, 7, 9, 12, 9, 7, 4];          // C major pentatonic run
    const lukBass = [0, 0, 7, 7, 9, 9, 5, 5];           // C G Am F roots (per 4 steps)
    function lukThung(step, t) {                          // bright synth-pop
      const b = step % 16, bar = Math.floor(step / 16) % 2;
      if (b % 8 === 0) kick(t, 0.5);
      if (b === 4 || b === 12) snare(t, 0.28);
      if (b % 2 === 0) hat(t, 0.08);
      if (b % 4 === 0) tone(t, nt(lukBass[(bar * 4 + b / 4) % lukBass.length] - 12), 0.22, 'triangle', 0.34);
      if (b % 2 === 1) tone(t, nt(lukLead[(step) % lukLead.length] + 12), 0.16, 'square', 0.12);
    }
    const hipBass = [-3, -3, -3, 0, 2, 2, -5, -5];       // A minor-ish roots
    function bangkokBars(step, t) {                       // boom-bap hip-hop
      const b = step % 16;
      if (b === 0 || b === 7 || b === 10) kick(t, 0.6);
      if (b === 4 || b === 12) snare(t, 0.34);
      if (b % 2 === 0) hat(t, b % 4 === 2 ? 0.09 : 0.05); // light swing
      if (b % 4 === 0) tone(t, nt(hipBass[(step / 4) % hipBass.length] - 12), 0.4, 'sawtooth', 0.3, null);
      if (b === 6) tone(t, nt(7), 0.5, 'triangle', 0.07);  // sparse stab
    }
    const jingle = [12, 16, 19, 24];
    function talkRadio(step, t) {                          // AM talk + bumpers/ads
      const b = step % 32;
      const chase = !!(window.GAME && window.GAME.gameplay && window.GAME.gameplay.talkChase && window.GAME.wanted && window.GAME.wanted.stars >= 3);
      const gab = chase ? 0.92 : 0.7;
      if (b % 2 === 0 && Math.random() < gab) nz(t, 0.07 + Math.random() * 0.06, chase ? 0.22 : 0.16, 0, 700 + Math.random() * 900);
      if (chase && b % 4 === 1) nz(t, 0.05, 0.12, 0, 1400);
      if (b === 0) jingle.forEach((s, i) => tone(t + i * 0.12, nt(s), 0.18, 'square', chase ? 0.2 : 0.16));
      if (b === 20) { tone(t, nt(19), 0.2, 'sine', 0.18); tone(t + 0.18, nt(14), 0.28, 'sine', 0.16); }
    }
    function watRadio(step, t) {
      const b = step % 16;
      if (b === 0) tone(t, nt(-12), 1.1, 'sine', 0.07);
      if (b === 8) tone(t, nt(-5), 0.9, 'sine', 0.05);
      if (b === 0) tone(t, nt(19), 0.7, 'sine', 0.05);
    }
    function morLam(step, t) {
      const b = step % 16;
      if (b === 0 || b === 6) kick(t, 0.55);
      if (b === 4 || b === 12) snare(t, 0.3);
      if (b % 2 === 0) hat(t, 0.07);
      if (b % 4 === 0) tone(t, nt([-5, -5, 0, 2][(step / 4) % 4] - 12), 0.22, 'sawtooth', 0.28);
      if (b % 2 === 1) tone(t, nt([0, 3, 7, 10][b % 4] + 12), 0.12, 'square', 0.1);
    }
    function soiCowboy(step, t) {
      const b = step % 16;
      if (b === 0 || b === 8) kick(t, 0.45);
      if (b === 4 || b === 12) snare(t, 0.26);
      if (b % 4 === 2) hat(t, 0.08);
      if (b === 0) tone(t, nt(0), 0.5, 'triangle', 0.16);
      if (b === 8) tone(t, nt(7), 0.4, 'triangle', 0.12);
      if (b === 4) tone(t, nt(12), 0.18, 'square', 0.08);
    }
    const STATIONS = [
      { name: 'RADIO OFF', bpm: 0, pattern: null },
      { name: 'LUK THUNG FM', bpm: 104, pattern: lukThung },
      { name: 'BANGKOK BARS 97.5', bpm: 88, pattern: bangkokBars },
      { name: 'TALK RADIO AM', bpm: 100, pattern: talkRadio },
      { name: 'WAT RADIO', bpm: 52, pattern: watRadio },
      { name: 'MOR LAM EXPRESS', bpm: 118, pattern: morLam },
      { name: 'SOI COWBOY CLASSICS', bpm: 96, pattern: soiCowboy },
    ];
    let station = 1, step = 0, nextTime = 0;
    function reset() { step = 0; nextTime = 0; }
    return {
      names: STATIONS.map(s => s.name),
      get station() { return station; },
      next() { station = (station + 1) % STATIONS.length; reset(); return STATIONS[station].name; },
      // active = in a vehicle; schedules + fades the bus, returns nothing
      tick(active) {
        const s = STATIONS[station];
        const playing = active && !!s.pattern;
        bus.gain.setTargetAtTime(playing ? 0.5 : 0.0, ctx.currentTime, 0.18);
        if (!playing) { reset(); return; }
        const now = ctx.currentTime;
        if (nextTime === 0) nextTime = now + 0.06;
        const stepDur = (60 / s.bpm) / 4;                 // 16th notes
        let guard = 0;
        while (nextTime < now + 0.18 && guard++ < 64) {
          try { s.pattern(step, nextTime); } catch (e) { /* keep the loop alive */ }
          step = (step + 1) % 64;
          nextTime += stepDur;
        }
      },
    };
  }

  function honk() {
    blip({freq:380, dur:0.25, type:'square', gain:0.12, freqEnd:340});
  }
  function bark() {
    blip({freq:380, dur:0.07, type:'sawtooth', gain:0.18, freqEnd:220});
    setTimeout(()=>blip({freq:340, dur:0.08, type:'sawtooth', gain:0.16, freqEnd:200}),90);
  }

  // ---- New SFX (procedural, same style) -------------------------------------
  // Bank-vault drill spin-up + alarm wail — fired when the heist alarm trips.
  function vaultAlarm() {
    noise(0.5, 0.10, 1400);                                            // drill bite
    blip({freq:90, dur:0.5, type:'sawtooth', gain:0.10, freqEnd:160}); // motor spin-up
    // two-tone alarm wail, a few descending sweeps
    for (let i = 0; i < 4; i++) setTimeout(() =>
      blip({freq:760, dur:0.22, type:'square', gain:0.12, freqEnd:520}), 350 + i * 260);
  }
  // Outboard motor — continuous burble that tracks boat speed (set/kill like engineLoop).
  function boatMotor() {
    const o = ctx.createOscillator(); o.type = 'sawtooth'; o.frequency.value = 60;
    const lfo = ctx.createOscillator(); lfo.type = 'sine'; lfo.frequency.value = 7;   // putt-putt chug
    const lfog = ctx.createGain(); lfog.gain.value = 16;
    lfo.connect(lfog).connect(o.frequency);
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 520;
    const g = ctx.createGain(); g.gain.value = 0;
    o.connect(lp).connect(g).connect(engineBus);
    o.start(); lfo.start();
    return {
      set(speed01, on) {
        const target = on ? 0.09 + speed01 * 0.14 : 0;
        g.gain.setTargetAtTime(target, ctx.currentTime, 0.12);
        o.frequency.setTargetAtTime(48 + speed01 * 70, ctx.currentTime, 0.1);
        lfo.frequency.setTargetAtTime(6 + speed01 * 12, ctx.currentTime, 0.1); // chug faster under throttle
      },
      kill() { try { o.stop(); lfo.stop(); g.disconnect(); } catch {} }
    };
  }
  // Gang-fight whack — meatier than punch(): a thud + crack for melee brawls.
  function whack() {
    noise(0.09, 0.30, 700);
    blip({freq:160, dur:0.09, type:'triangle', gain:0.22, freqEnd:70});
    blip({freq:520, dur:0.04, type:'square', gain:0.10, freqEnd:240});
  }
  // Property "boom" + cash jingle — big low hit, then a bright up-arpeggio (claim/cash).
  function cashBoom() {
    noise(0.3, 0.22, 300);
    blip({freq:70, dur:0.35, type:'sine', gain:0.26, freqEnd:40});
    [0, 4, 7, 12].forEach((s, i) => setTimeout(() =>
      blip({freq:523.25 * Math.pow(2, s / 12), dur:0.16, type:'triangle', gain:0.16, release:0.18}),
      120 + i * 90));
  }

  // ---- Dynamic music bed ----------------------------------------------------
  // A procedural, looping musical layer (bassline + arp + light beat) on its own
  // bus under the SFX. updateMusic(dt) is called every frame from the game loop;
  // it WATCHES G state to (a) ramp intensity from G.wanted.stars and (b) fire a
  // few one-shots/loops on transitions (heist alarm, boat motor) so all the
  // event wiring stays inside audio.js. Lookahead step-sequencer like the radio.
  // Reads the global game state (window.GAME) lazily so audio.js stays standalone.
  function makeMusic() {
    const bus = ctx.createGain(); bus.gain.value = 0; bus.connect(master);
    const A = 220;                                  // A3 root
    const nt = s => A * Math.pow(2, s / 12);
    function tone(time, freq, dur, type, gain) {
      const o = ctx.createOscillator(); o.type = type; o.frequency.setValueAtTime(freq, time);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, time);
      g.gain.linearRampToValueAtTime(gain, time + 0.012);
      g.gain.exponentialRampToValueAtTime(0.0006, time + dur);
      o.connect(g).connect(bus); o.start(time); o.stop(time + dur + 0.03);
    }
    function nz(time, dur, gain, lp) {
      const len = Math.max(1, Math.floor(ctx.sampleRate * dur));
      const buf = ctx.createBuffer(1, len, ctx.sampleRate);
      const d = buf.getChannelData(0); for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
      const src = ctx.createBufferSource(); src.buffer = buf;
      const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = lp;
      const g = ctx.createGain(); g.gain.setValueAtTime(gain, time); g.gain.exponentialRampToValueAtTime(0.0006, time + dur);
      src.connect(f).connect(g).connect(bus); src.start(time); src.stop(time + dur + 0.02);
    }
    // A minor pentatonic — roots cycle Am F C G; arp picks notes from the scale.
    const roots = [0, -4, 3, -2];                   // bar roots vs A (A F C G)
    const arp   = [12, 15, 19, 24, 19, 15];         // pentatonic-ish arp degrees
    let step = 0, nextTime = 0, intensity = 0;      // intensity 0..1, eased toward target

    // one-shot / loop transition trackers (closure state — no edits elsewhere)
    let prevStage = 0, boat = null;

    function watch() {
      const G = window.GAME; if (!G) return;
      const stars = (G.wanted && G.wanted.stars) | 0;
      // target intensity: calm at 0★, builds with heat; cap at 1.
      const tgt = Math.min(1, stars / 4);
      intensity += (tgt - intensity) * 0.05;        // ease ~1s

      // heist alarm: fire once when the vault stage trips to 2.
      const stage = (G.heist && G.heist.stage) | 0;
      if (stage === 2 && prevStage !== 2) vaultAlarm();
      prevStage = stage;

      // boat outboard motor: run while in a boat, track speed, stop on exit.
      const v = G.player && G.player.inVehicle;
      const inBoat = !!(v && v.spec && v.spec.kind === 'boat');
      if (inBoat) {
        if (!boat) boat = boatMotor();
        const top = (v.spec && v.spec.topSpeed) || 18;
        boat.set(Math.min(1, Math.abs(v.vel || 0) / top), true);
      } else if (boat) { boat.kill(); boat = null; }
    }

    function reset() { step = 0; nextTime = 0; }
    return {
      // active = G.state === 'playing'. Schedules the bed + does event watching.
      update(active) {
        if (active) watch();                        // watch G even at low intensity
        // bus level: silent when not playing; modest, rising a touch with heat.
        bus.gain.setTargetAtTime(active ? 0.16 + intensity * 0.10 : 0.0, ctx.currentTime, 0.4);
        if (!active) { reset(); if (boat) { boat.kill(); boat = null; } return; }
        // tempo: 84 bpm calm → ~128 bpm chase.
        const bpm = 84 + intensity * 44;
        const now = ctx.currentTime;
        if (nextTime === 0) nextTime = now + 0.06;
        const stepDur = (60 / bpm) / 4;             // 16th notes
        let guard = 0;
        while (nextTime < now + 0.2 && guard++ < 64) {
          try { pattern(step, nextTime); } catch (e) { /* keep the loop alive */ }
          step = (step + 1) % 64;                   // 4 bars (one per root: A F C G)
          nextTime += stepDur;
        }
      },
    };
    // 64-step (4-bar) pattern; density/voices scale with `intensity`.
    function pattern(s, t) {
      const b = s % 16, bar = Math.floor(s / 16) % roots.length, root = roots[bar];
      // bassline — root on the downbeats, an extra off-beat note when tense.
      if (b === 0 || b === 8) tone(t, nt(root - 12), 0.26, 'triangle', 0.22);
      if (intensity > 0.4 && (b === 4 || b === 12)) tone(t, nt(root - 12), 0.16, 'triangle', 0.14);
      // pad — soft sustained fifth at the top of each bar (calm texture).
      if (b === 0) tone(t, nt(root + 7), 0.9, 'sine', 0.05 + intensity * 0.03);
      // light beat — kick on 1 & 3, hat eighths; snare backbeat only when tense.
      if (b === 0 || b === 8) nz(t, 0.12, 0.16 + intensity * 0.10, 220);          // kick-ish
      if (b % 2 === 0) nz(t, 0.02, 0.04 + intensity * 0.04, 8000);                // hats
      if (intensity > 0.5 && (b === 4 || b === 12)) nz(t, 0.10, 0.12, 3000);      // snare
      // arp — sparse when calm, busier (every 8th, octave up) under chase heat.
      const every = intensity > 0.55 ? 2 : 4;
      if (b % every === 1) tone(t, nt(root + arp[s % arp.length] + (intensity > 0.7 ? 12 : 0)),
        0.12, 'square', 0.06 + intensity * 0.05);
    }
  }

  const districtGain = ctx.createGain(); districtGain.gain.value = 0; districtGain.connect(master);
  const distOsc = ctx.createOscillator(); distOsc.type = 'sine'; distOsc.frequency.value = 68;
  distOsc.connect(districtGain); distOsc.start();
  const rumbleGain = ctx.createGain(); rumbleGain.gain.value = 0; rumbleGain.connect(master);
  const rumbleOsc = ctx.createOscillator(); rumbleOsc.type = 'sawtooth'; rumbleOsc.frequency.value = 42;
  const rumbleLp = ctx.createBiquadFilter(); rumbleLp.type = 'lowpass'; rumbleLp.frequency.value = 90;
  rumbleOsc.connect(rumbleLp).connect(rumbleGain); rumbleOsc.start();
  const copPanner = ctx.createStereoPanner(); copPanner.pan.value = 0; copPanner.connect(master);
  const npcPans = [0, 1].map(() => {
    const pan = ctx.createStereoPanner(); pan.connect(master);
    const loop = engineLoop({ rpmBase: 64, dest: pan });
    return { pan, loop };
  });
  let lastWhoop = 0, lastKind = '';
  function updateWorld() {
    const G = window.GAME; if (!G || G.state !== 'playing') {
      districtGain.gain.setTargetAtTime(0, ctx.currentTime, 0.4);
      rumbleGain.gain.setTargetAtTime(0, ctx.currentTime, 0.4);
      return;
    }
    const gp = G.gameplay || {};
    const p = G.player && (G.player.inVehicle ? G.player.inVehicle.pos : G.player.group.position);
    if (gp.districtBeds) {
      const kind = G._districtName || 'Sukhumvit';
      if (kind !== lastKind) {
        lastKind = kind;
        const freq = kind === 'Yaowarat' ? 92 : kind === 'The Wat' ? 54 : kind === 'Riverside' ? 48 : kind === 'Asok' ? 62 : kind === 'Suvarnabhumi' ? 42 : kind === 'Klong Toey' ? 58 : 68;
        distOsc.frequency.setTargetAtTime(freq, ctx.currentTime, 0.5);
      }
      const night = G.nightK || 0;
      const lvl = kind === 'The Wat' ? 0.018 : kind === 'Riverside' ? 0.022 + night * 0.01 : kind === 'Yaowarat' ? 0.032 : 0.026;
      districtGain.gain.setTargetAtTime(lvl, ctx.currentTime, 0.6);
    }
    if (p) {
      let near = 0;
      for (const v of G.vehicles) {
        if (!v || v.dead || v.driver === 'player') continue;
        const dx = v.pos.x - p.x, dz = v.pos.z - p.z;
        if (dx * dx + dz * dz < 28 * 28) near++;
      }
      rumbleGain.gain.setTargetAtTime(Math.min(0.07, near * 0.01), ctx.currentTime, 0.3);
    }
    if (gp.spatialSiren && G.wanted && G.wanted.stars > 0 && p) {
      let nd = 999, nearest = null;
      for (const v of G.vehicles) {
        if (!v.isCop || v.dead || !v.driver) continue;
        const d = Math.hypot(v.pos.x - p.x, v.pos.z - p.z);
        if (d < nd) { nd = d; nearest = v; }
      }
      if (G.heli) { const d = Math.hypot(G.heli.mesh.position.x - p.x, G.heli.mesh.position.z - p.z); if (d < nd) nd = d; }
      const now = ctx.currentTime;
      if (nearest && nd < 50) {
        const yaw = (G.camRig && G.camRig.yaw) || 0;
        const ang = Math.atan2(nearest.pos.x - p.x, nearest.pos.z - p.z) - yaw;
        copPanner.pan.setTargetAtTime(Math.max(-0.9, Math.min(0.9, Math.sin(ang))), ctx.currentTime, 0.08);
        if (now - lastWhoop > 0.95) { lastWhoop = now; siren(); }
      } else copPanner.pan.setTargetAtTime(0, ctx.currentTime, 0.2);
    }
    if (p && G.vehicles) {
      const near = [];
      for (const v of G.vehicles) {
        if (!v || v.dead || v.driver === 'player' || !v.spec) continue;
        const d2 = (v.pos.x - p.x) ** 2 + (v.pos.z - p.z) ** 2;
        if (d2 < 22 * 22) near.push({ v, d2 });
      }
      near.sort((a, b) => a.d2 - b.d2);
      const yaw = (G.camRig && G.camRig.yaw) || 0;
      for (let i = 0; i < 2; i++) {
        const slot = npcPans[i];
        if (i < near.length) {
          const v = near[i].v;
          const ang = Math.atan2(v.pos.x - p.x, v.pos.z - p.z) - yaw;
          slot.pan.pan.setTargetAtTime(Math.max(-0.85, Math.min(0.85, Math.sin(ang))), ctx.currentTime, 0.1);
          const top = v.spec.topSpeed || 20;
          slot.loop.set(Math.min(1, Math.abs(v.vel || 0) / top), true, 0.4);
        } else slot.loop.set(0, false, 0);
      }
    }
    if (G.audio && G.audio.rainBed && (G.time.rainStrength || 0) > 0.25 && p) {
      let under = false;
      const cells = G.world && G.world.buildingCells && buildingsNearSafe(p.x, p.z);
      if (cells) for (const b of cells) {
        const dx = Math.abs(p.x - b.pos.x) - b.size.x / 2;
        const dz = Math.abs(p.z - b.pos.z) - b.size.z / 2;
        if (dx < 2.4 && dz < 2.4 && (dx > -0.2 || dz > -0.2)) { under = true; break; }
      }
      G.audio.rainBed.setLevel((G.time.rainStrength || 0) * (under ? 0.28 : 0.18));
    }
  }
  function buildingsNearSafe(x, z) {
    const cells = G.world && G.world.buildingCells;
    if (!cells) return (G.world && G.world.buildings) || [];
    const BLOCK = 50;
    const i = Math.round(x / BLOCK), j = Math.round(z / BLOCK);
    const out = [];
    const list = cells.get(i + ',' + j);
    if (list) for (const b of list) out.push(b);
    return out;
  }

  const audio = {
    ctx, master, chime, bell, step, punch, kick, hit, shot, ricochet, reload,
    whistle, siren, thunder, rumble, honk, bark, scrape, btsChime,
    // new SFX
    vaultAlarm, boatMotor, whack, cashBoom,
    engineLoop, tukTukLoop, blip, rainBed: null, ambienceBed: null,
    radio: null, music: null,
    // dynamic-music tick — call once per frame from the loop's playing path.
    // It self-gates on G.state and ducks under SFX via its own bus.
    updateMusic: (dt) => { if (audio.music) audio.music.update((window.GAME && window.GAME.state) === 'playing'); },
    updateWorld,
    duckEngine: on => engineBus.gain.setTargetAtTime(on ? 0.4 : 1.0, ctx.currentTime, 0.2),
    setVolume: v => { master.gain.value = v; },
  };
  audio.rainBed = rainBed();
  audio.ambienceBed = ambienceBed();
  audio.radio = makeRadio();
  audio.music = makeMusic();
  return audio;
}

// Bangkok 3D — Phase 1 Prototype
// Single-file game in vanilla three.js. Procedural geometry, no external assets.
// Sections: Engine · World · Player · Vehicles · AI · Combat · Wanted · Mission · HUD · Loop

import * as THREE from 'three';

// =============================================================================
// 0. UTILITIES
// =============================================================================

const PI = Math.PI, TAU = PI * 2;
const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
const lerp  = (a, b, t) => a + (b - a) * t;
const rand  = (a, b) => a + Math.random() * (b - a);
const irand = (a, b) => Math.floor(rand(a, b + 1));
const pick  = arr => arr[Math.floor(Math.random() * arr.length)];
const sign  = x => (x > 0 ? 1 : x < 0 ? -1 : 0);
const dist2 = (a, b) => { const dx = a.x - b.x, dz = a.z - b.z; return dx*dx + dz*dz; };

// Deterministic-ish color palettes per district
const COLORS = {
  asphalt:  0x1a1c20,
  sidewalk: 0x6f6f6f,
  curb:     0x3a3a3a,
  building: [0x4a4a55, 0x5a5560, 0x6a5a45, 0x504848, 0x3f4045],
  neon:     [0xff2a86, 0x21f0ff, 0xff7a1a, 0xb24bff, 0xffcf4a, 0x39ff7a],
  khlong:   0x3a4f3a,
};

// Global container, populated by init()
const G = {
  THREE, scene: null, camera: null, renderer: null, clock: null,
  audio: null,           // AudioContext + helpers
  state: 'loading',      // 'playing' | 'paused' | 'phone' | 'map'
  input: null,           // keyboard/mouse state
  player: null,
  hud: null,
  mission: null,
  world: null,           // city geometry + spatial helpers
  vehicles: [],          // all vehicles in the world (NPC + player)
  peds: [],
  dogs: [],
  cops: [],
  bullets: [],
  particles: [],
  effects: [],
  time: { dayT: 0.27, weather: 'clear', rainStrength: 0 }, // 0..1 of a 4-min day
  wanted: { stars: 0, lastSeenAt: 0, lastSeenPos: new THREE.Vector3() },
  cash: 100,
  notifQueue: [],
  paused: false,
  groundHelpers: null,
};

window.GAME = G; // for poking around in the console

// =============================================================================
// 1. AUDIO
// =============================================================================

function makeAudio() {
  const ctx = new (window.AudioContext || window.webkitAudioContext)();
  const master = ctx.createGain(); master.gain.value = 0.55; master.connect(ctx.destination);

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
  function engineLoop({rpmBase=80, harsh=false} = {}) {
    const o1 = ctx.createOscillator(); o1.type = 'sawtooth'; o1.frequency.value = rpmBase;
    const o2 = ctx.createOscillator(); o2.type = 'square';   o2.frequency.value = rpmBase * 0.5;
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = harsh ? 1800 : 900;
    const g  = ctx.createGain(); g.gain.value = 0;
    o1.connect(lp); o2.connect(lp); lp.connect(g).connect(master);
    o1.start(); o2.start();
    return {
      set(speed01, on) {
        const target = on ? 0.10 + speed01 * 0.18 : 0;
        g.gain.setTargetAtTime(target, ctx.currentTime, 0.1);
        const f = rpmBase + speed01 * (harsh ? 380 : 180);
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
    o.connect(lp).connect(g).connect(master);
    o.start(); lfo.start();
    return {
      set(speed01, on) {
        const target = on ? 0.10 + speed01 * 0.18 : 0;
        g.gain.setTargetAtTime(target, ctx.currentTime, 0.1);
        const f = 50 + speed01 * 80;
        o.frequency.setTargetAtTime(f, ctx.currentTime, 0.08);
        lfo.frequency.setTargetAtTime(15 + speed01 * 22, ctx.currentTime, 0.1);
      },
      kill() { try { o.stop(); lfo.stop(); g.disconnect(); } catch {} }
    };
  }

  // Footstep, punch, pistol shot, hit, ricochet, siren
  function step(wet=false)  { noise(0.05, wet ? 0.18 : 0.10, wet ? 4000 : 1200); }
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
    o.connect(g).connect(master);
    o.start(t); o.stop(t + 1.0);
  }
  function thunder() { noise(1.5, 0.45, 400); }
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

  function honk() {
    blip({freq:380, dur:0.25, type:'square', gain:0.12, freqEnd:340});
  }
  function bark() {
    blip({freq:380, dur:0.07, type:'sawtooth', gain:0.18, freqEnd:220});
    setTimeout(()=>blip({freq:340, dur:0.08, type:'sawtooth', gain:0.16, freqEnd:200}),90);
  }

  const audio = {
    ctx, master, chime, bell, step, punch, kick, hit, shot, ricochet, reload,
    whistle, siren, thunder, honk, bark,
    engineLoop, tukTukLoop, blip, rainBed: null, ambienceBed: null,
  };
  audio.rainBed = rainBed();
  audio.ambienceBed = ambienceBed();
  return audio;
}

// =============================================================================
// 2. INPUT
// =============================================================================

function makeInput() {
  const keys = new Set();
  let mouseX = 0, mouseY = 0;
  let mouseDX = 0, mouseDY = 0;
  let mouseDown = false, rightDown = false;
  let pointerLocked = false;
  let prevKeys = new Set();

  window.addEventListener('keydown', e => {
    keys.add(e.code);
    // prevent some defaults
    if (['Tab','Space','KeyT','KeyB'].includes(e.code)) e.preventDefault();
  });
  window.addEventListener('keyup',   e => keys.delete(e.code));
  window.addEventListener('blur',    ()=> keys.clear());
  window.addEventListener('mousemove', e => {
    if (pointerLocked) { mouseDX += e.movementX; mouseDY += e.movementY; }
    mouseX = e.clientX; mouseY = e.clientY;
  });
  window.addEventListener('mousedown', e => { if (e.button===0) mouseDown=true; if (e.button===2) rightDown=true; });
  window.addEventListener('mouseup',   e => { if (e.button===0) mouseDown=false; if (e.button===2) rightDown=false; });
  window.addEventListener('contextmenu', e => e.preventDefault());
  document.addEventListener('pointerlockchange', () => {
    pointerLocked = document.pointerLockElement != null;
  });

  return {
    down: c => keys.has(c),
    pressed: c => keys.has(c) && !prevKeys.has(c),
    get mouseDown(){ return mouseDown; },
    get rightDown(){ return rightDown; },
    get pointerLocked(){ return pointerLocked; },
    consumeMouseDelta() { const dx=mouseDX, dy=mouseDY; mouseDX=0; mouseDY=0; return [dx,dy]; },
    requestLock() {
      const el = G.renderer.domElement;
      if (document.pointerLockElement !== el) el.requestPointerLock();
    },
    endFrame() { prevKeys = new Set(keys); },
  };
}

// =============================================================================
// 3. WORLD GENERATION — Sukhumvit, procedural
// =============================================================================

// Block-grid: ~500x500m playable. We use a 10x10 block grid, each block ~50m.
// Roads on the grid lines. Sois are smaller cross streets. BTS elevated track
// runs east-west down the middle on concrete pillars.

const BLOCK = 50;
const GRID  = 10;
const HALF  = (BLOCK * GRID) / 2; // 250

function buildWorld(scene) {
  const world = {
    bounds: { min: new THREE.Vector3(-HALF, 0, -HALF), max: new THREE.Vector3(HALF, 0, HALF) },
    buildings: [],       // {pos, size, mesh}
    intersections: [],   // grid vertex positions (for traffic & cops)
    spawns: { player: new THREE.Vector3(0, 0.0, 100) },
    poi: {},             // points of interest (mission markers)
    sevenElevens: [],
    minimap: null,       // canvas-rendered base layer
  };

  // Day/night caches — populated below, consumed by updateDayNight() so it never
  // has to traverse the whole scene graph each frame.
  G.nightLights = [];    // [{light, base}] accent PointLights that scale with night
  G.nightEmissive = [];  // [{mat, dayIntensity, nightIntensity}] materials that ramp at night

  // Scratch transform objects, reused while composing InstancedMesh matrices.
  const _m = new THREE.Matrix4();
  const _m2 = new THREE.Matrix4();
  const _q = new THREE.Quaternion();
  const _e = new THREE.Euler();
  const _p = new THREE.Vector3();
  const _s = new THREE.Vector3();

  // Build one InstancedMesh from an array of Matrix4 and add it to the scene.
  // Returns null (and adds nothing) for empty arrays so callers can stay terse.
  function addInstanced(geo, mat, matrices, cast, receive) {
    if (!matrices.length) return null;
    const inst = new THREE.InstancedMesh(geo, mat, matrices.length);
    for (let k = 0; k < matrices.length; k++) inst.setMatrixAt(k, matrices[k]);
    inst.instanceMatrix.needsUpdate = true;
    inst.castShadow = !!cast;
    inst.receiveShadow = !!receive;
    scene.add(inst);
    return inst;
  }

  // ---- ground / asphalt ----
  const groundMat = new THREE.MeshStandardMaterial({ color: COLORS.asphalt, roughness: 0.9 });
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(HALF*2 + 200, HALF*2 + 200, 1, 1), groundMat);
  ground.rotation.x = -PI/2; ground.position.y = 0; ground.receiveShadow = true;
  scene.add(ground);

  // ---- road grid ----
  const roadMat = new THREE.MeshStandardMaterial({ color: 0x111418, roughness: 0.85 });
  const stripeMat = new THREE.MeshBasicMaterial({ color: 0xffe699 });
  const sidewalkMat = new THREE.MeshStandardMaterial({ color: COLORS.sidewalk, roughness: 1.0 });

  const ROAD_W = 12, SIDEWALK_W = 3;

  // Build major roads on grid lines (avenues)
  for (let i = -GRID/2; i <= GRID/2; i++) {
    const p = i * BLOCK;
    // east-west road
    const rdEW = new THREE.Mesh(new THREE.PlaneGeometry(HALF*2, ROAD_W), roadMat);
    rdEW.rotation.x = -PI/2; rdEW.position.set(0, 0.02, p); rdEW.receiveShadow = true; scene.add(rdEW);
    // north-south road
    const rdNS = new THREE.Mesh(new THREE.PlaneGeometry(ROAD_W, HALF*2), roadMat);
    rdNS.rotation.x = -PI/2; rdNS.position.set(p, 0.02, 0); rdNS.receiveShadow = true; scene.add(rdNS);
    // center stripes
    for (let s = -HALF+10; s <= HALF-10; s += 6) {
      const sEW = new THREE.Mesh(new THREE.PlaneGeometry(3, 0.4), stripeMat);
      sEW.rotation.x = -PI/2; sEW.position.set(s, 0.025, p); scene.add(sEW);
      const sNS = new THREE.Mesh(new THREE.PlaneGeometry(0.4, 3), stripeMat);
      sNS.rotation.x = -PI/2; sNS.position.set(p, 0.025, s); scene.add(sNS);
    }
  }

  // intersections (grid vertices) — used to place lamps, traffic & cops
  for (let i = -GRID/2; i <= GRID/2; i++) {
    for (let j = -GRID/2; j <= GRID/2; j++) {
      world.intersections.push(new THREE.Vector3(i*BLOCK, 0, j*BLOCK));
    }
  }

  // sidewalks bordering blocks
  for (let i = -GRID/2; i < GRID/2; i++) {
    for (let j = -GRID/2; j < GRID/2; j++) {
      const cx = (i + 0.5) * BLOCK;
      const cz = (j + 0.5) * BLOCK;
      // block interior: 50m square minus road clearance
      const blockHalf = BLOCK/2 - ROAD_W/2;
      // sidewalks: thin strips inside the block bounds
      const sw1 = new THREE.Mesh(new THREE.PlaneGeometry(BLOCK - ROAD_W, SIDEWALK_W*2), sidewalkMat);
      sw1.rotation.x = -PI/2; sw1.position.set(cx, 0.04, cz - blockHalf + SIDEWALK_W); sw1.receiveShadow = true; scene.add(sw1);
      const sw2 = new THREE.Mesh(new THREE.PlaneGeometry(BLOCK - ROAD_W, SIDEWALK_W*2), sidewalkMat);
      sw2.rotation.x = -PI/2; sw2.position.set(cx, 0.04, cz + blockHalf - SIDEWALK_W); sw2.receiveShadow = true; scene.add(sw2);
      const sw3 = new THREE.Mesh(new THREE.PlaneGeometry(SIDEWALK_W*2, BLOCK - ROAD_W - SIDEWALK_W*4), sidewalkMat);
      sw3.rotation.x = -PI/2; sw3.position.set(cx - blockHalf + SIDEWALK_W, 0.04, cz); sw3.receiveShadow = true; scene.add(sw3);
      const sw4 = new THREE.Mesh(new THREE.PlaneGeometry(SIDEWALK_W*2, BLOCK - ROAD_W - SIDEWALK_W*4), sidewalkMat);
      sw4.rotation.x = -PI/2; sw4.position.set(cx + blockHalf - SIDEWALK_W, 0.04, cz); sw4.receiveShadow = true; scene.add(sw4);
    }
  }

  // ---- buildings ----
  // Buildings flank the road on all 4 sides of each block, forming a street canyon.
  // Each block: 4 corner buildings + a row of shop-houses marching along each side
  // between the corners. The block interior becomes a small courtyard / alley gap.
  const buildingMatPool = COLORS.building.map(c => new THREE.MeshStandardMaterial({
    color: c, roughness: 0.85,
  }));
  // Shop-level (ground floor) palette — Bangkok shophouse fronts: cream, terracotta,
  // faded pink, dirty white, gray-blue. Different from upper-floor colors so each
  // building reads as having a distinct "shop band" at street level.
  const SHOP_COLORS = [0xe0c885, 0xa84a3a, 0xd49a92, 0xd9d2c7, 0x7a8fa0, 0xc9b48e, 0xb8a07a];
  const shopMatPool = SHOP_COLORS.map(c => new THREE.MeshStandardMaterial({
    color: c, roughness: 0.95,
  }));
  // windows: emissive grid texture procedurally drawn. One shared material for all
  // window planes (so it instances cheaply and ramps via a single nightEmissive entry).
  const winTex = makeWindowTexture();
  const winMat = new THREE.MeshStandardMaterial({
    map: winTex, emissiveMap: winTex, emissive: 0xffe6a8, emissiveIntensity: 0.0, roughness: 0.6,
  });
  G.nightEmissive.push({ mat: winMat, dayIntensity: 0.0, nightIntensity: 1.0 });

  const SIDEWALK_EDGE = BLOCK/2 - ROAD_W/2 - SIDEWALK_W*2; // 13: distance from block center to inner sidewalk edge
  const SHOP_LEVEL_H = 4; // height of ground-floor shop band

  // ---- Rooftop-decor instancing pools ----
  // placeBuilding scatters water tanks, AC condensers, antennas and dishes across
  // many rooftops. Rather than one Mesh each (thousands of draw calls), we collect
  // a per-instance Matrix4 here and build one InstancedMesh per prop type afterwards.
  // Unit geometries (radius 1 / height 1) are scaled per instance via the matrix.
  const tankGeo = new THREE.CylinderGeometry(1, 1, 1, 10);   // scaled by (R, H, R)
  const tankMatDark = new THREE.MeshStandardMaterial({ color: 0x202020, roughness: 0.7 });
  const tankMatBlue = new THREE.MeshStandardMaterial({ color: 0x355088, roughness: 0.7 });
  const tankLegGeo = new THREE.BoxGeometry(0.08, 0.3, 0.08);
  const tankLegMat = new THREE.MeshStandardMaterial({ color: 0x222222, roughness: 0.9 });
  const acGeo = new THREE.BoxGeometry(0.55, 0.35, 0.4);
  const acMat = new THREE.MeshStandardMaterial({ color: 0xb8b8b8, roughness: 0.6, metalness: 0.4 });
  const antGeo = new THREE.CylinderGeometry(0.035, 0.035, 1, 6); // scaled by (1, H, 1)
  const antMat = new THREE.MeshStandardMaterial({ color: 0x555555, roughness: 0.6 });
  const dishGeo = new THREE.SphereGeometry(0.32, 8, 6, 0, TAU, 0, PI/3);
  const dishMat = new THREE.MeshStandardMaterial({ color: 0xdddddd, roughness: 0.4, metalness: 0.3 });
  const tankDarkM = [], tankBlueM = [], tankLegM = [], acM = [], antM = [], dishM = [];

  // placeBuilding: shop band on bottom 4m + upper floors above, plus optional
  // window strips and neon sign on the faces that look toward a road.
  // frontFaces: array of {ax: 'x'|'z', sign: +1|-1} for each road-facing face.
  function placeBuilding(bx, bz, dimX, dimZ, h, frontFaces) {
    const upperH = Math.max(0.1, h - SHOP_LEVEL_H);
    const upperMat = buildingMatPool[irand(0, buildingMatPool.length - 1)];
    const upper = new THREE.Mesh(new THREE.BoxGeometry(dimX, upperH, dimZ), upperMat);
    upper.position.set(bx, SHOP_LEVEL_H + upperH/2, bz);
    upper.castShadow = true; upper.receiveShadow = true;
    scene.add(upper);

    const shopMat = shopMatPool[irand(0, shopMatPool.length - 1)];
    const shop = new THREE.Mesh(new THREE.BoxGeometry(dimX, SHOP_LEVEL_H, dimZ), shopMat);
    shop.position.set(bx, SHOP_LEVEL_H/2, bz);
    shop.castShadow = true; shop.receiveShadow = true;
    scene.add(shop);

    world.buildings.push({
      pos: new THREE.Vector3(bx, h/2, bz),
      size: new THREE.Vector3(dimX, h, dimZ),
      mesh: upper,
    });

    // window strip on tall buildings — emissive panels on each road-facing face
    if (h > 22) {
      const winH = upperH - 2;
      for (const face of frontFaces) {
        let win;
        if (face.ax === 'z') {
          const winW = dimX - 1.5;
          if (winW <= 0.5) continue;
          win = new THREE.Mesh(new THREE.PlaneGeometry(winW, winH), winMat);
          win.position.set(bx, SHOP_LEVEL_H + upperH/2, bz + face.sign * (dimZ/2 + 0.02));
          if (face.sign < 0) win.rotation.y = PI;
        } else {
          const winW = dimZ - 1.5;
          if (winW <= 0.5) continue;
          win = new THREE.Mesh(new THREE.PlaneGeometry(winW, winH), winMat);
          win.position.set(bx + face.sign * (dimX/2 + 0.02), SHOP_LEVEL_H + upperH/2, bz);
          win.rotation.y = face.sign > 0 ? PI/2 : -PI/2;
        }
        scene.add(win);
      }
    }

    // neon sign on shop level for short/mid buildings — on the first road-facing face.
    // Self-illuminated via an emissive material (no real PointLight) so hundreds of
    // signs cost nothing at runtime; the emissive ramps up at night via nightEmissive.
    if (h < 32 && Math.random() < 0.8 && frontFaces.length > 0) {
      const face = frontFaces[0];
      const neonColor = pick(COLORS.neon);
      const faceWidth = face.ax === 'z' ? dimX : dimZ;
      const sw = rand(2, Math.min(faceWidth, 6));
      const sh = rand(1.0, 2.0);
      const signMat = new THREE.MeshStandardMaterial({
        color: neonColor, emissive: neonColor, emissiveIntensity: 0.15, roughness: 0.5,
      });
      G.nightEmissive.push({ mat: signMat, dayIntensity: 0.15, nightIntensity: 1.4 });
      const sign = new THREE.Mesh(new THREE.PlaneGeometry(sw, sh), signMat);
      if (face.ax === 'z') {
        sign.position.set(bx, rand(2.5, 3.7), bz + face.sign * (dimZ/2 + 0.05));
        if (face.sign < 0) sign.rotation.y = PI;
      } else {
        sign.position.set(bx + face.sign * (dimX/2 + 0.05), rand(2.5, 3.7), bz);
        sign.rotation.y = face.sign > 0 ? PI/2 : -PI/2;
      }
      scene.add(sign);
    }

    // awning: tarp slab projecting out from the shop level over the sidewalk
    if (h < 34 && Math.random() < 0.55 && frontFaces.length > 0) {
      const tarpColors = [0x3a5a8a, 0xa83a3a, 0x3a8a5a, 0xcfa83a, 0x4a4a4a, 0xc26b3a];
      const tarpColor = pick(tarpColors);
      const tarpMat = new THREE.MeshStandardMaterial({ color: tarpColor, roughness: 0.85, side: THREE.DoubleSide });
      for (const face of frontFaces) {
        const projDepth = rand(1.6, 2.4);
        const projY = SHOP_LEVEL_H - 0.35;
        if (face.ax === 'z') {
          const aw = Math.max(0.5, dimX - 0.6);
          const awning = new THREE.Mesh(new THREE.BoxGeometry(aw, 0.06, projDepth), tarpMat);
          awning.position.set(bx, projY, bz + face.sign * (dimZ/2 + projDepth/2));
          awning.rotation.x = -0.05 * face.sign; // slight outward droop
          scene.add(awning);
        } else {
          const aw = Math.max(0.5, dimZ - 0.6);
          const awning = new THREE.Mesh(new THREE.BoxGeometry(projDepth, 0.06, aw), tarpMat);
          awning.position.set(bx + face.sign * (dimX/2 + projDepth/2), projY, bz);
          awning.rotation.z = 0.05 * face.sign;
          scene.add(awning);
        }
      }
    }

    // Rooftop detail: water tanks, AC condensers, antennas, occasional setback cap.
    // These break up the cube silhouette and read "Bangkok" at any distance.
    if (h > 8 && dimX > 2.5 && dimZ > 2.5) {
      const roofY = h;

      // Setback: tall buildings get a smaller cap on top.
      if (h > 42 && Math.random() < 0.32) {
        const setH = rand(6, 14);
        const setX = Math.max(2, dimX * rand(0.55, 0.78));
        const setZ = Math.max(2, dimZ * rand(0.55, 0.78));
        const setMat = buildingMatPool[irand(0, buildingMatPool.length - 1)];
        const setbox = new THREE.Mesh(new THREE.BoxGeometry(setX, setH, setZ), setMat);
        setbox.position.set(bx, roofY + setH/2, bz);
        setbox.castShadow = true; setbox.receiveShadow = true;
        scene.add(setbox);
        // window strip on the setback's main face
        if (frontFaces.length > 0 && setH > 5) {
          const face = frontFaces[0];
          const win = new THREE.Mesh(
            new THREE.PlaneGeometry(face.ax === 'z' ? setX - 1 : setZ - 1, setH - 1.5),
            winMat
          );
          if (face.ax === 'z') {
            win.position.set(bx, roofY + setH/2, bz + face.sign * (setZ/2 + 0.02));
            if (face.sign < 0) win.rotation.y = PI;
          } else {
            win.position.set(bx + face.sign * (setX/2 + 0.02), roofY + setH/2, bz);
            win.rotation.y = face.sign > 0 ? PI/2 : -PI/2;
          }
          scene.add(win);
        }
      }

      // Water tank (cylinder on stubby legs) — iconic Bangkok rooftop. Instanced:
      // unit cylinder scaled to (R, H, R); legs are a shared box instanced too.
      if (Math.random() < 0.6) {
        const tankR = rand(0.45, 0.85);
        const tankH = rand(1.2, 2.0);
        const tankDark = Math.random() < 0.72;
        const tankX = bx + rand(-dimX/2 + tankR + 0.3, dimX/2 - tankR - 0.3);
        const tankZ = bz + rand(-dimZ/2 + tankR + 0.3, dimZ/2 - tankR - 0.3);
        _p.set(tankX, roofY + tankH/2 + 0.3, tankZ);
        _q.identity();
        _s.set(tankR, tankH, tankR);
        (tankDark ? tankDarkM : tankBlueM).push(_m.compose(_p, _q, _s).clone());
        for (const [lx, lz] of [[-tankR*0.7, -tankR*0.7], [tankR*0.7, -tankR*0.7], [-tankR*0.7, tankR*0.7], [tankR*0.7, tankR*0.7]]) {
          _p.set(tankX + lx, roofY + 0.15, tankZ + lz);
          _q.identity();
          _s.set(1, 1, 1);
          tankLegM.push(_m.compose(_p, _q, _s).clone());
        }
      }

      // AC condensers — small clustered boxes (instanced, shared geo/material)
      const numAC = irand(0, 3);
      for (let k = 0; k < numAC; k++) {
        _p.set(
          bx + rand(-dimX/2 + 0.4, dimX/2 - 0.4),
          roofY + 0.175,
          bz + rand(-dimZ/2 + 0.4, dimZ/2 - 0.4)
        );
        _q.setFromEuler(_e.set(0, rand(0, TAU), 0));
        _s.set(1, 1, 1);
        acM.push(_m.compose(_p, _q, _s).clone());
      }

      // Antenna / satellite dish (instanced; antenna is a unit cylinder scaled in Y)
      if (Math.random() < 0.5) {
        const antH = rand(1.5, 3);
        const antX = bx + rand(-dimX/2 + 0.3, dimX/2 - 0.3);
        const antZ = bz + rand(-dimZ/2 + 0.3, dimZ/2 - 0.3);
        _p.set(antX, roofY + antH/2, antZ);
        _q.identity();
        _s.set(1, antH, 1);
        antM.push(_m.compose(_p, _q, _s).clone());
        if (Math.random() < 0.45) {
          _p.set(antX + 0.25, roofY + antH * 0.7, antZ);
          _q.setFromEuler(_e.set(0, 0, -PI/2));
          _s.set(1, 1, 1);
          dishM.push(_m.compose(_p, _q, _s).clone());
        }
      }
    }

    // perpendicular hanging sign — sticks out from the facade (Thai-shophouse style)
    if (h > 8 && Math.random() < 0.35 && frontFaces.length > 0) {
      const face = frontFaces[0];
      const armLen = 1.2;
      const signW = rand(1.0, 1.6), signH = rand(0.5, 0.9);
      const signColor = pick([0xa84a3a, 0xcfa83a, 0xe0c885, 0x3a8a5a, 0x1a1a1a, 0xb24bff]);
      const signMat = new THREE.MeshBasicMaterial({ color: signColor });
      const armMat = new THREE.MeshStandardMaterial({ color: 0x222222 });
      const heightY = Math.min(h - 1, rand(4.5, 7));
      if (face.ax === 'z') {
        const arm = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.05, armLen), armMat);
        arm.position.set(bx, heightY, bz + face.sign * (dimZ/2 + armLen/2));
        scene.add(arm);
        const signMesh = new THREE.Mesh(new THREE.BoxGeometry(signW, signH, 0.05), signMat);
        signMesh.position.set(bx, heightY - signH/2 - 0.05, bz + face.sign * (dimZ/2 + armLen));
        scene.add(signMesh);
      } else {
        const arm = new THREE.Mesh(new THREE.BoxGeometry(armLen, 0.05, 0.05), armMat);
        arm.position.set(bx + face.sign * (dimX/2 + armLen/2), heightY, bz);
        scene.add(arm);
        const signMesh = new THREE.Mesh(new THREE.BoxGeometry(0.05, signH, signW), signMat);
        signMesh.position.set(bx + face.sign * (dimX/2 + armLen), heightY - signH/2 - 0.05, bz);
        scene.add(signMesh);
      }
    }
  }

  // Temple block — replaces normal buildings in one block with a wat compound.
  const TEMPLE_I = 2, TEMPLE_J = -2;

  for (let i = -GRID/2; i < GRID/2; i++) {
    for (let j = -GRID/2; j < GRID/2; j++) {
      if (i === TEMPLE_I && j === TEMPLE_J) continue; // temple placed after loop
      const cx = (i + 0.5) * BLOCK;
      const cz = (j + 0.5) * BLOCK;

      // Tall-building bias: central blocks more likely to have skyscrapers,
      // outer blocks more likely to be shop-houses.
      const distFromCenter = Math.hypot(i + 0.5, j + 0.5);
      const tallChance = lerp(0.32, 0.06, clamp(distFromCenter / (GRID/2), 0, 1));

      // ---- 4 corner buildings ----
      for (const [sx, sz] of [[+1,+1],[+1,-1],[-1,+1],[-1,-1]]) {
        const csx = rand(7, 9), csz = rand(7, 9);
        const bx = cx + sx * (SIDEWALK_EDGE - csx/2);
        const bz = cz + sz * (SIDEWALK_EDGE - csz/2);
        const isTall = Math.random() < tallChance * 1.4;
        const h = isTall ? rand(45, 95) : rand(10, 26);
        placeBuilding(bx, bz, csx, csz, h, [
          { ax: 'z', sign: sz },
          { ax: 'x', sign: sx },
        ]);
      }

      // ---- 4 sides — march along the sidewalk between corner zones ----
      const sides = [
        { ax: 'z', sign: +1 }, // north side: buildings face +z
        { ax: 'z', sign: -1 }, // south side
        { ax: 'x', sign: +1 }, // east side
        { ax: 'x', sign: -1 }, // west side
      ];
      // Corner zones occupy ±SIDEWALK_EDGE inward by ~9m. Side marching avoids them.
      const SIDE_END = SIDEWALK_EDGE - 9;
      for (const side of sides) {
        let cursor = -SIDE_END + rand(0, 1);
        while (SIDE_END - cursor >= 4.5) {
          const remaining = SIDE_END - cursor;
          const wantBig = Math.random() < 0.2;
          const w = Math.min(remaining, wantBig ? rand(10, 16) : rand(4.5, 8.5));
          const d = rand(7, 9);
          const isTall = Math.random() < (wantBig ? tallChance * 1.5 : tallChance * 0.4);
          const h = isTall ? rand(40, 90) : rand(9, 24);

          let bx, bz, dimX, dimZ;
          if (side.ax === 'z') {
            bx = cx + cursor + w/2;
            bz = cz + side.sign * (SIDEWALK_EDGE - d/2);
            dimX = w; dimZ = d;
          } else {
            bz = cz + cursor + w/2;
            bx = cx + side.sign * (SIDEWALK_EDGE - d/2);
            dimX = d; dimZ = w;
          }
          placeBuilding(bx, bz, dimX, dimZ, h, [{ ax: side.ax, sign: side.sign }]);

          cursor += w + rand(0.0, 0.8);
        }
      }
    }
  }

  // ---- Build rooftop-decor InstancedMeshes from the matrices gathered above ----
  addInstanced(tankGeo, tankMatDark, tankDarkM, true, false); // tanks cast shadow
  addInstanced(tankGeo, tankMatBlue, tankBlueM, true, false);
  addInstanced(tankLegGeo, tankLegMat, tankLegM, false, false);
  addInstanced(acGeo, acMat, acM, false, false);
  addInstanced(antGeo, antMat, antM, false, false);
  addInstanced(dishGeo, dishMat, dishM, false, false);

  // ---- Temple compound (wat) — a landmark block with viharn + chedi ----
  {
    const cx = (TEMPLE_I + 0.5) * BLOCK;
    const cz = (TEMPLE_J + 0.5) * BLOCK;
    const wallMat = new THREE.MeshStandardMaterial({ color: 0xddd0b8, roughness: 0.95 });
    const wallH = 2.4;
    const wallExtent = SIDEWALK_EDGE;
    // perimeter wall with gaps for gates (south + east gates)
    function wallStrip(x, y, z, sx, sy, sz) {
      const w = new THREE.Mesh(new THREE.BoxGeometry(sx, sy, sz), wallMat);
      w.position.set(x, y, z); w.castShadow = true; w.receiveShadow = true; scene.add(w);
    }
    // north + west walls full, south + east walls with a gap in the middle (gate)
    wallStrip(cx, wallH/2, cz + wallExtent, wallExtent*2, wallH, 0.7);
    wallStrip(cx - wallExtent, wallH/2, cz, 0.7, wallH, wallExtent*2);
    // south wall: two segments leaving a 4m gate
    wallStrip(cx - (wallExtent+3)/2, wallH/2, cz - wallExtent, wallExtent - 3, wallH, 0.7);
    wallStrip(cx + (wallExtent+3)/2, wallH/2, cz - wallExtent, wallExtent - 3, wallH, 0.7);
    // east wall: two segments leaving a gate
    wallStrip(cx + wallExtent, wallH/2, cz - (wallExtent+3)/2, 0.7, wallH, wallExtent - 3);
    wallStrip(cx + wallExtent, wallH/2, cz + (wallExtent+3)/2, 0.7, wallH, wallExtent - 3);

    // Main viharn (hall) — cream walls with stacked golden roofs
    const viharnMat = new THREE.MeshStandardMaterial({ color: 0xf5ead8, roughness: 0.85 });
    const roofMat = new THREE.MeshStandardMaterial({ color: 0xd9a134, roughness: 0.5, metalness: 0.65 });
    const viharn = new THREE.Mesh(new THREE.BoxGeometry(13, 5.5, 8), viharnMat);
    viharn.position.set(cx + 1.5, 2.75, cz + 1);
    viharn.castShadow = true; viharn.receiveShadow = true; scene.add(viharn);
    // tiered pyramid roof (3 levels)
    const r1 = new THREE.Mesh(new THREE.ConeGeometry(9.5, 3.6, 4), roofMat);
    r1.position.set(cx + 1.5, 7.5, cz + 1); r1.rotation.y = PI/4; r1.castShadow = true; scene.add(r1);
    const r2 = new THREE.Mesh(new THREE.ConeGeometry(7, 3.0, 4), roofMat);
    r2.position.set(cx + 1.5, 10.0, cz + 1); r2.rotation.y = PI/4; scene.add(r2);
    const r3 = new THREE.Mesh(new THREE.ConeGeometry(4.5, 2.6, 4), roofMat);
    r3.position.set(cx + 1.5, 12.4, cz + 1); r3.rotation.y = PI/4; scene.add(r3);
    const spire = new THREE.Mesh(new THREE.ConeGeometry(0.3, 2.2, 6), roofMat);
    spire.position.set(cx + 1.5, 14.8, cz + 1); scene.add(spire);

    // Chedi (white bell-spire) in corner
    const chediWhiteMat = new THREE.MeshStandardMaterial({ color: 0xf3eede, roughness: 0.75 });
    const chediGoldMat = new THREE.MeshStandardMaterial({ color: 0xd9a134, roughness: 0.5, metalness: 0.6 });
    const chediX = cx - 8, chediZ = cz - 6;
    const cBase = new THREE.Mesh(new THREE.CylinderGeometry(2.2, 2.8, 3, 12), chediWhiteMat);
    cBase.position.set(chediX, 1.5, chediZ); cBase.castShadow = true; scene.add(cBase);
    const cBell = new THREE.Mesh(new THREE.SphereGeometry(1.95, 14, 10, 0, TAU, 0, PI/2), chediWhiteMat);
    cBell.position.set(chediX, 3.0, chediZ); scene.add(cBell);
    const cTube = new THREE.Mesh(new THREE.CylinderGeometry(0.55, 0.7, 2, 8), chediWhiteMat);
    cTube.position.set(chediX, 5.5, chediZ); scene.add(cTube);
    const cSpire = new THREE.Mesh(new THREE.ConeGeometry(0.5, 5.5, 8), chediGoldMat);
    cSpire.position.set(chediX, 9.3, chediZ); scene.add(cSpire);

    // soft warm glow over the temple — a real accent light, cached for day/night
    const templeLight = new THREE.PointLight(0xffd577, 0.6, 30, 2);
    templeLight.position.set(cx, 7, cz);
    scene.add(templeLight);
    G.nightLights.push({ light: templeLight, base: 0.8 });

    // collision: viharn + chedi base
    world.buildings.push({
      pos: new THREE.Vector3(cx + 1.5, 2.75, cz + 1),
      size: new THREE.Vector3(13, 5.5, 8),
      mesh: viharn,
    });
    world.buildings.push({
      pos: new THREE.Vector3(chediX, 4.5, chediZ),
      size: new THREE.Vector3(5, 9, 5),
      mesh: cBase,
    });
    world.poi.temple = new THREE.Vector3(cx, 0, cz);
  }

  // ---- Power lines: utility poles + tangled overhead wires (the Bangkok cue) ----
  const poleMat = new THREE.MeshStandardMaterial({ color: 0x554a3e, roughness: 0.9 });
  const wireMat = new THREE.MeshStandardMaterial({ color: 0x0a0a0a, roughness: 0.95 });
  const junctionMat = new THREE.MeshStandardMaterial({ color: 0x1a1a1a, roughness: 0.9 });
  const POLE_H = 6.4, POLE_R = 0.13;
  const POLE_SPACING = 28;
  // shared geometries (reuse across many poles)
  const poleGeo = new THREE.CylinderGeometry(POLE_R*0.85, POLE_R, POLE_H, 6);
  const armGeoEW = new THREE.BoxGeometry(1.6, 0.10, 0.10);
  const armGeoNS = new THREE.BoxGeometry(0.10, 0.10, 1.6);
  const junctionGeo = new THREE.BoxGeometry(0.32, 0.5, 0.28);
  const wireGeo = new THREE.CylinderGeometry(0.035, 0.035, 1, 4); // unit; scaled in Y
  // Instancing accumulators — one Matrix4 per instance, built into InstancedMeshes below.
  const poleM = [], armEWM = [], armNSM = [], junctionM = [], wireM = [];

  function makePole(x, z, isEW) {
    _q.identity(); _s.set(1, 1, 1);
    _p.set(x, POLE_H/2, z);
    poleM.push(_m.compose(_p, _q, _s).clone());
    _p.set(x, POLE_H - 0.55, z);
    (isEW ? armEWM : armNSM).push(_m.compose(_p, _q, _s).clone());
    if (Math.random() < 0.4) {
      _p.set(x, 4.0 + rand(-0.3, 0.4), z);
      junctionM.push(_m.compose(_p, _q, _s).clone());
    }
  }

  function makeWire(x1, z1, x2, z2, y, lateral, isEW) {
    const dx = x2 - x1, dz = z2 - z1;
    const len = Math.hypot(dx, dz);
    if (len < 1 || len > POLE_SPACING * 1.6) return;
    let cx, cz;
    if (isEW) { cx = (x1+x2)/2; cz = (z1+z2)/2 + lateral; }
    else      { cx = (x1+x2)/2 + lateral; cz = (z1+z2)/2; }
    _p.set(cx, y, cz);
    // unit cylinder long-axis is Y; scale Y by length, then rotate to run along road
    _q.setFromEuler(_e.set(isEW ? 0 : PI/2, 0, isEW ? PI/2 : 0));
    _s.set(1, len, 1);
    wireM.push(_m.compose(_p, _q, _s).clone());
  }

  // Poles along EW roads — on both sidewalks (north & south of each road)
  for (let i = -GRID/2; i <= GRID/2; i++) {
    const zRoad = i * BLOCK;
    for (const zSign of [-1, +1]) {
      const zPole = zRoad + zSign * 8.5;
      let prevX = null;
      for (let x = -HALF + 14; x <= HALF - 14; x += POLE_SPACING) {
        makePole(x, zPole, true);
        if (prevX !== null) {
          for (const off of [-0.55, 0, 0.55]) {
            makeWire(prevX, zPole, x, zPole, POLE_H - 0.7 + rand(-0.05, 0.05), off, true);
          }
        }
        prevX = x;
      }
    }
  }
  // Poles along NS roads
  for (let i = -GRID/2; i <= GRID/2; i++) {
    const xRoad = i * BLOCK;
    for (const xSign of [-1, +1]) {
      const xPole = xRoad + xSign * 8.5;
      let prevZ = null;
      for (let z = -HALF + 14; z <= HALF - 14; z += POLE_SPACING) {
        makePole(xPole, z, false);
        if (prevZ !== null) {
          for (const off of [-0.55, 0, 0.55]) {
            makeWire(xPole, prevZ, xPole, z, POLE_H - 0.7 + rand(-0.05, 0.05), off, false);
          }
        }
        prevZ = z;
      }
    }
  }
  // Build power-line InstancedMeshes (poles cast+receive shadow like the originals)
  addInstanced(poleGeo, poleMat, poleM, true, true);
  addInstanced(armGeoEW, poleMat, armEWM, false, false);
  addInstanced(armGeoNS, poleMat, armNSM, false, false);
  addInstanced(junctionGeo, junctionMat, junctionM, false, false);
  addInstanced(wireGeo, wireMat, wireM, false, false);

  // ---- Parked motorbikes — clusters along curbs (Bangkok parking is everywhere) ----
  // One InstancedMesh per part type (frame / wheel / handle). The original gave each
  // cluster a random frame color; instancing forces a single shared frame material,
  // so we pick one representative Bangkok-red — the silhouette is what reads at range.
  const bikeFrameMat = new THREE.MeshStandardMaterial({ color: 0xd6363c, roughness: 0.55, metalness: 0.3 });
  const bikeWheelMat = new THREE.MeshStandardMaterial({ color: 0x111111, roughness: 0.85 });
  const bikeHandleMat = new THREE.MeshStandardMaterial({ color: 0x111111 });
  const bikeWheelGeo = new THREE.TorusGeometry(0.3, 0.075, 6, 12);
  const bikeFrameGeo = new THREE.BoxGeometry(0.5, 0.4, 1.5);
  const bikeHandleGeo = new THREE.BoxGeometry(0.7, 0.05, 0.06);
  const bikeFrameM = [], bikeWheelM = [], bikeHandleM = [];
  // Local (within-bike) part transforms, baked once and reused for every bike.
  const _wheelQ = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, PI/2, 0));
  const localFrame  = new THREE.Matrix4().compose(new THREE.Vector3(0, 0.5, 0), new THREE.Quaternion(), new THREE.Vector3(1,1,1));
  const localWheelF = new THREE.Matrix4().compose(new THREE.Vector3(0, 0.3, 0.75), _wheelQ, new THREE.Vector3(1,1,1));
  const localWheelR = new THREE.Matrix4().compose(new THREE.Vector3(0, 0.3, -0.75), _wheelQ, new THREE.Vector3(1,1,1));
  const localHandle = new THREE.Matrix4().compose(new THREE.Vector3(0, 1.0, 0.65), new THREE.Quaternion(), new THREE.Vector3(1,1,1));
  for (let i = -GRID/2; i < GRID/2; i++) {
    for (let j = -GRID/2; j < GRID/2; j++) {
      const cx = (i + 0.5) * BLOCK;
      const cz = (j + 0.5) * BLOCK;
      const numClusters = irand(1, 3);
      for (let n = 0; n < numClusters; n++) {
        const side = pick([
          { ax: 'z', sign: +1 }, { ax: 'z', sign: -1 },
          { ax: 'x', sign: +1 }, { ax: 'x', sign: -1 },
        ]);
        const clusterSize = irand(2, 5);
        const t0 = rand(-12, 12 - clusterSize * 0.9);
        for (let k = 0; k < clusterSize; k++) {
          let bx, bz, ry;
          if (side.ax === 'z') {
            bx = cx + t0 + k * 0.9;
            bz = cz + side.sign * 15.5;
            ry = (side.sign > 0 ? 0 : PI) + rand(-0.12, 0.12);
          } else {
            bz = cz + t0 + k * 0.9;
            bx = cx + side.sign * 15.5;
            ry = (side.sign > 0 ? -PI/2 : PI/2) + rand(-0.12, 0.12);
          }
          // group (bike) transform, then world = group * localPart
          _p.set(bx, 0.05, bz);
          _q.setFromEuler(_e.set(0, ry, 0));
          _s.set(1, 1, 1);
          _m2.compose(_p, _q, _s);
          bikeFrameM.push(new THREE.Matrix4().multiplyMatrices(_m2, localFrame));
          bikeWheelM.push(new THREE.Matrix4().multiplyMatrices(_m2, localWheelF));
          bikeWheelM.push(new THREE.Matrix4().multiplyMatrices(_m2, localWheelR));
          bikeHandleM.push(new THREE.Matrix4().multiplyMatrices(_m2, localHandle));
        }
      }
    }
  }
  addInstanced(bikeFrameGeo, bikeFrameMat, bikeFrameM, false, false);
  addInstanced(bikeWheelGeo, bikeWheelMat, bikeWheelM, false, false);
  addInstanced(bikeHandleGeo, bikeHandleMat, bikeHandleM, false, false);

  // ---- Sidewalk props: food carts, plant pots, trash piles ----
  const tarpColors2 = [0xa83a3a, 0x3a5a8a, 0x3a8a5a, 0xcfa83a, 0xc26b3a];
  const propPotMat = new THREE.MeshStandardMaterial({ color: 0x6b4a3a, roughness: 0.95 });
  const propLeafMat = new THREE.MeshStandardMaterial({ color: 0x3a6a3a, roughness: 0.8, side: THREE.DoubleSide });
  const propTrashMat = new THREE.MeshStandardMaterial({ color: 0x222222, roughness: 1.0 });
  const propCartBodyMat = new THREE.MeshStandardMaterial({ color: 0xdedede, roughness: 0.7 });
  const propCartPoleMat = new THREE.MeshStandardMaterial({ color: 0x666 });
  const propLeafGeo = new THREE.ConeGeometry(0.15, 0.9, 4);
  const propPotGeo = new THREE.CylinderGeometry(0.32, 0.25, 0.5, 8);
  const propCartBodyGeo = new THREE.BoxGeometry(1.4, 0.9, 0.8);
  const propCartWheelGeo = new THREE.CylinderGeometry(0.16, 0.16, 0.1, 8);
  const propCartPoleGeo = new THREE.CylinderGeometry(0.04, 0.04, 2, 6);
  for (let i = -GRID/2; i < GRID/2; i++) {
    for (let j = -GRID/2; j < GRID/2; j++) {
      const cx = (i + 0.5) * BLOCK;
      const cz = (j + 0.5) * BLOCK;
      const numProps = irand(2, 4);
      for (let n = 0; n < numProps; n++) {
        const side = pick([
          { ax: 'z', sign: +1 }, { ax: 'z', sign: -1 },
          { ax: 'x', sign: +1 }, { ax: 'x', sign: -1 },
        ]);
        const t = rand(-12, 12);
        let px, pz;
        if (side.ax === 'z') {
          px = cx + t;
          pz = cz + side.sign * (15 + rand(-1.5, 1.5));
        } else {
          pz = cz + t;
          px = cx + side.sign * (15 + rand(-1.5, 1.5));
        }
        const propType = irand(0, 3);
        if (propType === 0) {
          // food cart with umbrella
          const cart = new THREE.Group();
          const body = new THREE.Mesh(propCartBodyGeo, propCartBodyMat);
          body.position.y = 0.55; cart.add(body);
          const pole = new THREE.Mesh(propCartPoleGeo, propCartPoleMat);
          pole.position.y = 1.0; cart.add(pole);
          const umbrellaMat = new THREE.MeshStandardMaterial({ color: pick(tarpColors2), roughness: 0.8, side: THREE.DoubleSide });
          const umbrella = new THREE.Mesh(new THREE.ConeGeometry(1.3, 0.5, 8), umbrellaMat);
          umbrella.position.y = 2.0; cart.add(umbrella);
          for (const xx of [-0.5, 0.5]) {
            const w = new THREE.Mesh(propCartWheelGeo, bikeWheelMat);
            w.rotation.z = PI/2; w.position.set(xx, 0.16, 0.45);
            cart.add(w);
          }
          cart.position.set(px, 0, pz);
          cart.rotation.y = rand(0, TAU);
          scene.add(cart);
        } else if (propType === 1 || propType === 3) {
          // plant pot with leaves
          const pot = new THREE.Group();
          const potBody = new THREE.Mesh(propPotGeo, propPotMat);
          potBody.position.y = 0.25; pot.add(potBody);
          for (let k = 0; k < 5; k++) {
            const leaf = new THREE.Mesh(propLeafGeo, propLeafMat);
            leaf.position.y = 0.9;
            leaf.rotation.z = rand(-0.6, 0.6);
            leaf.rotation.x = rand(-0.4, 0.4);
            leaf.rotation.y = k * TAU/5 + rand(-0.2, 0.2);
            pot.add(leaf);
          }
          pot.position.set(px, 0, pz);
          scene.add(pot);
        } else {
          // trash pile — a few small dark boxes
          const tg = new THREE.Group();
          for (let k = 0; k < irand(2, 5); k++) {
            const b = new THREE.Mesh(
              new THREE.BoxGeometry(rand(0.25, 0.5), rand(0.2, 0.4), rand(0.25, 0.5)),
              propTrashMat
            );
            b.position.set(rand(-0.4, 0.4), rand(0.15, 0.3), rand(-0.4, 0.4));
            b.rotation.y = rand(0, TAU);
            tg.add(b);
          }
          tg.position.set(px, 0, pz);
          scene.add(tg);
        }
      }
    }
  }

  // ---- BTS Skytrain elevated track running east-west at z=0 ----
  const pillarMat = new THREE.MeshStandardMaterial({ color: 0x9b9b9b, roughness: 0.85 });
  const beamMat   = new THREE.MeshStandardMaterial({ color: 0x7d7d7d, roughness: 0.85 });
  const pillarGeo = new THREE.CylinderGeometry(1.0, 1.3, 14, 8);
  const pillarM = [];
  for (let x = -HALF + 10; x <= HALF - 10; x += 18) {
    _p.set(x, 7, 0); _q.identity(); _s.set(1, 1, 1);
    pillarM.push(_m.compose(_p, _q, _s).clone());
  }
  addInstanced(pillarGeo, pillarMat, pillarM, true, true); // pillars cast+receive shadow
  const beam = new THREE.Mesh(new THREE.BoxGeometry(HALF*2, 1.2, 6), beamMat);
  beam.position.set(0, 14.5, 0); beam.castShadow = true; scene.add(beam);

  // BTS Skytrain station — elevated platform + canopy + stair tower
  {
    const sx = -50; // station centered above this pillar
    const stationFloorY = 13.6;
    const platformMat = new THREE.MeshStandardMaterial({ color: 0xcfcfcf, roughness: 0.7 });
    const platform = new THREE.Mesh(new THREE.BoxGeometry(22, 0.6, 11), platformMat);
    platform.position.set(sx, stationFloorY, 0); platform.castShadow = true; scene.add(platform);
    // canopy roof
    const canopyMat = new THREE.MeshStandardMaterial({ color: 0x2a7d8e, roughness: 0.5 });
    const canopy = new THREE.Mesh(new THREE.BoxGeometry(23, 0.35, 12), canopyMat);
    canopy.position.set(sx, stationFloorY + 4.5, 0); canopy.castShadow = true; scene.add(canopy);
    // 4 columns supporting canopy
    const colMat = new THREE.MeshStandardMaterial({ color: 0xe8e8e8, roughness: 0.6 });
    for (const cx2 of [sx-9, sx+9]) for (const cz2 of [-4.5, 4.5]) {
      const col = new THREE.Mesh(new THREE.CylinderGeometry(0.25, 0.25, 4.4, 8), colMat);
      col.position.set(cx2, stationFloorY + 2.5, cz2); scene.add(col);
    }
    // side walls (low) on north & south edges of platform
    const sideWallMat = new THREE.MeshStandardMaterial({ color: 0xbbbbbb, roughness: 0.7 });
    const wallN = new THREE.Mesh(new THREE.BoxGeometry(22, 1.1, 0.18), sideWallMat);
    wallN.position.set(sx, stationFloorY + 0.85, 5.5); scene.add(wallN);
    const wallS = new THREE.Mesh(new THREE.BoxGeometry(22, 1.1, 0.18), sideWallMat);
    wallS.position.set(sx, stationFloorY + 0.85, -5.5); scene.add(wallS);
    // stair tower descending to street level on the south side
    const stairMat = new THREE.MeshStandardMaterial({ color: 0xc8c8c8, roughness: 0.85 });
    const stairTower = new THREE.Mesh(new THREE.BoxGeometry(4, stationFloorY, 3), stairMat);
    stairTower.position.set(sx, stationFloorY/2, -8.5); stairTower.castShadow = true; scene.add(stairTower);
    // collision for stair tower so the player can walk against it
    world.buildings.push({
      pos: new THREE.Vector3(sx, stationFloorY/2, -8.5),
      size: new THREE.Vector3(4, stationFloorY, 3),
      mesh: stairTower,
    });
    // station sign
    const stationSign = new THREE.Mesh(
      new THREE.PlaneGeometry(6, 1.0),
      new THREE.MeshBasicMaterial({ color: 0x21f0ff })
    );
    stationSign.position.set(sx, stationFloorY + 5.0, 6.05);
    scene.add(stationSign);
  }

  // ---- Street lamps at intersections ----
  // ~480 lamps. Previously each had its own PointLight (pathological for forward
  // rendering); now the poles and bulb heads are instanced, and the bulbs glow via
  // a shared emissive material that ramps at night instead of being real lights.
  const lampMat = new THREE.MeshStandardMaterial({ color: 0x333333, roughness: 0.7 });
  const bulbMat = new THREE.MeshStandardMaterial({
    color: 0xffd577, emissive: 0xffd577, emissiveIntensity: 0.2, roughness: 0.4,
  });
  G.nightEmissive.push({ mat: bulbMat, dayIntensity: 0.2, nightIntensity: 1.4 });
  const lampPoleGeo = new THREE.CylinderGeometry(0.12, 0.15, 6, 6);
  const lampBulbGeo = new THREE.SphereGeometry(0.35, 8, 8);
  const lampPoleM = [], lampBulbM = [];
  for (const inter of world.intersections) {
    for (const offset of [[-3,-3],[3,-3],[-3,3],[3,3]]) {
      const x = inter.x + offset[0]*1.2, z = inter.z + offset[1]*1.2;
      _q.identity(); _s.set(1, 1, 1);
      _p.set(x, 3, z); lampPoleM.push(_m.compose(_p, _q, _s).clone());
      _p.set(x, 6, z); lampBulbM.push(_m.compose(_p, _q, _s).clone());
    }
  }
  addInstanced(lampPoleGeo, lampMat, lampPoleM, false, false);
  addInstanced(lampBulbGeo, bulbMat, lampBulbM, false, false);

  // ---- 7-Elevens (the door chime is non-negotiable) ----
  // Place a couple of obvious 7-Eleven storefronts.
  const elevenSpots = [
    new THREE.Vector3( 80, 0,  80),
    new THREE.Vector3(-90, 0,  30),
    new THREE.Vector3(  0, 0, -110),
    new THREE.Vector3(120, 0, -40),
  ];
  for (const p of elevenSpots) {
    const store = new THREE.Group();
    const body = new THREE.Mesh(new THREE.BoxGeometry(10, 4, 8), new THREE.MeshStandardMaterial({ color: 0xf3f3f3, roughness: 0.6 }));
    body.position.y = 2; store.add(body);
    const sign = new THREE.Mesh(
      new THREE.PlaneGeometry(8, 1.4),
      new THREE.MeshBasicMaterial({ color: 0xff5a23 })
    );
    sign.position.set(0, 3.8, 4.05); store.add(sign);
    const sign2 = new THREE.Mesh(
      new THREE.PlaneGeometry(8, 1.4),
      new THREE.MeshBasicMaterial({ color: 0x21bb6a })
    );
    sign2.position.set(0, 2.4, 4.05); store.add(sign2);
    const door = new THREE.Mesh(new THREE.PlaneGeometry(2.4, 2.6), new THREE.MeshBasicMaterial({ color: 0x113355 }));
    door.position.set(0, 1.3, 4.06); store.add(door);
    const pl = new THREE.PointLight(0xff8855, 0.8, 14, 2);
    pl.position.set(0, 3.5, 5); store.add(pl);
    store.position.copy(p);
    scene.add(store);
    world.sevenElevens.push({ pos: p.clone(), group: store, chimed: 0 });
  }

  // ---- Shrines (spirit houses) — small gold structures ----
  for (let n = 0; n < 6; n++) {
    const sp = new THREE.Vector3(rand(-HALF+40, HALF-40), 0, rand(-HALF+40, HALF-40));
    // snap inside a block, not on a road
    sp.x = Math.round(sp.x / BLOCK) * BLOCK + (sp.x < 0 ? BLOCK/2-15 : -BLOCK/2+15);
    sp.z = Math.round(sp.z / BLOCK) * BLOCK + (sp.z < 0 ? BLOCK/2-15 : -BLOCK/2+15);
    const shrine = new THREE.Group();
    const base = new THREE.Mesh(new THREE.BoxGeometry(1.5, 1.2, 1.5), new THREE.MeshStandardMaterial({ color: 0xc6a056, roughness: 0.4, metalness: 0.6 }));
    base.position.y = 0.6; shrine.add(base);
    const roof = new THREE.Mesh(new THREE.ConeGeometry(1.4, 1.2, 4), new THREE.MeshStandardMaterial({ color: 0xffcf4a, metalness: 0.7, roughness: 0.3 }));
    roof.position.y = 1.8; roof.rotation.y = PI/4; shrine.add(roof);
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 2, 6), new THREE.MeshStandardMaterial({ color: 0x884422 }));
    pole.position.y = 1; shrine.add(pole);
    const pl = new THREE.PointLight(0xffcf4a, 0.6, 10, 2);
    pl.position.y = 2; shrine.add(pl);
    shrine.position.copy(sp);
    scene.add(shrine);
  }

  // ---- Mission marker: Uncle Seng's gold shop (yellow pillar of light) ----
  const goldShop = new THREE.Group();
  const shopBody = new THREE.Mesh(
    new THREE.BoxGeometry(12, 6, 8),
    new THREE.MeshStandardMaterial({ color: 0xb02020, roughness: 0.5 })
  );
  shopBody.position.y = 3; goldShop.add(shopBody);
  const shopSign = new THREE.Mesh(new THREE.PlaneGeometry(10, 1.8), new THREE.MeshBasicMaterial({ color: 0xffcf4a }));
  shopSign.position.set(0, 5.6, 4.05); goldShop.add(shopSign);
  const goldDoor = new THREE.Mesh(new THREE.PlaneGeometry(2.6, 3.2), new THREE.MeshBasicMaterial({ color: 0x1a1a1a }));
  goldDoor.position.set(0, 1.6, 4.06); goldShop.add(goldDoor);
  const goldGlow = new THREE.PointLight(0xffcf4a, 1.4, 22, 2); goldGlow.position.set(0, 4, 6); goldShop.add(goldGlow);
  const goldShopPos = new THREE.Vector3(-160, 0, -160);
  goldShop.position.copy(goldShopPos);
  scene.add(goldShop);
  world.poi.goldShop = goldShopPos.clone();

  // Pillar of light to attract player
  const pillarBeam = new THREE.Mesh(
    new THREE.CylinderGeometry(1.2, 1.2, 80, 16, 1, true),
    new THREE.MeshBasicMaterial({ color: 0xffcf4a, transparent: true, opacity: 0.18, side: THREE.DoubleSide, depthWrite: false })
  );
  pillarBeam.position.copy(goldShopPos); pillarBeam.position.y = 40;
  scene.add(pillarBeam);
  world.poi.goldShopBeam = pillarBeam;

  // ---- Hua Lamphong station marker (player spawn) ----
  // Just a small platform with a teal canopy at the spawn point.
  const station = new THREE.Group();
  const platform = new THREE.Mesh(new THREE.BoxGeometry(16, 0.4, 8), new THREE.MeshStandardMaterial({ color: 0xbfa676, roughness: 0.8 }));
  platform.position.y = 0.2; station.add(platform);
  const canopy = new THREE.Mesh(new THREE.BoxGeometry(16, 0.3, 8), new THREE.MeshStandardMaterial({ color: 0x2a8e8e, roughness: 0.5 }));
  canopy.position.y = 4.5; station.add(canopy);
  for (const dx of [-7, 7]) for (const dz of [-3.5, 3.5]) {
    const col = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.2, 4.3, 6), new THREE.MeshStandardMaterial({ color: 0xeeeeee }));
    col.position.set(dx, 2.3, dz); station.add(col);
  }
  station.position.copy(world.spawns.player);
  station.position.y = 0;
  scene.add(station);

  // ---- Distant city ring: low-detail silhouettes outside the playable bounds ----
  // Fakes a bigger world. Just unlit boxes in a 250..500m band from origin.
  const ringColors = [0x4a4a55, 0x5a5560, 0x6a5a45, 0x504848, 0x3f4045, 0x55505a, 0x6a6055];
  const ringMats = ringColors.map(c => new THREE.MeshStandardMaterial({ color: c, roughness: 0.95 }));
  const RING_INNER = HALF + 30;   // start just past the play area
  const RING_OUTER = HALF + 280;  // ~280m of fake skyline depth
  const RING_COUNT = 380;
  // Boxes + caps + landmark tower bodies are all unit cubes scaled per instance.
  // Accumulate one matrix array per ring material so each color is one InstancedMesh.
  const ringBoxGeo = new THREE.BoxGeometry(1, 1, 1);
  const ringBoxM = ringMats.map(() => []);
  for (let n = 0; n < RING_COUNT; n++) {
    const ang = rand(0, TAU);
    const r = rand(RING_INNER, RING_OUTER);
    const x = Math.cos(ang) * r;
    const z = Math.sin(ang) * r;
    // height: bias toward tall in the inner band (foreground skyline) and short on the far edge
    const tDist = (r - RING_INNER) / (RING_OUTER - RING_INNER);
    const h = lerp(rand(35, 110), rand(15, 50), tDist);
    const w = rand(10, 22);
    const d = rand(10, 22);
    const mi = irand(0, ringMats.length - 1);
    _q.identity();
    _p.set(x, h/2, z); _s.set(w, h, d);
    ringBoxM[mi].push(_m.compose(_p, _q, _s).clone());
    // occasional darker rooftop cap for silhouette variation
    if (Math.random() < 0.35) {
      const capH = rand(2, 6);
      const capW = w * rand(0.5, 0.85);
      const capD = d * rand(0.5, 0.85);
      _p.set(x, h + capH/2, z); _s.set(capW, capH, capD);
      ringBoxM[mi].push(_m.compose(_p, _q, _s).clone());
    }
  }
  // A couple of landmark towers — taller than everything else (bodies fold into the
  // material[0] box instances; the pointed cone tips stay as a few plain meshes).
  for (let n = 0; n < 4; n++) {
    const ang = rand(0, TAU);
    const r = rand(HALF + 80, HALF + 200);
    const x = Math.cos(ang) * r;
    const z = Math.sin(ang) * r;
    const h = rand(180, 260);
    const w = rand(14, 22);
    const d = rand(14, 22);
    _q.identity();
    _p.set(x, h/2, z); _s.set(w, h, d);
    ringBoxM[0].push(_m.compose(_p, _q, _s).clone());
    // pointed cap
    const tipH = rand(6, 14);
    const tip = new THREE.Mesh(new THREE.ConeGeometry(w*0.4, tipH, 4), ringMats[0]);
    tip.position.set(x, h + tipH/2, z);
    tip.rotation.y = PI/4;
    scene.add(tip);
  }
  // Build the distant-ring InstancedMeshes (no shadows on distant ring — perf)
  for (let mi = 0; mi < ringMats.length; mi++) {
    addInstanced(ringBoxGeo, ringMats[mi], ringBoxM[mi], false, false);
  }

  // ---- Render minimap base (top-down 2D snapshot of roads/landmarks) ----
  world.minimap = makeMinimapBase(world);

  return world;
}

function makeWindowTexture() {
  const c = document.createElement('canvas'); c.width = 64; c.height = 128;
  const g = c.getContext('2d');
  g.fillStyle = '#1a1d22'; g.fillRect(0,0,64,128);
  for (let y = 6; y < 128; y += 10) {
    for (let x = 4; x < 64; x += 10) {
      const lit = Math.random() < 0.55;
      g.fillStyle = lit ? `rgb(${200+Math.random()*55|0},${180+Math.random()*60|0},${120+Math.random()*80|0})` : '#0e1014';
      g.fillRect(x, y, 6, 6);
    }
  }
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  return tex;
}

function makeMinimapBase(world) {
  const SIZE = 256;
  const c = document.createElement('canvas'); c.width = SIZE; c.height = SIZE;
  const g = c.getContext('2d');
  // background
  g.fillStyle = '#1a1d22'; g.fillRect(0,0,SIZE,SIZE);
  // blocks
  g.fillStyle = '#23262b';
  for (let i = -GRID/2; i < GRID/2; i++) {
    for (let j = -GRID/2; j < GRID/2; j++) {
      const x = mapW(i*BLOCK + BLOCK/2 - (BLOCK-12)/2);
      const y = mapW(j*BLOCK + BLOCK/2 - (BLOCK-12)/2);
      const s = (BLOCK-12) * (SIZE/(HALF*2));
      g.fillRect(x, y, s, s);
    }
  }
  // roads
  g.strokeStyle = '#ffcf4a'; g.lineWidth = 3;
  for (let i = -GRID/2; i <= GRID/2; i++) {
    g.beginPath();
    g.moveTo(mapW(-HALF), mapW(i*BLOCK)); g.lineTo(mapW(HALF), mapW(i*BLOCK)); g.stroke();
    g.beginPath();
    g.moveTo(mapW(i*BLOCK), mapW(-HALF)); g.lineTo(mapW(i*BLOCK), mapW(HALF)); g.stroke();
  }
  // BTS line
  g.strokeStyle = '#21f0ff'; g.lineWidth = 2; g.setLineDash([4,3]);
  g.beginPath(); g.moveTo(mapW(-HALF), mapW(0)); g.lineTo(mapW(HALF), mapW(0)); g.stroke();
  g.setLineDash([]);
  return c;

  function mapW(v) { return (v + HALF) * (SIZE / (HALF*2)); }
}

// =============================================================================
// 4. PLAYER + CAMERA
// =============================================================================

function makePlayer(scene) {
  const group = new THREE.Group();
  // body capsule
  const bodyMat = new THREE.MeshStandardMaterial({ color: 0xd44b3b, roughness: 0.7 });
  const pantsMat = new THREE.MeshStandardMaterial({ color: 0x232a35, roughness: 0.8 });
  const skinMat = new THREE.MeshStandardMaterial({ color: 0xc69472, roughness: 0.8 });

  const torso = new THREE.Mesh(new THREE.CapsuleGeometry(0.34, 0.6, 4, 8), bodyMat);
  torso.position.y = 1.05; torso.castShadow = true; group.add(torso);
  const legs = new THREE.Mesh(new THREE.CapsuleGeometry(0.28, 0.55, 4, 8), pantsMat);
  legs.position.y = 0.45; legs.castShadow = true; group.add(legs);
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.22, 12, 10), skinMat);
  head.position.y = 1.65; head.castShadow = true; group.add(head);

  // arms (used for swinging while punching)
  const armL = new THREE.Mesh(new THREE.CapsuleGeometry(0.1, 0.5, 4, 6), bodyMat);
  armL.position.set(-0.42, 1.15, 0); armL.castShadow = true; group.add(armL);
  const armR = new THREE.Mesh(new THREE.CapsuleGeometry(0.1, 0.5, 4, 6), bodyMat);
  armR.position.set( 0.42, 1.15, 0); armR.castShadow = true; group.add(armR);

  // pistol model (hidden by default)
  const pistol = new THREE.Group();
  const gunBody = new THREE.Mesh(new THREE.BoxGeometry(0.10, 0.12, 0.22), new THREE.MeshStandardMaterial({ color: 0x222, metalness: 0.7, roughness: 0.4 }));
  pistol.add(gunBody);
  const gunGrip = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.18, 0.10), new THREE.MeshStandardMaterial({ color: 0x111 }));
  gunGrip.position.set(-0.02, -0.13, 0); pistol.add(gunGrip);
  pistol.visible = false;
  group.add(pistol);

  group.position.copy(G.world.spawns.player);
  scene.add(group);

  return {
    group, torso, legs, head, armL, armR, pistol,
    velocity: new THREE.Vector3(),
    yaw: 0, pitch: 0,
    grounded: true,
    hp: 100, hpMax: 100,
    stam: 100, stamMax: 100,
    armor: 0, armorMax: 100,
    sprintLock: false,
    weapons: { fists: true, pistol: false },
    activeWeapon: 'fists',
    pistolAmmo: 0, pistolMag: 12, pistolReserve: 36,
    inVehicle: null,
    // combat anim state
    attackTimer: 0, attackKind: null, attackCooldown: 0,
    blocking: false,
    // hit recovery
    hitFlashT: 0,
    deadT: 0,
    // bribe
    canBribeUntil: 0,
  };
}

function makeCamera() {
  const cam = new THREE.PerspectiveCamera(72, window.innerWidth / window.innerHeight, 0.1, 2200);
  cam.position.set(0, 5, 12);
  return {
    cam,
    yaw: 0, pitch: -0.15,
    distance: 4.5, height: 1.9, targetDistance: 4.5,
    shake: 0,
  };
}

// =============================================================================
// 5. VEHICLES
// =============================================================================

function makeVehicleMesh(kind) {
  const g = new THREE.Group();
  g.userData.kind = kind;
  if (kind === 'bike') {
    const frame = new THREE.Mesh(
      new THREE.BoxGeometry(0.5, 0.4, 1.6),
      new THREE.MeshStandardMaterial({ color: 0xd6363c, roughness: 0.5, metalness: 0.4 })
    );
    frame.position.y = 0.5; g.add(frame);
    const seat = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.1, 0.6), new THREE.MeshStandardMaterial({ color: 0x222 }));
    seat.position.set(0, 0.78, -0.05); g.add(seat);
    const wheelMat = new THREE.MeshStandardMaterial({ color: 0x111, roughness: 0.8 });
    const wF = new THREE.Mesh(new THREE.TorusGeometry(0.32, 0.08, 8, 16), wheelMat);
    wF.rotation.y = PI/2; wF.position.set(0, 0.32, 0.8); g.add(wF);
    const wR = wF.clone(); wR.position.z = -0.8; g.add(wR);
    const handle = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.06, 0.08), new THREE.MeshStandardMaterial({ color: 0x111 }));
    handle.position.set(0, 1.0, 0.7); g.add(handle);
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.13, 8, 8), new THREE.MeshBasicMaterial({ color: 0xffffaa }));
    head.position.set(0, 0.85, 0.9); g.add(head);
    g.userData.dims = { L: 1.9, W: 0.7, H: 1.2 };
    g.userData.spec = { topSpeed: 22, accel: 14, brake: 18, turn: 2.4, mass: 180, kind: 'bike' };
  } else if (kind === 'tuktuk') {
    const body = new THREE.Mesh(new THREE.BoxGeometry(1.4, 1.2, 2.4), new THREE.MeshStandardMaterial({ color: 0x1e9a5e, roughness: 0.5 }));
    body.position.y = 0.85; g.add(body);
    const roof = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.1, 2.2), new THREE.MeshStandardMaterial({ color: 0xffcf4a, roughness: 0.5 }));
    roof.position.y = 1.55; g.add(roof);
    const windshield = new THREE.Mesh(new THREE.PlaneGeometry(1.3, 0.7), new THREE.MeshBasicMaterial({ color: 0x223344, transparent:true, opacity: 0.65 }));
    windshield.position.set(0, 1.2, 1.25); g.add(windshield);
    const wheelMat = new THREE.MeshStandardMaterial({ color: 0x111 });
    const wF = new THREE.Mesh(new THREE.CylinderGeometry(0.32, 0.32, 0.18, 12), wheelMat);
    wF.rotation.z = PI/2; wF.position.set(0, 0.32, 1.0); g.add(wF);
    for (const x of [-0.65, 0.65]) {
      const wR = new THREE.Mesh(new THREE.CylinderGeometry(0.32, 0.32, 0.18, 12), wheelMat);
      wR.rotation.z = PI/2; wR.position.set(x, 0.32, -0.9); g.add(wR);
    }
    g.userData.dims = { L: 2.6, W: 1.5, H: 1.7 };
    g.userData.spec = { topSpeed: 16, accel: 9, brake: 14, turn: 2.0, mass: 350, kind: 'tuktuk' };
  } else if (kind === 'hilux') {
    const body = new THREE.Mesh(new THREE.BoxGeometry(1.9, 1.0, 3.5), new THREE.MeshStandardMaterial({ color: 0x2a3a55, roughness: 0.7 }));
    body.position.y = 0.9; g.add(body);
    const cab = new THREE.Mesh(new THREE.BoxGeometry(1.85, 0.8, 1.6), new THREE.MeshStandardMaterial({ color: 0x2a3a55, roughness: 0.7 }));
    cab.position.set(0, 1.65, 0.4); g.add(cab);
    const bed = new THREE.Mesh(new THREE.BoxGeometry(1.85, 0.4, 1.6), new THREE.MeshStandardMaterial({ color: 0x1a2335 }));
    bed.position.set(0, 1.25, -1.0); g.add(bed);
    const windshield = new THREE.Mesh(new THREE.PlaneGeometry(1.7, 0.6), new THREE.MeshBasicMaterial({ color: 0x223344, transparent:true, opacity: 0.65 }));
    windshield.position.set(0, 1.85, 1.21); g.add(windshield);
    const wheelMat = new THREE.MeshStandardMaterial({ color: 0x111 });
    for (const z of [-1.3, 1.3]) for (const x of [-0.9, 0.9]) {
      const w = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.42, 0.3, 14), wheelMat);
      w.rotation.z = PI/2; w.position.set(x, 0.42, z); g.add(w);
    }
    g.userData.dims = { L: 3.8, W: 2.0, H: 2.2 };
    g.userData.spec = { topSpeed: 26, accel: 12, brake: 18, turn: 1.6, mass: 1800, kind: 'hilux' };
  } else if (kind === 'cop') {
    // cop = isuzu d-max — orange hilux variant with blue/red light bar
    const body = new THREE.Mesh(new THREE.BoxGeometry(1.9, 1.0, 3.5), new THREE.MeshStandardMaterial({ color: 0x1a3a6a, roughness: 0.65 }));
    body.position.y = 0.9; g.add(body);
    const cab = new THREE.Mesh(new THREE.BoxGeometry(1.85, 0.8, 1.6), new THREE.MeshStandardMaterial({ color: 0xf0f0f0, roughness: 0.65 }));
    cab.position.set(0, 1.65, 0.4); g.add(cab);
    const bed = new THREE.Mesh(new THREE.BoxGeometry(1.85, 0.4, 1.6), new THREE.MeshStandardMaterial({ color: 0x101a2a }));
    bed.position.set(0, 1.25, -1.0); g.add(bed);
    const bar = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.18, 0.4), new THREE.MeshStandardMaterial({ color: 0x222 }));
    bar.position.set(0, 2.1, 0.4); g.add(bar);
    const lampR = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.1, 0.3), new THREE.MeshBasicMaterial({ color: 0xff2222 }));
    lampR.position.set(-0.4, 2.2, 0.4); g.add(lampR);
    const lampB = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.1, 0.3), new THREE.MeshBasicMaterial({ color: 0x2266ff }));
    lampB.position.set( 0.4, 2.2, 0.4); g.add(lampB);
    g.userData.copLamps = [lampR, lampB];
    const wheelMat = new THREE.MeshStandardMaterial({ color: 0x111 });
    for (const z of [-1.3, 1.3]) for (const x of [-0.9, 0.9]) {
      const w = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.42, 0.3, 14), wheelMat);
      w.rotation.z = PI/2; w.position.set(x, 0.42, z); g.add(w);
    }
    g.userData.dims = { L: 3.8, W: 2.0, H: 2.2 };
    g.userData.spec = { topSpeed: 28, accel: 13, brake: 18, turn: 1.7, mass: 1800, kind: 'cop' };
  } else if (kind === 'camry' || kind === 'sedan') {
    const color = kind === 'sedan' ? pick([0x222, 0xf5f5f5, 0xc23a3a, 0x335a99, 0x8c8c8c]) : 0xeeeeee;
    const body = new THREE.Mesh(new THREE.BoxGeometry(1.7, 0.9, 3.6), new THREE.MeshStandardMaterial({ color, roughness: 0.55, metalness: 0.4 }));
    body.position.y = 0.7; g.add(body);
    const cab = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.65, 1.5), new THREE.MeshStandardMaterial({ color, roughness: 0.5, metalness: 0.4 }));
    cab.position.set(0, 1.35, 0.1); g.add(cab);
    const windshield = new THREE.Mesh(new THREE.PlaneGeometry(1.4, 0.55), new THREE.MeshBasicMaterial({ color: 0x223344, transparent:true, opacity: 0.6 }));
    windshield.position.set(0, 1.55, 0.86); g.add(windshield);
    const wheelMat = new THREE.MeshStandardMaterial({ color: 0x111 });
    for (const z of [-1.2, 1.2]) for (const x of [-0.78, 0.78]) {
      const w = new THREE.Mesh(new THREE.CylinderGeometry(0.32, 0.32, 0.22, 12), wheelMat);
      w.rotation.z = PI/2; w.position.set(x, 0.32, z); g.add(w);
    }
    g.userData.dims = { L: 3.8, W: 1.8, H: 1.6 };
    g.userData.spec = { topSpeed: 24, accel: 11, brake: 16, turn: 1.7, mass: 1500, kind };
  }
  return g;
}

function makeVehicle(kind, scene) {
  const mesh = makeVehicleMesh(kind);
  scene.add(mesh);
  const spec = mesh.userData.spec;
  const veh = {
    kind, mesh, spec,
    pos: mesh.position,
    vel: 0,            // forward speed (m/s)
    heading: 0,        // yaw radians
    steerAngle: 0,
    hp: 100,
    smoke: null, fire: null,
    driver: null,      // 'player' | npc obj | null
    npc: null,
    audio: null,
    isCop: kind === 'cop',
    aiTargetNode: null,
    aiState: 'cruising',
    siren: false,
    targetVel: 0,
    boundsHalf: { x: mesh.userData.dims.W * 0.5, z: mesh.userData.dims.L * 0.5 },
  };
  G.vehicles.push(veh);
  return veh;
}

// =============================================================================
// 6. NPCs — pedestrians, soi dogs, cops
// =============================================================================

function makePedMesh() {
  const g = new THREE.Group();
  const shirtColor = pick([0xffffff, 0xeeeeee, 0xdeb887, 0x223344, 0x556677, 0xb04040, 0xddcc88]);
  const pantsColor = pick([0x222, 0x111, 0x445566, 0x804020]);
  const skin = pick([0xc69472, 0xb88060, 0xd6a785, 0xa57755]);
  const torso = new THREE.Mesh(new THREE.CapsuleGeometry(0.3, 0.55, 4, 6), new THREE.MeshStandardMaterial({ color: shirtColor, roughness: 0.8 }));
  torso.position.y = 0.95; g.add(torso);
  const legs = new THREE.Mesh(new THREE.CapsuleGeometry(0.24, 0.5, 4, 6), new THREE.MeshStandardMaterial({ color: pantsColor }));
  legs.position.y = 0.4; g.add(legs);
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.2, 10, 8), new THREE.MeshStandardMaterial({ color: skin }));
  head.position.y = 1.5; g.add(head);
  g.userData.parts = { torso, legs, head };
  g.castShadow = true;
  return g;
}

function makeDogMesh() {
  const g = new THREE.Group();
  const body = new THREE.Mesh(new THREE.BoxGeometry(0.32, 0.28, 0.7), new THREE.MeshStandardMaterial({ color: pick([0xc8a370, 0x8c6a3a, 0x4a3a2a, 0xdac199]) }));
  body.position.y = 0.32; g.add(body);
  const head = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.22, 0.26), body.material);
  head.position.set(0, 0.42, 0.42); g.add(head);
  const tail = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.08, 0.3), body.material);
  tail.position.set(0, 0.4, -0.4); g.add(tail);
  for (const z of [-0.2, 0.2]) for (const x of [-0.12, 0.12]) {
    const leg = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.22, 0.08), new THREE.MeshStandardMaterial({ color: 0x2a2a2a }));
    leg.position.set(x, 0.11, z); g.add(leg);
  }
  return g;
}

function spawnPed(scene, pos) {
  const m = makePedMesh();
  m.position.copy(pos);
  m.userData.heading = rand(0, TAU);
  scene.add(m);
  const ped = {
    mesh: m,
    heading: m.userData.heading,
    speed: rand(0.9, 1.7),
    state: 'walking',
    waitT: 0,
    panicT: 0,
    hp: 30,
    laneOffset: rand(-1.2, 1.2),
    targetEdgeT: rand(0,1),
    cellI: irand(-GRID/2, GRID/2-1),
    cellJ: irand(-GRID/2, GRID/2-1),
    side: irand(0,3),
    dead: false,
  };
  G.peds.push(ped);
  return ped;
}

function spawnDog(scene, pos) {
  const m = makeDogMesh();
  m.position.copy(pos);
  scene.add(m);
  const dog = {
    mesh: m,
    heading: rand(0, TAU),
    speed: rand(0.6, 1.0),
    state: 'lying',       // lying | walking | fleeing | barking
    timer: rand(2, 7),
    hp: 20,
  };
  G.dogs.push(dog);
  return dog;
}

function spawnTraffic(scene) {
  // Each road segment can hold some cars. We sample edges and place vehicles.
  const kinds = ['camry','camry','camry','sedan','sedan','tuktuk','hilux','bike','bike'];
  for (let n = 0; n < 28; n++) {
    const kind = pick(kinds);
    const v = makeVehicle(kind, scene);
    // pick a random horizontal or vertical road
    const isEW = Math.random() < 0.5;
    const lane = irand(-GRID/2, GRID/2);
    const t = rand(-HALF + 10, HALF - 10);
    if (isEW) { v.pos.set(t, 0, lane * BLOCK + (Math.random()<0.5 ? -2.5 : 2.5)); v.heading = Math.random()<0.5 ? 0 : PI; }
    else      { v.pos.set(lane * BLOCK + (Math.random()<0.5 ? -2.5 : 2.5), 0, t); v.heading = Math.random()<0.5 ? PI/2 : -PI/2; }
    v.mesh.position.copy(v.pos);
    v.mesh.rotation.y = v.heading;
    v.npc = {
      kind: 'traffic',
      // assign nearest grid intersection ahead as the immediate target
      targetIdx: null,
      cruiseSpeed: rand(8, 14) * (kind==='bike'?1.2:1) * (kind==='tuktuk'?0.7:1),
      reactionT: 0,
      stopT: 0,
      honkCooldown: rand(5, 20),
    };
    v.vel = v.npc.cruiseSpeed;
  }
}

function spawnPeds(scene, n) {
  for (let i = 0; i < n; i++) {
    const blockI = irand(-GRID/2, GRID/2-1);
    const blockJ = irand(-GRID/2, GRID/2-1);
    const cx = (blockI + 0.5) * BLOCK + rand(-BLOCK/2 + ROAD_W()/2, BLOCK/2 - ROAD_W()/2);
    const cz = (blockJ + 0.5) * BLOCK + rand(-BLOCK/2 + ROAD_W()/2, BLOCK/2 - ROAD_W()/2);
    spawnPed(scene, new THREE.Vector3(cx, 0, cz));
  }
}

function ROAD_W() { return 12; }

function spawnDogs(scene, n) {
  for (let i = 0; i < n; i++) {
    spawnDog(scene, new THREE.Vector3(rand(-HALF+20, HALF-20), 0, rand(-HALF+20, HALF-20)));
  }
}

// =============================================================================
// 7. RAIN PARTICLES
// =============================================================================

function makeRain(scene) {
  const N = 1200;
  const positions = new Float32Array(N * 3);
  for (let i = 0; i < N; i++) {
    positions[i*3+0] = rand(-60, 60);
    positions[i*3+1] = rand(0, 40);
    positions[i*3+2] = rand(-60, 60);
  }
  const geom = new THREE.BufferGeometry();
  geom.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  const mat = new THREE.PointsMaterial({ color: 0xaaccff, size: 0.08, transparent: true, opacity: 0.0, depthWrite: false });
  const pts = new THREE.Points(geom, mat);
  pts.frustumCulled = false;
  scene.add(pts);
  return {
    points: pts, mat, N,
    update(dt, playerPos, strength) {
      const fall = 28 * dt;
      const arr = pts.geometry.attributes.position.array;
      for (let i = 0; i < N; i++) {
        arr[i*3+1] -= fall;
        if (arr[i*3+1] < 0) {
          arr[i*3+0] = playerPos.x + rand(-50, 50);
          arr[i*3+1] = rand(20, 40);
          arr[i*3+2] = playerPos.z + rand(-50, 50);
        }
      }
      pts.geometry.attributes.position.needsUpdate = true;
      pts.position.set(0, 0, 0);
      mat.opacity = lerp(mat.opacity, strength * 0.55, 0.05);
    }
  };
}

// =============================================================================
// 8. ENGINE / SCENE INIT
// =============================================================================

async function init() {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x1a1a26);
  scene.fog = new THREE.FogExp2(0x556677, 0.0015);
  G.scene = scene;

  const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.0;
  document.getElementById('app').appendChild(renderer.domElement);
  G.renderer = renderer;

  // Sun (directional light)
  const sun = new THREE.DirectionalLight(0xffe0a0, 1.3);
  sun.position.set(80, 100, 40);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  const d = 80;
  sun.shadow.camera.left = -d; sun.shadow.camera.right = d;
  sun.shadow.camera.top = d; sun.shadow.camera.bottom = -d;
  sun.shadow.camera.near = 1; sun.shadow.camera.far = 300;
  sun.shadow.bias = -0.0008;
  scene.add(sun);
  G.sun = sun;

  // Hemisphere fill
  const hemi = new THREE.HemisphereLight(0xa8c7ff, 0x33271a, 0.55);
  scene.add(hemi);
  G.hemi = hemi;

  // Ambient at night
  const amb = new THREE.AmbientLight(0x223040, 0.15);
  scene.add(amb);
  G.amb = amb;

  // Camera
  const camRig = makeCamera();
  G.camera = camRig.cam;
  G.camRig = camRig;
  window.addEventListener('resize', () => {
    camRig.cam.aspect = window.innerWidth / window.innerHeight;
    camRig.cam.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
  });

  // Audio
  G.audio = makeAudio();

  // Loading bar
  setProgress(20);

  // World
  G.world = buildWorld(scene);
  setProgress(60);

  // Player
  G.player = makePlayer(scene);
  setProgress(72);

  // Spawn vehicles, peds, dogs
  spawnTraffic(scene);
  spawnPeds(scene, 60);
  spawnDogs(scene, 16);
  setProgress(88);

  // A parked motorbike right next to the player so they can grab it immediately
  const bike = makeVehicle('bike', scene);
  bike.pos.set(G.world.spawns.player.x + 5, 0, G.world.spawns.player.z + 1);
  bike.heading = -PI/2;
  bike.vel = 0;
  bike.mesh.position.copy(bike.pos);
  bike.mesh.rotation.y = bike.heading;
  bike.npc = null; // unmanned

  // Park one more nearby — a tuk-tuk
  const tuk = makeVehicle('tuktuk', scene);
  tuk.pos.set(G.world.spawns.player.x - 7, 0, G.world.spawns.player.z + 1);
  tuk.heading = PI/2;
  tuk.mesh.position.copy(tuk.pos); tuk.mesh.rotation.y = tuk.heading;
  tuk.npc = null;

  // Rain
  G.rain = makeRain(scene);

  // Bullets pool
  G.bulletGeom = new THREE.SphereGeometry(0.06, 6, 6);
  G.bulletMat = new THREE.MeshBasicMaterial({ color: 0xffeebb });

  // HUD bind
  G.hud = bindHud();

  // Mission
  G.mission = makeMissionSystem();
  G.mission.start('welcome');

  // Input
  G.input = makeInput();

  // Click anywhere → request pointer lock
  renderer.domElement.addEventListener('click', () => {
    if (G.state === 'playing' && !G.input.pointerLocked) G.input.requestLock();
    if (G.audio.ctx.state === 'suspended') G.audio.ctx.resume();
  });

  // Tab → map zoom (placeholder)
  setProgress(100);

  // Reveal start button once everything is ready
  const startBtn = document.getElementById('startbtn');
  startBtn.classList.add('ready');
  startBtn.addEventListener('click', () => {
    document.getElementById('loading').style.opacity = '0';
    setTimeout(() => document.getElementById('loading').style.display = 'none', 800);
    G.state = 'playing';
    G.input.requestLock();
    if (G.audio.ctx.state === 'suspended') G.audio.ctx.resume();
    G.audio.bell();   // dawn bell to set tone
  });

  // Start loop
  G.clock = new THREE.Clock();
  loop();
}

function setProgress(p) {
  const bar = document.getElementById('loadbar');
  if (bar) bar.style.width = p + '%';
}

// =============================================================================
// 9. HUD BINDINGS
// =============================================================================

function bindHud() {
  const minimap = document.getElementById('minimap');
  const mctx = minimap.getContext('2d');
  const subtitle = document.getElementById('subtitle');
  const subEn = document.getElementById('sub-en');
  const subTh = document.getElementById('sub-th');
  const promptEl = document.getElementById('prompt');
  const notif = document.getElementById('notif');
  const phone = document.getElementById('phone');
  const crosshair = document.getElementById('crosshair');
  let subT = 0, promptT = 0, notifT = 0;

  function setStars(n) {
    const stars = document.getElementById('stars');
    stars.innerHTML = '★★★★★'.split('').map((s, i) => `<span class="${i < n ? 'on' : ''}">${s}</span>`).join('');
  }
  function setCash(c) {
    document.getElementById('cash').textContent = Math.floor(c).toLocaleString();
    document.getElementById('ph-cash').textContent = Math.floor(c).toLocaleString();
  }
  function setBars(hp, ar, st) {
    document.getElementById('hp-fill').style.width = Math.max(0, hp) + '%';
    document.getElementById('ar-fill').style.width = Math.max(0, ar) + '%';
    document.getElementById('st-fill').style.width = Math.max(0, st) + '%';
  }
  function setAmmo(line, sub) {
    document.getElementById('ammo-line').textContent = line;
    document.getElementById('ammo-sub').textContent = sub;
  }
  function showSubtitle(en, th, dur=4) {
    subEn.textContent = en; subTh.textContent = th || '';
    subtitle.classList.add('show');
    subT = dur;
  }
  function showPrompt(html, dur=1.5) {
    promptEl.innerHTML = html;
    promptEl.classList.add('show');
    promptT = dur;
  }
  function showNotif(text, dur=2.5) {
    notif.textContent = text;
    notif.classList.add('show');
    notifT = dur;
  }
  function setMissionText(t) { document.getElementById('ph-mission').textContent = t; }
  function setClock(s) { document.getElementById('clock').textContent = s; document.getElementById('ph-time').textContent = s; }
  function setWeather(t) { document.getElementById('weather-tag').textContent = t; }
  function setCrosshair(show) { crosshair.classList.toggle('show', !!show); }
  function togglePhone(open) {
    if (open == null) phone.classList.toggle('open');
    else phone.classList.toggle('open', open);
  }
  function update(dt) {
    if (subT > 0) { subT -= dt; if (subT <= 0) subtitle.classList.remove('show'); }
    if (promptT > 0) { promptT -= dt; if (promptT <= 0) promptEl.classList.remove('show'); }
    if (notifT > 0) { notifT -= dt; if (notifT <= 0) notif.classList.remove('show'); }
  }
  function drawMinimap(player) {
    // draw base
    mctx.clearRect(0,0,256,256);
    // center the world on the player by translating
    const ppx = (player.group.position.x + HALF) * (256 / (HALF*2));
    const ppy = (player.group.position.z + HALF) * (256 / (HALF*2));
    mctx.save();
    mctx.translate(128, 128);
    // rotate by camera yaw so up = forward
    mctx.rotate(-G.camRig.yaw);
    mctx.drawImage(G.world.minimap, -ppx, -ppy);

    // mission marker on minimap
    if (G.mission && G.mission.active && G.mission.active.markerPos) {
      const mx = (G.mission.active.markerPos.x + HALF) * (256 / (HALF*2));
      const my = (G.mission.active.markerPos.z + HALF) * (256 / (HALF*2));
      mctx.fillStyle = '#ffcf4a';
      mctx.beginPath();
      mctx.arc(mx - ppx, my - ppy, 5, 0, TAU);
      mctx.fill();
    }
    // cops as red dots
    mctx.fillStyle = '#ff3333';
    for (const v of G.vehicles) if (v.isCop && v.driver) {
      const x = (v.pos.x + HALF) * (256 / (HALF*2));
      const y = (v.pos.z + HALF) * (256 / (HALF*2));
      mctx.beginPath(); mctx.arc(x - ppx, y - ppy, 2.5, 0, TAU); mctx.fill();
    }
    mctx.restore();
    // player blip (always center, facing up)
    mctx.fillStyle = '#21f0ff';
    mctx.beginPath();
    mctx.moveTo(128, 122);
    mctx.lineTo(124, 134);
    mctx.lineTo(132, 134);
    mctx.closePath();
    mctx.fill();
    // compass
    const dirs = ['N','NE','E','SE','S','SW','W','NW'];
    const yawDeg = (G.camRig.yaw * 180 / PI + 360) % 360;
    const idx = Math.round(yawDeg / 45) % 8;
    document.getElementById('compass').textContent = dirs[idx];
  }

  return {
    setStars, setCash, setBars, setAmmo, setMissionText, setClock, setWeather, setCrosshair,
    showSubtitle, showPrompt, showNotif, togglePhone, update, drawMinimap
  };
}

// =============================================================================
// 10. MISSION SYSTEM
// =============================================================================

function makeMissionSystem() {
  const sys = { active: null };
  const missions = {
    welcome: {
      name: 'Welcome to Krung Thep',
      th: 'ยินดีต้อนรับสู่กรุงเทพฯ',
      markerPos: null,
      stage: 0,
      onStart() {
        G.hud.setMissionText('Welcome to Krung Thep');
        G.hud.showSubtitle("Uncle Seng's gold shop. Yaowarat. Bring the envelope.", "ร้านทองของลุงเซ้ง");
        this.markerPos = G.world.poi.goldShop.clone();
        this.stage = 1;
        G.hud.showPrompt('Head to the <b>gold marker</b> on the map.', 3);
      },
      update(dt) {
        if (this.stage === 1) {
          const d2 = dist2(G.player.group.position, this.markerPos);
          if (d2 < 7*7) {
            this.stage = 2;
            G.hud.showSubtitle("Uncle Seng: \"Good, kid. The envelope.\"", "ลุงเซ้ง: \"ดีแล้ว ส่งมา\"");
            G.cash += 800;
            G.hud.setCash(G.cash);
            G.hud.showNotif('Mission complete: +฿800');
            // remove pillar
            const beam = G.world.poi.goldShopBeam;
            if (beam) { G.scene.remove(beam); G.world.poi.goldShopBeam = null; }
            G.hud.setMissionText('Free Roam · Sukhumvit');
            this.markerPos = null;
            setTimeout(() => {
              G.hud.showSubtitle("Free roam: take a bike, beat up muggers, dodge cops.", "ขับเล่นเลย");
            }, 2500);
          }
        }
      },
    }
  };
  sys.start = id => {
    sys.active = missions[id];
    sys.active.onStart();
  };
  sys.update = dt => { if (sys.active && sys.active.update) sys.active.update(dt); };
  return sys;
}

// =============================================================================
// 11. PHYSICS / COLLISIONS (lightweight)
// =============================================================================

// Player vs buildings: simple AABB pushback
function resolvePlayerVsBuildings(player) {
  const r = 0.42;
  const p = player.group.position;
  for (const b of G.world.buildings) {
    const bx = b.pos.x, bz = b.pos.z;
    const hx = b.size.x/2 + r, hz = b.size.z/2 + r;
    const dx = p.x - bx;
    const dz = p.z - bz;
    if (Math.abs(dx) < hx && Math.abs(dz) < hz) {
      // push out on shortest axis
      const px = hx - Math.abs(dx);
      const pz = hz - Math.abs(dz);
      if (px < pz) p.x = bx + Math.sign(dx) * hx;
      else         p.z = bz + Math.sign(dz) * hz;
    }
  }
  // world bounds
  p.x = clamp(p.x, -HALF + 1, HALF - 1);
  p.z = clamp(p.z, -HALF + 1, HALF - 1);
}

// Vehicle vs buildings — soft pushback that also kills speed
function resolveVehicleVsBuildings(v) {
  const p = v.pos;
  const r = Math.max(v.boundsHalf.x, v.boundsHalf.z) + 0.2;
  let hit = false;
  for (const b of G.world.buildings) {
    const bx = b.pos.x, bz = b.pos.z;
    const hx = b.size.x/2 + r, hz = b.size.z/2 + r;
    const dx = p.x - bx, dz = p.z - bz;
    if (Math.abs(dx) < hx && Math.abs(dz) < hz) {
      const px = hx - Math.abs(dx);
      const pz = hz - Math.abs(dz);
      if (px < pz) p.x = bx + Math.sign(dx) * hx;
      else         p.z = bz + Math.sign(dz) * hz;
      hit = true;
    }
  }
  if (hit) {
    if (Math.abs(v.vel) > 6) {
      v.hp -= Math.abs(v.vel) * 0.6;
      G.camRig.shake = Math.min(0.4, Math.abs(v.vel) * 0.02);
      G.audio.hit();
    }
    v.vel *= 0.4;
  }
  // bounds
  p.x = clamp(p.x, -HALF + 1, HALF - 1);
  p.z = clamp(p.z, -HALF + 1, HALF - 1);
}

// =============================================================================
// 12. UPDATE LOOPS — Player / Vehicles / NPCs
// =============================================================================

function updatePlayer(dt) {
  const p = G.player;
  if (p.inVehicle) { updatePlayerInVehicle(dt); return; }

  // mouse look
  const [dx, dy] = G.input.consumeMouseDelta();
  const sens = 0.0024;
  G.camRig.yaw   -= dx * sens;
  G.camRig.pitch -= dy * sens;
  G.camRig.pitch = clamp(G.camRig.pitch, -1.1, 0.6);

  // movement input
  const forward = (G.input.down('KeyW')?1:0) - (G.input.down('KeyS')?1:0);
  const strafe  = (G.input.down('KeyD')?1:0) - (G.input.down('KeyA')?1:0);
  const sprint  = G.input.down('ShiftLeft') && p.stam > 4;
  const moving = forward !== 0 || strafe !== 0;
  let speed = 3.4;
  if (sprint && moving) { speed = 6.4; p.stam = Math.max(0, p.stam - 22*dt); }
  else { p.stam = Math.min(p.stamMax, p.stam + 18*dt); }

  // calculate desired velocity in world space relative to camera yaw
  const fx = -Math.sin(G.camRig.yaw), fz = -Math.cos(G.camRig.yaw);
  const rx =  Math.cos(G.camRig.yaw), rz = -Math.sin(G.camRig.yaw);
  let vx = fx * forward + rx * strafe;
  let vz = fz * forward + rz * strafe;
  const len = Math.hypot(vx, vz);
  if (len > 0.001) { vx = vx / len * speed; vz = vz / len * speed; }
  p.velocity.x = lerp(p.velocity.x, vx, 0.25);
  p.velocity.z = lerp(p.velocity.z, vz, 0.25);
  // gravity / jump
  if (G.input.pressed('Space') && p.grounded && !G.input.down('ControlLeft')) {
    p.velocity.y = 5.0; p.grounded = false;
  }
  if (!p.grounded) {
    p.velocity.y -= 18 * dt;
  }
  p.group.position.addScaledVector(p.velocity, dt);
  if (p.group.position.y <= 0) { p.group.position.y = 0; p.velocity.y = 0; p.grounded = true; }

  resolvePlayerVsBuildings(p);

  // body face direction of movement (or aim if firing)
  if (p.activeWeapon === 'pistol' && G.input.rightDown) {
    p.yaw = G.camRig.yaw + PI;
  } else if (moving) {
    const desired = Math.atan2(vx, vz);
    p.yaw = lerpAngle(p.yaw, desired, 0.25);
  }
  p.group.rotation.y = p.yaw;

  // animations: leg bob, arm swing
  const tnow = performance.now() * 0.005;
  if (moving) {
    p.legs.rotation.x = Math.sin(tnow * speed * 0.5) * 0.5;
    p.torso.rotation.x = Math.sin(tnow * speed * 0.5) * 0.05;
    p.armL.rotation.x = -Math.sin(tnow * speed * 0.5) * 0.6;
    p.armR.rotation.x =  Math.sin(tnow * speed * 0.5) * 0.6;
    // footstep audio
    p._stepPhase = (p._stepPhase||0) + dt * speed;
    if (p._stepPhase > 0.6) { p._stepPhase = 0; G.audio.step(G.time.rainStrength > 0.3); }
  } else {
    p.legs.rotation.x *= 0.85;
    p.torso.rotation.x *= 0.85;
    p.armL.rotation.x *= 0.85;
    p.armR.rotation.x *= 0.85;
  }

  // Combat
  updateCombat(dt);

  // 7-Eleven proximity chime
  for (const e of G.world.sevenElevens) {
    if (dist2(p.group.position, e.pos) < 7*7) {
      if (Date.now() - e.chimed > 4000) { G.audio.chime(); e.chimed = Date.now(); }
    }
  }
}

function updatePlayerInVehicle(dt) {
  const p = G.player;
  const v = p.inVehicle;
  // exit
  if (G.input.pressed('KeyE')) {
    p.inVehicle = null;
    v.driver = null;
    if (v.audio) { v.audio.set(0, false); }
    // place player next to vehicle on left
    const ox = Math.cos(v.heading) * 1.4;
    const oz = -Math.sin(v.heading) * 1.4;
    p.group.position.set(v.pos.x + ox, 0, v.pos.z + oz);
    p.group.visible = true;
    return;
  }

  // controls
  const forward = (G.input.down('KeyW')?1:0) - (G.input.down('KeyS')?1:0);
  const steer   = (G.input.down('KeyA')?1:0) - (G.input.down('KeyD')?1:0);
  const handbrake = G.input.down('Space');
  const boost = G.input.down('ShiftLeft');

  const spec = v.spec;
  // accel
  if (forward > 0) v.vel += spec.accel * (boost ? 1.3 : 1) * dt;
  else if (forward < 0) {
    if (v.vel > 0.2) v.vel -= spec.brake * dt;
    else v.vel -= spec.accel * 0.6 * dt; // reverse
  } else {
    v.vel *= Math.pow(0.985, dt * 60);
  }
  if (handbrake) v.vel *= Math.pow(0.94, dt*60);
  v.vel = clamp(v.vel, -spec.topSpeed * 0.4, spec.topSpeed * (boost ? 1.15 : 1));
  // steering — speed dependent
  const steerRate = spec.turn * (1 - Math.min(1, Math.abs(v.vel)/spec.topSpeed) * 0.4);
  v.heading += steer * steerRate * dt * (v.vel >= 0 ? 1 : -1) * (Math.abs(v.vel)>0.3 ? 1 : 0);

  // motorbike lean
  if (v.spec.kind === 'bike') {
    v.mesh.rotation.z = lerp(v.mesh.rotation.z || 0, -steer * 0.35, 0.15);
  } else if (v.spec.kind === 'tuktuk') {
    // tippy oversteer wiggle
    v.mesh.rotation.z = lerp(v.mesh.rotation.z || 0, -steer * 0.18 + Math.sin(performance.now()*0.01)*0.02, 0.2);
  }

  // apply motion
  v.pos.x += Math.sin(v.heading) * v.vel * dt;
  v.pos.z += Math.cos(v.heading) * v.vel * dt;
  v.mesh.position.copy(v.pos);
  v.mesh.rotation.y = v.heading;

  resolveVehicleVsBuildings(v);

  // place player at seat (invisible while inside)
  p.group.visible = false;
  p.group.position.copy(v.pos); p.group.position.y = 0.5;

  // audio
  if (!v.audio) {
    v.audio = (v.spec.kind === 'tuktuk') ? G.audio.tukTukLoop() : G.audio.engineLoop({ rpmBase: v.spec.kind === 'bike' ? 110 : 70, harsh: v.spec.kind === 'bike' });
  }
  v.audio.set(clamp(Math.abs(v.vel)/spec.topSpeed, 0, 1), true);

  // honk
  if (G.input.pressed('KeyH')) G.audio.honk();

  // crashing into things — handled by vehicle vs vehicle below

  // ramming peds
  for (const ped of G.peds) {
    if (ped.dead) continue;
    if (dist2(ped.mesh.position, v.pos) < 1.6*1.6 && Math.abs(v.vel) > 4) {
      killPed(ped);
      G.wanted.stars = Math.max(G.wanted.stars, 2);
      G.wanted.lastSeenAt = performance.now();
      G.wanted.lastSeenPos.copy(p.group.position);
      G.hud.showNotif('Hit & Run! +Wanted Star');
    }
  }
}

function lerpAngle(a, b, t) {
  let d = b - a;
  while (d > PI) d -= TAU;
  while (d < -PI) d += TAU;
  return a + d * t;
}

function killPed(ped) {
  if (ped.dead) return;
  ped.dead = true;
  // ragdoll: flatten
  ped.mesh.rotation.x = PI/2;
  ped.mesh.position.y = 0.05;
  G.audio.hit();
  setTimeout(() => {
    G.scene.remove(ped.mesh);
    const i = G.peds.indexOf(ped); if (i >= 0) G.peds.splice(i, 1);
  }, 8000);
}

function updateVehicles(dt) {
  for (const v of G.vehicles) {
    if (v.driver === 'player') continue;
    if (v.isCop && v.driver) updateCop(v, dt);
    else if (v.npc) updateTrafficCar(v, dt);
    // damage smoke
    if (v.hp < 30 && !v.smoke) {
      v.smoke = makeSmokeEmitter(v.mesh.position, 0.5);
    }
    if (v.hp <= 0 && !v.fire) {
      v.fire = true;
      v.mesh.children.forEach(c => { if (c.material && c.material.color) c.material.color.lerp(new THREE.Color(0x111), 0.6); });
      makeExplosion(v.pos);
      v.vel = 0;
    }
  }
}

function updateTrafficCar(v, dt) {
  const npc = v.npc;
  // simple grid following: pick a heading aligned with the road, choose new heading at intersections
  const onEW = Math.abs(((v.pos.z + 100000) % BLOCK) - BLOCK/2) > BLOCK/2 - 2 || Math.abs(v.pos.z % BLOCK) < 2;
  // collision check ahead with player vehicle / other cars / peds
  const headingX = Math.sin(v.heading), headingZ = Math.cos(v.heading);
  let block = false;
  for (const o of G.vehicles) {
    if (o === v) continue;
    const dx = o.pos.x - v.pos.x;
    const dz = o.pos.z - v.pos.z;
    const fwd = dx * headingX + dz * headingZ;
    const side = -dx * headingZ + dz * headingX;
    if (fwd > 0 && fwd < 8 && Math.abs(side) < 1.6) { block = true; break; }
  }
  // peds in road
  for (const ped of G.peds) {
    if (ped.dead) continue;
    const dx = ped.mesh.position.x - v.pos.x;
    const dz = ped.mesh.position.z - v.pos.z;
    const fwd = dx * headingX + dz * headingZ;
    const side = -dx * headingZ + dz * headingX;
    if (fwd > 0 && fwd < 5 && Math.abs(side) < 1.2) { block = true; break; }
  }
  // approaching intersection: random turn
  const nearIntersection = isNearGridLine(v.pos.x) && isNearGridLine(v.pos.z);
  if (nearIntersection && !npc.turnedRecently) {
    if (Math.random() < 0.25) {
      // 90-degree turn
      const turn = Math.random() < 0.5 ? PI/2 : -PI/2;
      v.heading += turn;
    }
    npc.turnedRecently = 0.8;
  }
  if (npc.turnedRecently > 0) npc.turnedRecently = Math.max(0, npc.turnedRecently - dt);

  // accel
  const target = block ? 0 : npc.cruiseSpeed;
  if (v.vel < target) v.vel = Math.min(target, v.vel + v.spec.accel * dt);
  else v.vel = Math.max(target, v.vel - v.spec.brake * dt);

  v.pos.x += Math.sin(v.heading) * v.vel * dt;
  v.pos.z += Math.cos(v.heading) * v.vel * dt;
  v.mesh.position.copy(v.pos);
  v.mesh.rotation.y = v.heading;

  // honk if blocked
  if (block && (npc.honkCooldown -= dt) <= 0) {
    G.audio.honk();
    npc.honkCooldown = rand(2, 6);
  }

  // bounds wrap / despawn-respawn far from player
  const playerPos = G.player.group.position;
  if (dist2(v.pos, playerPos) > 220*220) {
    // teleport ahead of player on a road
    respawnTraffic(v, playerPos);
  }
}

function isNearGridLine(v) {
  const m = ((v + HALF) % BLOCK) - BLOCK/2;
  return Math.abs(m) < 1.5;
}

function respawnTraffic(v, playerPos) {
  const angle = rand(0, TAU);
  const r = rand(70, 130);
  const x = clamp(playerPos.x + Math.cos(angle) * r, -HALF + 5, HALF - 5);
  const z = clamp(playerPos.z + Math.sin(angle) * r, -HALF + 5, HALF - 5);
  // snap to nearest road
  const ix = Math.round(x / BLOCK) * BLOCK;
  const iz = Math.round(z / BLOCK) * BLOCK;
  if (Math.abs(x - ix) < Math.abs(z - iz)) { v.pos.set(ix + (Math.random()<0.5?-2.5:2.5), 0, z); v.heading = Math.random()<0.5 ? 0 : PI; v.heading = (v.pos.x > ix ? 0 : PI); }
  else { v.pos.set(x, 0, iz + (Math.random()<0.5?-2.5:2.5)); v.heading = (v.pos.z > iz ? -PI/2 : PI/2); }
  v.vel = v.npc.cruiseSpeed * 0.7;
}

// =============================================================================
// 13. PEDESTRIANS + DOGS
// =============================================================================

function updatePeds(dt) {
  const playerPos = G.player.group.position;
  for (const ped of G.peds) {
    if (ped.dead) continue;
    // panic if loud near
    if (ped.panicT > 0) {
      ped.panicT -= dt;
      ped.speed = 3.0;
      // run away from player
      const dx = ped.mesh.position.x - playerPos.x;
      const dz = ped.mesh.position.z - playerPos.z;
      ped.heading = Math.atan2(dx, dz);
    } else if (ped.state === 'walking') {
      // light wander, mostly on sidewalk side of block
      ped.waitT -= dt;
      if (ped.waitT <= 0) {
        ped.heading += rand(-0.5, 0.5);
        ped.waitT = rand(1.5, 4);
      }
    }
    ped.mesh.position.x += Math.sin(ped.heading) * ped.speed * dt;
    ped.mesh.position.z += Math.cos(ped.heading) * ped.speed * dt;
    ped.mesh.rotation.y = ped.heading;
    // arm/leg sway
    const t = performance.now() * 0.006;
    const parts = ped.mesh.userData.parts;
    if (parts) parts.legs.rotation.x = Math.sin(t * ped.speed) * 0.4;

    // bounds
    ped.mesh.position.x = clamp(ped.mesh.position.x, -HALF + 2, HALF - 2);
    ped.mesh.position.z = clamp(ped.mesh.position.z, -HALF + 2, HALF - 2);

    // despawn far / respawn
    if (dist2(ped.mesh.position, playerPos) > 180*180) {
      ped.mesh.position.set(
        playerPos.x + rand(-90, 90),
        0,
        playerPos.z + rand(-90, 90)
      );
    }
  }
}

function updateDogs(dt) {
  const playerPos = G.player.group.position;
  for (const dog of G.dogs) {
    dog.timer -= dt;
    const d = Math.sqrt(dist2(dog.mesh.position, playerPos));

    if (dog.state === 'lying') {
      if (d < 6) { dog.state = 'fleeing'; dog.timer = 2.5; G.audio.bark(); }
      else if (dog.timer <= 0) { dog.state = Math.random()<0.5 ? 'walking' : 'lying'; dog.timer = rand(2, 8); dog.heading = rand(0,TAU); }
    } else if (dog.state === 'walking') {
      if (d < 5) { dog.state = 'fleeing'; dog.timer = 2.5; G.audio.bark(); }
      else if (dog.timer <= 0) { dog.state = Math.random()<0.4 ? 'lying' : 'walking'; dog.timer = rand(3, 8); dog.heading = rand(0,TAU); }
    } else if (dog.state === 'fleeing') {
      const dx = dog.mesh.position.x - playerPos.x;
      const dz = dog.mesh.position.z - playerPos.z;
      dog.heading = Math.atan2(dx, dz);
      dog.speed = 3.5;
      if (d > 14 || dog.timer <= 0) { dog.state = 'walking'; dog.speed = 0.9; dog.timer = rand(3, 7); }
    }

    if (dog.state !== 'lying') {
      dog.mesh.position.x += Math.sin(dog.heading) * dog.speed * dt;
      dog.mesh.position.z += Math.cos(dog.heading) * dog.speed * dt;
      dog.mesh.rotation.y = dog.heading;
    }

    dog.mesh.position.x = clamp(dog.mesh.position.x, -HALF + 2, HALF - 2);
    dog.mesh.position.z = clamp(dog.mesh.position.z, -HALF + 2, HALF - 2);

    if (dist2(dog.mesh.position, playerPos) > 220*220) {
      dog.mesh.position.set(playerPos.x + rand(-80,80), 0, playerPos.z + rand(-80,80));
      dog.state = 'lying'; dog.timer = rand(2, 5);
    }
  }
}

// =============================================================================
// 14. COMBAT — melee + pistol
// =============================================================================

function updateCombat(dt) {
  const p = G.player;
  if (p.attackTimer > 0) p.attackTimer -= dt;
  if (p.attackCooldown > 0) p.attackCooldown -= dt;
  if (p.hitFlashT > 0) p.hitFlashT -= dt;

  // weapon cycle
  if (G.input.pressed('KeyQ')) {
    p.activeWeapon = p.activeWeapon === 'fists' ? 'pistol' : 'fists';
    if (p.activeWeapon === 'pistol' && !p.weapons.pistol) p.activeWeapon = 'fists';
    p.pistol.visible = (p.activeWeapon === 'pistol');
    updateAmmoHud();
  }
  // pickup pistol (give it to player after first cop kill or via cheat)
  if (G.input.pressed('KeyG')) { // dev: grant pistol
    p.weapons.pistol = true; p.pistolAmmo = p.pistolMag; updateAmmoHud(); G.hud.showNotif('+9mm Pistol');
  }

  // block
  p.blocking = G.input.down('ControlLeft');

  // reload
  if (G.input.pressed('KeyR') && p.weapons.pistol && p.pistolAmmo < p.pistolMag && p.pistolReserve > 0) {
    const need = p.pistolMag - p.pistolAmmo;
    const take = Math.min(need, p.pistolReserve);
    p.pistolAmmo += take; p.pistolReserve -= take;
    G.audio.reload(); updateAmmoHud();
  }

  // attack — F (melee) or LMB / F for pistol
  if (p.activeWeapon === 'fists') {
    if (G.input.pressed('KeyF') && p.attackCooldown <= 0 && p.stam > 8) {
      const kinds = ['jab', 'cross', 'kick'];
      const kind = pick(kinds);
      p.attackKind = kind;
      p.attackTimer = 0.25;
      p.attackCooldown = 0.32;
      p.stam = Math.max(0, p.stam - 8);
      doMeleeHit(kind);
    }
    if (p.attackTimer > 0) {
      // animate
      const t = 1 - p.attackTimer / 0.25;
      if (p.attackKind === 'jab') {
        p.armL.rotation.x = -Math.sin(t * PI) * 1.4;
      } else if (p.attackKind === 'cross') {
        p.armR.rotation.x = -Math.sin(t * PI) * 1.6;
      } else if (p.attackKind === 'kick') {
        p.legs.rotation.x = Math.sin(t * PI) * 1.2;
      }
    }
    G.hud.setCrosshair(false);
  } else if (p.activeWeapon === 'pistol' && p.weapons.pistol) {
    p.pistol.visible = true;
    // hold pistol at right hand
    const handLocal = new THREE.Vector3(0.42, 1.15, 0.4);
    p.pistol.position.copy(handLocal);
    p.pistol.rotation.set(0, 0, 0);

    G.hud.setCrosshair(G.input.rightDown);
    if (G.input.mouseDown && p.attackCooldown <= 0 && p.pistolAmmo > 0) {
      firePistol();
      p.pistolAmmo--; p.attackCooldown = 0.18;
      updateAmmoHud();
    } else if (G.input.mouseDown && p.pistolAmmo === 0 && p.attackCooldown <= 0) {
      G.audio.blip({freq: 200, dur: 0.04, type:'square', gain: 0.05});
      p.attackCooldown = 0.25;
    }
  }
}

function updateAmmoHud() {
  const p = G.player;
  if (p.activeWeapon === 'fists') G.hud.setAmmo('FISTS', 'MUAY THAI');
  else G.hud.setAmmo(`${p.pistolAmmo} / ${p.pistolReserve}`, '9MM PISTOL');
}

function doMeleeHit(kind) {
  const p = G.player;
  const fx = -Math.sin(p.yaw), fz = -Math.cos(p.yaw);
  // search nearby peds/cops/dogs in front
  let hitSomething = false;
  for (const list of [G.peds, G.cops]) {
    for (const target of list) {
      if (target.dead || target.isVehicle) continue;
      const tx = target.mesh.position.x - p.group.position.x;
      const tz = target.mesh.position.z - p.group.position.z;
      const fwd = tx*fx + tz*fz;
      const side = -tx*fz + tz*fx;
      const d2 = tx*tx + tz*tz;
      if (fwd > 0 && fwd < 1.7 && Math.abs(side) < 1.0 && d2 < 4) {
        target.hp -= (kind === 'kick' ? 22 : kind === 'cross' ? 18 : 12);
        target.panicT = 6;
        hitSomething = true;
        if (target.hp <= 0) {
          if (G.cops.includes(target)) killCop(target);
          else killPed(target);
        }
        // bumping a ped raises minor heat once
        if (!target._notedAggression) {
          target._notedAggression = true;
          if (G.wanted.stars < 1) {
            G.wanted.stars = 1;
            G.wanted.lastSeenAt = performance.now();
            G.wanted.lastSeenPos.copy(p.group.position);
            G.hud.showNotif('Assault witnessed — ★');
            G.audio.whistle();
          }
        }
      }
    }
  }
  if (kind === 'kick') G.audio.kick(); else G.audio.punch();
  if (hitSomething) G.audio.hit();
}

function firePistol() {
  const p = G.player;
  // raycast from camera forward
  const dir = new THREE.Vector3();
  G.camera.getWorldDirection(dir);
  const origin = G.camera.position.clone();
  // muzzle flash
  const flash = new THREE.PointLight(0xffd577, 2.5, 6, 2);
  flash.position.copy(origin); G.scene.add(flash);
  setTimeout(() => G.scene.remove(flash), 60);
  // spawn tracer bullet
  const bullet = new THREE.Mesh(G.bulletGeom, G.bulletMat);
  bullet.position.copy(origin); G.scene.add(bullet);
  G.bullets.push({ mesh: bullet, vel: dir.clone().multiplyScalar(80), life: 1.0, dir });
  G.audio.shot();
  G.camRig.shake = Math.max(G.camRig.shake, 0.06);
  // raycast for instant hit (bullet visual is cosmetic)
  doBulletRaycast(origin, dir);
}

function doBulletRaycast(origin, dir) {
  const ray = new THREE.Raycaster(origin, dir, 0, 120);
  // gather targets: peds, cops, vehicles, buildings
  const candidates = [];
  for (const ped of G.peds) if (!ped.dead) candidates.push({ obj: ped, mesh: ped.mesh });
  for (const cop of G.cops) if (!cop.dead) candidates.push({ obj: cop, mesh: cop.mesh });
  for (const veh of G.vehicles) candidates.push({ obj: veh, mesh: veh.mesh });
  // also test buildings (cheap)
  for (const b of G.world.buildings) candidates.push({ obj: b, mesh: b.mesh, isBuilding: true });
  // sort by distance test
  let best = null;
  for (const c of candidates) {
    const intersects = ray.intersectObject(c.mesh, true);
    if (intersects.length) {
      const hit = intersects[0];
      if (!best || hit.distance < best.dist) best = { dist: hit.distance, point: hit.point, target: c };
    }
  }
  if (best) {
    G.audio.ricochet();
    const t = best.target;
    if (t.obj.hp != null && !t.isBuilding) {
      t.obj.hp -= 35;
      if (t.obj.hp <= 0) {
        if (G.peds.includes(t.obj)) killPed(t.obj);
        else if (G.cops.includes(t.obj)) killCop(t.obj);
      }
      // bullets escalate wanted level
      G.wanted.stars = Math.max(G.wanted.stars, 2);
      G.wanted.lastSeenAt = performance.now();
      G.wanted.lastSeenPos.copy(G.player.group.position);
    } else if (G.vehicles.includes(t.obj)) {
      t.obj.hp -= 15;
    }
    // tiny spark
    const spark = new THREE.PointLight(0xffeebb, 1.5, 4, 2);
    spark.position.copy(best.point);
    G.scene.add(spark);
    setTimeout(() => G.scene.remove(spark), 80);
  }
}

function updateBullets(dt) {
  for (let i = G.bullets.length - 1; i >= 0; i--) {
    const b = G.bullets[i];
    b.mesh.position.addScaledVector(b.vel, dt);
    b.life -= dt;
    if (b.life <= 0) {
      G.scene.remove(b.mesh);
      G.bullets.splice(i, 1);
    }
  }
}

// =============================================================================
// 15. COPS + WANTED SYSTEM
// =============================================================================

function spawnCop(scene, pos) {
  // foot cop
  const m = makePedMesh();
  // override clothing to brown/khaki
  m.userData.parts.torso.material = new THREE.MeshStandardMaterial({ color: 0x8a7f4a, roughness: 0.7 });
  m.userData.parts.legs.material  = new THREE.MeshStandardMaterial({ color: 0x4a4030, roughness: 0.8 });
  m.position.copy(pos);
  scene.add(m);
  const cop = {
    mesh: m, heading: rand(0, TAU), speed: 3.5, hp: 60, dead: false,
    state: 'seeking',  // seeking | engaging | bribed
    shootCooldown: 0, idleT: 0,
  };
  G.cops.push(cop);
  return cop;
}

function spawnCopCar(scene, pos) {
  const v = makeVehicle('cop', scene);
  v.pos.copy(pos);
  v.mesh.position.copy(v.pos);
  v.heading = rand(0, TAU);
  v.driver = 'cop';
  v.siren = true;
  v.vel = 0;
  G.cops.push({ mesh: v.mesh, vehicle: v, isVehicle: true, hp: 200, dead: false });
  return v;
}

function killCop(cop) {
  if (cop.dead) return;
  cop.dead = true;
  cop.mesh.rotation.x = PI/2;
  cop.mesh.position.y = 0.05;
  G.wanted.stars = Math.max(G.wanted.stars, 2);
  G.wanted.lastSeenAt = performance.now();
  G.wanted.lastSeenPos.copy(G.player.group.position);
  setTimeout(() => { G.scene.remove(cop.mesh); const i = G.cops.indexOf(cop); if (i>=0) G.cops.splice(i,1); }, 8000);
}

function updateWanted(dt) {
  const p = G.player.group.position;
  // visual: blink cop car lamps
  const t = performance.now() * 0.012;
  for (const v of G.vehicles) {
    if (v.isCop && v.mesh.userData.copLamps) {
      const flash = Math.sin(t) > 0;
      v.mesh.userData.copLamps[0].material.color.setHex(flash ? 0xff2222 : 0x441111);
      v.mesh.userData.copLamps[1].material.color.setHex(flash ? 0x2266ff : 0x111144);
      if (Math.random() < 0.005 && v.driver) G.audio.siren();
    }
  }

  // spawn cops based on stars and player visibility
  const desiredCops = G.wanted.stars >= 2 ? 4 : G.wanted.stars >= 1 ? 2 : 0;
  const alive = G.cops.filter(c => !c.dead).length;
  if (alive < desiredCops && Math.random() < 0.01 + G.wanted.stars * 0.01) {
    // spawn just outside view
    const ang = rand(0, TAU);
    const r = rand(35, 60);
    const sx = p.x + Math.cos(ang) * r;
    const sz = p.z + Math.sin(ang) * r;
    if (G.wanted.stars >= 2 && Math.random() < 0.6) {
      const car = spawnCopCar(G.scene, new THREE.Vector3(clamp(sx,-HALF+5,HALF-5), 0, clamp(sz,-HALF+5,HALF-5)));
      car.vel = 6;
    } else {
      spawnCop(G.scene, new THREE.Vector3(clamp(sx,-HALF+5,HALF-5), 0, clamp(sz,-HALF+5,HALF-5)));
    }
  }

  // wanted decay if not seen
  const sinceSeen = (performance.now() - G.wanted.lastSeenAt) / 1000;
  if (G.wanted.stars > 0 && sinceSeen > 35) {
    G.wanted.stars = Math.max(0, G.wanted.stars - 1);
    G.wanted.lastSeenAt = performance.now();
    G.hud.showNotif(G.wanted.stars === 0 ? 'You lost the cops.' : 'Heat reduced ★');
  }

  // bribe: B near any non-engaged cop
  const player = G.player;
  let bribeable = null;
  for (const c of G.cops) {
    if (c.dead || c.isVehicle) continue;
    const d2 = dist2(c.mesh.position, p);
    if (d2 < 4*4) { bribeable = c; break; }
  }
  if (bribeable && G.wanted.stars > 0 && G.wanted.stars <= 2) {
    G.hud.showPrompt('Press <b>B</b> to bribe (฿1,000)', 0.5);
    if (G.input.pressed('KeyB') && G.cash >= 1000) {
      G.cash -= 1000;
      G.wanted.stars--;
      G.hud.setCash(G.cash);
      G.hud.showNotif('Bribed: -฿1,000');
      G.audio.blip({freq:600, dur:0.1, gain:0.1});
      bribeable.state = 'bribed';
      setTimeout(() => { if (bribeable && !bribeable.dead) { /* leave alone */ } }, 4000);
    }
  }

  G.hud.setStars(G.wanted.stars);
}

function updateCop(v, dt) {
  // chase player
  const p = G.player;
  const tx = p.group.position.x - v.pos.x;
  const tz = p.group.position.z - v.pos.z;
  const d = Math.hypot(tx, tz);
  const targetHeading = Math.atan2(tx, tz);
  v.heading = lerpAngle(v.heading, targetHeading, 0.06);
  const target = d > 8 ? v.spec.topSpeed * 0.7 : (d < 4 ? 0 : 4);
  if (v.vel < target) v.vel += v.spec.accel * dt;
  else v.vel -= v.spec.brake * dt;
  v.pos.x += Math.sin(v.heading) * v.vel * dt;
  v.pos.z += Math.cos(v.heading) * v.vel * dt;
  v.mesh.position.copy(v.pos);
  v.mesh.rotation.y = v.heading;
  // ram player vehicle
  if (p.inVehicle && dist2(v.pos, p.inVehicle.pos) < 4*4) {
    p.inVehicle.hp -= 8 * dt;
  }
}

function updateFootCops(dt) {
  const p = G.player;
  for (const c of G.cops) {
    if (c.dead || c.isVehicle) continue;
    if (c.state === 'bribed') { c.idleT += dt; continue; }
    const dx = p.group.position.x - c.mesh.position.x;
    const dz = p.group.position.z - c.mesh.position.z;
    const d = Math.hypot(dx, dz);
    c.heading = Math.atan2(dx, dz);
    if (d > 2.5) {
      c.mesh.position.x += Math.sin(c.heading) * c.speed * dt;
      c.mesh.position.z += Math.cos(c.heading) * c.speed * dt;
    } else {
      // melee attack
      c.shootCooldown -= dt;
      if (c.shootCooldown <= 0) {
        c.shootCooldown = 0.8;
        // attack player
        p.hp -= 6;
        p.hitFlashT = 0.3;
        G.audio.punch();
        if (p.hp <= 0) gameOver();
      }
    }
    c.mesh.rotation.y = c.heading;
    const parts = c.mesh.userData.parts;
    if (parts) parts.legs.rotation.x = Math.sin(performance.now()*0.012) * 0.5;
  }
}

function gameOver() {
  G.hud.showSubtitle("You wake up at the police station. Lost some cash.", "ตื่นมาที่โรงพัก");
  G.player.hp = G.player.hpMax;
  G.cash = Math.max(0, G.cash - 500);
  G.hud.setCash(G.cash);
  G.wanted.stars = 0;
  // respawn at gold shop or start
  const sp = G.world.spawns.player.clone();
  G.player.group.position.copy(sp);
  G.player.velocity.set(0,0,0);
  if (G.player.inVehicle) {
    G.player.inVehicle.driver = null;
    G.player.inVehicle = null;
    G.player.group.visible = true;
  }
}

// =============================================================================
// 16. PARTICLES / FX
// =============================================================================

function makeSmokeEmitter(target, intensity=1) {
  const N = 40;
  const geom = new THREE.BufferGeometry();
  const pos = new Float32Array(N * 3);
  for (let i = 0; i < N; i++) { pos[i*3]=0; pos[i*3+1]=0; pos[i*3+2]=0; }
  geom.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  const mat = new THREE.PointsMaterial({ color: 0x444444, size: 1.2, transparent: true, opacity: 0.65, depthWrite: false });
  const pts = new THREE.Points(geom, mat);
  G.scene.add(pts);
  const seeds = Array.from({length:N}, () => ({ t: Math.random()*1.5, x: rand(-0.3,0.3), z: rand(-0.3,0.3) }));
  G.particles.push({ pts, mat, seeds, target, life: 60, intensity });
  return pts;
}

function makeExplosion(pos) {
  const flash = new THREE.PointLight(0xffaa55, 6, 22, 2);
  flash.position.copy(pos); G.scene.add(flash);
  setTimeout(()=>G.scene.remove(flash), 220);
  G.camRig.shake = 0.6;
  G.audio.thunder();
  makeSmokeEmitter(pos.clone(), 2);
}

function updateParticles(dt) {
  for (let i = G.particles.length - 1; i >= 0; i--) {
    const e = G.particles[i];
    e.life -= dt;
    const arr = e.pts.geometry.attributes.position.array;
    for (let j = 0; j < e.seeds.length; j++) {
      const s = e.seeds[j];
      s.t += dt;
      if (s.t > 2.0) {
        s.t = 0;
        arr[j*3+0] = e.target.x + s.x;
        arr[j*3+1] = e.target.y + 0.5;
        arr[j*3+2] = e.target.z + s.z;
      } else {
        arr[j*3+1] += 0.8 * dt;
        arr[j*3+0] += s.x * dt * 0.4;
        arr[j*3+2] += s.z * dt * 0.4;
      }
    }
    e.pts.geometry.attributes.position.needsUpdate = true;
    e.mat.opacity = clamp(e.life / 60, 0, 0.65);
    if (e.life <= 0) {
      G.scene.remove(e.pts);
      G.particles.splice(i, 1);
    }
  }
}

// =============================================================================
// 17. INTERACTION — get in/out of vehicle
// =============================================================================

function updateInteraction(dt) {
  const p = G.player;
  if (p.inVehicle) return;

  // find nearest vehicle within 2.5m that's not driven by a hostile cop
  let near = null, nd = Infinity;
  for (const v of G.vehicles) {
    if (v.driver) continue; // already occupied
    const d2 = dist2(v.pos, p.group.position);
    if (d2 < 8 && d2 < nd) { nd = d2; near = v; }
  }
  if (near) {
    G.hud.showPrompt('Press <b>E</b> to enter ' + vehicleName(near.kind), 0.5);
    if (G.input.pressed('KeyE')) {
      p.inVehicle = near;
      near.driver = 'player';
      G.audio.blip({freq:300, dur:0.05, gain:0.08});
    }
  }
}

function vehicleName(k) {
  return { bike: 'motorbike', tuktuk: 'tuk-tuk', hilux: 'pickup', camry: 'car', sedan: 'sedan', cop: 'cop pickup' }[k] || k;
}

// =============================================================================
// 18. CAMERA UPDATE
// =============================================================================

function updateCamera(dt) {
  const p = G.player;
  const rig = G.camRig;
  // shake decay
  rig.shake *= Math.pow(0.001, dt);
  const shakeX = (Math.random()*2-1) * rig.shake;
  const shakeY = (Math.random()*2-1) * rig.shake;

  let target;
  if (p.inVehicle) {
    target = p.inVehicle.pos.clone();
    target.y += 1.2;
    // chase camera: ride behind the vehicle heading, but slow yaw follow lets player look around
    const followYaw = p.inVehicle.heading + PI; // behind
    rig.yaw = lerpAngle(rig.yaw, followYaw, dt * 1.4);
    rig.targetDistance = p.inVehicle.spec.kind === 'bike' ? 4.8 : 6.5;
  } else {
    target = p.group.position.clone();
    target.y += 1.5;
    rig.targetDistance = 4.5;
  }
  rig.distance = lerp(rig.distance, rig.targetDistance, 0.08);
  const cy = Math.cos(rig.yaw), sy = Math.sin(rig.yaw);
  const cp = Math.cos(rig.pitch), sp = Math.sin(rig.pitch);
  const offset = new THREE.Vector3(sy * cp, -sp, cy * cp).multiplyScalar(rig.distance);
  rig.cam.position.copy(target).add(offset);
  rig.cam.position.x += shakeX; rig.cam.position.y += shakeY + 0.6;
  rig.cam.lookAt(target);
}

// =============================================================================
// 19. DAY/NIGHT + WEATHER
// =============================================================================

const DAY_LENGTH = 240; // seconds for a full 24h cycle

function updateDayNight(dt) {
  G.time.dayT = (G.time.dayT + dt / DAY_LENGTH) % 1;
  const t = G.time.dayT;          // 0..1, where 0 = midnight, 0.25 = 6am, 0.5 = noon, 0.75 = 6pm
  // sun direction
  const sunAngle = (t - 0.25) * TAU; // 0 at sunrise (east)
  const sx = Math.cos(sunAngle) * 100;
  const sy = Math.sin(sunAngle) * 90;
  const sz = 30;
  G.sun.position.set(sx, sy, sz);
  // sun intensity
  const dayK = clamp((Math.sin(sunAngle) + 0.2), 0, 1);
  G.sun.intensity = dayK * 1.4;
  G.hemi.intensity = 0.25 + dayK * 0.5;
  G.amb.intensity = 0.10 + dayK * 0.10;
  // background color
  const skyDay = new THREE.Color(0x8eb6e8);
  const skyDusk = new THREE.Color(0xff8866);
  const skyNight = new THREE.Color(0x0a1024);
  let sky;
  if (dayK > 0.4) sky = skyDay.clone().lerp(skyDusk, 1 - (dayK - 0.4)/0.6);
  else if (dayK > 0.05) sky = skyDusk.clone().lerp(skyNight, 1 - (dayK - 0.05)/0.35);
  else sky = skyNight;
  G.scene.background.copy(sky);
  G.scene.fog.color.copy(sky);
  G.scene.fog.density = lerp(0.0012, 0.0035, 1 - dayK) + G.time.rainStrength * 0.004;

  // neon/lamp/window emissive + accent lights: brighter at night.
  // Iterate only the cached arrays built in buildWorld — no full scene.traverse.
  const nightK = 1 - dayK;
  for (let n = 0; n < G.nightLights.length; n++) {
    const nl = G.nightLights[n];
    nl.light.intensity = nightK * nl.base;
  }
  for (let n = 0; n < G.nightEmissive.length; n++) {
    const ne = G.nightEmissive[n];
    ne.mat.emissiveIntensity = ne.dayIntensity + (ne.nightIntensity - ne.dayIntensity) * nightK;
  }

  // clock display
  const totalMin = t * 24 * 60;
  const hh = Math.floor(totalMin / 60), mm = Math.floor(totalMin % 60);
  G.hud.setClock(`${String(hh).padStart(2,'0')}:${String(mm).padStart(2,'0')}`);

  // weather: trigger light rain randomly after 2 min of demo time
  if (!G._weatherTimer) G._weatherTimer = 0;
  G._weatherTimer += dt;
  if (G._weatherTimer > 90 && G.time.weather === 'clear' && Math.random() < 0.005) {
    G.time.weather = 'rain';
    G.hud.setWeather('LIGHT RAIN · 28°C');
    G.hud.showNotif('It starts to rain.');
    G.audio.thunder();
  }
  G.time.rainStrength = lerp(G.time.rainStrength, G.time.weather === 'rain' ? 0.7 : 0, 0.01);
  G.audio.rainBed.setLevel(G.time.rainStrength * 0.18);

  G.rain.update(dt, G.player.group.position, G.time.rainStrength);

  // periodic temple bell at dawn
  if (!G._bellSeen) G._bellSeen = new Set();
  const hourSlot = Math.floor(t * 24);
  if ((hourSlot === 5 || hourSlot === 6) && !G._bellSeen.has(hourSlot)) {
    G._bellSeen.add(hourSlot);
    G.audio.bell();
  }
  if (hourSlot < 5) G._bellSeen.clear();
}

// =============================================================================
// 20. MAIN LOOP
// =============================================================================

function loop() {
  requestAnimationFrame(loop);
  const dt = Math.min(0.05, G.clock.getDelta());

  // phone toggle
  if (G.input && G.input.pressed && G.input.pressed('KeyT')) {
    const open = !document.getElementById('phone').classList.contains('open');
    G.hud.togglePhone(open);
    G.state = open ? 'phone' : 'playing';
    if (open) document.exitPointerLock();
    else G.input.requestLock();
  }

  if (G.state === 'playing') {
    updatePlayer(dt);
    updateInteraction(dt);
    updateVehicles(dt);
    updatePeds(dt);
    updateDogs(dt);
    updateFootCops(dt);
    updateBullets(dt);
    updateParticles(dt);
    updateWanted(dt);
    updateCamera(dt);
    updateDayNight(dt);
    if (G.mission) G.mission.update(dt);
    G.hud.update(dt);
    G.hud.setBars(G.player.hp, G.player.armor, G.player.stam);
    G.hud.setCash(G.cash);
    G.hud.drawMinimap(G.player);
    if (G.input.endFrame) G.input.endFrame();
  } else if (G.state === 'phone') {
    updateCamera(dt);
    if (G.input.endFrame) G.input.endFrame();
  }

  G.renderer.render(G.scene, G.camera);
}

// =============================================================================
// 21. BOOT
// =============================================================================

init().catch(err => {
  console.error(err);
  document.getElementById('loading').innerHTML = `<h1 style="color:#ff2a86">ERROR</h1><pre style="color:#f5e9c8;max-width:600px;white-space:pre-wrap">${err.stack || err}</pre>`;
});

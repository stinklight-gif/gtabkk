// Bangkok 3D — Phase 1 Prototype
// Single-file game in vanilla three.js. Procedural geometry, no external assets.
// Sections: Engine · World · Player · Vehicles · AI · Combat · Wanted · Mission · HUD · Loop

import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { makeAudio } from './audio.js';
import { makeInput } from './input.js';
export * from './player.js';
import {
  markSafehouseOwned, storeBuy, update7Eleven, updateBTS, updateCollectibles, updateDistrict, updateGunShop, updateInteraction, updatePlayer, updateSafehouse, vehicleName
} from './player.js';
export * from './vehicles.js';
import {
  STORABLE, collectPaintMats, currentBodyColor, isNearGridLine, killPed, randomPlate, repaintVehicle, respawnTraffic, retrieveVehicle, setVehicleColor, storeVehicle, storedLabel, updateCamera, updateGarage, updateGarageOwnership, updatePlayerInVehicle, updateTrafficCar, updateVehicles
} from './vehicles.js';
export * from './world.js';
import {
  buildWorld, makeMinimapBase, makeWindowTexture
} from './world.js';
export * from './entities.js';
import {
  animateWalk, makeCamera, makeDogMesh, makePedMesh, makePlayer, makeRain, makeVehicle, makeVehicleMesh, sidewalkPos, spawnBoat, spawnDog, spawnDogs, spawnParkedCars, spawnPed, spawnPeds, spawnTraffic
} from './entities.js';
export * from './wanted.js';
import {
  gameOver, killCop, respawnPlayer, spawnCop, spawnCopCar, spawnFortuner, spawnSwat, updateCop, updateFootCops, updateWanted
} from './wanted.js';
export * from './physics.js';
import {
  _skidGeo, _skidMat, makeExplosion, makeSmokeEmitter, resolvePlayerVsBuildings, resolveVehicleVsBuildings, spawnDust, spawnSkid, updateDust, updateParticles, updateSkids
} from './physics.js';
export * from './npcs.js';
import {
  CROWD_CURVE, buildClusterAnchors, crowdFactor, crowdTarget, makeBarkSprite, resyncCrowd, spawnAnchoredPed, spawnBark, spawnSpikeStrip, updateArmorPickups, updateBarks, updateClusters, updateDogs, updateFoodStalls, updateMuggings, updatePeds, updateSpikes, updateVigilante, vigilanteEnd, vigilanteSpawnTarget
} from './npcs.js';
export * from './combat.js';
import {
  cycleWeapon, doBulletRaycast, doMeleeHit, firePistol, fireSMG, fireShotgun, scarePeds, triggerHitStop, updateAmmoHud, updateBullets, updateCombat
} from './combat.js';
export * from './hud.js';
import {
  bindHud
} from './hud.js';
export * from './missions.js';
import {
  makeMissionSystem
} from './missions.js';
export * from './daynight.js';
import {
  DAY_LENGTH, FESTIVAL_PERIOD, KRATHONG_COUNT, RIVER_CX, festivalScheduled, makeKrathong, makeSkyLantern, spawnSkyLantern, startFestival, stopFestival, updateDayNight, updateFestival
} from './daynight.js';
import {
  makeStaticBaker, PI, TAU, clamp, lerp, rand, irand, pick, sign, dist2, COLORS, G,
  PRICE, PAINT_COLORS, ROAD_WIDTH, PED_TARGET, GAMEPLAY, _camTarget, _camOffset, _fireDir,
  _ray, _bbox, _vBox, _blackColor, disposeObject, BLOCK, GRID, HALF, lerpAngle
} from './core.js';

// =============================================================================
// 0. UTILITIES
// =============================================================================

// (moved to ./core.js)

// pooled fire FX lights (created lazily, reused every shot, decayed in the loop)
let _copsKilled = 0;

// Bump wanted level and refresh the "last seen" tracker. Replaces the same
// three-line pattern that was copy-pasted across combat/cop code.
export function raiseWanted(n) {
  const prev = G.wanted.stars;
  G.wanted.stars = Math.max(G.wanted.stars, n);
  G.wanted.lastSeenAt = performance.now();
  G.wanted.lastSeenPos.copy(G.player.group.position);
  if (G.wanted.stars > prev) {                 // escalation feedback
    if (G.hud && G.hud.flashWanted) G.hud.flashWanted();
    if (G.hud) G.hud.showNotif('WANTED ' + '★'.repeat(G.wanted.stars));
    if (G.audio && G.audio.siren) G.audio.siren();
  }
}

// Apply damage to the player, soaking into armor first when enabled.
export function damagePlayer(amount) {
  const p = G.player;
  if (GAMEPLAY.armor && p.armor > 0) {
    const absorbed = Math.min(p.armor, amount * 0.6);
    p.armor -= absorbed;
    amount  -= absorbed;
  }
  p.hp -= amount;
  p.hitFlashT = 0.3;
  p.regenLockT = 5;   // no passive regen for a few seconds after taking a hit
  if (p.hp <= 0) gameOver();
}

// Award credit for a downed cop; first kill hands over the pistol (README).
export function onCopKilled() {
  _copsKilled++;
  if (GAMEPLAY.pistolOnCopKill && _copsKilled === 1 && !G.player.weapons.pistol) {
    G.player.weapons.pistol = true;
    G.player.pistolAmmo = G.player.pistolMag;
    updateAmmoHud();
    G.hud.showNotif('Picked up a 9mm');
  }
  // sustained cop-killing brings out the unmarked Crime Suppression units (3★)
  if (_copsKilled >= 3 && G.wanted.stars < 3) {
    raiseWanted(3);
    G.hud.showNotif('Crime Suppression deployed ★★★');
  }
  if (_copsKilled >= 6 && G.wanted.stars < 4) {
    raiseWanted(4);
    G.hud.showNotif('SWAT deployed ★★★★');
  }
}

// (moved to ./core.js)

// =============================================================================
// 1. AUDIO → ./audio.js

// =============================================================================
// 2. INPUT → ./input.js

// =============================================================================
// → ./world.js
// → ./entities.js
// 8. ENGINE / SCENE INIT
// =============================================================================

// =============================================================================
//  SAVE / LOAD (localStorage) — autosaves money/gear/amulets/time/position
// =============================================================================
const SAVE_KEY = 'gtabkk_save_v1';

export function saveGame() {
  try {
    const p = G.player;
    if (!p) return;
    localStorage.setItem(SAVE_KEY, JSON.stringify({
      cash: G.cash, armor: p.armor, dayT: G.time.dayT, copsKilled: _copsKilled,
      weapons: { pistol: !!p.weapons.pistol, smg: !!p.weapons.smg, shotgun: !!p.weapons.shotgun },
      pistolAmmo: p.pistolAmmo, pistolReserve: p.pistolReserve,
      smgAmmo: p.smgAmmo, smgReserve: p.smgReserve,
      shotgunAmmo: p.shotgunAmmo, shotgunReserve: p.shotgunReserve,
      amulets: (G.world.collectibles || []).map(a => a.taken),
      food: (G.world.foodStalls || []).map(f => f.visited), foodVisited: G.foodVisited || 0,
      collected: G.collected || 0,
      welcomeDone: !!G._welcomeDone,
      soiRunWon: !!G._soiRunWon, hitDone: !!G._hitDone,
      px: p.group.position.x, pz: p.group.position.z,
      // property / ownership economy
      safehouseOwned: !!G.econ.safehouse.owned,
      garageRented: !!G.econ.garage.rented,
      garageStored: G.econ.garage.stored,
    }));
  } catch (e) { /* storage unavailable — ignore */ }
}

const SETTINGS_KEY = 'gtabkk_settings';
export function applySettings() { if (G.audio && G.audio.setVolume) G.audio.setVolume(G.settings.volume); }
export function saveSettings() { try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(G.settings)); } catch (e) {} }
export function loadSettings() {
  G.settings = { sensitivity: 1, volume: 0.55 };
  try { const s = JSON.parse(localStorage.getItem(SETTINGS_KEY)); if (s) Object.assign(G.settings, s); } catch (e) {}
  applySettings();
  const se = document.getElementById('opt-sens'), ve = document.getElementById('opt-vol');
  if (se) se.value = G.settings.sensitivity;
  if (ve) ve.value = G.settings.volume;
}

export function loadGame() {
  let s = null;
  try { s = JSON.parse(localStorage.getItem(SAVE_KEY)); } catch (e) { s = null; }
  if (!s || !G.player) return;
  const p = G.player;
  if (typeof s.cash === 'number') G.cash = s.cash;
  if (typeof s.armor === 'number') p.armor = s.armor;
  if (typeof s.dayT === 'number') G.time.dayT = s.dayT;
  if (typeof s.copsKilled === 'number') _copsKilled = s.copsKilled;
  if (s.weapons) {
    p.weapons.pistol = !!s.weapons.pistol;
    p.weapons.smg = !!s.weapons.smg;
    p.weapons.shotgun = !!s.weapons.shotgun;
    if (typeof s.pistolAmmo === 'number') p.pistolAmmo = s.pistolAmmo;
    if (typeof s.pistolReserve === 'number') p.pistolReserve = s.pistolReserve;
    if (typeof s.smgAmmo === 'number') p.smgAmmo = s.smgAmmo;
    if (typeof s.smgReserve === 'number') p.smgReserve = s.smgReserve;
    if (typeof s.shotgunAmmo === 'number') p.shotgunAmmo = s.shotgunAmmo;
    if (typeof s.shotgunReserve === 'number') p.shotgunReserve = s.shotgunReserve;
  }
  if (Array.isArray(s.amulets) && G.world.collectibles) {
    s.amulets.forEach((taken, i) => {
      const a = G.world.collectibles[i];
      if (taken && a && !a.taken) { a.taken = true; G.scene.remove(a.mesh); }
    });
    G.collected = (typeof s.collected === 'number') ? s.collected : s.amulets.filter(Boolean).length;
  }
  if (Array.isArray(s.food) && G.world.foodStalls) {
    s.food.forEach((v, i) => { const f = G.world.foodStalls[i]; if (v && f && !f.visited) { f.visited = true; f.glowMat.emissiveIntensity = 0; f.glowMat.color.setHex(0x555555); } });
    G.foodVisited = (typeof s.foodVisited === 'number') ? s.foodVisited : s.food.filter(Boolean).length;
  }
  if (typeof s.px === 'number' && typeof s.pz === 'number') p.group.position.set(s.px, 0, s.pz);
  if (s.soiRunWon) G._soiRunWon = true;
  if (s.hitDone) G._hitDone = true;
  if (s.welcomeDone) { G._welcomeDone = true; if (G.mission.resume) G.mission.resume(true); }
  // property / ownership economy
  if (s.safehouseOwned) { G.econ.safehouse.owned = true; markSafehouseOwned(); }
  if (s.garageRented) G.econ.garage.rented = true;
  if (Array.isArray(s.garageStored)) {
    G.econ.garage.stored = s.garageStored
      .filter(v => v && typeof v.kind === 'string')
      .map(v => ({ kind: v.kind, color: v.color | 0, plate: String(v.plate || ''), hp: typeof v.hp === 'number' ? v.hp : 100 }))
      .slice(0, G.econ.garage.capacity);
  }
  G.hud.setCash(G.cash);
  updateAmmoHud();
}

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
  scene.add(sun.target);   // target must be in the scene graph so per-frame re-anchoring takes effect
  G.sun = sun;

  // Hemisphere fill — ground color is warm concrete bounce, not dark soil
  const hemi = new THREE.HemisphereLight(0xa8c7ff, 0x8a7f72, 0.55);
  scene.add(hemi);
  G.hemi = hemi;

  // Ambient at night
  const amb = new THREE.AmbientLight(0x404856, 0.15);
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
  spawnParkedCars(scene);
  spawnBoat(scene);
  // a parked, enterable cop car — the Vigilante ride
  { const v = spawnCopCar(scene, new THREE.Vector3(50, 0, 90)); v.driver = null; v.vel = 0; v.heading = 0; v.mesh.rotation.y = 0; }
  spawnPeds(scene, 60);
  spawnDogs(scene, 16);
  buildClusterAnchors();
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

  // Pause overlay: click to resume (re-locks the pointer)
  const pauseEl = document.getElementById('pause');
  if (pauseEl) pauseEl.addEventListener('click', () => {
    pauseEl.classList.remove('show');
    G.state = 'playing';
    G.input.requestLock();
  });

  // Game-over overlay: click to respawn and resume
  const goEl = document.getElementById('gameover');
  if (goEl) goEl.addEventListener('click', () => {
    goEl.classList.remove('show');
    respawnPlayer();
    G.state = 'playing';
    G.input.requestLock();
  });

  // Options menu sliders
  loadSettings();
  const optSens = document.getElementById('opt-sens');
  if (optSens) optSens.addEventListener('input', e => { G.settings.sensitivity = parseFloat(e.target.value); saveSettings(); });
  const optVol = document.getElementById('opt-vol');
  if (optVol) optVol.addEventListener('input', e => { G.settings.volume = parseFloat(e.target.value); applySettings(); saveSettings(); });

  // 7-Eleven store overlay buttons
  const sbind = (id, fn) => { const el = document.getElementById(id); if (el) el.addEventListener('click', fn); };
  sbind('buy-snack', () => storeBuy('snack'));
  sbind('buy-drink', () => storeBuy('drink'));
  sbind('buy-vest', () => storeBuy('vest'));
  sbind('store-leave', () => { document.getElementById('store').classList.remove('show'); G.state = 'playing'; G.input.requestLock(); });

  // Restore saved progress, then autosave on unload
  loadGame();
  window.addEventListener('beforeunload', saveGame);

  // Start loop
  G.clock = new THREE.Clock();
  loop();
}

export function setProgress(p) {
  const bar = document.getElementById('loadbar');
  if (bar) bar.style.width = p + '%';
}

// =============================================================================
// → ./hud.js
// → ./missions.js
// → ./physics.js
// 12. UPDATE LOOPS — Player / Vehicles / NPCs
// =============================================================================

// → ./player.js

// =============================================================================
// 18. CAMERA UPDATE
// =============================================================================

// → ./daynight.js
// 20. MAIN LOOP
// =============================================================================

// Songthaew taxi job — a free-roam activity (press J in a songthaew). Kept out
// of the mission chain so it doesn't disturb the story missions.
export function updateTaxi(dt) {
  const p = G.player;
  const t = G.taxi || (G.taxi = { stage: 'idle', markerPos: null, dest: null, beam: null, timeLeft: 0, fares: 0, fareValue: 0 });
  const inSong = p.inVehicle && p.inVehicle.kind === 'songthaew';

  if (t.stage !== 'idle' && !inSong) {           // bailed out of the cab
    G.hud.showNotif('Fare bailed.');
    taxiClear(t);
    return;
  }
  if (t.stage === 'idle') {
    if (inSong) {
      G.hud.showPrompt('Press <b>J</b> for a taxi fare', 0.4);
      if (G.input.pressed('KeyJ')) {
        t.stage = 'toPickup';
        t.markerPos = taxiRandPoint(p.inVehicle.pos, 90);
        taxiBeam(t, t.markerPos, 0xffcf4a);
        G.hud.showNotif('New fare — head to the yellow marker');
      }
    }
    return;
  }
  const v = p.inVehicle;
  if (t.stage === 'toPickup') {
    if (dist2(v.pos, t.markerPos) < 7 * 7) {
      t.dest = taxiRandPoint(v.pos, 150);
      t.markerPos = t.dest;
      taxiBeam(t, t.dest, 0x39ff7a);
      const d = Math.sqrt(dist2(v.pos, t.dest));
      t.timeLeft = 25 + d / 9;
      t.fareValue = Math.round(120 + d * 5);
      t.stage = 'toDropoff';
      G.hud.showNotif('Fare aboard — drop them at the green marker');
      G.audio.blip({ freq: 600, dur: 0.08, gain: 0.1 });
    } else {
      G.hud.showPrompt('Taxi: pick up the fare at the marker', 0.4);
    }
  } else if (t.stage === 'toDropoff') {
    t.timeLeft -= dt;
    if (t.timeLeft <= 0) { G.hud.showNotif('Fare gave up — too slow.'); taxiClear(t); return; }
    G.hud.showPrompt(`TAXI &nbsp; ⏱ ${t.timeLeft.toFixed(0)}s &nbsp;→&nbsp; ฿${t.fareValue}`, 0.4);
    if (dist2(v.pos, t.dest) < 8 * 8) {
      G.cash += t.fareValue; t.fares++;
      G.hud.setCash(G.cash);
      G.hud.showNotif(`Dropped off: +฿${t.fareValue} (fares: ${t.fares})`);
      G.audio.blip({ freq: 760, dur: 0.1, gain: 0.12 });
      taxiClear(t);
    }
  }
}
export function taxiRandPoint(from, maxd) {
  for (let tries = 0; tries < 24; tries++) {
    const gi = irand(-GRID/2 + 1, GRID/2 - 1), gj = irand(-GRID/2 + 1, GRID/2 - 1);
    const x = gi * BLOCK + (Math.random() < 0.5 ? -3 : 3), z = gj * BLOCK;
    const dx = x - from.x, dz = z - from.z, d2 = dx*dx + dz*dz;
    if (d2 > 45 * 45 && d2 < maxd * maxd) return new THREE.Vector3(x, 0, z);
  }
  return new THREE.Vector3(clamp(from.x + rand(-80, 80), -HALF + 12, HALF - 12), 0, clamp(from.z + rand(-80, 80), -HALF + 12, HALF - 12));
}
export function taxiBeam(t, pos, color) {
  if (!t.beam) {
    t.beam = new THREE.Mesh(
      new THREE.CylinderGeometry(1.2, 1.2, 80, 12, 1, true),
      new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.2, side: THREE.DoubleSide, depthWrite: false })
    );
    G.scene.add(t.beam);
  }
  t.beam.material.color.setHex(color);
  t.beam.position.set(pos.x, 40, pos.z);
  t.beam.visible = true;
}
export function taxiClear(t) {
  t.stage = 'idle'; t.markerPos = null; t.dest = null;
  if (t.beam) t.beam.visible = false;
}

// Full-screen, north-up map overlay (TAB). Draws the minimap base scaled up plus
// live markers (amulets, mission/taxi, cops, player heading).
let _fullmapCtx = null;
export function drawFullMap() {
  const cv = document.getElementById('fullmap');
  if (!cv) return;
  const ctx = _fullmapCtx || (_fullmapCtx = cv.getContext('2d'));
  const S = cv.width;
  ctx.clearRect(0, 0, S, S);
  if (G.world && G.world.minimap) ctx.drawImage(G.world.minimap, 0, 0, S, S);
  const to = v => (v + HALF) / (2 * HALF) * S;
  // POI labels
  const poi = G.world.poi || {};
  const labels = [
    { p: poi.goldShop, t: "Uncle Seng's" },
    { p: poi.temple, t: 'Temple' },
    { p: poi.yaowarat, t: 'Yaowarat' },
    { p: G.world.gunShop, t: 'Guns' },
    { p: poi.safehouse, t: G.econ.safehouse.owned ? 'Home' : 'Safehouse' },
  ];
  for (const ga of (G.world.garages || [])) labels.push({ p: ga.pos, t: G.econ.garage.rented ? 'Garage' : 'U-Spray' });
  ctx.fillStyle = '#cfe3e0'; ctx.font = '13px system-ui, sans-serif'; ctx.textAlign = 'center';
  for (const L of labels) if (L.p) ctx.fillText(L.t, to(L.p.x), to(L.p.z) - 8);
  ctx.textAlign = 'left';
  if (G.world.collectibles) {
    ctx.fillStyle = '#ffcf4a';
    for (const a of G.world.collectibles) if (!a.taken) {
      ctx.beginPath(); ctx.arc(to(a.mesh.position.x), to(a.mesh.position.z), 3.5, 0, TAU); ctx.fill();
    }
  }
  if (G.mission && G.mission.active && G.mission.active.markerPos) {
    ctx.fillStyle = '#ff2a86';
    ctx.beginPath(); ctx.arc(to(G.mission.active.markerPos.x), to(G.mission.active.markerPos.z), 7, 0, TAU); ctx.fill();
  }
  if (G.taxi && G.taxi.markerPos) {
    ctx.fillStyle = G.taxi.stage === 'toDropoff' ? '#39ff7a' : '#ffcf4a';
    ctx.beginPath(); ctx.arc(to(G.taxi.markerPos.x), to(G.taxi.markerPos.z), 7, 0, TAU); ctx.fill();
  }
  ctx.fillStyle = '#ff3333';
  for (const v of G.vehicles) if (v.isCop && v.driver) { ctx.beginPath(); ctx.arc(to(v.pos.x), to(v.pos.z), 3.5, 0, TAU); ctx.fill(); }
  const px = to(G.player.group.position.x), py = to(G.player.group.position.z);
  const fx = -Math.sin(G.player.yaw), fz = -Math.cos(G.player.yaw);
  ctx.strokeStyle = '#21f0ff'; ctx.lineWidth = 2.5;
  ctx.beginPath(); ctx.moveTo(px, py); ctx.lineTo(px + fx * 14, py + fz * 14); ctx.stroke();
  ctx.fillStyle = '#21f0ff';
  ctx.beginPath(); ctx.arc(px, py, 5, 0, TAU); ctx.fill();
}
export function updateRadio(dt) {
  const a = G.audio; if (!a || !a.radio) return;
  const inV = !!G.player.inVehicle;
  if (G.input && G.input.pressed && G.input.pressed('KeyM') && G.state === 'playing') {
    G.hud.showNotif('📻 ' + a.radio.next());
  }
  if (inV && !G._wasInVehicle) G.hud.showNotif('📻 ' + a.radio.names[a.radio.station]);
  G._wasInVehicle = inV;
  a.radio.tick(inV);
  a.duckEngine(inV && a.radio.station !== 0);
}

// Free-fly camera for photo mode: mouse to look, WASD to fly, Space/Ctrl up/down.
export function updatePhotoCam(dt) {
  const pc = G.photoCam;
  if (!pc) return;
  const [dx, dy] = G.input.consumeMouseDelta();
  const s = 0.0025 * (G.settings ? G.settings.sensitivity : 1);
  pc.yaw -= dx * s;
  pc.pitch = clamp(pc.pitch - dy * s, -1.4, 1.4);
  const cp = Math.cos(pc.pitch), sp = Math.sin(pc.pitch), cy = Math.cos(pc.yaw), sy = Math.sin(pc.yaw);
  const fwd = new THREE.Vector3(sy * cp, sp, cy * cp);
  const right = new THREE.Vector3(cy, 0, -sy);
  const speed = (G.input.down('ShiftLeft') ? 45 : 16) * dt;
  if (G.input.down('KeyW')) pc.pos.addScaledVector(fwd, speed);
  if (G.input.down('KeyS')) pc.pos.addScaledVector(fwd, -speed);
  if (G.input.down('KeyD')) pc.pos.addScaledVector(right, speed);
  if (G.input.down('KeyA')) pc.pos.addScaledVector(right, -speed);
  if (G.input.down('Space')) pc.pos.y += speed;
  if (G.input.down('ControlLeft')) pc.pos.y -= speed;
  pc.pos.y = Math.max(0.5, pc.pos.y);
  G.camera.position.copy(pc.pos);
  G.camera.lookAt(pc.pos.clone().add(fwd));
}

export function loop() {
  requestAnimationFrame(loop);
  const realDt = Math.min(0.05, G.clock.getDelta());
  // hit-stop: a brief global slow-mo on a solid melee/gun connect so impacts land
  let dt = realDt;
  if (G.hitStop > 0) { G.hitStop -= realDt; dt = realDt * 0.12; }

  // phone toggle
  if (G.input && G.input.pressed && G.input.pressed('KeyT') && (G.state === 'playing' || G.state === 'phone')) {
    const open = !document.getElementById('phone').classList.contains('open');
    G.hud.togglePhone(open);
    G.state = open ? 'phone' : 'playing';
    if (open) { document.exitPointerLock(); G.hud.setPhoneStats(); }
    else G.input.requestLock();
  }

  // full-map overlay (TAB)
  if (G.input && G.input.pressed && G.input.pressed('Tab') && (G.state === 'playing' || G.state === 'map')) {
    G.showMap = !G.showMap;
    document.getElementById('fullmap-wrap').classList.toggle('show', G.showMap);
    G.state = G.showMap ? 'map' : 'playing';
    if (G.showMap) document.exitPointerLock(); else G.input.requestLock();
  }

  // minimap zoom (N)
  if (G.input && G.input.pressed && G.input.pressed('KeyN') && G.state === 'playing') {
    const levels = [1, 1.7, 2.6];
    G.minimapZoom = levels[(levels.indexOf(G.minimapZoom || 1) + 1) % levels.length];
  }

  // photo mode (P): free-fly camera + hidden HUD, sim paused
  if (G.input && G.input.pressed && G.input.pressed('KeyP') && (G.state === 'playing' || G.state === 'photo')) {
    if (G.state === 'photo') {
      G.state = 'playing';
      document.getElementById('hud').classList.remove('hidden');
    } else {
      G.state = 'photo';
      document.getElementById('hud').classList.add('hidden');
      G.photoCam = { pos: G.camera.position.clone(), yaw: G.camRig.yaw, pitch: G.camRig.pitch };
    }
  }

  // options menu (O)
  if (G.input && G.input.pressed && G.input.pressed('KeyO') && (G.state === 'playing' || G.state === 'options')) {
    if (G.state === 'options') {
      G.state = 'playing';
      document.getElementById('options').classList.remove('show');
      G.input.requestLock();
    } else {
      G.state = 'options';
      document.getElementById('options').classList.add('show');
      document.exitPointerLock();
    }
  }

  if (G.state === 'playing') {
    updatePlayer(dt);
    updateDistrict();
    updateCollectibles(dt);
    updateFoodStalls(dt);
    updateArmorPickups(dt);
    updateInteraction(dt);
    updateGarage(dt);
    updateGarageOwnership(dt);
    updateRadio(dt);
    updateTaxi(dt);
    updateVehicles(dt);
    updatePeds(dt);
    updateClusters(dt);
    updateBarks(dt);
    updateMuggings(dt);
    updateSpikes(dt);
    updateVigilante(dt);
    updateDogs(dt);
    updateFootCops(dt);
    updateBullets(dt);
    updateParticles(dt);
    updateSkids(dt);
    updateDust(dt);
    updateWanted(dt);
    updateCamera(dt);
    updateBTS(dt);
    updateDayNight(dt);
    updateFestival(dt);
    // distant daytime traffic honks (ambient flavor)
    if (Math.random() < 0.004 * (1 - (G.nightK || 0))) G.audio.blip({ freq: 360, dur: 0.2, type: 'square', gain: 0.03, freqEnd: 330 });
    G._saveTimer = (G._saveTimer || 0) + dt;
    if (G._saveTimer > 8) { G._saveTimer = 0; saveGame(); }
    // one-time 100% celebration (cheap: amulet counter + 3 mission flags)
    if (!G._congrats) {
      const ms = (G._welcomeDone ? 1 : 0) + (G._soiRunWon ? 1 : 0) + (G._hitDone ? 1 : 0);
      const total = G.world.collectibles ? G.world.collectibles.length : 15;
      if ((G.collected || 0) / Math.max(1, total) * 70 + ms / 3 * 30 >= 99.5) {
        G._congrats = true;
        G.hud.showSubtitle('100% — KING OF KRUNG THEP', 'เจ้าพ่อกรุงเทพฯ', 5);
        G.hud.showNotif('100% complete!');
        if (G.audio.bell) G.audio.bell();
      }
    }
    // passive HP regen when out of combat for a few seconds
    if (G.player.regenLockT > 0) G.player.regenLockT -= dt;
    else if (G.player.hp < G.player.hpMax) G.player.hp = Math.min(G.player.hpMax, G.player.hp + 5 * dt);
    if (G.mission) G.mission.update(dt);
    G.hud.update(dt);
    G.hud.setBars(G.player.hp, G.player.armor, G.player.stam);
    G.hud.setVehicle(G.player.inVehicle ? G.player.inVehicle.hp : 0, !!G.player.inVehicle);
    G.hud.setCash(G.cash);
    G.hud.drawMinimap(G.player);
    if (G.input.endFrame) G.input.endFrame();
  } else if (G.state === 'phone') {
    updateCamera(dt);
    if (G.input.endFrame) G.input.endFrame();
  } else if (G.state === 'map') {
    drawFullMap();
    if (G.input.endFrame) G.input.endFrame();
  } else if (G.state === 'paused') {
    if (G.input.endFrame) G.input.endFrame();
  } else if (G.state === 'dead') {
    if (G.input.endFrame) G.input.endFrame();
  } else if (G.state === 'photo') {
    updatePhotoCam(dt);
    if (G.input.endFrame) G.input.endFrame();
  } else if (G.state === 'options') {
    if (G.input.endFrame) G.input.endFrame();
  } else if (G.state === 'store') {
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

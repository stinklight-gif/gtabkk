// Bangkok 3D — Phase 1 Prototype
// Single-file game in vanilla three.js. Procedural geometry, no external assets.
// Sections: Engine · World · Player · Vehicles · AI · Combat · Wanted · Mission · HUD · Loop

import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { makeAudio } from './audio.js';
import { makeInput } from './input.js';
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

export function updatePlayer(dt) {
  const p = G.player;
  if (p.inVehicle) { updatePlayerInVehicle(dt); return; }

  // mouse look
  const [dx, dy] = G.input.consumeMouseDelta();
  const sens = 0.0024 * (G.settings ? G.settings.sensitivity : 1);
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

  // 7-Eleven proximity — snacks restore HP, a vest tops up armor
  for (const e of G.world.sevenElevens) {
    if (dist2(p.group.position, e.pos) < 7*7) {
      if (Date.now() - e.chimed > 4000) {
        G.audio.chime(); e.chimed = Date.now();
        const healed = p.hp < p.hpMax;
        const vested = GAMEPLAY.armor && p.armor < 50;
        if (healed) p.hp = p.hpMax;
        if (vested) p.armor = 50;
        if (healed || vested) {
          G.hud.showNotif('7-Eleven — ' + (healed && vested ? 'HP & armor restored' : healed ? 'HP restored' : 'armor restored'));
        }
      }
    }
  }
}

// Show a banner when the player crosses into a named district.
export function updateDistrict() {
  const p = G.player.group.position;
  const poi = G.world.poi;
  let zone;
  if (p.x < -185) zone = { en: 'Riverside', th: 'ริมแม่น้ำ' };
  else if (poi.yaowarat && dist2(p, poi.yaowarat) < 62*62) zone = { en: 'Yaowarat', th: 'เยาวราช' };
  else if (poi.temple && dist2(p, poi.temple) < 46*46) zone = { en: 'The Wat', th: 'วัด' };
  else zone = { en: 'Sukhumvit', th: 'สุขุมวิท' };
  if (zone.en !== G._districtName) {
    const first = G._districtName === undefined;   // don't banner the spawn district
    G._districtName = zone.en;
    if (!first) G.hud.showSubtitle(zone.en, zone.th, 2.2);
  }
}

// Slide the Skytrain back and forth along the elevated track.
export function updateBTS(dt) {
  const b = G.bts;
  if (!b) return;
  b.mesh.position.x += b.dir * b.speed * dt;
  if (b.mesh.position.x > b.max) b.dir = -1;
  else if (b.mesh.position.x < b.min) b.dir = 1;
  // rumble as the train passes over a player near the track (z≈0)
  const dx = b.mesh.position.x - G.player.group.position.x;
  if ((b._dxPrev || 0) * dx < 0 && Math.abs(G.player.group.position.z) < 45 && G.audio.rumble) G.audio.rumble();
  b._dxPrev = dx;
}

// Spin/bob the hidden amulets and collect them on touch.
export function updateCollectibles(dt) {
  const cs = G.world.collectibles;
  if (!cs) return;
  const pp = G.player.group.position;
  const tnow = performance.now() * 0.003;
  for (const a of cs) {
    if (a.taken) continue;
    a.mesh.rotation.y += dt * 2;
    a.mesh.position.y = 1.3 + Math.sin(tnow + a.mesh.position.x) * 0.15;
    if (dist2(a.mesh.position, pp) < 2.6 * 2.6) {
      a.taken = true;
      G.scene.remove(a.mesh);
      G.collected = (G.collected || 0) + 1;
      G.cash += 100;
      G.hud.setCash(G.cash);
      G.audio.blip({ freq: 880, dur: 0.1, gain: 0.12 });
      if (G.collected >= cs.length) {
        G.cash += 3000; G.hud.setCash(G.cash);
        G.hud.showNotif(`All ${cs.length} amulets found! +฿2,000`);
      } else {
        G.hud.showNotif(`Amulet ${G.collected}/${cs.length} (+฿100)`);
      }
    }
  }
}

export function updatePlayerInVehicle(dt) {
  const p = G.player;
  const v = p.inVehicle;
  // vehicle destroyed under the player — blow it and kick them out
  if (v.hp <= 0 && !v.fire) {
    v.fire = true; v.dead = true; v.driver = null;
    p.inVehicle = null; p.group.visible = true;
    p.group.position.set(v.pos.x + Math.cos(v.heading) * 1.8, 0, v.pos.z - Math.sin(v.heading) * 1.8);
    v.mesh.children.forEach(c => { if (c.material && c.material.color) c.material.color.lerp(_blackColor, 0.6); });
    makeExplosion(v.pos);
    damagePlayer(20);
    setTimeout(() => {
      const i = G.vehicles.indexOf(v); if (i >= 0) G.vehicles.splice(i, 1);
      G.scene.remove(v.mesh); disposeObject(v.mesh);
    }, 6000);
    return;
  }
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
  const speedMul = v.tiresBlown ? 0.5 : 1;   // spike strips halve your top speed
  v.vel = clamp(v.vel, -spec.topSpeed * 0.4 * speedMul, spec.topSpeed * (boost ? 1.15 : 1) * speedMul);
  // steering — speed dependent
  const steerRate = spec.turn * (1 - Math.min(1, Math.abs(v.vel)/spec.topSpeed) * 0.4);
  v.heading += steer * steerRate * dt * (v.vel >= 0 ? 1 : -1) * (Math.abs(v.vel)>0.3 ? 1 : 0);
  // arcade handbrake drift: extra oversteer + lay rubber while sliding
  if (handbrake && Math.abs(v.vel) > 6 && Math.abs(steer) > 0.15 && spec.kind !== 'boat' && spec.kind !== 'bike') {
    v.heading += steer * 1.5 * dt * (v.vel >= 0 ? 1 : -1);
    spawnSkid(v);
  }

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
  if (v.spec.kind === 'boat') {            // keep the boat in the river channel
    v.pos.x = clamp(v.pos.x, -248, -210);
    v.pos.z = clamp(v.pos.z, -246, 246);
    v.pos.y = 0.3;
  }
  v.mesh.position.copy(v.pos);
  v.mesh.rotation.y = v.heading;

  if (v.spec.kind !== 'boat') resolveVehicleVsBuildings(v);

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

  // drive-by: fire the active gun from the vehicle (combat update doesn't run here)
  if (p.attackCooldown > 0) p.attackCooldown -= dt;
  if (p.gunRecoil > 0) p.gunRecoil = Math.max(0, p.gunRecoil - dt * 6);
  if (G.input.pressed('KeyQ')) cycleWeapon();
  if (p.activeWeapon !== 'fists' && p.weapons[p.activeWeapon]) {
    G.hud.setCrosshair(G.input.rightDown);
    const w = p.activeWeapon;            // 'pistol' | 'smg' | 'shotgun'
    const ammo = w + 'Ammo';
    const cd = w === 'smg' ? 0.07 : w === 'shotgun' ? 0.8 : 0.18;
    if (G.input.mouseDown && p.attackCooldown <= 0 && p[ammo] > 0) {
      if (w === 'smg') fireSMG(); else if (w === 'shotgun') fireShotgun(); else firePistol();
      p[ammo]--; p.attackCooldown = cd; p.gunRecoil = 1;
      updateAmmoHud();
    }
  } else {
    G.hud.setCrosshair(false);
  }

  // crashing into things — handled by vehicle vs vehicle below

  // ramming peds
  for (const ped of G.peds) {
    if (ped.dead) continue;
    if (dist2(ped.mesh.position, v.pos) < 1.6*1.6 && Math.abs(v.vel) > 4) {
      killPed(ped);
      raiseWanted(2);
      G.hud.showNotif('Hit & Run! +Wanted Star');
    }
  }
}

// (moved to ./core.js)

export function killPed(ped) {
  if (ped.dead) return;
  ped.dead = true;
  // ragdoll: flatten
  ped.mesh.rotation.x = PI/2;
  ped.mesh.position.y = 0.05;
  G.audio.hit();
  setTimeout(() => {
    G.scene.remove(ped.mesh);
    disposeObject(ped.mesh);
    const i = G.peds.indexOf(ped); if (i >= 0) G.peds.splice(i, 1);
  }, 8000);
}

export function updateVehicles(dt) {
  for (const v of G.vehicles) {
    if (v.dead) continue;
    if (v.lights) {
      const base = G.nightK || 0;
      v.lights[0].emissiveIntensity = base;   // headlights
      const braking = v.driver === 'player' && (G.input.down('KeyS') || G.input.down('Space'));
      v.lights[1].emissiveIntensity = braking ? Math.max(base, 0.9) : base;  // tail/brake lights
    }
    if (v.driver === 'player') continue;
    if (v.isCop && v.driver) updateCop(v, dt);
    else if (v.npc) updateTrafficCar(v, dt);
    // damage smoke
    if (v.hp < 30 && !v.smoke) {
      v.smoke = makeSmokeEmitter(v.mesh.position, 0.5);
    }
    if (v.hp <= 0 && !v.fire) {
      v.fire = true;
      v.dead = true;
      v.driver = null;
      v.mesh.children.forEach(c => { if (c.material && c.material.color) c.material.color.lerp(_blackColor, 0.6); });
      makeExplosion(v.pos);
      v.vel = 0;
      if (v.isCop) { raiseWanted(2); onCopKilled(); }
      if (v.kind === 'fortuner' && !G.player.weapons.smg) {
        G.player.weapons.smg = true;
        G.player.smgAmmo = G.player.smgMag;
        G.hud.showNotif('Picked up an SMG');
      }
      if (v.smoke) v.smoke.life = 0;   // stop the damage smoke
      // remove the wreck after a delay, freeing its GPU resources
      setTimeout(() => {
        const i = G.vehicles.indexOf(v);
        if (i >= 0) G.vehicles.splice(i, 1);
        G.scene.remove(v.mesh);
        disposeObject(v.mesh);
      }, 6000);
    }
  }
}

export function updateTrafficCar(v, dt) {
  const npc = v.npc;
  // simple grid following: pick a heading aligned with the road, choose new heading at intersections
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

export function isNearGridLine(v) {
  const m = ((v + HALF) % BLOCK) - BLOCK/2;
  return Math.abs(m) < 1.5;
}

export function respawnTraffic(v, playerPos) {
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
// → ./npcs.js
// → ./combat.js
// → ./wanted.js
// 17. INTERACTION — get in/out of vehicle
// =============================================================================

export function updateInteraction(dt) {
  const p = G.player;
  if (p.inVehicle) return;

  // Inside the garage shed, let updateGarageOwnership own the E key (rent/retrieve)
  // so the enter-vehicle prompt doesn't fight it. The garage door sits just
  // outside this radius, so a car parked/retrieved there is still enterable.
  const gg = G.world.garages && G.world.garages[0];
  if (gg && dist2(p.group.position, gg.pos) < gg.r * gg.r) return;

  // find nearest vehicle within reach that isn't a cop unit or a burning wreck
  let near = null, nd = Infinity;
  for (const v of G.vehicles) {
    if (v.driver || v.dead) continue; // occupied/cop/player, or a wreck about to despawn
    const d2 = dist2(v.pos, p.group.position);
    if (d2 < 8 && d2 < nd) { nd = d2; near = v; }
  }
  if (near) {
    G.hud.showPrompt('Press <b>E</b> to enter ' + vehicleName(near.kind), 0.5);
    if (G.input.pressed('KeyE')) {
      p.inVehicle = near;
      near.driver = 'player';
      near.npc = null;   // take over from the traffic AI if it was a moving car
      G.audio.blip({freq:300, dur:0.05, gain:0.08});
    }
  } else {
    updateGunShop(dt);   // E does shop business only when no vehicle is in reach
    update7Eleven(dt);
    updateSafehouse(dt);
  }
}

// Enter a 7-Eleven (on foot) to open the store overlay.
export function update7Eleven(dt) {
  const p = G.player;
  for (const e of G.world.sevenElevens) {
    if (dist2(p.group.position, e.pos) < 5 * 5) {
      G.hud.showPrompt('Press <b>E</b> to enter <b>7-Eleven</b>', 0.4);
      if (G.input.pressed('KeyE')) {
        G.state = 'store';
        document.getElementById('store').classList.add('show');
        document.exitPointerLock();
      }
      return;
    }
  }
}
// Safehouse (on foot at the door): buy it once, then rest to heal + save. Owning
// it makes it your respawn point instead of the police station.
export function updateSafehouse(dt) {
  const p = G.player;
  const door = G.world.poi && G.world.poi.safehouse;
  if (!door || dist2(p.group.position, door) > 6 * 6) return;
  const sh = G.econ.safehouse;
  if (!sh.owned) {
    G.hud.showPrompt(`Safehouse for sale — <b>E</b>: buy (฿${PRICE.safehouse.toLocaleString()})`, 0.4);
    if (G.input.pressed('KeyE')) {
      if (G.cash < PRICE.safehouse) { G.hud.showNotif('Not enough cash for the safehouse'); return; }
      G.cash -= PRICE.safehouse; G.hud.setCash(G.cash);
      sh.owned = true;
      markSafehouseOwned();
      G.hud.showNotif('Safehouse bought — you respawn here now');
      G.audio.chime();
      saveGame();
    }
  } else {
    G.hud.showPrompt('Home — <b>E</b>: rest (heal + save)', 0.4);
    if (G.input.pressed('KeyE')) {
      p.hp = p.hpMax; if (typeof p.stam === 'number') p.stam = p.stamMax;
      G.hud.showNotif('Rested at home — healed & saved');
      G.audio.chime();
      saveGame();
    }
  }
}
export function markSafehouseOwned() {
  const m = G.world.safehouseSign;
  if (m) { m.color.setHex(0x39ff7a); m.emissive.setHex(0x39ff7a); }   // FOR SALE → HOME
}

export function storeBuy(item) {
  const p = G.player;
  let ok = false;
  if (item === 'snack' && G.cash >= 20) { G.cash -= 20; p.hp = Math.min(p.hpMax, p.hp + 40); ok = true; }
  else if (item === 'drink' && G.cash >= 30) { G.cash -= 30; p.stam = p.stamMax; ok = true; }
  else if (item === 'vest' && G.cash >= 200) { G.cash -= 200; p.armor = p.armorMax; ok = true; }
  if (ok) { G.hud.setCash(G.cash); G.audio.chime(); }
  else G.hud.showNotif('Not enough cash');
}

// Gun shop: on foot in the shop zone, E buys the next thing you need (then ammo).
export function updateGunShop(dt) {
  const p = G.player;
  const shop = G.world.gunShop;
  if (!shop || dist2(p.group.position, shop) > 7 * 7) return;
  let label, cost, action;
  if (!p.weapons.pistol)    { label = 'Buy 9mm Pistol'; cost = 800;  action = 'pistol'; }
  else if (!p.weapons.shotgun) { label = 'Buy Shotgun'; cost = 2500; action = 'shotgun'; }
  else if (!p.weapons.smg)  { label = 'Buy SMG';        cost = 4000; action = 'smg'; }
  else                      { label = 'Buy ammo';       cost = 300;  action = 'ammo'; }
  G.hud.showPrompt(`Gun shop — <b>E</b>: ${label} (฿${cost})`, 0.4);
  if (G.input.pressed('KeyE')) {
    if (G.cash < cost) { G.hud.showNotif('Not enough cash'); return; }
    G.cash -= cost; G.hud.setCash(G.cash);
    if (action === 'pistol')   { p.weapons.pistol = true; p.pistolAmmo = p.pistolMag; p.pistolReserve = p.pistolMag * 3; }
    else if (action === 'smg') { p.weapons.smg = true; p.smgAmmo = p.smgMag; p.smgReserve = p.smgMag * 3; }
    else if (action === 'shotgun') { p.weapons.shotgun = true; p.shotgunAmmo = p.shotgunMag; p.shotgunReserve = p.shotgunMag * 3; }
    else { p.pistolReserve += p.pistolMag * 3; if (p.weapons.smg) p.smgReserve += p.smgMag * 3; if (p.weapons.shotgun) p.shotgunReserve += p.shotgunMag * 3; }
    updateAmmoHud();
    G.hud.showNotif(label + ' ✓');
    G.audio.blip({ freq: 600, dur: 0.1, gain: 0.12 });
  }
}

export function vehicleName(k) {
  return { bike: 'motorbike', tuktuk: 'tuk-tuk', hilux: 'pickup', camry: 'car', sedan: 'sedan', cop: 'cop pickup', fortuner: 'unmarked SUV', swat: 'SWAT van', songthaew: 'songthaew', boat: 'longtail boat', bus: 'bus', luxsedan: 'luxury sedan', supercar: 'supercar' }[k] || k;
}

// =============================================================================
// 18. CAMERA UPDATE
// =============================================================================

export function updateCamera(dt) {
  const p = G.player;
  const rig = G.camRig;
  // shake decay
  rig.shake *= Math.pow(0.001, dt);
  const shakeX = (Math.random()*2-1) * rig.shake;
  const shakeY = (Math.random()*2-1) * rig.shake;

  if (p.inVehicle) {
    _camTarget.copy(p.inVehicle.pos); _camTarget.y += 1.2;
    // chase camera: ride behind the vehicle heading, but slow yaw follow lets player look around
    const followYaw = p.inVehicle.heading + PI; // behind
    rig.yaw = lerpAngle(rig.yaw, followYaw, dt * 1.4);
    rig.targetDistance = p.inVehicle.spec.kind === 'bike' ? 4.8 : 6.5;
  } else {
    _camTarget.copy(p.group.position); _camTarget.y += 1.5;
    rig.targetDistance = 4.5;
  }
  rig.distance = lerp(rig.distance, rig.targetDistance, 0.08);
  const cy = Math.cos(rig.yaw), sy = Math.sin(rig.yaw);
  const cp = Math.cos(rig.pitch), sp = Math.sin(rig.pitch);
  _camOffset.set(sy * cp, -sp, cy * cp);                 // unit direction target → camera
  // Occlusion: never let the camera sit inside a building. Cast target → camera
  // against nearby building AABBs and pull the camera in to just shy of the wall.
  let camDist = rig.distance;
  _ray.ray.origin.copy(_camTarget);
  _ray.ray.direction.copy(_camOffset);
  for (const b of G.world.buildings) {
    if (dist2(b.pos, _camTarget) > 50 * 50) continue;
    _bbox.min.set(b.pos.x - b.size.x / 2, b.pos.y - b.size.y / 2, b.pos.z - b.size.z / 2);
    _bbox.max.set(b.pos.x + b.size.x / 2, b.pos.y + b.size.y / 2, b.pos.z + b.size.z / 2);
    const hit = _ray.ray.intersectBox(_bbox, _vBox);
    if (hit) { const d = _camTarget.distanceTo(hit) - 0.4; if (d < camDist) camDist = Math.max(1.1, d); }
  }
  rig.cam.position.copy(_camTarget).addScaledVector(_camOffset, camDist);
  rig.cam.position.x += shakeX; rig.cam.position.y += shakeY + 0.6;
  rig.cam.lookAt(_camTarget);
  // speed-based FOV kick while driving — a little sense of velocity
  const sp01 = p.inVehicle ? Math.min(1, Math.abs(p.inVehicle.vel) / p.inVehicle.spec.topSpeed) : 0;
  const targetFov = 72 + sp01 * 14;
  if (Math.abs(rig.cam.fov - targetFov) > 0.05) { rig.cam.fov = lerp(rig.cam.fov, targetFov, 0.06); rig.cam.updateProjectionMatrix(); }
}

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

export function updateGarage(dt) {
  const p = G.player;
  if (!p.inVehicle || !G.world.garages) return;
  const v = p.inVehicle;
  for (const g of G.world.garages) {
    if (dist2(v.pos, g.pos) >= g.r * g.r) continue;
    const now = performance.now();
    if (now < g.cooldownUntil) return;
    const needsService = G.wanted.stars > 0 || v.hp < 100;
    if (!needsService) { G.hud.showPrompt('U-Spray — nothing to fix', 0.4); return; }
    const fee = 300 + G.wanted.stars * 350;   // pricier the hotter you are
    if (G.cash < fee) { G.hud.showPrompt(`U-Spray needs <b>฿${fee}</b>`, 0.4); return; }
    // pay, repair, and shed the heat
    G.cash -= fee;
    v.hp = 100;
    v.tiresBlown = false;   // respray patches the tires too
    if (v.smoke) { v.smoke.life = 0; v.smoke = null; }
    G.wanted.stars = 0;
    G.wanted.lastSeenAt = now;
    // clear every active cop (foot + vehicles)
    for (let i = G.cops.length - 1; i >= 0; i--) {
      G.scene.remove(G.cops[i].mesh); disposeObject(G.cops[i].mesh); G.cops.splice(i, 1);
    }
    for (let i = G.vehicles.length - 1; i >= 0; i--) {
      if (G.vehicles[i].isCop) { G.scene.remove(G.vehicles[i].mesh); disposeObject(G.vehicles[i].mesh); G.vehicles.splice(i, 1); }
    }
    G.hud.setCash(G.cash);
    G.hud.setStars(0);
    G.hud.showNotif(`Resprayed — repaired & lost the cops (-฿${fee})`);
    G.audio.blip({ freq: 520, dur: 0.12, gain: 0.12 });
    g.cooldownUntil = now + 8000;
    return;
  }
}

// ---- Garage ownership: rent the U-Spray, store/retrieve + repaint vehicles ----
const STORABLE = new Set(['bike', 'tuktuk', 'hilux', 'camry', 'sedan', 'songthaew', 'bus', 'luxsedan', 'supercar']);

// The repaintable body materials of a vehicle: its biggest non-wheel/non-glass
// MeshStandard parts (body + cab), found once and cached on the vehicle.
export function collectPaintMats(mesh) {
  const items = [];
  mesh.traverse(o => {
    if (!o.isMesh || !o.material || !o.material.isMeshStandardMaterial) return;
    if (o.geometry.type === 'CylinderGeometry') return;     // wheels
    if (!o.geometry.boundingBox) o.geometry.computeBoundingBox();
    const b = o.geometry.boundingBox;
    items.push({ mat: o.material, v: (b.max.x - b.min.x) * (b.max.y - b.min.y) * (b.max.z - b.min.z) });
  });
  items.sort((a, b) => b.v - a.v);
  const mats = [], seen = new Set();
  for (const it of items) { if (seen.has(it.mat)) continue; seen.add(it.mat); mats.push(it.mat); if (mats.length >= 2) break; }
  return mats;
}
export function setVehicleColor(v, hex) {
  if (!v.paintMats) v.paintMats = collectPaintMats(v.mesh);
  for (const m of v.paintMats) m.color.setHex(hex);
  v.color = hex;
}
export function currentBodyColor(v) {
  if (typeof v.color === 'number') return v.color;
  const m = v.paintMats || collectPaintMats(v.mesh);
  return m.length ? m[0].color.getHex() : 0xcccccc;
}
export function randomPlate() {
  const t = ['กก', 'ขข', 'งง', 'รด', 'สห', 'ทพ', 'มล', 'ญบ', 'ผด', 'นค'];
  return `${irand(1, 9)}${pick(t)} ${irand(1000, 9999)}`;
}
export function storedLabel(e) { return `${vehicleName(e.kind)}${e.plate ? ' ' + e.plate : ''}`; }

export function storeVehicle(v) {
  const garage = G.econ.garage, p = G.player, g = G.world.garages[0];
  const entry = { kind: v.kind, color: currentBodyColor(v), plate: v.plate || randomPlate(), hp: Math.max(40, Math.round(v.hp)) };
  garage.stored.push(entry);
  // step the player out at the garage, then despawn the stored car
  p.inVehicle = null; v.driver = null; p.group.visible = true;
  p.group.position.set(g.pos.x, 0, g.pos.z - 5);
  G.scene.remove(v.mesh); disposeObject(v.mesh);
  const vi = G.vehicles.indexOf(v); if (vi >= 0) G.vehicles.splice(vi, 1);
  G.hud.showNotif(`Stored ${storedLabel(entry)} (${garage.stored.length}/${garage.capacity})`);
  G.audio.chime();
  saveGame();
}
export function retrieveVehicle(idx) {
  const garage = G.econ.garage;
  const e = garage.stored[idx];
  if (!e) return;
  const v = makeVehicle(e.kind, G.scene);
  const door = G.world.garageDoor || G.world.garages[0].pos;
  v.pos.set(door.x, 0, door.z); v.mesh.position.copy(v.pos);
  v.heading = PI; v.mesh.rotation.y = PI;
  v.hp = e.hp; v.plate = e.plate;
  setVehicleColor(v, e.color);
  garage.stored.splice(idx, 1);
  garage.retrieveIdx = 0;
  G.hud.showNotif(`Brought out ${storedLabel(e)} — at the garage door`);
  G.audio.blip({ freq: 320, dur: 0.06, gain: 0.08 });
  saveGame();
}
export function repaintVehicle(v) {
  if (G.cash < PRICE.repaint) { G.hud.showNotif('Not enough cash to repaint'); return; }
  G.cash -= PRICE.repaint; G.hud.setCash(G.cash);
  const cur = currentBodyColor(v);
  let i = PAINT_COLORS.indexOf(cur); i = (i + 1) % PAINT_COLORS.length;
  setVehicleColor(v, PAINT_COLORS[i]);
  if (!v.plate) v.plate = randomPlate();
  G.hud.showNotif(`Repainted — new plate ${v.plate} (-฿${PRICE.repaint})`);
  G.audio.chime();
  saveGame();
}

export function updateGarageOwnership(dt) {
  const p = G.player;
  if (!G.world.garages || !G.world.garages.length) return;
  const g = G.world.garages[0], garage = G.econ.garage;
  if (p.inVehicle) {
    const v = p.inVehicle;
    if (dist2(v.pos, g.pos) >= (g.r + 1) * (g.r + 1)) return;
    if (!garage.rented) { G.hud.showPrompt('Garage — step out and rent it to store cars here', 0.4); return; }
    if (!STORABLE.has(v.kind)) return;                      // cop cars / boats aren't storable
    // only claim the prompt line when U-Spray isn't already offering a repair
    const servicing = v.hp < 100 || G.wanted.stars > 0;
    const full = garage.stored.length >= garage.capacity;
    if (!servicing) {
      G.hud.showPrompt(full
        ? `Garage full — <b>C</b>: repaint (฿${PRICE.repaint})`
        : `Garage — <b>K</b>: store this ${vehicleName(v.kind)} · <b>C</b>: repaint (฿${PRICE.repaint})`, 0.4);
    }
    if (G.input.pressed('KeyK') && !full) storeVehicle(v);
    else if (G.input.pressed('KeyC')) repaintVehicle(v);
  } else {
    if (dist2(p.group.position, g.pos) >= g.r * g.r) return;
    if (!garage.rented) {
      G.hud.showPrompt(`Garage — <b>E</b>: rent (฿${PRICE.garageRent.toLocaleString()})`, 0.4);
      if (G.input.pressed('KeyE')) {
        if (G.cash < PRICE.garageRent) { G.hud.showNotif('Not enough cash to rent the garage'); return; }
        G.cash -= PRICE.garageRent; G.hud.setCash(G.cash); garage.rented = true;
        G.hud.showNotif('Garage rented — drive vehicles in to store & repaint them');
        G.audio.chime(); saveGame();
      }
      return;
    }
    if (garage.stored.length === 0) { G.hud.showPrompt('Garage — drive a vehicle in to store it', 0.4); return; }
    const idx = garage.retrieveIdx % garage.stored.length;
    const e = garage.stored[idx];
    G.hud.showPrompt(`Garage — <b>E</b>: take ${storedLabel(e)} (${idx + 1}/${garage.stored.length}) · <b>L</b>: next`, 0.4);
    if (G.input.pressed('KeyL')) garage.retrieveIdx = (idx + 1) % garage.stored.length;
    else if (G.input.pressed('KeyE')) retrieveVehicle(idx);
  }
}

// Car radio: M cycles stations; music plays (and ducks the engine) only while
// you're in a vehicle, and flashes the station name on the HUD.
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

// Bangkok 3D — Phase 1 Prototype
// Single-file game in vanilla three.js. Procedural geometry, no external assets.
// Sections: Engine · World · Player · Vehicles · AI · Combat · Wanted · Mission · HUD · Loop

import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { makeAudio } from './audio.js';
import { makeInput } from './input.js';
export * from './player.js';
import {
  markSafehouseOwned, applyCosmetics, closeBank, update7Eleven, updateBank, updateBTS, updateCollectibles, updateDistrict, updateGunShop, updateInteraction, updatePlayer, updateSafehouse, vehicleName
} from './player.js';
export * from './vehicles.js';
import {
  STORABLE, collectPaintMats, currentBodyColor, isNearGridLine, killPed, randomPlate, repaintVehicle, respawnTraffic, retrieveVehicle, setVehicleColor, storeVehicle, storedLabel, updateCamera, updateGarage, updateGarageOwnership, updatePlayerInVehicle, updateTrafficCar, updateVehicles, closeUpgrades, applyUpgrades
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
  CROWD_CURVE, buildClusterAnchors, crowdFactor, crowdTarget, makeBarkSprite, resyncCrowd, spawnAnchoredPed, spawnBark, spawnSpikeStrip, updateArmorPickups, updateBarks, updateClusters, updateDogs, updateFoodStalls, updateMuggings, updatePeds, updateSpikes, updateTurf, updateVigilante, vigilanteEnd, vigilanteSpawnTarget
} from './npcs.js';
export * from './combat.js';
import {
  cycleWeapon, doBulletRaycast, doMeleeHit, firePistol, fireSMG, fireShotgun, scarePeds, triggerHitStop, updateAmmoHud, updateBullets, updateCombat
} from './combat.js';
export * from './hud.js';
import {
  bindHud, drawHouseGlyph, drawGarageGlyph, drawMallGlyph, drawBizGlyph, drawBtsGlyph, drawBoatGlyph, drawBankGlyph, drawTurfGlyph,
  HOME_COLOR, GARAGE_COLOR, MALL_COLOR, BIZ_COLOR, BTS_COLOR, SEVEN_COLOR, BOAT_COLOR, BANK_COLOR, TURF_COLOR
} from './hud.js';
export * from './missions.js';
import {
  makeMissionSystem
} from './missions.js';
export * from './daynight.js';
import {
  DAY_LENGTH, FESTIVAL_PERIOD, KRATHONG_COUNT, RIVER_CX, scheduledFestival, makeKrathong, makeSkyLantern, spawnSkyLantern, startFestival, stopFestival, updateDayNight, updateFestival
} from './daynight.js';
import {
  makeStaticBaker, PI, TAU, clamp, lerp, rand, irand, pick, sign, dist2, COLORS, G,
  PRICE, PAINT_COLORS, BUSINESSES, TURFS, missionMilestones, ROAD_WIDTH, PED_TARGET, GAMEPLAY, _camTarget, _camOffset, _fireDir,
  _ray, _bbox, _vBox, _blackColor, disposeObject, BLOCK, GRID, HALF, lerpAngle
} from './core.js';

// =============================================================================
// 0. UTILITIES
// =============================================================================

// (moved to ./core.js)

// pooled fire FX lights (created lazily, reused every shot, decayed in the loop)
// cops-killed count lives on G.copsKilled (shared with hud.js setPhoneStats)

// Bump wanted level and refresh the "last seen" tracker. Replaces the same
// three-line pattern that was copy-pasted across combat/cop code.
export function raiseWanted(n) {
  if (G.policeOff) return;                      // police disabled — heist/turf/crime can't re-trigger stars
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
  G.copsKilled++;
  if (GAMEPLAY.pistolOnCopKill && G.copsKilled === 1 && !G.player.weapons.pistol) {
    G.player.weapons.pistol = true;
    G.player.pistolAmmo = G.player.pistolMag;
    updateAmmoHud();
    G.hud.showNotif('Picked up a 9mm');
  }
  // sustained cop-killing brings out the unmarked Crime Suppression units (3★)
  if (G.copsKilled >= 3 && G.wanted.stars < 3) {
    raiseWanted(3);
    G.hud.showNotif('Crime Suppression deployed ★★★');
  }
  if (G.copsKilled >= 6 && G.wanted.stars < 4) {
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
const SAVE_KEY = 'gtabkk_save_v1';   // legacy single-slot key; migrates into slot 0
export function slotKey(n) { return SAVE_KEY + '_s' + (n === undefined ? (G.saveSlot || 0) : n); }
// One-time: fold a pre-slots save into slot 0 so returning players keep progress.
export function migrateLegacySave() {
  try { const old = localStorage.getItem(SAVE_KEY); if (old && !localStorage.getItem(slotKey(0))) localStorage.setItem(slotKey(0), old); } catch (e) {}
}
// Lightweight read of a slot for the menu (cash + in-game day), without loading.
export function slotSummary(n) {
  try {
    const s = JSON.parse(localStorage.getItem(slotKey(n)));
    if (!s) return { empty: true };
    return { empty: false, cash: s.cash | 0, day: (s.day | 0) + 1 };
  } catch (e) { return { empty: true }; }
}

export function saveGame() {
  try {
    const p = G.player;
    if (!p) return;
    localStorage.setItem(slotKey(), JSON.stringify({
      cash: G.cash, armor: p.armor, dayT: G.time.dayT, day: G.time.day | 0, copsKilled: G.copsKilled,
      weapons: { pistol: !!p.weapons.pistol, smg: !!p.weapons.smg, shotgun: !!p.weapons.shotgun },
      pistolAmmo: p.pistolAmmo, pistolReserve: p.pistolReserve,
      smgAmmo: p.smgAmmo, smgReserve: p.smgReserve,
      shotgunAmmo: p.shotgunAmmo, shotgunReserve: p.shotgunReserve,
      amulets: (G.world.collectibles || []).map(a => a.taken),
      food: (G.world.foodStalls || []).map(f => f.visited), foodVisited: G.foodVisited || 0,
      collected: G.collected || 0,
      welcomeDone: !!G._welcomeDone,
      soiRunWon: !!G._soiRunWon, hitDone: !!G._hitDone,
      deliveryDone: !!G._deliveryDone, mallJobDone: !!G._mallJobDone, getawayDone: !!G._getawayDone,
      px: p.group.position.x, py: p.group.position.y, pz: p.group.position.z,
      // property / ownership economy
      safehouseOwned: !!G.econ.safehouse.owned,
      garageRented: !!G.econ.garage.rented,
      garageStored: G.econ.garage.stored,
      businesses: G.econ.businesses,
      upgrades: G.econ.upgrades,
      bank: { balance: Math.max(0, Math.floor(G.econ.bank.balance) || 0), lastDay: G.econ.bank.lastDay },
      wealthRank: G._wealthRank || 0,
      kingpinCar: !!G._kingpinCar,
      turfs: Object.fromEntries(TURFS.map(t => [t.id, !!(G.turfs && G.turfs[t.id] && G.turfs[t.id].owned)])),
      cosmetics: { shirt: G._shirtColor, hat: G._hat, jacket: G._jacketColor },
      owned: G._owned || [],
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
  try { s = JSON.parse(localStorage.getItem(slotKey())); } catch (e) { s = null; }
  if (!s || !G.player) return;
  const p = G.player;
  if (typeof s.cash === 'number') G.cash = s.cash;
  if (typeof s.armor === 'number') p.armor = s.armor;
  if (typeof s.dayT === 'number') G.time.dayT = s.dayT;
  if (typeof s.day === 'number') G.time.day = s.day;
  if (typeof s.copsKilled === 'number') G.copsKilled = s.copsKilled;
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
  if (typeof s.px === 'number' && typeof s.pz === 'number') p.group.position.set(s.px, Math.max(0, s.py || 0), s.pz);   // py = which mall floor you were on
  if (s.soiRunWon) G._soiRunWon = true;
  if (s.hitDone) G._hitDone = true;
  if (s.deliveryDone) G._deliveryDone = true;
  if (s.mallJobDone) G._mallJobDone = true;
  if (s.getawayDone) G._getawayDone = true;
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
  if (s.businesses && typeof s.businesses === 'object') {           // restore owned businesses + pending takings
    for (const id in s.businesses) {
      const b = s.businesses[id];
      if (b && typeof b === 'object') G.econ.businesses[id] = { owned: !!b.owned, pending: Math.max(0, +b.pending || 0), tier: Math.max(1, Math.min(3, +b.tier || 1)), manager: !!b.manager };
    }
  }
  if (s.upgrades && typeof s.upgrades === 'object') {               // restore vehicle upgrade levels
    for (const k of ['engine', 'nitro', 'armor']) G.econ.upgrades[k] = Math.max(0, Math.min(3, +s.upgrades[k] || 0));
  }
  if (s.bank && typeof s.bank === 'object') {                       // restore the bank balance
    G.econ.bank.balance = Math.max(0, Math.floor(+s.bank.balance) || 0);
    G.econ.bank.lastDay = (typeof s.bank.lastDay === 'number') ? s.bank.lastDay : null;
  }
  if (typeof s.wealthRank === 'number') G._wealthRank = Math.max(0, Math.min(4, s.wealthRank | 0));   // restore achieved rank
  if (s.kingpinCar) G._kingpinCar = true;                                                            // don't re-deliver the perk car
  if (s.turfs && typeof s.turfs === 'object') {                     // restore held gang turf
    G.turfs = G.turfs || {};
    for (const t of TURFS) { G.turfs[t.id] = G.turfs[t.id] || { owned: false, gang: [], spawned: false }; G.turfs[t.id].owned = !!s.turfs[t.id]; }
  }
  if (Array.isArray(s.owned)) G._owned = s.owned.slice();           // restore bought cosmetics
  if (s.cosmetics) applyCosmetics(s.cosmetics);
  else if (typeof s.shirtColor === 'number') applyCosmetics({ shirt: s.shirtColor });   // back-compat
  G.hud.setCash(G.cash);
  updateAmmoHud();
}

// ---- Start menu + save slots ----
function startPlaying(fresh) {
  document.getElementById('loading').style.opacity = '0';
  setTimeout(() => { const l = document.getElementById('loading'); if (l) l.style.display = 'none'; }, 800);
  G.state = 'playing';
  G.input.requestLock();
  if (G.audio.ctx.state === 'suspended') G.audio.ctx.resume();
  G.audio.bell();
  if (fresh) tip('move', 'WASD to move, SHIFT to sprint. Walk up to a vehicle and press E to drive.', 'WASD เดิน · E ขึ้นรถ');
}
function buildMenu() {
  migrateLegacySave();
  const hint = document.querySelector('#loading .hint'); if (hint) hint.textContent = 'Choose a save slot';
  const slotsEl = document.getElementById('slots'); if (!slotsEl) return;
  slotsEl.innerHTML = '';
  for (let n = 0; n < 3; n++) {
    const sum = slotSummary(n);
    const btn = document.createElement('button');
    btn.className = 'slot';
    btn.innerHTML = sum.empty
      ? `<b>Slot ${n + 1}</b> New game<span class="sub">a fresh Krung Thep</span>`
      : `<b>Slot ${n + 1}</b> Continue<span class="sub">฿${sum.cash.toLocaleString()} · Day ${sum.day}</span>`;
    btn.addEventListener('click', () => {
      G.saveSlot = n;
      if (!sum.empty) loadGame();
      else { try { localStorage.removeItem(slotKey(n)); } catch (e) {} }
      startPlaying(sum.empty);
    });
    if (!sum.empty) {
      const wipe = document.createElement('span');
      wipe.className = 'slot-wipe'; wipe.textContent = '✕'; wipe.title = 'Erase this slot';
      wipe.addEventListener('click', e => { e.stopPropagation(); try { localStorage.removeItem(slotKey(n)); } catch (er) {} buildMenu(); });
      btn.appendChild(wipe);
    }
    slotsEl.appendChild(btn);
  }
  document.getElementById('menu').classList.add('ready');
}

// ---- Contextual onboarding tips — shown once each, persisted globally ----
function loadTips() { try { return new Set(JSON.parse(localStorage.getItem('gtabkk_tips') || '[]')); } catch (e) { return new Set(); } }
export function tip(id, en, th) {
  if (!G._tips) G._tips = loadTips();
  if (G._tips.has(id)) return;
  G._tips.add(id);
  try { localStorage.setItem('gtabkk_tips', JSON.stringify([...G._tips])); } catch (e) {}
  if (G.hud && G.hud.showSubtitle) G.hud.showSubtitle(en, th || '', 5.5);
}

// ---- Police on/off toggle — persisted globally (like tips), read on boot ----
function loadPoliceOff() { try { return localStorage.getItem('gtabkk_policeOff') === '1'; } catch (e) { return false; } }
export function setPoliceOff(off) {
  G.policeOff = !!off;
  try { localStorage.setItem('gtabkk_policeOff', off ? '1' : '0'); } catch (e) {}
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

  // Save-slot menu once everything is ready
  buildMenu();
  const moEl = document.getElementById('menu-options');
  if (moEl) moEl.addEventListener('click', () => document.getElementById('options').classList.toggle('show'));
  // clicking the options overlay (pre-game) dismisses it back to the menu
  const optEl = document.getElementById('options');
  if (optEl) optEl.addEventListener('click', e => { if (G.state !== 'playing' && (e.target === optEl)) optEl.classList.remove('show'); });

  // Pause overlay: click to resume (re-locks the pointer)
  const pauseEl = document.getElementById('pause');
  if (pauseEl) pauseEl.addEventListener('click', () => {
    pauseEl.classList.remove('show');
    G.state = 'playing';
    G.input.requestLock();
  });

  // Police on/off toggle (pause menu) — restore saved state, then bind the button
  G.policeOff = loadPoliceOff();
  const policeBtn = document.getElementById('pause-police');
  if (policeBtn) {
    const sync = () => { policeBtn.textContent = 'Police: ' + (G.policeOff ? 'OFF' : 'ON'); };
    sync();
    policeBtn.addEventListener('click', e => {   // stop the overlay's click-to-resume from firing
      e.stopPropagation();
      setPoliceOff(!G.policeOff);
      sync();
    });
  }

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

  // Store overlay "Leave" button (item buttons are generated per shop in openStore)
  const leaveBtn = document.getElementById('store-leave');
  if (leaveBtn) leaveBtn.addEventListener('click', () => { document.getElementById('store').classList.remove('show'); G.state = 'playing'; G.input.requestLock(); });
  const arcadeLeave = document.getElementById('arcade-leave');
  if (arcadeLeave) arcadeLeave.addEventListener('click', () => closeArcade());
  const upLeave = document.getElementById('garageup-leave');
  if (upLeave) upLeave.addEventListener('click', () => closeUpgrades());
  const bankLeave = document.getElementById('bank-leave');
  if (bankLeave) bankLeave.addEventListener('click', () => closeBank());

  // Restore saved progress, then autosave on unload
  // (loadGame is deferred until a slot is chosen in the menu)
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
  // Plain POI text labels (Home + Garage get a glyph below, drawn separately).
  const poi = G.world.poi || {};
  const labels = [
    { p: poi.goldShop, t: "Uncle Seng's" },
    { p: poi.temple, t: 'Temple' },
    { p: poi.yaowarat, t: 'Yaowarat' },
    { p: G.world.gunShop, t: 'Guns' },
  ];
  ctx.fillStyle = '#cfe3e0'; ctx.font = '13px system-ui, sans-serif'; ctx.textAlign = 'center';
  for (const L of labels) if (L.p) ctx.fillText(L.t, to(L.p.x), to(L.p.z) - 8);
  // Home + Garage glyphs (state-coded), label pushed up so it clears the glyph.
  if (poi.safehouse) {
    const hx = to(poi.safehouse.x), hy = to(poi.safehouse.z);
    drawHouseGlyph(ctx, hx, hy, 8, HOME_COLOR, G.econ.safehouse.owned);
    ctx.fillStyle = HOME_COLOR; ctx.fillText(G.econ.safehouse.owned ? 'Home' : 'Safehouse', hx, hy - 15);
  }
  for (const ga of (G.world.garages || [])) if (ga.pos) {
    const gx = to(ga.pos.x), gy = to(ga.pos.z);
    drawGarageGlyph(ctx, gx, gy, 7, GARAGE_COLOR, G.econ.garage.rented);
    ctx.fillStyle = GARAGE_COLOR; ctx.fillText(G.econ.garage.rented ? 'Garage' : 'U-Spray', gx, gy - 15);
  }
  if (poi.terminal21) {
    const tx = to(poi.terminal21.x), ty = to(poi.terminal21.z);
    drawMallGlyph(ctx, tx, ty, 7, MALL_COLOR);
    ctx.fillStyle = MALL_COLOR; ctx.textAlign = 'center'; ctx.fillText('Terminal 21 · Arcade', tx, ty - 15);
  }
  // 7-Elevens (orange squares)
  ctx.fillStyle = SEVEN_COLOR;
  for (const e of (G.world.sevenElevens || [])) ctx.fillRect(to(e.pos.x) - 3, to(e.pos.z) - 3, 6, 6);
  // BTS station
  if (G.world.bts) {
    const bx = to(G.world.bts.x), bz = to(G.world.bts.z || 0);
    drawBtsGlyph(ctx, bx, bz, 6, BTS_COLOR);
    ctx.fillStyle = BTS_COLOR; ctx.textAlign = 'center'; ctx.fillText('BTS Asok', bx, bz - 13);
  }
  // riverside pier (boats)
  if (poi.pier) {
    const rx = to(poi.pier.x), rz = to(poi.pier.z);
    drawBoatGlyph(ctx, rx, rz, 6, BOAT_COLOR);
    ctx.fillStyle = BOAT_COLOR; ctx.textAlign = 'center'; ctx.fillText('Pier · Boats', rx, rz - 13);
  }
  // Krung Thep Bank
  if (poi.bank) {
    const kx = to(poi.bank.x), kz = to(poi.bank.z);
    drawBankGlyph(ctx, kx, kz, 7, BANK_COLOR);
    ctx.fillStyle = BANK_COLOR; ctx.textAlign = 'center'; ctx.fillText('Bank', kx, kz - 14);
  }
  // gang turf (flag; filled when held)
  for (const t of TURFS) {
    const gx = to(t.center.x), gz = to(t.center.z), held = !!(G.turfs && G.turfs[t.id] && G.turfs[t.id].owned);
    drawTurfGlyph(ctx, gx, gz, 7, TURF_COLOR, held);
    ctx.fillStyle = TURF_COLOR; ctx.textAlign = 'center'; ctx.fillText(held ? t.name : t.name + ' (gang)', gx, gz - 14);
  }
  // buyable businesses (diamonds; filled once owned)
  for (const b of BUSINESSES) {
    if (!b.pos) continue;
    const bx = to(b.pos.x), bz = to(b.pos.z), owned = !!(G.econ.businesses[b.id] && G.econ.businesses[b.id].owned);
    drawBizGlyph(ctx, bx, bz, 6, BIZ_COLOR, owned);
    ctx.fillStyle = BIZ_COLOR; ctx.textAlign = 'center'; ctx.fillText(owned ? b.name : b.name + ' (buy)', bx, bz - 13);
  }
  ctx.fillStyle = '#cfe3e0'; ctx.textAlign = 'left';
  if (G.world.collectibles) {
    ctx.fillStyle = '#ffcf4a';
    for (const a of G.world.collectibles) if (!a.taken) {
      ctx.beginPath(); ctx.arc(to(a.mesh.position.x), to(a.mesh.position.z), 3.5, 0, TAU); ctx.fill();
    }
  }
  if (G.mission && G.mission.active && G.mission.active.markerPos) {
    const mx = to(G.mission.active.markerPos.x), my = to(G.mission.active.markerPos.z);
    ctx.fillStyle = '#ff2a86';
    ctx.beginPath(); ctx.arc(mx, my, 7, 0, TAU); ctx.fill();
    ctx.strokeStyle = '#ff2a86'; ctx.lineWidth = 3;          // thick ring → primary target
    ctx.beginPath(); ctx.arc(mx, my, 13, 0, TAU); ctx.stroke();
  }
  if (G.taxi && G.taxi.markerPos) {
    const tx = to(G.taxi.markerPos.x), tz = to(G.taxi.markerPos.z);
    ctx.fillStyle = G.taxi.stage === 'toDropoff' ? '#39ff7a' : '#ffcf4a';
    ctx.beginPath(); ctx.arc(tx, tz, 7, 0, TAU); ctx.fill();
    ctx.strokeStyle = ctx.fillStyle; ctx.lineWidth = 2.5;
    ctx.beginPath(); ctx.arc(tx, tz, 12, 0, TAU); ctx.stroke();
  }
  if (G.heist && G.heist.active && G.heist.markerPos) {
    const hx = to(G.heist.markerPos.x), hz = to(G.heist.markerPos.z);
    ctx.fillStyle = G.heist.stage === 2 ? '#39ff7a' : '#ffcf4a';
    ctx.beginPath(); ctx.arc(hx, hz, 7, 0, TAU); ctx.fill();
    ctx.strokeStyle = ctx.fillStyle; ctx.lineWidth = 2.5;
    ctx.beginPath(); ctx.arc(hx, hz, 13, 0, TAU); ctx.stroke();
  }
  ctx.fillStyle = '#ff3333';
  for (const v of G.vehicles) if (v.isCop && v.driver) { ctx.beginPath(); ctx.arc(to(v.pos.x), to(v.pos.z), 3.5, 0, TAU); ctx.fill(); }
  const px = to(G.player.group.position.x), py = to(G.player.group.position.z);
  const fx = -Math.sin(G.player.yaw), fz = -Math.cos(G.player.yaw);
  ctx.strokeStyle = '#21f0ff'; ctx.lineWidth = 2.5;
  ctx.beginPath(); ctx.moveTo(px, py); ctx.lineTo(px + fx * 14, py + fz * 14); ctx.stroke();
  ctx.fillStyle = '#21f0ff';
  ctx.beginPath(); ctx.arc(px, py, 5, 0, TAU); ctx.fill();

  // Legend — a small color key (panel-backed) so the map reads to a first-timer.
  const items = [
    ['home',   HOME_COLOR,   'Home'],
    ['garage', GARAGE_COLOR, 'Garage'],
    ['mall',   MALL_COLOR,   'Mall / Arcade'],
    ['biz',    BIZ_COLOR,    'Business'],
    ['bank',   BANK_COLOR,   'Bank'],
    ['turf',   TURF_COLOR,   'Gang turf'],
    ['bts',    BTS_COLOR,    'BTS'],
    ['boat',   BOAT_COLOR,   'Pier'],
    ['seven',  SEVEN_COLOR,  '7-Eleven'],
    ['dot',    '#ff2a86',    'Objective'],
    ['dot',    '#ff3333',    'Cops'],
    ['dot',    '#ffcf4a',    'Amulet'],
  ];
  const lx = 14, ly0 = 24, rowH = 21, panelW = 130, panelH = items.length * rowH + 12;
  ctx.fillStyle = 'rgba(8,10,14,0.62)'; ctx.fillRect(lx - 6, ly0 - 14, panelW, panelH);
  ctx.strokeStyle = 'rgba(33,240,255,0.35)'; ctx.lineWidth = 1; ctx.strokeRect(lx - 6, ly0 - 14, panelW, panelH);
  ctx.textAlign = 'left'; ctx.font = '12px system-ui, sans-serif';
  for (let i = 0; i < items.length; i++) {
    const [kind, color, text] = items[i], yy = ly0 + i * rowH;
    if (kind === 'home') drawHouseGlyph(ctx, lx + 8, yy, 6, color, true);
    else if (kind === 'garage') drawGarageGlyph(ctx, lx + 8, yy, 5, color, true);
    else if (kind === 'mall') drawMallGlyph(ctx, lx + 8, yy, 5, color, true);
    else if (kind === 'biz') drawBizGlyph(ctx, lx + 8, yy, 5, color, true);
    else if (kind === 'bts') drawBtsGlyph(ctx, lx + 8, yy, 5, color);
    else if (kind === 'bank') drawBankGlyph(ctx, lx + 8, yy, 5, color);
    else if (kind === 'turf') drawTurfGlyph(ctx, lx + 8, yy, 5, color, true);
    else if (kind === 'boat') drawBoatGlyph(ctx, lx + 8, yy, 5, color);
    else if (kind === 'seven') { ctx.fillStyle = color; ctx.fillRect(lx + 4, yy - 4, 8, 8); }
    else { ctx.fillStyle = color; ctx.beginPath(); ctx.arc(lx + 8, yy, 5, 0, TAU); ctx.fill(); }
    ctx.fillStyle = '#dfeee9'; ctx.fillText(text, lx + 24, yy + 4);
  }

  // Objective line (bottom center): the active target name + live distance.
  let objText = 'No active objective — free roam', op = null, on = null;
  if (G.heist && G.heist.active && G.heist.markerPos) { op = G.heist.markerPos; on = G.heist.stage === 2 ? 'Bank Heist — loot drop' : 'Bank Heist — crack the vault'; }
  else if (G.mission && G.mission.active && G.mission.active.markerPos) { op = G.mission.active.markerPos; on = G.mission.active.name || 'Objective'; }
  else if (G.taxi && G.taxi.stage && G.taxi.stage !== 'idle' && G.taxi.markerPos) { op = G.taxi.markerPos; on = G.taxi.stage === 'toDropoff' ? 'Taxi drop-off' : 'Taxi pick-up'; }
  if (op) {
    const pp = (G.player.inVehicle && G.player.inVehicle.pos) || G.player.group.position;
    objText = `Objective: ${on} — ${Math.round(Math.hypot(op.x - pp.x, op.z - pp.z))} m`;
  }
  ctx.font = 'bold 15px system-ui, sans-serif'; ctx.textAlign = 'center';
  const tw = ctx.measureText(objText).width;
  ctx.fillStyle = 'rgba(8,10,14,0.62)'; ctx.fillRect(S / 2 - tw / 2 - 12, S - 40, tw + 24, 26);
  ctx.fillStyle = '#ffe08a'; ctx.fillText(objText, S / 2, S - 22);
  ctx.textAlign = 'left';
}
export function updateRadio(dt) {
  const a = G.audio; if (!a || !a.radio) return;
  const inV = !!G.player.inVehicle;
  if (G.input && G.input.pressed && G.input.pressed('KeyM') && G.state === 'playing') {
    G.hud.showNotif('📻 ' + a.radio.next());
  }
  if (inV && !G._wasInVehicle) {
    G.hud.showNotif('📻 ' + a.radio.names[a.radio.station]);
    tip('drive', 'Driving: W/S throttle, A/D steer, SPACE handbrake, SHIFT boost. Press M to change the radio.', 'M เปลี่ยนวิทยุ');
  }
  G._wasInVehicle = inV;
  a.radio.tick(inV);
  a.duckEngine(inV && a.radio.station !== 0);
  // Persistent HUD chip: live station name while driving, hidden on foot / RADIO OFF.
  G.hud.setRadioChip(inV && a.radio.station !== 0 ? '📻 ' + a.radio.names[a.radio.station] : null);
}

// =============================================================================
// Arcade mini-game (Akihabara Arcade, Terminal 21 floor 1): "Tuk-Tuk Dash" — a
// timing game. Stop the sweeping marker in the green over 3 rounds; the closer
// to centre, the higher the score; payout = score × 2 baht. Its own G.state so
// the world pauses while you play.
// =============================================================================
let _arcadeCtx = null;
export function startArcade() {
  G.arcade = { round: 0, results: [], marker: 0, dir: 1, speed: 1.0, locked: false, lockT: 0, score: 0, payout: 0, done: false };
  G.state = 'arcade';
  document.getElementById('arcade').classList.add('show');
  document.exitPointerLock();
}
export function closeArcade() {
  document.getElementById('arcade').classList.remove('show');
  G.arcade = null; G.state = 'playing'; if (G.input.requestLock) G.input.requestLock();
}
export function updateArcade(dt) {
  const a = G.arcade; if (!a) return;
  if (!a.done) {
    if (!a.locked) {
      a.marker += a.dir * a.speed * dt;
      if (a.marker > 1) { a.marker = 1; a.dir = -1; } else if (a.marker < 0) { a.marker = 0; a.dir = 1; }
      if (G.input.pressed('Space')) {
        a.locked = true; a.lockT = 0.6;
        const s = Math.max(0, Math.round(100 - Math.abs(a.marker - 0.5) * 220));
        a.results.push(s); a.score += s;
        if (G.audio && G.audio.blip) G.audio.blip({ freq: 360 + s * 6, dur: 0.1, gain: 0.12 });
      }
    } else {
      a.lockT -= dt;
      if (a.lockT <= 0) {
        a.round++;
        if (a.round >= 3) {
          a.done = true; a.payout = a.score * 2; G.cash += a.payout; G.hud.setCash(G.cash); if (a.payout > 0) G.hud.cashPop(a.payout);
          if (a.payout > 0 && G.audio && G.audio.chime) G.audio.chime();
        } else { a.locked = false; a.marker = 0; a.dir = 1; a.speed = 1.0 + a.round * 0.45; }
      }
    }
  } else if (G.input.pressed('Space')) { closeArcade(); return; }
  const cv = document.getElementById('arcade-canvas');
  if (cv) renderArcade(_arcadeCtx || (_arcadeCtx = cv.getContext('2d')), a);
}
function renderArcade(ctx, a) {
  ctx.clearRect(0, 0, 520, 220); ctx.fillStyle = '#0a0814'; ctx.fillRect(0, 0, 520, 220);
  const x0 = 40, x1 = 480, y = 130, w = x1 - x0, mid = (x0 + x1) / 2;
  ctx.fillStyle = '#2a2440'; ctx.fillRect(x0, y - 10, w, 20);
  ctx.fillStyle = 'rgba(57,255,122,0.35)'; ctx.fillRect(mid - 40, y - 10, 80, 20);
  ctx.fillStyle = '#39ff7a'; ctx.fillRect(mid - 3, y - 15, 6, 30);
  const mx = x0 + a.marker * w;
  ctx.fillStyle = a.locked ? '#ffcf4a' : '#ff2a86'; ctx.fillRect(mx - 2, y - 24, 4, 48);
  ctx.fillStyle = '#cfe3e0'; ctx.font = '16px system-ui, sans-serif';
  ctx.textAlign = 'left'; ctx.fillText(`Round ${Math.min(a.round + 1, 3)}/3`, 20, 30);
  ctx.textAlign = 'right'; ctx.fillText(`Score ${a.score}`, 500, 30);
  ctx.textAlign = 'center';
  if (a.done) {
    ctx.fillStyle = '#ffcf4a'; ctx.font = 'bold 22px system-ui, sans-serif';
    ctx.fillText(`SCORE ${a.score} — WON ฿${a.payout}`, mid, 80);
    ctx.fillStyle = '#9fe0ff'; ctx.font = '14px system-ui, sans-serif';
    ctx.fillText('SPACE or Leave to exit', mid, 195);
  } else if (a.results.length) {
    ctx.fillStyle = '#8a8aa0'; ctx.font = '13px system-ui, sans-serif';
    ctx.fillText('rounds: ' + a.results.join('  ·  '), mid, 195);
  }
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
  // touch controls: visible only while you're actually playing / on the phone / map
  if (G.input && G.input.isTouch) {
    const tc = document.getElementById('touch');
    if (tc) { const show = (G.state === 'playing' || G.state === 'phone' || G.state === 'map' || G.state === 'photo'); if (tc.style.display !== (show ? 'block' : 'none')) tc.style.display = show ? 'block' : 'none'; }
  }
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
    if (G.audio && G.audio.updateMusic) G.audio.updateMusic(dt);   // dynamic music bed + G-watched audio events (alarm, boat motor)
    updateTaxi(dt);
    updateVehicles(dt);
    updatePeds(dt);
    updateClusters(dt);
    updateBarks(dt);
    updateMuggings(dt);
    updateSpikes(dt);
    updateVigilante(dt);
    updateTurf(dt);
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
    // one-time 100% celebration (cheap: amulet counter + the 6 mission flags)
    if (!G._congrats) {
      const mm = missionMilestones();
      const total = G.world.collectibles ? G.world.collectibles.length : 15;
      if ((G.collected || 0) / Math.max(1, total) * 70 + mm.done / mm.total * 30 >= 99.5) {
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
    updateBank(dt);   // bank-heist set-piece (runs every frame: cracking on foot, escape while driving)
    G._hubTipT = (G._hubTipT || 0) + dt;   // onboarding: point new players at the phone's activity directory
    if (G._hubTipT > 6) tip('hub', 'Press T for your phone — it lists every activity (jobs, Bank Heist, gang turf, properties, arcade) with live distances.', 'กด T เปิดมือถือ — ดูกิจกรรมทั้งหมดพร้อมระยะทาง');
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
  } else if (G.state === 'arcade') {
    updateArcade(dt);
    if (G.input.endFrame) G.input.endFrame();
  }

  G.renderer.render(G.scene, G.camera);
  // On-screen objective waypoint — after render so the camera matrices are
  // current. Self-gates on G.state === 'playing' (hidden in map/photo/pause).
  if (G.hud && G.hud.drawWaypoint) G.hud.drawWaypoint();
}

// =============================================================================
// 21. BOOT
// =============================================================================

init().catch(err => {
  console.error(err);
  document.getElementById('loading').innerHTML = `<h1 style="color:#ff2a86">ERROR</h1><pre style="color:#f5e9c8;max-width:600px;white-space:pre-wrap">${err.stack || err}</pre>`;
});

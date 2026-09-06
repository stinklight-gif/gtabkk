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
  STORABLE, collectPaintMats, currentBodyColor, isNearGridLine, killPed, randomPlate, repaintVehicle, respawnTraffic, retrieveVehicle, setVehicleColor, storeVehicle, storedLabel, updateCamera, updateGarage, updateGarageOwnership, updatePlayerInVehicle, updateTrafficCar, updateTrafficPopulation, updateVehicles, closeUpgrades, applyUpgrades
} from './vehicles.js';
export * from './world.js';
import {
  buildWorld, makeMinimapBase, makeWindowTexture
} from './world.js';
export * from './traffic.js';
import { buildTrafficLights, updateTrafficLights } from './traffic.js';
export * from './entities.js';
import {
  animateWalk, makeCamera, makeCatMesh, makeDogMesh, makePedMesh, makePlayer, makeRain, makeVehicle, makeVehicleMesh, sidewalkPos, spawnBoat, spawnBoatNoodle, spawnCats, spawnDog, spawnDogs, spawnMotosaiStands, spawnBtsSongthaew, spawnBtsTuktuk, spawnBtsMalai, spawnMangoSticky, spawnBtsGates, spawnIceCarts, spawnCoconutCarts, spawnChaYen, spawnRotiCart, spawnMooPing, spawnSomTam, spawnPlaKat, spawnLaundry, spawnSoiPa, spawnSoiCctv, spawnSoiWires, spawnRainFrogs, spawnSoiChairs, spawnSoiMechanic, spawnSoiBarber, spawnSoiCowboy, spawnCheckpoint, spawnSevenBikes, spawnSevenGuard, spawnSevenAtm, spawnSevenShoppers, spawnBtsBusker, spawnBtsSitters, spawnWatTurtles, spawnWatBell, spawnWatBats, spawnWatSweep, spawnWatRobes, spawnBtsPigeons, spawnWatLotus, spawnWatCats, spawnMonitors, spawnHyacinth, spawnGeckos, spawnStallIncense, spawnLottery, spawnKanomKrok, spawnSquidGrill, spawnYaoGold, spawnParkedCars, spawnPed, spawnPeds, spawnTraffic, updateEntityLod, wearBikeHelmet
} from './entities.js';
import { spawnAirportPlanes } from './airport.js';
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
  CROWD_CURVE, buildClusterAnchors, crowdFactor, crowdTarget, makeBarkSprite, resyncCrowd, spawnAnchoredPed, spawnBark, spawnSpikeStrip, updateAlms, updateArmorPickups, updateBarks, updateCats, updateClusters, updateDogs, updateFoodStalls, updateMuggings, updatePeds, updateSchoolKids, updateSeekShade, updateShrines, updateSpikes, updateTurf, updateVigilante, updateYaowaratNight, updateYaoPhotos, updateBtsPlatform, updateBtsGates, updateOfficeCommute, updateCrossingGuards, updateCheckpoint, updateSevenGuard, updateSevenAtm, updateSevenShoppers, updateBtsBusker, updateSoiChairs, updateSoiCowboy, updateCowboyClose, updateSoiMechanic, updateSoiBarber, updateRainPack, updateRainPoncho, updateBikeSeatCover, updateIceCarts, updateCoconutCarts, updateChaYen, updateRotiCart, updateMooPing, updateSomTam, updateBtsMalai, updateMangoSticky, updateKanomKrok, updateSquidGrill, updateYaoGold, updateSongthaewRiders, updatePlaKat, updateBoatNoodle, updateMonitors, updateHyacinth, updateWatTurtles, updateWatBell, updateWatBats, updateWatSweep, updateWatRobes, updateBtsPigeons, updateWatLotus, updateWatCats, updateGeckos, updateStallIncense, updateSoiFootball, updateMallShoppers, updateLottery, updateSoiWires, updateRainFrogs, updateSoiCctv, vigilanteEnd, vigilanteSpawnTarget
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
  PRICE, PAINT_COLORS, BUSINESSES, TURFS, missionMilestones, ROAD_WIDTH, PED_TARGET, GAMEPLAY, inYaowarat, yaowaratNightOpen, onSoi, onCarriageway, _camTarget, _camOffset, _fireDir,
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
// Heat thresholds: crime points needed for each star. Twenty dead civilians used to
// read exactly the same as one, because raiseWanted was a Math.max floor rather than
// an accumulator. Points now pile up and stars are derived from them, while the old
// floor behaviour is kept so all ~30 existing call sites keep working unchanged.
export const CRIME_THRESHOLDS = [0, 1, 5, 12, 22, 38];
export function crimeStars(crime) {
  let s = 0;
  for (let i = 5; i >= 1; i--) if (crime >= CRIME_THRESHOLDS[i]) { s = i; break; }
  return s;
}

// `points` lets a caller say how *big* the crime was independently of the star floor
// it forces; it defaults to n so existing single-argument calls are unchanged.
export function raiseWanted(n, points = n) {
  if (G.policeOff) return;                      // police disabled — heist/turf/crime can't re-trigger stars
  const prev = G.wanted.stars;
  G.wanted.crime = (G.wanted.crime || 0) + points;
  G.wanted.stars = Math.min(5, Math.max(G.wanted.stars, n, crimeStars(G.wanted.crime)));
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
    G.player.activeWeapon = 'pistol';
    G.player.pistolAmmo = G.player.pistolMag;
    G.player.pistolReserve = Math.max(G.player.pistolReserve || 0, G.player.pistolMag * 2);
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
      activeWeapon: p.activeWeapon,
      pistolAmmo: p.pistolAmmo, pistolReserve: p.pistolReserve,
      smgAmmo: p.smgAmmo, smgReserve: p.smgReserve,
      shotgunAmmo: p.shotgunAmmo, shotgunReserve: p.shotgunReserve,
      amulets: (G.world.collectibles || []).map(a => a.taken),
      food: (G.world.foodStalls || []).map(f => f.visited), foodVisited: G.foodVisited || 0,
      collected: G.collected || 0,
      welcomeDone: !!G._welcomeDone,
      soiRunWon: !!G._soiRunWon, hitDone: !!G._hitDone,
      deliveryDone: !!G._deliveryDone, mallJobDone: !!G._mallJobDone, getawayDone: !!G._getawayDone,
      boutDone: !!G._boutDone, monsoonDone: !!G._monsoonDone,
      customsDone: !!G._customsDone, nightSoiDone: !!G._nightSoiDone,
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
      starterGunRobbed: !!G._starterGunRobbed,
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
  const savedWeapon = typeof s.activeWeapon === 'string' ? s.activeWeapon : '';
  if (savedWeapon === 'fists' || (['pistol', 'smg', 'shotgun'].includes(savedWeapon) && p.weapons[savedWeapon])) {
    p.activeWeapon = savedWeapon;
  } else if (p.weapons.pistol) {
    p.activeWeapon = 'pistol';
  } else {
    p.activeWeapon = 'fists';
  }
  p.pistol.visible = p.activeWeapon !== 'fists';
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
  if (s.boutDone) G._boutDone = true;
  if (s.monsoonDone) G._monsoonDone = true;
  if (s.customsDone) G._customsDone = true;
  if (s.nightSoiDone) G._nightSoiDone = true;
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
    for (const k of ['engine', 'nitro', 'armor', 'melee']) G.econ.upgrades[k] = Math.max(0, Math.min(3, +s.upgrades[k] || 0));
  }
  if (s.bank && typeof s.bank === 'object') {                       // restore the bank balance
    G.econ.bank.balance = Math.max(0, Math.floor(+s.bank.balance) || 0);
    G.econ.bank.lastDay = (typeof s.bank.lastDay === 'number') ? s.bank.lastDay : null;
  }
  if (typeof s.wealthRank === 'number') G._wealthRank = Math.max(0, Math.min(4, s.wealthRank | 0));   // restore achieved rank
  if (s.kingpinCar) G._kingpinCar = true;                                                            // don't re-deliver the perk car
  G._starterGunRobbed = !!s.starterGunRobbed;
  for (const shop of (G.world.gunShops || [])) if (shop.id === 'starter') shop.robbed = G._starterGunRobbed;
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

  // ?smoke=1 is the CI/headless path. PCF-soft 2048 shadows + MSAA + bloom RTs
  // deadlock SwiftShader (page.screenshot hung 120s after "fonts loaded").
  // Freeze GPU before the first rAF so the harness can present one cheap frame.
  const smoke = new URLSearchParams(location.search).has('smoke');
  if (smoke) { G.noBloom = true; G._holdFrame = true; }

  // preserveDrawingBuffer so a paused frame can be read back (smoke toDataURL).
  const renderer = new THREE.WebGLRenderer({
    antialias: !smoke,
    powerPreference: smoke ? 'low-power' : 'high-performance',
    preserveDrawingBuffer: true,
  });
  renderer.setPixelRatio(smoke ? 1 : Math.min(window.devicePixelRatio, 1.5));
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.shadowMap.enabled = !smoke;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.0;
  document.getElementById('app').appendChild(renderer.domElement);
  G.renderer = renderer;

  // Sun (directional light)
  const sun = new THREE.DirectionalLight(0xffe0a0, 1.3);
  sun.position.set(80, 100, 40);
  sun.castShadow = !smoke;
  sun.shadow.mapSize.set(smoke ? 256 : 2048, smoke ? 256 : 2048);
  const d = 80;
  sun.shadow.camera.left = -d; sun.shadow.camera.right = d;
  sun.shadow.camera.top = d; sun.shadow.camera.bottom = -d;
  sun.shadow.camera.near = 1; sun.shadow.camera.far = 300;
  sun.shadow.bias = -0.0008;
  scene.add(sun);
  scene.add(sun.target);   // target must be in the scene graph so per-frame re-anchoring takes effect
  G.sun = sun;

  // ---- Reflection environment: a procedural sky env map, applied only to the
  // reflective materials that benefit (glass facades, car paint) via their own
  // .envMap. Targeting just those keeps it cheap (vs. global scene.environment,
  // which samples the env on every fragment) and doesn't wash out the night. ----
  {
    const pmrem = new THREE.PMREMGenerator(renderer);
    const skyScene = new THREE.Scene();
    const dome = new THREE.Mesh(
      new THREE.SphereGeometry(10, 24, 16),
      new THREE.ShaderMaterial({
        side: THREE.BackSide, depthWrite: false,
        uniforms: { top: { value: new THREE.Color(0x3a5a88) }, horizon: { value: new THREE.Color(0x9aa6b8) }, ground: { value: new THREE.Color(0x4a463d) } },
        vertexShader: 'varying vec3 vd; void main(){ vd = normalize(position); gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.0); }',
        fragmentShader: 'varying vec3 vd; uniform vec3 top; uniform vec3 horizon; uniform vec3 ground; void main(){ float h = vd.y; vec3 c = h>0.0 ? mix(horizon, top, pow(h,0.55)) : mix(horizon, ground, pow(-h,0.5)); gl_FragColor = vec4(c,1.0); }',
      })
    );
    skyScene.add(dome);
    const sunBall = new THREE.Mesh(new THREE.SphereGeometry(0.8, 12, 12), new THREE.MeshBasicMaterial({ color: 0xfff0d0 }));
    sunBall.position.set(5, 6, 3); skyScene.add(sunBall);
    const rt = pmrem.fromScene(skyScene, 0.08);
    G.envMap = rt.texture;   // glass + car materials opt in via .envMap (see world.js / entities.js)
    dome.geometry.dispose(); dome.material.dispose(); sunBall.geometry.dispose(); sunBall.material.dispose(); pmrem.dispose();
  }

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

  // ---- Bloom post-process: neon, windows, headlights and bright sky bloom for a
  // much more cinematic, less-flat look. Scene renders to an offscreen RT; bright
  // pixels are extracted at half-res, blurred (separable Gaussian, two widths) and
  // composited additively. Cheap — a few half-res fullscreen passes, no per-scene-
  // fragment cost (unlike a global IBL env). Skip the MSAA HDR targets in smoke. ----
  if (!smoke) {
    const w = window.innerWidth, h = window.innerHeight;
    const sceneRT = new THREE.WebGLRenderTarget(w, h, { samples: 2, type: THREE.HalfFloatType });
    sceneRT.texture.colorSpace = THREE.LinearSRGBColorSpace;   // linear HDR; tone-mapping happens in the composite
    const hw = Math.max(1, w >> 2), hh = Math.max(1, h >> 2);
    const mkRT = () => { const rt = new THREE.WebGLRenderTarget(hw, hh, { depthBuffer: false, type: THREE.HalfFloatType }); rt.texture.colorSpace = THREE.LinearSRGBColorSpace; return rt; };
    const bloomA = mkRT(), bloomB = mkRT();
    const vsrc = 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }';
    // bright-pass works in LINEAR HDR — bright emissive (neon/windows) exceeds ~0.9
    const brightMat = new THREE.ShaderMaterial({ uniforms: { tDiffuse: { value: null }, threshold: { value: 0.85 } }, vertexShader: vsrc, fragmentShader:
      'uniform sampler2D tDiffuse; uniform float threshold; varying vec2 vUv; void main(){ vec3 c = texture2D(tDiffuse, vUv).rgb; float l = dot(c, vec3(0.2126,0.7152,0.0722)); gl_FragColor = vec4(c * smoothstep(threshold, threshold + 0.7, l), 1.0); }' });
    const blurMat = new THREE.ShaderMaterial({ uniforms: { tDiffuse: { value: null }, dir: { value: new THREE.Vector2() }, res: { value: new THREE.Vector2(hw, hh) } }, vertexShader: vsrc, fragmentShader:
      'uniform sampler2D tDiffuse; uniform vec2 dir; uniform vec2 res; varying vec2 vUv; void main(){ vec2 o = dir / res; vec3 s = texture2D(tDiffuse, vUv).rgb * 0.2270; s += (texture2D(tDiffuse, vUv + o*1.3846).rgb + texture2D(tDiffuse, vUv - o*1.3846).rgb) * 0.3162; s += (texture2D(tDiffuse, vUv + o*3.2308).rgb + texture2D(tDiffuse, vUv - o*3.2308).rgb) * 0.0703; gl_FragColor = vec4(s, 1.0); }' });
    // composite: add bloom in linear, apply exposure + ACES tone map + sRGB encode
    const compMat = new THREE.ShaderMaterial({ uniforms: { tScene: { value: null }, tBloom: { value: null }, strength: { value: 0.7 }, exposure: { value: 1.0 }, haze: { value: 0.0 } }, vertexShader: vsrc, fragmentShader:
      'uniform sampler2D tScene; uniform sampler2D tBloom; uniform float strength; uniform float exposure; uniform float haze; varying vec2 vUv; vec3 aces(vec3 x){ return clamp((x*(2.51*x+0.03))/(x*(2.43*x+0.59)+0.14), 0.0, 1.0); } void main(){ vec2 uv = vUv; if (haze > 0.001) { float n = sin(uv.y * 80.0 + uv.x * 40.0) * 0.002 * haze; uv += vec2(n, n * 0.6); } vec3 c = (texture2D(tScene, uv).rgb + texture2D(tBloom, uv).rgb * strength) * exposure; c = aces(c); c = pow(c, vec3(1.0/2.2)); gl_FragColor = vec4(c, 1.0); }' });
    const quadScene = new THREE.Scene();
    const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), brightMat);
    quadScene.add(quad);
    const quadCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    G.bloom = { sceneRT, bloomA, bloomB, brightMat, blurMat, compMat, quadScene, quad, quadCam };
  }

  window.addEventListener('resize', () => {
    camRig.cam.aspect = window.innerWidth / window.innerHeight;
    camRig.cam.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
    if (G.bloom) {
      const w = window.innerWidth, h = window.innerHeight, hw = Math.max(1, w >> 2), hh = Math.max(1, h >> 2);
      G.bloom.sceneRT.setSize(w, h); G.bloom.bloomA.setSize(hw, hh); G.bloom.bloomB.setSize(hw, hh);
      G.bloom.blurMat.uniforms.res.value.set(hw, hh);
    }
  });

  // Audio
  G.audio = makeAudio();

  // Loading bar
  setProgress(20);

  // World
  G.world = buildWorld(scene);
  buildTrafficLights(scene);   // signals at every grid intersection
  setProgress(60);

  // Player
  G.player = makePlayer(scene);
  setProgress(72);

  // Spawn vehicles, peds, dogs
  spawnTraffic(scene);
  spawnParkedCars(scene);
  spawnMotosaiStands(scene);
  spawnBtsSongthaew(scene);
  spawnBtsTuktuk(scene);
  spawnBtsMalai(scene);
  spawnMangoSticky(scene);
  spawnBtsGates(scene);
  spawnBoat(scene);
  spawnBoatNoodle(scene);
  spawnAirportPlanes(scene);
  // a parked, enterable cop car — the Vigilante ride
  { const v = spawnCopCar(scene, new THREE.Vector3(50, 0, 90)); v.driver = null; v.vel = 0; v.heading = 0; v.mesh.rotation.y = 0; }
  spawnPeds(scene, 60);
  spawnDogs(scene, 16);
  spawnCats(scene);
  spawnMonitors(scene);
  spawnHyacinth(scene);
  spawnGeckos(scene);
  spawnStallIncense(scene);
  spawnIceCarts(scene);
  spawnCoconutCarts(scene);
  spawnChaYen(scene);
  spawnRotiCart(scene);
  spawnMooPing(scene);
  spawnSomTam(scene);
  spawnPlaKat(scene);
  spawnLaundry(scene);
  spawnSoiPa(scene);
  spawnSoiCctv(scene);
  spawnSoiWires(scene);
  spawnRainFrogs(scene);
  spawnSoiChairs(scene);
  spawnSoiMechanic(scene);
  spawnSoiBarber(scene);
  spawnSoiCowboy(scene);
  spawnCheckpoint(scene);
  spawnSevenBikes(scene);
  spawnSevenGuard(scene);
  spawnSevenAtm(scene);
  spawnSevenShoppers(scene);
  spawnBtsBusker(scene);
  spawnBtsSitters(scene);
  spawnWatTurtles(scene);
  spawnWatBell(scene);
  spawnWatBats(scene);
  spawnWatSweep(scene);
  spawnWatRobes(scene);
  spawnBtsPigeons(scene);
  spawnWatLotus(scene);
  spawnWatCats(scene);
  spawnLottery(scene);
  spawnKanomKrok(scene);
  spawnSquidGrill(scene);
  spawnYaoGold(scene);
  buildClusterAnchors();
  for (const f of (G.world.foodStalls || [])) {
    const sp = f.pos.clone(); sp.y = 1.15;
    f.smoke = makeSmokeEmitter(sp, 0.28);
    f.smoke.life = 1e9;
    if (f.smoke.mat) { f.smoke.mat.size = 0.7; f.smoke.mat.color.setHex(0x887766); }
  }
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
      const drunk = GAMEPLAY.yaowaratNight && yaowaratNightOpen() && inYaowarat(p.inVehicle.pos.x, p.inVehicle.pos.z);
      G.hud.showPrompt(drunk ? 'Press <b>J</b> for a drunk tourist fare' : 'Press <b>J</b> for a taxi fare', 0.4);
      if (G.input.pressed('KeyJ')) {
        if (drunk) {
          t.stage = 'toDropoff';
          t.dest = taxiRandPoint(p.inVehicle.pos, 160);
          t.markerPos = t.dest;
          taxiBeam(t, t.dest, 0x39ff7a);
          const d = Math.sqrt(dist2(p.inVehicle.pos, t.dest));
          t.timeLeft = 28 + d / 8;
          t.fareValue = Math.round(280 + d * 8);
          t.drunk = true;
          G.hud.showNotif('Drunk tourist piled in — get them home');
        } else {
          t.stage = 'toPickup';
          t.drunk = false;
          t.markerPos = taxiRandPoint(p.inVehicle.pos, 90);
          taxiBeam(t, t.markerPos, 0xffcf4a);
          G.hud.showNotif('New fare — head to the yellow marker');
        }
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

// Motosai — Bangkok motorcycle taxi. Not a songthaew: pickup/drop on sois, a
// pillion rider on the seat, and a bonus if you filter through traffic.
export function soiRandPoint(from, minD, maxD) {
  const sois = (G.world && G.world.sois) || [];
  if (!sois.length) return taxiRandPoint(from, maxD);
  for (let tries = 0; tries < 48; tries++) {
    const s = sois[irand(0, sois.length - 1)];
    const x = rand(s.x0, s.x1), z = rand(s.z0, s.z1);
    const dx = x - from.x, dz = z - from.z, d2 = dx * dx + dz * dz;
    if (d2 >= minD * minD && d2 <= maxD * maxD) return new THREE.Vector3(x, 0, z);
  }
  let best = null, bestD = 0;
  for (const s of sois) {
    const x = (s.x0 + s.x1) / 2, z = (s.z0 + s.z1) / 2;
    const d2 = dist2({ x, z }, from);
    if (d2 > bestD && d2 <= maxD * maxD) { bestD = d2; best = new THREE.Vector3(x, 0, z); }
  }
  return best || taxiRandPoint(from, maxD);
}
function motosaiFiltering(v) {
  if (!v || !v.spec || v.spec.kind !== 'bike' || Math.abs(v.vel) < 6) return false;
  if (onSoi(v.pos.x, v.pos.z)) return false;
  if (!onCarriageway(v.pos.x, v.pos.z)) return false;
  for (const o of G.vehicles) {
    if (!o || o === v || o.dead || !o.spec) continue;
    if (o.spec.kind === 'bike' || o.spec.kind === 'boat' || o.spec.kind === 'airliner') continue;
    const d = Math.hypot(o.pos.x - v.pos.x, o.pos.z - v.pos.z);
    if (d < 2.6 && Math.abs(v.vel) > Math.abs(o.vel || 0) + 1.5) return true;
  }
  return false;
}
function attachMotosaiPillion(m, bike) {
  if (m.pillion) return;
  const ped = spawnPed(G.scene, bike.pos.clone());
  ped.pillion = true;
  ped.speed = 0;
  ped.state = 'idle';
  G.scene.remove(ped.mesh);
  bike.mesh.add(ped.mesh);
  ped.mesh.position.set(0, 0.02, -0.42);
  ped.mesh.rotation.set(0.16, 0, 0);
  wearBikeHelmet(ped, pick([0x1a1a1e, 0xb03030, 0xffcf2a, 0x2a5a8a]));
  m.pillion = ped;
}
function detachMotosaiPillion(m, bike) {
  const ped = m.pillion;
  if (!ped) return;
  if (ped.mesh && ped.mesh.parent) ped.mesh.parent.remove(ped.mesh);
  if (ped.mesh) {
    G.scene.add(ped.mesh);
    const pos = (bike && bike.pos) || G.player.group.position;
    ped.mesh.position.set(pos.x + 0.8, 0, pos.z);
    ped.mesh.rotation.set(0, (bike && bike.heading) || 0, 0);
  }
  ped.pillion = false;
  ped.speed = rand(0.9, 1.4);
  m.pillion = null;
}
function motosaiClear(m, bike) {
  detachMotosaiPillion(m, bike || (G.player && G.player.inVehicle));
  m.stage = 'idle'; m.markerPos = null; m.dest = null;
  m.timeLeft = 0; m.fareValue = 0; m.filterT = 0; m.filterMeters = 0; m.filterBonus = 0;
  if (m.beam) m.beam.visible = false;
}
export function updateMotosai(dt) {
  if (!GAMEPLAY.motosai) return;
  const p = G.player;
  const m = G.motosai || (G.motosai = {
    stage: 'idle', markerPos: null, dest: null, beam: null,
    timeLeft: 0, fares: 0, fareValue: 0, filterT: 0, filterMeters: 0, filterBonus: 0, pillion: null,
  });
  const v = p.inVehicle;
  const onBike = v && v.kind === 'bike';
  if (m.stage !== 'idle' && !onBike) {
    G.hud.showNotif('Motosai bailed.');
    motosaiClear(m, v);
    return;
  }
  if (m.stage === 'idle') {
    if (onBike && !(G.quickDrop && G.quickDrop.stage && G.quickDrop.stage !== 'idle')) {
      G.hud.showPrompt('Press <b>J</b> for a motosai · <b>Y</b> for Moto Drop', 0.4);
      if (G.input.pressed('KeyJ')) {
        m.stage = 'toPickup';
        m.filterT = 0; m.filterMeters = 0; m.filterBonus = 0;
        m.markerPos = soiRandPoint(v.pos, 35, 130);
        taxiBeam(m, m.markerPos, 0xff7a1a);
        G.hud.showNotif('Motosai — pick up on the soi');
        if (G.audio && G.audio.blip) G.audio.blip({ freq: 640, dur: 0.08, gain: 0.1 });
      }
    }
    return;
  }
  if (m.stage === 'toPickup') {
    G.hud.showPrompt('MOTOSAI · pick up on the soi', 0.4);
    if (dist2(v.pos, m.markerPos) < 6.5 * 6.5) {
      attachMotosaiPillion(m, v);
      m.dest = soiRandPoint(v.pos, 50, 170);
      m.markerPos = m.dest;
      taxiBeam(m, m.dest, 0x39ff7a);
      const d = Math.sqrt(dist2(v.pos, m.dest));
      m.timeLeft = 22 + d / 10;
      m.fareValue = Math.round(90 + d * 6);
      m.filterT = 0; m.filterMeters = 0; m.filterBonus = 0;
      m.stage = 'toDropoff';
      G.hud.showNotif('Pillion on — soi drop-off. Filter traffic for extra.');
      if (G.audio && G.audio.blip) G.audio.blip({ freq: 720, dur: 0.08, gain: 0.11 });
    }
    return;
  }
  m.timeLeft -= dt;
  if (motosaiFiltering(v)) {
    m.filterT += dt;
    m.filterMeters += Math.abs(v.vel) * dt;
  }
  m.filterBonus = Math.round(Math.min(220, m.filterT * 55 + m.filterMeters * 1.15));
  if (m.timeLeft <= 0) {
    G.hud.showNotif('Motosai gave up — too slow.');
    motosaiClear(m, v);
    return;
  }
  const pay = m.fareValue + m.filterBonus;
  G.hud.showPrompt(`MOTOSAI &nbsp; ⏱ ${m.timeLeft.toFixed(0)}s &nbsp;→&nbsp; ฿${pay}${m.filterBonus ? ` <span style="opacity:.7">+filter ฿${m.filterBonus}</span>` : ''}`, 0.4);
  if (dist2(v.pos, m.dest) < 6.5 * 6.5) {
    G.cash += pay; m.fares++;
    G.hud.setCash(G.cash);
    G.hud.showNotif(m.filterBonus
      ? `Motosai +฿${pay} (฿${m.fareValue} + filter ฿${m.filterBonus})`
      : `Motosai +฿${pay}`);
    if (G.audio && G.audio.chime) G.audio.chime();
    else if (G.audio && G.audio.blip) G.audio.blip({ freq: 800, dur: 0.1, gain: 0.12 });
    motosaiClear(m, v);
  }
}

export const PERFORMANCE_BUDGETS = {
  fps: { label: 'FPS', target: 55, failAt: 45, higherIsBetter: true, suffix: 'target 55+' },
  drawCalls: { label: 'draw calls', target: 900, failAt: 1200, suffix: 'budget 900' },
  triangles: { label: 'triangles', target: 450000, failAt: 650000, suffix: 'budget 450k' },
  visibleMeshes: { label: 'meshes', target: 850, failAt: 1150, suffix: 'visible budget 850' },
  activeEntities: { label: 'entities', target: 180, failAt: 220, suffix: 'active budget 180' },
  nearLodEntities: { label: 'near LOD', target: 95, failAt: 125, suffix: 'near budget 95' },
  farLodEntities: { label: 'far LOD', target: 8, failAt: 1, higherIsBetter: true, suffix: 'target 8+' },
};

function budgetLevel(value, budget) {
  const higher = !!budget.higherIsBetter;
  const good = higher ? value >= budget.target : value <= budget.target;
  const passing = higher ? value >= budget.failAt : value <= budget.failAt;
  return good ? 'ok' : passing ? 'warn' : 'bad';
}
export function evaluatePerformanceBudget(metrics) {
  const out = {};
  let status = 'ok';
  for (const [key, budget] of Object.entries(PERFORMANCE_BUDGETS)) {
    const value = Number(metrics[key] || 0);
    const level = budgetLevel(value, budget);
    if (level === 'bad') status = 'bad';
    else if (level === 'warn' && status !== 'bad') status = 'warn';
    out[key] = {
      label: budget.label,
      value,
      target: budget.target,
      failAt: budget.failAt,
      higherIsBetter: !!budget.higherIsBetter,
      level,
      pass: level !== 'bad',
    };
  }
  out.status = status;
  out.pass = status !== 'bad';
  return out;
}
function perfClass(results, key) {
  return (results && results[key] && results[key].level) || 'bad';
}
function perfLine(label, value, cls, budget) {
  return `${label.padEnd(13)} <span class="${cls}">${value}</span>${budget ? `  ${budget}` : ''}`;
}
export function updatePerformanceBudget(realDt) {
  const p = G.perf || (G.perf = {
    enabled: new URLSearchParams(location.search).has('debug'),
    acc: 0, frames: 0, fps: 0, meshCount: 0, visibleMeshes: 0,
  });
  const el = document.getElementById('perf');
  if (G.input && G.input.pressed && (G.input.pressed('F3') || G.input.pressed('Backquote'))) p.enabled = !p.enabled;
  if (!el) return;
  el.classList.toggle('show', !!p.enabled);
  if (!p.enabled) return;
  p.acc += realDt; p.frames++;
  if (p.acc < 0.45) return;
  p.fps = p.frames / Math.max(0.001, p.acc);
  p.acc = 0; p.frames = 0;
  let meshes = 0, visible = 0, instanced = 0;
  G.scene.traverse(o => {
    if (o.isMesh || o.isInstancedMesh || o.isSkinnedMesh) {
      meshes++;
      if (o.visible) visible++;
      if (o.isInstancedMesh) instanced++;
    }
  });
  p.meshCount = meshes; p.visibleMeshes = visible;
  const info = G.renderer.info;
  const r = info.render || {};
  const mem = info.memory || {};
  const sceneCalls = p.sceneCalls != null ? p.sceneCalls : (r.calls || 0);
  const sceneTriangles = p.sceneTriangles != null ? p.sceneTriangles : (r.triangles || 0);
  const lod = G.lodStats || {};
  const nearEntities = (lod.nearPeds || 0) + (lod.nearVehicles || 0);
  const nearLodEntities = (lod.pedHigh || 0) + (lod.vehicleHigh || 0);
  const farLodEntities = (lod.pedLow || 0) + (lod.vehicleLow || 0);
  const activeEntities = (G.peds ? G.peds.length : 0) + (G.vehicles ? G.vehicles.length : 0) + (G.cops ? G.cops.length : 0) + (G.dogs ? G.dogs.length : 0);
  const metrics = {
    fps: p.fps,
    drawCalls: sceneCalls,
    triangles: sceneTriangles,
    visibleMeshes: visible,
    activeEntities,
    nearLodEntities,
    farLodEntities,
  };
  const budgetResults = evaluatePerformanceBudget(metrics);
  p.snapshot = {
    fps: p.fps,
    drawCalls: sceneCalls,
    triangles: sceneTriangles,
    meshes,
    visibleMeshes: visible,
    activeEntities,
    nearEntities,
    nearLodEntities,
    farLodEntities,
    geometries: mem.geometries || 0,
    textures: mem.textures || 0,
    lod,
    budgets: budgetResults,
    budgetPass: budgetResults.pass,
    budgetStatus: budgetResults.status,
  };
  const statusLabel = budgetResults.status === 'ok' ? 'PASS' : budgetResults.status === 'warn' ? 'WARN' : 'FAIL';
  const lines = [
    `VISUAL BUDGET <span class="${budgetResults.status === 'ok' ? 'ok' : budgetResults.status}">${statusLabel}</span>`,
    perfLine('FPS', p.fps.toFixed(0), perfClass(budgetResults, 'fps'), PERFORMANCE_BUDGETS.fps.suffix),
    perfLine('draw calls', String(sceneCalls), perfClass(budgetResults, 'drawCalls'), PERFORMANCE_BUDGETS.drawCalls.suffix),
    perfLine('triangles', `${Math.round(sceneTriangles / 1000)}k`, perfClass(budgetResults, 'triangles'), PERFORMANCE_BUDGETS.triangles.suffix),
    perfLine('meshes', `${visible}/${meshes}`, perfClass(budgetResults, 'visibleMeshes'), `inst ${instanced}`),
    perfLine('entities', `${activeEntities} active`, perfClass(budgetResults, 'activeEntities'), `${G.peds.length} peds · ${G.vehicles.length} veh`),
    perfLine('near LOD', `${nearLodEntities} high`, perfClass(budgetResults, 'nearLodEntities'), `${nearEntities} near`),
    perfLine('far LOD', `${farLodEntities} low`, perfClass(budgetResults, 'farLodEntities'), 'should be >0'),
  ];
  el.innerHTML = lines.join('\n');
}

function quickDropClear(q, result = 'idle', reason = null) {
  q.lastResult = result;
  q.failReason = reason;
  q.stage = 'idle'; q.markerPos = null; q.pickup = null; q.dest = null;
  q.timeLeft = 0; q.totalTime = 0; q.baseReward = 0; q.reward = 0; q.heatLevel = 0; q.policeCalled = false;
  if (q.beam) q.beam.visible = false;
}
function quickDropFail(q, reason, message) {
  q.failures = (q.failures || 0) + 1;
  q.streak = 0;
  G.hud.showNotif(message);
  quickDropClear(q, 'failed', reason);
}
function quickDropDest(from) {
  for (let i = 0; i < 18; i++) {
    const p = taxiRandPoint(from, 190);
    const d2 = dist2(p, from);
    if (d2 > 85 * 85) return p;
  }
  return taxiRandPoint(from, 170);
}
export function updateQuickDelivery(dt) {
  const q = G.quickDrop || (G.quickDrop = {
    stage: 'idle', markerPos: null, pickup: null, dest: null, beam: null,
    timeLeft: 0, totalTime: 0, baseReward: 0, reward: 0,
    deliveries: 0, failures: 0, streak: 0, heatLevel: 0, policeCalled: false,
    lastResult: null, failReason: null,
  });
  const p = G.player;
  const v = p.inVehicle;
  const courierRide = v && (v.kind === 'bike' || v.kind === 'tuktuk');
  const motosaiOwnsJ = GAMEPLAY.motosai && v && v.kind === 'bike';
  if (q.stage === 'idle') {
    if (G.motosai && G.motosai.stage && G.motosai.stage !== 'idle') return;
    if (v && !courierRide) G.hud.showPrompt('Moto Drop needs a <b>bike</b> or <b>tuk-tuk</b>', 0.35);
    if (courierRide) {
      if (!motosaiOwnsJ) G.hud.showPrompt('Press <b>Y</b>/<b>J</b> for Moto Drop', 0.4);
      const start = G.input.pressed('KeyY') || (!motosaiOwnsJ && G.input.pressed('KeyJ'));
      if (start) {
        q.stage = 'toPickup';
        q.pickup = taxiRandPoint(v.pos, 80);
        q.markerPos = q.pickup;
        q.dest = null;
        q.timeLeft = 0;
        q.reward = 0;
        q.heatLevel = 0;
        q.policeCalled = false;
        q.failReason = null;
        taxiBeam(q, q.markerPos, 0xffcf4a);
        G.hud.showNotif('Moto Drop — collect the package at the yellow marker');
        if (G.audio && G.audio.blip) G.audio.blip({ freq: 680, dur: 0.09, gain: 0.12 });
      }
    }
    return;
  }
  if (!courierRide) { quickDropFail(q, 'lost-ride', 'Moto Drop failed — lost the bike.'); return; }
  if (v.dead || v.hp <= 14) { quickDropFail(q, 'wrecked', 'Moto Drop failed — the bike is wrecked.'); return; }
  if (q.stage === 'toPickup') {
    const d = Math.sqrt(dist2(v.pos, q.markerPos));
    G.hud.showPrompt(`MOTO PICKUP &nbsp; ${Math.round(d)}m`, 0.4);
    if (d < 7) {
      q.dest = quickDropDest(v.pos);
      q.markerPos = q.dest;
      const trip = Math.sqrt(dist2(v.pos, q.dest));
      q.totalTime = 32 + trip / 8.5;
      q.timeLeft = q.totalTime;
      q.baseReward = Math.round(380 + trip * 6.4);
      q.reward = q.baseReward;
      q.stage = 'toDropoff';
      q.heatLevel = 0;
      taxiBeam(q, q.markerPos, 0x21f0ff);
      G.hud.showNotif('Package aboard — hit the blue drop-off before the timer burns down');
      G.hud.showPrompt(`MOTO DROP &nbsp; ⏱ ${q.timeLeft.toFixed(0)}s &nbsp;→&nbsp; ฿${q.reward.toLocaleString()}`, 0.4);
      if (G.audio && G.audio.blip) G.audio.blip({ freq: 760, dur: 0.08, gain: 0.12 });
    }
    return;
  }
  q.timeLeft -= dt;
  const elapsedRatio = q.totalTime > 0 ? 1 - (q.timeLeft / q.totalTime) : 0;
  if (q.heatLevel < 1 && elapsedRatio > 0.45) {
    q.heatLevel = 1;
    q.policeCalled = true;
    raiseWanted(Math.max(1, G.wanted.stars));
    G.hud.showNotif('Dispatch heard the package call-in — keep moving.');
  } else if (q.heatLevel < 2 && q.timeLeft < 13) {
    q.heatLevel = 2;
    q.policeCalled = true;
    raiseWanted(Math.max(2, G.wanted.stars));
    G.hud.showNotif('Last-mile heat — cops are closing in.');
  }
  if (q.timeLeft <= 0) { quickDropFail(q, 'timeout', 'Moto Drop failed — too slow.'); return; }
  const runningReward = q.baseReward + Math.round(Math.max(0, q.timeLeft) * 6) + Math.min(5, q.streak || 0) * 90;
  q.reward = runningReward;
  G.hud.showPrompt(`MOTO DROP &nbsp; ⏱ ${q.timeLeft.toFixed(0)}s &nbsp;→&nbsp; ฿${runningReward.toLocaleString()}`, 0.4);
  if (dist2(v.pos, q.dest) < 8 * 8) {
    q.streak = (q.streak || 0) + 1;
    const payout = q.baseReward + Math.round(Math.max(0, q.timeLeft) * 6) + Math.min(5, q.streak) * 90;
    q.reward = payout;
    G.cash += payout;
    q.deliveries++;
    G.hud.setCash(G.cash); G.hud.cashPop(q.reward);
    G.hud.showNotif(`Moto Drop delivered: +฿${q.reward.toLocaleString()} · streak ${q.streak}`);
    if (G.audio && G.audio.chime) G.audio.chime();
    quickDropClear(q, 'delivered');
  }
}

const SHOWCASE_VEHICLES = ['bike', 'tuktuk', 'camry', 'sedan', 'hilux', 'songthaew', 'bus', 'luxsedan', 'supercar', 'cop', 'fortuner', 'swat', 'boat', 'airliner'];
const SHOWCASE_PEDS = ['local', 'office', 'tourist', 'monk', 'vendor', 'laborer'];
function makeLabelSprite(text) {
  const c = document.createElement('canvas'); c.width = 256; c.height = 64;
  const ctx = c.getContext('2d');
  ctx.font = 'bold 24px system-ui, sans-serif';
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.lineWidth = 5; ctx.strokeStyle = 'rgba(0,0,0,.9)'; ctx.fillStyle = '#f5e9c8';
  ctx.strokeText(text, 128, 32); ctx.fillText(text, 128, 32);
  const tex = new THREE.CanvasTexture(c);
  const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false }));
  sp.scale.set(2.9, 0.72, 1);
  return sp;
}
function buildDebugShowcase() {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x0b1016);
  const camera = new THREE.PerspectiveCamera(58, window.innerWidth / window.innerHeight, 0.1, 220);
  camera.position.set(0, 13, 34);
  camera.lookAt(0, 1.1, 0);
  scene.add(new THREE.HemisphereLight(0xbdd8ff, 0x806f58, 0.9));
  const sun = new THREE.DirectionalLight(0xffffff, 1.8);
  sun.position.set(8, 18, 10); scene.add(sun);
  const root = new THREE.Group(); scene.add(root);
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(46, 32), new THREE.MeshStandardMaterial({ color: 0x30363d, roughness: 0.9 }));
  ground.rotation.x = -PI / 2; root.add(ground);
  let i = 0;
  for (const kind of SHOWCASE_VEHICLES) {
    const mesh = makeVehicleMesh(kind);
    const row = Math.floor(i / 5), col = i % 5;
    mesh.position.set((col - 2) * 8.2, 0, row * 6.3 - 8.2);
    mesh.rotation.y = PI * 0.16;
    root.add(mesh);
    const label = makeLabelSprite(kind);
    label.position.set(mesh.position.x, 3.8, mesh.position.z + 2.8);
    root.add(label);
    i++;
  }
  for (let p = 0; p < SHOWCASE_PEDS.length; p++) {
    const ped = makePedMesh(SHOWCASE_PEDS[p]);
    ped.position.set((p - 2.5) * 2.1, 0, 10.5);
    ped.rotation.y = PI;
    root.add(ped);
    const label = makeLabelSprite(SHOWCASE_PEDS[p]);
    label.scale.set(1.8, 0.45, 1);
    label.position.set(ped.position.x, 2.35, ped.position.z + 0.55);
    root.add(label);
  }
  G.showcase = { scene, camera, root, yaw: 0 };
}
export function startDebugShowcase() {
  if (!G.showcase) buildDebugShowcase();
  G.state = 'showcase';
  G._showcaseSkipKey = true;
  document.exitPointerLock();
  const hud = document.getElementById('hud'); if (hud) hud.classList.add('hidden');
  const el = document.getElementById('showcase'); if (el) el.classList.add('show');
}
export function closeDebugShowcase() {
  const el = document.getElementById('showcase'); if (el) el.classList.remove('show');
  const hud = document.getElementById('hud'); if (hud) hud.classList.remove('hidden');
  G.state = 'playing';
  if (G.input && G.input.requestLock) G.input.requestLock();
}
export function updateDebugShowcase(dt) {
  const s = G.showcase;
  if (!s) return;
  if (G._showcaseSkipKey) G._showcaseSkipKey = false;
  else if (G.input.pressed('F8') || G.input.pressed('Escape')) { closeDebugShowcase(); return; }
  const turn = (G.input.down('KeyA') ? 1 : 0) - (G.input.down('KeyD') ? 1 : 0);
  s.yaw += (turn * 1.7 + 0.12) * dt;
  s.root.rotation.y = s.yaw;
  s.camera.aspect = window.innerWidth / window.innerHeight;
  s.camera.updateProjectionMatrix();
}

// Full-screen, north-up map overlay (TAB). Draws the minimap base scaled up plus
// live markers (amulets, mission/taxi, cops, player heading).
let _fullmapCtx = null;
const FULLMAP_ZOOMS = [1, 1.7, 2.6, 3.8];
function setFullMapZoom(dir) {
  const cur = G.fullMapZoom || 1;
  if (dir === 0) { G.fullMapZoom = 1; return; }
  let idx = FULLMAP_ZOOMS.indexOf(cur);
  if (idx < 0) idx = FULLMAP_ZOOMS.reduce((best, z, i) => Math.abs(z - cur) < Math.abs(FULLMAP_ZOOMS[best] - cur) ? i : best, 0);
  G.fullMapZoom = FULLMAP_ZOOMS[clamp(idx + dir, 0, FULLMAP_ZOOMS.length - 1)];
}
function fullMapView(S) {
  const zoom = G.fullMapZoom || 1;
  const span = (HALF * 2) / zoom;
  const pp = (G.player && G.player.inVehicle && G.player.inVehicle.pos) || (G.player && G.player.group && G.player.group.position) || { x: 0, z: 0 };
  const minC = -HALF + span / 2, maxC = HALF - span / 2;
  const cx = clamp(pp.x, minC, maxC), cz = clamp(pp.z, minC, maxC);
  const x0 = cx - span / 2, z0 = cz - span / 2;
  const to = v => (v - x0) / span * S;
  return { zoom, span, x0, z0, to };
}
export function drawFullMap() {
  const cv = document.getElementById('fullmap');
  if (!cv) return;
  const ctx = _fullmapCtx || (_fullmapCtx = cv.getContext('2d'));
  const S = cv.width;
  ctx.clearRect(0, 0, S, S);
  const view = fullMapView(S);
  const to = view.to;
  if (G.world && G.world.minimap) {
    const src = G.world.minimap, sw = src.width / view.zoom, sh = src.height / view.zoom;
    const sx = (view.x0 + HALF) / (HALF * 2) * src.width;
    const sy = (view.z0 + HALF) / (HALF * 2) * src.height;
    ctx.drawImage(src, sx, sy, sw, sh, 0, 0, S, S);
  }
  // Plain POI text labels (Home + Garage get a glyph below, drawn separately).
  const poi = G.world.poi || {};
  const gunShops = (G.world.gunShops && G.world.gunShops.length)
    ? G.world.gunShops
    : (G.world.gunShop ? [{ pos: G.world.gunShop }] : []);
  const labels = [
    { p: poi.goldShop, t: "Uncle Seng's" },
    { p: poi.temple, t: 'Temple' },
    { p: poi.yaowarat, t: 'Yaowarat' },
    ...gunShops.map(s => ({ p: s.pos || s, t: s.id === 'starter' ? 'Starter Guns' : 'Guns' })),
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
  // 7-Elevens: draw as labeled destination markers, not tiny loose pixels.
  for (const e of (G.world.sevenElevens || [])) {
    const sx = to(e.pos.x), sz = to(e.pos.z);
    ctx.save();
    ctx.fillStyle = 'rgba(5,8,10,0.82)';
    ctx.fillRect(sx - 22, sz - 24, 44, 18);
    ctx.strokeStyle = SEVEN_COLOR; ctx.lineWidth = 2;
    ctx.strokeRect(sx - 21, sz - 23, 42, 16);
    ctx.fillStyle = '#fff0d0'; ctx.font = 'bold 11px system-ui, sans-serif'; ctx.textAlign = 'center';
    ctx.fillText('7-11', sx, sz - 11);
    ctx.fillStyle = SEVEN_COLOR;
    ctx.fillRect(sx - 6, sz - 6, 12, 12);
    ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 2;
    ctx.strokeRect(sx - 7, sz - 7, 14, 14);
    ctx.strokeStyle = SEVEN_COLOR; ctx.lineWidth = 2.5;
    ctx.beginPath(); ctx.arc(sx, sz, 16, 0, TAU); ctx.stroke();
    ctx.restore();
  }
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
  if (G.motosai && G.motosai.stage !== 'idle' && G.motosai.markerPos) {
    const mx = to(G.motosai.markerPos.x), mz = to(G.motosai.markerPos.z);
    ctx.fillStyle = G.motosai.stage === 'toDropoff' ? '#39ff7a' : '#ff7a1a';
    ctx.beginPath(); ctx.arc(mx, mz, 7, 0, TAU); ctx.fill();
    ctx.strokeStyle = ctx.fillStyle; ctx.lineWidth = 2.5;
    ctx.beginPath(); ctx.arc(mx, mz, 12, 0, TAU); ctx.stroke();
  }
  if (G.quickDrop && G.quickDrop.stage !== 'idle' && G.quickDrop.markerPos) {
    const qx = to(G.quickDrop.markerPos.x), qz = to(G.quickDrop.markerPos.z);
    ctx.fillStyle = G.quickDrop.stage === 'toPickup' ? '#ffcf4a' : '#21f0ff';
    ctx.beginPath(); ctx.arc(qx, qz, 7, 0, TAU); ctx.fill();
    ctx.strokeStyle = ctx.fillStyle; ctx.lineWidth = 2.5;
    ctx.beginPath(); ctx.arc(qx, qz, 12, 0, TAU); ctx.stroke();
  }
  if (G.heist && G.heist.active && G.heist.markerPos) {
    const hx = to(G.heist.markerPos.x), hz = to(G.heist.markerPos.z);
    ctx.fillStyle = G.heist.stage === 2 ? '#39ff7a' : '#ffcf4a';
    ctx.beginPath(); ctx.arc(hx, hz, 7, 0, TAU); ctx.fill();
    ctx.strokeStyle = ctx.fillStyle; ctx.lineWidth = 2.5;
    ctx.beginPath(); ctx.arc(hx, hz, 13, 0, TAU); ctx.stroke();
  }
  if (G.vigilante && G.vigilante.active && G.vigilante.markerPos) {
    const vx = to(G.vigilante.markerPos.x), vz = to(G.vigilante.markerPos.z);
    ctx.fillStyle = '#ff3333';
    ctx.beginPath(); ctx.arc(vx, vz, 7, 0, TAU); ctx.fill();
    ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 5;
    ctx.beginPath(); ctx.arc(vx, vz, 16, 0, TAU); ctx.stroke();
    ctx.strokeStyle = '#ff3333'; ctx.lineWidth = 3;
    ctx.beginPath(); ctx.arc(vx, vz, 16, 0, TAU); ctx.stroke();
    ctx.font = 'bold 13px system-ui, sans-serif'; ctx.textAlign = 'center';
    ctx.fillStyle = '#ffcccc';
    ctx.fillText('VIGILANTE TARGET', vx, vz - 22);
  }
  ctx.fillStyle = '#ff3333';
  for (const v of G.vehicles) if (v.isCop && v.driver) { ctx.beginPath(); ctx.arc(to(v.pos.x), to(v.pos.z), 3.5, 0, TAU); ctx.fill(); }
  const pMapPos = (G.player.inVehicle && G.player.inVehicle.pos) || G.player.group.position;
  const pMapYaw = G.player.inVehicle ? G.player.inVehicle.heading : G.player.yaw;
  const px = to(pMapPos.x), py = to(pMapPos.z);
  const fx = -Math.sin(pMapYaw), fz = -Math.cos(pMapYaw);
  const drawPlayerMarker = () => {
    const pulse = 0.5 + Math.sin(performance.now() * 0.006) * 0.5;
    const halo = 17 + pulse * 5;
    ctx.save();
    ctx.lineWidth = 7;
    ctx.strokeStyle = 'rgba(4,8,12,0.88)';
    ctx.beginPath(); ctx.arc(px, py, halo, 0, TAU); ctx.stroke();
    ctx.lineWidth = 3;
    ctx.strokeStyle = 'rgba(33,240,255,0.95)';
    ctx.beginPath(); ctx.arc(px, py, halo, 0, TAU); ctx.stroke();
    ctx.lineWidth = 2;
    ctx.strokeStyle = '#ffffff';
    ctx.beginPath(); ctx.arc(px, py, 10, 0, TAU); ctx.stroke();
    ctx.fillStyle = '#21f0ff';
    ctx.beginPath(); ctx.arc(px, py, 6, 0, TAU); ctx.fill();
    ctx.strokeStyle = '#071014';
    ctx.lineWidth = 6;
    ctx.beginPath(); ctx.moveTo(px, py); ctx.lineTo(px + fx * 24, py + fz * 24); ctx.stroke();
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 3;
    ctx.beginPath(); ctx.moveTo(px, py); ctx.lineTo(px + fx * 24, py + fz * 24); ctx.stroke();
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.moveTo(px + fx * 30, py + fz * 30);
    ctx.lineTo(px + fx * 15 + fz * 7, py + fz * 15 - fx * 7);
    ctx.lineTo(px + fx * 15 - fz * 7, py + fz * 15 + fx * 7);
    ctx.closePath();
    ctx.fill();
    const label = 'YOU', lw = 42, lh = 20;
    const lx2 = clamp(px + 14, 8, S - lw - 8);
    const ly2 = clamp(py - 34, 8, S - lh - 8);
    ctx.fillStyle = 'rgba(4,8,12,0.88)';
    ctx.fillRect(lx2 - 2, ly2 - 2, lw + 4, lh + 4);
    ctx.fillStyle = '#21f0ff';
    ctx.fillRect(lx2, ly2, lw, lh);
    ctx.fillStyle = '#041018';
    ctx.font = 'bold 12px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(label, lx2 + lw / 2, ly2 + 14);
    ctx.restore();
  };

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
  const lx = 14, ly0 = 24, rowH = 21, panelW = 146, panelH = items.length * rowH + 12;
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
  drawPlayerMarker();

  // Objective line (bottom center): the active target name + live distance.
  let objText = 'No active objective — free roam', op = null, on = null;
  if (G.heist && G.heist.active && G.heist.markerPos) { op = G.heist.markerPos; on = G.heist.stage === 2 ? 'Bank Heist — loot drop' : 'Bank Heist — crack the vault'; }
  else if (G.vigilante && G.vigilante.active && G.vigilante.markerPos) { op = G.vigilante.markerPos; on = `Vigilante target · ${Math.ceil(G.vigilante.timeLeft || 0)}s`; }
  else if (G.quickDrop && G.quickDrop.stage !== 'idle' && G.quickDrop.markerPos) { op = G.quickDrop.markerPos; on = G.quickDrop.stage === 'toDropoff' ? 'Moto Drop' : 'Moto pickup'; }
  else if (G.motosai && G.motosai.stage && G.motosai.stage !== 'idle' && G.motosai.markerPos) { op = G.motosai.markerPos; on = G.motosai.stage === 'toDropoff' ? 'Motosai drop' : 'Motosai pick-up'; }
  else if (G.taxi && G.taxi.stage && G.taxi.stage !== 'idle' && G.taxi.markerPos) { op = G.taxi.markerPos; on = G.taxi.stage === 'toDropoff' ? 'Taxi drop-off' : 'Taxi pick-up'; }
  else if (G.mission && G.mission.active && G.mission.active.markerPos) { op = G.mission.active.markerPos; on = G.mission.active.name || 'Objective'; }
  if (op) {
    const pp = (G.player.inVehicle && G.player.inVehicle.pos) || G.player.group.position;
    objText = `Objective: ${on} — ${Math.round(Math.hypot(op.x - pp.x, op.z - pp.z))} m`;
  }
  ctx.font = 'bold 15px system-ui, sans-serif'; ctx.textAlign = 'center';
  const tw = ctx.measureText(objText).width;
  ctx.fillStyle = 'rgba(8,10,14,0.62)'; ctx.fillRect(S / 2 - tw / 2 - 12, S - 40, tw + 24, 26);
  ctx.fillStyle = '#ffe08a'; ctx.fillText(objText, S / 2, S - 22);
  ctx.textAlign = 'left';

  // Zoom chip — kept on-map so the control is discoverable while inspecting POI clusters.
  const zText = `ZOOM ${view.zoom.toFixed(1)}x   +/- zoom   0 reset`;
  ctx.font = 'bold 12px system-ui, sans-serif'; ctx.textAlign = 'right';
  const zw = ctx.measureText(zText).width;
  ctx.fillStyle = 'rgba(8,10,14,0.62)'; ctx.fillRect(S - zw - 28, 14, zw + 14, 24);
  ctx.fillStyle = '#21f0ff'; ctx.fillText(zText, S - 20, 31);
}
export function updateRadio(dt) {
  const a = G.audio; if (!a || !a.radio) return;
  const inV = !!G.player.inVehicle;
  if (G.input && G.input.pressed && G.input.pressed('KeyM') && G.state === 'playing') {
    G.hud.showNotif('📻 ' + a.radio.next());
  }
  if (inV && !G._wasInVehicle) {
    G.hud.showNotif('📻 ' + a.radio.names[a.radio.station]);
    tip('drive', 'Driving: W/S throttle, A/D steer, SPACE handbrake, SHIFT boost. Press E to exit, M to change the radio.', 'E ลงรถ · M เปลี่ยนวิทยุ');
  }
  G._wasInVehicle = inV;
  a.radio.tick(inV);
  a.duckEngine(inV && a.radio.station !== 0);
  // Persistent HUD chip: live station name while driving, hidden on foot / RADIO OFF.
  G.hud.setRadioChip(inV && a.radio.station !== 0 ? '📻 ' + a.radio.names[a.radio.station] : null);
  const talkOn = inV && a.radio.names[a.radio.station] === 'TALK RADIO AM';
  const hot = GAMEPLAY.talkChase && G.wanted && G.wanted.stars >= 3;
  if (talkOn && hot) {
    G._talkChaseT = (G._talkChaseT || 0) - dt;
    if (!G._talkChaseOn || G._talkChaseT <= 0) {
      G._talkChaseOn = true;
      G._talkChaseT = 16;
      const d = G._districtName || 'Sukhumvit';
      const place = d === 'Yaowarat' ? 'Yaowarat' : d === 'Riverside' ? 'the riverside' : 'Sukhumvit';
      G.hud.showSubtitle(`Talk Radio: "A chase ripping down ${place} — police on the bumper."`, 'วิทยุ: ไล่ล่า');
    }
  } else if (G._talkChaseOn && (!hot || !talkOn)) {
    G._talkChaseOn = false;
    G._talkChaseT = 0;
    if (talkOn) G.hud.showSubtitle('Talk Radio: "Back to the phones — traffic\'s clearing."', 'วิทยุ: ข่าวจบ');
  }
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

// Multi-pass bloom render (see setup in init): scene → RT, bright-pass → blur ×2
// widths → additive composite to the screen. Falls back to a direct render if
// bloom failed to initialize.
function renderBloom() {
  const b = G.bloom, r = G.renderer;
  // fallback / opt-out (G.noBloom is set by the headless gameplay probes, which
  // don't need the effect and run far faster without it under SwiftShader)
  if (!b || G.noBloom) {
    r.toneMapping = THREE.ACESFilmicToneMapping; r.setRenderTarget(null); r.render(G.scene, G.camera);
    if (G.perf) { G.perf.sceneCalls = r.info.render.calls || 0; G.perf.sceneTriangles = r.info.render.triangles || 0; }
    return;
  }
  r.toneMapping = THREE.NoToneMapping;   // sceneRT holds linear HDR; the composite applies ACES + sRGB
  r.setRenderTarget(b.sceneRT); r.render(G.scene, G.camera);
  if (G.perf) { G.perf.sceneCalls = r.info.render.calls || 0; G.perf.sceneTriangles = r.info.render.triangles || 0; }
  b.quad.material = b.brightMat; b.brightMat.uniforms.tDiffuse.value = b.sceneRT.texture;
  r.setRenderTarget(b.bloomA); r.render(b.quadScene, b.quadCam);
  b.quad.material = b.blurMat;
  for (const [src, dst, dx, dy] of [[b.bloomA, b.bloomB, 1, 0], [b.bloomB, b.bloomA, 0, 1], [b.bloomA, b.bloomB, 2.2, 0], [b.bloomB, b.bloomA, 0, 2.2]]) {
    b.blurMat.uniforms.tDiffuse.value = src.texture; b.blurMat.uniforms.dir.value.set(dx, dy);
    r.setRenderTarget(dst); r.render(b.quadScene, b.quadCam);
  }
  b.quad.material = b.compMat; b.compMat.uniforms.tScene.value = b.sceneRT.texture; b.compMat.uniforms.tBloom.value = b.bloomA.texture;
  b.compMat.uniforms.exposure.value = r.toneMappingExposure;   // day/night exposure (set each frame by daynight.js)
  if (b.compMat.uniforms.haze) {
    const dayK = 1 - (G.nightK || 0);
    const rain = (G.time && G.time.rainStrength) || 0;
    b.compMat.uniforms.haze.value = (GAMEPLAY.heatHaze && dayK > 0.7 && rain < 0.15 && !G._inMall) ? (dayK - 0.7) / 0.3 : 0;
  }
  r.setRenderTarget(null); r.render(b.quadScene, b.quadCam);
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
  if (G.input && G.state === 'map') {
    if (G.input.pressed('Equal') || G.input.pressed('NumpadAdd')) setFullMapZoom(1);
    else if (G.input.pressed('Minus') || G.input.pressed('NumpadSubtract')) setFullMapZoom(-1);
    else if (G.input.pressed('Digit0') || G.input.pressed('Numpad0')) setFullMapZoom(0);
  }

  // minimap zoom (N)
  if (G.input && G.input.pressed && G.input.pressed('KeyN') && G.state === 'playing') {
    const levels = [1.6, 2.4, 3.4];
    const cur = G.minimapZoom || levels[1];
    let idx = levels.indexOf(cur);
    if (idx < 0) idx = levels.reduce((best, z, i) => Math.abs(z - cur) < Math.abs(levels[best] - cur) ? i : best, 0);
    G.minimapZoom = levels[(idx + 1) % levels.length];
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

  if (G.input && G.input.pressed && G.input.pressed('F8') && G.state !== 'showcase' && G.state !== 'loading') {
    startDebugShowcase();
  }

  if (G.input) updatePerformanceBudget(realDt);
  if (G.state === 'showcase') {
    updateDebugShowcase(realDt);
    if (G.input.endFrame) G.input.endFrame();
    if (G.showcase) {
      G.renderer.setRenderTarget(null);
      G.renderer.render(G.showcase.scene, G.showcase.camera);
    }
    return;
  }

  if (G.state === 'playing') {
    updatePlayer(dt);
    updateDistrict();
    updateCollectibles(dt);
    updateFoodStalls(dt);
    updateRainPack(dt);
    updateRainPoncho(dt);
    updateBikeSeatCover(dt);
    updateShrines(dt);
    updateLottery(dt);
    updateArmorPickups(dt);
    updateInteraction(dt);
    updateGarage(dt);
    updateGarageOwnership(dt);
    updateRadio(dt);
    if (G.audio && G.audio.updateMusic) G.audio.updateMusic(dt);   // dynamic music bed + G-watched audio events (alarm, boat motor)
    updateTaxi(dt);
    updateMotosai(dt);
    updateQuickDelivery(dt);
    updateTrafficLights(dt);   // advance the signal phase before cars/peds read it
    updateVehicles(dt);
    updateTrafficPopulation(dt);
    updatePeds(dt);
    updateEntityLod();
    updateClusters(dt);
    updateBarks(dt);
    updateMuggings(dt);
    updateSpikes(dt);
    updateVigilante(dt);
    updateTurf(dt);
    updateDogs(dt);
    updateCats(dt);
    updateMonitors(dt);
    updateHyacinth(dt);
    updateWatTurtles(dt);
    updateWatBell(dt);
    updateWatBats(dt);
    updateWatSweep(dt);
    updateWatRobes(dt);
    updateBtsPigeons(dt);
    updateWatLotus(dt);
    updateWatCats(dt);
    updateGeckos(dt);
    updateStallIncense(dt);
    updateSoiFootball(dt);
    updateIceCarts(dt);
    updateCoconutCarts(dt);
    updateChaYen(dt);
    updateRotiCart(dt);
    updateMooPing(dt);
    updateSomTam(dt);
    updateBtsMalai(dt);
    updateMangoSticky(dt);
    updateKanomKrok(dt);
    updateSquidGrill(dt);
    updateYaoGold(dt);
    updateSongthaewRiders(dt);
    updatePlaKat(dt);
    updateBoatNoodle(dt);
    updateAlms(dt);
    updateSchoolKids(dt);
    updateCrossingGuards(dt);
    updateCheckpoint(dt);
    updateSevenGuard(dt);
    updateSevenAtm(dt);
    updateSevenShoppers(dt);
    updateBtsBusker(dt);
    updateSoiChairs(dt);
    updateSoiCowboy(dt);
    updateCowboyClose(dt);
    updateSoiMechanic(dt);
    updateSoiBarber(dt);
    updateOfficeCommute(dt);
    updateMallShoppers(dt);
    updateBtsPlatform(dt);
    updateBtsGates(dt);
    updateSoiWires(dt);
    updateRainFrogs(dt);
    updateSoiCctv(dt);
    updateSeekShade(dt);
    updateYaowaratNight(dt);
    updateYaoPhotos(dt);
    updateFootCops(dt);
    updateBullets(dt);
    updateParticles(dt);
    updateSkids(dt);
    updateDust(dt);
    updateWanted(dt);
    updateCamera(dt);
    updateBTS(dt);
    updateDayNight(dt);
    if (G.audio && G.audio.updateWorld) G.audio.updateWorld(dt);
    updateFestival(dt);
    // distant daytime traffic honks (ambient flavor)
    if (Math.random() < (1 - Math.exp(-0.24 * dt)) * (1 - (G.nightK || 0))) G.audio.blip({ freq: 360, dur: 0.2, type: 'square', gain: 0.03, freqEnd: 330 });
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
    if (G.hud.setSpeed) G.hud.setSpeed(G.player.inVehicle ? G.player.inVehicle.vel : 0, !!G.player.inVehicle, G.player.inVehicle && G.player.inVehicle._rpm01);
    G.hud.setCash(G.cash);
    G.hud.drawMinimap(G.player);
    if (G.input.endFrame) G.input.endFrame();
  } else if (G.state === 'phone') {
    updateCamera(dt);
    const jobs = document.querySelectorAll('#ph-activities .act.job');
    if (jobs.length) {
      if (G.input.pressed('ArrowDown') || G.input.pressed('KeyS')) G._phoneIdx = ((G._phoneIdx || 0) + 1) % jobs.length;
      if (G.input.pressed('ArrowUp') || G.input.pressed('KeyW')) G._phoneIdx = ((G._phoneIdx || 0) - 1 + jobs.length) % jobs.length;
      jobs.forEach((el, i) => { el.style.outline = i === (G._phoneIdx || 0) ? '1px solid #ffcf4a' : ''; });
      if (G.input.pressed('Enter') || G.input.pressed('Space')) {
        const job = jobs[G._phoneIdx || 0] && jobs[G._phoneIdx || 0].getAttribute('data-job');
        if (job && G.mission && G.mission.start) {
          G.mission.start(job);
          document.getElementById('phone').classList.remove('open');
          G.state = 'playing';
          if (G.input.requestLock) G.input.requestLock();
        }
      }
    }
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

  // Smoke: skip GPU so SwiftShader is not mid-frame when the harness presents.
  // ?smoke=1 sets _holdFrame before the first rAF; the harness renders once.
  if (G._holdFrame) return;

  renderBloom();
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

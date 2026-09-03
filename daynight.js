// =============================================================================
// DAYNIGHT — extracted from main.js (see numbered sections). No logic change.
// =============================================================================
import * as THREE from 'three';
import {
  makeStaticBaker, PI, TAU, clamp, lerp, rand, pick, sign, COLORS, G, PRICE, PAINT_COLORS, ROAD_WIDTH, PED_TARGET, GAMEPLAY, _camTarget, _camOffset, _fireDir, _ray, _bbox, _vBox, _blackColor, disposeObject, BLOCK, GRID, HALF, lerpAngle
} from './core.js';
import { makePedMesh } from './main.js';

// 19. DAY/NIGHT + WEATHER
// =============================================================================

export const DAY_LENGTH = 480; // seconds for a full 24h cycle (slow enough that a mission
                        // doesn't blow through dusk-to-dark mid-chase). Everything
                        // time-of-day keys off the normalized dayT/nightK, not this.

function prepWetMat(mat) {
  if (!mat || mat._drySurface) return;
  mat._drySurface = {
    color: mat.color ? mat.color.clone() : new THREE.Color(0xffffff),
    roughness: mat.roughness == null ? 0.8 : mat.roughness,
    metalness: mat.metalness == null ? 0 : mat.metalness,
    envMapIntensity: mat.envMapIntensity || 0,
  };
}

function applyWetMat(mat, wet, opts) {
  if (!mat) return;
  prepWetMat(mat);
  const dry = mat._drySurface;
  mat.roughness = lerp(dry.roughness, opts.roughness, wet);
  mat.metalness = lerp(dry.metalness, opts.metalness, wet);
  if (G.envMap) mat.envMap = G.envMap;
  mat.envMapIntensity = lerp(dry.envMapIntensity, opts.envMapIntensity, wet);
  if (mat.color) mat.color.copy(dry.color).lerp(opts.color, wet);
  mat.needsUpdate = true;
}

function updateWetSurfaces(dt) {
  const sm = G.world && G.world.surfaceMaterials;
  if (!sm) return;
  const rain = G.time.rainStrength || 0;
  if (rain > (G._wetSurface || 0)) G._wetSurface = lerp(G._wetSurface || 0, rain, 0.08);
  else G._wetSurface = Math.max(rain, (G._wetSurface || 0) - dt / 30);
  const wet = clamp(G._wetSurface || 0, 0, 1);
  const wetRoad = { roughness: 0.12, metalness: 0.25, envMapIntensity: 1.2, color: new THREE.Color(0x25282b) };
  const wetGround = { roughness: 0.22, metalness: 0.12, envMapIntensity: 0.8, color: new THREE.Color(0x292c30) };
  const wetWalk = { roughness: 0.45, metalness: 0.08, envMapIntensity: 0.45, color: new THREE.Color(0x55595a) };
  for (const m of sm.road || []) applyWetMat(m, wet, wetRoad);
  for (const m of sm.ground || []) applyWetMat(m, wet * 0.65, wetGround);
  for (const m of sm.sidewalk || []) applyWetMat(m, wet * 0.5, wetWalk);
  if (sm.puddleMat) {
    sm.puddleMat.opacity = wet;
    sm.puddleMat.envMap = G.envMap || sm.puddleMat.envMap;
    sm.puddleMat.envMapIntensity = 0.4 + wet * 1.2;
    sm.puddleMat.needsUpdate = true;
  }
  if (sm.floodMat) {
    const flood = GAMEPLAY.floodPatches && rain > 0.7 ? clamp((rain - 0.7) / 0.3, 0, 1) * 0.55 : 0;
    sm.floodMat.opacity = flood;
    sm.floodMat.needsUpdate = true;
  }
}

export function updateDayNight(dt) {
  const prevT = G.time.dayT;
  G.time.dayT = (G.time.dayT + dt / DAY_LENGTH) % 1;
  if (G.time.dayT < prevT) G.time.day++;     // crossed midnight → a whole day elapsed
  const t = G.time.dayT;          // 0..1, where 0 = midnight, 0.25 = 6am, 0.5 = noon, 0.75 = 6pm
  // sun direction — lateral z-offset keeps noon elevation at ~39° (atan 90/110)
  // so vertical facades still catch direct light at midday; the cos/sin arc
  // keeps mornings/evenings raking along the east-west streets.
  const sunAngle = (t - 0.25) * TAU; // 0 at sunrise (east)
  const sx = Math.cos(sunAngle) * 100;
  const sy = Math.sin(sunAngle) * 90;
  const sz = 110;
  // Re-anchor the sun + shadow camera on the player every frame: the shadow
  // frustum is a ±80 m box, the map is ±250 m — anchored at the origin, most
  // of the playable area would sample outside the frustum.
  const pp = G.player.group.position;
  G.sun.position.set(pp.x + sx, sy, pp.z + sz);
  G.sun.target.position.set(pp.x, 0, pp.z);
  G.sun.target.updateMatrixWorld();
  // sun intensity
  const dayK = clamp((Math.sin(sunAngle) + 0.2), 0, 1);
  G.sun.intensity = dayK * 1.6;
  G.hemi.intensity = 0.3 + dayK * 1.0;
  G.amb.intensity = 0.10 + dayK * 0.18;
  G.renderer.toneMappingExposure = 1.0 + dayK * 0.18;
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
  G.sun.color.setHex(0xffe0a0);
  G._hazeK = 0;
  G.time.pm25 = 0;
  if (G.time.weather === 'overcast') {
    G.sun.intensity *= 0.55;
    G.hemi.intensity *= 0.82;
    G.scene.fog.density += 0.0014;
    G.renderer.toneMappingExposure *= 0.92;
  } else if (GAMEPLAY.burningHaze && G.time.weather === 'haze') {
    // Burning season: noon is the dirty hour. Distance dies, the sun goes ochre,
    // headlights read in the brown air (see vehicles.js). Not a landmark.
    const noonDirty = clamp(dayK, 0, 1);
    G._hazeK = noonDirty;
    G.sun.intensity *= 0.38 + (1 - noonDirty) * 0.28;
    G.sun.color.setHex(0xffb060);
    G.hemi.intensity *= 0.62;
    G.amb.intensity = Math.min(0.42, G.amb.intensity + 0.10);
    G.renderer.toneMappingExposure *= 0.72;
    G.scene.fog.color.setHex(0xb8945a);
    G.scene.fog.density = 0.0048 + noonDirty * 0.0062 + G.time.rainStrength * 0.002;
    G.scene.background.lerp(new THREE.Color(0xc4a070), 0.58 + noonDirty * 0.22);
    G.time.pm25 = Math.round(145 + noonDirty * 95);
    if (G.hud && G.hud.setWeather) G.hud.setWeather(`HAZE · PM2.5 ${G.time.pm25} · 34°C`);
  }

  // neon/lamp/window emissive + accent lights: brighter at night.
  // Iterate only the cached arrays built in buildWorld — no full scene.traverse.
  const nightK = 1 - dayK;
  G.nightK = nightK;   // exposed so vehicle headlights can follow day/night
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

  // weather cycle: clear ⇄ rain / overcast / burning-season haze
  if (G._weatherT === undefined) { G._weatherT = 0; G._weatherUntil = 60; G._rainTarget = 0; }
  G._weatherT += dt;
  if (G._weatherT > G._weatherUntil) {
    if (G.time.weather === 'clear') {
      const roll = Math.random();
      if (roll < 0.5) {
        G.time.weather = 'rain';
        G._rainTarget = Math.random() < 0.5 ? 0.45 : 0.85;
        G.hud.setWeather((G._rainTarget > 0.7 ? 'DOWNPOUR' : 'LIGHT RAIN') + ' · 28°C');
        G.hud.showNotif(G._rainTarget > 0.7 ? 'The sky opens up.' : 'It starts to rain.');
        G.audio.thunder();
        G._weatherUntil = G._weatherT + rand(40, 90);
      } else if (GAMEPLAY.burningHaze && roll < 0.78) {
        G.time.weather = 'haze';
        G._rainTarget = 0;
        G.hud.setWeather('HAZE · PM2.5 180 · 34°C');
        G.hud.showNotif('Burning-season haze rolls in — PM2.5 spikes.');
        G._weatherUntil = G._weatherT + rand(50, 110);
      } else {
        G.time.weather = 'overcast';
        G._rainTarget = 0;
        G.hud.setWeather('OVERCAST · 30°C');
        G.hud.showNotif('Clouds pile up over the Gulf.');
        G._weatherUntil = G._weatherT + rand(50, 100);
      }
    } else {
      G.time.weather = 'clear';
      G._rainTarget = 0;
      G.hud.setWeather('CLEAR · 33°C');
      G._weatherUntil = G._weatherT + rand(70, 150);
    }
  }
  // dt-correct: 0.012/frame at 60 fps is a ~5.7 s half-life, now expressed as one
  G.time.rainStrength = lerp(G.time.rainStrength, G._rainTarget, 1 - Math.pow(0.5, dt / 5.7));
  updateWetSurfaces(dt);
  G.audio.rainBed.setLevel(G.time.rainStrength * 0.18);
  G.rain.update(dt, G.player.group.position, G.time.rainStrength);

  // lightning flashes during heavy rain (transient light boost; reset next frame)
  if (G.time.rainStrength > 0.6 && Math.random() < 1 - Math.exp(-0.27 * dt)) { G._lightningT = 0.14; G.audio.thunder(); }
  if (G._lightningT > 0) {
    G._lightningT -= dt;
    const f = (G._lightningT > 0.08) ? 1 : 0.35;   // bright flash, then a fainter second pop
    G.hemi.intensity += 2.6 * f;
    G.sun.intensity += 1.4 * f;
  }

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
// 19b. LOY KRATHONG FESTIVAL — floats + sky lanterns on the river, on schedule
// =============================================================================
export const FESTIVAL_PERIOD = 3;   // every 3rd night the river fills with krathong
export const KRATHONG_COUNT = 42;
export const RIVER_CX = -229;       // river centerline x (from buildWorld)

// A lotus krathong: leaf base + petals + a glowing candle that reads at night.
export function makeKrathong() {
  const g = new THREE.Group();
  const base = new THREE.Mesh(new THREE.CylinderGeometry(0.4, 0.46, 0.16, 10),
    new THREE.MeshStandardMaterial({ color: 0x2f7d4f, roughness: 0.8 }));
  base.position.y = 0.08; g.add(base);
  const petalMat = new THREE.MeshStandardMaterial({ color: pick([0xff9ec4, 0xffd1e0, 0xfff0d0, 0xffb86b]), roughness: 0.7 });
  for (let k = 0; k < 8; k++) {
    const p = new THREE.Mesh(new THREE.ConeGeometry(0.12, 0.22, 5), petalMat);
    const a = k / 8 * TAU;
    p.position.set(Math.cos(a) * 0.34, 0.18, Math.sin(a) * 0.34);
    p.rotation.z = Math.cos(a) * 0.5; p.rotation.x = Math.sin(a) * 0.5;
    g.add(p);
  }
  const candle = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.045, 0.16, 6),
    new THREE.MeshStandardMaterial({ color: 0xf0e0b0, roughness: 0.6 }));
  candle.position.y = 0.26; g.add(candle);
  const flame = new THREE.Mesh(new THREE.SphereGeometry(0.07, 8, 6),
    new THREE.MeshStandardMaterial({ color: 0xffb030, emissive: 0xffae28, emissiveIntensity: 1.7, roughness: 0.4 }));
  flame.position.y = 0.4; flame.scale.y = 1.7; g.add(flame);
  return g;
}
// A khom loi sky lantern: a glowing ovoid that rises and fades.
export function makeSkyLantern() {
  const mat = new THREE.MeshStandardMaterial({ color: 0xff8a2a, emissive: 0xff7a18, emissiveIntensity: 1.4, roughness: 0.6, transparent: true, opacity: 0.92 });
  const m = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.34, 0.95, 10), mat);
  m.userData.mat = mat; m.frustumCulled = false;
  return m;
}
// Which festival (if any) is on right now.
export function scheduledFestival() {
  const d = G.time.day, night = (G.nightK || 0) > 0.45;
  if (night && d % 4 === 2) return 'loykrathong';
  return null;
}
export function startFestival(type) {
  const f = G.festival; f.type = type; f.announcedDay = G.time.day;
  if (type === 'loykrathong') {
    for (let i = 0; i < KRATHONG_COUNT; i++) {
      const m = makeKrathong();
      m.position.set(RIVER_CX + rand(-13, 13), 0.16, rand(-HALF, HALF));
      m.rotation.y = rand(0, TAU); m.frustumCulled = false; G.scene.add(m);
      f.floats.push({ mesh: m, speed: rand(1.4, 3.2), spin: rand(-0.3, 0.3), phase: rand(0, TAU) });
    }
    for (let i = 0; i < 16; i++) {        // riverside crowd, facing the water
      const m = makePedMesh();
      m.position.set(rand(-206, -200), 0, rand(-HALF + 20, HALF - 20));
      m.rotation.y = -PI / 2; m.frustumCulled = false; G.scene.add(m);
      f.watchers.push(m);
    }
    G.hud.showSubtitle('Loy Krathong — float a krathong on the river.', 'ลอยกระทง');
  }
  if (G.audio && G.audio.bell) G.audio.bell();
}
export function stopFestival() {
  const f = G.festival;
  for (const k of f.floats) { G.scene.remove(k.mesh); disposeObject(k.mesh); }
  for (const l of f.lanterns) { G.scene.remove(l.mesh); l.mesh.geometry.dispose(); l.mesh.userData.mat.dispose(); }
  for (const m of f.watchers) { G.scene.remove(m); disposeObject(m); }
  f.floats = []; f.lanterns = []; f.watchers = []; f.type = null;
}
export function spawnSkyLantern() {
  const m = makeSkyLantern();
  m.position.set(rand(-HALF, -110), rand(5, 14), rand(-HALF, HALF));   // rise over the riverside/west
  G.scene.add(m);
  G.festival.lanterns.push({ mesh: m, rise: rand(2, 4), drift: rand(0.4, 1.5), life: rand(8, 14), maxLife: 14 });
}
export function updateFestival(dt) {
  const f = G.festival;
  const want = scheduledFestival();
  if (want !== f.type) { stopFestival(); if (want) startFestival(want); }
  if (!f.type) return;
  if (f.type === 'loykrathong') updateLoyKrathong(dt);
}
function updateLoyKrathong(dt) {
  const f = G.festival, now = performance.now();
  for (const k of f.floats) {
    k.mesh.position.z += dt * k.speed;
    k.mesh.position.y = 0.16 + Math.sin(now * 0.002 + k.phase) * 0.03;
    k.mesh.rotation.y += dt * k.spin;
    if (k.mesh.position.z > HALF + 5) k.mesh.position.z = -HALF - 5;
  }
  for (let i = f.lanterns.length - 1; i >= 0; i--) {
    const l = f.lanterns[i];
    l.mesh.position.y += dt * l.rise; l.mesh.position.x += dt * l.drift; l.life -= dt;
    l.mesh.userData.mat.opacity = clamp(l.life / l.maxLife, 0, 1) * 0.92;
    if (l.life <= 0) { G.scene.remove(l.mesh); l.mesh.geometry.dispose(); l.mesh.userData.mat.dispose(); f.lanterns.splice(i, 1); }
  }
  f.lanternT = (f.lanternT || 0) - dt;
  if (f.lanternT <= 0 && f.lanterns.length < 14) { spawnSkyLantern(); f.lanternT = rand(0.6, 1.7); }
  for (const m of f.watchers) m.position.y = Math.sin(now * 0.002 + m.position.z) * 0.02;  // gentle sway
  // player floats their own krathong at the riverbank
  const p = G.player;
  if (!p.inVehicle && p.group.position.x < -198 && p.group.position.x > -250) {
    G.hud.showPrompt('Press <b>E</b> to float a krathong', 0.4);
    if (G.input.pressed('KeyE')) {
      const m = makeKrathong();
      m.position.set(clamp(p.group.position.x - 4, -244, -212), 0.16, p.group.position.z);
      m.frustumCulled = false; G.scene.add(m);
      f.floats.push({ mesh: m, speed: rand(1.4, 3.2), spin: rand(-0.3, 0.3), phase: rand(0, TAU) });
      f.krathongFloated = (f.krathongFloated || 0) + 1;
      G.cash += 50; G.hud.setCash(G.cash);
      G.hud.showNotif('You float a krathong — make a wish (+฿50)');
      if (G.audio && G.audio.chime) G.audio.chime();
    }
  }
}

// =============================================================================

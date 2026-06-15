// =============================================================================
// DAYNIGHT — extracted from main.js (see numbered sections). No logic change.
// =============================================================================
import * as THREE from 'three';
import {
  makeStaticBaker, PI, TAU, clamp, lerp, rand, irand, pick, sign, dist2, COLORS, G, PRICE, PAINT_COLORS, ROAD_WIDTH, PED_TARGET, GAMEPLAY, _camTarget, _camOffset, _fireDir, _ray, _bbox, _vBox, _blackColor, disposeObject, BLOCK, GRID, HALF, lerpAngle
} from './core.js';

// 19. DAY/NIGHT + WEATHER
// =============================================================================

export const DAY_LENGTH = 480; // seconds for a full 24h cycle (slow enough that a mission
                        // doesn't blow through dusk-to-dark mid-chase). Everything
                        // time-of-day keys off the normalized dayT/nightK, not this.

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

  // weather cycle: clear ⇄ rain, intensity builds then breaks; lightning in downpours
  if (G._weatherT === undefined) { G._weatherT = 0; G._weatherUntil = 60; G._rainTarget = 0; }
  G._weatherT += dt;
  if (G._weatherT > G._weatherUntil) {
    if (G.time.weather === 'clear') {
      G.time.weather = 'rain';
      G._rainTarget = Math.random() < 0.5 ? 0.45 : 0.85;   // drizzle or downpour
      G.hud.setWeather((G._rainTarget > 0.7 ? 'DOWNPOUR' : 'LIGHT RAIN') + ' · 28°C');
      G.hud.showNotif(G._rainTarget > 0.7 ? 'The sky opens up.' : 'It starts to rain.');
      G.audio.thunder();
      G._weatherUntil = G._weatherT + rand(40, 90);
    } else {
      G.time.weather = 'clear';
      G._rainTarget = 0;
      G.hud.setWeather('CLEAR · 33°C');
      G._weatherUntil = G._weatherT + rand(70, 150);
    }
  }
  G.time.rainStrength = lerp(G.time.rainStrength, G._rainTarget, 0.012);
  G.audio.rainBed.setLevel(G.time.rainStrength * 0.18);
  G.rain.update(dt, G.player.group.position, G.time.rainStrength);

  // lightning flashes during heavy rain (transient light boost; reset next frame)
  if (G.time.rainStrength > 0.6 && Math.random() < 0.0045) { G._lightningT = 0.14; G.audio.thunder(); }
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
export function festivalScheduled() {
  // every 3rd night is Loy Krathong (offset so a fresh game's first night isn't one)
  return (G.time.day % FESTIVAL_PERIOD === 2) && (G.nightK || 0) > 0.45;
}
export function startFestival() {
  const f = G.festival; f.active = true; f.announcedDay = G.time.day;
  for (let i = 0; i < KRATHONG_COUNT; i++) {
    const m = makeKrathong();
    m.position.set(RIVER_CX + rand(-13, 13), 0.16, rand(-HALF, HALF));
    m.rotation.y = rand(0, TAU); m.frustumCulled = false; G.scene.add(m);
    f.floats.push({ mesh: m, speed: rand(1.4, 3.2), spin: rand(-0.3, 0.3), phase: rand(0, TAU) });
  }
  G.hud.showSubtitle('Loy Krathong — the river glows with floats.', 'ลอยกระทง');
  if (G.audio && G.audio.bell) G.audio.bell();
}
export function stopFestival() {
  const f = G.festival; f.active = false;
  for (const k of f.floats) { G.scene.remove(k.mesh); disposeObject(k.mesh); }
  for (const l of f.lanterns) { G.scene.remove(l.mesh); l.mesh.geometry.dispose(); l.mesh.userData.mat.dispose(); }
  f.floats = []; f.lanterns = [];
}
export function spawnSkyLantern() {
  const m = makeSkyLantern();
  m.position.set(rand(-HALF, -110), rand(5, 14), rand(-HALF, HALF));   // rise over the riverside/west
  G.scene.add(m);
  G.festival.lanterns.push({ mesh: m, rise: rand(2, 4), drift: rand(0.4, 1.5), life: rand(8, 14), maxLife: 14 });
}
export function updateFestival(dt) {
  const f = G.festival;
  const want = festivalScheduled();
  if (want && !f.active) startFestival();
  else if (!want && f.active) stopFestival();
  if (!f.active) return;
  const now = performance.now();
  for (const k of f.floats) {
    k.mesh.position.z += dt * k.speed;                                 // drift downstream
    k.mesh.position.y = 0.16 + Math.sin(now * 0.002 + k.phase) * 0.03; // gentle bob
    k.mesh.rotation.y += dt * k.spin;
    if (k.mesh.position.z > HALF + 5) k.mesh.position.z = -HALF - 5;    // recycle
  }
  for (let i = f.lanterns.length - 1; i >= 0; i--) {
    const l = f.lanterns[i];
    l.mesh.position.y += dt * l.rise; l.mesh.position.x += dt * l.drift; l.life -= dt;
    l.mesh.userData.mat.opacity = clamp(l.life / l.maxLife, 0, 1) * 0.92;
    if (l.life <= 0) { G.scene.remove(l.mesh); l.mesh.geometry.dispose(); l.mesh.userData.mat.dispose(); f.lanterns.splice(i, 1); }
  }
  f.lanternT = (f.lanternT || 0) - dt;
  if (f.lanternT <= 0 && f.lanterns.length < 14) { spawnSkyLantern(); f.lanternT = rand(0.6, 1.7); }
}

// =============================================================================

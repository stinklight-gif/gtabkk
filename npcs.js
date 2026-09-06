// =============================================================================
// NPCS — extracted from main.js (see numbered sections). No logic change.
// =============================================================================
import * as THREE from 'three';
import {
  makeStaticBaker, PI, TAU, clamp, lerp, rand, irand, pick, sign, dist2, COLORS, G, PRICE, PAINT_COLORS, TURFS, ROAD_WIDTH, PED_TARGET, GAMEPLAY, yaowaratNightOpen, inYaowarat, _camTarget, _camOffset, _fireDir, _ray, _bbox, _vBox, _blackColor, disposeObject, BLOCK, GRID, HALF, lerpAngle
} from './core.js';
import { animateWalk, damagePlayer, raiseWanted, recolorTorso, resolvePedVsBuildings, saveGame, sidewalkPos, spawnPed, spawnWalkingPair } from './main.js';
import { lightFor } from './traffic.js';

// 13. PEDESTRIANS + DOGS
// =============================================================================

// A casual wanderer about to step off the kerb onto a carriageway whose vehicle
// light is GREEN should wait for the cross rather than walk into moving traffic.
// True only when the *next* step crosses from sidewalk into the live road; peds
// already on the road (clearing it) and peds whose light is red are free to go.
const _RW2 = ROAD_WIDTH / 2;
function roadAboutToEnter(cx, cz, nx, nz) {
  const gx = Math.round(nx / BLOCK) * BLOCK;
  if (Math.abs(cx - gx) >= _RW2 && Math.abs(nx - gx) < _RW2 + 0.3) return { axis: 'x', center: gx, dir: 0 };
  const gz = Math.round(nz / BLOCK) * BLOCK;
  if (Math.abs(cz - gz) >= _RW2 && Math.abs(nz - gz) < _RW2 + 0.3) return { axis: 'z', center: gz, dir: 1 };
  return null;
}
function steppingIntoLiveRoad(cx, cz, nx, nz) {
  const r = roadAboutToEnter(cx, cz, nx, nz);
  return !!(r && lightFor(r.dir) === 'green');
}
function nearestWalkway(x, z) {
  const list = G.world && G.world.walkways;
  if (!list || !list.length) return null;
  let best = null, bd = 1e9;
  for (let i = 0; i < list.length; i++) {
    const w = list[i];
    const cx = clamp(x, w.x0, w.x1), cz = clamp(z, w.z0, w.z1);
    const d = (x - cx) * (x - cx) + (z - cz) * (z - cz);
    if (d < bd) { bd = d; best = w; }
  }
  return best;
}
function pullOntoWalkway(ped, dt) {
  if (!GAMEPLAY.pedWalkways || ped.anchor || ped.gang || ped.panicT > 0 || ped.social || ped.state === 'crossing') return;
  if (ped.pair && !ped.pair.leader) return;
  const w = (ped.walkway && ped.walkway.axis) ? ped.walkway : nearestWalkway(ped.mesh.position.x, ped.mesh.position.z);
  if (!w) return;
  ped.walkway = w;
  const p = ped.mesh.position;
  const ease = 1 - Math.pow(0.12, dt);
  if (w.axis === 'z') {
    p.x = lerp(p.x, (w.x0 + w.x1) * 0.5, ease);
    if (Math.abs(Math.sin(ped.heading)) > 0.72) ped.heading = Math.cos(ped.heading) >= 0 ? 0 : PI;
  } else {
    p.z = lerp(p.z, (w.z0 + w.z1) * 0.5, ease);
    if (Math.abs(Math.cos(ped.heading)) > 0.72) ped.heading = Math.sin(ped.heading) >= 0 ? PI / 2 : -PI / 2;
  }
}

function localBearingTo(ped, target) {
  const dx = target.x - ped.mesh.position.x;
  const dz = target.z - ped.mesh.position.z;
  let a = Math.atan2(dx, dz) - ped.heading;
  while (a > PI) a -= TAU;
  while (a < -PI) a += TAU;
  return a;
}

function updatePedRainProp(ped) {
  const parts = ped.mesh.userData.parts;
  const umbrella = parts && parts.props && parts.props.umbrella;
  if (!umbrella) return;
  const show = !!ped.mesh.userData.umbrellaUser && (G.time.rainStrength || 0) > 0.4 && !ped.gang && ped.panicT <= 0;
  umbrella.userData.propHidden = !show;
  const low = ped.mesh.userData.lod && ped.mesh.userData.lod.state === 'low';
  umbrella.visible = show && !low;
}

function updatePedHeadLook(ped, idx, dt, playerPos) {
  const parts = ped.mesh.userData.parts;
  const head = parts && parts.head;
  if (!head) return;
  ped._lookT = (ped._lookT || (0.08 + (idx % 7) * 0.055)) - dt;
  if (ped._lookT <= 0) {
    ped._lookT = 0.36 + (idx % 5) * 0.035;
    let yaw = 0;
    const dPlayer = dist2(ped.mesh.position, playerPos);
    if (dPlayer < 8 * 8 || (G.wanted.stars > 0 && dPlayer < 14 * 14)) {
      yaw = clamp(localBearingTo(ped, playerPos), -1.1, 1.1);
    } else {
      let best = null, bestD = 999;
      for (const v of G.vehicles) {
        if (!v || v.dead || Math.abs(v.vel || 0) < 9) continue;
        const dx = v.pos.x - ped.mesh.position.x, dz = v.pos.z - ped.mesh.position.z;
        const fwd = Math.sin(ped.heading) * dx + Math.cos(ped.heading) * dz;
        const lat = -Math.cos(ped.heading) * dx + Math.sin(ped.heading) * dz;
        const d2 = dx * dx + dz * dz;
        if (fwd > -1 && Math.abs(lat) < 6 && d2 < 12 * 12 && d2 < bestD) { best = v.pos; bestD = d2; }
      }
      if (best) yaw = clamp(localBearingTo(ped, best), -1.1, 1.1);
    }
    ped._lookYawTarget = yaw;
  }
  head.rotation.y = lerp(head.rotation.y || 0, ped._lookYawTarget || 0, 1 - Math.pow(0.04, dt));
}

// Floating reaction-bark sprites over panicking peds.
export function makeBarkSprite(text) {
  const c = document.createElement('canvas'); c.width = 128; c.height = 64;
  const g = c.getContext('2d');
  g.font = 'bold 34px system-ui, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.lineWidth = 5; g.strokeStyle = '#000'; g.fillStyle = '#fff';
  g.strokeText(text, 64, 32); g.fillText(text, 64, 32);
  const tex = new THREE.CanvasTexture(c);
  const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false }));
  sp.scale.set(2.2, 1.1, 1);
  return sp;
}
export function spawnBark(ped) {
  if (!G.barks) G.barks = [];
  const sp = makeBarkSprite(pick(['!', '!', 'Help!', 'Run!', 'หนี!']));
  sp.position.set(ped.mesh.position.x, ped.mesh.position.y + 2.6, ped.mesh.position.z);
  G.scene.add(sp);
  G.barks.push({ sprite: sp, ped, life: 1.5 });
}
export function updateBarks(dt) {
  if (!G.barks) return;
  for (let i = G.barks.length - 1; i >= 0; i--) {
    const b = G.barks[i];
    b.life -= dt;
    if (b.life <= 0 || b.ped.dead) {
      G.scene.remove(b.sprite);
      if (b.sprite.material.map) b.sprite.material.map.dispose();
      b.sprite.material.dispose();
      G.barks.splice(i, 1);
      continue;
    }
    const m = b.ped.mesh.position;
    b.sprite.position.set(m.x, m.y + 2.6 + (1.5 - b.life) * 0.5, m.z);   // rise as it fades
    b.sprite.material.opacity = Math.min(1, b.life * 1.5);
  }
}

// Crowd density by time of day — Bangkok rhythm: dead 2-5am, morning rush,
// hot midday lull, evening-rush/nightlife peak, late-night taper. Returns 0..1.
export const CROWD_CURVE = [
  [0, 0.22], [2, 0.10], [5, 0.10], [7, 0.55], [8.5, 1.0], [11, 0.72],
  [14, 0.72], [16, 0.82], [18.5, 1.0], [21, 0.85], [23, 0.40], [24, 0.22],
];
export function crowdFactor(dayT) {
  const h = ((dayT % 1) + 1) % 1 * 24;
  for (let i = 0; i < CROWD_CURVE.length - 1; i++) {
    const a = CROWD_CURVE[i], b = CROWD_CURVE[i + 1];
    if (h >= a[0] && h <= b[0]) return lerp(a[1], b[1], (h - a[0]) / (b[0] - a[0]));
  }
  return CROWD_CURVE[0][1];
}
export function crowdTarget() {
  let n = Math.round(PED_TARGET * crowdFactor(G.time.dayT));
  if (yaowaratNightOpen()) n = Math.min(PED_TARGET + 14, n + 12);
  return n;
}

export function updateYaowaratNight(dt) {
  const night = G.world && G.world.yaowaratNight;
  if (!night) return;
  const open = yaowaratNightOpen();
  if (night.group) night.group.visible = open;
  const poi = G.world.poi && G.world.poi.yaowarat;
  if (!poi || !GAMEPLAY.yaowaratNight) return;
  G._yaoNightPeds = G._yaoNightPeds || [];
  G._yaoNightPeds = G._yaoNightPeds.filter(p => p && !p.dead);
  if (open) {
    while (G._yaoNightPeds.length < 8) {
      const pos = new THREE.Vector3(poi.x + rand(-10, 10), 0, poi.z + rand(-28, 28));
      const ped = spawnPed(G.scene, pos);
      ped.yaowaratNight = true;
      ped.kind = Math.random() < 0.55 ? 'tourist' : 'vendor';
      if (ped.mesh && ped.mesh.userData) ped.mesh.userData.kind = ped.kind;
      G._yaoNightPeds.push(ped);
    }
  } else if (G._yaoNightPeds.length) {
    for (const ped of G._yaoNightPeds) {
      if (!ped || ped.dead) continue;
      ped.yaowaratNight = false;
    }
    G._yaoNightPeds = [];
  }
}

export function updateYaoPhotos(dt) {
  if (!GAMEPLAY.yaoPhotos) return;
  const poi = G.world && G.world.poi && G.world.poi.yaowarat;
  if (!poi) return;
  const open = yaowaratNightOpen();
  if (open) {
    G._yaoPhotos = G._yaoPhotos || [];
    const slots = [
      { x: poi.x + 2.4, z: poi.z - 16, facing: -PI / 2 },
      { x: poi.x - 2.4, z: poi.z - 6, facing: PI / 2 },
      { x: poi.x + 2.4, z: poi.z + 6, facing: -PI / 2 },
      { x: poi.x - 2.4, z: poi.z + 16, facing: PI / 2 },
    ];
    while (G._yaoPhotos.length < slots.length) {
      const slot = slots[G._yaoPhotos.length];
      const ped = spawnPed(G.scene, new THREE.Vector3(slot.x, 0, slot.z), 'tourist');
      ped.yaoPhoto = true;
      ped.anchor = { slot: new THREE.Vector3(slot.x, 0, slot.z), facing: slot.facing };
      ped.speed = 0;
      ped.state = 'idle';
      ped.heading = slot.facing;
      if (ped.mesh) ped.mesh.rotation.y = slot.facing;
      const phone = new THREE.Mesh(
        new THREE.BoxGeometry(0.05, 0.1, 0.016),
        new THREE.MeshStandardMaterial({ color: 0x0b0d12, roughness: 0.4, metalness: 0.3, emissive: 0xffffff, emissiveIntensity: 0.15 })
      );
      phone.name = 'yao-phone';
      const parts = ped.mesh && ped.mesh.userData && ped.mesh.userData.parts;
      if (parts && parts.foreL) { phone.position.set(0.02, -0.26, 0.08); parts.foreL.add(phone); }
      else if (ped.mesh) { phone.position.set(0.18, 1.15, 0.16); ped.mesh.add(phone); }
      ped._yaoPhone = phone;
      G._yaoPhotos.push(ped);
    }
    G._yaoPhotoT = (G._yaoPhotoT || 0) + dt;
    const flash = 0.12 + Math.max(0, Math.sin(G._yaoPhotoT * 7)) * 0.85;
    for (const ped of G._yaoPhotos) {
      if (!ped || ped.dead || !ped.mesh) continue;
      ped.yaoPhoto = true;
      ped.speed = 0;
      if (ped.anchor && ped.anchor.slot) {
        ped.mesh.position.set(ped.anchor.slot.x, 0, ped.anchor.slot.z);
        ped.heading = ped.anchor.facing;
        ped.mesh.rotation.y = ped.heading;
      }
      if (ped._yaoPhone && ped._yaoPhone.material) ped._yaoPhone.material.emissiveIntensity = flash;
    }
  } else if (G._yaoPhotos && G._yaoPhotos.length) {
    for (const ped of G._yaoPhotos) {
      if (!ped || ped.dead) continue;
      ped.yaoPhoto = false;
      ped.anchor = null;
    }
    G._yaoPhotos = [];
  }
}

// Snap the live crowd to the current time-of-day target immediately (spawn the
// shortfall near the player, cull the farthest excess). Used by the headless
// harness so a screenshot reflects the hour without waiting for the slow ramp;
// gameplay reaches the same target gradually via updatePeds.
export function resyncCrowd() {
  const pp = G.player.group.position;
  const target = crowdTarget();
  // pull stray wanderers onto nearby sidewalks so the count near the camera
  // reflects the hour immediately (harness-only; gameplay distributes gradually)
  for (const ped of G.peds) {
    if (ped.isMugger || ped.isTarget || ped.anchor || ped.gang || ped.alms || ped.yaowaratNight || ped.yaoPhoto || ped.pillion || ped.school || ped.btsWait || ped.commute || ped.crossingGuard || ped.iceCart || ped.football || ped.mallShop || ped.lottery || ped.coconutCart || ped.checkpoint || ped.btsSit || ped.mooPing || ped.sevenGuard || ped.mallGuard || ped.bankGuard || ped.mallDir || ped.gunClerk || ped.starterClerk || ped.officeSmoke || ped.bankQueue || ped.mallFood || ped.mallTech || ped.mallPharm || ped.mallRoma || ped.mallWatch || ped.mallManga || ped.mallSushi || ped.mallCafe || ped.mallThreads || ped.mallSeven || ped.mallArcade || ped.gymBag || ped.homeAuntie || ped.stationPorter || ped.garageMech || ped.klongDock || ped.sengClerk || ped.airportCrew || ped.airportCargo || ped.airportTower || ped.airportTaxi || ped.soiDrink || ped.soiMechanic || ped.cowboy || ped.boatNoodle || ped.pierWait || ped.somTam || ped.btsMalai || ped.cowboyClose || ped.plaKat || ped.chaYen || ped.roti || ped.mango || ped.phromFruit || ped.kanom || ped.squid || ped.songthaewRide || ped.watSweep || ped.yaoGold || ped.yaoDuck || ped.yaoFortune || ped.sevenAtm || ped.btsBusker || ped.watLotus || ped.watAmulet || ped.watDrum || ped.sevenShop || ped.sevenSlush || ped.btsPaper || ped.btsShine || ped.soiBarber) continue;
    if (dist2(ped.mesh.position, pp) > 95 * 95) ped.mesh.position.copy(sidewalkPos(pp.x, pp.z, 88));
  }
  for (let guard = 0; G.peds.length > target && guard < 500; guard++) {
    let fi = -1, fd = -1;
    for (let i = 0; i < G.peds.length; i++) {
      const ped = G.peds[i];
      if (ped.isMugger || ped.isTarget || ped.anchor || ped.gang || ped.alms || ped.yaowaratNight || ped.yaoPhoto || ped.pillion || ped.school || ped.btsWait || ped.commute || ped.crossingGuard || ped.iceCart || ped.football || ped.mallShop || ped.lottery || ped.coconutCart || ped.checkpoint || ped.btsSit || ped.mooPing || ped.sevenGuard || ped.mallGuard || ped.bankGuard || ped.mallDir || ped.gunClerk || ped.starterClerk || ped.officeSmoke || ped.bankQueue || ped.mallFood || ped.mallTech || ped.mallPharm || ped.mallRoma || ped.mallWatch || ped.mallManga || ped.mallSushi || ped.mallCafe || ped.mallThreads || ped.mallSeven || ped.mallArcade || ped.gymBag || ped.homeAuntie || ped.stationPorter || ped.garageMech || ped.klongDock || ped.sengClerk || ped.airportCrew || ped.airportCargo || ped.airportTower || ped.airportTaxi || ped.soiDrink || ped.soiMechanic || ped.cowboy || ped.boatNoodle || ped.pierWait || ped.somTam || ped.btsMalai || ped.cowboyClose || ped.plaKat || ped.chaYen || ped.roti || ped.mango || ped.phromFruit || ped.kanom || ped.squid || ped.songthaewRide || ped.watSweep || ped.yaoGold || ped.yaoDuck || ped.yaoFortune || ped.sevenAtm || ped.btsBusker || ped.watLotus || ped.watAmulet || ped.watDrum || ped.sevenShop || ped.sevenSlush || ped.btsPaper || ped.btsShine || ped.soiBarber) continue;
      const d = dist2(ped.mesh.position, pp);
      if (d > fd) { fd = d; fi = i; }
    }
    if (fi < 0) break;
    G.scene.remove(G.peds[fi].mesh); disposeObject(G.peds[fi].mesh); G.peds.splice(fi, 1);
  }
  while (G.peds.length < target) {
    spawnPed(G.scene, sidewalkPos(pp.x, pp.z, 88));
  }
  G._clusterT = 0; updateClusters(0);   // populate nearby stalls/stores for the shot too
}
G.resyncCrowd = resyncCrowd;   // exposed on window.GAME for the smoke harness

export function updatePeds(dt) {
  const playerPos = G.player.group.position;
  for (let pedIdx = 0; pedIdx < G.peds.length; pedIdx++) {
    const ped = G.peds[pedIdx];
    if (ped.dead) continue;
    if (ped.pillion) continue;
    if (ped.btsSit || ped.sevenGuard || ped.mallGuard || ped.bankGuard || ped.mallFood || ped.mallManga || ped.homeAuntie || ped.soiDrink || ped.stationSit) {
      const slot = ped.anchor && ped.anchor.slot;
      if (slot) {
        ped.mesh.position.x = slot.x;
        ped.mesh.position.z = slot.z;
        ped.mesh.position.y = slot.y || 0.42;
        ped.heading = ped.anchor.facing;
        ped.mesh.rotation.y = ped.heading;
      }
      ped.speed = 0;
      ped.state = 'idle';
      const p = ped.mesh.userData.parts;
      if (p) {
        if (p.legL) p.legL.rotation.x = 1.28;
        if (p.legR) p.legR.rotation.x = 1.18;
        if (p.shinL) p.shinL.rotation.x = -1.15;
        if (p.shinR) p.shinR.rotation.x = -1.05;
        if (p.armL) p.armL.rotation.x = -0.55;
        if (p.armR) p.armR.rotation.x = -0.4;
      }
      continue;
    }
    if (ped.alms && ped._almsSoi) {
      ped.mesh.rotation.y = ped.heading;
      updatePedRainProp(ped);
      animateWalk(ped.mesh, ped.speed, dt, ped.speed > 0.05);
      continue;
    }
    if (ped.cowboy) {
      const slot = ped.anchor && ped.anchor.slot;
      if (slot) {
        ped.mesh.position.set(slot.x, 0, slot.z);
        ped.heading = ped.anchor.facing;
        ped.mesh.rotation.y = ped.heading;
      }
      ped.speed = 0;
      ped.state = 'idle';
      continue;
    }
    if (ped.cowboyClose) {
      ped.mesh.position.x += Math.sin(ped.heading) * ped.speed * dt;
      ped.mesh.position.z += Math.cos(ped.heading) * ped.speed * dt;
      ped.mesh.rotation.y = ped.heading;
      updatePedRainProp(ped);
      animateWalk(ped.mesh, ped.speed, dt, ped.speed > 0.05);
      continue;
    }
    if (ped.songthaewRide) {
      ped.speed = 0;
      ped.state = 'idle';
      const p = ped.mesh && ped.mesh.userData && ped.mesh.userData.parts;
      if (p) {
        if (p.legL) p.legL.rotation.x = 1.22;
        if (p.legR) p.legR.rotation.x = 1.12;
        if (p.shinL) p.shinL.rotation.x = -1.08;
        if (p.shinR) p.shinR.rotation.x = -0.98;
        if (p.armL) p.armL.rotation.x = -0.4;
        if (p.armR) p.armR.rotation.x = -0.28;
      }
      continue;
    }
    if (ped.watSweep) {
      continue;
    }
    if (ped.yaoGold) {
      const slot = ped.anchor && ped.anchor.slot;
      if (slot) {
        ped.mesh.position.set(slot.x, 0, slot.z);
        ped.heading = ped.anchor.facing;
        ped.mesh.rotation.y = ped.heading;
      }
      ped.speed = 0;
      ped.state = 'idle';
      continue;
    }
    if (ped.yaoDuck) {
      continue;
    }
    if (ped.yaoFortune) {
      continue;
    }
    if (ped.sevenAtm) {
      continue;
    }
    if (ped.btsBusker) {
      continue;
    }
    if (ped.watLotus) {
      continue;
    }
    if (ped.watAmulet) {
      continue;
    }
    if (ped.watDrum) {
      continue;
    }
    if (ped.sevenShop) {
      continue;
    }
    if (ped.sevenSlush) {
      continue;
    }
    if (ped.phromFruit) {
      continue;
    }
    if (ped.btsPaper) {
      continue;
    }
    if (ped.btsShine) {
      continue;
    }
    if (ped.mallDir) {
      continue;
    }
    if (ped.gunClerk) {
      continue;
    }
    if (ped.starterClerk) {
      continue;
    }
    if (ped.homeAuntie) {
      continue;
    }
    if (ped.stationPorter) {
      continue;
    }
    if (ped.garageMech) {
      continue;
    }
    if (ped.klongDock) {
      continue;
    }
    if (ped.sengClerk) {
      continue;
    }
    if (ped.airportCrew) {
      continue;
    }
    if (ped.airportCargo) {
      continue;
    }
    if (ped.airportTower) {
      continue;
    }
    if (ped.airportTaxi) {
      continue;
    }
    if (ped.officeSmoke) {
      continue;
    }
    if (ped.bankQueue) {
      continue;
    }
    if (ped.mallFood) {
      continue;
    }
    if (ped.mallTech) {
      continue;
    }
    if (ped.mallPharm) {
      continue;
    }
    if (ped.mallRoma) {
      continue;
    }
    if (ped.mallWatch) {
      continue;
    }
    if (ped.mallManga) {
      continue;
    }
    if (ped.mallSushi) {
      continue;
    }
    if (ped.mallCafe) {
      continue;
    }
    if (ped.mallThreads) {
      continue;
    }
    if (ped.mallSeven) {
      continue;
    }
    if (ped.mallArcade) {
      continue;
    }
    if (ped.gymBag) {
      continue;
    }
    if (ped.yaoPhoto) {
      const slot = ped.anchor && ped.anchor.slot;
      if (slot) {
        ped.mesh.position.set(slot.x, 0, slot.z);
        ped.heading = ped.anchor.facing;
        ped.mesh.rotation.y = ped.heading;
      }
      ped.speed = 0;
      ped.state = 'idle';
      continue;
    }
    if (ped.soiBarber) {
      const slot = ped.anchor && ped.anchor.slot;
      if (slot) {
        ped.mesh.position.set(slot.x, 0, slot.z);
        ped.heading = ped.anchor.facing;
        ped.mesh.rotation.y = ped.heading;
      }
      ped.speed = 0;
      ped.state = 'idle';
      continue;
    }
    if (ped.plaKat) {
      const slot = ped.anchor && ped.anchor.slot;
      if (slot) {
        ped.mesh.position.set(slot.x, 0, slot.z);
        ped.heading = ped.anchor.facing;
        ped.mesh.rotation.y = ped.heading;
      }
      ped.speed = 0;
      ped.state = 'idle';
      continue;
    }
    if (ped.btsMalai) {
      const slot = ped.anchor && ped.anchor.slot;
      if (slot) {
        ped.mesh.position.set(slot.x, 0, slot.z);
        ped.heading = ped.anchor.facing;
        ped.mesh.rotation.y = ped.heading;
      }
      ped.speed = 0;
      ped.state = 'idle';
      continue;
    }
    if (ped.boatNoodle) {
      const slot = ped.anchor && ped.anchor.slot;
      if (slot) {
        ped.mesh.position.set(slot.x, slot.y || 0.42, slot.z);
        ped.heading = ped.anchor.facing;
        ped.mesh.rotation.y = ped.heading;
      }
      ped.speed = 0;
      ped.state = 'idle';
      continue;
    }
    if (ped.pierWait) {
      continue;
    }
    if (ped.btsWait) {
      const y = ped.btsY || 13.9;
      if (ped.btsBoarded || !ped.mesh.visible) {
        ped.speed = 0;
      } else if (ped.btsApproach) {
        ped.heading = ped.mesh.position.z >= 0 ? PI : 0;
        ped.speed = 1.55;
        ped.mesh.position.x += Math.sin(ped.heading) * ped.speed * dt;
        ped.mesh.position.z += Math.cos(ped.heading) * ped.speed * dt;
      } else if (ped.btsSlot) {
        ped.speed = 0;
        ped.heading = ped.btsSlot.facing;
        const ease = 1 - Math.pow(0.08, dt);
        ped.mesh.position.x = lerp(ped.mesh.position.x, ped.btsSlot.x, ease);
        ped.mesh.position.z = lerp(ped.mesh.position.z, ped.btsSlot.z, ease);
      } else ped.speed = 0;
      ped.mesh.position.y = y;
      ped.mesh.rotation.y = ped.heading;
      if (ped.mesh.visible) {
        updatePedRainProp(ped);
        animateWalk(ped.mesh, ped.speed, dt, ped.speed > 0.05);
      }
      continue;
    }
    if (!ped.gang && ped.panicT <= 0 && !ped.anchor) {
      for (const v of G.vehicles) {
        if (!v || v.dead || Math.abs(v.vel || 0) < 7) continue;
        const dx = ped.mesh.position.x - v.pos.x, dz = ped.mesh.position.z - v.pos.z;
        const d2 = dx * dx + dz * dz;
        if (d2 > 5.5 * 5.5) continue;
        const fwd = Math.sin(v.heading) * dx + Math.cos(v.heading) * dz;
        if (fwd < -1.8) continue;
        const d = Math.sqrt(d2) || 1;
        ped.heading = Math.atan2(dx, dz);
        ped.panicT = Math.max(ped.panicT, 2.8);
        ped.panicFrom = { x: v.pos.x, z: v.pos.z };
        ped.knockX = (ped.knockX || 0) + dx / d * Math.min(2.6, Math.abs(v.vel) * 0.08);
        ped.knockZ = (ped.knockZ || 0) + dz / d * Math.min(2.6, Math.abs(v.vel) * 0.08);
        if ((!G.barks || G.barks.length < 8) && Math.random() < 0.08) spawnBark(ped);
        break;
      }
    }
    // gang member: chase the player and swing on contact (set heading/speed; the
    // shared move + animate code below applies it)
    if (ped.gang) {
      const dx = playerPos.x - ped.mesh.position.x, dz = playerPos.z - ped.mesh.position.z;
      const d = Math.hypot(dx, dz) || 1;
      ped.heading = Math.atan2(dx, dz);
      // flinch: a hit briefly halts the rush (set in combat.js)
      if (ped.flinchT > 0) { ped.flinchT -= dt; ped.speed = 0; }
      else {
        ped.speed = d > 1.5 ? 2.7 : 0;
        // dodge: when the player aims a gun at close range, occasionally juke aside
        const aiming = !G.player.inVehicle && G.player.activeWeapon !== 'fists' && (G.input.rightDown || G.input.mouseDown);
        ped._dodgeCD = (ped._dodgeCD || 0) - dt;
        if (aiming && d < 12 && ped._dodgeCD <= 0 && Math.random() < 0.04) {
          ped.heading += (Math.random() < 0.5 ? -1 : 1) * 1.2;   // strafe off the line of fire
          ped.speed = 3.4; ped._dodgeCD = 1.5;
        }
        ped._atkCD = (ped._atkCD || 0) - dt;
        if (d < 1.9 && ped._atkCD <= 0) { damagePlayer(6); ped._atkCD = 1.0; }
      }
    } else
    // panic if loud near
    if (ped.panicT > 0) {
      ped.panicT -= dt;
      ped.speed = 3.0;
      const src = ped.panicFrom || playerPos;
      const dx = ped.mesh.position.x - src.x;
      const dz = ped.mesh.position.z - src.z;
      ped.heading = Math.atan2(dx, dz);
      // occasional reaction bark (capped, so a panicked crowd doesn't spam)
      ped._barkCD = (ped._barkCD || 0) - dt;
      if (ped._barkCD <= 0 && (!G.barks || G.barks.length < 8) && Math.random() < 0.04) {
        spawnBark(ped); ped._barkCD = 4;
      }
    } else if (ped.anchor) {
      // cluster member: hold a slot at a food stall / 7-Eleven, drifting back
      // to it if knocked off (e.g. after a panic), then stand and face inward
      const slot = ped.anchor.slot;
      const dx = slot.x - ped.mesh.position.x, dz = slot.z - ped.mesh.position.z;
      const d = Math.hypot(dx, dz);
      if (d > 0.5) { ped.heading = Math.atan2(dx, dz); ped.speed = 1.1; ped.state = 'returning'; }
      else { ped.speed = 0; ped.state = 'idle'; ped.heading = ped.anchor.facing; }
    } else if (ped.social) {
      const slot = ped.social.slot;
      const dx = slot.x - ped.mesh.position.x, dz = slot.z - ped.mesh.position.z;
      const d = Math.hypot(dx, dz);
      if (d > 0.45) {
        ped.heading = Math.atan2(dx, dz);
        ped.speed = 0.85;
        ped.state = 'social';
      } else {
        ped.speed = 0;
        ped.state = 'social';
        ped.heading = ped.social.facing + Math.sin((ped.social.idlePhase || 0) + performance.now() * 0.001) * 0.12;
      }
    } else if (ped.shade) {
      const dx = ped.shade.x - ped.mesh.position.x, dz = ped.shade.z - ped.mesh.position.z;
      const d = Math.hypot(dx, dz);
      if (d > 0.7) { ped.heading = Math.atan2(dx, dz); ped.speed = 1.15; ped.state = 'shade'; }
      else { ped.speed = 0; ped.state = 'shade'; }
    } else if (ped.state === 'waitingCrossing') {
      ped.speed = 0;
      const road = ped.crossRoad;
      if (GAMEPLAY.pedCrosswalks && road && lightFor(road.dir) !== 'green') {
        ped.state = 'crossing';
        ped.speed = 1.45;
        if (road.axis === 'x') ped.heading = ped.mesh.position.x < road.center ? PI / 2 : -PI / 2;
        else ped.heading = ped.mesh.position.z < road.center ? 0 : PI;
      } else {
        const probeSpeed = 1.1;
        const nx = ped.mesh.position.x + Math.sin(ped.heading) * probeSpeed * dt;
        const nz = ped.mesh.position.z + Math.cos(ped.heading) * probeSpeed * dt;
        if (!steppingIntoLiveRoad(ped.mesh.position.x, ped.mesh.position.z, nx, nz)) {
          ped.state = 'walking';
          ped.speed = rand(0.9, 1.7) * (ped.speedMul || 1);
          ped.waitT = rand(1.0, 2.4);
        }
      }
    } else if (ped.state === 'crossing') {
      ped.speed = 1.45;
      const road = ped.crossRoad;
      if (road) {
        const along = road.axis === 'x' ? ped.mesh.position.x : ped.mesh.position.z;
        if (Math.abs(along - road.center) > _RW2 + 1.7) {
          ped.state = 'walking';
          ped.speed = rand(0.9, 1.7) * (ped.speedMul || 1);
          ped.walkway = nearestWalkway(ped.mesh.position.x, ped.mesh.position.z);
          ped.crossRoad = null;
        }
      } else {
        ped.state = 'walking';
      }
    } else if (ped.state === 'walking') {
      // light wander, mostly on sidewalk side of block
      ped.waitT -= dt;
      if (ped.waitT <= 0) {
        ped.heading += rand(-0.5, 0.5);
        ped.waitT = rand(1.5, 4);
      }
    }
    if (ped.pair && ped.buddy && !ped.buddy.dead && !ped.anchor && ped.panicT <= 0 && !ped.gang) {
      const pair = ped.pair.group;
      if (ped.pair.leader) {
        pair.waitT = Math.max(0, (pair.waitT || ped.waitT || 0) - dt);
        if (pair.waitT <= 0) {
          pair.heading += rand(-0.45, 0.45);
          pair.waitT = rand(1.8, 4.2);
        }
        ped.heading = pair.heading;
        ped.speed = pair.speed * (ped.speedMul || 1);
      } else {
        const leader = ped.buddy;
        const rightX = Math.cos(pair.heading), rightZ = -Math.sin(pair.heading);
        const tx = leader.mesh.position.x + rightX * ped.pair.side;
        const tz = leader.mesh.position.z + rightZ * ped.pair.side;
        const dx = tx - ped.mesh.position.x, dz = tz - ped.mesh.position.z;
        const d = Math.hypot(dx, dz);
        ped.heading = d > 0.08 ? Math.atan2(dx, dz) : pair.heading;
        ped.speed = pair.speed * (ped.speedMul || 1) * (d > 1.2 ? 1.25 : d < 0.45 ? 0.45 : 1);
      }
    }
    // signal-aware kerb hold: plain wanderers wait at the edge of a carriageway
    // that currently has the green (panicked / gang / clustered / encounter peds
    // are exempt — they keep their urgent paths). Only zeroes speed; never moves.
    if (ped.state === 'walking' && ped.speed > 0.05 && !ped.gang && ped.panicT <= 0 && !ped.anchor && !ped.isMugger && !ped.isTarget && !ped.alms) {
      const nx = ped.mesh.position.x + Math.sin(ped.heading) * ped.speed * dt;
      const nz = ped.mesh.position.z + Math.cos(ped.heading) * ped.speed * dt;
      const road = roadAboutToEnter(ped.mesh.position.x, ped.mesh.position.z, nx, nz);
      if (road && lightFor(road.dir) === 'green') {
        ped.speed = 0;
        ped.state = 'waitingCrossing';
        ped.crossRoad = road;
      }
    }
    if (!ped.gang && ped.panicT <= 0 && !ped.anchor) {
      let ax = 0, az = 0, n = 0;
      for (const other of G.peds) {
        if (other === ped || other.dead) continue;
        if ((ped.buddy && other === ped.buddy) || (ped.pair && other.pair && ped.pair.group === other.pair.group)) continue;
        const dx = ped.mesh.position.x - other.mesh.position.x, dz = ped.mesh.position.z - other.mesh.position.z;
        const d2 = dx * dx + dz * dz;
        if (d2 <= 0.0001 || d2 > 0.9 * 0.9) continue;
        const d = Math.sqrt(d2);
        const push = (0.9 - d) / 0.9;
        ax += dx / d * push; az += dz / d * push; n++;
        if (n >= 4) break;
      }
      if (n) {
        ped.mesh.position.x += ax * dt * 0.7;
        ped.mesh.position.z += az * dt * 0.7;
      }
    }
    ped.mesh.position.x += Math.sin(ped.heading) * ped.speed * dt;
    ped.mesh.position.z += Math.cos(ped.heading) * ped.speed * dt;
    pullOntoWalkway(ped, dt);
    resolvePedVsBuildings(ped);
    // knockback impulse — a short shove that decays fast
    if (ped.knockX || ped.knockZ) {
      ped.mesh.position.x += ped.knockX * dt;
      ped.mesh.position.z += ped.knockZ * dt;
      const decay = Math.pow(0.015, dt);
      ped.knockX *= decay; ped.knockZ *= decay;
      if (Math.abs(ped.knockX) < 0.05 && Math.abs(ped.knockZ) < 0.05) { ped.knockX = 0; ped.knockZ = 0; }
    }
    ped.mesh.rotation.y = ped.heading;
    updatePedRainProp(ped);
    animateWalk(ped.mesh, ped.speed, dt, ped.speed > 0.05);
    updatePedHeadLook(ped, pedIdx, dt, playerPos);

    // bounds
    ped.mesh.position.x = clamp(ped.mesh.position.x, -HALF + 2, HALF - 2);
    ped.mesh.position.z = clamp(ped.mesh.position.z, -HALF + 2, HALF - 2);

    // recycle a wanderer that strayed too far back onto a sidewalk in view
    // (anchored cluster peds stay put — they belong to a stall/store)
    if (!ped.anchor && !ped.school && !ped.commute && dist2(ped.mesh.position, playerPos) > 170*170) {
      ped.mesh.position.copy(sidewalkPos(playerPos.x, playerPos.z, 75));
      if (ped.social) {
        ped.social = null;
        ped.state = 'walking';
        ped.speed = rand(0.9, 1.7) * (ped.speedMul || 1);
      }
      if (ped.pair) { if (ped.buddy) ped.buddy.buddy = null; ped.pair = null; ped.buddy = null; }
    }
  }
  // keep the streets populated to the time-of-day target — busy at rush hour,
  // near-empty in the small hours (see crowdFactor)
  const target = crowdTarget();
  // Spend a dt-based budget rather than exactly one ped per frame: the old version
  // ramped the crowd in at whatever the frame rate happened to be, so a fast machine
  // filled the pavements more than twice as quickly as a slow one.
  G._pedAcc = Math.min(4, (G._pedAcc || 0) + dt * 12);
  if (G.peds.length < target && G._pedAcc >= 1) {
    G._pedAcc -= 1;
    if (target - G.peds.length > 1 && Math.random() < 0.12) spawnWalkingPair(G.scene, sidewalkPos(playerPos.x, playerPos.z, 90));
    else spawnPed(G.scene, sidewalkPos(playerPos.x, playerPos.z, 90));   // ramps in smoothly
  } else if (G.peds.length > target && G._pedAcc >= 1) {
    G._pedAcc -= 1;
    // thin toward the target by dropping the farthest non-special ped
    let fi = -1, fd = 60 * 60;
    for (let i = 0; i < G.peds.length; i++) {
      const ped = G.peds[i];
      if (ped.isMugger || ped.isTarget || ped.anchor || ped.gang || ped.alms || ped.yaowaratNight || ped.yaoPhoto || ped.pillion || ped.school || ped.btsWait || ped.commute || ped.crossingGuard || ped.iceCart || ped.football || ped.mallShop || ped.lottery || ped.coconutCart || ped.checkpoint || ped.btsSit || ped.mooPing || ped.sevenGuard || ped.mallGuard || ped.bankGuard || ped.mallDir || ped.gunClerk || ped.starterClerk || ped.officeSmoke || ped.bankQueue || ped.mallFood || ped.mallTech || ped.mallPharm || ped.mallRoma || ped.mallWatch || ped.mallManga || ped.mallSushi || ped.mallCafe || ped.mallThreads || ped.mallSeven || ped.mallArcade || ped.gymBag || ped.homeAuntie || ped.stationPorter || ped.garageMech || ped.klongDock || ped.sengClerk || ped.airportCrew || ped.airportCargo || ped.airportTower || ped.airportTaxi || ped.soiDrink || ped.soiMechanic || ped.cowboy || ped.boatNoodle || ped.pierWait || ped.somTam || ped.btsMalai || ped.cowboyClose || ped.plaKat || ped.chaYen || ped.roti || ped.mango || ped.phromFruit || ped.kanom || ped.squid || ped.songthaewRide || ped.watSweep || ped.yaoGold || ped.yaoDuck || ped.yaoFortune || ped.sevenAtm || ped.btsBusker || ped.watLotus || ped.watAmulet || ped.watDrum || ped.sevenShop || ped.sevenSlush || ped.btsPaper || ped.btsShine || ped.soiBarber) continue;
      const d = dist2(ped.mesh.position, playerPos);
      if (d > fd) { fd = d; fi = i; }
    }
    if (fi >= 0) { G.scene.remove(G.peds[fi].mesh); disposeObject(G.peds[fi].mesh); G.peds.splice(fi, 1); }
  }
}

// ---- Behavioral clusters: queues at food stalls, loiterers at 7-Elevens ----
// Each anchor owns a few slot positions; updateClusters keeps the right number
// of standing peds parked there for the current hour (busy midday/evening,
// empty in the small hours), only populating anchors near the player.
export function buildClusterAnchors() {
  G.clusterAnchors = [];
  for (const f of (G.world.foodStalls || [])) {
    const theta = rand(0, TAU);
    const fwd = new THREE.Vector3(Math.sin(theta), 0, Math.cos(theta));
    const right = new THREE.Vector3(Math.cos(theta), 0, -Math.sin(theta));
    const slots = [];
    for (const [d, s] of [[1.25, -0.5], [1.25, 0.55], [2.15, -0.45], [2.15, 0.5]]) {
      const p = f.pos.clone().addScaledVector(fwd, d).addScaledVector(right, s);
      slots.push({ pos: p, facing: theta + PI });          // face back toward the cart
    }
    G.clusterAnchors.push({ pos: f.pos.clone(), kind: 'food', capacity: 4, slots, peds: [] });
  }
  for (const e of (G.world.sevenElevens || [])) {
    const theta = rand(0, TAU);
    const slots = [];
    for (let k = 0; k < 3; k++) {
      const a = theta + (k - 1) * 0.7;
      const p = e.pos.clone().add(new THREE.Vector3(Math.sin(a) * 2.7, 0, Math.cos(a) * 2.7));
      slots.push({ pos: p, facing: a + PI + rand(-0.6, 0.6) });   // loiter facing the storefront / each other
    }
    G.clusterAnchors.push({ pos: e.pos.clone(), kind: 'store', capacity: 3, slots, peds: [] });
  }
}

export function spawnAnchoredPed(anchor, slot, slotIdx) {
  const ped = spawnPed(G.scene, slot.pos.clone());
  ped.anchor = { pos: anchor.pos, slot: slot.pos.clone(), facing: slot.facing };
  ped._slotIdx = slotIdx;
  ped.state = 'idle'; ped.speed = 0;
  ped.mesh.rotation.y = slot.facing;
  anchor.peds.push(ped);
  return ped;
}

export function updateClusters(dt) {
  if (!G.clusterAnchors) return;
  G._clusterT = (G._clusterT || 0) - dt;
  if (G._clusterT > 0) return;
  G._clusterT = 1.5;                                   // re-evaluate occupancy a couple times a second of sim
  const pp = G.player.group.position;
  const cf = crowdFactor(G.time.dayT);
  for (const a of G.clusterAnchors) {
    a.peds = a.peds.filter(p => !p.dead && p.anchor);  // drop any that died / got repurposed
    const near = dist2(a.pos, pp) < 135 * 135;
    const occ = a.kind === 'store' ? clamp(cf * 1.15, 0, 1) : cf;
    let want = near ? Math.round(a.capacity * occ) : 0;
    if (GAMEPLAY.rainPack && a.kind === 'food' && (G.time.rainStrength || 0) > 0.45) want = 0;
    while (a.peds.length < want && a.peds.length < a.slots.length) {
      const used = new Set(a.peds.map(p => p._slotIdx));
      let si = -1;
      for (let k = 0; k < a.slots.length; k++) if (!used.has(k)) { si = k; break; }
      if (si < 0) break;
      spawnAnchoredPed(a, a.slots[si], si);
    }
    while (a.peds.length > want) {
      const ped = a.peds.pop();
      G.scene.remove(ped.mesh); disposeObject(ped.mesh);
      const idx = G.peds.indexOf(ped); if (idx >= 0) G.peds.splice(idx, 1);
    }
  }
}

// Random "bag-snatcher" street event — a marked ped flees (reusing the panic AI);
// run them down for a bounty. Delivers on the intro's "beat up muggers".
// Body-armor pickups — restore armor on foot; respawn after a cooldown.
export function updateArmorPickups(dt) {
  const aps = G.world.armorPickups;
  if (!aps || !GAMEPLAY.armor) return;
  const now = performance.now();
  const pp = G.player.group.position;
  for (const a of aps) {
    if (now < a.readyAt) continue;            // on cooldown (hidden)
    if (!a.mesh.visible) a.mesh.visible = true;
    a.mesh.rotation.y += dt * 1.5;
    if (!G.player.inVehicle && G.player.armor < G.player.armorMax && dist2(a.pos, pp) < 3 * 3) {
      G.player.armor = Math.min(G.player.armorMax, G.player.armor + 50);
      a.readyAt = now + 45000;
      a.mesh.visible = false;
      G.hud.showNotif('Body armor +50');
      G.audio.chime();
    }
  }
}

// Street-food stalls — sit (E), pay, eat, heal. First sit still ticks the set.
export function updateFoodStalls(dt) {
  const fs = G.world.foodStalls;
  if (!fs) return;
  const eat = G._eating;
  if (eat) {
    eat.t -= dt;
    G.hud.showPrompt('Eating…', 0.4);
    if (eat.t > 0) return;
    const p = G.player;
    p.hp = Math.min(p.hpMax, p.hp + 30);
    p.stam = Math.min(p.stamMax, p.stam + p.stamMax * 0.45);
    const f = eat.stall;
    if (f && !f.visited) {
      f.visited = true;
      G.foodVisited = (G.foodVisited || 0) + 1;
      if (f.glowMat) { f.glowMat.emissiveIntensity = 0; f.glowMat.color.setHex(0x555555); }
      G.hud.showNotif(`Street food! +HP (${G.foodVisited}/${fs.length})`);
    } else {
      G.hud.showNotif('Street food — +HP, stamina');
    }
    if (f) f.readyAt = performance.now() + 8000;
    if (G.audio && G.audio.chime) G.audio.chime();
    G._eating = null;
    return;
  }
  if (!GAMEPLAY.stallSit || G.player.inVehicle) {
    if (G.player.inVehicle) return;
    const pp = G.player.group.position;
    for (const f of fs) {
      if (f.visited) continue;
      if (dist2(f.pos, pp) < 4 * 4) {
        f.visited = true;
        G.foodVisited = (G.foodVisited || 0) + 1;
        G.player.hp = Math.min(G.player.hpMax, G.player.hp + 25);
        f.glowMat.emissiveIntensity = 0; f.glowMat.color.setHex(0x555555);
        G.hud.showNotif(`Street food! +HP (${G.foodVisited}/${fs.length})`);
        G.audio.chime();
      }
    }
    return;
  }
  const pp = G.player.group.position;
  const now = performance.now();
  for (const f of fs) {
    if (dist2(f.pos, pp) > 2.4 * 2.4) continue;
    if (GAMEPLAY.rainPack && f.packed) {
      G.hud.showPrompt('Packed up — rain', 0.35);
      return;
    }
    if (f.readyAt && now < f.readyAt) {
      G.hud.showPrompt('Stall is busy', 0.35);
      return;
    }
    G.hud.showPrompt('Press <b>E</b> to sit and eat · ฿40', 0.4);
    if (G.input.pressed('KeyE')) {
      if (G.cash < 40) { G.hud.showNotif('Need ฿40 for a plate'); return; }
      G.cash -= 40; G.hud.setCash(G.cash);
      G._eating = { t: 2.2, stall: f };
      G.hud.showNotif('Sat down — eating');
    }
    return;
  }
}

export function updateShrines(dt) {
  const list = G.world && G.world.shrines;
  if (!list || !list.length) return;
  for (const s of list) {
    const smoke = s.mesh && s.mesh.getObjectByName('incense');
    if (smoke && smoke.material) {
      s.incenseT = Math.max(0.35, (s.incenseT || 0.4) - dt * 0.35);
      smoke.material.opacity = 0.12 + Math.min(0.55, s.incenseT * 0.06);
      smoke.scale.y = 1 + Math.min(1.4, s.incenseT * 0.12);
      smoke.position.y = 2.15 + Math.sin(performance.now() * 0.003 + (s.pos.x || 0)) * 0.04;
    }
  }
  if (!GAMEPLAY.spiritWai || G.player.inVehicle || G._eating) return;
  const pp = G.player.group.position;
  const now = performance.now();
  for (const s of list) {
    if (dist2(s.pos, pp) > 3.2 * 3.2) continue;
    G.hud.showPrompt('Press <b>E</b> to wai · ฿10 incense', 0.4);
    if (G.input.pressed('KeyE')) {
      if (s.readyAt && now < s.readyAt) { G.hud.showNotif('The incense is still burning'); return; }
      if (G.cash < 10) { G.hud.showNotif('Need ฿10 for incense'); return; }
      G.cash -= 10; G.hud.setCash(G.cash);
      s.readyAt = now + 16000;
      s.incenseT = 8;
      G.wanted.lastSeenAt = Math.max(0, (G.wanted.lastSeenAt || now) - 16000);
      if (GAMEPLAY.btsMalai && G._malai) {
        G.wanted.lastSeenAt = Math.max(0, G.wanted.lastSeenAt - 10000);
        G._malai = false;
        G._malaiOffered = (G._malaiOffered || 0) + 1;
        G.hud.showNotif('The spirit house accepts your malai');
      } else if (GAMEPLAY.watLotus && G._lotus) {
        G.wanted.lastSeenAt = Math.max(0, G.wanted.lastSeenAt - 10000);
        G._lotus = false;
        G._lotusOffered = (G._lotusOffered || 0) + 1;
        G.hud.showNotif('The spirit house accepts your lotus');
      } else if (GAMEPLAY.watAmulet && G._amulet) {
        G.wanted.lastSeenAt = Math.max(0, G.wanted.lastSeenAt - 10000);
        G._amulet = false;
        G._amuletOffered = (G._amuletOffered || 0) + 1;
        G.hud.showNotif('The spirit house accepts your amulet');
      } else {
        G.hud.showNotif('The spirit house accepts your wai');
      }
      G._waiCount = (G._waiCount || 0) + 1;
      if (G.audio && G.audio.bell) G.audio.bell();
    }
    return;
  }
}

export function updateMuggings(dt) {
  const m = G.mugging;
  if (m) {
    m.t += dt;
    if (m.ped.dead) {                                  // player took them down
      const reward = 400;
      G.cash += reward; G.hud.setCash(G.cash);
      G.hud.showNotif(`Stopped the snatcher! +฿${reward}`);
      G.audio.blip({ freq: 720, dur: 0.12, gain: 0.12 });
      G.mugging = null; G._mugTimer = 0;
      return;
    }
    if (m.t > 30) {                                    // got away — revert to a normal civilian
      m.ped.isMugger = false; m.ped.panicT = 0;
      if (m.marker) { if (m.marker.parent) m.marker.parent.remove(m.marker); disposeObject(m.marker); }
      G.hud.showNotif('The snatcher got away.');
      G.mugging = null; G._mugTimer = 0;
      return;
    }
    m.ped.panicT = 2;                                  // keep them fleeing
    return;
  }
  // maybe kick off a new one
  G._mugTimer = (G._mugTimer || 0) + dt;
  if (G._mugTimer < 40 || G.peds.length === 0 || Math.random() > 0.01) return;
  const pp = G.player.group.position;
  const ang = rand(0, TAU), r = rand(16, 26);
  const pos = new THREE.Vector3(
    clamp(pp.x + Math.cos(ang) * r, -HALF + 6, HALF - 6), 0,
    clamp(pp.z + Math.sin(ang) * r, -HALF + 6, HALF - 6));
  const ped = spawnPed(G.scene, pos);
  ped.isMugger = true; ped.panicT = 3;
  recolorTorso(ped.mesh.userData.parts, 0x2a2a2a, 0.8);
  const marker = new THREE.Mesh(new THREE.SphereGeometry(0.22, 8, 8),
    new THREE.MeshStandardMaterial({ color: 0xff7a2a, emissive: 0xff7a2a, emissiveIntensity: 0.8, roughness: 0.5 }));
  marker.position.set(0, 2.5, 0); ped.mesh.add(marker);
  G.mugging = { ped, t: 0, marker };
  G.hud.showNotif('Bag-snatcher! Run them down.');
}

// ---- Gang turf: a local encounter. Walk into a zone and its gang spawns; clear
// them to claim it (a bonus + passive income). Walk out mid-fight and the gang
// melts away (turfs don't trail you across the map). Held turf is periodically
// retaken by rivals. Gang refs + ownership live in module state so the count is
// authoritative regardless of crowd churn / save-load. ----
const TURF_INCOME = 6, TURF_BONUS = 2500;   // per held turf: baht/s, and the claim bonus
const turfGang = {};                        // tid -> spawned gang ped refs
const turfOwned = new Set();                // tid you hold (runtime truth; mirrored to G.turfs for the save)

function aliveTurfGang(tid) { let n = 0; for (const p of (turfGang[tid] || [])) if (!p.dead && G.peds.includes(p)) n++; return n; }
function clearTurfGang(tid) {
  for (const p of (turfGang[tid] || [])) {
    if (p.dead) continue;
    p.dead = true; G.scene.remove(p.mesh); disposeObject(p.mesh);
    const i = G.peds.indexOf(p); if (i >= 0) G.peds.splice(i, 1);
  }
  turfGang[tid] = [];
}
function spawnTurfGang(t, n) {
  const arr = [];
  for (let i = 0; i < n; i++) {
    const ang = (i / n) * TAU, r = t.radius * 0.3;
    const ped = spawnPed(G.scene, new THREE.Vector3(t.center.x + Math.cos(ang) * r, 0, t.center.z + Math.sin(ang) * r));
    if (!ped) continue;
    ped.gang = true; ped.turfId = t.id; ped.hp = 40; ped.speed = 2.6; ped._notedAggression = true;   // hostile → not civilian heat
    recolorTorso(ped.mesh.userData.parts, 0x24222c, 0.8);
    arr.push(ped);
  }
  turfGang[t.id] = arr;
}

export function updateTurf(dt) {
  const pp = G.player.group.position;
  const st = G.turfs || (G.turfs = {});
  let owned = 0;
  for (const t of TURFS) {
    const s = st[t.id] || (st[t.id] = { owned: false });
    if (s.owned) turfOwned.add(t.id);          // adopt ownership loaded from a save
    s.owned = turfOwned.has(t.id);             // ...then keep G.turfs mirrored to the runtime truth
    if (!turfOwned.has(t.id) && (turfGang[t.id] || []).length) {
      if (aliveTurfGang(t.id) === 0) {                                 // gang wiped → claim
        turfOwned.add(t.id); s.owned = true; turfGang[t.id] = [];
        G.cash += TURF_BONUS; G.hud.setCash(G.cash); G.hud.cashPop(TURF_BONUS); G.hud.flashScreen('#ffcf4a');
        G.hud.showNotif(`Took over ${t.name}! +฿${TURF_BONUS.toLocaleString()} + passive income.`);
        if (G.audio && G.audio.chime) G.audio.chime();
        saveGame();
      } else if (dist2(pp, t.center) > t.radius * t.radius) {          // walked out mid-fight → gang melts away
        clearTurfGang(t.id);
      }
    }
    if (turfOwned.has(t.id)) owned++;
  }
  if (owned > 0) { G.cash += TURF_INCOME * owned * dt; G.hud.setCash(G.cash); }   // passive income from held turf
  // rival takeover: every ~100 s a held turf may flip back, forcing you to retake it
  G._turfRetal = (G._turfRetal == null ? 100 : G._turfRetal - dt);
  if (G._turfRetal <= 0) {
    G._turfRetal = 100;
    const held = [...turfOwned];
    if (held.length && Math.random() < 0.6) {
      const id = pick(held); turfOwned.delete(id); if (st[id]) st[id].owned = false;
      const t = TURFS.find(x => x.id === id);
      G.hud.showNotif(`Rival gang seized ${t ? t.name : 'a turf'} — take it back.`);
    }
  }
  // the turf the player is standing in: spawn a gang on entry, else prompt
  for (const t of TURFS) {
    if (dist2(pp, t.center) > t.radius * t.radius) continue;
    if (turfOwned.has(t.id)) { G.hud.showPrompt(`${t.name} — your turf`, 0.4); break; }
    if (!(turfGang[t.id] || []).length) {
      spawnTurfGang(t, 4);
      G.hud.showNotif(`${t.name}: gang territory — clear them out to take it.`);
    }
    G.hud.showPrompt(`${t.name} turf — defeat the gang (${aliveTurfGang(t.id)} left)`, 0.4);
    break;
  }
}

// Spike strips at 3★ — deployed ahead of a fleeing driver; running one over blows
// your tires (halved top speed until a respray).
export function spawnSpikeStrip(pos, dirAngle) {
  const strip = new THREE.Group();
  const base = new THREE.Mesh(new THREE.BoxGeometry(8, 0.1, 0.6), new THREE.MeshStandardMaterial({ color: 0x222222, roughness: 0.9 }));
  base.position.y = 0.06; strip.add(base);
  const spikeMat = new THREE.MeshStandardMaterial({ color: 0x999999, metalness: 0.6, roughness: 0.4 });
  for (let i = -3; i <= 3; i++) {
    const sp = new THREE.Mesh(new THREE.ConeGeometry(0.08, 0.3, 4), spikeMat);
    sp.position.set(i * 1.1, 0.2, 0); strip.add(sp);
  }
  strip.position.set(pos.x, 0, pos.z);
  strip.rotation.y = dirAngle;   // lie across the road
  G.scene.add(strip);
  (G.spikes || (G.spikes = [])).push({ group: strip, pos: new THREE.Vector3(pos.x, 0, pos.z), life: 22 });
}

export function updateSpikes(dt) {
  const p = G.player;
  if (!G.spikes) G.spikes = [];
  // deploy ahead of the player's vehicle at 3★, on a cadence
  G._spikeTimer = (G._spikeTimer || 0) + dt;
  if (G.wanted.stars >= 3 && p.inVehicle && G._spikeTimer > 12) {
    G._spikeTimer = 0;
    const v = p.inVehicle, ahead = 45;
    const sx = clamp(v.pos.x + Math.sin(v.heading) * ahead, -HALF + 8, HALF - 8);
    const sz = clamp(v.pos.z + Math.cos(v.heading) * ahead, -HALF + 8, HALF - 8);
    spawnSpikeStrip(new THREE.Vector3(sx, 0, sz), v.heading);
    G.hud.showNotif('Spike strip ahead!');
  }
  for (let i = G.spikes.length - 1; i >= 0; i--) {
    const s = G.spikes[i];
    s.life -= dt;
    let remove = s.life <= 0;
    if (!remove && p.inVehicle && !p.inVehicle.tiresBlown &&
        dist2(p.inVehicle.pos, s.pos) < 3.5 * 3.5 && Math.abs(p.inVehicle.vel) > 5) {
      p.inVehicle.tiresBlown = true;
      G.hud.showNotif('Tires blown!');
      G.audio.blip({ freq: 140, dur: 0.18, type: 'sawtooth', gain: 0.12 });
      remove = true;
    }
    if (remove) { G.scene.remove(s.group); disposeObject(s.group); G.spikes.splice(i, 1); }
  }
}

// Vigilante side job — drive a cop unit, press V, bust fleeing crooks for escalating cash.
export function vigilanteSpawnTarget(vg) {
  const pp = G.player.group.position;
  const ang = rand(0, TAU), r = rand(20, 35);
  const pos = new THREE.Vector3(
    clamp(pp.x + Math.cos(ang) * r, -HALF + 6, HALF - 6), 0,
    clamp(pp.z + Math.sin(ang) * r, -HALF + 6, HALF - 6));
  const ped = spawnPed(G.scene, pos);
  ped.isTarget = true; ped.panicT = 3;   // reuse isTarget so night-thinning skips it
  recolorTorso(ped.mesh.userData.parts, 0x6a1a1a, 0.8);
  const mk = new THREE.Mesh(new THREE.SphereGeometry(0.22, 8, 8),
    new THREE.MeshStandardMaterial({ color: 0xff2a2a, emissive: 0xff2a2a, emissiveIntensity: 0.8, roughness: 0.5 }));
  mk.position.set(0, 2.5, 0); ped.mesh.add(mk);
  vg.target = ped; vg.marker = mk;
  vg.markerPos = ped.mesh.position;
}
export function vigilanteEnd(msg) {
  const vg = G.vigilante;
  if (!vg) return;
  if (vg.target && !vg.target.dead) {     // release the current crook
    vg.target.isTarget = false; vg.target.panicT = 0;
    if (vg.marker && vg.marker.parent) { vg.marker.parent.remove(vg.marker); disposeObject(vg.marker); }
  }
  vg.markerPos = null;
  G.hud.showNotif('Vigilante over — ' + msg);
  G.vigilante = null;
}
export function updateVigilante(dt) {
  const p = G.player;
  const inCop = p.inVehicle && p.inVehicle.isCop;
  const vg = G.vigilante;
  if (vg && vg.active) {
    if (!inCop) { vigilanteEnd('left the unit'); return; }
    vg.timeLeft -= dt;
    if (vg.timeLeft <= 0) { vigilanteEnd(`time up · ${vg.busts} busts`); return; }
    const targetPos = vg.target && !vg.target.dead ? vg.target.mesh.position : null;
    const pp = p.inVehicle ? p.inVehicle.pos : p.group.position;
    const dist = targetPos ? Math.round(Math.hypot(targetPos.x - pp.x, targetPos.z - pp.z)) : null;
    G.hud.showPrompt(`VIGILANTE &nbsp; TARGET ${dist == null ? '--' : dist + 'm'} &nbsp;·&nbsp; ⏱ ${vg.timeLeft.toFixed(0)}s &nbsp;·&nbsp; busts ${vg.busts}`, 0.4);
    if (vg.target.dead) {
      vg.busts++;
      const r = 200 + vg.busts * 100;
      G.cash += r; G.hud.setCash(G.cash);
      G.hud.showNotif(`Busted! +฿${r}`);
      G.audio.blip({ freq: 760, dur: 0.1, gain: 0.12 });
      vg.timeLeft = Math.min(60, vg.timeLeft + 15);
      vigilanteSpawnTarget(vg);
    } else {
      vg.target.panicT = 2;   // keep them fleeing
      vg.markerPos = vg.target.mesh.position;
    }
    return;
  }
  if (inCop) {
    G.hud.showPrompt('Press <b>V</b> for Vigilante', 0.4);
    if (G.input.pressed('KeyV')) {
      G.vigilante = { active: true, busts: 0, timeLeft: 45, target: null, marker: null };
      vigilanteSpawnTarget(G.vigilante);
      G.hud.showNotif('Vigilante: run down the fleeing crooks!');
    }
  }
}

export function updateAlms(dt) {
  if (!GAMEPLAY.dawnAlms) return;
  const h = ((G.time.dayT % 1) + 1) % 1 * 24;
  const sois = (G.world && G.world.sois) || [];
  const temple = G.world && G.world.poi && G.world.poi.temple;
  if (h >= 5 && h < 7) {
    G._alms = G._alms || [];
    // soi[2] sits on the wat's north–south column (i=2); tak bat walks the alley, not the wat lawn.
    const s = sois[2] || sois[0] || null;
    const alongZ = !!(s && s.axis === 'z');
    while (G._alms.length < 3) {
      const i = G._alms.length;
      const t = 0.18 + i * 0.16;
      let pos;
      if (s) {
        pos = new THREE.Vector3(
          alongZ ? (s.x0 + s.x1) * 0.5 : s.x0 + (s.x1 - s.x0) * t,
          0,
          alongZ ? s.z0 + (s.z1 - s.z0) * t : (s.z0 + s.z1) * 0.5,
        );
      } else if (temple) {
        pos = new THREE.Vector3(temple.x + rand(-12, 12), 0, temple.z + rand(-12, 12));
      } else return;
      const ped = spawnPed(G.scene, pos, 'monk');
      ped.kind = 'monk';
      if (ped.mesh) ped.mesh.userData.kind = 'monk';
      ped.anchor = null;
      ped.state = 'walking';
      ped.alms = true;
      ped._almsT = t;
      ped._almsDir = 1;
      ped._almsSoi = s;
      ped._almsGiven = false;
      ped.heading = alongZ ? 0 : PI / 2;
      ped.speed = 0.85;
      G._alms.push(ped);
    }
    const pp = G.player && G.player.group && G.player.group.position;
    const onFoot = !!(pp && !G.player.inVehicle && !G._eating);
    for (const ped of G._alms) {
      if (!ped || ped.dead || !ped.mesh) continue;
      ped.alms = true;
      const soi = ped._almsSoi || s;
      const near = onFoot && dist2(ped.mesh.position, pp) < 2.2 * 2.2;
      if (soi) {
        const az = soi.axis === 'z';
        if (!near) {
          ped._almsT += (ped._almsDir || 1) * dt * 0.028;
          if (ped._almsT > 0.88) { ped._almsT = 0.88; ped._almsDir = -1; }
          if (ped._almsT < 0.12) { ped._almsT = 0.12; ped._almsDir = 1; }
        }
        const t = ped._almsT;
        const x = az ? (soi.x0 + soi.x1) * 0.5 : soi.x0 + (soi.x1 - soi.x0) * t;
        const z = az ? soi.z0 + (soi.z1 - soi.z0) * t : (soi.z0 + soi.z1) * 0.5;
        ped.mesh.position.set(x, 0, z);
        ped.heading = az ? ((ped._almsDir || 1) > 0 ? 0 : PI) : ((ped._almsDir || 1) > 0 ? PI / 2 : -PI / 2);
        ped.mesh.rotation.y = ped.heading;
        ped.speed = near ? 0 : 0.85;
        ped.state = near ? 'idle' : 'walking';
      } else if (temple) {
        const dx = temple.x - ped.mesh.position.x, dz = temple.z - ped.mesh.position.z;
        if (Math.hypot(dx, dz) > 6) { ped.heading = Math.atan2(dx, dz); ped.speed = near ? 0 : 0.85; }
        else ped.speed = near ? 0 : 0.4;
        ped.mesh.rotation.y = ped.heading;
      }
    }
    if (!onFoot) return;
    for (const ped of G._alms) {
      if (!ped || ped.dead || !ped.mesh) continue;
      if (dist2(ped.mesh.position, pp) > 2.2 * 2.2) continue;
      if (ped._almsGiven) {
        G.hud.showPrompt('The monk has already received', 0.35);
        return;
      }
      G.hud.showPrompt('Press <b>E</b> to offer alms · ฿20', 0.4);
      if (G.input.pressed('KeyE')) {
        if (G.cash < 20) { G.hud.showNotif('Need ฿20 for alms'); return; }
        G.cash -= 20;
        if (G.hud.setCash) G.hud.setCash(G.cash);
        ped._almsGiven = true;
        G.wanted.lastSeenAt = Math.max(0, (G.wanted.lastSeenAt || performance.now()) - 14000);
        G._almsOffered = (G._almsOffered || 0) + 1;
        G.hud.showNotif('Alms offered — ทำบุญ');
        if (G.audio && G.audio.bell) G.audio.bell();
        else if (G.audio && G.audio.chime) G.audio.chime();
      }
      return;
    }
  } else if (G._alms && G._alms.length) {
    for (const ped of G._alms) {
      if (!ped || ped.dead) continue;
      ped.alms = false;
    }
    G._alms = [];
  }
}

export function updateSchoolKids(dt) {
  if (!GAMEPLAY.schoolKids) return;
  const h = ((G.time.dayT % 1) + 1) % 1 * 24;
  const bts = G.world && G.world.bts;
  const dest = { x: bts ? bts.x : -50, z: (bts && bts.z) || 0 };
  const morning = h >= 6.2 && h < 8.7;
  const homeward = h >= 15 && h < 16.5;
  if (morning || homeward) {
    G._schoolKids = G._schoolKids || [];
    while (G._schoolKids.length < 5) {
      const ang = rand(0, TAU), r = homeward ? rand(4, 14) : rand(22, 70);
      const pos = new THREE.Vector3(
        clamp(dest.x + Math.cos(ang) * r, -HALF + 8, HALF - 8), 0,
        clamp(dest.z + Math.sin(ang) * r, -HALF + 8, HALF - 8));
      const ped = spawnPed(G.scene, pos, 'school');
      ped.school = true;
      ped.anchor = null;
      ped.state = 'walking';
      ped.heading = homeward
        ? Math.atan2(pos.x - dest.x, pos.z - dest.z)
        : Math.atan2(dest.x - pos.x, dest.z - pos.z);
      G._schoolKids.push(ped);
    }
    for (const ped of G._schoolKids) {
      if (!ped || ped.dead) continue;
      const dx = dest.x - ped.mesh.position.x, dz = dest.z - ped.mesh.position.z;
      const d = Math.hypot(dx, dz);
      if (homeward) {
        ped.heading = Math.atan2(-dx, -dz);
        ped.speed = 1.35;
        ped.state = 'walking';
      } else if (d > 8) { ped.heading = Math.atan2(dx, dz); ped.speed = 1.35; ped.state = 'walking'; }
      else { ped.speed = 0.15; ped.state = 'idle'; }
    }
  } else if (G._schoolKids && G._schoolKids.length) {
    for (const ped of G._schoolKids) {
      if (!ped || ped.dead) continue;
      ped.school = false;
    }
    G._schoolKids = [];
  }
}

function btsStopList() {
  return (G.bts && G.bts.stops) || (G.world && G.world.bts && G.world.bts.stops) || [
    { x: -50, y: 13.9, name: 'Asok' },
    { x: 100, y: 13.9, name: 'Phrom Phong' },
  ];
}
function btsWaiterKind() {
  const h = ((G.time.dayT % 1) + 1) % 1 * 24;
  if (h >= 6.2 && h < 8.7) return Math.random() < 0.45 ? 'school' : 'office';
  if (h >= 17 && h < 19.5) return Math.random() < 0.7 ? 'office' : 'local';
  if (h >= 22 || h < 5) return pick(['local', 'tourist', 'vendor']);
  return pick(['local', 'office', 'tourist', 'vendor']);
}
function spawnBtsWaiter(stop) {
  const y = stop.y || 13.9;
  const side = Math.random() < 0.5 ? -1 : 1;
  const slot = {
    x: stop.x + rand(-6.5, 6.5),
    z: side * rand(2.7, 3.9),
    y,
    facing: side > 0 ? PI : 0,
  };
  const ped = spawnPed(G.scene, new THREE.Vector3(slot.x, y, slot.z), btsWaiterKind());
  ped.btsWait = true;
  ped.btsStop = stop.name;
  ped.btsSlot = slot;
  ped.btsY = y;
  ped.btsBoarded = false;
  ped.btsApproach = false;
  ped.anchor = null;
  ped.speed = 0;
  ped.state = 'idle';
  ped.heading = slot.facing;
  ped.mesh.rotation.y = slot.facing;
  ped.mesh.position.y = y;
  return ped;
}

function dressCrossingGuard(ped, slot) {
  recolorTorso(ped.mesh.userData.parts, 0xffd23a, 0.7);
  const vest = new THREE.Mesh(
    new THREE.BoxGeometry(0.42, 0.38, 0.28),
    new THREE.MeshStandardMaterial({ color: 0xffcf4a, roughness: 0.65, emissive: 0xffb020, emissiveIntensity: 0.16 })
  );
  vest.name = 'guard-vest';
  vest.position.set(0, 1.18, 0.04);
  ped.mesh.add(vest);
  const paddle = new THREE.Group();
  paddle.name = 'stop-paddle';
  const stick = new THREE.Mesh(
    new THREE.CylinderGeometry(0.018, 0.018, 0.55, 5),
    new THREE.MeshStandardMaterial({ color: 0x222222, roughness: 0.6 })
  );
  stick.position.y = 0.2;
  paddle.add(stick);
  const disc = new THREE.Mesh(
    new THREE.BoxGeometry(0.28, 0.28, 0.03),
    new THREE.MeshStandardMaterial({ color: 0xc03030, roughness: 0.5 })
  );
  disc.position.y = 0.5;
  paddle.add(disc);
  const parts = ped.mesh.userData.parts;
  if (parts && parts.foreR) {
    paddle.position.set(0.02, -0.28, 0.08);
    parts.foreR.add(paddle);
  } else {
    paddle.position.set(0.22, 1.05, 0.12);
    ped.mesh.add(paddle);
  }
  ped.crossingGuard = true;
  ped.stop = slot.stop;
  ped.anchor = { slot: new THREE.Vector3(slot.x, 0, slot.z), facing: slot.facing };
  ped.speed = 0;
  ped.state = 'idle';
  ped.heading = slot.facing;
  ped.mesh.rotation.y = slot.facing;
}

export function updateCrossingGuards(dt) {
  if (!GAMEPLAY.crossingGuard) return;
  const h = ((G.time.dayT % 1) + 1) % 1 * 24;
  const bts = G.world && G.world.bts;
  const cx = bts ? bts.x : -50;
  const cz = (bts && bts.z) || 0;
  const kerb = ROAD_WIDTH / 2 + 1.35;
  if ((h >= 6.2 && h < 8.7) || (h >= 15 && h < 16.5)) {
    G._crossingGuards = G._crossingGuards || [];
    const slots = [
      { x: cx + kerb, z: cz - kerb, facing: PI / 2, stop: 'asok' },
      { x: cx - kerb, z: cz + kerb, facing: -PI / 2, stop: 'asok' },
      { x: 100 + kerb, z: cz - kerb, facing: PI / 2, stop: 'phrom' },
      { x: 100 - kerb, z: cz + kerb, facing: -PI / 2, stop: 'phrom' },
    ];
    while (G._crossingGuards.length < slots.length) {
      const slot = slots[G._crossingGuards.length];
      const ped = spawnPed(G.scene, new THREE.Vector3(slot.x, 0, slot.z), 'laborer');
      dressCrossingGuard(ped, slot);
      G._crossingGuards.push(ped);
    }
  } else if (G._crossingGuards && G._crossingGuards.length) {
    for (const ped of G._crossingGuards) {
      if (!ped || ped.dead) continue;
      ped.crossingGuard = false;
      ped.anchor = null;
    }
    G._crossingGuards = [];
  }
}

export function updateSoiChairs(dt) {
  if (!GAMEPLAY.soiChairs || !G.soiChairs) return;
  const h = ((G.time.dayT % 1) + 1) % 1 * 24;
  const night = h >= 18.5 || h < 1.2;
  const seats = G.soiChairs.seats || [];
  if (night) {
    G._soiDrinkers = G._soiDrinkers || [];
    while (G._soiDrinkers.length < seats.length) {
      const slot = seats[G._soiDrinkers.length];
      const ped = spawnPed(G.scene, new THREE.Vector3(slot.x, 0, slot.z), Math.random() < 0.5 ? 'local' : 'laborer');
      ped.soiDrink = true;
      ped.anchor = { slot: new THREE.Vector3(slot.x, 0.42, slot.z), facing: slot.facing };
      ped.speed = 0;
      ped.state = 'idle';
      ped.heading = slot.facing;
      ped.mesh.position.set(slot.x, 0.42, slot.z);
      ped.mesh.rotation.y = slot.facing;
      G._soiDrinkers.push(ped);
    }
  } else if (G._soiDrinkers && G._soiDrinkers.length) {
    for (const ped of G._soiDrinkers) {
      if (!ped || ped.dead) continue;
      ped.soiDrink = false;
      ped.anchor = null;
    }
    G._soiDrinkers = [];
  }
}

export function updateSoiCowboy(dt) {
  if (!GAMEPLAY.soiCowboy || !G.soiCowboy) return;
  const h = ((G.time.dayT % 1) + 1) % 1 * 24;
  const night = h >= 20 || h < 4;
  G._cowboyTouts = (G._cowboyTouts || []).filter(p => p && !p.dead);
  const signs = G.soiCowboy.signs || [];
  if (night) {
    while (G._cowboyTouts.length < 3) {
      const s = signs[G._cowboyTouts.length] || signs[0];
      const ox = (s && s.x != null) ? s.x : (G.soiCowboy.origin && G.soiCowboy.origin.x) || 44;
      const oz = (s && s.z != null) ? s.z : (G.soiCowboy.origin && G.soiCowboy.origin.z) || 90;
      const pos = new THREE.Vector3(ox + 1.35, 0, oz);
      const ped = spawnPed(G.scene, pos, 'tourist');
      ped.cowboy = true;
      ped.anchor = { slot: pos.clone(), facing: PI / 2 };
      ped.speed = 0;
      ped.state = 'idle';
      ped.heading = PI / 2;
      if (ped.mesh) ped.mesh.rotation.y = ped.heading;
      G._cowboyTouts.push(ped);
    }
    for (const ped of G._cowboyTouts) {
      if (!ped || !ped.mesh) continue;
      ped.cowboy = true;
      const slot = ped.anchor && ped.anchor.slot;
      if (slot) {
        ped.mesh.position.set(slot.x, 0, slot.z);
        ped.heading = ped.anchor.facing;
        ped.mesh.rotation.y = ped.heading;
        ped.speed = 0;
        ped.state = 'idle';
      }
    }
  } else if (G._cowboyTouts.length) {
    for (const ped of G._cowboyTouts) {
      if (!ped || ped.dead) continue;
      ped.cowboy = false;
      ped.anchor = null;
    }
    G._cowboyTouts = [];
  }
}

export function updateCowboyClose(dt) {
  if (!GAMEPLAY.cowboyClose || !G.soiCowboy) return;
  const h = ((G.time.dayT % 1) + 1) % 1 * 24;
  const closing = h >= 4 && h < 5.6;
  const origin = G.soiCowboy.origin || { x: 44, z: 90 };
  const bts = G.world && G.world.bts;
  const dest = { x: bts ? bts.x : -50, z: (bts && bts.z) || 0 };
  if (closing) {
    G._cowboyClose = (G._cowboyClose || []).filter(p => p && !p.dead);
    while (G._cowboyClose.length < 3) {
      const i = G._cowboyClose.length;
      const pos = new THREE.Vector3(origin.x + (i - 1) * 1.15, 0, origin.z + 1.4);
      const ped = spawnPed(G.scene, pos, 'tourist');
      ped.cowboyClose = true;
      ped.anchor = null;
      ped.state = 'walking';
      ped.speed = 0.75;
      ped.heading = Math.atan2(dest.x - pos.x, dest.z - pos.z);
      if (ped.mesh) ped.mesh.rotation.y = ped.heading;
      G._cowboyClose.push(ped);
    }
    for (const ped of G._cowboyClose) {
      if (!ped || !ped.mesh) continue;
      ped.cowboyClose = true;
      const dx = dest.x - ped.mesh.position.x, dz = dest.z - ped.mesh.position.z;
      const d = Math.hypot(dx, dz);
      if (d > 8) {
        ped.heading = Math.atan2(dx, dz);
        ped.speed = 0.75;
        ped.state = 'walking';
      } else {
        ped.speed = 0.12;
        ped.state = 'idle';
      }
    }
  } else if (G._cowboyClose && G._cowboyClose.length) {
    for (const ped of G._cowboyClose) {
      if (!ped || ped.dead) continue;
      ped.cowboyClose = false;
    }
    G._cowboyClose = [];
  }
}

export function updateSoiBarber(dt) {
  if (!GAMEPLAY.soiBarber || !G.soiBarber) return;
  const shop = G.soiBarber;
  const ped = shop.ped;
  if (ped && ped.mesh && ped.anchor && ped.anchor.slot) {
    ped.soiBarber = true;
    ped.mesh.position.set(ped.anchor.slot.x, 0, ped.anchor.slot.z);
    ped.heading = ped.anchor.facing;
    ped.mesh.rotation.y = ped.heading;
    ped.speed = 0;
    ped.state = 'idle';
  }
  shop.t = (shop.t || 0) + dt;
  if (shop.pole) shop.pole.rotation.y += dt * 2.4;
  if (shop.clip) shop.clip.rotation.z += dt * (G._barberCut ? 28 : 6);
  if (G._barberCut) {
    G._barberCut.t -= dt;
    if (G.player && G.player.group) {
      G.player.group.position.set(shop.x, 0.42, shop.z);
      if (G.player.velocity) G.player.velocity.set(0, 0, 0);
      if (shop.facing != null) G.player.group.rotation.y = shop.facing;
    }
    if (shop.cape) shop.cape.position.y = 0.92;
    if (G._barberCut.t <= 0) {
      G._barberCut = null;
      G._haircut = true;
      if (G.player && G.player.hair) G.player.hair.scale.set(0.88, 0.28, 0.78);
      const now = (typeof performance !== 'undefined' && performance.now) ? performance.now() : 0;
      G.wanted.lastSeenAt = Math.max(0, (G.wanted.lastSeenAt || now) - 18000);
      if (shop.cape) shop.cape.position.y = 0.46;
      if (G.hud && G.hud.showNotif) G.hud.showNotif('Fresh fade — ตัดผม');
    }
    return;
  }
  if (shop.cape && shop.cape.position.y > 0.5) shop.cape.position.y = 0.46;
  if (G.player.inVehicle || G._eating) return;
  const pp = G.player.group.position;
  if (dist2({ x: shop.x, z: shop.z }, pp) > 2.6 * 2.6) return;
  G.hud.showPrompt(G._haircut ? 'Press <b>E</b> for a tidy-up · ฿80' : 'Press <b>E</b> for a haircut · ฿80', 0.4);
  if (!G.input.pressed('KeyE')) return;
  if (G.cash < 80) { G.hud.showNotif('Need ฿80 for a cut'); return; }
  G.cash -= 80;
  if (G.hud.setCash) G.hud.setCash(G.cash);
  G._barberCut = { t: 1.6 };
  G.hud.showNotif('Sit down — clippers on');
  if (G.audio && G.audio.blip) G.audio.blip({ freq: 180, dur: 0.08, type: 'square', gain: 0.08 });
}

export function updateSoiCctv(dt) {
  if (!GAMEPLAY.soiCctv || !G.soiCctv) return;
  const night = (G.nightK || 0) > 0.45;
  const pp = G.player && G.player.group ? G.player.group.position : null;
  const shooting = !!(G.bullets && G.bullets.length);
  for (const cam of G.soiCctv) {
    if (cam.led && cam.led.material) {
      cam.led.material.emissiveIntensity = night ? 0.95 : 0.12;
    }
    if (!pp || !shooting || G.player.inVehicle) continue;
    if (dist2({ x: cam.x, z: cam.z }, pp) > 22 * 22) continue;
    G.wanted.lastSeenAt = (typeof performance !== 'undefined' && performance.now) ? performance.now() : 0;
    G._cctvPing = (G._cctvPing || 0) + 1;
    if (!cam._flagged) {
      cam._flagged = true;
      raiseWanted(1, 2);
      if (G.hud) G.hud.showNotif('CCTV — กล้องวงจรปิด');
    }
  }
  if (!shooting) {
    for (const cam of G.soiCctv) cam._flagged = false;
  }
}

export function updateRainFrogs(dt) {
  if (!GAMEPLAY.rainFrogs || !G.rainFrogs) return;
  const rain = (G.time && G.time.rainStrength) || 0;
  const wet = rain > 0.35;
  for (const f of G.rainFrogs) {
    if (!f.mesh) continue;
    f.mesh.visible = wet;
    if (!wet) {
      f.mesh.position.y = 0;
      continue;
    }
    f.t = (f.t || 0) + dt;
    const bounce = Math.sin(f.t * (f.hop || 8));
    const air = Math.max(0, bounce);
    f.mesh.position.y = air * 0.22;
    if (air > 0.08) {
      f.x += Math.sin(f.heading) * 0.55 * dt;
      f.z += Math.cos(f.heading) * 0.55 * dt;
    } else if (bounce < -0.6) {
      f.heading += dt * 1.6;
    }
    const p = f.patch;
    if (p) {
      f.x = clamp(f.x, p.x0 + 0.4, p.x1 - 0.4);
      f.z = clamp(f.z, p.z0 + 0.4, p.z1 - 0.4);
    }
    f.mesh.position.x = f.x;
    f.mesh.position.z = f.z;
    f.mesh.rotation.y = f.heading;
  }
}

export function updateSoiWires(dt) {
  if (!GAMEPLAY.soiWires || !G.soiWires) return;
  const st = G.soiWires;
  st.t = (st.t || 0) + dt;
  const rain = (G.time && G.time.rainStrength) || 0;
  const wet = rain > 0.45;
  for (const spark of st.sparks || []) {
    if (!spark || !spark.material) continue;
    spark.material.emissiveIntensity = wet ? 0.35 + 0.85 * Math.max(0, Math.sin(st.t * 22)) : 0;
    spark.visible = wet ? spark.material.emissiveIntensity > 0.2 : false;
  }
}

export function updateBtsGates(dt) {
  if (!GAMEPLAY.btsGates) return;
  const stations = [G.btsGates, G.phromGates];
  const riding = !!(G._btsRide || (G.player && G.player.inVehicle));
  const pp = G.player && G.player.group && G.player.group.position;
  for (const st of stations) {
    if (!st) continue;
    if (riding || !pp) {
      if (st.openT > 0) st.openT = Math.max(0, st.openT - dt);
      continue;
    }
    const prev = st._pz;
    st._pz = pp.z;
    const onPlat = pp.y > 12 && Math.abs(pp.x - st.sx) < 7;
    if (onPlat && prev != null && prev < st.zGate && pp.z >= st.zGate) {
      if (G._btsTicket) {
        st.openT = 1.4;
        G._btsTapped = (G._btsTapped || 0) + 1;
        if (G.audio && G.audio.btsChime) G.audio.btsChime();
        else if (G.hud) G.hud.showNotif('Tap in — แรบบิท');
      } else {
        st.openT = 0.35;
        G._btsHopped = (G._btsHopped || 0) + 1;
        raiseWanted(1, 2);
        if (G.hud) G.hud.showNotif('Jumped the gate');
      }
    }
    const open = st.openT > 0;
    for (const g of st.gates || []) {
      if (g.flap) g.flap.rotation.y = open ? 1.15 : 0;
    }
    if (st.openT > 0) st.openT = Math.max(0, st.openT - dt);
    if (G._eating || G._barberCut) continue;
    if (st.machine && dist2(st.machine.position, pp) < 2.4 * 2.4) {
      G.hud.showPrompt(G._btsTicket ? 'Rabbit card ready' : 'Press <b>E</b> for a Rabbit card · ฿50', 0.4);
      if (G._btsTicket || !G.input.pressed('KeyE')) continue;
      if (G.cash < 50) { G.hud.showNotif('Need ฿50 for a Rabbit'); continue; }
      G.cash -= 50;
      if (G.hud.setCash) G.hud.setCash(G.cash);
      G._btsTicket = true;
      G.hud.showNotif('Rabbit card — แรบบิท');
      if (G.audio && G.audio.chime) G.audio.chime();
    }
  }
}

export function updateSoiMechanic(dt) {
  if (!GAMEPLAY.soiMechanic || !G.soiMechanic) return;
  const shop = G.soiMechanic;
  const ped = shop.ped;
  if (ped && ped.mesh && ped.anchor && ped.anchor.slot) {
    ped.soiMechanic = true;
    ped.mesh.position.set(ped.anchor.slot.x, 0, ped.anchor.slot.z);
    ped.heading = ped.anchor.facing;
    ped.mesh.rotation.y = ped.heading;
    ped.speed = 0;
    ped.state = 'idle';
  }
  const v = G.player && G.player.inVehicle;
  if (!v || v.dead) return;
  if (dist2(v.pos, shop) > 4.8 * 4.8) return;
  if (v.hp >= 100 && !v.tiresBlown) {
    G.hud.showPrompt('Soi mechanic — ride looks fine', 0.35);
    return;
  }
  G.hud.showPrompt('Press <b>E</b> to patch the ride · ฿80', 0.4);
  if (!G.input.pressed('KeyE')) return;
  if (G.cash < 80) { G.hud.showNotif('Need ฿80 for a patch'); return; }
  G.cash -= 80;
  v.hp = 100;
  v.tiresBlown = false;
  if (v.smoke) { v.smoke.life = 0; v.smoke = null; }
  if (G.hud.setCash) G.hud.setCash(G.cash);
  G.hud.showNotif('Patched — ซ่อมแล้ว');
  if (G.audio && G.audio.chime) G.audio.chime();
}

export function updateSevenGuard(dt) {
  if (!GAMEPLAY.sevenGuard) return;
  const h = ((G.time.dayT % 1) + 1) % 1 * 24;
  const night = h >= 19 || h < 6;
  for (const g of [G.sevenGuard, G.southSevenGuard, G.westSevenGuard, G.eastSevenGuard]) {
    if (!g) continue;
    if (g.light) g.light.intensity = night ? 1.1 : 0;
    if (g.beam) g.beam.visible = night;
    const ped = g.ped;
    if (ped && ped.mesh) {
      ped.sevenGuard = true;
      ped.mesh.visible = true;
      if (ped.anchor && ped.anchor.slot) {
        ped.mesh.position.set(ped.anchor.slot.x, ped.anchor.slot.y || 0.42, ped.anchor.slot.z);
        ped.heading = ped.anchor.facing;
        ped.mesh.rotation.y = ped.heading;
        ped.speed = 0;
      }
    }
  }
}

export function updateMallGuard(dt) {
  if (!GAMEPLAY.mallGuard || !G.mallGuard) return;
  const h = ((G.time.dayT % 1) + 1) % 1 * 24;
  const night = h >= 19 || h < 6;
  const g = G.mallGuard;
  if (g.light) g.light.intensity = night ? 1.1 : 0;
  if (g.beam) g.beam.visible = night;
  const ped = g.ped;
  if (ped && ped.mesh) {
    ped.mallGuard = true;
    ped.mesh.visible = true;
    if (ped.anchor && ped.anchor.slot) {
      ped.mesh.position.set(ped.anchor.slot.x, ped.anchor.slot.y || 0.42, ped.anchor.slot.z);
      ped.heading = ped.anchor.facing;
      ped.mesh.rotation.y = ped.heading;
      ped.speed = 0;
    }
  }
}

export function updateBankGuard(dt) {
  if (!GAMEPLAY.bankGuard || !G.bankGuard) return;
  const h = ((G.time.dayT % 1) + 1) % 1 * 24;
  const night = h >= 19 || h < 6;
  const g = G.bankGuard;
  if (g.light) g.light.intensity = night ? 1.1 : 0;
  if (g.beam) g.beam.visible = night;
  const ped = g.ped;
  if (ped && ped.mesh) {
    ped.bankGuard = true;
    ped.mesh.visible = true;
    if (ped.anchor && ped.anchor.slot) {
      ped.mesh.position.set(ped.anchor.slot.x, ped.anchor.slot.y || 0.42, ped.anchor.slot.z);
      ped.heading = ped.anchor.facing;
      ped.mesh.rotation.y = ped.heading;
      ped.speed = 0;
    }
  }
}

export function updateMallDirectory(dt) {
  if (!GAMEPLAY.mallDir || !G.mallDir) return;
  const c = G.mallDir;
  c.t = (c.t || 0) + dt;
  const h = ((G.time.dayT % 1) + 1) % 1 * 24;
  const open = h >= 10 && h < 22;
  if (c.screen && c.screen.material) {
    c.screen.material.emissiveIntensity = open ? 0.35 + 0.28 * Math.max(0, Math.sin(c.t * 3.2)) : 0.05;
  }
  const ped = c.clerk;
  if (ped && ped.mesh) {
    ped.mallDir = true;
    ped.mesh.visible = open;
    const slot = ped.anchor && ped.anchor.slot;
    if (slot) {
      ped.mesh.position.set(slot.x, 0, slot.z);
      ped.heading = ped.anchor.facing;
      ped.mesh.rotation.y = ped.heading;
    }
    ped.speed = 0;
    ped.state = 'idle';
  }
  if (!open || G.player.inVehicle || G._eating) return;
  const pp = G.player.group.position;
  if (!c.mesh || dist2(c.mesh.position, pp) > 2.8 * 2.8) return;
  if (Math.abs((pp.y || 0) - (c.mesh.position.y || 0)) > 2.2) return;
  G.hud.showPrompt('Press <b>E</b> to ask the directory', 0.4);
  if (!G.input.pressed('KeyE')) return;
  const shops = (G.world.mall && G.world.mall.shops) || [];
  if (!shops.length) return;
  c.idx = ((c.idx || 0) + 1) % shops.length;
  const s = shops[c.idx];
  const floor = !s || s.pos.y < 1 ? 'G' : s.pos.y < 8 ? '1' : '2';
  G._mallDir = (G._mallDir || 0) + 1;
  G._mallDirShop = s && s.name;
  if (G.hud.showNotif) G.hud.showNotif(`${s.name} — floor ${floor}`);
  if (G.audio && G.audio.chime) G.audio.chime();
}

export function updateOfficeSmoke(dt) {
  if (!GAMEPLAY.officeSmoke) return;
  const packs = [G.officeSmoke, G.phromSmoke];
  const h = ((G.time.dayT % 1) + 1) % 1 * 24;
  const open = h >= 11.8 && h < 13.6;
  for (const c of packs) {
    if (!c) continue;
    c.t = (c.t || 0) + dt;
    for (let i = 0; i < (c.smokers || []).length; i++) {
      const ped = c.smokers[i];
      if (!ped || ped.dead || !ped.mesh) continue;
      ped.officeSmoke = true;
      ped.mesh.visible = open;
      if (!open) {
        ped.speed = 0;
        ped.state = 'idle';
        continue;
      }
      const slot = ped.anchor && ped.anchor.slot;
      if (slot) {
        const bob = Math.sin(c.t * 2.2 + i) * 0.05;
        ped.mesh.position.set(slot.x, 0, slot.z + bob);
        ped.heading = ped.anchor.facing;
        ped.mesh.rotation.y = ped.heading;
      }
      ped.speed = 0;
      ped.state = 'idle';
      const parts = ped.mesh.userData && ped.mesh.userData.parts;
      if (parts && parts.armR) parts.armR.rotation.x = -0.9 + Math.sin(c.t * 2.8 + i) * 0.1;
      if (ped._ember && ped._ember.material) {
        ped._ember.material.emissiveIntensity = 0.4 + 0.45 * Math.max(0, Math.sin(c.t * 5.5 + i));
      }
    }
  }
}

export function updateBankQueue(dt) {
  if (!GAMEPLAY.bankQueue) return;
  const h = ((G.time.dayT % 1) + 1) % 1 * 24;
  for (const c of [G.bankQueue, G.bankAtm]) {
    if (!c) continue;
    c.t = (c.t || 0) + dt;
    const hours = c.hours || [9, 16];
    const open = h >= hours[0] && h < hours[1];
    for (let i = 0; i < (c.queue || []).length; i++) {
      const ped = c.queue[i];
      if (!ped || ped.dead || !ped.mesh) continue;
      ped.bankQueue = true;
      ped.mesh.visible = open;
      if (!open) {
        ped.speed = 0;
        ped.state = 'idle';
        continue;
      }
      const slot = ped.anchor && ped.anchor.slot;
      if (slot) {
        const bob = i === 0 ? Math.sin(c.t * 2.4) * 0.06 : 0;
        ped.mesh.position.set(slot.x, 0, slot.z + bob);
        ped.heading = ped.anchor.facing;
        ped.mesh.rotation.y = ped.heading;
      }
      ped.speed = 0;
      ped.state = 'idle';
      const parts = ped.mesh.userData && ped.mesh.userData.parts;
      if (i === 0 && parts && parts.armR) parts.armR.rotation.x = -0.85 + Math.sin(c.t * 3.1) * 0.12;
    }
  }
}

export function updateGunClerk(dt) {
  if (!GAMEPLAY.gunClerk || !G.gunClerk) return;
  const c = G.gunClerk;
  c.t = (c.t || 0) + dt;
  const h = ((G.time.dayT % 1) + 1) % 1 * 24;
  const open = h >= 10 && h < 21;
  const ped = c.ped;
  if (ped && ped.mesh) {
    ped.gunClerk = true;
    ped.mesh.visible = open;
    const slot = ped.anchor && ped.anchor.slot;
    if (slot) {
      ped.mesh.position.set(slot.x, 0, slot.z);
      ped.heading = ped.anchor.facing;
      ped.mesh.rotation.y = ped.heading;
    }
    ped.speed = 0;
    ped.state = 'idle';
    const parts = ped.mesh.userData && ped.mesh.userData.parts;
    if (open && parts && parts.armR) parts.armR.rotation.x = -0.7 + Math.sin(c.t * 4.2) * 0.22;
    if (c.cloth) c.cloth.rotation.z = open ? Math.sin(c.t * 4.2) * 0.35 : 0;
  }
}

export function updateStarterClerk(dt) {
  if (!GAMEPLAY.starterClerk || !G.starterClerk) return;
  const c = G.starterClerk;
  c.t = (c.t || 0) + dt;
  const h = ((G.time.dayT % 1) + 1) % 1 * 24;
  const open = h >= 10 && h < 21;
  const ped = c.ped;
  if (ped && ped.mesh) {
    ped.starterClerk = true;
    ped.mesh.visible = open;
    const slot = ped.anchor && ped.anchor.slot;
    if (slot) {
      ped.mesh.position.set(slot.x, 0, slot.z);
      ped.heading = ped.anchor.facing;
      ped.mesh.rotation.y = ped.heading;
    }
    ped.speed = 0;
    ped.state = 'idle';
    const parts = ped.mesh.userData && ped.mesh.userData.parts;
    if (open && parts && parts.armR) parts.armR.rotation.x = -0.7 + Math.sin(c.t * 4.2) * 0.22;
    if (c.cloth) c.cloth.rotation.z = open ? Math.sin(c.t * 4.2) * 0.35 : 0;
  }
}

export function updateHomeAuntie(dt) {
  if (!GAMEPLAY.homeAuntie || !G.homeAuntie) return;
  const c = G.homeAuntie;
  c.t = (c.t || 0) + dt;
  const h = ((G.time.dayT % 1) + 1) % 1 * 24;
  const open = h >= 8 && h < 22;
  const ped = c.ped;
  if (ped && ped.mesh) {
    ped.homeAuntie = true;
    ped.mesh.visible = open;
    const slot = ped.anchor && ped.anchor.slot;
    if (slot) {
      ped.mesh.position.set(slot.x, slot.y || 0.42, slot.z);
      ped.heading = ped.anchor.facing;
      ped.mesh.rotation.y = ped.heading;
    }
    ped.speed = 0;
    ped.state = 'idle';
    const page = ped.mesh.getObjectByName('home-paper-page');
    if (page && open) page.rotation.x = Math.sin(c.t * 2.8) * 0.18;
  }
}

export function updateStationPorter(dt) {
  if (!GAMEPLAY.stationPorter || !G.stationPorter) return;
  const c = G.stationPorter;
  c.t = (c.t || 0) + dt;
  const h = ((G.time.dayT % 1) + 1) % 1 * 24;
  const open = h >= 6 && h < 22;
  for (let i = 0; i < (c.porters || []).length; i++) {
    const ped = c.porters[i];
    if (!ped || ped.dead || !ped.mesh) continue;
    ped.stationPorter = true;
    ped.mesh.visible = open;
    if (!open) {
      ped.speed = 0;
      ped.state = 'idle';
      continue;
    }
    const slot = ped.anchor && ped.anchor.slot;
    if (slot) {
      const bob = Math.sin(c.t * 2.2 + i) * 0.05;
      ped.mesh.position.set(slot.x + (i === 0 ? bob : 0), 0, slot.z + (i === 1 ? bob : 0));
      ped.heading = ped.anchor.facing;
      ped.mesh.rotation.y = ped.heading;
    }
    ped.speed = 0;
    ped.state = 'idle';
    const bag = ped.mesh.getObjectByName('station-bag');
    if (bag) bag.rotation.z = Math.sin(c.t * 3.2 + i) * 0.22;
  }
  const sit = G.stationSit;
  if (sit) {
    sit.t = (sit.t || 0) + dt;
    for (const ped of sit.sitters || []) {
      if (!ped || ped.dead || !ped.mesh) continue;
      ped.stationPorter = true;
      ped.stationSit = true;
      ped.mesh.visible = open;
      const slot = ped.anchor && ped.anchor.slot;
      if (slot) {
        ped.mesh.position.set(slot.x, slot.y || 0.42, slot.z);
        ped.heading = ped.anchor.facing;
        ped.mesh.rotation.y = ped.heading;
      }
      ped.speed = 0;
      ped.state = 'idle';
      const phone = ped.mesh.getObjectByName('station-phone');
      if (phone && phone.material && open) {
        phone.material.emissiveIntensity = 0.22 + Math.sin(sit.t * 3.4) * 0.12;
      }
    }
  }
}

export function updateGarageMech(dt) {
  if (!GAMEPLAY.garageMech || !G.garageMech) return;
  const c = G.garageMech;
  c.t = (c.t || 0) + dt;
  const h = ((G.time.dayT % 1) + 1) % 1 * 24;
  const open = h >= 8 && h < 19;
  const ped = c.ped;
  if (ped && ped.mesh) {
    ped.garageMech = true;
    ped.mesh.visible = open;
    if (!open) {
      ped.speed = 0;
      ped.state = 'idle';
    } else {
      const slot = ped.anchor && ped.anchor.slot;
      if (slot) {
        const bob = Math.sin(c.t * 2.2) * 0.05;
        ped.mesh.position.set(slot.x, 0, slot.z + bob);
        ped.heading = ped.anchor.facing;
        ped.mesh.rotation.y = ped.heading;
      }
      ped.speed = 0;
      ped.state = 'idle';
      const wrench = ped.mesh.getObjectByName('garage-wrench');
      if (wrench) wrench.rotation.z = Math.sin(c.t * 4.2) * 0.35;
    }
  }
  const wait = G.garageWait;
  if (wait) {
    wait.t = (wait.t || 0) + dt;
    const wp = wait.ped;
    if (wp && wp.mesh) {
      wp.garageMech = true;
      wp.garageWait = true;
      wp.mesh.visible = open;
      if (!open) {
        wp.speed = 0;
        wp.state = 'idle';
      } else {
        const slot = wp.anchor && wp.anchor.slot;
        if (slot) {
          const bob = Math.sin(wait.t * 2.2) * 0.05;
          wp.mesh.position.set(slot.x, 0, slot.z + bob);
          wp.heading = wp.anchor.facing;
          wp.mesh.rotation.y = wp.heading;
        }
        wp.speed = 0;
        wp.state = 'idle';
        const helm = wp.mesh.getObjectByName('garage-helmet');
        if (helm) helm.rotation.z = Math.sin(wait.t * 4.2) * 0.35;
      }
    }
  }
}

export function updateKlongDock(dt) {
  if (!GAMEPLAY.klongDock || !G.klongDock) return;
  const c = G.klongDock;
  c.t = (c.t || 0) + dt;
  const h = ((G.time.dayT % 1) + 1) % 1 * 24;
  const open = h >= 6 && h < 19;
  for (let i = 0; i < (c.hands || []).length; i++) {
    const ped = c.hands[i];
    if (!ped || ped.dead || !ped.mesh) continue;
    ped.klongDock = true;
    ped.mesh.visible = open;
    if (!open) {
      ped.speed = 0;
      ped.state = 'idle';
      continue;
    }
    const slot = ped.anchor && ped.anchor.slot;
    if (slot) {
      const bob = Math.sin(c.t * 2.2 + i) * 0.05;
      ped.mesh.position.set(slot.x + (i === 0 ? bob : 0), 0, slot.z + (i === 1 ? bob : 0));
      ped.heading = ped.anchor.facing;
      ped.mesh.rotation.y = ped.heading;
    }
    ped.speed = 0;
    ped.state = 'idle';
    const crate = ped.mesh.getObjectByName('dock-crate');
    if (crate) crate.rotation.z = Math.sin(c.t * 3.4 + i) * 0.22;
  }
}

export function updateSengClerk(dt) {
  if (!GAMEPLAY.sengClerk || !G.sengClerk) return;
  const c = G.sengClerk;
  c.t = (c.t || 0) + dt;
  const h = ((G.time.dayT % 1) + 1) % 1 * 24;
  const open = h >= 10 && h < 20;
  const ped = c.ped;
  if (ped && ped.mesh) {
    ped.sengClerk = true;
    ped.mesh.visible = open;
    if (!open) {
      ped.speed = 0;
      ped.state = 'idle';
    } else {
      const slot = ped.anchor && ped.anchor.slot;
      if (slot) {
        const bob = Math.sin(c.t * 2.2) * 0.05;
        ped.mesh.position.set(slot.x, 0, slot.z + bob);
        ped.heading = ped.anchor.facing;
        ped.mesh.rotation.y = ped.heading;
      }
      ped.speed = 0;
      ped.state = 'idle';
      const tray = ped.mesh.getObjectByName('seng-tray');
      if (tray) tray.rotation.z = Math.sin(c.t * 4.2) * 0.35;
    }
  }
  const shop = G.sengShopper;
  if (shop) {
    shop.t = (shop.t || 0) + dt;
    const sp = shop.ped;
    if (sp && sp.mesh) {
      sp.sengClerk = true;
      sp.sengShop = true;
      sp.mesh.visible = open;
      if (!open) {
        sp.speed = 0;
        sp.state = 'idle';
      } else {
        const slot = sp.anchor && sp.anchor.slot;
        if (slot) {
          const bob = Math.sin(shop.t * 2.2) * 0.05;
          sp.mesh.position.set(slot.x, 0, slot.z + bob);
          sp.heading = sp.anchor.facing;
          sp.mesh.rotation.y = sp.heading;
        }
        sp.speed = 0;
        sp.state = 'idle';
        const chain = sp.mesh.getObjectByName('seng-chain');
        if (chain) chain.rotation.z = Math.sin(shop.t * 4.2) * 0.35;
      }
    }
  }
}

export function updateAirportCrew(dt) {
  if (!GAMEPLAY.airportCrew || !G.airportCrew) return;
  const c = G.airportCrew;
  c.t = (c.t || 0) + dt;
  const h = ((G.time.dayT % 1) + 1) % 1 * 24;
  const open = h >= 6 && h < 21;
  for (let i = 0; i < (c.hands || []).length; i++) {
    const ped = c.hands[i];
    if (!ped || ped.dead || !ped.mesh) continue;
    ped.airportCrew = true;
    ped.mesh.visible = open;
    if (!open) {
      ped.speed = 0;
      ped.state = 'idle';
      continue;
    }
    const slot = ped.anchor && ped.anchor.slot;
    if (slot) {
      const bob = Math.sin(c.t * 2.2 + i) * 0.05;
      ped.mesh.position.set(slot.x + (i === 0 ? bob : 0), 0, slot.z + (i === 1 ? bob : 0));
      ped.heading = ped.anchor.facing;
      ped.mesh.rotation.y = ped.heading;
    }
    ped.speed = 0;
    ped.state = 'idle';
    const paddle = ped.mesh.getObjectByName('marshal-paddle');
    if (paddle) paddle.rotation.z = Math.sin(c.t * 3.6 + i) * 0.45;
  }
}

export function updateAirportCargo(dt) {
  if (!GAMEPLAY.airportCargo || !G.airportCargo) return;
  const c = G.airportCargo;
  c.t = (c.t || 0) + dt;
  const h = ((G.time.dayT % 1) + 1) % 1 * 24;
  const open = h >= 6 && h < 19;
  for (let i = 0; i < (c.hands || []).length; i++) {
    const ped = c.hands[i];
    if (!ped || ped.dead || !ped.mesh) continue;
    ped.airportCargo = true;
    ped.mesh.visible = open;
    if (!open) {
      ped.speed = 0;
      ped.state = 'idle';
      continue;
    }
    const slot = ped.anchor && ped.anchor.slot;
    if (slot) {
      const bob = Math.sin(c.t * 2.2 + i) * 0.05;
      ped.mesh.position.set(slot.x + (i === 0 ? bob : 0), 0, slot.z + (i === 1 ? bob : 0));
      ped.heading = ped.anchor.facing;
      ped.mesh.rotation.y = ped.heading;
    }
    ped.speed = 0;
    ped.state = 'idle';
    const crate = ped.mesh.getObjectByName('cargo-crate');
    if (crate) crate.rotation.z = Math.sin(c.t * 3.4 + i) * 0.22;
  }
}

export function updateAirportTower(dt) {
  if (!GAMEPLAY.airportTower || !G.towerCtl) return;
  const c = G.towerCtl;
  c.t = (c.t || 0) + dt;
  const h = ((G.time.dayT % 1) + 1) % 1 * 24;
  const open = h >= 6 && h < 22;
  const ped = c.ped;
  if (ped && ped.mesh) {
    ped.airportTower = true;
    ped.mesh.visible = open;
    if (!open) {
      ped.speed = 0;
      ped.state = 'idle';
    } else {
      const slot = ped.anchor && ped.anchor.slot;
      if (slot) {
        const bob = Math.sin(c.t * 2.2) * 0.05;
        ped.mesh.position.set(slot.x, 0, slot.z + bob);
        ped.heading = ped.anchor.facing;
        ped.mesh.rotation.y = ped.heading;
      }
      ped.speed = 0;
      ped.state = 'idle';
      const binocs = ped.mesh.getObjectByName('tower-binocs');
      if (binocs) binocs.rotation.x = Math.sin(c.t * 3.2) * 0.22;
    }
  }
}

export function updateAirportTaxi(dt) {
  if (!GAMEPLAY.airportTaxi) return;
  const h = ((G.time.dayT % 1) + 1) % 1 * 24;
  const open = h >= 6 && h < 22;
  for (const c of [G.airportTaxi, G.southAirportTaxi]) {
    if (!c) continue;
    c.t = (c.t || 0) + dt;
    for (let i = 0; i < (c.touts || []).length; i++) {
      const ped = c.touts[i];
      if (!ped || ped.dead || !ped.mesh) continue;
      ped.airportTaxi = true;
      ped.mesh.visible = open;
      if (!open) {
        ped.speed = 0;
        ped.state = 'idle';
        continue;
      }
      const slot = ped.anchor && ped.anchor.slot;
      if (slot) {
        const bob = Math.sin(c.t * 2.2 + i) * 0.05;
        ped.mesh.position.set(slot.x + (i === 0 ? bob : 0), 0, slot.z + (i === 1 ? bob : 0));
        ped.heading = ped.anchor.facing;
        ped.mesh.rotation.y = ped.heading;
      }
      ped.speed = 0;
      ped.state = 'idle';
      const slate = ped.mesh.getObjectByName('taxi-slate');
      if (slate) slate.rotation.z = Math.sin(c.t * 3.4 + i) * 0.22;
    }
  }
}

export function updateWindsock(dt) {
  if (!GAMEPLAY.airport || !G.windsock) return;
  const c = G.windsock;
  c.t = (c.t || 0) + dt;
  const sock = c.sock;
  if (!sock) return;
  const rain = G.time.rainStrength || 0;
  const amp = 0.16 + rain * 0.28;
  sock.rotation.z = PI / 2;
  sock.rotation.y = Math.sin(c.t * 2.4) * amp;
  sock.rotation.x = Math.sin(c.t * 3.6) * amp * 0.35;
}

export function updateRunwayLights(dt) {
  if (!GAMEPLAY.airport || !G.runwayLights) return;
  const c = G.runwayLights;
  c.t = (c.t || 0) + dt;
  const h = ((G.time.dayT % 1) + 1) % 1 * 24;
  const night = h >= 18.5 || h < 6.2;
  const pulse = night ? 0.85 + Math.sin(c.t * 6.2) * 0.25 : 0.12;
  if (c.mat) c.mat.emissiveIntensity = pulse;
  for (const m of c.lights || []) {
    if (m) m.visible = true;
  }
}

export function updateTowerBeacon(dt) {
  if (!GAMEPLAY.airport || !G.towerBeacon) return;
  const c = G.towerBeacon;
  c.t = (c.t || 0) + dt;
  const h = ((G.time.dayT % 1) + 1) % 1 * 24;
  const night = h >= 18.5 || h < 6.2;
  const mesh = c.mesh;
  if (!mesh) return;
  mesh.visible = true;
  mesh.rotation.y = c.t * 1.8;
  if (mesh.material) mesh.material.emissiveIntensity = night ? 0.7 + Math.sin(c.t * 8.4) * 0.45 : 0.12;
}

export function updateMallFood(dt) {
  if (!GAMEPLAY.mallFood || !G.mallFood) return;
  const c = G.mallFood;
  c.t = (c.t || 0) + dt;
  const h = ((G.time.dayT % 1) + 1) % 1 * 24;
  const open = h >= 11 && h < 21;
  if (c.table) c.table.visible = true;
  for (const ped of c.eaters || []) {
    if (!ped || ped.dead || !ped.mesh) continue;
    ped.mallFood = true;
    ped.mesh.visible = open;
    if (!open) {
      ped.speed = 0;
      ped.state = 'idle';
      continue;
    }
    const slot = ped.anchor && ped.anchor.slot;
    if (slot) {
      ped.mesh.position.set(slot.x, slot.y || 0.42, slot.z);
      ped.heading = ped.anchor.facing;
      ped.mesh.rotation.y = ped.heading;
    }
    ped.speed = 0;
    ped.state = 'idle';
  }
}

export function updateMallTech(dt) {
  if (!GAMEPLAY.mallTech || !G.mallTech) return;
  const c = G.mallTech;
  c.t = (c.t || 0) + dt;
  const h = ((G.time.dayT % 1) + 1) % 1 * 24;
  const open = h >= 10 && h < 21;
  for (let i = 0; i < (c.lookers || []).length; i++) {
    const ped = c.lookers[i];
    if (!ped || ped.dead || !ped.mesh) continue;
    ped.mallTech = true;
    ped.mesh.visible = open;
    if (!open) {
      ped.speed = 0;
      ped.state = 'idle';
      continue;
    }
    const slot = ped.anchor && ped.anchor.slot;
    if (slot) {
      const bob = Math.sin(c.t * 2.1 + i) * 0.05;
      ped.mesh.position.set(slot.x, 0, slot.z + bob);
      ped.heading = ped.anchor.facing;
      ped.mesh.rotation.y = ped.heading;
    }
    ped.speed = 0;
    ped.state = 'idle';
    const phone = ped._phone || (ped.mesh && ped.mesh.getObjectByName('mall-tech-phone'));
    if (phone && phone.material) {
      phone.material.emissiveIntensity = 0.25 + 0.4 * Math.max(0, Math.sin(c.t * 4.4 + i));
    }
  }
}

export function updateMallPharm(dt) {
  if (!GAMEPLAY.mallPharm || !G.mallPharm) return;
  const c = G.mallPharm;
  c.t = (c.t || 0) + dt;
  const h = ((G.time.dayT % 1) + 1) % 1 * 24;
  const open = h >= 10 && h < 21;
  const peds = [c.clerk, c.customer];
  for (let i = 0; i < peds.length; i++) {
    const ped = peds[i];
    if (!ped || ped.dead || !ped.mesh) continue;
    ped.mallPharm = true;
    ped.mesh.visible = open;
    if (!open) {
      ped.speed = 0;
      ped.state = 'idle';
      continue;
    }
    const slot = ped.anchor && ped.anchor.slot;
    if (slot) {
      const bob = Math.sin(c.t * 2.2 + i) * 0.05;
      ped.mesh.position.set(slot.x + (i === 0 ? bob : 0), 0, slot.z + (i === 1 ? bob : 0));
      ped.heading = ped.anchor.facing;
      ped.mesh.rotation.y = ped.heading;
    }
    ped.speed = 0;
    ped.state = 'idle';
    const parts = ped.mesh.userData && ped.mesh.userData.parts;
    if (i === 0 && parts && parts.armR) parts.armR.rotation.x = -0.7 + Math.sin(c.t * 3.6) * 0.18;
    if (i === 1 && c.customer && c.customer._bag) {
      c.customer._bag.rotation.z = Math.sin(c.t * 3.6) * 0.22;
    }
  }
}

export function updateMallRoma(dt) {
  if (!GAMEPLAY.mallRoma || !G.mallRoma) return;
  const c = G.mallRoma;
  c.t = (c.t || 0) + dt;
  const h = ((G.time.dayT % 1) + 1) % 1 * 24;
  const open = h >= 10 && h < 21;
  const peds = [c.clerk, c.customer];
  for (let i = 0; i < peds.length; i++) {
    const ped = peds[i];
    if (!ped || ped.dead || !ped.mesh) continue;
    ped.mallRoma = true;
    ped.mesh.visible = open;
    if (!open) {
      ped.speed = 0;
      ped.state = 'idle';
      continue;
    }
    const slot = ped.anchor && ped.anchor.slot;
    if (slot) {
      const bob = Math.sin(c.t * 2.2 + i) * 0.05;
      ped.mesh.position.set(slot.x + (i === 0 ? bob : 0), 0, slot.z + (i === 1 ? bob : 0));
      ped.heading = ped.anchor.facing;
      ped.mesh.rotation.y = ped.heading;
    }
    ped.speed = 0;
    ped.state = 'idle';
    const parts = ped.mesh.userData && ped.mesh.userData.parts;
    if (i === 0 && parts && parts.armR) parts.armR.rotation.x = -0.7 + Math.sin(c.t * 3.6) * 0.18;
    if (i === 1 && c.customer && c.customer._bag) {
      c.customer._bag.rotation.z = Math.sin(c.t * 3.6) * 0.22;
    }
  }
}

export function updateMallWatch(dt) {
  if (!GAMEPLAY.mallWatch || !G.mallWatch) return;
  const c = G.mallWatch;
  c.t = (c.t || 0) + dt;
  const h = ((G.time.dayT % 1) + 1) % 1 * 24;
  const open = h >= 10 && h < 21;
  const peds = [c.clerk, c.customer];
  for (let i = 0; i < peds.length; i++) {
    const ped = peds[i];
    if (!ped || ped.dead || !ped.mesh) continue;
    ped.mallWatch = true;
    ped.mesh.visible = open;
    if (!open) {
      ped.speed = 0;
      ped.state = 'idle';
      continue;
    }
    const slot = ped.anchor && ped.anchor.slot;
    if (slot) {
      const bob = Math.sin(c.t * 2.2 + i) * 0.05;
      ped.mesh.position.set(slot.x + (i === 0 ? bob : 0), slot.y || c.y || 10, slot.z + (i === 1 ? bob : 0));
      ped.heading = ped.anchor.facing;
      ped.mesh.rotation.y = ped.heading;
    }
    ped.speed = 0;
    ped.state = 'idle';
    const face = ped.mesh.getObjectByName('mall-watch-face');
    if (face) face.rotation.z = c.t * 1.8;
  }
}

export function updateMallManga(dt) {
  if (!GAMEPLAY.mallManga || !G.mallManga) return;
  const c = G.mallManga;
  c.t = (c.t || 0) + dt;
  const h = ((G.time.dayT % 1) + 1) % 1 * 24;
  const open = h >= 10 && h < 21;
  for (let i = 0; i < (c.readers || []).length; i++) {
    const ped = c.readers[i];
    if (!ped || ped.dead || !ped.mesh) continue;
    ped.mallManga = true;
    ped.mesh.visible = open;
    if (!open) {
      ped.speed = 0;
      ped.state = 'idle';
      continue;
    }
    const slot = ped.anchor && ped.anchor.slot;
    if (slot) {
      ped.mesh.position.set(slot.x, slot.y || c.y || 5.42, slot.z);
      ped.heading = ped.anchor.facing;
      ped.mesh.rotation.y = ped.heading;
    }
    ped.speed = 0;
    ped.state = 'idle';
    const page = ped.mesh.getObjectByName('mall-manga-page');
    if (page) page.rotation.x = Math.sin(c.t * 2.8 + i) * 0.18;
  }
}

export function updateMallSushi(dt) {
  if (!GAMEPLAY.mallSushi || !G.mallSushi) return;
  const c = G.mallSushi;
  c.t = (c.t || 0) + dt;
  const h = ((G.time.dayT % 1) + 1) % 1 * 24;
  const open = h >= 10 && h < 21;
  const peds = [c.chef, c.customer];
  for (let i = 0; i < peds.length; i++) {
    const ped = peds[i];
    if (!ped || ped.dead || !ped.mesh) continue;
    ped.mallSushi = true;
    ped.mesh.visible = open;
    if (!open) {
      ped.speed = 0;
      ped.state = 'idle';
      continue;
    }
    const slot = ped.anchor && ped.anchor.slot;
    if (slot) {
      const bob = Math.sin(c.t * 2.2 + i) * 0.05;
      ped.mesh.position.set(slot.x + (i === 0 ? bob : 0), slot.y || c.y || 5, slot.z + (i === 1 ? bob : 0));
      ped.heading = ped.anchor.facing;
      ped.mesh.rotation.y = ped.heading;
    }
    ped.speed = 0;
    ped.state = 'idle';
    const fish = ped.mesh.getObjectByName('mall-sushi-fish');
    if (fish) fish.rotation.y = c.t * 2.4;
  }
}

export function updateMallCafe(dt) {
  if (!GAMEPLAY.mallCafe || !G.mallCafe) return;
  const c = G.mallCafe;
  c.t = (c.t || 0) + dt;
  const h = ((G.time.dayT % 1) + 1) % 1 * 24;
  const open = h >= 10 && h < 21;
  const peds = [c.clerk, c.customer];
  for (let i = 0; i < peds.length; i++) {
    const ped = peds[i];
    if (!ped || ped.dead || !ped.mesh) continue;
    ped.mallCafe = true;
    ped.mesh.visible = open;
    if (!open) {
      ped.speed = 0;
      ped.state = 'idle';
      continue;
    }
    const slot = ped.anchor && ped.anchor.slot;
    if (slot) {
      const bob = Math.sin(c.t * 2.2 + i) * 0.05;
      ped.mesh.position.set(slot.x + (i === 0 ? bob : 0), slot.y || c.y || 10, slot.z + (i === 1 ? bob : 0));
      ped.heading = ped.anchor.facing;
      ped.mesh.rotation.y = ped.heading;
    }
    ped.speed = 0;
    ped.state = 'idle';
    const steam = ped.mesh.getObjectByName('mall-cafe-steam');
    if (steam) steam.scale.y = 1 + Math.sin(c.t * 3.2) * 0.45;
  }
}

export function updateMallThreads(dt) {
  if (!GAMEPLAY.mallThreads || !G.mallThreads) return;
  const c = G.mallThreads;
  c.t = (c.t || 0) + dt;
  const h = ((G.time.dayT % 1) + 1) % 1 * 24;
  const open = h >= 10 && h < 21;
  const peds = [c.clerk, c.customer];
  for (let i = 0; i < peds.length; i++) {
    const ped = peds[i];
    if (!ped || ped.dead || !ped.mesh) continue;
    ped.mallThreads = true;
    ped.mesh.visible = open;
    if (!open) {
      ped.speed = 0;
      ped.state = 'idle';
      continue;
    }
    const slot = ped.anchor && ped.anchor.slot;
    if (slot) {
      const bob = Math.sin(c.t * 2.2 + i) * 0.05;
      ped.mesh.position.set(slot.x + (i === 1 ? bob : 0), slot.y || c.y || 10, slot.z + (i === 0 ? bob : 0));
      ped.heading = ped.anchor.facing;
      ped.mesh.rotation.y = ped.heading;
    }
    ped.speed = 0;
    ped.state = 'idle';
    const shirt = ped.mesh.getObjectByName('mall-threads-shirt');
    if (shirt) shirt.rotation.z = Math.sin(c.t * 2.6) * 0.28;
  }
}

export function updateMallSeven(dt) {
  if (!GAMEPLAY.mallSeven || !G.mallSeven) return;
  const c = G.mallSeven;
  c.t = (c.t || 0) + dt;
  const h = ((G.time.dayT % 1) + 1) % 1 * 24;
  const open = h >= 10 && h < 21;
  const peds = [c.clerk, c.customer];
  for (let i = 0; i < peds.length; i++) {
    const ped = peds[i];
    if (!ped || ped.dead || !ped.mesh) continue;
    ped.mallSeven = true;
    ped.mesh.visible = open;
    if (!open) {
      ped.speed = 0;
      ped.state = 'idle';
      continue;
    }
    const slot = ped.anchor && ped.anchor.slot;
    if (slot) {
      const bob = Math.sin(c.t * 2.2 + i) * 0.05;
      ped.mesh.position.set(slot.x + (i === 0 ? bob : 0), slot.y || c.y || 0, slot.z + (i === 1 ? bob : 0));
      ped.heading = ped.anchor.facing;
      ped.mesh.rotation.y = ped.heading;
    }
    ped.speed = 0;
    ped.state = 'idle';
    const scan = ped.mesh.getObjectByName('mall-seven-scan');
    if (scan && scan.material) scan.material.emissiveIntensity = 0.25 + Math.sin(c.t * 4.4) * 0.35;
  }
}

export function updateMallArcade(dt) {
  if (!GAMEPLAY.mallArcade || !G.mallArcade) return;
  const c = G.mallArcade;
  c.t = (c.t || 0) + dt;
  const h = ((G.time.dayT % 1) + 1) % 1 * 24;
  const open = h >= 10 && h < 21;
  for (let i = 0; i < (c.players || []).length; i++) {
    const ped = c.players[i];
    if (!ped || ped.dead || !ped.mesh) continue;
    ped.mallArcade = true;
    ped.mesh.visible = open;
    if (!open) {
      ped.speed = 0;
      ped.state = 'idle';
      continue;
    }
    const slot = ped.anchor && ped.anchor.slot;
    if (slot) {
      const bob = Math.sin(c.t * 2.2 + i) * 0.05;
      ped.mesh.position.set(slot.x, slot.y || c.y || 5, slot.z + bob);
      ped.heading = ped.anchor.facing;
      ped.mesh.rotation.y = ped.heading;
    }
    ped.speed = 0;
    ped.state = 'idle';
    const ball = ped.mesh.getObjectByName('mall-arcade-ball');
    if (ball && ball.material) ball.material.emissiveIntensity = 0.3 + Math.sin(c.t * 4.4 + i) * 0.35;
  }
}

export function updateGymBag(dt) {
  if (!GAMEPLAY.gymBag || !G.gymBag) return;
  const c = G.gymBag;
  c.t = (c.t || 0) + dt;
  const h = ((G.time.dayT % 1) + 1) % 1 * 24;
  const open = h >= 7 && h < 21;
  const peds = [c.fighter, c.trainer];
  for (let i = 0; i < peds.length; i++) {
    const ped = peds[i];
    if (!ped || ped.dead || !ped.mesh) continue;
    ped.gymBag = true;
    ped.mesh.visible = open;
    if (!open) {
      ped.speed = 0;
      ped.state = 'idle';
      continue;
    }
    const slot = ped.anchor && ped.anchor.slot;
    if (slot) {
      const bob = Math.sin(c.t * 2.2 + i) * 0.05;
      ped.mesh.position.set(slot.x + (i === 1 ? bob : 0), 0, slot.z + (i === 0 ? bob : 0));
      ped.heading = ped.anchor.facing;
      ped.mesh.rotation.y = ped.heading;
    }
    ped.speed = 0;
    ped.state = 'idle';
    const parts = ped.mesh.userData && ped.mesh.userData.parts;
    if (i === 0 && parts && parts.armR) parts.armR.rotation.x = -0.9 + Math.sin(c.t * 6.2) * 0.45;
  }
  if (c.bag) {
    c.bag.visible = true;
    c.bag.rotation.z = Math.sin(c.t * 3.4) * 0.22;
  }
}

export function updateCheckpoint(dt) {
  if (!GAMEPLAY.nightCheckpoint || !G.checkpoint) return;
  const h = ((G.time.dayT % 1) + 1) % 1 * 24;
  const night = h >= 21 || h < 5.2;
  const late = !!(GAMEPLAY.twoAmCheckpoint && night && h >= 1.5 && h < 3.8);
  const cp = G.checkpoint;
  cp.active = night;
  cp.late = late;
  const cop = cp.cop;
  if (cop && cop.mesh) {
    cop.mesh.visible = night;
    cop.checkpoint = true;
    if (cop.anchor && cop.anchor.slot) {
      cop.mesh.position.set(cop.anchor.slot.x, 0, cop.anchor.slot.z);
      cop.heading = cop.anchor.facing;
      cop.mesh.rotation.y = cop.heading;
      cop.speed = 0;
      cop.state = 'idle';
    }
  }
  if (cp.spikes) cp.spikes.visible = late;
  if (cp.light) cp.light.intensity = night ? (late ? 2.2 : 1.6) : 0;
  if (cp.beam) cp.beam.visible = night;
  if (!night) { cp.flagged = false; return; }
  const p = G.player;
  const v = p && p.inVehicle;
  if (v && v.driver === 'player' && !cp.flagged) {
    const speed = Math.abs(v.vel || 0);
    const near = dist2(v.pos, cp) < 9 * 9;
    const hitStrip = late && near && speed > 6;
    const blow = near && speed > 8;
    if (hitStrip || blow) {
      cp.flagged = true;
      if (hitStrip) v.tiresBlown = true;
      raiseWanted(late ? 2 : 1, late ? 4 : 2);
      if (G.hud && G.hud.showNotif) {
        G.hud.showNotif(late
          ? (hitStrip ? 'Spike strip — ด่านตีสอง' : 'Ran the 2 AM checkpoint')
          : 'Ran the checkpoint');
      }
    }
  } else if (!v && p && p.group && dist2(p.group.position, cp) < 7 * 7) {
    if (G.hud && G.hud.showPrompt) G.hud.showPrompt(late ? '2 AM checkpoint — crawl' : 'Checkpoint — slow down', 0.35);
  }
}

export function updateLottery(dt) {
  if (!GAMEPLAY.lottery) return;
  if (G.player.inVehicle || G._eating) return;
  const pp = G.player.group.position;
  const now = performance.now();
  for (const L of [G.lottery, G.southLottery, G.westLottery, G.eastLottery]) {
    if (!L || !L.pos) continue;
    if (dist2(L.pos, pp) > 2.4 * 2.4) continue;
    if (L.readyAt && now < L.readyAt) {
      G.hud.showPrompt('Counting out tickets…', 0.35);
      return;
    }
    G.hud.showPrompt('Press <b>E</b> for a lottery ticket · ฿80', 0.4);
    if (!G.input.pressed('KeyE')) return;
    if (G.cash < 80) { G.hud.showNotif('Need ฿80 for a ticket'); return; }
    G.cash -= 80;
    if (G.hud.setCash) G.hud.setCash(G.cash);
    L.readyAt = now + 1800;
    const forced = G._lotteryForce;
    G._lotteryForce = null;
    const roll = forced != null ? 0 : Math.random();
    let win = forced != null ? forced : 0;
    if (forced == null) {
      if (roll < 0.08) win = 1200;
      else if (roll < 0.32) win = 240;
    }
    if (win) {
      G.cash += win;
      if (G.hud.setCash) G.hud.setCash(G.cash);
      G.hud.showNotif(`Lottery +฿${win}`);
      if (G.audio && G.audio.chime) G.audio.chime();
    } else {
      G.hud.showNotif('Not this time');
      if (G.audio && G.audio.blip) G.audio.blip({ freq: 220, dur: 0.12, gain: 0.08 });
    }
    G._lotteryLast = { spent: 80, win };
    return;
  }
}

export function updateMallShoppers(dt) {
  if (!GAMEPLAY.mallShoppers) return;
  const h = ((G.time.dayT % 1) + 1) % 1 * 24;
  const mall = G.world && G.world.poi && G.world.poi.terminal21;
  const bts = G.world && G.world.bts;
  const dest = { x: bts ? bts.x : -50, z: (bts && bts.z) || 0 };
  const from = mall || { x: dest.x + 18, z: dest.z - 22 };
  if (h >= 17 && h < 20) {
    G._mallShoppers = G._mallShoppers || [];
    while (G._mallShoppers.length < 4) {
      const pos = new THREE.Vector3(
        from.x + rand(-6, 6), 0, from.z + rand(-6, 6));
      const ped = spawnPed(G.scene, pos, Math.random() < 0.6 ? 'office' : 'tourist');
      ped.mallShop = true;
      ped.anchor = null;
      ped.state = 'walking';
      ped.heading = Math.atan2(dest.x - pos.x, dest.z - pos.z);
      G._mallShoppers.push(ped);
    }
    for (const ped of G._mallShoppers) {
      if (!ped || ped.dead) continue;
      const dx = dest.x - ped.mesh.position.x, dz = dest.z - ped.mesh.position.z;
      const d = Math.hypot(dx, dz);
      if (d > 8) { ped.heading = Math.atan2(dx, dz); ped.speed = 1.25; ped.state = 'walking'; }
      else { ped.speed = 0.2; ped.state = 'idle'; }
    }
  } else if (G._mallShoppers && G._mallShoppers.length) {
    for (const ped of G._mallShoppers) {
      if (!ped || ped.dead) continue;
      ped.mallShop = false;
    }
    G._mallShoppers = [];
  }
}

export function updateOfficeCommute(dt) {
  if (!GAMEPLAY.officeCommute) return;
  const h = ((G.time.dayT % 1) + 1) % 1 * 24;
  const bts = G.world && G.world.bts;
  const dest = { x: bts ? bts.x : -50, z: (bts && bts.z) || 0 };
  if (h >= 17 && h < 19.6) {
    G._officeCommute = G._officeCommute || [];
    while (G._officeCommute.length < 6) {
      const ang = rand(0, TAU), r = rand(28, 90);
      const pos = new THREE.Vector3(
        clamp(dest.x + Math.cos(ang) * r, -HALF + 8, HALF - 8), 0,
        clamp(dest.z + Math.sin(ang) * r, -HALF + 8, HALF - 8));
      const ped = spawnPed(G.scene, pos, 'office');
      ped.commute = true;
      ped.anchor = null;
      ped.state = 'walking';
      ped.heading = Math.atan2(dest.x - pos.x, dest.z - pos.z);
      G._officeCommute.push(ped);
    }
    for (const ped of G._officeCommute) {
      if (!ped || ped.dead) continue;
      const dx = dest.x - ped.mesh.position.x, dz = dest.z - ped.mesh.position.z;
      const d = Math.hypot(dx, dz);
      if (d > 8) { ped.heading = Math.atan2(dx, dz); ped.speed = 1.45; ped.state = 'walking'; }
      else { ped.speed = 0.2; ped.state = 'idle'; }
    }
  } else if (G._officeCommute && G._officeCommute.length) {
    for (const ped of G._officeCommute) {
      if (!ped || ped.dead) continue;
      ped.commute = false;
    }
    G._officeCommute = [];
  }
}

export function updateBtsPlatform(dt) {
  if (!GAMEPLAY.btsPlatform) return;
  const stops = btsStopList();
  G._btsWaiters = (G._btsWaiters || []).filter(p => p && !p.dead && p.mesh);
  const want = 4;
  for (const stop of stops) {
    const live = G._btsWaiters.filter(p => p.btsStop === stop.name);
    while (live.length < want) {
      const ped = spawnBtsWaiter(stop);
      G._btsWaiters.push(ped);
      live.push(ped);
    }
  }
  const trainX = G.bts && G.bts.mesh ? G.bts.mesh.position.x : 1e9;
  for (const ped of G._btsWaiters) {
    const stop = stops.find(s => s.name === ped.btsStop);
    if (!stop || !ped.btsSlot) continue;
    const d = Math.abs(trainX - stop.x);
    if (d < 28) ped.btsApproach = true;
    else if (!ped.btsBoarded) ped.btsApproach = false;
    if (d < 10 && !ped.btsBoarded) {
      ped.btsBoarded = true;
      ped.mesh.visible = false;
      ped.speed = 0;
    } else if (d > 32 && ped.btsBoarded) {
      ped.btsBoarded = false;
      ped.btsApproach = false;
      ped.mesh.visible = true;
      ped.mesh.position.set(ped.btsSlot.x, ped.btsSlot.y, ped.btsSlot.z);
      ped.heading = ped.btsSlot.facing;
      ped.mesh.rotation.y = ped.heading;
    }
  }
}

export function updateSeekShade(dt) {
  if (!GAMEPLAY.seekShade) return;
  const h = ((G.time.dayT % 1) + 1) % 1 * 24;
  const dry = (G.time.rainStrength || 0) < 0.22;
  const hot = dry && ((h >= 11 && h < 16) || (GAMEPLAY.burningHaze && G.time.weather === 'haze'));
  if (!hot) {
    if (G._shadeOn) {
      for (const ped of G.peds) {
        if (ped && ped.shade) { ped.shade = null; if (ped.state === 'shade') ped.state = 'walking'; }
      }
      G._shadeOn = false;
    }
    return;
  }
  G._shadeOn = true;
  G._shadeT = (G._shadeT || 0) + dt;
  if (G._shadeT < 0.45) return;
  G._shadeT = 0;
  let n = 0;
  for (const ped of G.peds) {
    if (n >= 22) break;
    if (!ped || ped.dead || ped.anchor || ped.gang || ped.pillion || ped.alms || ped.school || ped.btsWait || ped.commute || ped.crossingGuard || ped.checkpoint || ped.btsSit || ped.sevenGuard || ped.mallGuard || ped.bankGuard || ped.mallDir || ped.gunClerk || ped.starterClerk || ped.officeSmoke || ped.bankQueue || ped.mallFood || ped.mallTech || ped.mallPharm || ped.mallRoma || ped.mallWatch || ped.mallManga || ped.mallSushi || ped.mallCafe || ped.mallThreads || ped.mallSeven || ped.mallArcade || ped.gymBag || ped.homeAuntie || ped.stationPorter || ped.garageMech || ped.klongDock || ped.sengClerk || ped.airportCrew || ped.airportCargo || ped.airportTower || ped.airportTaxi || ped.soiDrink || ped.soiMechanic || ped.cowboy || ped.boatNoodle || ped.pierWait || ped.somTam || ped.btsMalai || ped.cowboyClose || ped.plaKat || ped.chaYen || ped.roti || ped.mango || ped.phromFruit || ped.kanom || ped.squid || ped.songthaewRide || ped.watSweep || ped.yaoGold || ped.yaoDuck || ped.yaoFortune || ped.sevenAtm || ped.btsBusker || ped.watLotus || ped.watAmulet || ped.watDrum || ped.sevenShop || ped.sevenSlush || ped.btsPaper || ped.btsShine || ped.soiBarber || ped.yaoPhoto || ped.panicT > 0) continue;
    if (ped.social || ped.isMugger || ped.isTarget || ped.motosaiRider || ped.motosaiWait) continue;
    const w = nearestWalkway(ped.mesh.position.x, ped.mesh.position.z);
    if (!w) continue;
    ped.shade = { x: clamp(ped.mesh.position.x, w.x0, w.x1), z: clamp(ped.mesh.position.z, w.z0, w.z1) };
    n++;
  }
}

export function updateWatBell(dt) {
  if (!GAMEPLAY.watBell || !G.watBell) return;
  const b = G.watBell;
  if (b.ringT > 0) {
    b.ringT = Math.max(0, b.ringT - dt);
    const swing = Math.sin(b.ringT * 14) * Math.min(1, b.ringT) * 0.28;
    if (b.bell) b.bell.rotation.z = swing;
    if (b.striker) b.striker.rotation.z = 0.35 - swing * 0.8;
  } else {
    if (b.bell) b.bell.rotation.z = 0;
    if (b.striker) b.striker.rotation.z = 0.35;
  }
  if (G.player.inVehicle || G._eating || G._barberCut) return;
  const pp = G.player.group.position;
  if (dist2({ x: b.x, z: b.z }, pp) > 2.8 * 2.8) return;
  G.hud.showPrompt('Press <b>E</b> to ring the bell', 0.4);
  if (!G.input.pressed('KeyE')) return;
  const now = (typeof performance !== 'undefined' && performance.now) ? performance.now() : 0;
  if (b.readyAt && now < b.readyAt) { G.hud.showNotif('The bell is still ringing'); return; }
  b.readyAt = now + 9000;
  b.ringT = 1.8;
  G._bellRung = (G._bellRung || 0) + 1;
  G.wanted.lastSeenAt = Math.max(0, (G.wanted.lastSeenAt || now) - 12000);
  G.hud.showNotif('The bell carries — ระฆังวัด');
  if (G.audio && G.audio.bell) G.audio.bell();
  else if (G.audio && G.audio.chime) G.audio.chime();
}

export function updateWatDrum(dt) {
  if (!GAMEPLAY.watDrum || !G.watDrum) return;
  const c = G.watDrum;
  c.t = (c.t || 0) + dt;
  const h = ((G.time.dayT % 1) + 1) % 1 * 24;
  const shift = (h >= 6 && h < 8.5) || (h >= 17 && h < 19.5);
  if (c.beatT > 0) {
    c.beatT = Math.max(0, c.beatT - dt);
    const swing = Math.sin(c.beatT * 12) * Math.min(1, c.beatT) * 0.45;
    if (c.beater) c.beater.rotation.z = 0.55 - swing;
    if (c.drum) c.drum.rotation.x = swing * 0.12;
  } else {
    if (c.beater) c.beater.rotation.z = 0.55;
    if (c.drum) c.drum.rotation.x = 0;
    if (shift && Math.sin(c.t * 2.2) > 0.92) c.beatT = 0.55;
  }
  const ped = c.monk;
  if (ped && ped.mesh) {
    ped.watDrum = true;
    ped.mesh.visible = shift;
    const slot = ped.anchor && ped.anchor.slot;
    if (slot) {
      ped.mesh.position.set(slot.x, 0, slot.z);
      ped.heading = ped.anchor.facing;
      ped.mesh.rotation.y = ped.heading;
    }
    ped.speed = 0;
    ped.state = 'idle';
  }
  if (G.player.inVehicle || G._eating || G._barberCut) return;
  const pp = G.player.group.position;
  if (dist2({ x: c.x, z: c.z }, pp) > 2.8 * 2.8) return;
  G.hud.showPrompt('Press <b>E</b> to beat the drum', 0.4);
  if (!G.input.pressed('KeyE')) return;
  const now = (typeof performance !== 'undefined' && performance.now) ? performance.now() : 0;
  if (c.readyAt && now < c.readyAt) { G.hud.showNotif('The drum is still sounding'); return; }
  c.readyAt = now + 8000;
  c.beatT = 1.4;
  G._watDrum = (G._watDrum || 0) + 1;
  G.wanted.lastSeenAt = Math.max(0, (G.wanted.lastSeenAt || now) - 10000);
  G.hud.showNotif('The drum carries — กลองวัด');
  if (G.audio && G.audio.chime) G.audio.chime();
}

export function updateBikeSeatCover(dt) {
  if (!GAMEPLAY.bikeSeatCover) return;
  const wet = (G.time.rainStrength || 0) > 0.4;
  for (const bike of [...(G.sevenBikes || []), ...(G.southSevenBikes || []), ...(G.westSevenBikes || []), ...(G.eastSevenBikes || [])]) {
    const cover = bike && (bike.seatCover || (bike.mesh && bike.mesh.getObjectByName('seat-cover')));
    if (!cover) continue;
    cover.visible = !!(wet && bike.driver !== 'player' && !bike.dead);
  }
}

export function updateRainPoncho(dt) {
  if (!GAMEPLAY.rainPoncho) return;
  const wet = (G.time.rainStrength || 0) > 0.4;
  for (const v of G.vehicles || []) {
    if (!v || v.dead || !v.spec || v.spec.kind !== 'bike') continue;
    const cape = v.bikeRider && v.bikeRider.getObjectByName('rain-poncho');
    if (cape) cape.visible = !!(wet && v.bikeRider.visible);
    const p = v.pillionPed;
    const pc = p && p.mesh && p.mesh.getObjectByName('rain-poncho');
    if (pc) pc.visible = wet;
  }
}

export function updateRainPack(dt) {
  if (!GAMEPLAY.rainPack) return;
  const fs = G.world && G.world.foodStalls;
  if (!fs) return;
  const wet = (G.time.rainStrength || 0) > 0.45;
  for (const f of fs) {
    if (wet && !f.packed) {
      f.packed = true;
      const parasol = f.mesh && f.mesh.getObjectByName('parasol');
      if (parasol) parasol.rotation.x = 1.15;
      if (f.mesh) f.mesh.traverse(o => { if (o.name === 'stool') o.visible = false; });
    } else if (!wet && f.packed) {
      f.packed = false;
      const parasol = f.mesh && f.mesh.getObjectByName('parasol');
      if (parasol) parasol.rotation.x = 0;
      if (f.mesh) f.mesh.traverse(o => { if (o.name === 'stool') o.visible = true; });
    }
  }
}

export function updateBoatNoodle(dt) {
  if (!GAMEPLAY.boatNoodle || !G.boatNoodle) return;
  const c = G.boatNoodle;
  if (!c.mesh) return;
  c.t += (c.dir || 1) * dt * 0.018;
  if (c.t > 0.85) { c.t = 0.85; c.dir = -1; }
  if (c.t < 0.15) { c.t = 0.15; c.dir = 1; }
  const z = (c.z0 || -50) + (c.t - 0.5) * 18;
  const x = c.x;
  const swell = 0.22 + Math.sin(performance.now() * 0.002 + z * 0.15) * 0.05;
  c.mesh.position.set(x, swell, z);
  c.mesh.rotation.y = (c.dir || 1) > 0 ? 0 : PI;
  c.mesh.rotation.z = Math.sin(performance.now() * 0.0016 + z * 0.1) * 0.03;
  const steam = c.mesh.getObjectByName('noodle-steam');
  if (steam) {
    steam.position.y = 1.05 + Math.sin(performance.now() * 0.003) * 0.08;
    steam.scale.setScalar(0.9 + Math.sin(performance.now() * 0.002) * 0.12);
  }
  const pot = c.mesh.getObjectByName('noodle-pot');
  if (pot && pot.material) pot.material.emissiveIntensity = 0.2 + Math.sin(performance.now() * 0.004) * 0.08;
  if (c.vendor && c.vendor.mesh && !c.vendor.dead) {
    c.vendor.boatNoodle = true;
    c.vendor.mesh.position.set(x, swell + 0.2, z);
    c.vendor.heading = c.mesh.rotation.y;
    c.vendor.mesh.rotation.y = c.vendor.heading;
    c.vendor.speed = 0;
    if (c.vendor.anchor && c.vendor.anchor.slot) c.vendor.anchor.slot.set(x, swell + 0.2, z);
  }
  if (G.player.inVehicle || G._eating) return;
  const pp = G.player.group.position;
  if (dist2(c.mesh.position, pp) > 3.6 * 3.6) return;
  G.hud.showPrompt('Press <b>E</b> for boat noodles · ฿50', 0.4);
  if (!G.input.pressed('KeyE')) return;
  if (G.cash < 50) { G.hud.showNotif('Need ฿50 for boat noodles'); return; }
  G.cash -= 50;
  G.player.hp = Math.min(G.player.hpMax, G.player.hp + 28);
  if (G.hud.setCash) G.hud.setCash(G.cash);
  G.hud.showNotif('Boat noodles — ก๋วยเตี๋ยวเรือ');
  if (G.audio && G.audio.chime) G.audio.chime();
}

export function updatePierWait(dt) {
  if (!GAMEPLAY.pierWait || !G.pierWait) return;
  const c = G.pierWait;
  c.t = (c.t || 0) + dt;
  const h = ((G.time.dayT % 1) + 1) % 1 * 24;
  const open = h >= 6 && h < 21;
  const ring = c.mesh && c.mesh.getObjectByName('pier-ring');
  if (ring) ring.rotation.z = Math.sin(c.t * 1.8) * 0.12;
  for (let i = 0; i < (c.waiters || []).length; i++) {
    const ped = c.waiters[i];
    if (!ped || ped.dead || !ped.mesh) continue;
    ped.pierWait = true;
    ped.mesh.visible = open;
    const slot = ped.anchor && ped.anchor.slot;
    if (slot) {
      ped.mesh.position.set(slot.x, 0, slot.z + Math.sin(c.t * 2.2 + i) * 0.08);
      ped.heading = ped.anchor.facing;
      ped.mesh.rotation.y = ped.heading;
    }
    ped.speed = 0;
    ped.state = 'idle';
  }
  if (!open || G.player.inVehicle || G._eating) return;
  const pp = G.player.group.position;
  if (!c.mesh || dist2(c.mesh.position, pp) > 2.4 * 2.4) return;
  G.hud.showPrompt('Press <b>E</b> for an express boat · ฿15', 0.4);
  if (!G.input.pressed('KeyE')) return;
  if (G.cash < 15) { G.hud.showNotif('Need ฿15 for the boat'); return; }
  G.cash -= 15;
  if (G.hud.setCash) G.hud.setCash(G.cash);
  G._pierWait = (G._pierWait || 0) + 1;
  G.hud.showNotif('Express boat — เรือด่วน');
  if (G.audio && G.audio.chime) G.audio.chime();
}

export function updateRotiCart(dt) {
  if (!GAMEPLAY.rotiCart || !G.rotiCart) return;
  for (const c of G.rotiCart) {
    if (!c.mesh || !c.soi) continue;
    c.t += c.dir * dt * 0.034;
    if (c.t > 0.9) { c.t = 0.9; c.dir = -1; }
    if (c.t < 0.1) { c.t = 0.1; c.dir = 1; }
    const s = c.soi;
    const x = c.alongZ ? (s.x0 + s.x1) * 0.5 : s.x0 + (s.x1 - s.x0) * c.t;
    const z = c.alongZ ? s.z0 + (s.z1 - s.z0) * c.t : (s.z0 + s.z1) * 0.5;
    const yaw = c.alongZ ? (c.dir > 0 ? 0 : PI) : (c.dir > 0 ? PI / 2 : -PI / 2);
    c.mesh.position.set(x, 0, z);
    c.mesh.rotation.y = yaw;
    const spat = c.mesh.getObjectByName('roti-spatula');
    if (spat) {
      const flip = Math.sin(c.t * 36);
      spat.rotation.z = 0.2 + flip * 0.55;
      spat.position.y = 0.86 + Math.max(0, flip) * 0.12;
    }
    const pan = c.mesh.getObjectByName('roti-pan');
    if (pan && pan.material) pan.material.emissiveIntensity = 0.18 + Math.sin(c.t * 14) * 0.08;
    if (c.vendor && c.vendor.mesh && !c.vendor.dead) {
      c.vendor.roti = true;
      c.vendor.mesh.position.set(x, 0, z);
      c.vendor.heading = yaw;
      c.vendor.mesh.rotation.y = yaw;
      if (c.vendor.anchor && c.vendor.anchor.slot) c.vendor.anchor.slot.set(x, 0, z);
      c.vendor.speed = 0.5;
    }
  }
  if (G.player.inVehicle || G._eating) return;
  const pp = G.player.group.position;
  for (const c of G.rotiCart) {
    if (!c.mesh || dist2(c.mesh.position, pp) > 2.2 * 2.2) continue;
    G.hud.showPrompt('Press <b>E</b> for banana roti · ฿35', 0.4);
    if (G.input.pressed('KeyE')) {
      if (G.cash < 35) { G.hud.showNotif('Need ฿35 for roti'); return; }
      G.cash -= 35;
      G.player.hp = Math.min(G.player.hpMax, G.player.hp + 20);
      G.player.stam = G.player.stamMax;
      if (G.hud.setCash) G.hud.setCash(G.cash);
      G.hud.showNotif('Roti — โรตี');
      if (G.audio && G.audio.chime) G.audio.chime();
    }
    return;
  }
}

export function updateChaYen(dt) {
  if (!GAMEPLAY.chaYen || !G.chaYen) return;
  for (const c of G.chaYen) {
    if (!c.mesh || !c.soi) continue;
    c.t += c.dir * dt * 0.033;
    if (c.t > 0.9) { c.t = 0.9; c.dir = -1; }
    if (c.t < 0.1) { c.t = 0.1; c.dir = 1; }
    const s = c.soi;
    const x = c.alongZ ? (s.x0 + s.x1) * 0.5 : s.x0 + (s.x1 - s.x0) * c.t;
    const z = c.alongZ ? s.z0 + (s.z1 - s.z0) * c.t : (s.z0 + s.z1) * 0.5;
    const yaw = c.alongZ ? (c.dir > 0 ? 0 : PI) : (c.dir > 0 ? PI / 2 : -PI / 2);
    c.mesh.position.set(x, 0, z);
    c.mesh.rotation.y = yaw;
    const urn = c.mesh.getObjectByName('chayen-urn');
    if (urn && urn.material) urn.material.emissiveIntensity = 0.14 + Math.sin(c.t * 18) * 0.06;
    if (c.vendor && c.vendor.mesh && !c.vendor.dead) {
      c.vendor.chaYen = true;
      c.vendor.mesh.position.set(x, 0, z);
      c.vendor.heading = yaw;
      c.vendor.mesh.rotation.y = yaw;
      if (c.vendor.anchor && c.vendor.anchor.slot) c.vendor.anchor.slot.set(x, 0, z);
      c.vendor.speed = 0.5;
    }
  }
  if (G.player.inVehicle || G._eating) return;
  const pp = G.player.group.position;
  for (const c of G.chaYen) {
    if (!c.mesh || dist2(c.mesh.position, pp) > 2.2 * 2.2) continue;
    G.hud.showPrompt('Press <b>E</b> for cha yen · ฿25', 0.4);
    if (G.input.pressed('KeyE')) {
      if (G.cash < 25) { G.hud.showNotif('Need ฿25 for cha yen'); return; }
      G.cash -= 25;
      G.player.stam = G.player.stamMax;
      if (G.hud.setCash) G.hud.setCash(G.cash);
      G.hud.showNotif('Cha yen — ชาเย็น');
      if (G.audio && G.audio.chime) G.audio.chime();
    }
    return;
  }
}

export function updateCoconutCarts(dt) {
  if (!GAMEPLAY.coconutCart || !G.coconutCarts) return;
  for (const c of G.coconutCarts) {
    if (!c.mesh || !c.soi) continue;
    c.t += c.dir * dt * 0.04;
    if (c.t > 0.9) { c.t = 0.9; c.dir = -1; }
    if (c.t < 0.1) { c.t = 0.1; c.dir = 1; }
    const s = c.soi;
    const x = c.alongZ ? (s.x0 + s.x1) * 0.5 : s.x0 + (s.x1 - s.x0) * c.t;
    const z = c.alongZ ? s.z0 + (s.z1 - s.z0) * c.t : (s.z0 + s.z1) * 0.5;
    const yaw = c.alongZ ? (c.dir > 0 ? 0 : PI) : (c.dir > 0 ? PI / 2 : -PI / 2);
    c.mesh.position.set(x, 0, z);
    c.mesh.rotation.y = yaw;
    if (c.vendor && c.vendor.mesh && !c.vendor.dead) {
      c.vendor.coconutCart = true;
      c.vendor.mesh.position.set(x, 0, z);
      c.vendor.heading = yaw;
      c.vendor.mesh.rotation.y = yaw;
      if (c.vendor.anchor && c.vendor.anchor.slot) c.vendor.anchor.slot.set(x, 0, z);
      c.vendor.speed = 0.55;
    }
  }
  if (G.player.inVehicle || G._eating) return;
  const pp = G.player.group.position;
  for (const c of G.coconutCarts) {
    if (!c.mesh || dist2(c.mesh.position, pp) > 2.2 * 2.2) continue;
    G.hud.showPrompt('Press <b>E</b> for coconut water · ฿30', 0.4);
    if (G.input.pressed('KeyE')) {
      if (G.cash < 30) { G.hud.showNotif('Need ฿30 for a coconut'); return; }
      G.cash -= 30;
      G.player.hp = Math.min(G.player.hpMax, G.player.hp + 25);
      G.player.stam = G.player.stamMax;
      if (G.hud.setCash) G.hud.setCash(G.cash);
      G.hud.showNotif('Coconut water — มะพร้าว');
      if (G.audio && G.audio.chime) G.audio.chime();
    }
    return;
  }
}

export function updatePlaKat(dt) {
  if (!GAMEPLAY.plaKat || !G.plaKat) return;
  const stand = G.plaKat;
  stand.t = (stand.t || 0) + dt;
  const t = stand.t * 3;
  if (stand.bags) {
    for (let i = 0; i < stand.bags.length; i++) {
      const bag = stand.bags[i];
      if (!bag) continue;
      bag.position.y = 1.72 + Math.sin(t + i * 0.9) * 0.04;
      const fish = bag.getObjectByName('plakat-fish');
      if (fish) {
        fish.position.x = Math.sin(t * 1.4 + i) * 0.03;
        fish.position.z = Math.cos(t * 1.1 + i * 0.7) * 0.025;
      }
    }
  }
  const ped = stand.vendor;
  if (ped && ped.mesh && ped.anchor && ped.anchor.slot) {
    ped.plaKat = true;
    ped.mesh.position.set(ped.anchor.slot.x, 0, ped.anchor.slot.z);
    ped.heading = ped.anchor.facing;
    ped.mesh.rotation.y = ped.heading;
    ped.speed = 0;
    ped.state = 'idle';
  }
  if (G.player.inVehicle || G._eating) return;
  const pp = G.player.group.position;
  if (!stand.mesh || dist2(stand.mesh.position, pp) > 2.4 * 2.4) return;
  G.hud.showPrompt('Press <b>E</b> for a fighting fish · ฿40', 0.4);
  if (!G.input.pressed('KeyE')) return;
  if (G.cash < 40) { G.hud.showNotif('Need ฿40 for a pla kat'); return; }
  G.cash -= 40;
  G._plaKat = (G._plaKat || 0) + 1;
  if (G.hud.setCash) G.hud.setCash(G.cash);
  G.hud.showNotif('Pla kat — ปลากัด');
  if (G.audio && G.audio.chime) G.audio.chime();
}

export function updateSongthaewRiders(dt) {
  if (!GAMEPLAY.songthaewRiders) return;
  const stands = [G.world && G.world.btsSongthaew, G.world && G.world.phromSongthaew];
  for (const stand of stands) {
    if (!stand || !stand.vehicle) continue;
    const v = stand.vehicle;
    const riders = stand.riders || [];
    if (v.driver === 'player') {
      if (!stand._dumped) {
        for (const ped of riders) {
          if (!ped || ped.dead || !ped.mesh) continue;
          const wp = ped.mesh.getWorldPosition(new THREE.Vector3());
          if (ped.mesh.parent) ped.mesh.parent.remove(ped.mesh);
          G.scene.add(ped.mesh);
          // hop to the curb on the BTS side of the rank, not along the chassis
          const side = 1.7;
          ped.mesh.position.set(wp.x - Math.cos(v.heading) * side, 0, wp.z + Math.sin(v.heading) * side);
          ped.mesh.rotation.set(0, v.heading + PI / 2, 0);
          ped.songthaewRide = false;
          ped.heading = v.heading + PI / 2;
          ped.speed = 1.2;
          ped.state = 'walking';
        }
        stand._dumped = true;
        if (G.hud) G.hud.showNotif('Passengers hop off');
      }
      continue;
    }
    if (stand._dumped) continue;
    for (const ped of riders) {
      if (!ped || ped.dead || !ped.mesh) continue;
      ped.songthaewRide = true;
      ped.speed = 0;
      ped.state = 'idle';
    }
  }
}

export function updateBtsPaper(dt) {
  if (!GAMEPLAY.btsPaper) return;
  const racks = [G.btsPaper, G.phromPaper];
  const h = ((G.time.dayT % 1) + 1) % 1 * 24;
  const open = h >= 6 && h < 18;
  const pp = G.player && G.player.group && G.player.group.position;
  for (const c of racks) {
    if (!c) continue;
    c.t = (c.t || 0) + dt;
    const papers = c.mesh ? c.mesh.children.filter(ch => ch && ch.name === 'bts-paper') : [];
    for (let i = 0; i < papers.length; i++) {
      papers[i].rotation.z = Math.sin(c.t * 2.6 + i) * 0.08;
    }
    const ped = c.vendor;
    if (ped && ped.mesh) {
      ped.btsPaper = true;
      ped.mesh.visible = open;
      const slot = ped.anchor && ped.anchor.slot;
      if (slot) {
        ped.mesh.position.set(slot.x, 0, slot.z);
        ped.heading = ped.anchor.facing;
        ped.mesh.rotation.y = ped.heading;
      }
      ped.speed = 0;
      ped.state = 'idle';
    }
    if (!open || G.player.inVehicle || G._eating || !pp) continue;
    if (!c.mesh || dist2(c.mesh.position, pp) > 2.4 * 2.4) continue;
    G.hud.showPrompt('Press <b>E</b> for a paper · ฿15', 0.4);
    if (!G.input.pressed('KeyE')) continue;
    if (G.cash < 15) { G.hud.showNotif('Need ฿15 for a paper'); continue; }
    G.cash -= 15;
    G._btsPaper = (G._btsPaper || 0) + 1;
    if (G.hud.setCash) G.hud.setCash(G.cash);
    G.hud.showNotif('Thai Rath — ไทยรัฐ');
    if (G.audio && G.audio.chime) G.audio.chime();
  }
}

export function updateBtsShine(dt) {
  if (!GAMEPLAY.btsShine) return;
  const stands = [G.btsShine, G.phromShine];
  const h = ((G.time.dayT % 1) + 1) % 1 * 24;
  const open = h >= 8 && h < 18;
  const pp = G.player && G.player.group && G.player.group.position;
  for (const c of stands) {
    if (!c) continue;
    c.t = (c.t || 0) + dt;
    const cloth = c.mesh && c.mesh.getObjectByName('shine-cloth');
    if (cloth) {
      cloth.rotation.z = open ? Math.sin(c.t * 9) * 0.45 : 0;
      cloth.position.y = 0.42 + (open ? Math.abs(Math.sin(c.t * 9)) * 0.04 : 0);
    }
    const ped = c.vendor;
    if (ped && ped.mesh) {
      ped.btsShine = true;
      ped.mesh.visible = open;
      const slot = ped.anchor && ped.anchor.slot;
      if (slot) {
        ped.mesh.position.set(slot.x, slot.y || 0.38, slot.z);
        ped.heading = ped.anchor.facing;
        ped.mesh.rotation.y = ped.heading;
      }
      ped.speed = 0;
      ped.state = 'idle';
    }
    if (!open || G.player.inVehicle || G._eating || !pp) continue;
    if (!c.mesh || dist2(c.mesh.position, pp) > 2.4 * 2.4) continue;
    G.hud.showPrompt('Press <b>E</b> for a shoe shine · ฿30', 0.4);
    if (!G.input.pressed('KeyE')) continue;
    if (G.cash < 30) { G.hud.showNotif('Need ฿30 for a shine'); continue; }
    G.cash -= 30;
    if (G.hud.setCash) G.hud.setCash(G.cash);
    G._btsShine = (G._btsShine || 0) + 1;
    G.hud.showNotif('Shoe shine — ขัดรองเท้า');
    if (G.audio && G.audio.chime) G.audio.chime();
  }
}

export function updateBtsBusker(dt) {
  if (!GAMEPLAY.btsBusker) return;
  const stands = [G.btsBusker, G.phromBusker];
  const h = ((G.time.dayT % 1) + 1) % 1 * 24;
  const open = h >= 16 && h < 21.5;
  const pp = G.player && G.player.group && G.player.group.position;
  for (const c of stands) {
    if (!c) continue;
    c.t = (c.t || 0) + dt;
    const ped = c.ped;
    if (ped && ped.mesh) {
      ped.btsBusker = true;
      ped.mesh.visible = open;
      if (c.hat) c.hat.visible = open;
      const slot = ped.anchor && ped.anchor.slot;
      if (slot) {
        ped.mesh.position.set(slot.x, 0, slot.z);
        ped.heading = ped.anchor.facing;
        ped.mesh.rotation.y = ped.heading;
      }
      ped.speed = 0;
      ped.state = 'idle';
      const parts = ped.mesh.userData && ped.mesh.userData.parts;
      if (open && parts && parts.armR) parts.armR.rotation.x = -0.35 + Math.sin(c.t * 10) * 0.45;
      if (open && c.guitar) c.guitar.rotation.z = 0.9 + Math.sin(c.t * 10) * 0.18;
    }
    if (!open || G.player.inVehicle || G._eating || !pp) continue;
    if (dist2({ x: c.x, z: c.z }, pp) > 2.4 * 2.4) continue;
    G.hud.showPrompt('Press <b>E</b> to tip the busker · ฿20', 0.4);
    if (!G.input.pressed('KeyE')) continue;
    if (G.cash < 20) { G.hud.showNotif('Need ฿20 for a tip'); continue; }
    G.cash -= 20;
    if (G.hud.setCash) G.hud.setCash(G.cash);
    G._btsBusker = (G._btsBusker || 0) + 1;
    G.hud.showNotif('The busker nods — ขอบคุณ');
    if (G.audio && G.audio.chime) G.audio.chime();
  }
}

export function updateSevenShoppers(dt) {
  if (!GAMEPLAY.sevenShoppers) return;
  const h = ((G.time.dayT % 1) + 1) % 1 * 24;
  const open = h >= 7 && h < 22;
  for (const rec of [G.sevenShoppers, G.southSevenShoppers, G.westSevenShoppers, G.eastSevenShoppers]) {
    if (!rec) continue;
    for (const ped of rec.shoppers || []) {
      if (!ped || ped.dead || !ped.mesh) continue;
      ped.sevenShop = true;
      ped.mesh.visible = open;
      if (!open) {
        ped.speed = 0;
        ped.state = 'idle';
        continue;
      }
      ped._shopT = (ped._shopT || 0) + dt * 0.16 * (ped._shopDir || 1);
      if (ped._shopT > 1) { ped._shopT = 1; ped._shopDir = -1; }
      if (ped._shopT < 0) { ped._shopT = 0; ped._shopDir = 1; }
      const t = ped._shopT;
      const z = rec.curbZ + (rec.doorZ - rec.curbZ) * t;
      ped.mesh.position.set(ped._shopX != null ? ped._shopX : rec.x, 0, z);
      ped.heading = (ped._shopDir || 1) > 0 ? PI : 0;
      ped.mesh.rotation.y = ped.heading;
      ped.speed = 1.15;
      ped.state = 'walking';
      animateWalk(ped.mesh, ped.speed, dt, true);
      const bag = ped._sevenBag || ped.mesh.getObjectByName('seven-bag');
      if (bag) bag.visible = (ped._shopDir || 1) < 0;
    }
  }
}

export function updateSevenSlush(dt) {
  if (!GAMEPLAY.sevenSlush || !G.sevenSlush) return;
  const c = G.sevenSlush;
  c.t = (c.t || 0) + dt;
  const h = ((G.time.dayT % 1) + 1) % 1 * 24;
  const open = h >= 6 && h < 22;
  const tanks = c.mesh ? c.mesh.children.filter(ch => ch && ch.name === 'seven-slush-tank') : [];
  for (let i = 0; i < tanks.length; i++) {
    tanks[i].rotation.y = c.t * 2.8 + i;
    if (tanks[i].material) tanks[i].material.emissiveIntensity = open ? 0.28 + Math.sin(c.t * 3.2 + i) * 0.1 : 0.08;
  }
  const ped = c.customer;
  if (ped && ped.mesh) {
    ped.sevenSlush = true;
    ped.mesh.visible = open;
    const slot = ped.anchor && ped.anchor.slot;
    if (slot) {
      ped.mesh.position.set(slot.x, 0, slot.z);
      ped.heading = ped.anchor.facing;
      ped.mesh.rotation.y = ped.heading;
    }
    ped.speed = 0;
    ped.state = 'idle';
  }
  if (!open || G.player.inVehicle || G._eating) return;
  const pp = G.player.group.position;
  if (!c.mesh || dist2(c.mesh.position, pp) > 2.4 * 2.4) return;
  G.hud.showPrompt('Press <b>E</b> for a slushie · ฿25', 0.4);
  if (!G.input.pressed('KeyE')) return;
  if (G.cash < 25) { G.hud.showNotif('Need ฿25 for a slushie'); return; }
  G.cash -= 25;
  G.player.stam = G.player.stamMax;
  if (G.hud.setCash) G.hud.setCash(G.cash);
  G._sevenSlush = (G._sevenSlush || 0) + 1;
  G.hud.showNotif('Slushie — สเลอปี้');
  if (G.audio && G.audio.chime) G.audio.chime();
}

export function updateSevenAtm(dt) {
  if (!GAMEPLAY.sevenAtm) return;
  const h = ((G.time.dayT % 1) + 1) % 1 * 24;
  const open = h >= 6 && h < 22;
  for (const c of [G.sevenAtm, G.southSevenAtm, G.westSevenAtm, G.eastSevenAtm]) {
    if (!c) continue;
    c.t = (c.t || 0) + dt;
    for (let i = 0; i < (c.queue || []).length; i++) {
      const ped = c.queue[i];
      if (!ped || ped.dead || !ped.mesh) continue;
      ped.sevenAtm = true;
      ped.mesh.visible = open;
      if (!open) {
        ped.speed = 0;
        ped.state = 'idle';
        continue;
      }
      const slot = ped.anchor && ped.anchor.slot;
      if (slot) {
        const bob = i === 0 ? Math.sin(c.t * 2.4) * 0.06 : 0;
        ped.mesh.position.set(slot.x, 0, slot.z + bob);
        ped.heading = ped.anchor.facing;
        ped.mesh.rotation.y = ped.heading;
      }
      ped.speed = 0;
      ped.state = 'idle';
      const parts = ped.mesh.userData && ped.mesh.userData.parts;
      if (i === 0 && parts && parts.armR) parts.armR.rotation.x = -0.85 + Math.sin(c.t * 3.1) * 0.12;
    }
  }
}

export function updateYaoDuck(dt) {
  if (!GAMEPLAY.yaoDuck || !G.yaoDuck) return;
  const c = G.yaoDuck;
  c.t = (c.t || 0) + dt;
  const open = yaowaratNightOpen();
  if (c.duckMat) c.duckMat.emissiveIntensity = open ? 0.42 + Math.sin(c.t * 3.4) * 0.16 : 0.1;
  if (c.lampMat) c.lampMat.emissiveIntensity = open ? 0.7 + Math.sin(c.t * 2.6) * 0.18 : 0.12;
  if (c.signMat) c.signMat.emissiveIntensity = open ? 0.55 + Math.sin(c.t * 2.1) * 0.2 : 0.12;
  const ducks = c.mesh ? c.mesh.children.filter(ch => ch && ch.name === 'yao-duck-body') : [];
  for (let i = 0; i < ducks.length; i++) {
    ducks[i].rotation.z = Math.sin(c.t * 2.4 + i) * 0.12;
  }
  for (const ped of c.shoppers || []) {
    if (!ped || ped.dead || !ped.mesh) continue;
    ped.yaoDuck = true;
    ped.mesh.visible = open;
    ped.speed = 0;
    ped.state = 'idle';
    const slot = ped.anchor && ped.anchor.slot;
    if (slot) {
      ped.mesh.position.set(slot.x, 0, slot.z);
      ped.heading = ped.anchor.facing;
      ped.mesh.rotation.y = ped.heading;
    }
  }
  if (!open || G.player.inVehicle || G._eating) return;
  const pp = G.player.group.position;
  if (!c.mesh || dist2(c.mesh.position, pp) > 2.4 * 2.4) return;
  G.hud.showPrompt('Press <b>E</b> for roast duck · ฿80', 0.4);
  if (!G.input.pressed('KeyE')) return;
  if (G.cash < 80) { G.hud.showNotif('Need ฿80 for roast duck'); return; }
  G.cash -= 80;
  G.player.hp = Math.min(G.player.hpMax, G.player.hp + 26);
  if (G.hud.setCash) G.hud.setCash(G.cash);
  G._yaoDuck = (G._yaoDuck || 0) + 1;
  G.hud.showNotif('Roast duck — เป็ดย่าง');
  if (G.audio && G.audio.chime) G.audio.chime();
}

export function updateYaoFortune(dt) {
  if (!GAMEPLAY.yaoFortune || !G.yaoFortune) return;
  const c = G.yaoFortune;
  c.t = (c.t || 0) + dt;
  const open = yaowaratNightOpen();
  if (c.lampMat) c.lampMat.emissiveIntensity = open ? 0.65 + Math.sin(c.t * 3.1) * 0.2 : 0.1;
  const cards = c.mesh ? c.mesh.children.filter(ch => ch && ch.name === 'yao-card') : [];
  for (let i = 0; i < cards.length; i++) {
    cards[i].rotation.z = Math.sin(c.t * 3.6 + i) * 0.22;
  }
  const ped = c.vendor;
  if (ped && ped.mesh) {
    ped.yaoFortune = true;
    ped.mesh.visible = open;
    const slot = ped.anchor && ped.anchor.slot;
    if (slot) {
      ped.mesh.position.set(slot.x, 0, slot.z);
      ped.heading = ped.anchor.facing;
      ped.mesh.rotation.y = ped.heading;
    }
    ped.speed = 0;
    ped.state = 'idle';
  }
  if (!open || G.player.inVehicle || G._eating) return;
  const pp = G.player.group.position;
  if (!c.mesh || dist2(c.mesh.position, pp) > 2.4 * 2.4) return;
  G.hud.showPrompt('Press <b>E</b> for a reading · ฿60', 0.4);
  if (!G.input.pressed('KeyE')) return;
  if (G.cash < 60) { G.hud.showNotif('Need ฿60 for a reading'); return; }
  const now = (typeof performance !== 'undefined' && performance.now) ? performance.now() : 0;
  if (c.readyAt && now < c.readyAt) { G.hud.showNotif('The cards are still turning'); return; }
  c.readyAt = now + 8000;
  G.cash -= 60;
  G.wanted.lastSeenAt = Math.max(0, (G.wanted.lastSeenAt || now) - 10000);
  if (G.hud.setCash) G.hud.setCash(G.cash);
  G._yaoFortune = (G._yaoFortune || 0) + 1;
  G.hud.showNotif('The cards say luck — ดูดวง');
  if (G.audio && G.audio.chime) G.audio.chime();
}

export function updateYaoGold(dt) {
  if (!GAMEPLAY.yaoGold || !G.yaoGold) return;
  const c = G.yaoGold;
  c.t = (c.t || 0) + dt;
  const open = yaowaratNightOpen();
  if (c.goldMat) c.goldMat.emissiveIntensity = open ? 0.65 + Math.sin(c.t * 3.2) * 0.22 : 0.12;
  if (c.signMat) c.signMat.emissiveIntensity = open ? 0.55 + Math.sin(c.t * 2.1) * 0.2 : 0.12;
  for (const ped of c.shoppers || []) {
    if (!ped || ped.dead || !ped.mesh) continue;
    ped.yaoGold = true;
    ped.mesh.visible = open;
    ped.speed = 0;
    ped.state = 'idle';
    const slot = ped.anchor && ped.anchor.slot;
    if (slot) {
      ped.mesh.position.set(slot.x, 0, slot.z);
      ped.heading = ped.anchor.facing;
      ped.mesh.rotation.y = ped.heading;
    }
  }
}

export function updateSquidGrill(dt) {
  if (!GAMEPLAY.squidGrill || !G.squidGrill) return;
  const c = G.squidGrill;
  c.t = (c.t || 0) + dt;
  const open = yaowaratNightOpen();
  if (c.coalMat) c.coalMat.emissiveIntensity = open ? 0.7 + Math.sin(c.t * 9) * 0.25 : 0.12;
  const smoke = c.mesh && c.mesh.getObjectByName('squid-smoke');
  if (smoke && smoke.material) {
    smoke.visible = open;
    smoke.position.y = 1.12 + Math.sin(c.t * 3) * 0.06;
    smoke.material.opacity = open ? 0.16 + Math.sin(c.t * 2.4) * 0.08 : 0;
  }
  const sticks = c.mesh ? c.mesh.children.filter(ch => ch && ch.name === 'squid-stick') : [];
  for (let i = 0; i < sticks.length; i++) {
    sticks[i].rotation.z = Math.sin(c.t * 5 + i) * 0.08;
  }
  const ped = c.vendor;
  if (ped && ped.mesh && ped.anchor && ped.anchor.slot) {
    ped.squid = true;
    ped.mesh.visible = open;
    ped.mesh.position.set(ped.anchor.slot.x, 0, ped.anchor.slot.z);
    ped.heading = ped.anchor.facing;
    ped.mesh.rotation.y = ped.heading;
    ped.speed = 0;
    ped.state = 'idle';
  }
  if (!open || G.player.inVehicle || G._eating) return;
  const pp = G.player.group.position;
  if (!c.mesh || dist2(c.mesh.position, pp) > 2.4 * 2.4) return;
  G.hud.showPrompt('Press <b>E</b> for grilled squid · ฿50', 0.4);
  if (!G.input.pressed('KeyE')) return;
  if (G.cash < 50) { G.hud.showNotif('Need ฿50 for squid'); return; }
  G.cash -= 50;
  G.player.hp = Math.min(G.player.hpMax, G.player.hp + 22);
  if (G.hud.setCash) G.hud.setCash(G.cash);
  G._squidGrill = (G._squidGrill || 0) + 1;
  G.hud.showNotif('Grilled squid — ปลาหมึกย่าง');
  if (G.audio && G.audio.chime) G.audio.chime();
}

export function updateKanomKrok(dt) {
  if (!GAMEPLAY.kanomKrok) return;
  const h = ((G.time.dayT % 1) + 1) % 1 * 24;
  const open = h >= 15 && h < 21.5;
  const pp = G.player && G.player.group && G.player.group.position;
  for (const c of [G.kanomKrok, G.southKanomKrok, G.westKanomKrok, G.eastKanomKrok]) {
    if (!c) continue;
    c.t = (c.t || 0) + dt;
    const pan = c.mesh && c.mesh.getObjectByName('kanom-pan');
    if (pan && pan.material) pan.material.emissiveIntensity = open ? 0.22 + Math.sin(c.t * 10) * 0.1 : 0.06;
    const ladle = c.mesh && c.mesh.getObjectByName('kanom-ladle');
    if (ladle) {
      const scoop = Math.sin(c.t * 28);
      ladle.rotation.z = 0.15 + scoop * 0.45;
      ladle.position.y = 0.88 + Math.max(0, scoop) * 0.08;
    }
    const ped = c.vendor;
    if (ped && ped.mesh && ped.anchor && ped.anchor.slot) {
      ped.kanom = true;
      ped.mesh.visible = open;
      ped.mesh.position.set(ped.anchor.slot.x, 0, ped.anchor.slot.z);
      ped.heading = ped.anchor.facing;
      ped.mesh.rotation.y = ped.heading;
      ped.speed = 0;
      ped.state = 'idle';
    }
    if (!open || G.player.inVehicle || G._eating || !pp) continue;
    if (!c.mesh || dist2(c.mesh.position, pp) > 2.4 * 2.4) continue;
    G.hud.showPrompt('Press <b>E</b> for kanom krok · ฿25', 0.4);
    if (!G.input.pressed('KeyE')) continue;
    if (G.cash < 25) { G.hud.showNotif('Need ฿25 for kanom krok'); continue; }
    G.cash -= 25;
    G.player.hp = Math.min(G.player.hpMax, G.player.hp + 16);
    G.player.stam = G.player.stamMax;
    if (G.hud.setCash) G.hud.setCash(G.cash);
    G._kanomKrok = (G._kanomKrok || 0) + 1;
    G.hud.showNotif('Kanom krok — ขนมครก');
    if (G.audio && G.audio.chime) G.audio.chime();
  }
}

export function updateMangoSticky(dt) {
  if (!GAMEPLAY.mangoSticky) return;
  const carts = [G.mangoSticky, G.phromMango];
  const h = ((G.time.dayT % 1) + 1) % 1 * 24;
  const open = h >= 16 && h < 22.5;
  const pp = G.player && G.player.group && G.player.group.position;
  for (const c of carts) {
    if (!c) continue;
    c.t = (c.t || 0) + dt;
    const cream = c.mesh && c.mesh.getObjectByName('coconut-cream');
    if (cream && cream.material) cream.material.emissiveIntensity = open ? 0.18 + Math.sin(c.t * 8) * 0.08 : 0.04;
    if (c.mesh) c.mesh.visible = true;
    const ped = c.vendor;
    if (ped && ped.mesh && ped.anchor && ped.anchor.slot) {
      ped.mango = true;
      ped.mesh.visible = open;
      ped.mesh.position.set(ped.anchor.slot.x, 0, ped.anchor.slot.z);
      ped.heading = ped.anchor.facing;
      ped.mesh.rotation.y = ped.heading;
      ped.speed = 0;
      ped.state = 'idle';
    }
    if (!open || G.player.inVehicle || G._eating || !pp) continue;
    if (!c.mesh || dist2(c.mesh.position, pp) > 2.4 * 2.4) continue;
    G.hud.showPrompt('Press <b>E</b> for mango sticky rice · ฿60', 0.4);
    if (!G.input.pressed('KeyE')) continue;
    if (G.cash < 60) { G.hud.showNotif('Need ฿60 for mango sticky rice'); continue; }
    G.cash -= 60;
    G.player.hp = Math.min(G.player.hpMax, G.player.hp + 30);
    G.player.stam = G.player.stamMax;
    if (G.hud.setCash) G.hud.setCash(G.cash);
    G._mangoSticky = (G._mangoSticky || 0) + 1;
    G.hud.showNotif('Mango sticky rice — ข้าวเหนียวมะม่วง');
    if (G.audio && G.audio.chime) G.audio.chime();
  }
}

export function updatePhromFruit(dt) {
  if (!GAMEPLAY.phromFruit) return;
  const h = ((G.time.dayT % 1) + 1) % 1 * 24;
  const open = h >= 10 && h < 20;
  const pp = G.player && G.player.group && G.player.group.position;
  for (const c of [G.phromFruit, G.asokFruit]) {
    if (!c) continue;
    c.t = (c.t || 0) + dt;
    const blender = c.mesh && c.mesh.getObjectByName('phrom-blender');
    if (blender) {
      blender.rotation.y = open ? c.t * 8.5 : blender.rotation.y;
      if (blender.material) blender.material.emissiveIntensity = open ? 0.22 + Math.sin(c.t * 10) * 0.1 : 0.06;
    }
    const fruits = c.mesh ? c.mesh.children.filter(ch => ch && ch.name === 'phrom-fruit-piece') : [];
    for (let i = 0; i < fruits.length; i++) {
      fruits[i].position.y = 0.82 + (open ? Math.sin(c.t * 3.2 + i) * 0.02 : 0);
    }
    const ped = c.vendor;
    if (ped && ped.mesh && ped.anchor && ped.anchor.slot) {
      ped.phromFruit = true;
      ped.mesh.visible = open;
      ped.mesh.position.set(ped.anchor.slot.x, 0, ped.anchor.slot.z);
      ped.heading = ped.anchor.facing;
      ped.mesh.rotation.y = ped.heading;
      ped.speed = 0;
      ped.state = 'idle';
    }
    if (!open || G.player.inVehicle || G._eating || !pp) continue;
    if (!c.mesh || dist2(c.mesh.position, pp) > 2.4 * 2.4) continue;
    G.hud.showPrompt('Press <b>E</b> for a fruit smoothie · ฿40', 0.4);
    if (!G.input.pressed('KeyE')) continue;
    if (G.cash < 40) { G.hud.showNotif('Need ฿40 for a smoothie'); continue; }
    G.cash -= 40;
    G.player.hp = Math.min(G.player.hpMax, G.player.hp + 18);
    G.player.stam = G.player.stamMax;
    if (G.hud.setCash) G.hud.setCash(G.cash);
    G._phromFruit = (G._phromFruit || 0) + 1;
    G.hud.showNotif('Fruit smoothie — น้ำปั่น');
    if (G.audio && G.audio.chime) G.audio.chime();
  }
}

export function updateBtsMalai(dt) {
  if (!GAMEPLAY.btsMalai) return;
  const stands = [G.btsMalai, G.phromMalai];
  const pp = G.player && G.player.group && G.player.group.position;
  for (const stand of stands) {
    if (!stand) continue;
    stand.t = (stand.t || 0) + dt;
    const strands = stand.mesh ? stand.mesh.children.filter(ch => ch && ch.name === 'malai-strand') : [];
    for (let i = 0; i < strands.length; i++) {
      strands[i].rotation.z = Math.sin(stand.t * 2.8 + i) * 0.12;
    }
    const ped = stand.vendor;
    if (ped && ped.mesh && ped.anchor && ped.anchor.slot) {
      ped.btsMalai = true;
      ped.mesh.position.set(ped.anchor.slot.x, 0, ped.anchor.slot.z);
      ped.heading = ped.anchor.facing;
      ped.mesh.rotation.y = ped.heading;
      ped.speed = 0;
      ped.state = 'idle';
    }
    if (G.player.inVehicle || G._eating || !pp) continue;
    if (!stand.mesh || dist2(stand.mesh.position, pp) > 2.4 * 2.4) continue;
    if (G._malai) {
      G.hud.showPrompt('You already have a malai', 0.35);
      continue;
    }
    G.hud.showPrompt('Press <b>E</b> for a malai · ฿20', 0.4);
    if (!G.input.pressed('KeyE')) continue;
    if (G.cash < 20) { G.hud.showNotif('Need ฿20 for a malai'); continue; }
    G.cash -= 20;
    G._malai = true;
    if (G.hud.setCash) G.hud.setCash(G.cash);
    G.hud.showNotif('Phuang malai — พวงมาลัย');
    if (G.audio && G.audio.chime) G.audio.chime();
  }
}

export function updateSomTam(dt) {
  if (!GAMEPLAY.somTam || !G.somTam) return;
  for (const c of G.somTam) {
    if (!c.mesh || !c.soi) continue;
    c.t += c.dir * dt * 0.032;
    if (c.t > 0.9) { c.t = 0.9; c.dir = -1; }
    if (c.t < 0.1) { c.t = 0.1; c.dir = 1; }
    const s = c.soi;
    const x = c.alongZ ? (s.x0 + s.x1) * 0.5 : s.x0 + (s.x1 - s.x0) * c.t;
    const z = c.alongZ ? s.z0 + (s.z1 - s.z0) * c.t : (s.z0 + s.z1) * 0.5;
    const yaw = c.alongZ ? (c.dir > 0 ? 0 : PI) : (c.dir > 0 ? PI / 2 : -PI / 2);
    c.mesh.position.set(x, 0, z);
    c.mesh.rotation.y = yaw;
    const pestle = c.mesh.getObjectByName('somtam-pestle');
    if (pestle) {
      const pound = Math.sin(c.t * 42);
      pestle.position.y = 1.18 + Math.max(0, pound) * 0.12;
      pestle.rotation.z = 0.25 + pound * 0.2;
    }
    if (c.vendor && c.vendor.mesh && !c.vendor.dead) {
      c.vendor.somTam = true;
      c.vendor.mesh.position.set(x, 0, z);
      c.vendor.heading = yaw;
      c.vendor.mesh.rotation.y = yaw;
      if (c.vendor.anchor && c.vendor.anchor.slot) c.vendor.anchor.slot.set(x, 0, z);
      c.vendor.speed = 0.5;
    }
  }
  if (G.player.inVehicle || G._eating) return;
  const pp = G.player.group.position;
  for (const c of G.somTam) {
    if (!c.mesh || dist2(c.mesh.position, pp) > 2.2 * 2.2) continue;
    G.hud.showPrompt('Press <b>E</b> for som tam · ฿45', 0.4);
    if (G.input.pressed('KeyE')) {
      if (G.cash < 45) { G.hud.showNotif('Need ฿45 for som tam'); return; }
      G.cash -= 45;
      G.player.hp = Math.min(G.player.hpMax, G.player.hp + 24);
      if (G.hud.setCash) G.hud.setCash(G.cash);
      G.hud.showNotif('Som tam — ส้มตำ');
      if (G.audio && G.audio.chime) G.audio.chime();
    }
    return;
  }
}

export function updateMooPing(dt) {
  if (!GAMEPLAY.mooPing || !G.mooPing) return;
  const h = ((G.time.dayT % 1) + 1) % 1 * 24;
  const glow = (h >= 16 && h < 22) ? 1.15 : 0.5;
  for (const c of G.mooPing) {
    if (!c.mesh || !c.soi) continue;
    c.t += c.dir * dt * 0.038;
    if (c.t > 0.9) { c.t = 0.9; c.dir = -1; }
    if (c.t < 0.1) { c.t = 0.1; c.dir = 1; }
    const s = c.soi;
    const x = c.alongZ ? (s.x0 + s.x1) * 0.5 : s.x0 + (s.x1 - s.x0) * c.t;
    const z = c.alongZ ? s.z0 + (s.z1 - s.z0) * c.t : (s.z0 + s.z1) * 0.5;
    const yaw = c.alongZ ? (c.dir > 0 ? 0 : PI) : (c.dir > 0 ? PI / 2 : -PI / 2);
    c.mesh.position.set(x, 0, z);
    c.mesh.rotation.y = yaw;
    if (c.coalMat) c.coalMat.emissiveIntensity = glow;
    const puff = c.mesh.getObjectByName('mooping-smoke');
    if (puff) {
      puff.position.y = 1.15 + Math.sin(performance.now() * 0.003) * 0.08;
      puff.scale.setScalar(0.9 + Math.sin(performance.now() * 0.002) * 0.12);
    }
    if (c.vendor && c.vendor.mesh && !c.vendor.dead) {
      c.vendor.mooPing = true;
      c.vendor.mesh.position.set(x, 0, z);
      c.vendor.heading = yaw;
      c.vendor.mesh.rotation.y = yaw;
      if (c.vendor.anchor && c.vendor.anchor.slot) c.vendor.anchor.slot.set(x, 0, z);
      c.vendor.speed = 0.5;
    }
  }
  if (G.player.inVehicle || G._eating) return;
  const pp = G.player.group.position;
  for (const c of G.mooPing) {
    if (!c.mesh || dist2(c.mesh.position, pp) > 2.2 * 2.2) continue;
    G.hud.showPrompt('Press <b>E</b> for moo ping · ฿35', 0.4);
    if (G.input.pressed('KeyE')) {
      if (G.cash < 35) { G.hud.showNotif('Need ฿35 for moo ping'); return; }
      G.cash -= 35;
      G.player.hp = Math.min(G.player.hpMax, G.player.hp + 22);
      if (G.hud.setCash) G.hud.setCash(G.cash);
      G.hud.showNotif('Moo ping — หมูปิ้ง');
      if (G.audio && G.audio.chime) G.audio.chime();
    }
    return;
  }
}

export function updateIceCarts(dt) {
  if (!GAMEPLAY.iceCart || !G.iceCarts) return;
  for (const c of G.iceCarts) {
    if (!c.mesh || !c.soi) continue;
    c.t += c.dir * dt * 0.035;
    if (c.t > 0.9) { c.t = 0.9; c.dir = -1; }
    if (c.t < 0.1) { c.t = 0.1; c.dir = 1; }
    const s = c.soi;
    const x = c.alongZ ? (s.x0 + s.x1) * 0.5 : s.x0 + (s.x1 - s.x0) * c.t;
    const z = c.alongZ ? s.z0 + (s.z1 - s.z0) * c.t : (s.z0 + s.z1) * 0.5;
    const yaw = c.alongZ ? (c.dir > 0 ? 0 : PI) : (c.dir > 0 ? PI / 2 : -PI / 2);
    c.mesh.position.set(x, 0, z);
    c.mesh.rotation.y = yaw;
    if (c.vendor && c.vendor.mesh && !c.vendor.dead) {
      c.vendor.iceCart = true;
      c.vendor.mesh.position.set(x, 0, z);
      c.vendor.heading = yaw;
      c.vendor.mesh.rotation.y = yaw;
      if (c.vendor.anchor && c.vendor.anchor.slot) c.vendor.anchor.slot.set(x, 0, z);
      c.vendor.speed = 0.7;
    }
    c.ding -= dt;
    if (c.ding <= 0) {
      c.ding = rand(4, 9);
      if (G.audio && G.audio.blip) G.audio.blip({ freq: 980, dur: 0.08, type: 'sine', gain: 0.08 });
    }
  }
  if (G.player.inVehicle || G._eating) return;
  const pp = G.player.group.position;
  for (const c of G.iceCarts) {
    if (!c.mesh || dist2(c.mesh.position, pp) > 2.2 * 2.2) continue;
    G.hud.showPrompt('Press <b>E</b> for ice cream · ฿20', 0.4);
    if (G.input.pressed('KeyE')) {
      if (G.cash < 20) { G.hud.showNotif('Need ฿20 for ice cream'); return; }
      G.cash -= 20;
      G.player.stam = G.player.stamMax;
      if (G.hud.setCash) G.hud.setCash(G.cash);
      G.hud.showNotif('Ice cream — เย็น');
      if (G.audio && G.audio.chime) G.audio.chime();
    }
    return;
  }
}

export function updateSoiFootball(dt) {
  if (!GAMEPLAY.soiFootball) return;
  const h = ((G.time.dayT % 1) + 1) % 1 * 24;
  const sois = (G.world && G.world.sois) || [];
  if (h >= 16.8 && h < 18.8 && sois.length) {
    if (!G._soiFootball) {
      const s = sois[Math.min(2, sois.length - 1)];
      const cx = (s.x0 + s.x1) * 0.5, cz = (s.z0 + s.z1) * 0.5;
      const kids = [];
      for (let i = 0; i < 3; i++) {
        const ang = i * TAU / 3;
        const pos = new THREE.Vector3(cx + Math.cos(ang) * 2.4, 0, cz + Math.sin(ang) * 2.4);
        const ped = spawnPed(G.scene, pos, 'school');
        ped.school = true;
        ped.football = true;
        ped.anchor = { slot: pos.clone(), facing: Math.atan2(cx - pos.x, cz - pos.z) };
        ped.speed = 0;
        kids.push(ped);
      }
      const ball = new THREE.Mesh(
        new THREE.SphereGeometry(0.12, 8, 6),
        new THREE.MeshStandardMaterial({ color: 0xf0f0f0, roughness: 0.6 })
      );
      ball.name = 'soi-ball';
      ball.position.set(cx, 0.12, cz);
      G.scene.add(ball);
      G._soiFootball = { kids, ball, soi: s, t: 0, from: 0, to: 1 };
    }
    const g = G._soiFootball;
    g.t += dt * 1.15;
    if (g.t >= 1) {
      g.t = 0;
      g.from = g.to;
      g.to = (g.to + 1) % g.kids.length;
    }
    const a = g.kids[g.from], b = g.kids[g.to];
    if (g.ball && a && a.mesh && b && b.mesh) {
      const k = g.t * g.t * (3 - 2 * g.t);
      g.ball.position.x = lerp(a.mesh.position.x, b.mesh.position.x, k);
      g.ball.position.z = lerp(a.mesh.position.z, b.mesh.position.z, k);
      g.ball.position.y = 0.12 + Math.sin(g.t * Math.PI) * 0.85;
    }
    for (const ped of g.kids) {
      if (!ped || ped.dead || !ped.mesh) continue;
      ped.football = true;
      ped.school = true;
      const other = g.kids[g.to];
      if (other && other.mesh) ped.heading = Math.atan2(other.mesh.position.x - ped.mesh.position.x, other.mesh.position.z - ped.mesh.position.z);
      ped.speed = 0;
    }
  } else if (G._soiFootball) {
    for (const ped of G._soiFootball.kids || []) {
      if (!ped || ped.dead) continue;
      ped.football = false;
      ped.school = false;
      ped.anchor = null;
    }
    if (G._soiFootball.ball) {
      G.scene.remove(G._soiFootball.ball);
      disposeObject(G._soiFootball.ball);
    }
    G._soiFootball = null;
  }
}

export function updateStallIncense(dt) {
  if (!GAMEPLAY.stallIncense || !G.stallIncense) return;
  const h = ((G.time.dayT % 1) + 1) % 1 * 24;
  const dusk = h >= 17.5 || h < 6;
  for (const c of G.stallIncense) {
    c.t = (c.t || 0) + dt;
    if (c.glow && c.glow.material) {
      c.glow.material.emissiveIntensity = dusk ? 0.55 + Math.sin(c.t * 6) * 0.25 : 0.12;
    }
    if (c.coil && c.coil.material) {
      c.coil.material.emissiveIntensity = dusk ? 0.28 : 0.08;
    }
    if (c.smoke && c.smoke.material) {
      c.smoke.material.opacity = dusk ? 0.16 + Math.sin(c.t * 2.2) * 0.08 : 0.06;
      c.smoke.position.y = 0.12 + Math.sin(c.t * 1.6) * 0.04;
      c.smoke.visible = dusk;
    }
  }
}

export function updateGeckos(dt) {
  if (!GAMEPLAY.stallGecko || !G.geckos) return;
  const night = (G.nightK || 0) > 0.45;
  for (const g of G.geckos) {
    g.mesh.visible = night;
    if (!night) continue;
    g.timer -= dt;
    g.chirp -= dt;
    if (g.timer <= 0) {
      g.heading += rand(-0.8, 0.8);
      g.timer = rand(0.6, 1.8);
    }
    g.mesh.position.x = g.home.x + Math.sin(g.heading) * 0.08;
    g.mesh.position.z = g.home.z + Math.cos(g.heading) * 0.08;
    g.mesh.rotation.y = g.heading;
    if (g.chirp <= 0) {
      g.chirp = rand(3, 8);
      if (G.audio && G.audio.blip) G.audio.blip({ freq: 2100, dur: 0.04, type: 'square', gain: 0.03 });
    }
  }
}

export function updateMonitors(dt) {
  if (!GAMEPLAY.khlongMonitor || !G.monitors) return;
  const pp = G.player.inVehicle ? G.player.inVehicle.pos : G.player.group.position;
  for (const m of G.monitors) {
    const d = Math.hypot(m.mesh.position.x - pp.x, m.mesh.position.z - pp.z);
    m.timer -= dt;
    if (d < 4.2) m.state = 'bolt';
    else if (m.state === 'bolt' && d > 9) m.state = 'return';
    if (m.state === 'loaf') {
      if (m.timer <= 0) { m.heading += rand(-0.6, 0.6); m.timer = rand(1.6, 3.5); }
      m.mesh.position.x += Math.sin(m.heading) * 0.35 * dt;
      m.mesh.position.z += Math.cos(m.heading) * 0.35 * dt;
    } else if (m.state === 'bolt') {
      const dx = m.mesh.position.x - pp.x, dz = m.mesh.position.z - pp.z;
      const len = Math.hypot(dx, dz) || 1;
      m.heading = Math.atan2(dx, dz);
      m.mesh.position.x += dx / len * 4.2 * dt;
      m.mesh.position.z += dz / len * 4.2 * dt;
    } else {
      const dx = m.home.x - m.mesh.position.x, dz = m.home.z - m.mesh.position.z;
      const len = Math.hypot(dx, dz) || 1;
      if (len < 0.6) m.state = 'loaf';
      else {
        m.heading = Math.atan2(dx, dz);
        m.mesh.position.x += dx / len * 1.6 * dt;
        m.mesh.position.z += dz / len * 1.6 * dt;
      }
    }
    m.mesh.position.x = clamp(m.mesh.position.x, -228, -204);
    m.mesh.position.z = clamp(m.mesh.position.z, -HALF + 8, HALF - 8);
    m.mesh.rotation.y = m.heading;
  }
}

export function updateWatSweep(dt) {
  if (!GAMEPLAY.watSweep || !G.watSweep) return;
  const h = ((G.time.dayT % 1) + 1) % 1 * 24;
  const morning = h >= 6 && h < 10.5;
  for (const ped of G.watSweep) {
    if (!ped || ped.dead || !ped.mesh) continue;
    ped.watSweep = true;
    ped.mesh.visible = morning;
    if (!morning) {
      ped.speed = 0;
      ped.state = 'idle';
      continue;
    }
    ped._sweepT = (ped._sweepT || 0) + dt * 0.14 * (ped._sweepDir || 1);
    if (ped._sweepT > 1) { ped._sweepT = 1; ped._sweepDir = -1; }
    if (ped._sweepT < 0) { ped._sweepT = 0; ped._sweepDir = 1; }
    const t = ped._sweepT;
    const x = (ped._sweepX0 || 0) + ((ped._sweepX1 || 0) - (ped._sweepX0 || 0)) * t;
    ped.mesh.position.set(x, 0, ped._sweepZ != null ? ped._sweepZ : ped.mesh.position.z);
    ped.heading = (ped._sweepDir || 1) > 0 ? PI / 2 : -PI / 2;
    ped.mesh.rotation.y = ped.heading;
    ped.speed = 0.7;
    ped.state = 'walking';
    animateWalk(ped.mesh, ped.speed, dt, true);
    const broom = ped._broom || ped.mesh.getObjectByName('wat-broom');
    if (broom) broom.rotation.x = 0.55 + Math.sin((ped._sweepT || 0) * 18) * 0.5;
  }
}

export function updateWatCats(dt) {
  if (!GAMEPLAY.watCats || !G.watCats) return;
  const temple = G.world && G.world.poi && G.world.poi.temple;
  const pp = G.player.inVehicle ? G.player.inVehicle.pos : G.player.group.position;
  for (const c of G.watCats) {
    if (!c.mesh) continue;
    c.t = (c.t || 0) + dt;
    const d = Math.hypot(c.mesh.position.x - pp.x, c.mesh.position.z - pp.z);
    if (d < 3.2) c.state = 'bolt';
    else if (c.state === 'bolt' && d > 7) c.state = 'return';
    if (c.state === 'loaf') {
      c.heading += Math.sin(c.t * 0.7) * dt * 0.4;
      c.mesh.position.x += Math.sin(c.heading) * 0.22 * dt;
      c.mesh.position.z += Math.cos(c.heading) * 0.22 * dt;
    } else if (c.state === 'bolt') {
      const dx = c.mesh.position.x - pp.x, dz = c.mesh.position.z - pp.z;
      const len = Math.hypot(dx, dz) || 1;
      c.heading = Math.atan2(dx, dz);
      c.mesh.position.x += dx / len * 3.2 * dt;
      c.mesh.position.z += dz / len * 3.2 * dt;
    } else {
      const dx = c.home.x - c.mesh.position.x, dz = c.home.z - c.mesh.position.z;
      const len = Math.hypot(dx, dz) || 1;
      if (len < 0.45) c.state = 'loaf';
      else {
        c.heading = Math.atan2(dx, dz);
        c.mesh.position.x += dx / len * 1.3 * dt;
        c.mesh.position.z += dz / len * 1.3 * dt;
      }
    }
    if (temple) {
      c.mesh.position.x = clamp(c.mesh.position.x, temple.x - 12, temple.x + 12);
      c.mesh.position.z = clamp(c.mesh.position.z, temple.z - 12, temple.z + 12);
    }
    c.mesh.rotation.y = c.heading;
  }
}

export function updateWatLotus(dt) {
  if (!GAMEPLAY.watLotus || !G.watLotus) return;
  const c = G.watLotus;
  c.t = (c.t || 0) + dt;
  const h = ((G.time.dayT % 1) + 1) % 1 * 24;
  const open = h >= 6 && h < 18;
  const blooms = c.mesh ? c.mesh.children.filter(ch => ch && ch.name === 'wat-lotus') : [];
  for (let i = 0; i < blooms.length; i++) {
    blooms[i].position.y = 0.38 + Math.sin(c.t * 2.2 + i) * 0.03;
  }
  const ped = c.vendor;
  if (ped && ped.mesh) {
    ped.watLotus = true;
    ped.mesh.visible = open;
    const slot = ped.anchor && ped.anchor.slot;
    if (slot) {
      ped.mesh.position.set(slot.x, 0, slot.z);
      ped.heading = ped.anchor.facing;
      ped.mesh.rotation.y = ped.heading;
    }
    ped.speed = 0;
    ped.state = 'idle';
  }
  if (!open || G.player.inVehicle || G._eating) return;
  const pp = G.player.group.position;
  if (!c.mesh || dist2(c.mesh.position, pp) > 2.4 * 2.4) return;
  if (G._lotus) {
    G.hud.showPrompt('You already have a lotus', 0.35);
    return;
  }
  G.hud.showPrompt('Press <b>E</b> for a lotus · ฿30', 0.4);
  if (!G.input.pressed('KeyE')) return;
  if (G.cash < 30) { G.hud.showNotif('Need ฿30 for a lotus'); return; }
  G.cash -= 30;
  G._lotus = true;
  if (G.hud.setCash) G.hud.setCash(G.cash);
  G.hud.showNotif('Lotus — ดอกบัว');
  if (G.audio && G.audio.chime) G.audio.chime();
}

export function updateWatAmulet(dt) {
  if (!GAMEPLAY.watAmulet || !G.watAmulet) return;
  const c = G.watAmulet;
  c.t = (c.t || 0) + dt;
  const h = ((G.time.dayT % 1) + 1) % 1 * 24;
  const open = h >= 6 && h < 18;
  const charms = c.mesh ? c.mesh.children.filter(ch => ch && ch.name === 'wat-amulet') : [];
  for (let i = 0; i < charms.length; i++) {
    charms[i].rotation.z = Math.sin(c.t * 2.4 + i) * 0.18;
  }
  const ped = c.vendor;
  if (ped && ped.mesh) {
    ped.watAmulet = true;
    ped.mesh.visible = open;
    const slot = ped.anchor && ped.anchor.slot;
    if (slot) {
      ped.mesh.position.set(slot.x, 0, slot.z);
      ped.heading = ped.anchor.facing;
      ped.mesh.rotation.y = ped.heading;
    }
    ped.speed = 0;
    ped.state = 'idle';
  }
  if (!open || G.player.inVehicle || G._eating) return;
  const pp = G.player.group.position;
  if (!c.mesh || dist2(c.mesh.position, pp) > 2.4 * 2.4) return;
  if (G._amulet) {
    G.hud.showPrompt('You already have an amulet', 0.35);
    return;
  }
  G.hud.showPrompt('Press <b>E</b> for an amulet · ฿50', 0.4);
  if (!G.input.pressed('KeyE')) return;
  if (G.cash < 50) { G.hud.showNotif('Need ฿50 for an amulet'); return; }
  G.cash -= 50;
  G._amulet = true;
  if (G.hud.setCash) G.hud.setCash(G.cash);
  G.hud.showNotif('Amulet — พระเครื่อง');
  if (G.audio && G.audio.chime) G.audio.chime();
}

export function updateBtsPigeons(dt) {
  if (!GAMEPLAY.btsPigeons || !G.btsPigeons) return;
  const h = ((G.time.dayT % 1) + 1) % 1 * 24;
  const day = h >= 6 && h < 18.5;
  const pp = G.player.group.position;
  for (const p of G.btsPigeons) {
    if (!p.mesh) continue;
    p.t = (p.t || 0) + dt;
    p.mesh.visible = day;
    if (!day) continue;
    const dx = p.mesh.position.x - pp.x, dy = p.mesh.position.y - pp.y, dz = p.mesh.position.z - pp.z;
    const d3 = Math.hypot(dx, dy, dz);
    if (d3 < 4.2) p.state = 'bolt';
    else if (p.state === 'bolt' && d3 > 9) p.state = 'return';
    if (p.state === 'loaf') {
      p.mesh.position.set(p.home.x, p.home.y + Math.sin(p.t * 2.2) * 0.02, p.home.z);
    } else if (p.state === 'bolt') {
      const len = Math.hypot(dx, dz) || 1;
      p.mesh.position.x += dx / len * 4.2 * dt;
      p.mesh.position.z += dz / len * 4.2 * dt;
      p.mesh.position.y = Math.min(p.home.y + 4.2, p.mesh.position.y + 3.6 * dt);
      p.heading = Math.atan2(dx, dz);
    } else {
      const hx = p.home.x - p.mesh.position.x, hz = p.home.z - p.mesh.position.z;
      const len = Math.hypot(hx, hz) || 1;
      p.mesh.position.x += hx / len * 2.2 * dt;
      p.mesh.position.z += hz / len * 2.2 * dt;
      p.mesh.position.y += (p.home.y - p.mesh.position.y) * Math.min(1, dt * 2.4);
      if (len < 0.35 && Math.abs(p.mesh.position.y - p.home.y) < 0.2) p.state = 'loaf';
    }
    p.mesh.rotation.y = p.heading || 0;
    const flap = (p.state === 'loaf' ? 0.12 : 0.55) * Math.sin(p.t * (p.state === 'loaf' ? 6 : 16));
    const wings = p.mesh.children.filter(ch => ch && ch.name === 'pigeon-wing');
    if (wings[0]) wings[0].rotation.z = flap;
    if (wings[1]) wings[1].rotation.z = -flap;
  }
}

export function updateWatRobes(dt) {
  if (!GAMEPLAY.watRobes || !G.watRobes) return;
  const c = G.watRobes;
  c.t = (c.t || 0) + dt;
  const wet = (G.time.rainStrength || 0) > 0.4;
  if (c.mesh) c.mesh.visible = !wet;
  if (wet || !c.mesh) return;
  const robes = c.mesh.children.filter(ch => ch && ch.name === 'saffron-robe');
  for (let i = 0; i < robes.length; i++) {
    robes[i].rotation.z = Math.sin(c.t * 3.4 + i * 0.7) * 0.22;
  }
}

export function updateWatBats(dt) {
  if (!GAMEPLAY.watBats || !G.watBats) return;
  const h = ((G.time.dayT % 1) + 1) % 1 * 24;
  const night = h >= 18.2 || h < 5.6;
  for (const b of G.watBats) {
    if (!b.mesh) continue;
    b.mesh.visible = night;
    if (!night) continue;
    b.t = (b.t || 0) + dt * (b.spin || 0.6);
    const x = b.cx + Math.sin(b.t) * b.r;
    const z = b.cz + Math.cos(b.t) * b.r;
    const y = b.y + Math.sin(b.t * 2.4) * 0.35;
    b.mesh.position.set(x, y, z);
    b.mesh.rotation.y = b.t + PI / 2;
    const flap = Math.sin(b.t * 18) * 0.45;
    const wings = b.mesh.children.filter(ch => ch && ch.name === 'bat-wing');
    if (wings[0]) wings[0].rotation.z = flap;
    if (wings[1]) wings[1].rotation.z = -flap;
  }
}

export function updateWatTurtles(dt) {
  if (!GAMEPLAY.watTurtles || !G.watTurtles) return;
  const feed = GAMEPLAY.watFeed && G.watFeed && G.watFeed.feedT > 0;
  const k = feed ? Math.min(1, G.watFeed.feedT / 4) : 0;
  const fx = feed ? G.watFeed.x : 0, fz = feed ? G.watFeed.z : 0;
  for (const t of G.watTurtles) {
    if (!t.mesh) continue;
    t.ang += t.spin * dt * (feed ? 1.8 : 1);
    const r = feed ? Math.max(0.28, t.r * (1 - 0.65 * k)) : t.r;
    const ox = feed ? t.cx + (fx - t.cx) * 0.5 * k : t.cx;
    const oz = feed ? t.cz + (fz - t.cz) * 0.5 * k : t.cz;
    t.mesh.position.x = ox + Math.sin(t.ang) * r;
    t.mesh.position.z = oz + Math.cos(t.ang) * r;
    t.mesh.position.y = 0.12 + Math.sin(t.ang * 3) * 0.02;
    t.mesh.rotation.y = t.ang + PI / 2;
  }
}

export function updateWatFeed(dt) {
  if (!GAMEPLAY.watFeed || !G.watFeed) return;
  const f = G.watFeed;
  if (f.feedT > 0) f.feedT = Math.max(0, f.feedT - dt);
  if (G.player.inVehicle || G._eating) return;
  const pp = G.player.group.position;
  if (dist2({ x: f.x, z: f.z }, pp) > 2.4 * 2.4) return;
  G.hud.showPrompt('Press <b>E</b> to feed the turtles · ฿10', 0.4);
  if (!G.input.pressed('KeyE')) return;
  if (G.cash < 10) { G.hud.showNotif('Need ฿10 for turtle pellets'); return; }
  G.cash -= 10;
  f.feedT = 5;
  G._turtleFeed = (G._turtleFeed || 0) + 1;
  if (G.hud.setCash) G.hud.setCash(G.cash);
  G.hud.showNotif('The turtles swarm — ให้อาหารเต่า');
  if (G.audio && G.audio.chime) G.audio.chime();
}

export function updateHyacinth(dt) {
  if (!GAMEPLAY.hyacinth || !G.hyacinth) return;
  const t = (G.time && G.time.dayT ? G.time.dayT : 0) * TAU * 6;
  for (const h of G.hyacinth) {
    if (!h.mesh) continue;
    h.z += (h.drift || 0.35) * dt;
    if (h.z > HALF - 10) h.z = -HALF + 10;
    h.mesh.position.z = h.z;
    h.mesh.position.y = 0.1 + Math.sin(t + h.phase) * 0.045;
    h.mesh.rotation.y += dt * 0.08;
  }
}

export function updateCats(dt) {
  if (!GAMEPLAY.soiCats || !G.cats) return;
  const pp = G.player.inVehicle ? G.player.inVehicle.pos : G.player.group.position;
  for (const c of G.cats) {
    const d = Math.hypot(c.mesh.position.x - pp.x, c.mesh.position.z - pp.z);
    c.timer -= dt;
    if (d < 3.2) c.state = 'bolt';
    else if (c.state === 'bolt' && d > 7) c.state = 'return';
    if (c.state === 'loaf') {
      if (c.timer <= 0) { c.heading += rand(-0.8, 0.8); c.timer = rand(1.4, 3.2); }
      c.mesh.position.x += Math.sin(c.heading) * 0.25 * dt;
      c.mesh.position.z += Math.cos(c.heading) * 0.25 * dt;
    } else if (c.state === 'bolt') {
      const dx = c.mesh.position.x - pp.x, dz = c.mesh.position.z - pp.z;
      const len = Math.hypot(dx, dz) || 1;
      c.heading = Math.atan2(dx, dz);
      c.mesh.position.x += dx / len * 3.4 * dt;
      c.mesh.position.z += dz / len * 3.4 * dt;
    } else {
      const dx = c.home.x - c.mesh.position.x, dz = c.home.z - c.mesh.position.z;
      const len = Math.hypot(dx, dz) || 1;
      if (len < 0.5) c.state = 'loaf';
      else {
        c.heading = Math.atan2(dx, dz);
        c.mesh.position.x += dx / len * 1.4 * dt;
        c.mesh.position.z += dz / len * 1.4 * dt;
      }
    }
    c.mesh.position.x = clamp(c.mesh.position.x, -HALF + 4, HALF - 4);
    c.mesh.position.z = clamp(c.mesh.position.z, -HALF + 4, HALF - 4);
    c.mesh.rotation.y = c.heading;
  }
}

export function updateDogs(dt) {
  const playerPos = G.player.group.position;
  for (const dog of G.dogs) {
    dog.timer -= dt;
    const d = Math.sqrt(dist2(dog.mesh.position, playerPos));

    if (GAMEPLAY.dogRoadLife && dog.state !== 'chasing' && dog.state !== 'fleeing' && !G._dogChase) {
      for (const v of G.vehicles) {
        if (!v || v.dead || !v.spec || v.spec.kind !== 'bike' || Math.abs(v.vel) < 6) continue;
        if (dist2(dog.mesh.position, v.pos) < 16) {
          dog.state = 'chasing'; dog.timer = 1.5; dog.speed = 4.2;
          dog.heading = v.heading; G._dogChase = dog; G.audio.bark();
          break;
        }
      }
    }

    if (dog.state === 'lying') {
      if (d < 6) { dog.state = 'fleeing'; dog.timer = 2.5; dog._lie = { x: dog.mesh.position.x, z: dog.mesh.position.z }; G.audio.bark(); }
      else if (dog.timer <= 0) { dog.state = Math.random()<0.5 ? 'walking' : 'lying'; dog.timer = rand(2, 8); dog.heading = rand(0,TAU); }
    } else if (dog.state === 'walking') {
      if (d < 5) { dog.state = 'fleeing'; dog.timer = 2.5; dog._lie = { x: dog.mesh.position.x, z: dog.mesh.position.z }; G.audio.bark(); }
      else if (dog.timer <= 0) { dog.state = Math.random()<0.4 ? 'lying' : 'walking'; dog.timer = rand(3, 8); dog.heading = rand(0,TAU); }
    } else if (dog.state === 'fleeing') {
      const dx = dog.mesh.position.x - playerPos.x;
      const dz = dog.mesh.position.z - playerPos.z;
      dog.heading = Math.atan2(dx, dz);
      dog.speed = 3.5;
      if (d > 14 || dog.timer <= 0) {
        if (GAMEPLAY.dogRoadLife && dog._lie) {
          dog.state = 'regroup'; dog.speed = 1.1; dog.timer = 6;
        } else { dog.state = 'walking'; dog.speed = 0.9; dog.timer = rand(3, 7); }
      }
    } else if (dog.state === 'regroup') {
      const t = dog._lie;
      if (!t) { dog.state = 'walking'; }
      else {
        const dx = t.x - dog.mesh.position.x, dz = t.z - dog.mesh.position.z;
        const dd = Math.hypot(dx, dz);
        dog.heading = Math.atan2(dx, dz); dog.speed = 1.2;
        if (dd < 0.8 || dog.timer <= 0) { dog.state = 'lying'; dog.speed = 0; dog.timer = rand(3, 8); }
      }
    } else if (dog.state === 'chasing') {
      if (dog.timer <= 0) { dog.state = 'walking'; dog.speed = 0.9; if (G._dogChase === dog) G._dogChase = null; }
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

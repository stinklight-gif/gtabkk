// =============================================================================
// NPCS — extracted from main.js (see numbered sections). No logic change.
// =============================================================================
import * as THREE from 'three';
import {
  makeStaticBaker, PI, TAU, clamp, lerp, rand, irand, pick, sign, dist2, COLORS, G, PRICE, PAINT_COLORS, TURFS, ROAD_WIDTH, PED_TARGET, GAMEPLAY, yaowaratNightOpen, inYaowarat, _camTarget, _camOffset, _fireDir, _ray, _bbox, _vBox, _blackColor, disposeObject, BLOCK, GRID, HALF, lerpAngle
} from './core.js';
import { animateWalk, damagePlayer, recolorTorso, resolvePedVsBuildings, saveGame, sidewalkPos, spawnPed, spawnWalkingPair } from './main.js';
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
    if (ped.isMugger || ped.isTarget || ped.anchor || ped.gang || ped.alms || ped.yaowaratNight || ped.pillion || ped.school || ped.btsWait || ped.commute || ped.crossingGuard) continue;
    if (dist2(ped.mesh.position, pp) > 95 * 95) ped.mesh.position.copy(sidewalkPos(pp.x, pp.z, 88));
  }
  for (let guard = 0; G.peds.length > target && guard < 500; guard++) {
    let fi = -1, fd = -1;
    for (let i = 0; i < G.peds.length; i++) {
      const ped = G.peds[i];
      if (ped.isMugger || ped.isTarget || ped.anchor || ped.gang || ped.alms || ped.yaowaratNight || ped.pillion || ped.school || ped.btsWait || ped.commute || ped.crossingGuard) continue;
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
      if (ped.isMugger || ped.isTarget || ped.anchor || ped.gang || ped.alms || ped.yaowaratNight || ped.pillion || ped.school || ped.btsWait || ped.commute || ped.crossingGuard) continue;
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
    const want = near ? Math.round(a.capacity * occ) : 0;
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
  if (!GAMEPLAY.spiritWai || G.player.inVehicle || G._eating) return;
  const list = G.world && G.world.shrines;
  if (!list || !list.length) return;
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
      G.wanted.lastSeenAt = Math.max(0, (G.wanted.lastSeenAt || now) - 16000);
      G._waiCount = (G._waiCount || 0) + 1;
      G.hud.showNotif('The spirit house accepts your wai');
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
  const h = ((G.time.dayT % 1) + 1) % 1 * 24;
  const temple = G.world && G.world.poi && G.world.poi.temple;
  if (!temple) return;
  if (h >= 5 && h < 7) {
    G._alms = G._alms || [];
    const ways = (G.world.walkways || []).filter(w => {
      const mx = (w.x0 + w.x1) / 2, mz = (w.z0 + w.z1) / 2;
      return dist2({ x: mx, z: mz }, temple) < 80 * 80;
    });
    while (G._alms.length < 3) {
      const w = ways[G._alms.length] || ways[0] || null;
      const pos = w
        ? new THREE.Vector3((w.x0 + w.x1) / 2, 0, (w.z0 + w.z1) / 2)
        : new THREE.Vector3(temple.x + rand(-12, 12), 0, temple.z + rand(-12, 12));
      const ped = spawnPed(G.scene, pos);
      ped.kind = 'monk'; ped.mesh.userData.kind = 'monk';
      ped.anchor = null; ped.state = 'walking'; ped.alms = true;
      ped.heading = Math.atan2(temple.x - pos.x, temple.z - pos.z);
      G._alms.push(ped);
    }
    for (const ped of G._alms) {
      if (!ped || ped.dead) continue;
      const dx = temple.x - ped.mesh.position.x, dz = temple.z - ped.mesh.position.z;
      if (Math.hypot(dx, dz) > 6) { ped.heading = Math.atan2(dx, dz); ped.speed = 0.85; }
      else ped.speed = 0.4;
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
  if (h >= 6.2 && h < 8.7) {
    G._schoolKids = G._schoolKids || [];
    while (G._schoolKids.length < 5) {
      const ang = rand(0, TAU), r = rand(22, 70);
      const pos = new THREE.Vector3(
        clamp(dest.x + Math.cos(ang) * r, -HALF + 8, HALF - 8), 0,
        clamp(dest.z + Math.sin(ang) * r, -HALF + 8, HALF - 8));
      const ped = spawnPed(G.scene, pos, 'school');
      ped.school = true;
      ped.anchor = null;
      ped.state = 'walking';
      ped.heading = Math.atan2(dest.x - pos.x, dest.z - pos.z);
      G._schoolKids.push(ped);
    }
    for (const ped of G._schoolKids) {
      if (!ped || ped.dead) continue;
      const dx = dest.x - ped.mesh.position.x, dz = dest.z - ped.mesh.position.z;
      const d = Math.hypot(dx, dz);
      if (d > 8) { ped.heading = Math.atan2(dx, dz); ped.speed = 1.35; ped.state = 'walking'; }
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
  if (h >= 6.2 && h < 8.7) {
    G._crossingGuards = G._crossingGuards || [];
    const slots = [
      { x: cx + kerb, z: cz - kerb, facing: PI / 2 },
      { x: cx - kerb, z: cz + kerb, facing: -PI / 2 },
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
    if (!ped || ped.dead || ped.anchor || ped.gang || ped.pillion || ped.alms || ped.school || ped.btsWait || ped.commute || ped.crossingGuard || ped.panicT > 0) continue;
    if (ped.social || ped.isMugger || ped.isTarget || ped.motosaiRider || ped.motosaiWait) continue;
    const w = nearestWalkway(ped.mesh.position.x, ped.mesh.position.z);
    if (!w) continue;
    ped.shade = { x: clamp(ped.mesh.position.x, w.x0, w.x1), z: clamp(ped.mesh.position.z, w.z0, w.z1) };
    n++;
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

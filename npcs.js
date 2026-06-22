// =============================================================================
// NPCS — extracted from main.js (see numbered sections). No logic change.
// =============================================================================
import * as THREE from 'three';
import {
  makeStaticBaker, PI, TAU, clamp, lerp, rand, irand, pick, sign, dist2, COLORS, G, PRICE, PAINT_COLORS, TURFS, ROAD_WIDTH, PED_TARGET, GAMEPLAY, _camTarget, _camOffset, _fireDir, _ray, _bbox, _vBox, _blackColor, disposeObject, BLOCK, GRID, HALF, lerpAngle
} from './core.js';
import { animateWalk, damagePlayer, saveGame, sidewalkPos, spawnPed } from './main.js';

// 13. PEDESTRIANS + DOGS
// =============================================================================

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
export function crowdTarget() { return Math.round(PED_TARGET * crowdFactor(G.time.dayT)); }

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
    if (ped.isMugger || ped.isTarget || ped.anchor || ped.gang) continue;
    if (dist2(ped.mesh.position, pp) > 95 * 95) ped.mesh.position.copy(sidewalkPos(pp.x, pp.z, 88));
  }
  for (let guard = 0; G.peds.length > target && guard < 500; guard++) {
    let fi = -1, fd = -1;
    for (let i = 0; i < G.peds.length; i++) {
      const ped = G.peds[i];
      if (ped.isMugger || ped.isTarget || ped.anchor || ped.gang) continue;
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
  for (const ped of G.peds) {
    if (ped.dead) continue;
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
      // run away from player
      const dx = ped.mesh.position.x - playerPos.x;
      const dz = ped.mesh.position.z - playerPos.z;
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
    // knockback impulse (Songkran water throw, etc.) — a short shove that decays fast
    if (ped.knockX || ped.knockZ) {
      ped.mesh.position.x += ped.knockX * dt;
      ped.mesh.position.z += ped.knockZ * dt;
      const decay = Math.pow(0.015, dt);
      ped.knockX *= decay; ped.knockZ *= decay;
      if (Math.abs(ped.knockX) < 0.05 && Math.abs(ped.knockZ) < 0.05) { ped.knockX = 0; ped.knockZ = 0; }
    }
    ped.mesh.rotation.y = ped.heading;
    animateWalk(ped.mesh, ped.speed, dt, ped.speed > 0.05);

    // bounds
    ped.mesh.position.x = clamp(ped.mesh.position.x, -HALF + 2, HALF - 2);
    ped.mesh.position.z = clamp(ped.mesh.position.z, -HALF + 2, HALF - 2);

    // recycle a wanderer that strayed too far back onto a sidewalk in view
    // (anchored cluster peds stay put — they belong to a stall/store)
    if (!ped.anchor && dist2(ped.mesh.position, playerPos) > 170*170) {
      ped.mesh.position.copy(sidewalkPos(playerPos.x, playerPos.z, 75));
    }
  }
  // keep the streets populated to the time-of-day target — busy at rush hour,
  // near-empty in the small hours (see crowdFactor)
  const target = crowdTarget();
  if (G.peds.length < target) {
    spawnPed(G.scene, sidewalkPos(playerPos.x, playerPos.z, 90));   // ramps in smoothly
  } else if (G.peds.length > target) {
    // thin toward the target by dropping the farthest non-special ped each frame
    let fi = -1, fd = 60 * 60;
    for (let i = 0; i < G.peds.length; i++) {
      const ped = G.peds[i];
      if (ped.isMugger || ped.isTarget || ped.anchor || ped.gang) continue;
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

// Street-food stalls — visit on foot to eat (heal once) and tick the set.
export function updateFoodStalls(dt) {
  const fs = G.world.foodStalls;
  if (!fs || G.player.inVehicle) return;
  const pp = G.player.group.position;
  for (const f of fs) {
    if (f.visited) continue;
    if (dist2(f.pos, pp) < 4 * 4) {
      f.visited = true;
      G.foodVisited = (G.foodVisited || 0) + 1;
      G.player.hp = Math.min(G.player.hpMax, G.player.hp + 25);
      f.glowMat.emissiveIntensity = 0; f.glowMat.color.setHex(0x555555);   // dim = visited
      G.hud.showNotif(`Street food! +HP (${G.foodVisited}/${fs.length})`);
      G.audio.chime();
    }
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
  const parts = ped.mesh.userData.parts;
  if (parts) parts.torso.material = new THREE.MeshStandardMaterial({ color: 0x2a2a2a, roughness: 0.8 });
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
    const parts = ped.mesh.userData.parts;
    if (parts && parts.torso) parts.torso.material = new THREE.MeshStandardMaterial({ color: 0x24222c, roughness: 0.8 });
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
  const parts = ped.mesh.userData.parts;
  if (parts) parts.torso.material = new THREE.MeshStandardMaterial({ color: 0x6a1a1a, roughness: 0.8 });
  const mk = new THREE.Mesh(new THREE.SphereGeometry(0.22, 8, 8),
    new THREE.MeshStandardMaterial({ color: 0xff2a2a, emissive: 0xff2a2a, emissiveIntensity: 0.8, roughness: 0.5 }));
  mk.position.set(0, 2.5, 0); ped.mesh.add(mk);
  vg.target = ped; vg.marker = mk;
}
export function vigilanteEnd(msg) {
  const vg = G.vigilante;
  if (!vg) return;
  if (vg.target && !vg.target.dead) {     // release the current crook
    vg.target.isTarget = false; vg.target.panicT = 0;
    if (vg.marker && vg.marker.parent) { vg.marker.parent.remove(vg.marker); disposeObject(vg.marker); }
  }
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
    G.hud.showPrompt(`VIGILANTE &nbsp; ⏱ ${vg.timeLeft.toFixed(0)}s &nbsp;·&nbsp; busts ${vg.busts}`, 0.4);
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

export function updateDogs(dt) {
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

// =============================================================================
// WANTED — extracted from main.js (see numbered sections). No logic change.
// =============================================================================
import * as THREE from 'three';
import {
  makeStaticBaker, PI, TAU, clamp, lerp, rand, irand, pick, sign, dist2, COLORS, G, PRICE, PAINT_COLORS, ROAD_WIDTH, PED_TARGET, GAMEPLAY, _camTarget, _camOffset, _fireDir, _ray, _bbox, _vBox, _blackColor, disposeObject, BLOCK, GRID, HALF, lerpAngle
} from './core.js';
import { abortHeist, animateWalk, damagePlayer, hasLineOfSight, makePedMesh, makeVehicle, onCopKilled, raiseWanted, updateVehicleVisuals } from './main.js';

// Cops see with their eyes, not with a distance check. Resolving line of sight walks
// the building AABBs, so we cache it per cop and refresh a few times a second rather
// than every frame — police reactions don't need 60 Hz, and at 4★ there can be 8+ of
// them. EYE/CHEST are the sample heights (a cop looking at the player's torso).
const LOS_REFRESH = 0.2;
const EYE_Y = 1.5, CHEST_Y = 1.05;
function copSeesPlayer(c, dt) {
  c._losT = (c._losT || 0) - dt;
  if (c._losT <= 0) {
    c._losT = LOS_REFRESH;
    const p = G.player.group.position;
    const m = c.mesh ? c.mesh.position : c.pos;
    c._losOk = hasLineOfSight(m.x, m.y + EYE_Y, m.z, p.x, p.y + CHEST_Y, p.z);
  }
  return c._losOk !== false;
}

// 15. COPS + WANTED SYSTEM
// =============================================================================

export function spawnCop(scene, pos) {
  // foot cop
  const m = makePedMesh();
  // override clothing to brown/khaki cop uniform
  const copShirt = new THREE.MeshStandardMaterial({ color: 0x8a7f4a, roughness: 0.7 });
  const copPants = new THREE.MeshStandardMaterial({ color: 0x4a4030, roughness: 0.8 });
  const pp = m.userData.parts;
  for (const part of [pp.torso, pp.armL, pp.armR, pp.foreL, pp.foreR]) if (part) part.material = copShirt;
  for (const part of (pp.pantsParts || [pp.legL, pp.legR])) if (part) part.material = copPants;
  m.position.copy(pos);
  scene.add(m);
  const cop = {
    mesh: m, heading: rand(0, TAU), speed: 3.5, hp: 60, dead: false,
    state: 'seeking',  // seeking | engaging | bribed
    shootCooldown: 0, idleT: 0, panicT: 0,
    flinchT: 0, strafeT: 0, strafeDir: 1,   // tactical: hit-stagger + strafe juke
  };
  G.cops.push(cop);
  return cop;
}

export function spawnCopCar(scene, pos) {
  const v = makeVehicle('cop', scene);
  v.pos.copy(pos);
  v.mesh.position.copy(v.pos);
  v.heading = rand(0, TAU);
  v.driver = 'cop';
  v.hp = 200;          // cop cars are tankier; they live in G.vehicles like any car
  v.vel = 0;
  return v;
}

// Unmarked Crime Suppression SUV — the 3★ unit. isCop (set in makeVehicle), so it
// reuses the cop chase/minimap/damage/death plumbing; just faster and tankier.
export function spawnFortuner(scene, pos) {
  const v = makeVehicle('fortuner', scene);
  v.pos.copy(pos);
  v.mesh.position.copy(v.pos);
  v.heading = rand(0, TAU);
  v.driver = 'cop';
  v.hp = 250;
  v.vel = 0;
  return v;
}

// Armored SWAT van — the 4★ unit. isCop, reuses the cop chase/damage paths.
export function spawnSwat(scene, pos) {
  const v = makeVehicle('swat', scene);
  v.pos.copy(pos);
  v.mesh.position.copy(v.pos);
  v.heading = rand(0, TAU);
  v.driver = 'cop';
  v.hp = 350;
  v.vel = 0;
  return v;
}

export function killCop(cop) {
  if (cop.dead) return;
  cop.dead = true;
  cop.mesh.rotation.x = PI/2;
  cop.mesh.position.y = 0.05;
  raiseWanted(2);
  onCopKilled();
  setTimeout(() => {
    G.scene.remove(cop.mesh);
    disposeObject(cop.mesh);
    const i = G.cops.indexOf(cop); if (i >= 0) G.cops.splice(i, 1);
  }, 8000);
}

export function updateWanted(dt) {
  const p = G.player.group.position;
  // police disabled (pause-menu toggle): force 0★, clear the streets, spawn nothing
  if (G.policeOff) {
    if (G.wanted.stars !== 0) G.wanted.stars = 0;
    // despawn any live foot cops + driven cop vehicles + the chopper so it clears at once
    // (only cop-driven cars; leaves the parked, enterable Vigilante prop alone)
    for (let i = G.cops.length - 1; i >= 0; i--) { G.scene.remove(G.cops[i].mesh); disposeObject(G.cops[i].mesh); G.cops.splice(i, 1); }
    for (let i = G.vehicles.length - 1; i >= 0; i--) { const v = G.vehicles[i]; if (v.isCop && v.driver === 'cop') { G.scene.remove(v.mesh); disposeObject(v.mesh); G.vehicles.splice(i, 1); } }
    if (G.heli) despawnHelicopter();
    G.hud.setStars(0);
    return;
  }
  // visual: blink active cop-car light bars
  const t = performance.now() * 0.012;
  for (const v of G.vehicles) {
    if (v.isCop && !v.dead && v.driver && v.mesh.userData.copLamps) {
      const flash = Math.sin(t) > 0;
      v.mesh.userData.copLamps[0].material.color.setHex(flash ? 0xff2222 : 0x441111);
      v.mesh.userData.copLamps[1].material.color.setHex(flash ? 0x2266ff : 0x111144);
      if (Math.random() < 0.005) G.audio.siren();
    }
  }

  // spawn cops based on stars — foot cops live in G.cops, cop cars in G.vehicles
  const nightBonus = (G.nightK > 0.5 && G.wanted.stars > 0) ? 1 : 0;  // hotter at night
  const desiredCops = (G.wanted.stars >= 4 ? 8 : G.wanted.stars >= 3 ? 6 : G.wanted.stars >= 2 ? 4 : G.wanted.stars >= 1 ? 2 : 0) + nightBonus;
  let alive = 0;
  for (const c of G.cops) if (!c.dead && c.state !== 'bribed') alive++;   // bribed cops aren't pursuers
  for (const v of G.vehicles) if (v.isCop && !v.dead && v.driver) alive++;
  if (alive < desiredCops && Math.random() < 0.01 + G.wanted.stars * 0.01) {
    // spawn just outside view
    const ang = rand(0, TAU);
    const r = rand(35, 60);
    const sx = clamp(p.x + Math.cos(ang) * r, -HALF + 5, HALF - 5);
    const sz = clamp(p.z + Math.sin(ang) * r, -HALF + 5, HALF - 5);
    if (G.wanted.stars >= 4 && Math.random() < 0.5) {
      const s = spawnSwat(G.scene, new THREE.Vector3(sx, 0, sz));
      s.vel = 6;
    } else if (G.wanted.stars >= 3 && Math.random() < 0.6) {
      const f = spawnFortuner(G.scene, new THREE.Vector3(sx, 0, sz));
      f.vel = 8;
    } else if (G.wanted.stars >= 2 && Math.random() < 0.6) {
      const car = spawnCopCar(G.scene, new THREE.Vector3(sx, 0, sz));
      car.vel = 6;
    } else {
      spawnCop(G.scene, new THREE.Vector3(sx, 0, sz));
    }
  }

  // line of sight: a cop close enough to see you keeps refreshing "last seen",
  // so heat only starts cooling once you've actually broken contact. The sight
  // radius is smaller than the spawn radius so fresh spawns don't auto-refresh.
  // "See" means an actual unobstructed line — duck behind a building or into an
  // alley and contact breaks, which is what makes cover worth using.
  if (GAMEPLAY.wantedLOS && G.wanted.stars > 0) {
    const seeR = 30 * 30;
    let seen = false;
    for (const c of G.cops) {
      if (c.dead || c.state === 'bribed' || dist2(c.mesh.position, p) >= seeR) continue;
      if (copSeesPlayer(c, dt)) { seen = true; break; }
    }
    if (!seen) for (const v of G.vehicles) {
      if (!v.isCop || v.dead || !v.driver || dist2(v.pos, p) >= seeR) continue;
      if (copSeesPlayer(v, dt)) { seen = true; break; }
    }
    if (seen) G.wanted.lastSeenAt = performance.now();
  }

  // wanted decay once out of sight long enough
  const sinceSeen = (performance.now() - G.wanted.lastSeenAt) / 1000;
  if (G.wanted.stars > 0 && sinceSeen > 35) {
    G.wanted.stars = Math.max(0, G.wanted.stars - 1);
    G.wanted.lastSeenAt = performance.now();
    G.hud.showNotif(G.wanted.stars === 0 ? 'You lost the cops.' : 'Heat reduced ★');
  }

  // bribe: B near any foot cop
  let bribeable = null;
  for (const c of G.cops) {
    if (c.dead) continue;
    if (dist2(c.mesh.position, p) < 4 * 4) { bribeable = c; break; }
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
    }
  }

  updateHelicopter(dt);   // 4★+ searchlight
  maybeAmbush();          // 3★+ roadblock ahead while driving
  G.hud.setStars(G.wanted.stars);
}

// ---- Police helicopter (4★+): a searchlight that keeps the heat fresh while
// you're out in the open. Duck inside (Terminal 21) to break its line of sight. ----
function spawnHelicopter() {
  const p = G.player.group.position;
  const g = new THREE.Group();
  const dark = new THREE.MeshStandardMaterial({ color: 0x1b2330, roughness: 0.5, metalness: 0.3 });
  const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.95, 1.7, 6, 10), dark); body.rotation.z = PI / 2; body.castShadow = true; g.add(body);
  const tail = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.28, 3), dark); tail.position.set(0, 0.15, -2.4); g.add(tail);
  const fin = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.8, 0.5), dark); fin.position.set(0, 0.5, -3.7); g.add(fin);
  for (const sx of [-0.6, 0.6]) { const skid = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.08, 2.4), dark); skid.position.set(sx, -0.9, 0); g.add(skid); }
  const rotor = new THREE.Group();
  for (let i = 0; i < 2; i++) { const b = new THREE.Mesh(new THREE.BoxGeometry(8, 0.06, 0.34), new THREE.MeshStandardMaterial({ color: 0x15151a })); b.rotation.y = i * PI / 2; rotor.add(b); }
  rotor.position.y = 0.95; g.add(rotor);
  const tailRotor = new THREE.Mesh(new THREE.BoxGeometry(0.05, 1.4, 0.18), new THREE.MeshStandardMaterial({ color: 0x15151a })); tailRotor.position.set(0.16, 0.15, -3.7); g.add(tailRotor);
  const beacon = new THREE.Mesh(new THREE.SphereGeometry(0.16, 8, 6), new THREE.MeshBasicMaterial({ color: 0xff2222 })); beacon.position.set(0, -0.9, 0); g.add(beacon);
  g.position.set(p.x, 40, p.z); G.scene.add(g);
  const beam = new THREE.Mesh(
    new THREE.CylinderGeometry(0.3, 7, 40, 18, 1, true),
    new THREE.MeshBasicMaterial({ color: 0xfff3c0, transparent: true, opacity: 0.1, side: THREE.DoubleSide, depthWrite: false })
  );
  beam.position.set(p.x, 20, p.z); beam.frustumCulled = false; G.scene.add(beam);
  G.heli = { mesh: g, rotor, beam, beacon, ang: rand(0, TAU), t: 0 };
  G.hud.showNotif('🚁 Police helicopter inbound');
  if (G.audio && G.audio.siren) G.audio.siren();
}
function despawnHelicopter() {
  if (!G.heli) return;
  G.scene.remove(G.heli.mesh); disposeObject(G.heli.mesh);
  G.scene.remove(G.heli.beam); G.heli.beam.geometry.dispose(); G.heli.beam.material.dispose();
  G.heli = null;
}
export function updateHelicopter(dt) {
  const stars = G.wanted.stars;
  if (stars >= 4 && !G.heli) spawnHelicopter();
  else if (stars < 4 && G.heli) { despawnHelicopter(); return; }
  if (!G.heli) return;
  const h = G.heli, p = G.player.group.position;
  h.ang += dt * 0.5; h.t += dt;
  const tx = p.x + Math.cos(h.ang) * 11, tz = p.z + Math.sin(h.ang) * 11;
  h.mesh.position.x = lerp(h.mesh.position.x, tx, 0.05);
  h.mesh.position.z = lerp(h.mesh.position.z, tz, 0.05);
  h.mesh.position.y = 40 + Math.sin(h.t * 1.3) * 0.6;
  h.mesh.rotation.y = Math.atan2(p.x - h.mesh.position.x, p.z - h.mesh.position.z);
  if (h.rotor) h.rotor.rotation.y += dt * 32;
  h.beam.position.set(h.mesh.position.x, 20, h.mesh.position.z);
  if (h.beacon) h.beacon.material.color.setHex(Math.sin(performance.now() * 0.02) > 0 ? 0xff2222 : 0x2266ff);
  // searchlight: outdoors + roughly under it → the heat stays fresh (can't shake it)
  if (!G._inMall && dist2(h.mesh.position, p) < 55 * 55) G.wanted.lastSeenAt = performance.now();
  if (Math.random() < 0.03 && G.audio && G.audio.blip) G.audio.blip({ freq: 84, dur: 0.07, gain: 0.05, type: 'square' });
}

// ---- Roadblock/ambush (3★+ while driving): drop cop cars on the road ahead so
// the chase comes at you from the front too, not just from behind. ----
function maybeAmbush() {
  const p = G.player;
  if (G.wanted.stars < 3 || !p.inVehicle) return;
  if (performance.now() < (G._ambushCD || 0)) return;
  // don't pile cop cars onto the road indefinitely — respect a population cap
  let copCars = 0;
  for (const cv of G.vehicles) if (cv.isCop && !cv.dead) copCars++;
  const cap = G.wanted.stars >= 4 ? 8 : 6;
  if (copCars >= cap) return;
  G._ambushCD = performance.now() + 20000;   // ~20 s between roadblocks
  const v = p.inVehicle;
  const fx = Math.sin(v.heading), fz = Math.cos(v.heading);
  const rx = fz, rz = -fx, bx = v.pos.x + fx * 55, bz = v.pos.z + fz * 55;
  let n = 0;
  for (let i = -1; i <= 1; i++) {
    if (copCars >= cap) break;
    const cx = clamp(bx + rx * i * 3.6, -HALF + 6, HALF - 6);
    const cz = clamp(bz + rz * i * 3.6, -HALF + 6, HALF - 6);
    const car = spawnCopCar(G.scene, new THREE.Vector3(cx, 0, cz));
    car.heading = v.heading + PI / 2; car.vel = 0; n++; copCars++;
  }
  if (n) G.hud.showNotif('🚧 Roadblock ahead!');
}

export function updateCop(v, dt) {
  // chase player
  const p = G.player;
  const px = p.group.position.x, pz = p.group.position.z;
  const tx0 = px - v.pos.x;
  const tz0 = pz - v.pos.z;
  const d = Math.hypot(tx0, tz0);
  const prevHeading = v.heading;

  // Road-aware steering: at range, route along the 50 m road grid (roads sit on
  // x=k*BLOCK and z=k*BLOCK, ROAD_W wide) so chase cars don't grind the canyon
  // walls. Inside 25 m, drop the routing and pursue/ram directly.
  let targetHeading;
  if (d < 25) {
    targetHeading = Math.atan2(tx0, tz0);
  } else {
    const roadX = Math.round(v.pos.x / BLOCK) * BLOCK;  // nearest NS road centerline
    const roadZ = Math.round(v.pos.z / BLOCK) * BLOCK;  // nearest EW road centerline
    const offX = v.pos.x - roadX;
    const offZ = v.pos.z - roadZ;
    const onNS = Math.abs(offX) < 7;   // within a lane of a north-south road
    const onEW = Math.abs(offZ) < 7;   // within a lane of an east-west road
    let tx, tz;
    if (!onNS && !onEW) {
      // stranded in a block interior — steer back to the nearer centerline first
      if (Math.abs(offX) < Math.abs(offZ)) { tx = roadX; tz = v.pos.z; }
      else { tx = v.pos.x; tz = roadZ; }
    } else if (onNS && onEW) {
      // at an intersection — commit to the axis with farther left to travel
      if (Math.abs(tx0) > Math.abs(tz0)) { tx = px; tz = roadZ; }
      else { tx = roadX; tz = pz; }
    } else if (onNS) {
      tx = roadX; tz = pz;   // run this NS road toward the player's row, turn at the cross street
    } else {
      tz = roadZ; tx = px;   // run this EW road toward the player's column
    }
    targetHeading = Math.atan2(tx - v.pos.x, tz - v.pos.z);
  }
  v.heading = lerpAngle(v.heading, targetHeading, 0.06);
  const target = d > 8 ? v.spec.topSpeed * 0.7 : (d < 4 ? 0 : 4);
  if (v.vel < target) v.vel += v.spec.accel * dt;
  else v.vel -= v.spec.brake * dt;
  let headingDelta = v.heading - prevHeading;
  while (headingDelta > PI) headingDelta -= TAU;
  while (headingDelta < -PI) headingDelta += TAU;
  v.steerAngle = lerp(v.steerAngle || 0, clamp(headingDelta * 6, -0.5, 0.5), 0.28);
  v.pos.x += Math.sin(v.heading) * v.vel * dt;
  v.pos.z += Math.cos(v.heading) * v.vel * dt;
  v.mesh.position.copy(v.pos);
  v.mesh.rotation.y = v.heading;
  updateVehicleVisuals(v, dt, { braking: target < v.vel, reverse: v.vel < -0.1 });
  // ram player vehicle, or run the player down on foot
  if (p.inVehicle && dist2(v.pos, p.inVehicle.pos) < 4*4) {
    p.inVehicle.hp -= 8 * dt;
  } else if (GAMEPLAY.vulnerableOnFoot && !p.inVehicle && Math.abs(v.vel) > 5 && dist2(v.pos, p.group.position) < 3*3) {
    damagePlayer(14 * dt);
  }
}

export function updateFootCops(dt) {
  const p = G.player;
  // is the player aiming a gun? cops armed with guns back off / juke when targeted
  const aiming = !p.inVehicle && p.activeWeapon !== 'fists' && (G.input.rightDown || G.input.mouseDown);
  for (let ci = G.cops.length - 1; ci >= 0; ci--) {
    const c = G.cops[ci];
    if (c.dead) continue;
    if (c.state === 'bribed') {
      // bribed: turn and stroll away from the player, then vanish — don't linger
      // as a frozen ped that refreshes line-of-sight or occupies a cop slot.
      c.idleT = (c.idleT || 0) + dt;
      const aw = Math.atan2(c.mesh.position.x - p.group.position.x, c.mesh.position.z - p.group.position.z);
      c.heading = aw;
      c.mesh.position.x += Math.sin(aw) * (c.speed || 2.0) * dt;
      c.mesh.position.z += Math.cos(aw) * (c.speed || 2.0) * dt;
      c.mesh.rotation.y = aw;
      animateWalk(c.mesh, c.speed || 2.0, dt, true);
      if (c.idleT > 6) { G.scene.remove(c.mesh); disposeObject(c.mesh); G.cops.splice(ci, 1); }
      continue;
    }
    // flinch: a hit briefly staggers them (set in combat.js doBulletRaycast/doMeleeHit)
    if (c.flinchT > 0) { c.flinchT -= dt; animateWalk(c.mesh, 0, dt, false); continue; }
    const dx = p.group.position.x - c.mesh.position.x;
    const dz = p.group.position.z - c.mesh.position.z;
    const d = Math.hypot(dx, dz);
    c.heading = Math.atan2(dx, dz);          // always face the player
    const armed = GAMEPLAY.vulnerableOnFoot && G.wanted.stars >= 2;
    // pick a strafe direction occasionally so a group doesn't bunch into one line
    c.strafeT = (c.strafeT || 0) - dt;
    if (c.strafeT <= 0) { c.strafeDir = Math.random() < 0.5 ? -1 : 1; c.strafeT = rand(0.8, 1.8); }
    // A cop needs an actual line on you to engage. With the line broken they switch
    // to 'seeking' and head for where you were last seen (lastSeenPos is already
    // maintained by raiseWanted) instead of tracking you through a wall.
    const sees = copSeesPlayer(c, dt);
    c.state = sees ? 'engaging' : 'seeking';
    if (!sees) {
      const lp = G.wanted.lastSeenPos;
      const sx = lp.x - c.mesh.position.x, sz = lp.z - c.mesh.position.z;
      const sd = Math.hypot(sx, sz);
      if (sd > 1.2) {
        c.heading = Math.atan2(sx, sz);
        c.mesh.position.x += Math.sin(c.heading) * c.speed * 0.8 * dt;
        c.mesh.position.z += Math.cos(c.heading) * c.speed * 0.8 * dt;
        animateWalk(c.mesh, c.speed * 0.8, dt, true);
      } else {
        animateWalk(c.mesh, 0, dt, false);   // arrived, casting about
        c.heading += dt * 0.9;
      }
      c.mesh.rotation.y = c.heading;
      continue;
    }
    if (armed && d < 22) {
      // hold a firing line: close to ~12 m, then stop and strafe-shoot; back off if crowded
      const want = aiming ? 16 : 12;          // give ground when aimed at
      let mv = 0;
      if (d > want + 2) mv = c.speed;         // advance into range
      else if (d < want - 2) mv = -c.speed * 0.8;   // too close — back off
      c.mesh.position.x += Math.sin(c.heading) * mv * dt;
      c.mesh.position.z += Math.cos(c.heading) * mv * dt;
      // strafe perpendicular to the player (faster while being aimed at = juking)
      const sx = Math.cos(c.heading) * c.strafeDir, sz = -Math.sin(c.heading) * c.strafeDir;
      const strafeSpd = (aiming ? 2.6 : 1.4);
      c.mesh.position.x += sx * strafeSpd * dt;
      c.mesh.position.z += sz * strafeSpd * dt;
      c.shootCooldown -= dt;
      if (c.shootCooldown <= 0) {
        c.shootCooldown = rand(1.4, 2.6);
        G.audio.shot();
        // accuracy falls off with range: point-blank is genuinely dangerous, 20 m is
        // mostly suppressive noise. Replaces a flat 50%-at-any-range coin flip.
        const hitChance = clamp(0.72 - d * 0.026, 0.14, 0.72);
        if (Math.random() < hitChance) {
          damagePlayer(lerp(10, 4, Math.min(1, d / 22)));
          G.camRig.shake = Math.max(G.camRig.shake, 0.08);
        }
      }
      animateWalk(c.mesh, c.speed, dt, mv !== 0 || true);
    } else if (d > 2.5) {
      // unarmed (or out of gun range): close the distance to melee
      c.mesh.position.x += Math.sin(c.heading) * c.speed * dt;
      c.mesh.position.z += Math.cos(c.heading) * c.speed * dt;
      animateWalk(c.mesh, c.speed, dt, true);
    } else {
      // melee attack
      c.shootCooldown -= dt;
      if (c.shootCooldown <= 0) {
        c.shootCooldown = 0.8;
        G.audio.punch();
        damagePlayer(6);
      }
      animateWalk(c.mesh, c.speed, dt, false);
    }
    c.mesh.rotation.y = c.heading;
  }
}

export function gameOver() {
  const busted = G.wanted.stars >= 1;
  G.state = 'dead';                         // set before releasing lock so the pause path doesn't fire
  const el = document.getElementById('gameover');
  if (el) {
    const title = el.querySelector('.go-title');
    title.textContent = busted ? 'BUSTED' : 'WASTED';
    title.style.color = busted ? '#3a7bd5' : '#ff3344';
    title.style.textShadow = `0 0 24px ${busted ? '#3a7bd5' : '#ff3344'}`;
    el.querySelector('.go-sub').textContent = busted ? 'Hauled in. Lost ฿500.' : 'You black out. Lost ฿500.';
    el.classList.add('show');
  }
  document.exitPointerLock();
}

export function respawnPlayer() {
  const p = G.player;
  p.hp = p.hpMax;
  p.armor = 0;
  G.cash = Math.max(0, G.cash - 500);
  G.hud.setCash(G.cash);
  G.wanted.stars = 0;
  G.hud.setStars(0);
  abortHeist();   // a heist you died during is over — no lingering beam or payout
  // clear any active cops — clean slate on respawn
  for (let i = G.cops.length - 1; i >= 0; i--) { G.scene.remove(G.cops[i].mesh); disposeObject(G.cops[i].mesh); G.cops.splice(i, 1); }
  for (let i = G.vehicles.length - 1; i >= 0; i--) { if (G.vehicles[i].isCop) { const cv = G.vehicles[i]; if (cv.smoke) { cv.smoke.life = 0; cv.smoke = null; } G.scene.remove(cv.mesh); disposeObject(cv.mesh); G.vehicles.splice(i, 1); } }
  const home = G.econ.safehouse.owned && G.econ.safehouse.pos;
  const sp = (home ? G.econ.safehouse.pos : G.world.spawns.player).clone();
  p.group.position.copy(sp);
  p.velocity.set(0, 0, 0);
  if (p.inVehicle) { p.inVehicle.driver = null; p.inVehicle = null; p.group.visible = true; }
  if (home) G.hud.showSubtitle('You wake up at home.', 'ตื่นที่บ้าน');
  else G.hud.showSubtitle('You wake up at the police station.', 'ตื่นมาที่โรงพัก');
}

// =============================================================================

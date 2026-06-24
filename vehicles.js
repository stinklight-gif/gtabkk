// =============================================================================
// VEHICLES — extracted from main.js (see numbered sections). No logic change.
// =============================================================================
import * as THREE from 'three';
import {
  makeStaticBaker, PI, TAU, clamp, lerp, rand, irand, pick, sign, dist2, COLORS, G, PRICE, PAINT_COLORS, UPGRADES, rankDiscount, ROAD_WIDTH, PED_TARGET, GAMEPLAY, _camTarget, _camOffset, _fireDir, _ray, _bbox, _vBox, _blackColor, disposeObject, BLOCK, GRID, HALF, lerpAngle
} from './core.js';
import { tip, cycleWeapon, damagePlayer, firePistol, fireSMG, fireShotgun, makeExplosion, makeSmokeEmitter, makeVehicle, onCopKilled, raiseWanted, resolveVehicleVsBuildings, resolveVehicleVsVehicles, saveGame, spawnSkid, updateAmmoHud, updateCop, vehicleName } from './main.js';
import { lightFor } from './traffic.js';

export function updateVehicleVisuals(v, dt, opts={}) {
  const visual = v.visual || (v.mesh && v.mesh.userData && v.mesh.userData.visual);
  if (!visual) return;
  v.wheelSpin = (v.wheelSpin || 0) + v.vel * dt;
  const steer = v.steerAngle || 0;
  for (const w of visual.wheels || []) {
    if (w.spin) w.spin.rotation.x = -v.wheelSpin / Math.max(0.1, w.radius || 0.3);
    if (w.front && w.mount) w.mount.rotation.y = lerp(w.mount.rotation.y || 0, steer, 0.3);
  }
  const headOpacity = (G.nightK || 0) > 0.25 || G.time.weather === 'rain' ? 0.95 : 0.58;
  const brakeOpacity = opts.braking ? 1.0 : 0.48;
  const reverseOpacity = opts.reverse || v.vel < -0.2 ? 0.95 : 0.24;
  for (const l of visual.headlights || []) if (l.material && l.material.opacity != null) l.material.opacity = headOpacity;
  for (const l of visual.brakeLights || []) if (l.material && l.material.opacity != null) l.material.opacity = brakeOpacity;
  for (const l of visual.reverseLights || []) if (l.material && l.material.opacity != null) l.material.opacity = reverseOpacity;
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
    if (v.smoke) v.smoke.life = 0;                       // stop the damage smoke (NPC path does this too)
    if (v.audio) { v.audio.kill(); v.audio = null; }     // stop the engine oscillators
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
    if (v.audio) { v.audio.kill(); v.audio = null; }   // stop the engine oscillators (recreated on re-entry)
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
  const slip = G.festival.type === 'songkran' && v.spec.kind !== 'boat' && v.spec.kind !== 'bike';  // slippery wet roads
  const boost = G.input.down('ShiftLeft');

  const spec = v.spec;
  const inputEase = 1 - Math.pow(0.035, dt);
  v.throttle = lerp(v.throttle || 0, forward > 0 ? 1 : 0, inputEase);
  v.brakeInput = lerp(v.brakeInput || 0, forward < 0 ? 1 : 0, inputEase);
  v.steerInput = lerp(v.steerInput || 0, steer, 1 - Math.pow(0.02, dt));
  const mass = spec.mass || 1500;
  const weight = clamp(1500 / mass, 0.58, 1.25);
  const traction = slip ? 0.72 : 1;
  if (forward > 0) v.vel += spec.accel * v.throttle * (boost ? (spec.nitroAcc || 1.3) : 1) * weight * traction * dt;
  else if (forward < 0) {
    if (v.vel > 0.25) v.vel -= spec.brake * v.brakeInput * dt;
    else v.vel -= spec.accel * 0.55 * v.brakeInput * weight * dt; // reverse
  } else {
    const coast = spec.kind === 'boat' ? 0.992 : slip ? 0.996 : 0.982;
    v.vel *= Math.pow(coast, dt * 60);
  }
  if (handbrake) v.vel *= Math.pow(spec.kind === 'bike' ? 0.965 : 0.93, dt * 60);
  const speedMul = v.tiresBlown ? 0.5 : 1;   // spike strips halve your top speed
  v.vel = clamp(v.vel, -spec.topSpeed * 0.4 * speedMul, spec.topSpeed * (boost ? (spec.nitroTop || 1.15) : 1) * speedMul);
  const speed01 = Math.min(1, Math.abs(v.vel) / Math.max(1, spec.topSpeed));
  const steerLimit = lerp(0.55, 0.34, speed01);
  v.steerAngle = lerp(v.steerAngle || 0, v.steerInput * steerLimit, 0.18);
  const lowSpeed = clamp(Math.abs(v.vel) / 1.2, 0.28, 1);
  const highSpeed = lerp(1, 0.58, speed01);
  const boatMul = spec.kind === 'boat' ? 0.55 : 1;
  v.heading += v.steerAngle * spec.turn * lowSpeed * highSpeed * weight * boatMul * dt * (v.vel >= 0 ? 1 : -1);
  // arcade handbrake drift: extra oversteer + lay rubber while sliding
  if (handbrake && Math.abs(v.vel) > 6 && Math.abs(v.steerInput) > 0.15 && spec.kind !== 'boat' && spec.kind !== 'bike') {
    v.heading += v.steerInput * 1.35 * dt * (v.vel >= 0 ? 1 : -1);
    spawnSkid(v);
  }
  if (slip && !handbrake && Math.abs(v.vel) > 5 && Math.abs(v.steerInput) > 0.1) {   // wet-road slide
    v.heading += v.steerInput * 0.45 * dt * (v.vel >= 0 ? 1 : -1);
    spawnSkid(v);
  }

  // motorbike lean
  if (v.spec.kind === 'bike') {
    v.mesh.rotation.z = lerp(v.mesh.rotation.z || 0, -v.steerInput * 0.35, 0.15);
  } else if (v.spec.kind === 'tuktuk') {
    // tippy oversteer wiggle
    v.mesh.rotation.z = lerp(v.mesh.rotation.z || 0, -v.steerInput * 0.18 + Math.sin(performance.now()*0.01)*0.02, 0.2);
  }

  // apply motion
  v.pos.x += Math.sin(v.heading) * v.vel * dt;
  v.pos.z += Math.cos(v.heading) * v.vel * dt;
  if (v.spec.kind === 'boat') {            // keep the boat in the river channel + ride the swell
    v.pos.x = clamp(v.pos.x, -248, -210);
    v.pos.z = clamp(v.pos.z, -246, 246);
    v.pos.y = 0.3 + Math.sin(performance.now() * 0.002 + v.pos.z * 0.15) * 0.06;
    v.mesh.rotation.z = Math.sin(performance.now() * 0.0016 + v.pos.z * 0.1) * 0.03;
  }
  v.mesh.position.copy(v.pos);
  v.mesh.rotation.y = v.heading;
  updateVehicleVisuals(v, dt, {
    braking: handbrake || (forward < 0 && v.vel > 0.5),
    reverse: forward < 0 && v.vel < -0.1,
  });

  if (v.spec.kind !== 'boat') {
    resolveVehicleVsBuildings(v);
    resolveVehicleVsVehicles(v);
  }

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

// Cardinal directions for grid traffic: 0=N(+z) 1=E(+x) 2=S(-z) 3=W(-x).
const DVX = [0, 1, 0, -1], DVZ = [1, 0, -1, 0], DH = [0, PI / 2, PI, -PI / 2];
const LANESIGN = [-1, 1, 1, -1];   // perpendicular lane offset (left-hand traffic)
const LANE = 2.5, GRID_I = GRID / 2;

function inferDir(h) {
  h = Math.atan2(Math.sin(h), Math.cos(h));
  let best = 0, bd = 9;
  for (let d = 0; d < 4; d++) { const dd = Math.abs(Math.atan2(Math.sin(h - DH[d]), Math.cos(h - DH[d]))); if (dd < bd) { bd = dd; best = d; } }
  return best;
}

export function updateTrafficCar(v, dt) {
  const npc = v.npc;
  const prevHeading = v.heading;
  if (npc.dir === undefined) npc.dir = inferDir(v.heading);
  let dir = npc.dir;

  // --- intersection: maybe turn (straight / left / right), validated against the grid ---
  const even = dir % 2 === 0;                       // N/S travel along z; E/W along x
  const alongVal = even ? v.pos.z : v.pos.x;
  const grid = Math.round(alongVal / BLOCK) * BLOCK;
  npc.turnCD = Math.max(0, (npc.turnCD || 0) - dt);
  if (Math.abs(alongVal - grid) < 2.2 && npc.turnCD === 0) {
    npc.turnCD = 1.3;
    if (Math.random() < 0.45) {
      const nd = Math.random() < 0.5 ? (dir + 1) % 4 : (dir + 3) % 4;   // right / left
      const ix = Math.round(v.pos.x / BLOCK), iz = Math.round(v.pos.z / BLOCK);
      const nx = ix + DVX[nd], nz = iz + DVZ[nd];
      if (nx >= -GRID_I + 1 && nx <= GRID_I && nz >= -GRID_I && nz <= GRID_I) {  // keep out of the river col + off-map
        dir = npc.dir = nd;
        if (even) v.pos.z = grid; else v.pos.x = grid;                  // pivot on the intersection
      }
    }
  }

  // --- lane target on the perpendicular axis ---
  const even2 = dir % 2 === 0;
  const road = Math.round((even2 ? v.pos.x : v.pos.z) / BLOCK) * BLOCK;
  const laneTarget = road + LANE * LANESIGN[dir];

  // --- yield: brake for the nearest obstacle ahead in the lane ---
  const hx = DVX[dir], hz = DVZ[dir];
  let gap = 999;
  const consider = (px, pz, halfLat) => {
    const dx = px - v.pos.x, dz = pz - v.pos.z;
    const fwd = dx * hx + dz * hz, lat = -dx * hz + dz * hx;
    if (fwd > 0.2 && Math.abs(lat) < halfLat) gap = Math.min(gap, fwd);
  };
  for (const o of G.vehicles) if (o !== v) consider(o.pos.x, o.pos.z, 1.8);
  for (const ped of G.peds) if (!ped.dead) consider(ped.mesh.position.x, ped.mesh.position.z, 1.3);
  const pp = G.player.group.position;
  if (!G.player.inVehicle) consider(pp.x, pp.z, 1.6);   // yield to the player on foot

  // obstacle-limited speed (cars / peds / player ahead) + shootout caution
  let obstacleTarget = npc.cruiseSpeed;
  if (gap < 3.5) obstacleTarget = 0;
  else if (gap < 10) obstacleTarget = npc.cruiseSpeed * (gap - 3.5) / 6.5;
  if (G.wanted.stars > 0 && dist2(v.pos, pp) < 22 * 22) obstacleTarget = Math.min(obstacleTarget, npc.cruiseSpeed * 0.4); // cautious during a shootout

  // traffic signal: ease to a halt at the stop line on red/amber — unless already
  // committed into the junction box (then clear it). Stop line is set back from
  // the intersection centre by half a road + a margin; cars queue behind via gap.
  let signalTarget = npc.cruiseSpeed;
  const moveSign = even2 ? DVZ[dir] : DVX[dir];
  const cellNow = Math.round((even2 ? v.pos.z : v.pos.x) / BLOCK) * BLOCK;
  const fwdToLine = (cellNow - (even2 ? v.pos.z : v.pos.x)) * moveSign - (ROAD_WIDTH / 2 + 1.6);
  const sig = lightFor(dir);
  if (sig !== 'green' && fwdToLine > -1.0 && fwdToLine < 16) {
    if (sig === 'amber' && fwdToLine < 2.5) { /* too close to stop safely — clear the box */ }
    else if (fwdToLine <= 0.4) signalTarget = 0;
    else signalTarget = npc.cruiseSpeed * clamp(fwdToLine / 6, 0, 1);
  }

  const target = Math.min(obstacleTarget, signalTarget);
  const braking = target < v.vel - 0.1;
  if (v.vel < target) v.vel = Math.min(target, v.vel + v.spec.accel * dt);
  else v.vel = Math.max(target, v.vel - v.spec.brake * 1.4 * dt);

  // --- move along the cardinal, keep the lane, ease the visual heading around ---
  v.pos.x += hx * v.vel * dt;
  v.pos.z += hz * v.vel * dt;
  if (even2) v.pos.x = lerp(v.pos.x, laneTarget, Math.min(1, dt * 4));
  else       v.pos.z = lerp(v.pos.z, laneTarget, Math.min(1, dt * 4));
  v.pos.x = clamp(v.pos.x, -HALF + 8, HALF - 2);   // out of the river, inside bounds
  v.pos.z = clamp(v.pos.z, -HALF + 2, HALF - 2);
  v.heading = lerpAngle(v.heading, DH[dir], Math.min(1, dt * 6));
  let headingDelta = v.heading - prevHeading;
  while (headingDelta > PI) headingDelta -= TAU;
  while (headingDelta < -PI) headingDelta += TAU;
  v.steerAngle = lerp(v.steerAngle || 0, clamp(headingDelta * 5, -0.5, 0.5), 0.24);
  if (v.spec.kind === 'bike') v.mesh.rotation.z = lerp(v.mesh.rotation.z || 0, -v.steerAngle * 0.7, 0.18);
  else if (v.spec.kind === 'tuktuk') v.mesh.rotation.z = lerp(v.mesh.rotation.z || 0, -v.steerAngle * 0.35, 0.18);
  v.mesh.position.copy(v.pos);
  v.mesh.rotation.y = v.heading;
  updateVehicleVisuals(v, dt, { braking, reverse: v.vel < -0.1 });
  if (v.spec.kind !== 'boat') resolveVehicleVsVehicles(v);

  // honk only when something's actually blocking us while the light is green —
  // not while we're simply waiting our turn at a red.
  const blocked = obstacleTarget < npc.cruiseSpeed * 0.3 && signalTarget > npc.cruiseSpeed * 0.5;
  if (blocked && (npc.honkCooldown -= dt) <= 0) { G.audio.honk(); npc.honkCooldown = rand(2, 6); }
  if (dist2(v.pos, pp) > 220 * 220) respawnTraffic(v, pp);
}

export function isNearGridLine(v) {
  const m = ((v + HALF) % BLOCK) - BLOCK/2;
  return Math.abs(m) < 1.5;
}

export function respawnTraffic(v, playerPos) {
  // place on a nearby road in its proper lane, heading a valid cardinal direction
  const dir = irand(0, 3);
  const r = rand(80, 140), a = rand(0, TAU);
  let x = clamp(playerPos.x + Math.cos(a) * r, -HALF + 12, HALF - 5);
  let z = clamp(playerPos.z + Math.sin(a) * r, -HALF + 5, HALF - 5);
  if (dir % 2 === 0) { const road = clamp(Math.round(x / BLOCK), -GRID_I + 1, GRID_I) * BLOCK; x = road + LANE * LANESIGN[dir]; }
  else               { const road = clamp(Math.round(z / BLOCK), -GRID_I, GRID_I) * BLOCK; z = road + LANE * LANESIGN[dir]; }
  v.pos.set(x, 0, z);
  v.heading = DH[dir]; v.npc.dir = dir; v.npc.turnCD = 0.6;
  v.vel = v.npc.cruiseSpeed * 0.7;
  v.mesh.position.copy(v.pos); v.mesh.rotation.y = v.heading;
}

// =============================================================================
export function updateCamera(dt) {
  const p = G.player;
  const rig = G.camRig;
  // shake decay
  rig.shake *= Math.pow(0.001, dt);
  const shakeX = (Math.random()*2-1) * rig.shake;
  const shakeY = (Math.random()*2-1) * rig.shake;

  if (p.inVehicle) {
    const v = p.inVehicle;
    const speed01 = Math.min(1, Math.abs(v.vel) / Math.max(1, v.spec.topSpeed));
    _camTarget.copy(v.pos);
    _camTarget.y += lerp(1.05, 1.55, speed01);
    const side = (v.steerAngle || 0) * lerp(0.5, 1.35, speed01);
    _camTarget.x += Math.cos(v.heading) * side;
    _camTarget.z += -Math.sin(v.heading) * side;
    const followYaw = v.heading + PI; // behind
    rig.yaw = lerpAngle(rig.yaw, followYaw, dt * lerp(1.15, 2.45, speed01));
    rig.targetDistance = (v.spec.kind === 'bike' ? 4.8 : 6.4) + speed01 * (v.spec.kind === 'boat' ? 1.2 : 2.1);
    rig.pitch = lerp(rig.pitch, -0.13 - speed01 * 0.07, 0.025);
  } else {
    _camTarget.copy(p.group.position); _camTarget.y += 1.5;
    rig.targetDistance = 4.5;
  }
  if (!rig.targetSmooth) rig.targetSmooth = new THREE.Vector3().copy(_camTarget);
  else rig.targetSmooth.lerp(_camTarget, p.inVehicle ? 0.18 : 0.35);
  _camTarget.copy(rig.targetSmooth);
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
      if (G.vehicles[i].isCop) { const cv = G.vehicles[i]; if (cv.smoke) { cv.smoke.life = 0; cv.smoke = null; } G.scene.remove(cv.mesh); disposeObject(cv.mesh); G.vehicles.splice(i, 1); }
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
export const STORABLE = new Set(['bike', 'tuktuk', 'hilux', 'camry', 'sedan', 'songthaew', 'bus', 'luxsedan', 'supercar']);

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
  if (v.audio) { v.audio.kill(); v.audio = null; }   // stop the engine oscillators
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

// ---- Vehicle upgrades: account-wide tuning applied to whatever car you drive.
// Snapshots each vehicle's factory spec once, then recomputes from it so levels
// never compound. nitroAcc/nitroTop default to the stock boost (1.3 / 1.15) so
// an un-upgraded car behaves exactly as before. ----
export function applyUpgrades(v) {
  if (!v || !v.spec) return;
  const u = G.econ.upgrades || {};
  const b = v._baseSpec || (v._baseSpec = { topSpeed: v.spec.topSpeed, accel: v.spec.accel, turn: v.spec.turn });
  const e = u.engine || 0, n = u.nitro || 0, a = u.armor || 0;
  v.spec.topSpeed = b.topSpeed * (1 + 0.09 * e);
  v.spec.accel = b.accel * (1 + 0.12 * e);
  v.spec.turn = b.turn * (1 + 0.05 * e);
  v.spec.nitroAcc = 1.3 + 0.22 * n;    // SHIFT accel multiplier (1.3 → 1.96)
  v.spec.nitroTop = 1.15 + 0.06 * n;   // SHIFT top-speed multiplier (1.15 → 1.33)
  v.spec.armorMul = 1 - 0.18 * a;      // crash-damage multiplier (1 → 0.46)
}

function upgradeRows() {
  const box = document.getElementById('garageup-items');
  if (!box) return;
  box.innerHTML = '';
  const u = G.econ.upgrades;
  for (const up of UPGRADES) {
    const lvl = u[up.id] || 0;
    const maxed = lvl >= up.max;
    const price = maxed ? 0 : Math.round(up.prices[lvl] * (1 - rankDiscount()));   // rank perk: cheaper upgrades
    const dots = '●'.repeat(lvl) + '○'.repeat(up.max - lvl);
    const btn = document.createElement('button');
    const off = rankDiscount() > 0 && !maxed ? ` <span style="color:#7fd0a0;opacity:.8">(-${Math.round(rankDiscount() * 100)}%)</span>` : '';
    btn.innerHTML = `<b>${up.label}</b> ${dots} — ${up.desc}<br>` + (maxed ? '<span style="opacity:.7">MAX</span>' : `Lv ${lvl + 1}: ฿${price.toLocaleString()}${off}`);
    btn.disabled = maxed || G.cash < price;
    btn.addEventListener('click', () => buyUpgrade(up.id));
    box.appendChild(btn);
  }
}
export function openUpgrades() {
  upgradeRows();
  G.state = 'store';                                  // reuse the paused-overlay state
  document.getElementById('garageup').classList.add('show');
  document.exitPointerLock();
}
export function closeUpgrades() {
  document.getElementById('garageup').classList.remove('show');
  G.state = 'playing';
  if (G.input.requestLock) G.input.requestLock();
}
export function buyUpgrade(id) {
  const up = UPGRADES.find(u => u.id === id); if (!up) return;
  const u = G.econ.upgrades, lvl = u[id] || 0;
  if (lvl >= up.max) return;
  const price = Math.round(up.prices[lvl] * (1 - rankDiscount()));   // rank perk: cheaper upgrades
  if (G.cash < price) { G.hud.showNotif('Not enough cash'); return; }
  G.cash -= price; u[id] = lvl + 1; G.hud.setCash(G.cash); G.hud.cashPop(-price);
  if (G.player.inVehicle) applyUpgrades(G.player.inVehicle);   // take effect immediately
  G.hud.showNotif(`${up.label} upgraded to Lv ${lvl + 1}`);
  if (G.audio && G.audio.chime) G.audio.chime();
  saveGame();
  upgradeRows();
}

export function updateGarageOwnership(dt) {
  const p = G.player;
  if (!G.world.garages || !G.world.garages.length) return;
  const g = G.world.garages[0], garage = G.econ.garage;
  if (p.inVehicle) {
    const v = p.inVehicle;
    if (dist2(v.pos, g.pos) >= (g.r + 1) * (g.r + 1)) return;
    if (!garage.rented) { G.hud.showPrompt('Garage — step out and rent it to store cars here', 0.4); return; }
    // only claim the prompt line when U-Spray isn't already offering a repair
    const servicing = v.hp < 100 || G.wanted.stars > 0;
    const storable = STORABLE.has(v.kind);                  // cop cars / boats can't be stored/repainted
    const full = garage.stored.length >= garage.capacity;
    if (!servicing) {
      if (storable) G.hud.showPrompt(full
        ? `Garage full — <b>C</b>: repaint · <b>U</b>: upgrades`
        : `Garage — <b>K</b>: store · <b>C</b>: repaint · <b>U</b>: upgrades`, 0.4);
      else G.hud.showPrompt('Garage — <b>U</b>: vehicle upgrades', 0.4);
    }
    if (G.input.pressed('KeyU')) openUpgrades();
    else if (storable && G.input.pressed('KeyK') && !full) storeVehicle(v);
    else if (storable && G.input.pressed('KeyC')) repaintVehicle(v);
  } else {
    if (dist2(p.group.position, g.pos) >= g.r * g.r) return;
    tip('garage', 'Your garage: rent it (E), then drive a car in to store (K) or repaint (C) it; on foot, E brings one back out.', 'อู่รถ');
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

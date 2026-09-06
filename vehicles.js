// =============================================================================
// VEHICLES — extracted from main.js (see numbered sections). No logic change.
// =============================================================================
import * as THREE from 'three';
import {
  makeStaticBaker, PI, TAU, clamp, lerp, rand, irand, pick, sign, dist2, COLORS, G, PRICE, PAINT_COLORS, UPGRADES, rankDiscount, ROAD_WIDTH, PED_TARGET, GAMEPLAY, trafficTarget, inYaowarat, inFlood, onSoi, onCarriageway, inAirport, _camTarget, _camOffset, _fireDir, _ray, _bbox, _vBox, _blackColor, disposeObject, BLOCK, GRID, HALF, lerpAngle
} from './core.js';
import { tip, cycleWeapon, damagePlayer, firePistol, fireSMG, fireShotgun, makeExplosion, makeSmokeEmitter, makeVehicle, onCopKilled, raiseWanted, resolveVehicleVsBuildings, resolveVehicleVsVehicles, saveGame, spawnSkid, updateCop, updateCopBoat, vehicleName } from './main.js';
import { attachTrafficPillion, syncBikeRider } from './entities.js';
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
  const hazeOn = GAMEPLAY.burningHaze && G.time.weather === 'haze';
  const headOpacity = (G.nightK || 0) > 0.25 || G.time.weather === 'rain' || hazeOn ? 0.95 : 0.58;
  const brakeOpacity = opts.braking ? 1.0 : 0.48;
  const reverseOpacity = opts.reverse || v.vel < -0.2 ? 0.95 : 0.24;
  for (const l of visual.headlights || []) if (l.material && l.material.opacity != null) l.material.opacity = headOpacity;
  for (const l of visual.brakeLights || []) if (l.material && l.material.opacity != null) l.material.opacity = brakeOpacity;
  for (const l of visual.reverseLights || []) if (l.material && l.material.opacity != null) l.material.opacity = reverseOpacity;
  applyVehicleSuspensionVisual(v, dt, opts);
}

function applyLooseImpactMotion(v, dt) {
  const impactSpeed = Math.hypot(v._impactVX || 0, v._impactVZ || 0);
  if (impactSpeed <= 0.02) return;
  v.pos.x += (v._impactVX || 0) * dt;
  v.pos.z += (v._impactVZ || 0) * dt;
  if (Math.abs(v._impactSpin || 0) > 0.01) v.heading += v._impactSpin * dt;
  const decay = Math.pow(0.08, dt);
  v._impactVX *= decay;
  v._impactVZ *= decay;
  v._impactSpin = (v._impactSpin || 0) * decay;
  v.pos.x = clamp(v.pos.x, -HALF + 2, HALF - 2);
  v.pos.z = clamp(v.pos.z, -HALF + 2, HALF - 2);
  if (v.mesh) { v.mesh.position.copy(v.pos); v.mesh.rotation.y = v.heading; }
}

function exciteVehicleKerb(v) {
  if (!v || !v.spec || v.spec.kind === 'boat' || v.spec.kind === 'airliner') return;
  v._suspVel = (v._suspVel || 0) + 0.28;
}

function applyVehicleSuspensionVisual(v, dt, opts = {}) {
  if (!v || !v.mesh || !v.spec || v.spec.kind === 'boat' || v.spec.kind === 'airliner' || dt <= 0) return;
  const spec = v.spec;
  const accelForward = opts.accelForward != null
    ? opts.accelForward
    : ((v.vel || 0) - (v._visualPrevVel == null ? (v.vel || 0) : v._visualPrevVel)) / Math.max(0.001, dt);
  v._visualPrevVel = v.vel || 0;
  const ease = 1 - Math.pow(0.001, dt);
  const pitchTarget = clamp(-accelForward * 0.006, -0.05, 0.06);
  v._pitch = lerp(v._pitch || 0, pitchTarget, ease);

  const aLat = opts.aLat != null ? opts.aLat : (v.vel || 0) * (v._visualYawRate || v.yawRate || 0);
  let rollTarget = clamp((aLat + (v.latVel || 0) * 2) * 0.01, -0.09, 0.09);
  if (spec.kind === 'bike') rollTarget = clamp(-rollTarget * 3, -0.42, 0.42);
  v._roll = lerp(v._roll || 0, rollTarget, ease);

  const onRoad = isNearGridLine(v.pos.x) || isNearGridLine(v.pos.z);
  const rough = (!onRoad && Math.abs(v.vel || 0) > 2) || Math.abs(v.latVel || 0) > 1;
  if (rough) {
    const n = Math.sin((v.pos.x * 12.9898 + v.pos.z * 78.233 + performance.now() * 0.018) * 437.58);
    v._suspVel = (v._suspVel || 0) + n * 0.018;
  }
  v._suspY = v._suspY || 0;
  v._suspVel = v._suspVel || 0;
  v._suspVel += (-v._suspY * 55 - v._suspVel * 8) * dt;
  v._suspY += v._suspVel * dt;
  v._suspY = clamp(v._suspY, -0.08, 0.14);

  const baseRoll = opts.baseRoll || 0;
  const wiggle = opts.wiggleRoll || 0;
  v.mesh.rotation.x = v._pitch;
  v.mesh.rotation.z = baseRoll + v._roll + wiggle;
  v.mesh.position.y = v.pos.y + v._suspY;
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
  if (GAMEPLAY.fireAtTen && v.hp < 10 && v.hp > 0) {
    if (!v._burning) {
      v._burning = true;
      if (!v.smoke) v.smoke = makeSmokeEmitter(v.mesh.position, 1.4);
      else v.smoke.intensity = Math.max(v.smoke.intensity || 1, 1.4);
    }
    v.hp -= 5 * dt;
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
  const boost = G.input.down('ShiftLeft');

  const spec = v.spec;
  const prevVel = v.vel || 0;
  const inputEase = 1 - Math.pow(0.035, dt);
  v.throttle = lerp(v.throttle || 0, forward > 0 ? 1 : 0, inputEase);
  v.brakeInput = lerp(v.brakeInput || 0, forward < 0 ? 1 : 0, inputEase);
  const roadVehicle = spec.kind !== 'boat' && spec.kind !== 'airliner';
  const steerEase = roadVehicle ? (1 - Math.pow(0.0035, dt)) : (1 - Math.pow(0.02, dt));
  v.steerInput = lerp(v.steerInput || 0, steer, steerEase);
  const mass = spec.mass || 1500;
  const weight = clamp(1500 / mass, 0.58, 1.25);
  const speedNow01 = Math.min(1, Math.abs(v.vel) / Math.max(1, spec.topSpeed));
  if (forward > 0) v.vel += spec.accel * v.throttle * (boost ? (spec.nitroAcc || 1.3) : 1) * weight * dt;
  else if (forward < 0) {
    if (v.vel > 0.25) v.vel -= spec.brake * (1 + speedNow01 * 0.35) * v.brakeInput * dt;
    else v.vel -= spec.accel * 0.55 * v.brakeInput * weight * dt; // reverse
  }
  // Resistance runs every frame, not just while coasting: rolling/hull drag plus a
  // quadratic aero term. dragK is solved so the two exactly balance the engine at
  // spec.topSpeed, which makes top speed an emergent terminal velocity instead of a
  // clamp you slam into — and means lifting off at 120 sheds speed much faster than
  // lifting off at 30, the most legible cue that a car has mass. topSpeed keeps its
  // meaning, so nothing that reads it needs retuning.
  const roll = spec.rollDrag !== undefined ? spec.rollDrag : (spec.kind === 'boat' ? 0.35 : 0.55);
  // solved against accel*weight (the actual drive force) so each vehicle still tops
  // out at its own spec.topSpeed — mass shows up as launch character, not a lower ceiling
  const dragK = spec.dragK !== undefined ? spec.dragK
    : Math.max(0.0001, spec.accel * weight - roll) / Math.max(1, spec.topSpeed * spec.topSpeed);
  if (v.vel !== 0) {
    const resist = (roll + dragK * v.vel * v.vel) * dt;
    v.vel -= Math.sign(v.vel) * Math.min(resist, Math.abs(v.vel));   // never drags through zero
  }
  if (forward === 0 && Math.abs(v.vel) < 0.12) v.vel = 0;
  if (handbrake) {
    v.vel *= Math.pow(spec.kind === 'bike' ? 0.94 : 0.93, dt * 60);
    if (GAMEPLAY.vehicleKindFeel && spec.kind === 'bike') v.latVel = (v.latVel || 0) + v.steerAngle * dt * 28;
  }
  const limp = (GAMEPLAY.vehicleLimp && v.hp < 30) ? 0.55 : 1;
  const speedMul = (v.tiresBlown ? 0.5 : 1) * limp;
  v.vel = clamp(v.vel, -spec.topSpeed * (spec.kind === 'airliner' ? 0.22 : 0.4) * speedMul, spec.topSpeed * (boost ? (spec.nitroTop || 1.15) : 1) * speedMul);
  if (GAMEPLAY.floodPatches && (G.time.rainStrength || 0) > 0.7 && inFlood(v.pos.x, v.pos.z) && spec.kind !== 'bike' && spec.kind !== 'boat' && spec.kind !== 'airliner') {
    if (v.vel > 4) v.vel = lerp(v.vel, 4, 1 - Math.pow(0.2, dt));
  }
  if (GAMEPLAY.yaowaratCarHostility && spec.kind !== 'bike' && spec.kind !== 'tuktuk' && spec.kind !== 'boat' && spec.kind !== 'airliner' && inYaowarat(v.pos.x, v.pos.z)) {
    v.vel = clamp(v.vel, -6, 6);
    v._yaoHonk = (v._yaoHonk || 0) - dt;
    if (v._yaoHonk <= 0) { G.audio.honk(); v._yaoHonk = 1.3; }
  }
  const speed01 = Math.min(1, Math.abs(v.vel) / Math.max(1, spec.topSpeed));
  // Weight transfer, using last frame's longitudinal accel (stored below). Braking
  // loads the front axle and gives the car a touch more bite; getting on the power
  // unloads it and washes out. applyVehicleSuspensionVisual already pitches the body
  // on this same number, so what you see and what the car does finally agree.
  // Capped at +/-12% — texture, not a handling rewrite.
  const loadFront = roadVehicle ? clamp(-(v._aLong || 0) / 9, -1, 1) : 0;
  const steerLimit = (roadVehicle ? lerp(0.76, 0.48, speed01) : lerp(0.55, 0.34, speed01)) * (1 + 0.12 * loadFront) * (limp < 1 ? 0.72 : 1);
  const steerResponse = roadVehicle ? 0.32 : 0.18;
  v.steerAngle = lerp(v.steerAngle || 0, v.steerInput * steerLimit, steerResponse);
  const lowSpeed = roadVehicle ? clamp(Math.abs(v.vel) / 0.9, 0.48, 1) : clamp(Math.abs(v.vel) / 1.2, 0.28, 1);
  const highSpeed = roadVehicle ? lerp(1.12, 0.72, speed01) : lerp(1, 0.58, speed01);
  const boatMul = spec.kind === 'boat' ? 0.55 : spec.kind === 'airliner' ? 0.7 : 1;
  const turnAssist = spec.kind === 'boat' ? 1 : spec.kind === 'airliner' ? 1 : spec.kind === 'bike' ? 1.08 : spec.kind === 'tuktuk' ? 1.18 : 1.25;
  const yawArcade = v.steerAngle * spec.turn * lowSpeed * highSpeed * weight * boatMul * turnAssist * (v.vel >= 0 ? 1 : -1);
  let yawTarget = yawArcade;
  if (roadVehicle) {
    const wheelbase = spec.wheelbase || 2.6;
    const yawGeom = (v.vel / Math.max(0.8, wheelbase)) * Math.tan(v.steerAngle || 0);
    yawTarget = lerp(yawArcade, yawGeom, 0.65);
  }
  v.yawRate = lerp(v.yawRate || 0, yawTarget, roadVehicle ? (1 - Math.pow(0.008, dt)) : (1 - Math.pow(0.025, dt)));
  if (Math.abs(v.vel) < 0.08) v.yawRate *= Math.pow(0.35, dt * 60);
  let aLatAchieved = v.vel * (v.yawRate || 0);
  if (roadVehicle) {
    const rain = G.time && G.time.rainStrength || 0;
    const gripDry = spec.grip || 9;
    const gripMul = 1 - 0.45 * rain;
    const aMax = gripDry * gripMul * (handbrake ? 0.35 : 1);
    // Friction circle: a tire only has so much grip, and braking or accelerating
    // spends part of it. Trail-braking into a corner now understeers and power-on
    // pushes the tail, instead of longitudinal and lateral being free of each other.
    // The 0.18 floor keeps this forgiving — you can always still turn something —
    // and the slide bleed below stays on the full aMax so recoveries feel unchanged.
    const aLong = (v.vel - prevVel) / Math.max(0.001, dt);
    v._aLong = aLong;                        // read next frame by the weight-transfer term
    const longUse = clamp(Math.abs(aLong) / Math.max(1, aMax), 0, 1);
    const floor = (GAMEPLAY.vehicleKindFeel && spec.frictionFloor != null) ? spec.frictionFloor : 0.18;
    const aMaxLat = aMax * Math.sqrt(Math.max(floor, 1 - longUse * longUse));
    const demanded = v.vel * (v.yawRate || 0);
    const capped = clamp(demanded, -aMaxLat, aMaxLat);
    let excess = demanded - capped;
    if (spec.kind === 'bike') excess *= 0.4;
    v.latVel = (v.latVel || 0) + excess * dt;
    if (Math.abs(demanded) > aMaxLat && Math.abs(v.vel) > 0.2) {
      v.yawRate *= clamp(aMaxLat / Math.max(0.001, Math.abs(demanded)), 0.22, 1);
    }
    aLatAchieved = v.vel * (v.yawRate || 0);
    const bleed = Math.max(0.6, aMax) * dt;
    v.latVel -= clamp(v.latVel || 0, -bleed, bleed);
    if (Math.abs(v.latVel || 0) > 0.05) {
      v.vel *= 1 - Math.min(0.5, Math.abs(v.latVel || 0) * 0.02) * dt * 60 * 0.01;
    }
  } else {
    v.latVel = 0;
  }
  if (GAMEPLAY.vehicleKindFeel && spec.powerYaw && v.throttle > 0.5 && Math.abs(v.steerAngle) > 0.04) {
    v.yawRate += spec.powerYaw * v.steerAngle * dt * 10;
  }
  if (v.tiresBlown) {
    v._spikeT = (v._spikeT || 0) + dt;
    v.steerAngle += 0.10 + Math.sin(v._spikeT * 3.2) * 0.08;
  }
  v.heading += v.yawRate * dt;
  if (roadVehicle && Math.abs(v.latVel || 0) > 2.5 && Math.abs(v.vel) > 4) {
    spawnSkid(v);
  }
  if (GAMEPLAY.bikeLowside && spec.kind === 'bike' && Math.abs(v.latVel || 0) > 7.2 && Math.abs(v.vel) > 7) {
    p.inVehicle = null; v.driver = null; p.group.visible = true;
    p.group.position.set(v.pos.x + Math.cos(v.heading) * 1.6, 0, v.pos.z - Math.sin(v.heading) * 1.6);
    p.velocity.set(0, 0, 0);
    v.vel = 0; v.latVel = 0; v.yawRate = 0;
    if (v.audio) { v.audio.kill(); v.audio = null; }
    damagePlayer(8);
    G.camRig.shake = Math.max(G.camRig.shake || 0, 0.35);
    if (G.audio && G.audio.hit) G.audio.hit();
    G.hud.showNotif('Lowside!');
    return;
  }

  // apply motion
  const rightX = Math.cos(v.heading), rightZ = -Math.sin(v.heading);
  v.pos.x += Math.sin(v.heading) * v.vel * dt + rightX * (v.latVel || 0) * dt;
  v.pos.z += Math.cos(v.heading) * v.vel * dt + rightZ * (v.latVel || 0) * dt;
  if (v.spec.kind === 'boat') {            // keep the boat in the river channel + ride the swell
    v.pos.x = clamp(v.pos.x, -248, -210);
    v.pos.z = clamp(v.pos.z, -246, 246);
    v.pos.y = 0.3 + Math.sin(performance.now() * 0.002 + v.pos.z * 0.15) * 0.06;
    v.mesh.rotation.z = Math.sin(performance.now() * 0.0016 + v.pos.z * 0.1) * 0.03;
  }
  if (v.spec.kind === 'airliner') {
    const a = G.world && G.world.airport;
    if (a) {
      v.pos.x = clamp(v.pos.x, a.x0 + 10, a.x1 - 8);
      v.pos.z = clamp(v.pos.z, a.z0 + 20, a.z1 - 20);
    }
    v.pos.y = 0;
  }
  v.mesh.position.copy(v.pos);
  v.mesh.rotation.y = v.heading;
  const baseRoll = v.spec.kind === 'bike'
    ? lerp(v._baseRoll || 0, -v.steerInput * 0.22, 0.15)
    : v.spec.kind === 'tuktuk'
      ? lerp(v._baseRoll || 0, -v.steerInput * 0.14, 0.2)
      : 0;
  v._baseRoll = baseRoll;
  updateVehicleVisuals(v, dt, {
    braking: handbrake || (forward < 0 && v.vel > 0.5),
    reverse: forward < 0 && v.vel < -0.1,
    accelForward: (v.vel - prevVel) / Math.max(0.001, dt),
    aLat: aLatAchieved,
    baseRoll,
    wiggleRoll: v.spec.kind === 'tuktuk' ? Math.sin(performance.now()*0.01)*0.02 : 0,
  });

  if (v.spec.kind !== 'boat') {
    resolveVehicleVsBuildings(v);
    resolveVehicleVsVehicles(v);
    if (GAMEPLAY.kerbScrub && spec.kind !== 'airliner' && !onCarriageway(v.pos.x, v.pos.z) && Math.abs(v.vel) > 4) {
      v.vel *= Math.pow(0.52, dt);
      exciteVehicleKerb(v);
    }
  }

  // place player at seat (invisible while inside)
  p.group.visible = false;
  p.group.position.copy(v.pos); p.group.position.y = spec.kind === 'airliner' ? 3.2 : 0.5;

  // audio
  if (!v.audio) {
    v.audio = (v.spec.kind === 'tuktuk') ? G.audio.tukTukLoop() : G.audio.engineLoop({ rpmBase: v.spec.kind === 'bike' ? 110 : v.spec.kind === 'airliner' ? 38 : 70, harsh: v.spec.kind === 'bike' });
  }
  const speed01Audio = clamp(Math.abs(v.vel)/spec.topSpeed, 0, 1);
  v._rpm01 = clamp(speed01Audio * 0.65 + (v.throttle || 0) * 0.28, 0, 1);
  v.audio.set(speed01Audio, true, v.throttle || 0);

  // honk
  if (G.input.pressed('KeyH')) G.audio.honk();

  // drive-by: fire the active gun from the vehicle (combat update doesn't run here)
  if (p.attackCooldown > 0) p.attackCooldown -= dt;
  if (p.gunRecoil > 0) p.gunRecoil = Math.max(0, p.gunRecoil - dt * 6);
  if (G.input.pressed('KeyQ')) cycleWeapon();
  if (p.activeWeapon !== 'fists' && p.weapons[p.activeWeapon]) {
    const firing = G.input.mouseDown || G.input.down('KeyF');
    G.hud.setCrosshair(G.input.rightDown || firing);
    const w = p.activeWeapon;            // 'pistol' | 'smg' | 'shotgun'
    const cd = w === 'smg' ? 0.07 : w === 'shotgun' ? 0.8 : 0.18;
    if (firing && p.attackCooldown <= 0) {
      const ok = w === 'smg' ? fireSMG() : w === 'shotgun' ? fireShotgun() : firePistol();
      if (ok) { p.attackCooldown = cd; p.gunRecoil = 1; }
    }
  } else {
    G.hud.setCrosshair(false);
  }

  // crashing into things — handled by vehicle vs vehicle below

  // ramming peds
  for (const ped of G.peds) {
    if (ped.dead || ped.pillion) continue;
    if (dist2(ped.mesh.position, v.pos) < 1.6*1.6 && Math.abs(v.vel) > 4) {
      killPed(ped);
      raiseWanted(2, 5);
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
  }, 25000);
}

export function updateVehicles(dt) {
  for (const v of G.vehicles) {
    if (v.dead) continue;
    if (v._standHome && v.driver !== 'player') {
      v.pos.set(v._standHome.x, v._standHome.y || 0, v._standHome.z);
      v.heading = v._standHome.heading;
      v.vel = 0; v.latVel = 0; v.yawRate = 0;
      v._impactVX = 0; v._impactVZ = 0; v._impactSpin = 0;
      if (v.mesh) { v.mesh.position.copy(v.pos); v.mesh.rotation.y = v.heading; }
      if (v.hireSign) v.hireSign.visible = true;
      if (GAMEPLAY.bikeHelmets && v.spec && v.spec.kind === 'bike') syncBikeRider(v);
      continue;
    }
    if (v.hireSign) v.hireSign.visible = v.driver !== 'player';
    if (GAMEPLAY.bikeHelmets && v.spec && v.spec.kind === 'bike') syncBikeRider(v);
    if (v.lights) {
      const hazeOn = GAMEPLAY.burningHaze && G.time.weather === 'haze';
      const base = Math.max(G.nightK || 0, hazeOn ? 0.85 : 0);
      v.lights[0].emissiveIntensity = base;   // headlights
      const braking = v.driver === 'player' && (G.input.down('KeyS') || G.input.down('Space'));
      v.lights[1].emissiveIntensity = braking ? Math.max(base, 0.9) : base;  // tail/brake lights
    }
    if (v.driver !== 'player' && !v.npc) applyLooseImpactMotion(v, dt);
    if (v.driver === 'player') continue;
    if (v.spec && v.spec.kind === 'boat' && v.isCop && v.driver) updateCopBoat(v, dt);
    else if (v.spec && v.spec.kind === 'boat' && v.npc) updateNpcBoat(v, dt);
    else if (v.isCop && v.driver) updateCop(v, dt);
    else if (v.npc) updateTrafficCar(v, dt);
    // damage smoke
    if (v.hp < 30 && !v.smoke) {
      v.smoke = makeSmokeEmitter(v.mesh.position, 0.5);
    }
    if (GAMEPLAY.fireAtTen && v.hp < 10 && v.hp > 0) {
      if (!v._burning) {
        v._burning = true;
        if (!v.smoke) v.smoke = makeSmokeEmitter(v.mesh.position, 1.4);
        else v.smoke.intensity = Math.max(v.smoke.intensity || 1, 1.4);
      }
      v.hp -= 5 * dt;
    }
    if (GAMEPLAY.vehicleLimp && v.hp < 40 && !v._dented && v.mesh) {
      v._dented = true;
      v.mesh.traverse(o => { if (o.material && o.material.color && o.material.color.lerp) o.material.color.lerp(_blackColor, 0.22); });
    }
    if (v.hp <= 0 && !v.fire) {
      v.fire = true;
      v.dead = true;
      v.driver = null;
      v.mesh.children.forEach(c => { if (c.material && c.material.color) c.material.color.lerp(_blackColor, 0.6); });
      makeExplosion(v.pos);
      v.vel = 0;
      if (v.isCop) { raiseWanted(2, 9); onCopKilled(); }   // destroying a cruiser reads like killing its crew
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

function pickTrafficDest(v) {
  const ix = Math.round(v.pos.x / BLOCK), iz = Math.round(v.pos.z / BLOCK);
  let dx = ix, dz = iz;
  const hops = irand(2, 5);
  for (let n = 0; n < hops; n++) {
    if (Math.random() < 0.5) dx += Math.random() < 0.5 ? -1 : 1;
    else dz += Math.random() < 0.5 ? -1 : 1;
  }
  dx = clamp(dx, -GRID_I + 1, GRID_I);
  dz = clamp(dz, -GRID_I, GRID_I);
  if (v.spec && v.spec.kind !== 'bike' && v.spec.kind !== 'tuktuk') {
    if (inYaowarat(dx * BLOCK, dz * BLOCK) || onSoi(dx * BLOCK, dz * BLOCK) || inAirport(dx * BLOCK, dz * BLOCK)) {
      dx = clamp(ix + (ix >= 0 ? 2 : -2), -GRID_I + 1, GRID_I);
    }
  }
  v.npc.destI = dx; v.npc.destJ = dz;
}
function nextTrafficDir(v, ix, iz) {
  if (v.npc.destI == null) pickTrafficDest(v);
  const di = v.npc.destI - ix, dj = v.npc.destJ - iz;
  if (Math.abs(di) + Math.abs(dj) < 1) { pickTrafficDest(v); return null; }
  if (Math.abs(di) >= Math.abs(dj) && di !== 0) return di > 0 ? 1 : 3;
  if (dj !== 0) return dj > 0 ? 0 : 2;
  return di > 0 ? 1 : 3;
}

function isAmbientTraffic(v) {
  return !!(v && v.npc && v.npc.kind === 'traffic' && !v.isCop && v.driver !== 'player' && !v.dead && v.spec && v.spec.kind !== 'boat' && v.spec.kind !== 'airliner');
}

export function updateTrafficPopulation(dt) {
  if (!GAMEPLAY.trafficDensity) return;
  const target = trafficTarget();
  let n = 0;
  for (const v of G.vehicles) if (isAmbientTraffic(v)) n++;
  G._trafAcc = Math.min(4, (G._trafAcc || 0) + dt * 6);
  const pp = G.player.group.position;
  if (n < target && G._trafAcc >= 1) {
    G._trafAcc -= 1;
    spawnAmbientTraffic(pp);
  } else if (n > target && G._trafAcc >= 1) {
    G._trafAcc -= 1;
    let fi = -1, fd = 80 * 80;
    for (let i = 0; i < G.vehicles.length; i++) {
      const v = G.vehicles[i];
      if (!isAmbientTraffic(v) || v === G.player.inVehicle) continue;
      const d = dist2(v.pos, pp);
      if (d > fd) { fd = d; fi = i; }
    }
    if (fi >= 0) {
      const v = G.vehicles[fi];
      if (v.pillionPed) {
        const i = G.peds.indexOf(v.pillionPed);
        if (i >= 0) G.peds.splice(i, 1);
        v.pillionPed = null;
      }
      if (v.audio) { v.audio.kill(); v.audio = null; }
      G.scene.remove(v.mesh); disposeObject(v.mesh);
      G.vehicles.splice(fi, 1);
    }
  }
}

function spawnAmbientTraffic(playerPos) {
  const h = ((G.time.dayT % 1) + 1) % 1 * 24;
  const mix = (h >= 2 && h < 5)
    ? ['bike', 'bike', 'tuktuk', 'songthaew', 'camry']
    : (h >= 21 || h < 2)
      ? ['bike', 'bike', 'tuktuk', 'luxsedan', 'sedan']
      : ['camry', 'sedan', 'tuktuk', 'hilux', 'songthaew', 'bus', 'bike'];
  const v = makeVehicle(pick(mix), G.scene);
  const seed = Math.random();
  v.npc = {
    kind: 'traffic', seed, cruiseMul: rand(0.85, 1.15), cruiseSpeed: rand(8, 14),
    followMul: v.spec.kind === 'bus' ? 1.5 : rand(0.8, 1.3),
    amberRunner: seed > 0.7, wanderAmp: rand(0.06, 0.14), honkCooldown: rand(5, 20),
    stopT: v.spec.kind === 'songthaew' ? rand(8, 16) : 0,
  };
  v.npc.cruiseSpeed *= v.npc.cruiseMul;
  respawnTraffic(v, playerPos);
  if (v.spec && v.spec.kind === 'bike' && GAMEPLAY.motosaiStands && Math.random() < 0.4) attachTrafficPillion(v);
  return v;
}

export function updateTrafficCar(v, dt) {
  const npc = v.npc;
  const prevHeading = v.heading;
  if (!(npc.ramPanic > 0)) v.latVel = 0;
  npc.ramPanic = Math.max(0, (npc.ramPanic || 0) - dt);
  if (npc.dir === undefined) npc.dir = inferDir(v.heading);
  let dir = npc.dir;

  // --- intersection: maybe turn (straight / left / right), validated against the grid ---
  const even = dir % 2 === 0;                       // N/S travel along z; E/W along x
  const alongVal = even ? v.pos.z : v.pos.x;
  const grid = Math.round(alongVal / BLOCK) * BLOCK;
  npc.turnCD = Math.max(0, (npc.turnCD || 0) - dt);
  if (Math.abs(alongVal - grid) < 2.2 && npc.turnCD === 0) {
    npc.turnCD = 1.3;
    const ix = Math.round(v.pos.x / BLOCK), iz = Math.round(v.pos.z / BLOCK);
    let nd = null;
    if (GAMEPLAY.trafficDestinations && npc.kind === 'traffic') {
      nd = nextTrafficDir(v, ix, iz);
    } else if (Math.random() < 0.45) {
      nd = Math.random() < 0.5 ? (dir + 1) % 4 : (dir + 3) % 4;
    }
    if (nd != null && nd !== dir) {
      const nx = ix + DVX[nd], nz = iz + DVZ[nd];
      if (nx >= -GRID_I + 1 && nx <= GRID_I && nz >= -GRID_I && nz <= GRID_I) {
        dir = npc.dir = nd;
        if (even) v.pos.z = grid; else v.pos.x = grid;
      }
    }
  }

  // --- lane target on the perpendicular axis ---
  const even2 = dir % 2 === 0;
  const road = Math.round((even2 ? v.pos.x : v.pos.z) / BLOCK) * BLOCK;
  let laneTarget = road + LANE * LANESIGN[dir];

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
  if (GAMEPLAY.dogRoadLife) for (const dog of G.dogs) if (dog && dog.mesh) consider(dog.mesh.position.x, dog.mesh.position.z, 1.1);
  const pp = G.player.group.position;
  if (G.player.inVehicle) consider(G.player.inVehicle.pos.x, G.player.inVehicle.pos.z, 2.6); // yield to the player's vehicle
  else consider(pp.x, pp.z, 1.6);   // yield to the player on foot

  // obstacle-limited speed (cars / peds / player ahead) + shootout caution
  const followMul = npc.followMul || 1;
  let obstacleTarget = npc.cruiseSpeed;
  if (gap < 3.5) obstacleTarget = 0;
  else if (gap < 10 * followMul) obstacleTarget = npc.cruiseSpeed * (gap - 3.5) / (10 * followMul - 3.5);
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
    if (sig === 'amber' && (fwdToLine < 2.5 || npc.amberRunner)) { /* too close or bold enough — clear the box */ }
    else if (fwdToLine <= 0.4) signalTarget = 0;
    else signalTarget = npc.cruiseSpeed * clamp(fwdToLine / 6, 0, 1);
  }

  if (v.spec.kind === 'songthaew') {
    npc.stopT = (npc.stopT || rand(10, 18)) - dt;
    if (npc.stopT > 0 && npc.stopT < 2.4) obstacleTarget = Math.min(obstacleTarget, 0);
    if (npc.stopT <= 0) npc.stopT = rand(12, 22);
  }
  if (GAMEPLAY.burningHaze && G.time.weather === 'haze' && v.spec.kind !== 'bike') {
    obstacleTarget = Math.min(obstacleTarget, npc.cruiseSpeed * 0.68);
    signalTarget = Math.min(signalTarget, npc.cruiseSpeed * 0.68);
  }
  if (GAMEPLAY.yaowaratCarHostility && v.spec.kind !== 'bike' && v.spec.kind !== 'tuktuk' && inYaowarat(v.pos.x, v.pos.z)) {
    obstacleTarget = Math.min(obstacleTarget, 5);
  }
  if (GAMEPLAY.floodPatches && (G.time.rainStrength || 0) > 0.7 && inFlood(v.pos.x, v.pos.z) && v.spec.kind !== 'bike') {
    obstacleTarget = Math.min(obstacleTarget, 4);
  }
  if (GAMEPLAY.nightCheckpoint && G.checkpoint && G.checkpoint.active) {
    const dx = v.pos.x - G.checkpoint.x, dz = v.pos.z - G.checkpoint.z;
    if (dx * dx + dz * dz < 18 * 18) {
      const cap = (GAMEPLAY.twoAmCheckpoint && G.checkpoint.late) ? 2.2 : 3.2;
      obstacleTarget = Math.min(obstacleTarget, cap);
      signalTarget = Math.min(signalTarget, cap);
    }
  }
  const target = Math.min(obstacleTarget, signalTarget);
  const braking = target < v.vel - 0.1;
  if (v.vel < target) v.vel = Math.min(target, v.vel + v.spec.accel * dt);
  else v.vel = Math.max(target, v.vel - v.spec.brake * 1.4 * dt);

  // --- move along the cardinal, keep the lane, ease the visual heading around ---
  v.pos.x += hx * v.vel * dt;
  v.pos.z += hz * v.vel * dt;
  if (npc.ramPanic > 0) {
    const rx = Math.cos(v.heading), rz = -Math.sin(v.heading);
    v.pos.x += rx * (v.latVel || 0) * dt;
    v.pos.z += rz * (v.latVel || 0) * dt;
    v.heading += (v.latVel || 0) * 0.12 * dt;
    v.latVel = (v.latVel || 0) * Math.pow(0.22, dt);
  }
  const blockedForBike = v.spec.kind === 'bike' && obstacleTarget < npc.cruiseSpeed * 0.35 && v.vel < npc.cruiseSpeed * 0.3 && signalTarget > 0.1;
  if (blockedForBike) laneTarget += LANESIGN[dir] * (GAMEPLAY.bikeFilterWide ? 2.05 : 1.05);
  if (GAMEPLAY.bikeFilterWide && blockedForBike && v.vel < 4) laneTarget += LANESIGN[dir] * 0.85;
  laneTarget += Math.sin((performance.now() * 0.001) * 0.3 + (npc.seed || 0)) * (npc.wanderAmp || 0.12);
  const laneEase = Math.min(1, dt * (npc.ramPanic > 0 ? 0.65 : (blockedForBike ? 2.0 : 4)));
  if (even2) v.pos.x = lerp(v.pos.x, laneTarget, laneEase);
  else       v.pos.z = lerp(v.pos.z, laneTarget, laneEase);
  v.pos.x = clamp(v.pos.x, -HALF + 8, HALF - 2);   // out of the river, inside bounds
  v.pos.z = clamp(v.pos.z, -HALF + 2, HALF - 2);
  v.heading = lerpAngle(v.heading, DH[dir], Math.min(1, dt * (npc.ramPanic > 0 ? 1.8 : 6)));
  const impactSpeed = Math.hypot(v._impactVX || 0, v._impactVZ || 0);
  if (impactSpeed > 0.02) {
    v.pos.x += (v._impactVX || 0) * dt;
    v.pos.z += (v._impactVZ || 0) * dt;
    const decay = Math.pow(0.08, dt);
    v._impactVX *= decay;
    v._impactVZ *= decay;
    if (Math.abs(v._impactSpin || 0) > 0.01) {
      v.heading += v._impactSpin * dt;
      v._impactSpin *= decay;
    }
    v.pos.x = clamp(v.pos.x, -HALF + 8, HALF - 2);
    v.pos.z = clamp(v.pos.z, -HALF + 2, HALF - 2);
  }
  let headingDelta = v.heading - prevHeading;
  while (headingDelta > PI) headingDelta -= TAU;
  while (headingDelta < -PI) headingDelta += TAU;
  v.steerAngle = lerp(v.steerAngle || 0, clamp(headingDelta * 5, -0.5, 0.5), 0.24);
  v._visualYawRate = headingDelta / Math.max(0.001, dt);
  v.mesh.position.copy(v.pos);
  v.mesh.rotation.y = v.heading;
  const baseRoll = v.spec.kind === 'bike' ? -v.steerAngle * 0.42 : v.spec.kind === 'tuktuk' ? -v.steerAngle * 0.24 : 0;
  updateVehicleVisuals(v, dt, { braking, reverse: v.vel < -0.1, aLat: v.vel * v._visualYawRate, baseRoll });
  if (v.spec.kind !== 'boat') {
    resolveVehicleVsVehicles(v);
    const onLane = Math.abs(((dir % 2 === 0 ? v.pos.x : v.pos.z) - road)) < 4;
    if (npc.ramPanic > 0 || !onLane) resolveVehicleVsBuildings(v);
  }

  // honk only when something's actually blocking us while the light is green —
  // not while we're simply waiting our turn at a red.
  const blocked = obstacleTarget < npc.cruiseSpeed * 0.3 && signalTarget > npc.cruiseSpeed * 0.5;
  if (blocked && (npc.honkCooldown -= dt) <= 0) { G.audio.honk(); npc.honkCooldown = rand(2, 6); }
  if (dist2(v.pos, pp) > 220 * 220) respawnTraffic(v, pp);
}

export function updateNpcBoat(v, dt) {
  const npc = v.npc;
  if (!npc) return;
  const cruise = npc.cruise || 7;
  if (v.vel < cruise) v.vel = Math.min(cruise, v.vel + 4 * dt);
  else v.vel = Math.max(cruise, v.vel - 3 * dt);
  const dir = npc.dir >= 0 ? 1 : -1;
  v.heading = dir > 0 ? 0 : PI;
  v.pos.z += dir * v.vel * dt;
  if (v.pos.z > HALF - 28) { npc.dir = -1; v.heading = PI; }
  if (v.pos.z < -HALF + 28) { npc.dir = 1; v.heading = 0; }
  v.pos.x = clamp(v.pos.x, -248, -210);
  v.pos.y = 0.3 + Math.sin(performance.now() * 0.002 + v.pos.z * 0.15) * 0.06;
  v.mesh.position.copy(v.pos);
  v.mesh.rotation.y = v.heading;
  v.mesh.rotation.z = Math.sin(performance.now() * 0.0016 + v.pos.z * 0.1) * 0.03;
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
  v.latVel = 0; v.yawRate = 0; v._impactVX = 0; v._impactVZ = 0; v._impactSpin = 0;
  if (v.npc) pickTrafficDest(v);
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
    const accel = ((v.vel || 0) - (rig._vehPrevVel == null ? (v.vel || 0) : rig._vehPrevVel)) / Math.max(0.001, dt);
    rig._vehPrevVel = v.vel || 0;
    rig._followStretch = lerp(rig._followStretch || 0, clamp(accel * 0.045, -0.45, 0.6), 1 - Math.pow(0.08, dt));
    _camTarget.copy(v.pos);
    _camTarget.y += v.spec.kind === 'airliner' ? lerp(4.2, 5.4, speed01) : lerp(1.05, 1.55, speed01);
    const side = (v.steerAngle || 0) * lerp(0.5, 1.35, speed01);
    _camTarget.x += Math.cos(v.heading) * side;
    _camTarget.z += -Math.sin(v.heading) * side;
    const followYaw = v.heading + PI; // behind
    rig.yaw = lerpAngle(rig.yaw, followYaw, dt * lerp(1.15, 2.45, speed01));
    const baseDist = v.spec.kind === 'bike' ? 4.8 : v.spec.kind === 'tuktuk' ? 5.6 : v.spec.kind === 'airliner' ? 22 : 6.4;
    rig.targetDistance = baseDist + speed01 * (v.spec.kind === 'boat' ? 1.2 : v.spec.kind === 'airliner' ? 4 : 2.1) + (rig._followStretch || 0);
    rig.pitch = lerp(rig.pitch, (v.spec.kind === 'airliner' ? -0.28 : -0.13) - speed01 * 0.07, 1 - Math.pow(0.975, dt * 60));
  } else {
    if (p.inCover && p.coverPeek) {
      _camTarget.set(p.coverPeek.x, p.coverPeek.y, p.coverPeek.z);
    } else {
      _camTarget.copy(p.group.position); _camTarget.y += 1.5;
    }
    if (p.isSprinting) {
      rig._sprintBobPhase = (rig._sprintBobPhase || 0) + dt * 13.5;
      _camTarget.y += Math.sin(rig._sprintBobPhase) * 0.03;
    }
    rig.targetDistance = 4.5;
    rig._vehPrevVel = null;
    rig._followStretch = lerp(rig._followStretch || 0, 0, 1 - Math.pow(0.08, dt));
  }
  const targetEase = p.inVehicle ? (1 - Math.pow(0.82, dt * 60)) : (1 - Math.pow(0.65, dt * 60));
  if (!rig.targetSmooth) rig.targetSmooth = new THREE.Vector3().copy(_camTarget);
  else rig.targetSmooth.lerp(_camTarget, targetEase);
  _camTarget.copy(rig.targetSmooth);
  rig.distance = lerp(rig.distance, rig.targetDistance, 1 - Math.pow(0.92, dt * 60));
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
  const targetFov = 72 + sp01 * sp01 * 9;
  if (Math.abs(rig.cam.fov - targetFov) > 0.05) { rig.cam.fov = lerp(rig.cam.fov, targetFov, 1 - Math.pow(0.94, dt * 60)); rig.cam.updateProjectionMatrix(); }
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
    G.wanted.crime = 0;      // a respray clears the accumulated heat too, not just the stars
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

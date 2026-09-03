// =============================================================================
// COMBAT — extracted from main.js (see numbered sections). No logic change.
// =============================================================================
import * as THREE from 'three';
import {
  makeStaticBaker, PI, TAU, clamp, lerp, rand, irand, pick, sign, dist2, COLORS, G, PRICE, PAINT_COLORS, ROAD_WIDTH, PED_TARGET, GAMEPLAY, _camTarget, _camOffset, _fireDir, _ray, _bbox, _vBox, _blackColor, disposeObject, BLOCK, GRID, HALF, lerpAngle
} from './core.js';
import { killCop, killPed, raiseWanted, spawnBark } from './main.js';

// pooled fire FX lights (combat-local mutable state)
let _muzzleLight = null, _sparkLight = null, _muzzleT = 0, _sparkT = 0;
// pooled muzzle-flash sprite parented to the held gun (reused every shot)
let _muzzleFlash = null, _muzzleFlashT = 0;
const _muzzleWorld = new THREE.Vector3();
const _bodyPoint = new THREE.Vector3();
const _bodyClosest = new THREE.Vector3();

// Brief expanding spark/puff at a bullet's hit point — reuses the G.dust pool
// (updateDust fades + frees it) so we add no new per-frame system. Cheap: ~6 pts.
export function spawnImpactSpark(point) {
  const n = 6;
  const geo = new THREE.BufferGeometry();
  const pos = new Float32Array(n * 3), vel = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    pos[i * 3] = point.x; pos[i * 3 + 1] = point.y; pos[i * 3 + 2] = point.z;
    const a = Math.random() * TAU, sp = rand(2, 6);
    vel[i * 3] = Math.cos(a) * sp; vel[i * 3 + 1] = rand(0.5, 3); vel[i * 3 + 2] = Math.sin(a) * sp;
  }
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  const mat = new THREE.PointsMaterial({ color: 0xffd070, size: 0.32, transparent: true, opacity: 0.95, depthWrite: false });
  const pts = new THREE.Points(geo, mat); pts.frustumCulled = false; G.scene.add(pts);
  G.dust.push({ pts, vel, life: 0.6 });
}

// Flash the held gun's muzzle (own pooled sprite) and pop the crosshair as a
// hitmarker when a shot connects. Both are faded in updateBullets.
function flashMuzzle() {
  const gun = G.player.pistol;
  if (!_muzzleFlash) {
    const mat = new THREE.SpriteMaterial({ color: 0xfff0b0, transparent: true, opacity: 0, depthWrite: false, depthTest: false });
    _muzzleFlash = new THREE.Sprite(mat);
    _muzzleFlash.scale.set(0.78, 0.78, 1);
  }
  if (_muzzleFlash.parent !== gun) { gun.add(_muzzleFlash); }
  _muzzleFlash.position.set(0, 0, 0.54);          // out past the barrel
  _muzzleFlash.material.opacity = 0.95;
  _muzzleFlashT = 0.05;
}
function hitMarker() { if (G.hud && G.hud.hitMarker) G.hud.hitMarker(); }

function gunTriggerDown() {
  return !!(G.input && (G.input.mouseDown || G.input.down('KeyF')));
}

function setHeldGunPose(kind, recoil) {
  const p = G.player;
  p.pistol.visible = true;
  p.armR.rotation.x = -1.2 + recoil * 0.42;
  p.armR.rotation.y = -0.08;
  p.armR.rotation.z = 0.16;
  p.armL.rotation.x = -0.72 + recoil * 0.16;
  p.armL.rotation.y = 0.08;
  p.armL.rotation.z = -0.22;
  p.pistol.position.set(0.03, -0.64, 0.07 - recoil * 0.025);
  p.pistol.rotation.set(-0.05 - recoil * 0.18, 0, 0);
  const longGun = kind === 'smg' || kind === 'shotgun';
  p.pistol.scale.set(1.18, 1.18, longGun ? 1.55 : 1.18);
}

function getMuzzleWorld() {
  const gun = G.player && G.player.pistol;
  if (!gun) return _muzzleWorld.copy(G.camera.position);
  gun.updateWorldMatrix(true, false);
  return gun.localToWorld(_muzzleWorld.set(0, 0, 0.54));
}

function spawnShotTracer(start, dir, len = 70, color = 0xfff0aa, life = 0.075) {
  const end = start.clone().addScaledVector(dir, len);
  const geo = new THREE.BufferGeometry().setFromPoints([start.clone(), end]);
  const mat = new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.9, depthWrite: false });
  const line = new THREE.Line(geo, mat);
  line.frustumCulled = false;
  G.scene.add(line);
  G.bullets.push({ mesh: line, life, maxLife: life, fade: true, dispose: true });
}

function spawnRicochetTrail(point) {
  const dir = new THREE.Vector3(rand(-0.7, 0.7), rand(0.25, 0.9), rand(-0.7, 0.7)).normalize();
  spawnShotTracer(point, dir, rand(1.6, 3.4), 0xffd070, 0.09);
}

function actorBodyRayHit(actor, origin, dir, far) {
  const pos = actor.mesh.position;
  let best = null;
  // Three sample points approximate a standing body. The radius grows slightly
  // with range so third-person camera shots hit what reads as centered on screen.
  for (const yOff of [0.55, 1.05, 1.5]) {
    _bodyPoint.set(pos.x, pos.y + yOff, pos.z);
    const t = _bodyPoint.sub(origin).dot(dir);
    if (t < 0.8 || t > far) continue;
    _bodyClosest.copy(origin).addScaledVector(dir, t);
    const d = _bodyClosest.distanceTo(_bodyPoint.add(origin));
    const r = Math.min(1.25, 0.46 + t * 0.018);
    if (d <= r && (!best || t < best.dist)) {
      best = { dist: t, point: _bodyClosest.clone(), target: actor };
    }
  }
  return best;
}

// 14. COMBAT — melee + pistol
// =============================================================================

// Cycle fists -> pistol -> SMG through whatever's owned. Used on foot and in cars.
export function cycleWeapon() {
  const p = G.player;
  const owned = ['fists'];
  if (p.weapons.pistol) owned.push('pistol');
  if (p.weapons.smg) owned.push('smg');
  if (p.weapons.shotgun) owned.push('shotgun');
  const idx = owned.indexOf(p.activeWeapon);
  p.activeWeapon = owned[(idx + 1) % owned.length];
  p.pistol.visible = (p.activeWeapon !== 'fists');
  updateAmmoHud();
}

export function updateCombat(dt) {
  const p = G.player;
  if (p.attackTimer > 0) p.attackTimer -= dt;
  if (p.attackCooldown > 0) p.attackCooldown -= dt;
  if (p.hitFlashT > 0) p.hitFlashT -= dt;
  if (p.gunRecoil > 0) p.gunRecoil = Math.max(0, p.gunRecoil - dt * 6);

  // weapon cycle
  if (G.input.pressed('KeyQ')) cycleWeapon();
  // pickup pistol (give it to player after first cop kill or via cheat)
  if (G.input.pressed('KeyG')) { // dev: grant pistol
    p.weapons.pistol = true; p.activeWeapon = 'pistol'; p.pistolAmmo = p.pistolMag; updateAmmoHud(); G.hud.showNotif('+9mm Pistol equipped');
  }

  // block
  p.blocking = G.input.down('ControlLeft');

  // reload (scoped to the active gun)
  if (G.input.pressed('KeyR') && p.activeWeapon === 'pistol' && p.pistolAmmo < p.pistolMag && p.pistolReserve > 0) {
    const need = p.pistolMag - p.pistolAmmo;
    const take = Math.min(need, p.pistolReserve);
    p.pistolAmmo += take; p.pistolReserve -= take;
    G.audio.reload(); updateAmmoHud();
  }
  if (G.input.pressed('KeyR') && p.activeWeapon === 'smg' && p.smgAmmo < p.smgMag && p.smgReserve > 0) {
    const need = p.smgMag - p.smgAmmo;
    const take = Math.min(need, p.smgReserve);
    p.smgAmmo += take; p.smgReserve -= take;
    G.audio.reload(); updateAmmoHud();
  }
  if (G.input.pressed('KeyR') && p.activeWeapon === 'shotgun' && p.shotgunAmmo < p.shotgunMag && p.shotgunReserve > 0) {
    const need = p.shotgunMag - p.shotgunAmmo;
    const take = Math.min(need, p.shotgunReserve);
    p.shotgunAmmo += take; p.shotgunReserve -= take;
    G.audio.reload(); updateAmmoHud();
  }

  // attack — F (melee) or LMB / F for pistol
  if (p.activeWeapon === 'fists') {
    p.pistol.visible = false;
    p.pistol.scale.setScalar(1.18);
    p.armL.rotation.y *= 0.85; p.armR.rotation.y *= 0.85;
    p.armL.rotation.z = lerp(p.armL.rotation.z, -0.12, 0.2);
    p.armR.rotation.z = lerp(p.armR.rotation.z, 0.12, 0.2);
    // combo window ticks down between swings; let it lapse and the chain resets
    if (p.comboWindow > 0) { p.comboWindow -= dt; if (p.comboWindow <= 0) p.comboStep = 0; }
    if (G.input.pressed('KeyF') && p.attackCooldown <= 0 && p.stam > 8) {
      // chain jab -> jab -> cross finisher; press in rhythm to advance the step
      const combo = ['jab', 'jab', 'cross'];
      const step = p.comboStep % combo.length;
      const kind = step === 2 ? pick(['cross', 'kick', 'teep']) : combo[step];
      const finisher = step === 2;
      p.attackKind = kind;
      p.attackTimer = p.attackDur = finisher ? 0.28 : 0.22;
      p.attackCooldown = finisher ? 0.4 : 0.26;    // snappier mid-combo, longer recovery on the finisher
      p.stam = Math.max(0, p.stam - 8);
      // advance the chain; the finisher loops back to a fresh jab
      p.comboStep = finisher ? 0 : p.comboStep + 1;
      p.comboWindow = 0.55;                          // time to keep the rhythm going
      doMeleeHit(kind, finisher);
    }
    if (p.attackTimer > 0) {
      // animate (normalize against this swing's duration so the phase reads 0->1)
      const t = 1 - p.attackTimer / (p.attackDur || 0.25);
      if (p.attackKind === 'jab') {
        p.armL.rotation.x = -Math.sin(t * PI) * 1.4;
      } else if (p.attackKind === 'cross') {
        p.armR.rotation.x = -Math.sin(t * PI) * 1.6;
      } else if (p.attackKind === 'kick') {
        p.legs.rotation.x = Math.sin(t * PI) * 1.2;
      } else if (p.attackKind === 'teep') {
        p.legs.rotation.x = Math.sin(t * PI) * 1.05;
      }
    }
    G.hud.setCrosshair(false);
  } else if (p.activeWeapon === 'pistol' && p.weapons.pistol) {
    // raise the right arm to aim; it kicks back on each shot (gunRecoil)
    const recoil = p.gunRecoil || 0;
    setHeldGunPose('pistol', recoil);

    const firing = gunTriggerDown();
    G.hud.setCrosshair(G.input.rightDown || firing);
    if (firing && p.attackCooldown <= 0 && firePistol()) {
      p.attackCooldown = 0.18;
      p.gunRecoil = 1;
    }
  } else if (p.activeWeapon === 'smg' && p.weapons.smg) {
    // reuse the held-weapon model
    const recoil = p.gunRecoil || 0;
    setHeldGunPose('smg', recoil);
    const firing = gunTriggerDown();
    G.hud.setCrosshair(G.input.rightDown || firing);
    if (firing && p.attackCooldown <= 0 && fireSMG()) {
      p.attackCooldown = 0.07;   // fast, full-auto
      p.gunRecoil = 1;
    }
  } else if (p.activeWeapon === 'shotgun' && p.weapons.shotgun) {
    const recoil = p.gunRecoil || 0;
    setHeldGunPose('shotgun', recoil);
    const firing = gunTriggerDown();
    G.hud.setCrosshair(G.input.rightDown || firing);
    if (firing && p.attackCooldown <= 0 && fireShotgun()) {
      p.attackCooldown = 0.8;   // slow, punchy
      p.gunRecoil = 1;
    }
  }
}

function takeAmmo(gun) {
  if (!GAMEPLAY.honestAmmo) return true;
  const p = G.player;
  const mag = gun === 'smg' ? 'smgAmmo' : gun === 'shotgun' ? 'shotgunAmmo' : 'pistolAmmo';
  if ((p[mag] || 0) <= 0) { if (G.audio && G.audio.reload) G.audio.reload(); return false; }
  p[mag] -= 1;
  updateAmmoHud();
  return true;
}

export function updateAmmoHud() {
  const p = G.player;
  if (p.activeWeapon === 'fists') G.hud.setAmmo('FISTS', 'MUAY THAI');
  else if (!GAMEPLAY.honestAmmo) {
    if (p.activeWeapon === 'smg') G.hud.setAmmo('∞', 'SMG');
    else if (p.activeWeapon === 'shotgun') G.hud.setAmmo('∞', 'SHOTGUN');
    else G.hud.setAmmo('∞', '9MM PISTOL');
  } else if (p.activeWeapon === 'smg') G.hud.setAmmo(`${p.smgAmmo} | ${p.smgReserve}`, 'SMG');
  else if (p.activeWeapon === 'shotgun') G.hud.setAmmo(`${p.shotgunAmmo} | ${p.shotgunReserve}`, 'SHOTGUN');
  else G.hud.setAmmo(`${p.pistolAmmo} | ${p.pistolReserve}`, '9MM PISTOL');
}

export function triggerHitStop(s) { G.hitStop = Math.max(G.hitStop || 0, s); }

export function doMeleeHit(kind, finisher = false) {
  const p = G.player;
  const fx = -Math.sin(p.yaw), fz = -Math.cos(p.yaw);
  // search nearby peds/cops/dogs in front
  let hitSomething = false;
  for (const list of [G.peds, G.cops]) {
    for (const target of list) {
      if (target.dead) continue;
      const tx = target.mesh.position.x - p.group.position.x;
      const tz = target.mesh.position.z - p.group.position.z;
      const fwd = tx*fx + tz*fz;
      const side = -tx*fz + tz*fx;
      const d2 = tx*tx + tz*tz;
      if (fwd > 0 && fwd < 1.7 && Math.abs(side) < 1.0 && d2 < 4) {
        // finisher hits harder; kick/cross outdamage the jab
        let dmg = (kind === 'kick' ? 22 : kind === 'cross' ? 18 : kind === 'teep' ? 16 : 12);
        if (finisher) dmg = Math.round(dmg * 1.6);
        if (kind === 'teep' && list === G.peds) { target.knockX = fx * 5; target.knockZ = fz * 5; }
        target.hp -= dmg;
        target.panicT = 6;
        target.flinchT = 0.18;                              // stagger on the AI side
        hitSomething = true;
        // finisher knocks the target back (peds decay knockX/knockZ in updatePeds;
        // cops have no knock field so nudge their mesh directly)
        if (finisher) {
          if (list === G.peds) { target.knockX = fx * 7; target.knockZ = fz * 7; }
          else { target.mesh.position.x += fx * 0.6; target.mesh.position.z += fz * 0.6; }
        }
        triggerHitStop(finisher ? 0.09 : kind === 'kick' ? 0.07 : 0.05);   // freeze-frame the impact
        G.camRig.shake = Math.max(G.camRig.shake, finisher ? 0.22 : kind === 'kick' ? 0.16 : 0.1);
        if (target.hp <= 0) {
          if (G.cops.includes(target)) killCop(target);
          else killPed(target);
        }
        // bumping a ped raises minor heat once
        noteMonkCrime(target);
        if (!target._notedAggression) {
          target._notedAggression = true;
          if (G.wanted.stars < 1) {
            raiseWanted(1);
            G.hud.showNotif('Assault witnessed — ★');
            G.audio.whistle();
          }
        }
      }
    }
  }
  if (kind === 'kick') G.audio.kick(); else G.audio.punch();
  if (hitSomething) { G.audio.hit(); hitMarker(); }   // crosshair pop confirms the connect
}

// Scatter nearby pedestrians (gunfire / explosions) — reuses the flee/panic AI.
export function scarePeds(pos, radius) {
  const r2 = radius * radius;
  for (const ped of G.peds) {
    if (ped.dead) continue;
    if (dist2(ped.mesh.position, pos) < r2) {
      const dx = ped.mesh.position.x - pos.x, dz = ped.mesh.position.z - pos.z;
      const d = Math.hypot(dx, dz) || 1;
      ped.heading = Math.atan2(dx, dz);
      ped.panicFrom = { x: pos.x, z: pos.z };
      ped.panicT = Math.max(ped.panicT, 5.5);
      ped.knockX = (ped.knockX || 0) + dx / d * 1.2;
      ped.knockZ = (ped.knockZ || 0) + dz / d * 1.2;
      ped._barkCD = Math.min(ped._barkCD || 0, 0.2);
      if ((!G.barks || G.barks.length < 8) && Math.random() < 0.18) spawnBark(ped);
    }
  }
}

function noteMonkCrime(target) {
  if (!GAMEPLAY.monkHeat || !target) return;
  const kind = target.kind || (target.mesh && target.mesh.userData && target.mesh.userData.kind);
  if (kind !== 'monk' || target._monkNoted) return;
  target._monkNoted = true;
  raiseWanted(2, 5);
  G.hud.showNotif('You hit a monk — ★★');
}

export function firePistol() {
  if (!takeAmmo('pistol')) return false;
  const origin = getMuzzleWorld();
  G.camera.getWorldDirection(_fireDir);
  // pistol stays accurate — only a whisper of spread so it's not laser-perfect
  _fireDir.x += rand(-0.006, 0.006);
  _fireDir.y += rand(-0.006, 0.006);
  _fireDir.normalize();
  // pooled muzzle flash — reused every shot, faded out in updateBullets
  if (!_muzzleLight) { _muzzleLight = new THREE.PointLight(0xffd577, 0, 6, 2); G.scene.add(_muzzleLight); }
  _muzzleLight.position.copy(origin);
  _muzzleLight.intensity = 2.5; _muzzleT = 0.06;
  flashMuzzle();                              // visible flash at the gun barrel
  G.player.gunRecoil = 1;                     // arm/gun kick (decays in updateCombat)
  spawnShotTracer(origin, _fireDir, 78, 0xfff0aa, 0.07);
  // spawn tracer bullet (visual only; the hit is the raycast below)
  const bullet = new THREE.Mesh(G.bulletGeom, G.bulletMat);
  bullet.position.copy(origin); G.scene.add(bullet);
  G.bullets.push({ mesh: bullet, vel: _fireDir.clone().multiplyScalar(80), life: 1.0 });
  G.audio.shot();
  G.camRig.shake = Math.max(G.camRig.shake, 0.07);
  if (doBulletRaycast(G.camera.position, _fireDir)) { hitMarker(); G.audio.hit(); }
  scarePeds(origin, 14);
  return true;
}

export function fireSMG() {
  if (!takeAmmo('smg')) return false;
  const origin = getMuzzleWorld();
  G.camera.getWorldDirection(_fireDir);
  // sprayier than the pistol — a wide, full-auto cone you have to fight
  _fireDir.x += rand(-0.045, 0.045);
  _fireDir.y += rand(-0.045, 0.045);
  _fireDir.z += rand(-0.045, 0.045);
  _fireDir.normalize();
  if (!_muzzleLight) { _muzzleLight = new THREE.PointLight(0xffd577, 0, 6, 2); G.scene.add(_muzzleLight); }
  _muzzleLight.position.copy(origin);
  _muzzleLight.intensity = 2.0; _muzzleT = 0.05;
  flashMuzzle();
  spawnShotTracer(origin, _fireDir, 72, 0xffef96, 0.055);
  const bullet = new THREE.Mesh(G.bulletGeom, G.bulletMat);
  bullet.position.copy(origin); G.scene.add(bullet);
  G.bullets.push({ mesh: bullet, vel: _fireDir.clone().multiplyScalar(90), life: 0.8 });
  G.audio.shot();
  G.camRig.shake = Math.max(G.camRig.shake, 0.05);
  if (doBulletRaycast(G.camera.position, _fireDir, 20)) { hitMarker(); G.audio.hit(); }
  scarePeds(origin, 14);
  return true;
}

export function fireShotgun() {
  if (!takeAmmo('shotgun')) return false;
  const origin = getMuzzleWorld();
  if (!_muzzleLight) { _muzzleLight = new THREE.PointLight(0xffd577, 0, 6, 2); G.scene.add(_muzzleLight); }
  _muzzleLight.position.copy(origin);
  _muzzleLight.intensity = 3.2; _muzzleT = 0.07;
  flashMuzzle();
  G.camera.getWorldDirection(_fireDir);
  spawnShotTracer(origin, _fireDir, 34, 0xfff0aa, 0.08);
  G.audio.shot();
  G.camRig.shake = Math.max(G.camRig.shake, 0.12);
  // a tight cone of pellets — devastating up close (all 9 land), falls off at range
  let connected = false;
  for (let i = 0; i < 9; i++) {
    G.camera.getWorldDirection(_fireDir);
    _fireDir.x += rand(-0.05, 0.05);
    _fireDir.y += rand(-0.05, 0.05);
    _fireDir.z += rand(-0.05, 0.05);
    _fireDir.normalize();
    const pellet = new THREE.Mesh(G.bulletGeom, G.bulletMat);
    pellet.position.copy(origin); G.scene.add(pellet);
    G.bullets.push({ mesh: pellet, vel: _fireDir.clone().multiplyScalar(80), life: 0.5 });
    if (doBulletRaycast(G.camera.position, _fireDir, 12)) connected = true;
  }
  if (connected) { hitMarker(); G.audio.hit(); }   // one marker per blast, not per pellet
  scarePeds(origin, 16);
  return true;
}

export function doBulletRaycast(origin, dir, dmg = 35) {
  _ray.set(origin, dir); _ray.near = 0; _ray.far = 120;
  // gather targets: living actors, vehicles, and only NEARBY buildings — the
  // distance cull keeps us from raycasting all ~650 buildings on every shot.
  const candidates = [];
  for (const ped of G.peds) if (!ped.dead) candidates.push({ obj: ped, mesh: ped.mesh, actor: true });
  for (const cop of G.cops) if (!cop.dead) candidates.push({ obj: cop, mesh: cop.mesh, actor: true });
  for (const veh of G.vehicles) if (!veh.dead && veh !== G.player.inVehicle) candidates.push({ obj: veh, mesh: veh.mesh, vehicle: true });
  let best = null;
  for (const c of candidates) {
    const intersects = _ray.intersectObject(c.mesh, true);
    if (intersects.length) {
      const hit = intersects[0];
      if (!best || hit.distance < best.dist) best = { dist: hit.distance, point: hit.point, target: c };
    }
    if (c.actor) {
      const bodyHit = actorBodyRayHit(c, origin, dir, _ray.far);
      if (bodyHit && (!best || bodyHit.dist < best.dist)) best = bodyHit;
    }
  }
  // Buildings are merged into shared meshes now, so test their stored AABBs
  // directly (they're axis-aligned boxes — this is exact, and cheaper than the
  // old per-mesh recursive raycast). Distance-culled to nearby buildings.
  for (const b of G.world.buildings) {
    if (dist2(b.pos, origin) >= 130 * 130) continue;
    _bbox.min.set(b.pos.x - b.size.x/2, b.pos.y - b.size.y/2, b.pos.z - b.size.z/2);
    _bbox.max.set(b.pos.x + b.size.x/2, b.pos.y + b.size.y/2, b.pos.z + b.size.z/2);
    const hit = _ray.ray.intersectBox(_bbox, _vBox);
    if (hit) {
      const dist = origin.distanceTo(hit);
      if (dist <= _ray.far && (!best || dist < best.dist)) best = { dist, point: hit.clone(), target: { obj: b } };
    }
  }
  // Road/sidewalk impacts matter for player feedback: shooting down at the
  // street should still throw sparks and ricochet instead of silently vanishing.
  if (dir.y < -0.025) {
    const t = (0.04 - origin.y) / dir.y;
    if (t > 0 && t <= _ray.far && (!best || t < best.dist)) {
      best = { dist: t, point: origin.clone().addScaledVector(dir, t), target: { ground: true } };
    }
  }
  let connected = false;                     // true if we hit an actor/cop-car (drives the hitmarker)
  if (best) {
    G.audio.ricochet();
    const t = best.target;
    if (t.actor) {
      t.obj.hp -= dmg;
      t.obj.panicT = 6;
      t.obj.flinchT = 0.18;                  // brief stagger (read by the AI updates)
      triggerHitStop(0.035);                 // tiny freeze so a connecting shot reads
      connected = true;
      const killed = t.obj.hp <= 0;
      noteMonkCrime(t.obj);
      if (killed) {
        if (G.cops.includes(t.obj)) killCop(t.obj);   // killCop books its own, heavier heat
        else killPed(t.obj);
      }
      // wounding is bad, killing is worse — the accumulator tells them apart now
      raiseWanted(2, killed && !G.cops.includes(t.obj) ? 5 : 2);
    } else if (t.vehicle) {
      // cop cars take real damage and die through updateVehicles' explosion path
      t.obj.hp -= t.obj.isCop ? dmg : Math.round(dmg * 0.5);
      if (t.obj.isCop) { connected = true; raiseWanted(2, 3); }
    }
    // impact spark/puff at the hit point (reuses the dust pool) + pooled light
    spawnImpactSpark(best.point);
    if (!t.actor) spawnRicochetTrail(best.point);
    if (!_sparkLight) { _sparkLight = new THREE.PointLight(0xffeebb, 0, 4, 2); G.scene.add(_sparkLight); }
    _sparkLight.position.copy(best.point);
    _sparkLight.intensity = 1.5; _sparkT = 0.08;
  }
  return connected;
}

export function updateBullets(dt) {
  // fade the pooled muzzle/spark lights + the muzzle-flash sprite
  if (_muzzleT > 0) { _muzzleT -= dt; if (_muzzleLight) _muzzleLight.intensity = Math.max(0, _muzzleT / 0.06 * 2.5); }
  if (_sparkT  > 0) { _sparkT  -= dt; if (_sparkLight)  _sparkLight.intensity  = Math.max(0, _sparkT  / 0.08 * 1.5); }
  if (_muzzleFlashT > 0) { _muzzleFlashT -= dt; if (_muzzleFlash) _muzzleFlash.material.opacity = Math.max(0, _muzzleFlashT / 0.05 * 0.95); }
  for (let i = G.bullets.length - 1; i >= 0; i--) {
    const b = G.bullets[i];
    if (b.vel) b.mesh.position.addScaledVector(b.vel, dt);
    if (b.fade && b.mesh.material && b.maxLife) b.mesh.material.opacity = Math.max(0, b.life / b.maxLife);
    b.life -= dt;
    if (b.life <= 0) {
      G.scene.remove(b.mesh);
      if (b.dispose) {
        if (b.mesh.geometry) b.mesh.geometry.dispose();
        if (b.mesh.material) b.mesh.material.dispose();
      }
      G.bullets.splice(i, 1);
    }
  }
}

// =============================================================================

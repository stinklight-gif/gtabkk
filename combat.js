// =============================================================================
// COMBAT — extracted from main.js (see numbered sections). No logic change.
// =============================================================================
import * as THREE from 'three';
import {
  makeStaticBaker, PI, TAU, clamp, lerp, rand, irand, pick, sign, dist2, COLORS, G, PRICE, PAINT_COLORS, ROAD_WIDTH, PED_TARGET, GAMEPLAY, _camTarget, _camOffset, _fireDir, _ray, _bbox, _vBox, _blackColor, disposeObject, BLOCK, GRID, HALF, lerpAngle
} from './core.js';
import { killCop, killPed, raiseWanted } from './main.js';

// pooled fire FX lights (combat-local mutable state)
let _muzzleLight = null, _sparkLight = null, _muzzleT = 0, _sparkT = 0;

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
    p.weapons.pistol = true; p.pistolAmmo = p.pistolMag; updateAmmoHud(); G.hud.showNotif('+9mm Pistol');
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
    if (G.input.pressed('KeyF') && p.attackCooldown <= 0 && p.stam > 8) {
      const kinds = ['jab', 'cross', 'kick'];
      const kind = pick(kinds);
      p.attackKind = kind;
      p.attackTimer = 0.25;
      p.attackCooldown = 0.32;
      p.stam = Math.max(0, p.stam - 8);
      doMeleeHit(kind);
    }
    if (p.attackTimer > 0) {
      // animate
      const t = 1 - p.attackTimer / 0.25;
      if (p.attackKind === 'jab') {
        p.armL.rotation.x = -Math.sin(t * PI) * 1.4;
      } else if (p.attackKind === 'cross') {
        p.armR.rotation.x = -Math.sin(t * PI) * 1.6;
      } else if (p.attackKind === 'kick') {
        p.legs.rotation.x = Math.sin(t * PI) * 1.2;
      }
    }
    G.hud.setCrosshair(false);
  } else if (p.activeWeapon === 'pistol' && p.weapons.pistol) {
    p.pistol.visible = true;
    // raise the right arm to aim; it kicks back on each shot (gunRecoil)
    const recoil = p.gunRecoil || 0;
    p.armR.rotation.x = -0.6 + recoil * 0.5;
    p.pistol.position.set(0.42, 1.25, 0.5);
    p.pistol.rotation.set(-0.6 + recoil * 0.5, 0, 0);

    G.hud.setCrosshair(G.input.rightDown);
    if (G.input.mouseDown && p.attackCooldown <= 0 && p.pistolAmmo > 0) {
      firePistol();
      p.pistolAmmo--; p.attackCooldown = 0.18;
      updateAmmoHud();
    } else if (G.input.mouseDown && p.pistolAmmo === 0 && p.attackCooldown <= 0) {
      G.audio.blip({freq: 200, dur: 0.04, type:'square', gain: 0.05});
      p.attackCooldown = 0.25;
    }
  } else if (p.activeWeapon === 'smg' && p.weapons.smg) {
    p.pistol.visible = true; // reuse the held-weapon model
    const recoil = p.gunRecoil || 0;
    p.armR.rotation.x = -0.7 + recoil * 0.4;
    p.pistol.position.set(0.42, 1.3, 0.5);
    p.pistol.rotation.set(-0.7 + recoil * 0.4, 0, 0);
    G.hud.setCrosshair(G.input.rightDown);
    if (G.input.mouseDown && p.attackCooldown <= 0 && p.smgAmmo > 0) {
      fireSMG();
      p.smgAmmo--; p.attackCooldown = 0.07;   // fast, full-auto
      p.gunRecoil = 1;
      updateAmmoHud();
    } else if (G.input.mouseDown && p.smgAmmo === 0 && p.attackCooldown <= 0) {
      G.audio.blip({freq: 200, dur: 0.04, type: 'square', gain: 0.05});
      p.attackCooldown = 0.25;
    }
  } else if (p.activeWeapon === 'shotgun' && p.weapons.shotgun) {
    p.pistol.visible = true;
    const recoil = p.gunRecoil || 0;
    p.armR.rotation.x = -0.6 + recoil * 0.6;
    p.pistol.position.set(0.42, 1.25, 0.5);
    p.pistol.rotation.set(-0.6 + recoil * 0.6, 0, 0);
    G.hud.setCrosshair(G.input.rightDown);
    if (G.input.mouseDown && p.attackCooldown <= 0 && p.shotgunAmmo > 0) {
      fireShotgun();
      p.shotgunAmmo--; p.attackCooldown = 0.8;   // slow, punchy
      p.gunRecoil = 1;
      updateAmmoHud();
    } else if (G.input.mouseDown && p.shotgunAmmo === 0 && p.attackCooldown <= 0) {
      G.audio.blip({freq: 200, dur: 0.04, type: 'square', gain: 0.05});
      p.attackCooldown = 0.3;
    }
  }
}

export function updateAmmoHud() {
  const p = G.player;
  if (p.activeWeapon === 'fists') G.hud.setAmmo('FISTS', 'MUAY THAI');
  else if (p.activeWeapon === 'smg') G.hud.setAmmo(`${p.smgAmmo} / ${p.smgReserve}`, 'SMG');
  else if (p.activeWeapon === 'shotgun') G.hud.setAmmo(`${p.shotgunAmmo} / ${p.shotgunReserve}`, 'SHOTGUN');
  else G.hud.setAmmo(`${p.pistolAmmo} / ${p.pistolReserve}`, '9MM PISTOL');
}

export function triggerHitStop(s) { G.hitStop = Math.max(G.hitStop || 0, s); }

export function doMeleeHit(kind) {
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
        target.hp -= (kind === 'kick' ? 22 : kind === 'cross' ? 18 : 12);
        target.panicT = 6;
        hitSomething = true;
        triggerHitStop(kind === 'kick' ? 0.07 : 0.05);     // freeze-frame the impact
        G.camRig.shake = Math.max(G.camRig.shake, kind === 'kick' ? 0.16 : 0.1);
        if (target.hp <= 0) {
          if (G.cops.includes(target)) killCop(target);
          else killPed(target);
        }
        // bumping a ped raises minor heat once
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
  if (hitSomething) G.audio.hit();
}

// Scatter nearby pedestrians (gunfire / explosions) — reuses the flee/panic AI.
export function scarePeds(pos, radius) {
  const r2 = radius * radius;
  for (const ped of G.peds) {
    if (ped.dead) continue;
    if (dist2(ped.mesh.position, pos) < r2) ped.panicT = Math.max(ped.panicT, 4);
  }
}

export function firePistol() {
  const origin = G.camera.position;          // used synchronously below; copied where stored
  G.camera.getWorldDirection(_fireDir);
  // pooled muzzle flash — reused every shot, faded out in updateBullets
  if (!_muzzleLight) { _muzzleLight = new THREE.PointLight(0xffd577, 0, 6, 2); G.scene.add(_muzzleLight); }
  _muzzleLight.position.copy(origin);
  _muzzleLight.intensity = 2.5; _muzzleT = 0.06;
  // spawn tracer bullet (visual only; the hit is the raycast below)
  const bullet = new THREE.Mesh(G.bulletGeom, G.bulletMat);
  bullet.position.copy(origin); G.scene.add(bullet);
  G.bullets.push({ mesh: bullet, vel: _fireDir.clone().multiplyScalar(80), life: 1.0 });
  G.audio.shot();
  G.camRig.shake = Math.max(G.camRig.shake, 0.06);
  doBulletRaycast(origin, _fireDir);
  scarePeds(origin, 14);
}

export function fireSMG() {
  const origin = G.camera.position;
  G.camera.getWorldDirection(_fireDir);
  // less accurate than the pistol — add a little spread
  _fireDir.x += rand(-0.03, 0.03);
  _fireDir.y += rand(-0.03, 0.03);
  _fireDir.z += rand(-0.03, 0.03);
  _fireDir.normalize();
  if (!_muzzleLight) { _muzzleLight = new THREE.PointLight(0xffd577, 0, 6, 2); G.scene.add(_muzzleLight); }
  _muzzleLight.position.copy(origin);
  _muzzleLight.intensity = 2.0; _muzzleT = 0.05;
  const bullet = new THREE.Mesh(G.bulletGeom, G.bulletMat);
  bullet.position.copy(origin); G.scene.add(bullet);
  G.bullets.push({ mesh: bullet, vel: _fireDir.clone().multiplyScalar(90), life: 0.8 });
  G.audio.shot();
  G.camRig.shake = Math.max(G.camRig.shake, 0.05);
  doBulletRaycast(origin, _fireDir, 22);
  scarePeds(origin, 14);
}

export function fireShotgun() {
  const origin = G.camera.position;
  if (!_muzzleLight) { _muzzleLight = new THREE.PointLight(0xffd577, 0, 6, 2); G.scene.add(_muzzleLight); }
  _muzzleLight.position.copy(origin);
  _muzzleLight.intensity = 3.2; _muzzleT = 0.07;
  G.audio.shot();
  G.camRig.shake = Math.max(G.camRig.shake, 0.12);
  // a spread of pellets — devastating up close, weak at range
  for (let i = 0; i < 8; i++) {
    G.camera.getWorldDirection(_fireDir);
    _fireDir.x += rand(-0.08, 0.08);
    _fireDir.y += rand(-0.08, 0.08);
    _fireDir.z += rand(-0.08, 0.08);
    _fireDir.normalize();
    const pellet = new THREE.Mesh(G.bulletGeom, G.bulletMat);
    pellet.position.copy(origin); G.scene.add(pellet);
    G.bullets.push({ mesh: pellet, vel: _fireDir.clone().multiplyScalar(80), life: 0.5 });
    doBulletRaycast(origin, _fireDir, 11);
  }
  scarePeds(origin, 16);
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
  if (best) {
    G.audio.ricochet();
    const t = best.target;
    if (t.actor) {
      t.obj.hp -= dmg;
      t.obj.panicT = 6;
      triggerHitStop(0.035);                 // tiny freeze so a connecting shot reads
      if (t.obj.hp <= 0) {
        if (G.cops.includes(t.obj)) killCop(t.obj);
        else killPed(t.obj);
      }
      raiseWanted(2);
    } else if (t.vehicle) {
      // cop cars take real damage and die through updateVehicles' explosion path
      t.obj.hp -= t.obj.isCop ? dmg : Math.round(dmg * 0.5);
      if (t.obj.isCop) raiseWanted(2);
    }
    // pooled impact spark — reused, faded out in updateBullets
    if (!_sparkLight) { _sparkLight = new THREE.PointLight(0xffeebb, 0, 4, 2); G.scene.add(_sparkLight); }
    _sparkLight.position.copy(best.point);
    _sparkLight.intensity = 1.5; _sparkT = 0.08;
  }
}

export function updateBullets(dt) {
  // fade the pooled muzzle/spark lights
  if (_muzzleT > 0) { _muzzleT -= dt; if (_muzzleLight) _muzzleLight.intensity = Math.max(0, _muzzleT / 0.06 * 2.5); }
  if (_sparkT  > 0) { _sparkT  -= dt; if (_sparkLight)  _sparkLight.intensity  = Math.max(0, _sparkT  / 0.08 * 1.5); }
  for (let i = G.bullets.length - 1; i >= 0; i--) {
    const b = G.bullets[i];
    b.mesh.position.addScaledVector(b.vel, dt);
    b.life -= dt;
    if (b.life <= 0) {
      G.scene.remove(b.mesh);
      G.bullets.splice(i, 1);
    }
  }
}

// =============================================================================

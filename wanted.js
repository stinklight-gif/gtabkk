// =============================================================================
// WANTED — extracted from main.js (see numbered sections). No logic change.
// =============================================================================
import * as THREE from 'three';
import {
  makeStaticBaker, PI, TAU, clamp, lerp, rand, irand, pick, sign, dist2, COLORS, G, PRICE, PAINT_COLORS, ROAD_WIDTH, PED_TARGET, GAMEPLAY, _camTarget, _camOffset, _fireDir, _ray, _bbox, _vBox, _blackColor, disposeObject, BLOCK, GRID, HALF, lerpAngle
} from './core.js';
import { animateWalk, damagePlayer, makePedMesh, makeVehicle, onCopKilled, raiseWanted } from './main.js';

// 15. COPS + WANTED SYSTEM
// =============================================================================

export function spawnCop(scene, pos) {
  // foot cop
  const m = makePedMesh();
  // override clothing to brown/khaki cop uniform
  const copShirt = new THREE.MeshStandardMaterial({ color: 0x8a7f4a, roughness: 0.7 });
  const copPants = new THREE.MeshStandardMaterial({ color: 0x4a4030, roughness: 0.8 });
  const pp = m.userData.parts;
  pp.torso.material = copShirt;
  pp.armL.material = pp.armR.material = copShirt;
  pp.legL.material = pp.legR.material = copPants;
  m.position.copy(pos);
  scene.add(m);
  const cop = {
    mesh: m, heading: rand(0, TAU), speed: 3.5, hp: 60, dead: false,
    state: 'seeking',  // seeking | engaging | bribed
    shootCooldown: 0, idleT: 0, panicT: 0,
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
  for (const c of G.cops) if (!c.dead) alive++;
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
  if (GAMEPLAY.wantedLOS && G.wanted.stars > 0) {
    const seeR = 30 * 30;
    let seen = false;
    for (const c of G.cops) if (!c.dead && dist2(c.mesh.position, p) < seeR) { seen = true; break; }
    if (!seen) for (const v of G.vehicles) if (v.isCop && !v.dead && v.driver && dist2(v.pos, p) < seeR) { seen = true; break; }
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

  G.hud.setStars(G.wanted.stars);
}

export function updateCop(v, dt) {
  // chase player
  const p = G.player;
  const px = p.group.position.x, pz = p.group.position.z;
  const tx0 = px - v.pos.x;
  const tz0 = pz - v.pos.z;
  const d = Math.hypot(tx0, tz0);

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
  v.pos.x += Math.sin(v.heading) * v.vel * dt;
  v.pos.z += Math.cos(v.heading) * v.vel * dt;
  v.mesh.position.copy(v.pos);
  v.mesh.rotation.y = v.heading;
  // ram player vehicle, or run the player down on foot
  if (p.inVehicle && dist2(v.pos, p.inVehicle.pos) < 4*4) {
    p.inVehicle.hp -= 8 * dt;
  } else if (GAMEPLAY.vulnerableOnFoot && !p.inVehicle && Math.abs(v.vel) > 5 && dist2(v.pos, p.group.position) < 3*3) {
    damagePlayer(14 * dt);
  }
}

export function updateFootCops(dt) {
  const p = G.player;
  for (const c of G.cops) {
    if (c.dead) continue;
    if (c.state === 'bribed') { c.idleT += dt; continue; }
    const dx = p.group.position.x - c.mesh.position.x;
    const dz = p.group.position.z - c.mesh.position.z;
    const d = Math.hypot(dx, dz);
    c.heading = Math.atan2(dx, dz);
    if (d > 2.5) {
      c.mesh.position.x += Math.sin(c.heading) * c.speed * dt;
      c.mesh.position.z += Math.cos(c.heading) * c.speed * dt;
      // at 2★ cops draw and fire from range
      if (GAMEPLAY.vulnerableOnFoot && G.wanted.stars >= 2 && d < 22) {
        c.shootCooldown -= dt;
        if (c.shootCooldown <= 0) {
          c.shootCooldown = rand(1.4, 2.6);
          G.audio.shot();
          if (Math.random() < 0.5) { damagePlayer(8); G.camRig.shake = Math.max(G.camRig.shake, 0.08); }
        }
      }
    } else {
      // melee attack
      c.shootCooldown -= dt;
      if (c.shootCooldown <= 0) {
        c.shootCooldown = 0.8;
        G.audio.punch();
        damagePlayer(6);
      }
    }
    c.mesh.rotation.y = c.heading;
    animateWalk(c.mesh, c.speed || 2.0, dt, true);
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
  // clear any active cops — clean slate on respawn
  for (let i = G.cops.length - 1; i >= 0; i--) { G.scene.remove(G.cops[i].mesh); disposeObject(G.cops[i].mesh); G.cops.splice(i, 1); }
  for (let i = G.vehicles.length - 1; i >= 0; i--) { if (G.vehicles[i].isCop) { G.scene.remove(G.vehicles[i].mesh); disposeObject(G.vehicles[i].mesh); G.vehicles.splice(i, 1); } }
  const home = G.econ.safehouse.owned && G.econ.safehouse.pos;
  const sp = (home ? G.econ.safehouse.pos : G.world.spawns.player).clone();
  p.group.position.copy(sp);
  p.velocity.set(0, 0, 0);
  if (p.inVehicle) { p.inVehicle.driver = null; p.inVehicle = null; p.group.visible = true; }
  if (home) G.hud.showSubtitle('You wake up at home.', 'ตื่นที่บ้าน');
  else G.hud.showSubtitle('You wake up at the police station.', 'ตื่นมาที่โรงพัก');
}

// =============================================================================

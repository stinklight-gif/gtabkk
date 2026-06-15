// =============================================================================
// PHYSICS — extracted from main.js (see numbered sections). No logic change.
// =============================================================================
import * as THREE from 'three';
import {
  makeStaticBaker, PI, TAU, clamp, lerp, rand, irand, pick, sign, dist2, COLORS, G, PRICE, PAINT_COLORS, ROAD_WIDTH, PED_TARGET, GAMEPLAY, _camTarget, _camOffset, _fireDir, _ray, _bbox, _vBox, _blackColor, disposeObject, BLOCK, GRID, HALF, lerpAngle
} from './core.js';
import { scarePeds } from './main.js';

// 11. PHYSICS / COLLISIONS (lightweight)
// =============================================================================

// Player vs buildings: simple AABB pushback
export function resolvePlayerVsBuildings(player) {
  const r = 0.42;
  const p = player.group.position;
  for (const b of G.world.buildings) {
    const bx = b.pos.x, bz = b.pos.z;
    const hx = b.size.x/2 + r, hz = b.size.z/2 + r;
    const dx = p.x - bx;
    const dz = p.z - bz;
    if (Math.abs(dx) < hx && Math.abs(dz) < hz) {
      // push out on shortest axis
      const px = hx - Math.abs(dx);
      const pz = hz - Math.abs(dz);
      if (px < pz) p.x = bx + (Math.sign(dx) || 1) * hx;
      else         p.z = bz + (Math.sign(dz) || 1) * hz;
    }
  }
  // world bounds
  p.x = clamp(p.x, -HALF + 1, HALF - 1);
  p.z = clamp(p.z, -HALF + 1, HALF - 1);
}

// Player vs vehicles: AABB pushback in each car's local (heading-rotated) frame
// so you can't walk through parked or moving cars. Skips your own car + wrecks.
export function resolvePlayerVsVehicles(player) {
  const p = player.group.position, r = 0.42;
  for (const v of G.vehicles) {
    if (v === player.inVehicle || v.dead || !v.boundsHalf) continue;
    const hx = v.boundsHalf.x + r, hz = v.boundsHalf.z + r;
    const wx = p.x - v.pos.x, wz = p.z - v.pos.z;
    if (wx * wx + wz * wz > (hx + hz) * (hx + hz)) continue;   // cheap reject
    const heading = v.heading || 0;
    const c = Math.cos(heading), s = Math.sin(heading);
    const lx = c * wx - s * wz, lz = s * wx + c * wz;          // world → car-local
    if (Math.abs(lx) < hx && Math.abs(lz) < hz) {
      // push out along the shallower local axis, then rotate back to world
      let nlx = lx, nlz = lz;
      if (hx - Math.abs(lx) < hz - Math.abs(lz)) nlx = (Math.sign(lx) || 1) * hx;
      else                                       nlz = (Math.sign(lz) || 1) * hz;
      p.x = v.pos.x + c * nlx + s * nlz;
      p.z = v.pos.z - s * nlx + c * nlz;
    }
  }
}

// Vehicle vs buildings — soft pushback that also kills speed
export function resolveVehicleVsBuildings(v) {
  const p = v.pos;
  const r = Math.max(v.boundsHalf.x, v.boundsHalf.z) + 0.2;
  let hit = false;
  for (const b of G.world.buildings) {
    const bx = b.pos.x, bz = b.pos.z;
    const hx = b.size.x/2 + r, hz = b.size.z/2 + r;
    const dx = p.x - bx, dz = p.z - bz;
    if (Math.abs(dx) < hx && Math.abs(dz) < hz) {
      const px = hx - Math.abs(dx);
      const pz = hz - Math.abs(dz);
      if (px < pz) p.x = bx + (Math.sign(dx) || 1) * hx;
      else         p.z = bz + (Math.sign(dz) || 1) * hz;
      hit = true;
    }
  }
  if (hit) {
    if (Math.abs(v.vel) > 6) {
      v.hp -= Math.abs(v.vel) * 0.6;
      G.camRig.shake = Math.min(0.4, Math.abs(v.vel) * 0.02);
      G.audio.hit();
      spawnDust(p.x, p.z, 16);                 // impact puff
    }
    v.vel *= 0.4;
  }
  // bounds
  p.x = clamp(p.x, -HALF + 1, HALF - 1);
  p.z = clamp(p.z, -HALF + 1, HALF - 1);
}

// ---- Juice FX: tire-skid decals + impact dust puffs ----
export const _skidGeo = new THREE.PlaneGeometry(0.34, 1.2); _skidGeo.rotateX(-PI / 2);  // lies flat, length along +Z
export const _skidMat = new THREE.MeshBasicMaterial({ color: 0x0b0b0b, transparent: true, opacity: 0.5, depthWrite: false });
export function spawnSkid(v) {
  const now = performance.now();
  if (now - (v._skidAt || 0) < 45) return;     // throttle
  v._skidAt = now;
  const fx = Math.sin(v.heading), fz = Math.cos(v.heading);
  const rx = Math.cos(v.heading), rz = -Math.sin(v.heading);
  for (const lat of [-0.7, 0.7]) {
    const m = new THREE.Mesh(_skidGeo, _skidMat.clone());
    m.position.set(v.pos.x + rx * lat - fx * 1.1, 0.045, v.pos.z + rz * lat - fz * 1.1);
    m.rotation.y = v.heading;
    m.frustumCulled = false;
    G.scene.add(m);
    G.skids.push({ mesh: m, life: 5 });
  }
  while (G.skids.length > 90) { const s = G.skids.shift(); G.scene.remove(s.mesh); s.mesh.material.dispose(); }
}
export function updateSkids(dt) {
  for (let i = G.skids.length - 1; i >= 0; i--) {
    const s = G.skids[i]; s.life -= dt;
    s.mesh.material.opacity = Math.max(0, s.life / 5 * 0.5);
    if (s.life <= 0) { G.scene.remove(s.mesh); s.mesh.material.dispose(); G.skids.splice(i, 1); }
  }
}
export function spawnDust(x, z, n = 14) {
  const geo = new THREE.BufferGeometry();
  const pos = new Float32Array(n * 3), vel = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    pos[i * 3] = x; pos[i * 3 + 1] = 0.3; pos[i * 3 + 2] = z;
    const a = Math.random() * TAU, sp = rand(1, 4.5);
    vel[i * 3] = Math.cos(a) * sp; vel[i * 3 + 1] = rand(1, 3.2); vel[i * 3 + 2] = Math.sin(a) * sp;
  }
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  const mat = new THREE.PointsMaterial({ color: 0xbcae98, size: 0.55, transparent: true, opacity: 0.7, depthWrite: false });
  const pts = new THREE.Points(geo, mat); pts.frustumCulled = false; G.scene.add(pts);
  G.dust.push({ pts, vel, life: 0.6 });
}
// Songkran water splash — a blue droplet burst (reuses the dust particle system).
export function splashWater(x, y, z, n = 16) {
  const geo = new THREE.BufferGeometry();
  const pos = new Float32Array(n * 3), vel = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    pos[i * 3] = x; pos[i * 3 + 1] = y; pos[i * 3 + 2] = z;
    const a = Math.random() * TAU, sp = rand(1.5, 5);
    vel[i * 3] = Math.cos(a) * sp; vel[i * 3 + 1] = rand(2, 5); vel[i * 3 + 2] = Math.sin(a) * sp;
  }
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  const mat = new THREE.PointsMaterial({ color: 0x9fd8ff, size: 0.9, transparent: true, opacity: 0.9, depthWrite: false });
  const pts = new THREE.Points(geo, mat); pts.frustumCulled = false; G.scene.add(pts);
  G.dust.push({ pts, vel, life: 1.0 });
}
export function updateDust(dt) {
  for (let i = G.dust.length - 1; i >= 0; i--) {
    const d = G.dust[i]; d.life -= dt;
    const a = d.pts.geometry.attributes.position.array;
    for (let k = 0; k < d.vel.length / 3; k++) {
      a[k * 3] += d.vel[k * 3] * dt; a[k * 3 + 1] = Math.max(0.05, a[k * 3 + 1] + d.vel[k * 3 + 1] * dt); a[k * 3 + 2] += d.vel[k * 3 + 2] * dt;
      d.vel[k * 3 + 1] -= 6 * dt;
    }
    d.pts.geometry.attributes.position.needsUpdate = true;
    d.pts.material.opacity = Math.max(0, d.life / 0.6 * 0.7);
    if (d.life <= 0) { G.scene.remove(d.pts); d.pts.geometry.dispose(); d.pts.material.dispose(); G.dust.splice(i, 1); }
  }
}

// =============================================================================
// 16. PARTICLES / FX
// =============================================================================

export function makeSmokeEmitter(target, intensity=1) {
  const N = 40;
  const geom = new THREE.BufferGeometry();
  const pos = new Float32Array(N * 3);
  for (let i = 0; i < N; i++) { pos[i*3]=0; pos[i*3+1]=0; pos[i*3+2]=0; }
  geom.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  const mat = new THREE.PointsMaterial({ color: 0x444444, size: 1.2, transparent: true, opacity: 0.65, depthWrite: false });
  const pts = new THREE.Points(geom, mat);
  G.scene.add(pts);
  const seeds = Array.from({length:N}, () => ({ t: Math.random()*1.5, x: rand(-0.3,0.3), z: rand(-0.3,0.3) }));
  const entry = { pts, mat, seeds, target, life: 60, intensity };
  G.particles.push(entry);
  return entry;
}

export function makeExplosion(pos) {
  const flash = new THREE.PointLight(0xffaa55, 6, 22, 2);
  flash.position.copy(pos); G.scene.add(flash);
  setTimeout(()=>G.scene.remove(flash), 220);
  G.camRig.shake = 0.6;
  G.audio.thunder();
  makeSmokeEmitter(pos.clone(), 2);
  scarePeds(pos, 22);
}

export function updateParticles(dt) {
  for (let i = G.particles.length - 1; i >= 0; i--) {
    const e = G.particles[i];
    e.life -= dt;
    const arr = e.pts.geometry.attributes.position.array;
    for (let j = 0; j < e.seeds.length; j++) {
      const s = e.seeds[j];
      s.t += dt;
      if (s.t > 2.0) {
        s.t = 0;
        arr[j*3+0] = e.target.x + s.x;
        arr[j*3+1] = e.target.y + 0.5;
        arr[j*3+2] = e.target.z + s.z;
      } else {
        arr[j*3+1] += 0.8 * dt;
        arr[j*3+0] += s.x * dt * 0.4;
        arr[j*3+2] += s.z * dt * 0.4;
      }
    }
    e.pts.geometry.attributes.position.needsUpdate = true;
    e.mat.opacity = clamp(e.life / 60, 0, 0.65);
    if (e.life <= 0) {
      G.scene.remove(e.pts);
      e.pts.geometry.dispose();
      e.mat.dispose();
      G.particles.splice(i, 1);
    }
  }
}

// =============================================================================

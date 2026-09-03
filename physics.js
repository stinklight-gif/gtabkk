// =============================================================================
// PHYSICS — extracted from main.js (see numbered sections). No logic change.
// =============================================================================
import * as THREE from 'three';
import {
  makeStaticBaker, PI, TAU, clamp, lerp, rand, irand, pick, sign, dist2, COLORS, G, PRICE, PAINT_COLORS, ROAD_WIDTH, PED_TARGET, GAMEPLAY, buildingsNear, _camTarget, _camOffset, _fireDir, _ray, _bbox, _vBox, _blackColor, disposeObject, BLOCK, GRID, HALF, lerpAngle
} from './core.js';
import { scarePeds } from './main.js';

// 11. PHYSICS / COLLISIONS (lightweight)
// =============================================================================

// Ped vs buildings: same shortest-axis pushout as the player, but only tests the
// 3×3 block neighbourhood so 80 peds don't walk the full building list.
export function resolvePedVsBuildings(ped) {
  if (!GAMEPLAY.pedBuildingCollision || !ped || ped.dead) return;
  const p = ped.mesh.position, r = 0.35;
  const list = buildingsNear(p.x, p.z);
  for (const b of list) {
    const hx = b.size.x / 2 + r, hz = b.size.z / 2 + r;
    const dx = p.x - b.pos.x, dz = p.z - b.pos.z;
    if (Math.abs(dx) < hx && Math.abs(dz) < hz) {
      const px = hx - Math.abs(dx), pz = hz - Math.abs(dz);
      if (px < pz) p.x = b.pos.x + (Math.sign(dx) || 1) * hx;
      else p.z = b.pos.z + (Math.sign(dz) || 1) * hz;
    }
  }
}

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

// ---- Walkable structures: multi-floor support + height-gated collision ----
// The city is otherwise flat (you ground at y=0). Terminal 21 and the BTS
// platforms add floors/escalators, registered in world.walk { platforms, ramps,
// solids }. worldSupportY returns the walkable surface height under the player's
// feet (a floor, an escalator ramp, or 0 for the ground); resolvePlayerVsPlatforms
// blocks rails/counters only on the floor (y-band) they belong to.
const WALK_STEP = 0.6;   // how far up you can step / ride per frame (escalators rise gently)
export function worldSupportY(x, z, curY) {
  const w = G.world && G.world.walk;
  let support = 0;
  if (!w) return support;
  for (const f of w.platforms) {
    if (x >= f.x0 && x <= f.x1 && z >= f.z0 && z <= f.z1 && f.y <= curY + WALK_STEP && f.y > support) support = f.y;
  }
  for (const rmp of w.ramps) {
    if (x < rmp.x0 || x > rmp.x1 || z < rmp.z0 || z > rmp.z1) continue;
    const t = rmp.axis === 'z' ? (z - rmp.z0) / (rmp.z1 - rmp.z0) : (x - rmp.x0) / (rmp.x1 - rmp.x0);
    const h = rmp.yLo + (rmp.yHi - rmp.yLo) * t;
    if (h <= curY + WALK_STEP && h > support) support = h;
  }
  return support;
}
export function resolvePlayerVsPlatforms(player) {
  const w = G.world && G.world.walk;
  if (!w || !w.solids) return;
  const p = player.group.position, r = 0.42, y = p.y;
  for (const s of w.solids) {
    if (y < s.y0 - 0.2 || y > s.y1) continue;        // only collide on this solid's floor
    const hx = s.sx / 2 + r, hz = s.sz / 2 + r;
    const dx = p.x - s.x, dz = p.z - s.z;
    if (Math.abs(dx) < hx && Math.abs(dz) < hz) {
      if (hx - Math.abs(dx) < hz - Math.abs(dz)) p.x = s.x + (Math.sign(dx) || 1) * hx;
      else                                       p.z = s.z + (Math.sign(dz) || 1) * hz;
    }
  }
}

// Line of sight between two world points, blocked by building AABBs. Buildings are
// merged into shared meshes, so we test their stored boxes directly — the same trick
// the camera occlusion pass uses (see updateCamera in vehicles.js).
//
// NOTE: this deliberately uses its own ray/box scratch rather than the pooled `_ray`
// / `_bbox` / `_vBox` from core.js, because the pooled ones are mid-use inside
// doBulletRaycast — calling this from there would corrupt an in-flight shot.
const _losRay = new THREE.Ray();
const _losBox = new THREE.Box3();
const _losHit = new THREE.Vector3();
export function hasLineOfSight(ax, ay, az, bx, by, bz) {
  let dx = bx - ax, dy = by - ay, dz = bz - az;
  const len = Math.hypot(dx, dy, dz);
  if (len < 0.001) return true;
  dx /= len; dy /= len; dz /= len;
  _losRay.origin.set(ax, ay, az);
  _losRay.direction.set(dx, dy, dz);
  const cullR2 = (len + 12) * (len + 12);
  for (const b of G.world.buildings) {
    // cheap reject: anything further from the eye than the segment can't block it
    const bdx = b.pos.x - ax, bdz = b.pos.z - az;
    if (bdx * bdx + bdz * bdz > cullR2) continue;
    _losBox.min.set(b.pos.x - b.size.x / 2, b.pos.y - b.size.y / 2, b.pos.z - b.size.z / 2);
    _losBox.max.set(b.pos.x + b.size.x / 2, b.pos.y + b.size.y / 2, b.pos.z + b.size.z / 2);
    const hit = _losRay.intersectBox(_losBox, _losHit);
    if (!hit) continue;
    const hd = Math.hypot(hit.x - ax, hit.y - ay, hit.z - az);
    if (hd < len - 0.4) return false;      // a wall sits between the two points
  }
  if (GAMEPLAY.coverVehicles && G.vehicles) {
    for (const v of G.vehicles) {
      if (!v || v.dead || !v.boundsHalf || v.driver === 'player') continue;
      const vdx = v.pos.x - ax, vdz = v.pos.z - az;
      if (vdx * vdx + vdz * vdz > cullR2) continue;
      const hx = v.boundsHalf.x, hz = v.boundsHalf.z, hy = Math.max(0.6, (v.spec && v.spec.kind === 'bike') ? 0.7 : 1.1);
      _losBox.min.set(v.pos.x - hx, v.pos.y, v.pos.z - hz);
      _losBox.max.set(v.pos.x + hx, v.pos.y + hy * 2, v.pos.z + hz);
      const hit = _losRay.intersectBox(_losBox, _losHit);
      if (!hit) continue;
      const hd = Math.hypot(hit.x - ax, hit.y - ay, hit.z - az);
      if (hd < len - 0.5) return false;
    }
  }
  return true;
}

function vehicleBasis(v) {
  const h = v.heading || 0;
  return {
    fx: Math.sin(h), fz: Math.cos(h),
    rx: Math.cos(h), rz: -Math.sin(h),
  };
}

function vehicleWorldVelocity(v, includeImpact = true) {
  const b = vehicleBasis(v);
  return {
    x: b.fx * (v.vel || 0) + b.rx * (v.latVel || 0) + (includeImpact ? (v._impactVX || 0) : 0),
    z: b.fz * (v.vel || 0) + b.rz * (v.latVel || 0) + (includeImpact ? (v._impactVZ || 0) : 0),
  };
}

function setVehicleWorldVelocity(v, wx, wz) {
  const b = vehicleBasis(v);
  v.vel = wx * b.fx + wz * b.fz;
  v.latVel = wx * b.rx + wz * b.rz;
  if (v.spec && v.spec.kind === 'bike') v.latVel *= 0.55;
}

function addNpcImpact(v, ix, iz, spin) {
  v._impactVX = (v._impactVX || 0) + ix;
  v._impactVZ = (v._impactVZ || 0) + iz;
  const mag = Math.hypot(v._impactVX, v._impactVZ);
  const cap = v.spec && v.spec.kind === 'bike' ? 18 : 22;
  if (mag > cap) {
    v._impactVX = v._impactVX / mag * cap;
    v._impactVZ = v._impactVZ / mag * cap;
  }
  v._impactSpin = clamp((v._impactSpin || 0) + spin, -2.4, 2.4);
}

function exciteSuspension(v, amount) {
  if (!v || !v.spec || v.spec.kind === 'boat') return;
  v._suspVel = (v._suspVel || 0) + clamp(amount * 0.035, 0.03, 0.7);
}

// Vehicle vs buildings — AABB pushback plus impulse-like deflection
export function resolveVehicleVsBuildings(v) {
  const p = v.pos;
  const r = Math.max(v.boundsHalf.x, v.boundsHalf.z) + 0.2;
  let hit = false;
  let hitN = null;
  for (const b of G.world.buildings) {
    const bx = b.pos.x, bz = b.pos.z;
    const hx = b.size.x/2 + r, hz = b.size.z/2 + r;
    const dx = p.x - bx, dz = p.z - bz;
    if (Math.abs(dx) < hx && Math.abs(dz) < hz) {
      const px = hx - Math.abs(dx);
      const pz = hz - Math.abs(dz);
      if (px < pz) {
        const sx = Math.sign(dx) || 1;
        p.x = bx + sx * hx;
        hitN = { x: sx, z: 0 };
      } else {
        const sz = Math.sign(dz) || 1;
        p.z = bz + sz * hz;
        hitN = { x: 0, z: sz };
      }
      hit = true;
    }
  }
  if (hit) {
    const n = hitN || { x: -Math.sign(Math.sin(v.heading || 0)) || 1, z: -Math.sign(Math.cos(v.heading || 0)) || 0 };
    const w = vehicleWorldVelocity(v, false);
    const vn = w.x * n.x + w.z * n.z;
    const normalSpeed = Math.max(0, -vn);
    const tx = w.x - vn * n.x, tz = w.z - vn * n.z;
    const outN = vn < 0 ? -vn * 0.25 : vn;
    const wx = tx * 0.8 + n.x * outN;
    const wz = tz * 0.8 + n.z * outN;
    setVehicleWorldVelocity(v, wx, wz);
    if (normalSpeed > 0.2) {
      const b = vehicleBasis(v);
      const contactForward = (-n.x * r) * b.fx + (-n.z * r) * b.fz;
      v.yawRate = clamp((v.yawRate || 0) + sign(contactForward) * normalSpeed * 0.15, -1.5, 1.5);
      exciteSuspension(v, normalSpeed);
    }
    if (normalSpeed > 6) {
      v.hp -= normalSpeed * 0.6 * (v.spec.armorMul != null ? v.spec.armorMul : 1);   // Armor upgrade softens crashes
      G.camRig.shake = Math.min(0.4, normalSpeed * 0.02);
      G.audio.hit();
      spawnDust(p.x, p.z, 16);                 // impact puff
    } else if (normalSpeed > 0.8 && G.audio && G.audio.scrape) {
      G.audio.scrape();
    }
  }
  // bounds
  p.x = clamp(p.x, -HALF + 1, HALF - 1);
  p.z = clamp(p.z, -HALF + 1, HALF - 1);
}

export function resolveVehicleVsVehicles(v) {
  if (!v || v.dead || !v.boundsHalf) return;
  const vr = Math.max(v.boundsHalf.x, v.boundsHalf.z) * 0.82;
  let moved = false;
  for (const o of G.vehicles) {
    if (o === v || o.dead || !o.boundsHalf) continue;
    const or = Math.max(o.boundsHalf.x, o.boundsHalf.z) * 0.82;
    const min = Math.max(1.05, vr + or);
    const dx = v.pos.x - o.pos.x, dz = v.pos.z - o.pos.z;
    const d2 = dx * dx + dz * dz;
    if (d2 <= 0.0001 || d2 > min * min) continue;
    const d = Math.sqrt(d2), nx = dx / d, nz = dz / d;
    const overlap = min - d;
    const vIsPlayer = v.driver === 'player';
    const oIsPlayer = o.driver === 'player';
    const playerHit = vIsPlayer || oIsPlayer;
    const oLocked = o.driver && o.driver !== 'player' && !playerHit;
    const vShare = playerHit ? (vIsPlayer ? 0.24 : 0.82) : (oLocked ? 0.85 : 0.55);
    const oShare = playerHit ? (vIsPlayer ? 0.76 : 0.08) : (oLocked ? 0.15 : 0.45);
    v.pos.x += nx * overlap * vShare;
    v.pos.z += nz * overlap * vShare;
    moved = true;
    if (!oLocked) {
      o.pos.x -= nx * overlap * oShare;
      o.pos.z -= nz * overlap * oShare;
      o.mesh.position.copy(o.pos);
    }

    const vw = vehicleWorldVelocity(v, false);
    const ow = vehicleWorldVelocity(o, false);
    const relN = (vw.x - ow.x) * nx + (vw.z - ow.z) * nz;
    const rel = Math.max(0, -relN);
    if (relN < 0) {
      const m1 = v.spec && v.spec.mass || 1500;
      const m2 = o.spec && o.spec.mass || 1500;
      const j = -(1 + 0.3) * relN / (1 / m1 + 1 / m2);
      const dvx = j * nx / m1, dvz = j * nz / m1;
      const dox = -j * nx / m2, doz = -j * nz / m2;
      setVehicleWorldVelocity(v, vw.x + dvx, vw.z + dvz);
      setVehicleWorldVelocity(o, ow.x + dox, ow.z + doz);
      const rvx = (o.pos.x - v.pos.x) * 0.5, rvz = (o.pos.z - v.pos.z) * 0.5;
      const spinV = clamp((rvx * (j * nz) - rvz * (j * nx)) * 0.0004 / Math.max(1, m1 / 1500), -1.6, 1.6);
      const spinO = clamp((rvx * (-j * nz) - rvz * (-j * nx)) * 0.0004 / Math.max(1, m2 / 1500), -1.8, 1.8);
      v.yawRate = clamp((v.yawRate || 0) + spinV, -2.2, 2.2);
      o.yawRate = clamp((o.yawRate || 0) + spinO, -2.2, 2.2);
      exciteSuspension(v, rel);
      exciteSuspension(o, rel);
      if (o.driver !== 'player') addNpcImpact(o, dox, doz, spinO);
      if (v.driver !== 'player') addNpcImpact(v, dvx, dvz, spinV);
      if (playerHit) {
        const target = vIsPlayer ? o : oIsPlayer ? v : null;
        const rammer = vIsPlayer ? v : oIsPlayer ? o : null;
        if (target && rammer && target.driver !== 'player' && target.npc) {
          target.npc.ramPanic = Math.max(target.npc.ramPanic || 0, 1.2);
          target.vel = Math.max(target.vel || 0, Math.min(target.npc.cruiseSpeed * 1.15, Math.abs(rammer.vel || 0) * 0.42));
        }
      }
    }
    if (rel > 3.5 && performance.now() - (v._vehHitAt || 0) > 260) {
      v._vehHitAt = performance.now();
      const dmg = Math.max(1, (rel - 3.5) * 0.8) * (v.spec.armorMul != null ? v.spec.armorMul : 1);
      v.hp -= dmg;
      o.hp -= Math.max(0.5, dmg * 0.65);
      spawnDust((v.pos.x + o.pos.x) * 0.5, (v.pos.z + o.pos.z) * 0.5, playerHit ? 18 : 9);
      if (playerHit) {
        G.camRig.shake = Math.max(G.camRig.shake || 0, Math.min(0.38, rel * 0.025));
        if (G.audio && G.audio.hit) G.audio.hit();
      }
    }
    const damp = playerHit ? (vIsPlayer ? 0.94 : 0.88) : (rel > 2 ? 0.82 : 0.9);
    v.vel *= damp; v.latVel = (v.latVel || 0) * damp;
    if (!oLocked) {
      const od = playerHit && !oIsPlayer ? 0.98 : 0.9;
      o.vel *= od; o.latVel = (o.latVel || 0) * od;
    }
  }
  if (moved && v.mesh) v.mesh.position.copy(v.pos);
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

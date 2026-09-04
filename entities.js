// =============================================================================
// ENTITIES — extracted from main.js (see numbered sections). No logic change.
// =============================================================================
import * as THREE from 'three';
import {
  makeStaticBaker, PI, TAU, clamp, lerp, rand, irand, pick, sign, dist2, COLORS, G, PRICE, PAINT_COLORS, ROAD_WIDTH, PED_TARGET, GAMEPLAY, TRAFFIC_TARGET, trafficTarget, _camTarget, _camOffset, _fireDir, _ray, _bbox, _vBox, _blackColor, disposeObject, BLOCK, GRID, HALF, lerpAngle
} from './core.js';
import { attachHeroBike } from './gltf.js';

// 4. PLAYER + CAMERA
// =============================================================================

export function makePlayer(scene) {
  const group = new THREE.Group();
  const bodyMat = new THREE.MeshStandardMaterial({ color: 0xd44b3b, roughness: 0.7 });
  const pantsMat = new THREE.MeshStandardMaterial({ color: 0x232a35, roughness: 0.8 });
  const skinMat = new THREE.MeshStandardMaterial({ color: 0xc69472, roughness: 0.8 });
  const hairMat = new THREE.MeshStandardMaterial({ color: 0x17110e, roughness: 0.86 });
  const shoeMat = new THREE.MeshStandardMaterial({ color: 0x111111, roughness: 0.7 });

  const pelvis = new THREE.Mesh(new THREE.BoxGeometry(0.44, 0.18, 0.24), pantsMat);
  pelvis.position.y = 0.82; pelvis.castShadow = true; group.add(pelvis);
  const torso = new THREE.Mesh(new THREE.CapsuleGeometry(0.25, 0.5, 4, 9), bodyMat);
  torso.position.y = 1.15; torso.scale.set(1.12, 1, 0.74); torso.castShadow = true; group.add(torso);
  const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.075, 0.1, 6), skinMat);
  neck.position.y = 1.47; group.add(neck);
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.2, 12, 10), skinMat);
  head.position.y = 1.62; head.scale.set(0.92, 1.08, 0.9); head.castShadow = true; group.add(head);
  const nose = new THREE.Mesh(new THREE.BoxGeometry(0.045, 0.045, 0.055), skinMat);
  nose.position.set(0, 1.61, 0.18); group.add(nose);
  const hair = new THREE.Mesh(new THREE.SphereGeometry(0.205, 12, 6, 0, TAU, 0, PI * 0.56), hairMat);
  hair.position.set(0, 1.73, -0.015); hair.scale.set(0.95, 0.58, 0.88); hair.castShadow = true; group.add(hair);

  function limb(len, r, mat, cast=true) {
    const geo = new THREE.CapsuleGeometry(r, len, 4, 7);
    geo.translate(0, -(len / 2 + r), 0);
    const mesh = new THREE.Mesh(geo, mat);
    mesh.castShadow = cast;
    return mesh;
  }
  function jointedLimb(totalLen, r, mat, cast=true) {
    const upperLen = totalLen * 0.45;
    const lowerLen = totalLen * 0.43;
    const upper = limb(upperLen, r, mat, cast);
    const lower = limb(lowerLen, r * 0.92, mat, cast);
    lower.position.y = -(upperLen + r * 1.85);
    upper.add(lower);
    return { upper, lower, lowerLen, lowerR: r * 0.92 };
  }
  function shoe(parent, y) {
    const s = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.08, 0.26), shoeMat);
    s.position.set(0, y, 0.07); s.castShadow = true; parent.add(s);
  }

  const jlL = jointedLimb(0.62, 0.075, pantsMat); const legL = jlL.upper, shinL = jlL.lower; legL.position.set(-0.13, 0.82, 0); group.add(legL); shoe(shinL, -(jlL.lowerLen + jlL.lowerR * 2) + 0.03);
  const jlR = jointedLimb(0.62, 0.075, pantsMat); const legR = jlR.upper, shinR = jlR.lower; legR.position.set( 0.13, 0.82, 0); group.add(legR); shoe(shinR, -(jlR.lowerLen + jlR.lowerR * 2) + 0.03);
  const jaL = jointedLimb(0.52, 0.058, bodyMat, false); const armL = jaL.upper, foreL = jaL.lower; armL.position.set(-0.33, 1.38, 0); armL.rotation.z = -0.12; group.add(armL);
  const jaR = jointedLimb(0.52, 0.058, bodyMat, false); const armR = jaR.upper, foreR = jaR.lower; armR.position.set( 0.33, 1.38, 0); armR.rotation.z =  0.12; group.add(armR);
  for (const arm of [foreL, foreR]) {
    const hand = new THREE.Mesh(new THREE.SphereGeometry(0.062, 7, 6), skinMat);
    hand.position.y = -0.33; hand.castShadow = true; arm.add(hand);
  }

  // Held pistol model (hidden by default). It is parented to the right arm so
  // the chase camera clearly reads it as being in the player's hand.
  const pistol = new THREE.Group();
  const gunMat = new THREE.MeshStandardMaterial({ color: 0x191b1f, metalness: 0.75, roughness: 0.34 });
  const gunDarkMat = new THREE.MeshStandardMaterial({ color: 0x08090b, metalness: 0.45, roughness: 0.5 });
  const gunBody = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.10, 0.36), gunMat);
  gunBody.position.set(0, 0, 0.12); gunBody.castShadow = true; pistol.add(gunBody);
  const gunBarrel = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 0.26, 8), gunMat);
  gunBarrel.rotation.x = PI / 2; gunBarrel.position.set(0, 0.006, 0.36); gunBarrel.castShadow = true; pistol.add(gunBarrel);
  const gunGrip = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.24, 0.11), gunDarkMat);
  gunGrip.position.set(-0.01, -0.16, -0.02); gunGrip.rotation.x = -0.18; gunGrip.castShadow = true; pistol.add(gunGrip);
  const trigger = new THREE.Mesh(new THREE.TorusGeometry(0.045, 0.008, 5, 10), gunDarkMat);
  trigger.rotation.x = PI / 2; trigger.position.set(0, -0.075, 0.11); pistol.add(trigger);
  const sight = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.025, 0.035), gunDarkMat);
  sight.position.set(0, 0.065, -0.035); pistol.add(sight);
  pistol.position.set(0.03, -0.64, 0.07);
  pistol.scale.setScalar(1.18);
  pistol.visible = false;
  armR.add(pistol);

  group.position.copy(G.world.spawns.player);
  scene.add(group);

  return {
    group, torso, legs: legR, legL, legR, pelvis, head, neck, hair, armL, armR, pistol,
    parts: { torso, pelvis, head, neck, hair, legL, legR, shinL, shinR, armL, armR, foreL, foreR },
    velocity: new THREE.Vector3(),
    yaw: 0, pitch: 0,
    grounded: true,
    hp: 100, hpMax: 100,
    stam: 100, stamMax: 100,
    armor: 0, armorMax: 100,
    sprintLock: false,
    weapons: { fists: true, pistol: false, smg: false, shotgun: false, cleaver: false, bottle: false },
    activeWeapon: 'fists',
    pistolAmmo: 0, pistolMag: 12, pistolReserve: 36,
    smgAmmo: 0, smgMag: 30, smgReserve: 90,
    shotgunAmmo: 0, shotgunMag: 6, shotgunReserve: 24,
    inVehicle: null,
    // combat anim state
    attackTimer: 0, attackDur: 0.25, attackKind: null, attackCooldown: 0,
    // melee combo: step rises 0->1->2 while you keep swinging in rhythm; comboWindow
    // is the time left to continue the chain before it resets to a fresh jab.
    comboStep: 0, comboWindow: 0,
    blocking: false,
    // hit recovery
    hitFlashT: 0,
    deadT: 0,
    gunRecoil: 0,
    regenLockT: 0,
    // bribe
    canBribeUntil: 0,
  };
}

export function makeCamera() {
  const cam = new THREE.PerspectiveCamera(72, window.innerWidth / window.innerHeight, 0.5, 2200);
  cam.position.set(0, 5, 12);
  return {
    cam,
    yaw: 0, pitch: -0.15,
    distance: 4.5, height: 1.9, targetDistance: 4.5,
    shake: 0,
  };
}

// =============================================================================
// 5. VEHICLES
// =============================================================================

function vehicleMat(color, roughness=0.55, metalness=0.25) {
  return new THREE.MeshStandardMaterial({ color, roughness, metalness });
}

function vehicleLightMat(color, opacity=0.72) {
  return new THREE.MeshBasicMaterial({ color, transparent: true, opacity });
}

function addVehicleBox(parent, size, mat, pos, rot=null, cast=true) {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(size[0], size[1], size[2]), mat);
  mesh.position.set(pos[0], pos[1], pos[2]);
  if (rot) mesh.rotation.set(rot[0], rot[1], rot[2]);
  mesh.castShadow = cast;
  parent.add(mesh);
  return mesh;
}

function addVehiclePanel(parent, w, h, mat, pos, rot=null) {
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(w, h), mat);
  mesh.position.set(pos[0], pos[1], pos[2]);
  if (rot) mesh.rotation.set(rot[0], rot[1], rot[2]);
  parent.add(mesh);
  return mesh;
}

function addVisualWheel(root, visual, x, z, radius, width, front=false) {
  const mount = new THREE.Group();
  mount.position.set(x, radius, z);
  root.add(mount);
  const spin = new THREE.Group();
  mount.add(spin);

  const tire = new THREE.Mesh(
    new THREE.CylinderGeometry(radius, radius, width, 14),
    new THREE.MeshStandardMaterial({ color: 0x080808, roughness: 0.9 })
  );
  tire.rotation.z = PI/2; tire.castShadow = true; spin.add(tire);
  const rimMat = new THREE.MeshStandardMaterial({ color: 0x9a9a9a, roughness: 0.35, metalness: 0.75 });
  const rim = new THREE.Mesh(new THREE.CylinderGeometry(radius * 0.43, radius * 0.43, width + 0.02, 10), rimMat);
  rim.rotation.z = PI/2; spin.add(rim);
  for (let i = 0; i < 4; i++) {
    const spoke = addVehicleBox(spin, [0.025, radius * 0.82, 0.025], rimMat, [0, 0, 0], null, false);
    spoke.rotation.z = PI/2 + i * PI/4;
  }
  visual.wheels.push({ mount, spin, radius, front });
}

function addWheelArch(root, x, z, radius, mat) {
  const arch = new THREE.Mesh(new THREE.TorusGeometry(radius + 0.07, 0.026, 5, 12, PI), mat);
  arch.position.set(x, radius + 0.1, z);
  arch.rotation.set(0, PI/2, PI);
  root.add(arch);
}

function addMirrors(root, dims, trim) {
  if (dims.W < 1.2 || dims.L > 8) return;
  const z = dims.L * 0.18;
  const y = Math.min(dims.H * 0.62 + 0.35, dims.H - 0.15);
  for (const sx of [-1, 1]) {
    addVehicleBox(root, [0.18, 0.035, 0.035], trim, [sx * (dims.W * 0.48), y, z], [0, 0, sx * 0.12], true);
    addVehicleBox(root, [0.08, 0.12, 0.035], trim, [sx * (dims.W * 0.56), y + 0.01, z + 0.03], [0, sx * 0.18, 0], true);
  }
}

function configureLodGroup(group, low) {
  const high = group.children.slice();
  low.name = 'lod-low';
  low.visible = false;
  low.userData.lodProxy = true;
  group.add(low);
  group.userData.lod = { high, low, state: 'high' };
}

export function setGroupLod(group, mode) {
  const lod = group && group.userData && group.userData.lod;
  if (!lod || lod.state === mode) return;
  const highVisible = mode !== 'low';
  for (const child of lod.high) child.visible = highVisible && !(child.userData && child.userData.propHidden);
  lod.low.visible = !highVisible;
  lod.state = mode;
}

function applyVehicleRealismSpec(spec, kind) {
  if (!spec) return spec;
  const family = spec.kind || kind;
  if (family === 'bike') {
    spec.wheelbase = spec.wheelbase || 1.3;
    spec.grip = spec.grip || 11;
    spec.frictionFloor = 0.12;
    spec.powerYaw = 0;
  } else if (family === 'tuktuk') {
    spec.wheelbase = spec.wheelbase || 2.0;
    spec.grip = spec.grip || 7.5;
    spec.frictionFloor = 0.22;
    spec.powerYaw = 0.35;
  } else if (family === 'hilux' || family === 'songthaew' || family === 'cop' || family === 'fortuner') {
    spec.wheelbase = spec.wheelbase || 2.9;
    spec.grip = spec.grip || 8.5;
    spec.frictionFloor = 0.20;
    spec.powerYaw = 0;
  } else if (family === 'bus' || family === 'swat') {
    spec.wheelbase = spec.wheelbase || 4.8;
    spec.grip = spec.grip || 8.0;
    spec.frictionFloor = 0.24;
    spec.powerYaw = 0;
  } else if (family === 'supercar') {
    spec.wheelbase = spec.wheelbase || 2.6;
    spec.grip = spec.grip || 11.5;
    spec.frictionFloor = 0.08;
    spec.powerYaw = 0;
  } else if (family === 'airliner') {
    spec.wheelbase = spec.wheelbase || 14;
    spec.grip = spec.grip || 6.2;
    spec.frictionFloor = 0.30;
    spec.powerYaw = 0;
  } else if (family !== 'boat') {
    spec.wheelbase = spec.wheelbase || 2.6;
    spec.grip = spec.grip || 9.5;
    spec.frictionFloor = 0.18;
    spec.powerYaw = 0;
  }
  return spec;
}

function makePedLodProxy(shirtColor, pantsColor, skinColor, kind) {
  const low = new THREE.Group();
  const shirt = new THREE.MeshBasicMaterial({ color: shirtColor });
  const pants = new THREE.MeshBasicMaterial({ color: pantsColor });
  const skin = new THREE.MeshBasicMaterial({ color: skinColor });
  const dark = new THREE.MeshBasicMaterial({ color: 0x171717 });
  const torso = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.66, 0.22), shirt);
  torso.position.y = 1.08; low.add(torso);
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.13, 6, 5), skin);
  head.position.y = 1.52; low.add(head);
  const legs = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.58, 0.18), pants);
  legs.position.y = 0.5; low.add(legs);
  const shoes = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.08, 0.22), dark);
  shoes.position.y = 0.1; low.add(shoes);
  if (kind === 'vendor' || kind === 'laborer') {
    const hat = new THREE.Mesh(new THREE.ConeGeometry(0.23, 0.16, 7), new THREE.MeshBasicMaterial({ color: 0xcba76a }));
    hat.position.y = 1.66; low.add(hat);
  }
  return low;
}

function vehicleBodyColor(group) {
  let best = null, bestVol = -1;
  group.traverse(o => {
    if (!o.isMesh || !o.material || !o.material.color || !o.geometry) return;
    if (!o.geometry.boundingBox) o.geometry.computeBoundingBox();
    const b = o.geometry.boundingBox;
    const vol = (b.max.x - b.min.x) * (b.max.y - b.min.y) * (b.max.z - b.min.z);
    if (vol > bestVol) { bestVol = vol; best = o.material.color.getHex(); }
  });
  return best == null ? 0x777777 : best;
}

function makeVehicleLodProxy(group, kind) {
  const dims = group.userData.dims;
  if (!dims) return null;
  const low = new THREE.Group();
  const paint = new THREE.MeshBasicMaterial({ color: vehicleBodyColor(group) });
  const dark = new THREE.MeshBasicMaterial({ color: 0x111111 });
  const glass = new THREE.MeshBasicMaterial({ color: 0x182331 });
  if (kind === 'bike') {
    addVehicleBox(low, [0.42, 0.32, 1.45], paint, [0, 0.52, 0], null, false);
    addVehicleBox(low, [0.58, 0.08, 0.08], dark, [0, 0.95, 0.52], null, false);
    for (const z of [-0.7, 0.7]) addVehicleBox(low, [0.12, 0.55, 0.55], dark, [0, 0.3, z], null, false);
  } else if (kind === 'boat') {
    addVehicleBox(low, [dims.W, 0.48, dims.L], paint, [0, 0.35, 0], null, false);
    addVehicleBox(low, [0.12, 0.1, dims.L * 1.15], dark, [0, 0.76, -0.25], [0.25, 0, 0], false);
  } else if (kind === 'airliner') {
    addVehicleBox(low, [3.4, 3.2, dims.L * 0.9], paint, [0, 3.0, 0], null, false);
    addVehicleBox(low, [dims.W * 2.4, 0.28, 6], paint, [0, 2.3, -2], null, false);
    addVehicleBox(low, [0.35, 5.5, 3.4], dark, [0, 6.0, -14], null, false);
  } else {
    addVehicleBox(low, [dims.W * 0.94, Math.max(0.42, dims.H * 0.35), dims.L * 0.96], paint, [0, Math.max(0.55, dims.H * 0.3), 0], null, false);
    addVehicleBox(low, [dims.W * 0.72, Math.max(0.28, dims.H * 0.25), dims.L * 0.34], glass, [0, Math.max(1.0, dims.H * 0.58), dims.L * 0.03], null, false);
    for (const z of [-dims.L * 0.34, dims.L * 0.34]) for (const x of [-dims.W * 0.42, dims.W * 0.42]) {
      addVehicleBox(low, [0.16, 0.34, 0.34], dark, [x, 0.32, z], null, false);
    }
  }
  return low;
}

function enhanceVehicleVisual(g, kind) {
  const dims = g.userData.dims;
  if (!dims || kind === 'boat' || kind === 'airliner') return;
  const visual = g.userData.visual || (g.userData.visual = { wheels: [], headlights: [], brakeLights: [], reverseLights: [] });
  const trim = vehicleMat(0x0b0d10, 0.82, 0.12);
  const plateMat = new THREE.MeshBasicMaterial({ color: 0xf2e6ba });
  const headMat = vehicleLightMat(0xfff0aa, 0.78);
  const tailMat = vehicleLightMat(0xff3030, 0.58);
  const reverseMat = vehicleLightMat(0xe8f2ff, 0.25);
  const frontZ = dims.L * 0.49, rearZ = -dims.L * 0.49;
  const y = Math.max(0.5, dims.H * 0.34);

  if (dims.W > 1.1) {
    addVehicleBox(g, [dims.W * 0.78, 0.14, 0.08], trim, [0, y - 0.22, frontZ], null, false);
    addVehicleBox(g, [dims.W * 0.72, 0.13, 0.08], trim, [0, y - 0.2, rearZ], null, false);
    addVehicleBox(g, [0.42, 0.14, 0.035], plateMat, [0, y - 0.05, frontZ + 0.02], null, false);
    addVehicleBox(g, [0.38, 0.13, 0.035], plateMat, [0, y - 0.05, rearZ - 0.02], null, false);
    addVehicleBox(g, [dims.W * 0.48, 0.1, 0.05], trim, [0, y + 0.08, frontZ + 0.02], null, false);
    for (const sx of [-1, 1]) {
      const hx = sx * dims.W * 0.32;
      visual.headlights.push(addVehicleBox(g, [0.26, 0.12, 0.04], headMat, [hx, y + 0.06, frontZ + 0.025], null, false));
      visual.brakeLights.push(addVehicleBox(g, [0.22, 0.12, 0.04], tailMat, [sx * dims.W * 0.34, y + 0.04, rearZ - 0.025], null, false));
      visual.reverseLights.push(addVehicleBox(g, [0.1, 0.08, 0.04], reverseMat, [sx * dims.W * 0.18, y + 0.02, rearZ - 0.03], null, false));
    }
    addMirrors(g, dims, trim);
  }

  const r = kind === 'bus' ? 0.55 : kind === 'swat' ? 0.5 : kind === 'bike' || kind === 'tuktuk' ? 0.32 : dims.H > 2.2 ? 0.42 : 0.34;
  const w = kind === 'bus' || kind === 'swat' ? 0.36 : kind === 'bike' ? 0.13 : 0.24;
  if (kind === 'bike') {
    addVisualWheel(g, visual, 0, dims.L * 0.43, r, w, true);
    addVisualWheel(g, visual, 0, -dims.L * 0.43, r, w, false);
  } else if (kind === 'tuktuk') {
    addVisualWheel(g, visual, 0, dims.L * 0.38, r, w, true);
    for (const x of [-dims.W * 0.45, dims.W * 0.45]) addVisualWheel(g, visual, x, -dims.L * 0.35, r, w, false);
  } else {
    const zs = kind === 'bus' ? [-dims.L * 0.34, 0, dims.L * 0.3] : [-dims.L * 0.34, dims.L * 0.34];
    for (const z of zs) for (const x of [-dims.W * 0.45, dims.W * 0.45]) {
      addVisualWheel(g, visual, x, z, r, w, z > 0);
      if (kind !== 'bus' && kind !== 'swat') addWheelArch(g, x, z, r, trim);
    }
  }
}

export function updateEntityLod() {
  if (!G.player) return;
  const viewer = (G.player.inVehicle && G.player.inVehicle.pos) || G.player.group.position;
  const pedNear = 46 * 46, pedFar = 62 * 62;
  const vehNear = 72 * 72, vehFar = 96 * 96;
  const stats = { pedHigh: 0, pedLow: 0, vehicleHigh: 0, vehicleLow: 0, nearPeds: 0, nearVehicles: 0 };

  for (const ped of G.peds) {
    if (!ped || ped.dead || !ped.mesh) continue;
    const d2 = dist2(ped.mesh.position, viewer);
    const special = ped.gang || ped.isTarget || ped.isMugger || ped.anchor || ped.alms || ped.yaowaratNight || ped.btsWait;
    if (d2 < pedNear) stats.nearPeds++;
    let mode = ped.mesh.userData.lod && ped.mesh.userData.lod.state || 'high';
    if (special) mode = 'high';
    else if (mode === 'high' && d2 > pedFar) mode = 'low';
    else if (mode === 'low' && d2 < pedNear) mode = 'high';
    setGroupLod(ped.mesh, mode);
    if (mode === 'low') stats.pedLow++; else stats.pedHigh++;
  }

  for (const v of G.vehicles) {
    if (!v || v.dead || !v.mesh) continue;
    const d2 = dist2(v.pos, viewer);
    if (d2 < vehNear) stats.nearVehicles++;
    let mode = v.mesh.userData.lod && v.mesh.userData.lod.state || 'high';
    if (v.driver === 'player') mode = 'high';
    else if (mode === 'high' && d2 > vehFar) mode = 'low';
    else if (mode === 'low' && d2 < vehNear) mode = 'high';
    setGroupLod(v.mesh, mode);
    if (mode === 'low') stats.vehicleLow++; else stats.vehicleHigh++;
  }
  G.lodStats = stats;
}

export function makeVehicleMesh(kind) {
  const g = new THREE.Group();
  g.userData.kind = kind;
  g.userData.visual = { wheels: [], headlights: [], brakeLights: [], reverseLights: [] };
  if (kind === 'bike') {
    const frame = new THREE.Mesh(
      new THREE.BoxGeometry(0.5, 0.4, 1.6),
      new THREE.MeshStandardMaterial({ color: 0xd6363c, roughness: 0.5, metalness: 0.4 })
    );
    frame.position.y = 0.5; g.add(frame);
    const seat = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.1, 0.6), new THREE.MeshStandardMaterial({ color: 0x222 }));
    seat.position.set(0, 0.78, -0.05); g.add(seat);
    const wheelMat = new THREE.MeshStandardMaterial({ color: 0x111, roughness: 0.8 });
    const wF = new THREE.Mesh(new THREE.TorusGeometry(0.32, 0.08, 8, 16), wheelMat);
    wF.rotation.y = PI/2; wF.position.set(0, 0.32, 0.8); g.add(wF);
    const wR = wF.clone(); wR.position.z = -0.8; g.add(wR);
    const handle = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.06, 0.08), new THREE.MeshStandardMaterial({ color: 0x111 }));
    handle.position.set(0, 1.0, 0.7); g.add(handle);
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.13, 8, 8), new THREE.MeshBasicMaterial({ color: 0xffffaa }));
    head.position.set(0, 0.85, 0.9); g.add(head);
    g.userData.dims = { L: 1.9, W: 0.7, H: 1.2 };
    g.userData.spec = { topSpeed: 22, accel: 14, brake: 18, turn: 2.4, mass: 180, kind: 'bike' };
  } else if (kind === 'tuktuk') {
    const body = new THREE.Mesh(new THREE.BoxGeometry(1.4, 1.2, 2.4), new THREE.MeshStandardMaterial({ color: 0x1e9a5e, roughness: 0.5 }));
    body.position.y = 0.85; g.add(body);
    const roof = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.1, 2.2), new THREE.MeshStandardMaterial({ color: 0xffcf4a, roughness: 0.5 }));
    roof.position.y = 1.55; g.add(roof);
    const windshield = new THREE.Mesh(new THREE.PlaneGeometry(1.3, 0.7), new THREE.MeshBasicMaterial({ color: 0x223344, transparent:true, opacity: 0.65 }));
    windshield.position.set(0, 1.2, 1.25); g.add(windshield);
    const wheelMat = new THREE.MeshStandardMaterial({ color: 0x111 });
    const wF = new THREE.Mesh(new THREE.CylinderGeometry(0.32, 0.32, 0.18, 12), wheelMat);
    wF.rotation.z = PI/2; wF.position.set(0, 0.32, 1.0); g.add(wF);
    for (const x of [-0.65, 0.65]) {
      const wR = new THREE.Mesh(new THREE.CylinderGeometry(0.32, 0.32, 0.18, 12), wheelMat);
      wR.rotation.z = PI/2; wR.position.set(x, 0.32, -0.9); g.add(wR);
    }
    g.userData.dims = { L: 2.6, W: 1.5, H: 1.7 };
    g.userData.spec = { topSpeed: 16, accel: 9, brake: 14, turn: 2.0, mass: 350, kind: 'tuktuk' };
  } else if (kind === 'hilux') {
    const body = new THREE.Mesh(new THREE.BoxGeometry(1.9, 1.0, 3.5), new THREE.MeshStandardMaterial({ color: 0x2a3a55, roughness: 0.7 }));
    body.position.y = 0.9; g.add(body);
    const cab = new THREE.Mesh(new THREE.BoxGeometry(1.85, 0.8, 1.6), new THREE.MeshStandardMaterial({ color: 0x2a3a55, roughness: 0.7 }));
    cab.position.set(0, 1.65, 0.4); g.add(cab);
    const bed = new THREE.Mesh(new THREE.BoxGeometry(1.85, 0.4, 1.6), new THREE.MeshStandardMaterial({ color: 0x1a2335 }));
    bed.position.set(0, 1.25, -1.0); g.add(bed);
    const windshield = new THREE.Mesh(new THREE.PlaneGeometry(1.7, 0.6), new THREE.MeshBasicMaterial({ color: 0x223344, transparent:true, opacity: 0.65 }));
    windshield.position.set(0, 1.85, 1.21); g.add(windshield);
    const wheelMat = new THREE.MeshStandardMaterial({ color: 0x111 });
    for (const z of [-1.3, 1.3]) for (const x of [-0.9, 0.9]) {
      const w = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.42, 0.3, 14), wheelMat);
      w.rotation.z = PI/2; w.position.set(x, 0.42, z); g.add(w);
    }
    g.userData.dims = { L: 3.8, W: 2.0, H: 2.2 };
    g.userData.spec = { topSpeed: 26, accel: 12, brake: 18, turn: 1.6, mass: 1800, kind: 'hilux' };
  } else if (kind === 'cop') {
    // cop = isuzu d-max — orange hilux variant with blue/red light bar
    const body = new THREE.Mesh(new THREE.BoxGeometry(1.9, 1.0, 3.5), new THREE.MeshStandardMaterial({ color: 0x1a3a6a, roughness: 0.65 }));
    body.position.y = 0.9; g.add(body);
    const cab = new THREE.Mesh(new THREE.BoxGeometry(1.85, 0.8, 1.6), new THREE.MeshStandardMaterial({ color: 0xf0f0f0, roughness: 0.65 }));
    cab.position.set(0, 1.65, 0.4); g.add(cab);
    const bed = new THREE.Mesh(new THREE.BoxGeometry(1.85, 0.4, 1.6), new THREE.MeshStandardMaterial({ color: 0x101a2a }));
    bed.position.set(0, 1.25, -1.0); g.add(bed);
    const bar = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.18, 0.4), new THREE.MeshStandardMaterial({ color: 0x222 }));
    bar.position.set(0, 2.1, 0.4); g.add(bar);
    const lampR = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.1, 0.3), new THREE.MeshBasicMaterial({ color: 0xff2222 }));
    lampR.position.set(-0.4, 2.2, 0.4); g.add(lampR);
    const lampB = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.1, 0.3), new THREE.MeshBasicMaterial({ color: 0x2266ff }));
    lampB.position.set( 0.4, 2.2, 0.4); g.add(lampB);
    g.userData.copLamps = [lampR, lampB];
    const wheelMat = new THREE.MeshStandardMaterial({ color: 0x111 });
    for (const z of [-1.3, 1.3]) for (const x of [-0.9, 0.9]) {
      const w = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.42, 0.3, 14), wheelMat);
      w.rotation.z = PI/2; w.position.set(x, 0.42, z); g.add(w);
    }
    g.userData.dims = { L: 3.8, W: 2.0, H: 2.2 };
    g.userData.spec = { topSpeed: 28, accel: 13, brake: 18, turn: 1.7, mass: 1800, kind: 'cop' };
  } else if (kind === 'fortuner') {
    // unmarked Crime Suppression SUV — dark, no light bar, just a dash flasher
    const paint = 0x15161c;
    const paintMat = new THREE.MeshStandardMaterial({ color: paint, roughness: 0.5, metalness: 0.5 });
    const body = new THREE.Mesh(new THREE.BoxGeometry(1.95, 1.15, 3.7), paintMat);
    body.position.y = 0.95; g.add(body);
    const cab = new THREE.Mesh(new THREE.BoxGeometry(1.9, 0.95, 2.4), paintMat);
    cab.position.set(0, 1.75, -0.1); g.add(cab);
    const windshield = new THREE.Mesh(new THREE.PlaneGeometry(1.7, 0.7), new THREE.MeshBasicMaterial({ color: 0x111820, transparent: true, opacity: 0.7 }));
    windshield.position.set(0, 1.85, 1.12); g.add(windshield);
    const wheelMat = new THREE.MeshStandardMaterial({ color: 0x111 });
    for (const z of [-1.35, 1.35]) for (const x of [-0.92, 0.92]) {
      const w = new THREE.Mesh(new THREE.CylinderGeometry(0.44, 0.44, 0.32, 14), wheelMat);
      w.rotation.z = PI/2; w.position.set(x, 0.44, z); g.add(w);
    }
    // small red dash flasher (static) — the only tell that it's police
    const dash = new THREE.Mesh(new THREE.BoxGeometry(0.25, 0.06, 0.12), new THREE.MeshBasicMaterial({ color: 0xff2222 }));
    dash.position.set(0, 1.55, 1.0); g.add(dash);
    g.userData.dims = { L: 4.0, W: 2.0, H: 2.3 };
    g.userData.spec = { topSpeed: 32, accel: 15, brake: 19, turn: 1.7, mass: 2000, kind: 'fortuner' };
  } else if (kind === 'swat') {
    // armored SWAT van — the 4★ response
    const paint = new THREE.MeshStandardMaterial({ color: 0x1a2028, roughness: 0.6, metalness: 0.4 });
    const body = new THREE.Mesh(new THREE.BoxGeometry(2.2, 2.0, 4.8), paint);
    body.position.y = 1.3; g.add(body);
    const cab = new THREE.Mesh(new THREE.BoxGeometry(2.1, 1.0, 1.4), paint);
    cab.position.set(0, 2.0, 1.4); g.add(cab);
    const windshield = new THREE.Mesh(new THREE.PlaneGeometry(1.9, 0.7), new THREE.MeshBasicMaterial({ color: 0x111820, transparent: true, opacity: 0.8 }));
    windshield.position.set(0, 2.0, 2.11); g.add(windshield);
    const bar = new THREE.Mesh(new THREE.BoxGeometry(1.4, 0.18, 0.3), new THREE.MeshBasicMaterial({ color: 0x2244ff }));
    bar.position.set(0, 2.6, 0.4); g.add(bar);
    const wheelMat = new THREE.MeshStandardMaterial({ color: 0x111111 });
    for (const z of [-1.6, 1.6]) for (const x of [-1.05, 1.05]) {
      const w = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.5, 0.4, 14), wheelMat);
      w.rotation.z = PI/2; w.position.set(x, 0.5, z); g.add(w);
    }
    g.userData.dims = { L: 4.9, W: 2.3, H: 2.8 };
    g.userData.spec = { topSpeed: 26, accel: 13, brake: 18, turn: 1.4, mass: 3500, kind: 'swat' };
  } else if (kind === 'songthaew') {
    // red shared-taxi pickup with a covered passenger bench in the back
    const red = 0xb83434;
    const paint = new THREE.MeshStandardMaterial({ color: red, roughness: 0.6 });
    const body = new THREE.Mesh(new THREE.BoxGeometry(1.9, 1.0, 3.6), paint);
    body.position.y = 0.9; g.add(body);
    const cab = new THREE.Mesh(new THREE.BoxGeometry(1.85, 0.8, 1.3), paint);
    cab.position.set(0, 1.65, 0.9); g.add(cab);
    const canopy = new THREE.Mesh(new THREE.BoxGeometry(1.9, 0.12, 2.0), new THREE.MeshStandardMaterial({ color: 0xd9d9d9, roughness: 0.7 }));
    canopy.position.set(0, 2.15, -0.7); g.add(canopy);
    for (const xx of [-0.85, 0.85]) for (const zz of [0.2, -1.6]) {
      const post = new THREE.Mesh(new THREE.BoxGeometry(0.08, 1.1, 0.08), new THREE.MeshStandardMaterial({ color: 0x888888 }));
      post.position.set(xx, 1.6, zz); g.add(post);
    }
    const windshield = new THREE.Mesh(new THREE.PlaneGeometry(1.7, 0.6), new THREE.MeshBasicMaterial({ color: 0x223344, transparent: true, opacity: 0.65 }));
    windshield.position.set(0, 1.85, 1.56); g.add(windshield);
    const wheelMat = new THREE.MeshStandardMaterial({ color: 0x111111 });
    for (const z of [-1.3, 1.3]) for (const x of [-0.9, 0.9]) {
      const w = new THREE.Mesh(new THREE.CylinderGeometry(0.4, 0.4, 0.3, 14), wheelMat);
      w.rotation.z = PI/2; w.position.set(x, 0.4, z); g.add(w);
    }
    g.userData.dims = { L: 3.8, W: 2.0, H: 2.4 };
    g.userData.spec = { topSpeed: 22, accel: 11, brake: 16, turn: 1.6, mass: 1700, kind: 'songthaew' };
  } else if (kind === 'boat') {
    // longtail boat — long thin hull, bench seat, raised stern motor pole
    const hull = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.6, 7), new THREE.MeshStandardMaterial({ color: 0x9a3a3a, roughness: 0.7 }));
    hull.position.y = 0.35; g.add(hull);
    const trim = new THREE.Mesh(new THREE.BoxGeometry(1.65, 0.16, 7.1), new THREE.MeshStandardMaterial({ color: 0xe0c060, roughness: 0.6 }));
    trim.position.y = 0.62; g.add(trim);
    const seat = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.2, 0.8), new THREE.MeshStandardMaterial({ color: 0x5a3a2a }));
    seat.position.set(0, 0.7, 0.5); g.add(seat);
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, 3, 6), new THREE.MeshStandardMaterial({ color: 0x333333 }));
    pole.position.set(0, 1.0, -3.6); pole.rotation.x = 0.6; g.add(pole);
    const prop = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.5, 0.1), new THREE.MeshStandardMaterial({ color: 0x222222 }));
    prop.position.set(0, 0.2, -4.6); g.add(prop);
    g.userData.dims = { L: 7.0, W: 1.7, H: 1.2 };
    g.userData.spec = { topSpeed: 18, accel: 8, brake: 7, turn: 1.2, mass: 800, kind: 'boat' };
  } else if (kind === 'bus') {
    const paint = pick([0x2a6a9a, 0x9a3a3a, 0x3a8a5a]);
    const body = new THREE.Mesh(new THREE.BoxGeometry(2.5, 2.4, 10.5), new THREE.MeshStandardMaterial({ color: paint, roughness: 0.5, metalness: 0.3 }));
    body.position.y = 1.6; g.add(body);
    const win = new THREE.Mesh(new THREE.BoxGeometry(2.52, 0.8, 9), new THREE.MeshBasicMaterial({ color: 0x223344, transparent: true, opacity: 0.7 }));
    win.position.set(0, 2.1, 0); g.add(win);
    const wheelMat = new THREE.MeshStandardMaterial({ color: 0x111111 });
    for (const z of [-3.5, 0, 3.2]) for (const x of [-1.2, 1.2]) {
      const w = new THREE.Mesh(new THREE.CylinderGeometry(0.55, 0.55, 0.4, 14), wheelMat);
      w.rotation.z = PI/2; w.position.set(x, 0.55, z); g.add(w);
    }
    g.userData.dims = { L: 10.8, W: 2.6, H: 3.3 };
    g.userData.spec = { topSpeed: 16, accel: 6, brake: 13, turn: 1.0, mass: 6000, kind: 'bus' };
  } else if (kind === 'luxsedan') {
    const body = new THREE.Mesh(new THREE.BoxGeometry(1.85, 0.75, 4.4), new THREE.MeshStandardMaterial({ color: pick([0x101015, 0x303842, 0x6a1020]), roughness: 0.25, metalness: 0.8 }));
    body.position.y = 0.7; g.add(body);
    const cab = new THREE.Mesh(new THREE.BoxGeometry(1.7, 0.6, 2.2), new THREE.MeshStandardMaterial({ color: 0x111418, roughness: 0.3, metalness: 0.6 }));
    cab.position.set(0, 1.25, -0.1); g.add(cab);
    const wheelMat = new THREE.MeshStandardMaterial({ color: 0x111111 });
    for (const z of [-1.5, 1.5]) for (const x of [-0.9, 0.9]) {
      const w = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.42, 0.3, 16), wheelMat);
      w.rotation.z = PI/2; w.position.set(x, 0.42, z); g.add(w);
    }
    g.userData.dims = { L: 4.4, W: 1.9, H: 1.5 };
    g.userData.spec = { topSpeed: 30, accel: 16, brake: 18, turn: 1.8, mass: 1500, kind: 'luxsedan' };
  } else if (kind === 'supercar') {
    const body = new THREE.Mesh(new THREE.BoxGeometry(1.9, 0.5, 4.2), new THREE.MeshStandardMaterial({ color: pick([0xffcc00, 0xff2a2a, 0x10b0d0]), roughness: 0.2, metalness: 0.85 }));
    body.position.y = 0.5; g.add(body);
    const cab = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.45, 1.6), new THREE.MeshBasicMaterial({ color: 0x111418, transparent: true, opacity: 0.8 }));
    cab.position.set(0, 0.92, -0.2); g.add(cab);
    const wheelMat = new THREE.MeshStandardMaterial({ color: 0x111111 });
    for (const z of [-1.5, 1.5]) for (const x of [-0.92, 0.92]) {
      const w = new THREE.Mesh(new THREE.CylinderGeometry(0.4, 0.4, 0.34, 16), wheelMat);
      w.rotation.z = PI/2; w.position.set(x, 0.4, z); g.add(w);
    }
    g.userData.dims = { L: 4.2, W: 1.95, H: 1.0 };
    g.userData.spec = { topSpeed: 40, accel: 22, brake: 22, turn: 2.0, mass: 1200, kind: 'supercar' };
  } else if (kind === 'airliner') {
    const body = new THREE.Mesh(new THREE.BoxGeometry(3.8, 3.6, 34), new THREE.MeshStandardMaterial({ color: 0xf2f0ea, roughness: 0.42, metalness: 0.25 }));
    body.position.y = 3.2; g.add(body);
    const nose = new THREE.Mesh(new THREE.BoxGeometry(3.2, 2.8, 4.2), new THREE.MeshStandardMaterial({ color: 0xf2f0ea, roughness: 0.42, metalness: 0.25 }));
    nose.position.set(0, 3.0, 18.2); g.add(nose);
    const stripe = new THREE.Mesh(new THREE.BoxGeometry(3.85, 0.55, 30), new THREE.MeshStandardMaterial({ color: 0x4a1a58, roughness: 0.5 }));
    stripe.position.set(0, 2.6, 0); g.add(stripe);
    const wing = new THREE.Mesh(new THREE.BoxGeometry(32, 0.35, 7.2), new THREE.MeshStandardMaterial({ color: 0xe6e2da, roughness: 0.5, metalness: 0.2 }));
    wing.position.set(0, 2.4, -2); g.add(wing);
    const tail = new THREE.Mesh(new THREE.BoxGeometry(0.4, 6.4, 4.2), new THREE.MeshStandardMaterial({ color: 0x4a1a58, roughness: 0.5 }));
    tail.position.set(0, 6.4, -15.4); g.add(tail);
    const hstab = new THREE.Mesh(new THREE.BoxGeometry(10, 0.28, 2.6), new THREE.MeshStandardMaterial({ color: 0xe6e2da, roughness: 0.5 }));
    hstab.position.set(0, 5.8, -16.2); g.add(hstab);
    const engMat = new THREE.MeshStandardMaterial({ color: 0x888c92, roughness: 0.35, metalness: 0.55 });
    for (const sx of [-1, 1]) {
      const eng = new THREE.Mesh(new THREE.CylinderGeometry(1.05, 1.05, 4.4, 10), engMat);
      eng.rotation.x = PI / 2; eng.position.set(sx * 6.4, 1.7, -1.2); g.add(eng);
    }
    const gearMat = new THREE.MeshStandardMaterial({ color: 0x222 });
    for (const z of [-8, 10]) for (const x of z > 0 ? [0] : [-1.2, 1.2]) {
      const w = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.42, 0.28, 10), gearMat);
      w.rotation.z = PI / 2; w.position.set(x, 0.42, z); g.add(w);
    }
    g.userData.dims = { L: 38, W: 12, H: 8 };
    g.userData.spec = { topSpeed: 16, accel: 8, brake: 12, turn: 1.15, mass: 18000, kind: 'airliner', rollDrag: 0.65 };
  } else if (kind === 'camry' || kind === 'sedan') {
    const color = kind === 'sedan' ? pick([0x222, 0xf5f5f5, 0xc23a3a, 0x335a99, 0x8c8c8c]) : 0xeeeeee;
    const body = new THREE.Mesh(new THREE.BoxGeometry(1.7, 0.9, 3.6), new THREE.MeshStandardMaterial({ color, roughness: 0.55, metalness: 0.4 }));
    body.position.y = 0.7; g.add(body);
    const cab = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.65, 1.5), new THREE.MeshStandardMaterial({ color, roughness: 0.5, metalness: 0.4 }));
    cab.position.set(0, 1.35, 0.1); g.add(cab);
    const windshield = new THREE.Mesh(new THREE.PlaneGeometry(1.4, 0.55), new THREE.MeshBasicMaterial({ color: 0x223344, transparent:true, opacity: 0.6 }));
    windshield.position.set(0, 1.55, 0.86); g.add(windshield);
    const wheelMat = new THREE.MeshStandardMaterial({ color: 0x111 });
    for (const z of [-1.2, 1.2]) for (const x of [-0.78, 0.78]) {
      const w = new THREE.Mesh(new THREE.CylinderGeometry(0.32, 0.32, 0.22, 12), wheelMat);
      w.rotation.z = PI/2; w.position.set(x, 0.32, z); g.add(w);
    }
    g.userData.dims = { L: 3.8, W: 1.8, H: 1.6 };
    g.userData.spec = { topSpeed: 24, accel: 11, brake: 16, turn: 1.7, mass: 1500, kind };
  }
  applyVehicleRealismSpec(g.userData.spec, kind);
  enhanceVehicleVisual(g, kind);
  const low = makeVehicleLodProxy(g, kind);
  if (low) configureLodGroup(g, low);
  return g;
}

export function makeVehicle(kind, scene) {
  const mesh = makeVehicleMesh(kind);
  scene.add(mesh);
  // car paint catches the sky env map for a glossier, less-flat look
  if (G.envMap) mesh.traverse(o => { if (o.material && o.material.isMeshStandardMaterial && o.material.metalness >= 0.2) { o.material.envMap = G.envMap; o.material.envMapIntensity = 0.7; } });
  const spec = mesh.userData.spec;
  // head/tail lights — per-vehicle materials that glow at night (driven from
  // G.nightK in updateVehicles; per-vehicle so disposeObject stays safe).
  const dims = mesh.userData.dims;
  const skipLights = kind === 'airliner' || kind === 'boat';
  const headMat = new THREE.MeshStandardMaterial({ color: 0x999999, emissive: 0xfff2cc, emissiveIntensity: 0 });
  const tailMat = new THREE.MeshStandardMaterial({ color: 0x331111, emissive: 0xff2222, emissiveIntensity: 0 });
  if (!skipLights) {
    const lightGeo = new THREE.PlaneGeometry(0.3, 0.18);
    const lz = dims.L * 0.46, lx = dims.W * 0.3, ly = dims.H * 0.32 + 0.2;
    for (const sx of [-1, 1]) {
      const hl = new THREE.Mesh(lightGeo, headMat);
      hl.position.set(sx * lx, ly, lz); mesh.add(hl);
      const tl = new THREE.Mesh(lightGeo, tailMat);
      tl.position.set(sx * lx, ly, -lz); tl.rotation.y = PI; mesh.add(tl);
    }
  }
  const veh = {
    kind, mesh, spec,
    pos: mesh.position,
    vel: 0,            // forward speed (m/s)
    latVel: 0,         // lateral slip speed in vehicle space (m/s, +right)
    heading: 0,        // yaw radians
    steerAngle: 0,
    yawRate: 0,
    wheelSpin: 0,
    hp: kind === 'airliner' ? 220 : 100,
    smoke: null, fire: null,
    dead: false,
    driver: null,      // 'player' | npc obj | null
    npc: null,
    audio: null,
    isCop: kind === 'cop' || kind === 'fortuner' || kind === 'swat',
    lights: skipLights ? null : [headMat, tailMat],
    visual: mesh.userData.visual,
    boundsHalf: { x: mesh.userData.dims.W * 0.5, z: mesh.userData.dims.L * 0.5 },
  };
  G.vehicles.push(veh);
  if (kind === 'bike') attachHeroBike(mesh);
  return veh;
}

// =============================================================================
// 6. NPCs — pedestrians, soi dogs, cops
// =============================================================================

// Pedestrian archetypes — silhouette + palette variety so the crowd reads as a
// city, not a row of identical capsules. Returns a Group with an animatable limb
// rig in userData.parts {torso, head, legL, legR, armL, armR}. `torso` stays one
// mesh so the mugger/target/kill recolor sites keep working; forearms are bare
// skin (Bangkok heat) so recoloring the torso never leaves mismatched sleeves.
// Shoes parent to the legs and hands to the arms, so they ride the walk swing for
// free; a short neck bridges shoulders to head so it doesn't float.
function pickPedKind(pos) {
  const h = ((G.time.dayT % 1) + 1) % 1 * 24;
  const poi = G.world && G.world.poi;
  if (poi && poi.temple && pos && dist2(pos, poi.temple) < 46 * 46) {
    const r = Math.random();
    return r < 0.42 ? 'monk' : r < 0.75 ? 'tourist' : 'local';
  }
  if (poi && poi.yaowarat && pos && dist2(pos, poi.yaowarat) < 62 * 62) {
    const night = (h >= 18 || h < 2);
    const r = Math.random();
    if (night) return r < 0.4 ? 'tourist' : r < 0.75 ? 'vendor' : 'local';
    return r < 0.38 ? 'vendor' : r < 0.7 ? 'local' : 'laborer';
  }
  const roll = Math.random();
  if (GAMEPLAY.schoolKids && h >= 6.2 && h < 8.6) {
    if (roll < 0.42) return 'school';
    if (roll < 0.55) return 'office';
    if (roll < 0.68) return 'local';
    return roll < 0.82 ? 'vendor' : 'laborer';
  }
  if (h >= 5 && h < 7) {
    if (roll < 0.22) return 'monk';
    if (roll < 0.38) return 'vendor';
    if (roll < 0.52) return 'laborer';
    return 'local';
  }
  if ((h >= 7.5 && h < 9.2) || (h >= 17 && h < 19.2)) {
    if (roll < 0.40) return 'office';
    if (roll < 0.52) return 'local';
    if (roll < 0.62) return 'vendor';
    return roll < 0.78 ? 'laborer' : 'tourist';
  }
  if (roll < 0.07) return 'monk';
  if (roll < 0.20) return 'tourist';
  if (roll < 0.34) return 'office';
  if (roll < 0.44) return 'vendor';
  if (roll < 0.55) return 'laborer';
  return 'local';
}

export function makePedMesh(forcedKind = null, pos = null) {
  const g = new THREE.Group();
  const kind = forcedKind || pickPedKind(pos);

  const skin = pick([0xc69472, 0xb88060, 0xd6a785, 0xa57755, 0x8d5a3a]);
  const skinMat = new THREE.MeshStandardMaterial({ color: skin, roughness: 0.7 });

  let shirtColor, pantsColor, bareArms = true, skirt = false;
  switch (kind) {
    case 'monk':    shirtColor = 0xe0892e; pantsColor = 0xd0801f; break;
    case 'tourist': shirtColor = pick([0xff6a3a, 0x39c6c0, 0xffd23a, 0x6a3aff, 0xff4f8b]);
                    pantsColor = pick([0xd9d2c7, 0x8090a0, 0x6a5a45]); break;          // shorts
    case 'office':  shirtColor = pick([0xffffff, 0xeaf0f6, 0xc7d6e6, 0xf0e6d2]);
                    pantsColor = pick([0x222831, 0x33384a, 0x4a3a2a]); bareArms = false; break;
    case 'vendor':  shirtColor = pick([0xd9d2c7, 0xc94f3a, 0x3a7d5a, 0xe0c060]);
                    pantsColor = pick([0x33384a, 0x222222, 0x5a4030]); break;
    case 'laborer': shirtColor = pick([0x6a8fb0, 0x9a8a60, 0xb0b0b0, 0x7a6a5a]);
                    pantsColor = pick([0x3a4658, 0x4a3a2a, 0x222222]); break;
    case 'school':  shirtColor = 0xf3f4f8; pantsColor = 0x1c355e; bareArms = false;
                    if (Math.random() < 0.42) skirt = true; break;
    default:        shirtColor = pick([0xffffff, 0xeeeeee, 0xdeb887, 0x223344, 0x556677, 0xb04040, 0xddcc88, 0x3a6a8a]);
                    pantsColor = pick([0x222222, 0x111111, 0x445566, 0x804020, 0x33384a]);
  }
  if ((kind === 'local' || kind === 'office') && Math.random() < 0.28) skirt = true;

  const shirtMat = new THREE.MeshStandardMaterial({ color: shirtColor, roughness: 0.82 });
  const pantsMat = new THREE.MeshStandardMaterial({ color: pantsColor, roughness: 0.85 });
  const armMat = bareArms ? skinMat : shirtMat;

  // torso — single mesh (recolor sites swap this material); flattened for shoulders
  const torso = new THREE.Mesh(new THREE.CapsuleGeometry(0.17, 0.4, 3, 8), shirtMat);
  torso.position.y = 1.18; torso.scale.set(1.18, 1, 0.72); torso.castShadow = true; g.add(torso);

  // neck — short skin stub so the head doesn't float on the shoulders
  const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.075, 0.1, 6), skinMat);
  neck.position.y = 1.42; g.add(neck);

  // head + hair/hat
  const headRoot = new THREE.Group();
  headRoot.position.y = 1.5;
  g.add(headRoot);
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.135, 10, 8), skinMat);
  head.scale.set(0.92, 1.06, 0.96); head.castShadow = true; headRoot.add(head);
  if (kind === 'vendor' || kind === 'laborer') {
    const hat = new THREE.Mesh(new THREE.ConeGeometry(0.26, 0.2, 10), new THREE.MeshStandardMaterial({ color: 0xcba76a, roughness: 0.9 }));
    hat.position.y = 0.1; headRoot.add(hat);                                   // conical straw hat
  } else if (kind === 'tourist' && Math.random() < 0.6) {
    const cap = new THREE.Mesh(new THREE.SphereGeometry(0.15, 8, 6, 0, TAU, 0, PI/2), new THREE.MeshStandardMaterial({ color: pick([0xb03030, 0x305080, 0xf0f0f0]) }));
    cap.position.y = 0.05; headRoot.add(cap);
  } else if (kind !== 'monk') {
    const hair = new THREE.Mesh(new THREE.SphereGeometry(0.145, 8, 6, 0, TAU, 0, PI/1.7), new THREE.MeshStandardMaterial({ color: pick([0x1a1410, 0x2a2018, 0x0a0a0a]) }));
    headRoot.add(hair);
  }

  // limbs — geometry offset so the mesh origin sits at the joint (rotation.x pivots there)
  function limb(len, r, mat, cast) {
    const geo = new THREE.CapsuleGeometry(r, len, 3, 6);
    geo.translate(0, -(len / 2 + r), 0);
    const m = new THREE.Mesh(geo, mat); m.castShadow = !!cast; return m;
  }
  function jointedLimb(totalLen, r, upperMat, lowerMat, cast) {
    const upperLen = totalLen * 0.45;
    const lowerLen = totalLen * 0.43;
    const upper = limb(upperLen, r, upperMat, cast);
    const lower = limb(lowerLen, r * 0.92, lowerMat || upperMat, cast);
    lower.position.y = -(upperLen + r * 1.85);
    upper.add(lower);
    return { upper, lower, lowerLen, lowerR: r * 0.92 };
  }
  const hipY = 0.92, shoulderY = 1.42;
  // shoe — box parented to a leg so it swings with the stride; own material so the
  // cop/recolor leg-swaps never repaint footwear. Sits just past the leg's foot end.
  const shoeMat = kind === 'monk'
    ? new THREE.MeshStandardMaterial({ color: 0x6a4a30, roughness: 0.8 })   // sandals
    : new THREE.MeshStandardMaterial({ color: pick([0x141414, 0x2a2118, 0x3a3a3a, 0x5a3a2a]), roughness: 0.6 });
  function shoe(legMesh, footY) {
    const s = new THREE.Mesh(new THREE.BoxGeometry(0.11, 0.07, 0.2), shoeMat);
    s.position.set(0, footY, 0.04); s.castShadow = true; legMesh.add(s);
  }
  let legL, legR, shinL, shinR;
  if (skirt) {
    const sk = new THREE.Mesh(new THREE.ConeGeometry(0.26, 0.5, 10), pantsMat);
    sk.position.y = 0.7; sk.castShadow = true; g.add(sk);
    const jl = jointedLimb(0.3, 0.06, skinMat, skinMat, false);
    const jr = jointedLimb(0.3, 0.06, skinMat, skinMat, false);
    legL = jl.upper; shinL = jl.lower; legL.position.set(-0.08, 0.42, 0);
    legR = jr.upper; shinR = jr.lower; legR.position.set( 0.08, 0.42, 0);
    shoe(shinL, -(jl.lowerLen + jl.lowerR * 2) + 0.02); shoe(shinR, -(jr.lowerLen + jr.lowerR * 2) + 0.02);
  } else {
    const jl = jointedLimb(0.62, 0.085, pantsMat, pantsMat, true);
    const jr = jointedLimb(0.62, 0.085, pantsMat, pantsMat, true);
    legL = jl.upper; shinL = jl.lower; legL.position.set(-0.09, hipY, 0);
    legR = jr.upper; shinR = jr.lower; legR.position.set( 0.09, hipY, 0);
    shoe(shinL, -(jl.lowerLen + jl.lowerR * 2) + 0.03); shoe(shinR, -(jr.lowerLen + jr.lowerR * 2) + 0.03);
  }
  g.add(legL); g.add(legR);
  // hand — small skin sphere at each arm's end, parented so it swings with the arm
  const jaL = jointedLimb(0.5, 0.06, armMat, skinMat, false);
  const jaR = jointedLimb(0.5, 0.06, armMat, skinMat, false);
  const armL = jaL.upper, foreL = jaL.lower; armL.position.set(-0.25, shoulderY, 0); g.add(armL);
  const armR = jaR.upper, foreR = jaR.lower; armR.position.set( 0.25, shoulderY, 0); g.add(armR);
  for (const arm of [foreL, foreR]) {
    const hand = new THREE.Mesh(new THREE.SphereGeometry(0.062, 6, 5), skinMat);
    hand.position.y = -0.32; arm.add(hand);
  }

  // archetype props
  if (kind === 'tourist') {
    const pack = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.38, 0.18), new THREE.MeshStandardMaterial({ color: pick([0x2a3a55, 0x803030, 0x2a5a3a]), roughness: 0.85 }));
    pack.position.set(0, 1.15, -0.22); g.add(pack);
  } else if (kind === 'office') {
    const bag = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.22, 0.3), new THREE.MeshStandardMaterial({ color: 0x2a1a10, roughness: 0.6 }));
    bag.position.set(0, -0.56, 0.02); armR.add(bag);                    // hangs from the hand, swings with the arm
  } else if (kind === 'monk') {
    const bowl = new THREE.Mesh(new THREE.SphereGeometry(0.12, 8, 6, 0, TAU, 0, PI/2), new THREE.MeshStandardMaterial({ color: 0x3a2a1a, roughness: 0.7 }));
    bowl.rotation.x = PI; bowl.position.set(0, 1.0, 0.2); g.add(bowl);
  } else if (kind === 'school') {
    const pack = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.34, 0.16), new THREE.MeshStandardMaterial({ color: pick([0x1c355e, 0xc44a3a, 0x2a5a3a]), roughness: 0.82 }));
    pack.position.set(0, 1.12, -0.2); g.add(pack);
    const tie = new THREE.Mesh(new THREE.BoxGeometry(0.045, 0.2, 0.02), new THREE.MeshStandardMaterial({ color: 0xc9a227, roughness: 0.7 }));
    tie.position.set(0, 1.22, 0.12); g.add(tie);
  }

  const props = {};
  const phoneWalker = kind !== 'monk' && ['local', 'office', 'tourist'].includes(kind) && Math.random() < 0.12;
  if (phoneWalker) {
    const phone = new THREE.Mesh(new THREE.BoxGeometry(0.045, 0.09, 0.014), new THREE.MeshStandardMaterial({ color: 0x0b0d12, roughness: 0.45, metalness: 0.25 }));
    phone.position.set(0.025, -0.28, 0.07);
    phone.rotation.set(0.45, 0.15, -0.25);
    foreL.add(phone);
    props.phone = phone;
    g.userData.accessory = 'phone';
  } else if (Math.random() < 0.13 && kind !== 'monk') {
    const bag = new THREE.Mesh(
      new THREE.BoxGeometry(0.14, 0.22, 0.18),
      new THREE.MeshStandardMaterial({ color: pick([0x8a6435, 0xe0d0a8, 0x314a66, 0xa33a3a]), roughness: 0.8 })
    );
    bag.position.set(0, -0.32, 0.04);
    foreL.add(bag);
    g.userData.accessory = 'shopping-bag';
  }
  if (kind !== 'monk') {
    const umbrella = new THREE.Group();
    umbrella.userData.propHidden = true;
    umbrella.visible = false;
    const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.018, 0.78, 5), new THREE.MeshStandardMaterial({ color: 0x222222, roughness: 0.5 }));
    shaft.position.y = 0.33; umbrella.add(shaft);
    const canopy = new THREE.Mesh(new THREE.ConeGeometry(0.42, 0.22, 14), new THREE.MeshStandardMaterial({ color: pick([0xffcf4a, 0x2a8fc0, 0xc04a74, 0xf0f0f0]), roughness: 0.75 }));
    canopy.position.y = 0.82;
    canopy.rotation.x = PI;
    umbrella.add(canopy);
    umbrella.position.set(-0.22, 1.16, 0.02);
    g.add(umbrella);
    props.umbrella = umbrella;
    g.userData.umbrellaUser = Math.random() < 0.3;
  }

  const build = rand(0.92, 1.08);
  g.scale.set(build, rand(0.94, 1.06), build);
  g.userData.parts = {
    torso, head: headRoot, headMesh: head, neck,
    legL, legR, shinL, shinR, armL, armR, foreL, foreR,
    shirtParts: [torso, armL, armR].concat(bareArms ? [] : [foreL, foreR]),
    pantsParts: skirt ? [legL, legR, shinL, shinR] : [legL, legR, shinL, shinR],
    props,
  };
  g.userData.kind = kind;
  g.userData.phase = rand(0, TAU);
  g.userData.gaitFreq = rand(0.9, 1.12);
  g.userData.gaitAmp = rand(0.85, 1.1);
  configureLodGroup(g, makePedLodProxy(shirtColor, pantsColor, skin, kind));
  return g;
}

// Swap a ped's torso material (used by mugger/gang/vigilante/hit recoloring) and
// dispose the one it replaces — but only when the arms don't share it. Clothed
// peds reuse the shirt material for their arms (armMat = shirtMat), so disposing
// it would break the arms; bare-armed peds use skinMat, so the torso material is
// unique and would otherwise leak on the GPU once overwritten.
export function recolorTorso(parts, color, roughness = 0.8) {
  if (!parts || !parts.torso) return;
  const old = parts.torso.material;
  parts.torso.material = new THREE.MeshStandardMaterial({ color, roughness });
  const keep = new Set([parts.armL, parts.armR, parts.foreL, parts.foreR].map(x => x && x.material).filter(Boolean));
  if (old && !keep.has(old)) old.dispose();
}

// Shared limb animator for peds + foot cops: advances a per-mesh walk phase and
// swings legs/arms (arms opposite the same-side leg). `moving` false → near-still
// idle with a faint breathing bob.
export function animateWalk(mesh, speed, dt, moving) {
  const p = mesh.userData.parts; if (!p) return;
  const ud = mesh.userData;
  const freq = (moving ? (1.35 + speed * 0.55) : 0.25) * (ud.gaitFreq || 1);
  ud.phase = (ud.phase || 0) + freq * dt * TAU * 0.55;
  const runK = clamp((speed - 3.0) / 3.0, 0, 1);
  const amp = moving ? Math.min(0.86, (0.26 + speed * 0.11 + runK * 0.12) * (ud.gaitAmp || 1)) : 0.035;
  const s = Math.sin(ud.phase), c = Math.sin(ud.phase + PI);
  const hipDrop = moving ? (1 - Math.abs(Math.cos(ud.phase))) * 0.055 : 0;
  if (p.legL) p.legL.rotation.x = s * amp;
  if (p.legR) p.legR.rotation.x = c * amp;
  if (p.shinL) p.shinL.rotation.x = Math.max(0, -s) * (0.72 + runK * 0.22);
  if (p.shinR) p.shinR.rotation.x = Math.max(0, -c) * (0.72 + runK * 0.22);
  if (p.armL) p.armL.rotation.x = c * amp * (0.82 + runK * 0.25);
  if (p.armR) p.armR.rotation.x = s * amp * (0.82 + runK * 0.25);
  if (p.foreL) p.foreL.rotation.x = 0.28 + Math.max(0, c) * 0.18;
  if (p.foreR) p.foreR.rotation.x = 0.28 + Math.max(0, s) * 0.18;
  const phone = ud.accessory === 'phone';
  const umbrellaVisible = p.props && p.props.umbrella && p.props.umbrella.visible;
  if (phone && p.armL && p.foreL) {
    p.armL.rotation.x = lerp(p.armL.rotation.x, -0.52, 0.55);
    p.armL.rotation.y = lerp(p.armL.rotation.y || 0, -0.22, 0.35);
    p.foreL.rotation.x = lerp(p.foreL.rotation.x, -1.15, 0.55);
  } else if (umbrellaVisible && p.armL && p.foreL) {
    p.armL.rotation.x = lerp(p.armL.rotation.x, -1.25, 0.5);
    p.armL.rotation.z = lerp(p.armL.rotation.z || 0, -0.18, 0.35);
    p.foreL.rotation.x = lerp(p.foreL.rotation.x, -0.15, 0.5);
  } else {
    if (p.armL) p.armL.rotation.y *= 0.85;
    if (p.armR) p.armR.rotation.y *= 0.85;
  }
  if (p.torso) {
    p.torso.position.y = 1.18 - hipDrop + (moving ? 0 : Math.sin(ud.phase) * 0.004);
    p.torso.rotation.x = lerp(p.torso.rotation.x || 0, moving ? -runK * 0.12 : 0, 0.2);
  }
  if (p.neck) p.neck.position.y = 1.42 - hipDrop;
  if (p.head) p.head.position.y = 1.5 - hipDrop;
  if (p.head) p.head.rotation.x = lerp(p.head.rotation.x || 0, phone ? 0.35 : 0, 0.12);
}

export function makeDogMesh() {
  const g = new THREE.Group();
  const body = new THREE.Mesh(new THREE.BoxGeometry(0.32, 0.28, 0.7), new THREE.MeshStandardMaterial({ color: pick([0xc8a370, 0x8c6a3a, 0x4a3a2a, 0xdac199]) }));
  body.position.y = 0.32; g.add(body);
  const head = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.22, 0.26), body.material);
  head.position.set(0, 0.42, 0.42); g.add(head);
  const tail = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.08, 0.3), body.material);
  tail.position.set(0, 0.4, -0.4); g.add(tail);
  for (const z of [-0.2, 0.2]) for (const x of [-0.12, 0.12]) {
    const leg = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.22, 0.08), new THREE.MeshStandardMaterial({ color: 0x2a2a2a }));
    leg.position.set(x, 0.11, z); g.add(leg);
  }
  return g;
}

export function makeCatMesh() {
  const g = new THREE.Group();
  const fur = new THREE.MeshStandardMaterial({ color: pick([0xc8b090, 0x3a3a3a, 0xe8dcc8, 0xb06030, 0xf0f0f0]), roughness: 0.85 });
  const body = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.16, 0.38), fur);
  body.position.y = 0.2; g.add(body);
  const head = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.14, 0.16), fur);
  head.position.set(0, 0.28, 0.22); g.add(head);
  for (const x of [-0.05, 0.05]) {
    const ear = new THREE.Mesh(new THREE.ConeGeometry(0.04, 0.08, 4), fur);
    ear.position.set(x, 0.38, 0.2); g.add(ear);
  }
  const tail = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.04, 0.28), fur);
  tail.position.set(0.06, 0.26, -0.24); tail.rotation.y = 0.4; g.add(tail);
  for (const z of [-0.1, 0.1]) for (const x of [-0.06, 0.06]) {
    const leg = new THREE.Mesh(new THREE.BoxGeometry(0.045, 0.12, 0.045), fur);
    leg.position.set(x, 0.06, z); g.add(leg);
  }
  return g;
}

export function makeMonitorMesh() {
  const g = new THREE.Group();
  g.name = 'khlong-monitor';
  const hide = new THREE.MeshStandardMaterial({ color: pick([0x4a5a38, 0x3a4a30, 0x5a4a28]), roughness: 0.9 });
  const body = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.12, 0.85), hide);
  body.position.y = 0.14; g.add(body);
  const head = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.1, 0.22), hide);
  head.position.set(0, 0.16, 0.48); g.add(head);
  const tail = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.07, 0.7), hide);
  tail.position.set(0, 0.12, -0.7); tail.rotation.y = 0.15; g.add(tail);
  for (const z of [-0.28, 0.22]) for (const x of [-0.1, 0.1]) {
    const leg = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.1, 0.12), hide);
    leg.position.set(x, 0.05, z); g.add(leg);
  }
  return g;
}

export function spawnMonitors(scene) {
  if (!GAMEPLAY.khlongMonitor) return;
  G.monitors = [];
  for (const z of [-90, 40, 130]) {
    const home = new THREE.Vector3(-214, 0, z);
    const mesh = makeMonitorMesh();
    mesh.position.copy(home);
    scene.add(mesh);
    G.monitors.push({ mesh, home: home.clone(), heading: rand(0, TAU), state: 'loaf', timer: rand(1, 3) });
  }
}

export function spawnCats(scene) {
  if (!GAMEPLAY.soiCats) return;
  G.cats = [];
  const stalls = (G.world && G.world.foodStalls) || [];
  const n = Math.min(5, stalls.length);
  for (let i = 0; i < n; i++) {
    const f = stalls[i];
    const pos = new THREE.Vector3(f.pos.x + rand(-1.4, 1.4), 0, f.pos.z + rand(-1.4, 1.4));
    const mesh = makeCatMesh();
    mesh.position.copy(pos);
    scene.add(mesh);
    G.cats.push({ mesh, home: f.pos.clone(), heading: rand(0, TAU), state: 'loaf', timer: rand(1, 3) });
  }
}

// A point on a sidewalk near (cx,cz): sample within `radius`, then snap onto the
// band just outside the nearer road centerline so peds populate the pavements
// (and read as a crowd down whatever street the camera faces) rather than a
// uniform disc that scatters most of them into blocks and side streets.
export function sidewalkPos(cx, cz, radius) {
  const ang = rand(0, TAU), r = rand(6, radius);
  let x = cx + Math.cos(ang) * r, z = cz + Math.sin(ang) * r;
  const roadX = Math.round(x / BLOCK) * BLOCK, roadZ = Math.round(z / BLOCK) * BLOCK;
  const sw = ROAD_WIDTH / 2 + rand(1.0, 2.4);    // sidewalk band hugging the curb
  if (Math.abs(x - roadX) < Math.abs(z - roadZ)) x = roadX + (Math.random() < 0.5 ? -sw : sw);
  else z = roadZ + (Math.random() < 0.5 ? -sw : sw);
  return new THREE.Vector3(clamp(x, -HALF + 5, HALF - 5), 0, clamp(z, -HALF + 5, HALF - 5));
}

export function spawnPed(scene, pos, kind = null) {
  const m = makePedMesh(kind, pos);
  m.position.copy(pos);
  m.userData.heading = rand(0, TAU);
  scene.add(m);
  const speedMul = m.userData.accessory === 'phone' ? 0.8 : 1;
  const ped = {
    mesh: m,
    heading: m.userData.heading,
    kind: m.userData.kind,
    speed: rand(0.9, 1.7) * speedMul,
    speedMul,
    state: 'walking',
    waitT: 0,
    panicT: 0,
    hp: 30,
    dead: false,
  };
  G.peds.push(ped);
  return ped;
}

export function spawnWalkingPair(scene, center) {
  const heading = rand(0, TAU);
  const right = new THREE.Vector3(Math.cos(heading), 0, -Math.sin(heading));
  const a = spawnPed(scene, center.clone().addScaledVector(right, -0.42));
  const b = spawnPed(scene, center.clone().addScaledVector(right, 0.42));
  const group = { heading, waitT: rand(1.2, 3.0), speed: rand(0.9, 1.45), peds: [a, b] };
  a.buddy = b; b.buddy = a;
  a.pair = { group, side: -0.42, leader: true };
  b.pair = { group, side: 0.42, leader: false };
  for (const p of group.peds) {
    p.heading = heading;
    p.speed = group.speed * (p.speedMul || 1);
    p.state = 'walking';
    p.waitT = group.waitT;
    p.mesh.rotation.y = heading;
  }
  return group;
}

export function spawnPedGroup(scene, center, count = irand(2, 3)) {
  const facing = rand(0, TAU);
  const group = { center: center.clone(), facing, peds: [] };
  for (let i = 0; i < count; i++) {
    const a = facing + (i / count) * TAU + rand(-0.25, 0.25);
    const r = rand(0.75, 1.35);
    const pos = center.clone().add(new THREE.Vector3(Math.sin(a) * r, 0, Math.cos(a) * r));
    const ped = spawnPed(scene, pos);
    ped.social = {
      group,
      slot: pos.clone(),
      facing: Math.atan2(center.x - pos.x, center.z - pos.z),
      idlePhase: rand(0, TAU),
    };
    ped.state = 'social';
    ped.speed = 0;
    ped.mesh.rotation.y = ped.social.facing;
    group.peds.push(ped);
  }
  return group;
}

export function spawnDog(scene, pos) {
  const m = makeDogMesh();
  m.position.copy(pos);
  scene.add(m);
  const dog = {
    mesh: m,
    heading: rand(0, TAU),
    speed: rand(0.6, 1.0),
    state: 'lying',       // lying | walking | fleeing | barking
    timer: rand(2, 7),
    hp: 20,
  };
  G.dogs.push(dog);
  return dog;
}

function trafficMix() {
  const h = ((G.time.dayT % 1) + 1) % 1 * 24;
  if (h >= 2 && h < 5) return ['bike', 'bike', 'tuktuk', 'songthaew', 'camry', 'sedan'];
  if (h >= 5 && h < 7) return ['songthaew', 'songthaew', 'bike', 'tuktuk', 'camry', 'hilux'];
  if (h >= 21 || h < 2) return ['bike', 'bike', 'tuktuk', 'luxsedan', 'sedan', 'camry'];
  return ['camry', 'camry', 'camry', 'sedan', 'sedan', 'tuktuk', 'hilux', 'songthaew', 'songthaew', 'bus', 'luxsedan', 'luxsedan', 'bike', 'bike'];
}

export function spawnTraffic(scene) {
  // Each road segment can hold some cars. We sample edges and place vehicles.
  const nSpawn = GAMEPLAY.trafficDensity ? trafficTarget() : TRAFFIC_TARGET;
  for (let n = 0; n < nSpawn; n++) {
    const kinds = trafficMix();
    let kind = pick(kinds);
    if (Math.random() < 0.04) kind = 'supercar';   // rare spawn
    const v = makeVehicle(kind, scene);
    // spawn on a road, in its proper left-hand lane, heading along it
    if (Math.random() < 0.5) {                                   // N/S road (travels along z)
      const road = irand(-GRID/2 + 1, GRID/2) * BLOCK;          // skip the river column
      const north = Math.random() < 0.5;
      v.pos.set(road + (north ? -2.5 : 2.5), 0, rand(-HALF + 10, HALF - 10));
      v.heading = north ? 0 : PI;
    } else {                                                     // E/W road (travels along x)
      const road = irand(-GRID/2, GRID/2) * BLOCK;
      const east = Math.random() < 0.5;
      v.pos.set(rand(-HALF + 10, HALF - 10), 0, road + (east ? 2.5 : -2.5));
      v.heading = east ? PI/2 : -PI/2;
    }
    v.mesh.position.copy(v.pos);
    v.mesh.rotation.y = v.heading;
    const seed = Math.random();
    const cruiseBase = rand(8, 14) * (kind==='bike'?1.2:1) * (kind==='tuktuk'?0.7:1);
    v.npc = {
      kind: 'traffic',
      // assign nearest grid intersection ahead as the immediate target
      targetIdx: null,
      seed,
      cruiseMul: rand(0.85, 1.15),
      cruiseSpeed: cruiseBase,
      followMul: kind === 'bus' ? rand(1.4, 1.8) : rand(0.8, 1.3),
      amberRunner: seed > 0.7,
      patience: seed,
      wanderAmp: rand(0.06, 0.14),
      reactionT: 0,
      stopT: kind === 'songthaew' ? rand(8, 16) : 0,
      honkCooldown: rand(5, 20),
    };
    v.npc.cruiseSpeed *= v.npc.cruiseMul;
    v.vel = v.npc.cruiseSpeed;
    if (kind === 'bike' && GAMEPLAY.motosaiStands && (Math.random() < 0.4 || !G._motosaiPillionSeeded)) {
      attachTrafficPillion(v);
      G._motosaiPillionSeeded = true;
    }
  }
}

export function dressMotosaiVest(ped) {
  if (!ped || !ped.mesh) return;
  recolorTorso(ped.mesh.userData.parts, 0xff6a18, 0.7);
  const vest = new THREE.Mesh(
    new THREE.BoxGeometry(0.4, 0.36, 0.26),
    new THREE.MeshStandardMaterial({ color: 0xff7a1a, roughness: 0.65, emissive: 0xff6a18, emissiveIntensity: 0.18 }),
  );
  vest.name = 'motosai-vest';
  vest.position.set(0, 1.18, 0.04);
  ped.mesh.add(vest);
  ped.motosaiVest = true;
}

export function makeBikeHelmet(color = 0x1a1a1e) {
  const g = new THREE.Group();
  g.name = 'bike-helmet';
  const shell = new THREE.Mesh(
    new THREE.SphereGeometry(0.155, 9, 7, 0, TAU, 0, PI / 1.35),
    new THREE.MeshStandardMaterial({ color, roughness: 0.42, metalness: 0.28 })
  );
  g.add(shell);
  const visor = new THREE.Mesh(
    new THREE.BoxGeometry(0.16, 0.07, 0.1),
    new THREE.MeshStandardMaterial({ color: 0x1a3040, roughness: 0.15, metalness: 0.7 })
  );
  visor.position.set(0, -0.02, 0.1);
  g.add(visor);
  return g;
}

export function wearBikeHelmet(ped, color = 0x1a1a1e) {
  if (!GAMEPLAY.bikeHelmets || !ped || !ped.mesh || ped.bikeHelmet) return ped;
  const head = ped.mesh.userData.parts && ped.mesh.userData.parts.head;
  if (!head) return ped;
  const h = makeBikeHelmet(color);
  h.position.set(0, 0.12, 0.02);
  head.add(h);
  ped.bikeHelmet = h;
  return ped;
}

function playerShirtHex() {
  if (typeof G._shirtColor === 'number') return G._shirtColor;
  const t = G.player && G.player.torso && G.player.torso.material && G.player.torso.material.color;
  return t ? t.getHex() : 0xd44b3b;
}

export function makeSeatedBikeRider(opts = {}) {
  const g = new THREE.Group();
  g.name = 'bike-rider';
  g.userData.keep = true;
  const shirt = opts.shirt || 0xd44b3b;
  const skin = opts.skin || 0xc69472;
  const helm = opts.helmet != null ? opts.helmet : 0x1a1a1e;
  const shirtMat = new THREE.MeshStandardMaterial({ color: shirt, roughness: 0.75 });
  const skinMat = new THREE.MeshStandardMaterial({ color: skin, roughness: 0.8 });
  const torso = new THREE.Mesh(new THREE.CapsuleGeometry(0.16, 0.32, 3, 6), shirtMat);
  torso.position.set(0, 1.05, 0.02); torso.rotation.x = 0.22; torso.castShadow = true; g.add(torso);
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.13, 8, 6), skinMat);
  head.position.set(0, 1.42, 0.08); head.castShadow = true; g.add(head);
  const helmet = makeBikeHelmet(helm);
  helmet.position.set(0, 1.50, 0.08);
  g.add(helmet);
  for (const sx of [-1, 1]) {
    const arm = new THREE.Mesh(new THREE.CapsuleGeometry(0.045, 0.32, 3, 5), shirtMat);
    arm.position.set(sx * 0.18, 1.12, 0.16);
    arm.rotation.x = -1.05;
    arm.rotation.z = sx * 0.35;
    g.add(arm);
  }
  g.position.set(0, 0.02, 0.12);
  return g;
}

export function syncBikeRider(v) {
  if (!v || !v.mesh || !v.spec || v.spec.kind !== 'bike') return;
  if (!GAMEPLAY.bikeHelmets) {
    if (v.bikeRider) v.bikeRider.visible = false;
    return;
  }
  const playerOn = v.driver === 'player';
  const npcOn = !!v.npc && v.driver !== 'player' && !v.motosaiStand;
  const want = playerOn || npcOn;
  if (!want) {
    if (v.bikeRider) v.bikeRider.visible = false;
    return;
  }
  const shirt = playerOn ? playerShirtHex() : (v._riderShirt || (v._riderShirt = pick([0xffffff, 0x223344, 0x556677, 0xff6a18, 0x2a5aad])));
  const helm = playerOn ? 0x222226 : (v._riderHelm || (v._riderHelm = pick([0x1a1a1e, 0xb03030, 0x2a5a8a, 0xffcf2a, 0x2a2a2a])));
  const look = shirt + ',' + helm;
  if (!v.bikeRider || v._riderLook !== look) {
    if (v.bikeRider) {
      if (v.bikeRider.parent) v.bikeRider.parent.remove(v.bikeRider);
      disposeObject(v.bikeRider);
      const lod = v.mesh.userData.lod;
      if (lod && lod.high) {
        const i = lod.high.indexOf(v.bikeRider);
        if (i >= 0) lod.high.splice(i, 1);
      }
    }
    v.bikeRider = makeSeatedBikeRider({ shirt, helmet: helm });
    v._riderLook = look;
    v.mesh.add(v.bikeRider);
    const lod = v.mesh.userData.lod;
    if (lod && lod.high && !lod.high.includes(v.bikeRider)) lod.high.push(v.bikeRider);
  }
  v.bikeRider.visible = true;
}

export function attachTrafficPillion(bike) {
  if (!bike) return null;
  if (bike.pillionPed && bike.pillionPed.mesh && bike.pillionPed.mesh.parent) return bike.pillionPed;
  bike.pillionPed = null;
  const ped = spawnPed(G.scene, bike.pos.clone());
  ped.pillion = true;
  ped.speed = 0;
  ped.state = 'idle';
  G.scene.remove(ped.mesh);
  bike.mesh.add(ped.mesh);
  ped.mesh.position.set(0, 0.02, -0.42);
  ped.mesh.rotation.set(0.16, 0, 0);
  wearBikeHelmet(ped, pick([0x1a1a1e, 0xb03030, 0xffcf2a, 0x2a5a8a]));
  bike.pillionPed = ped;
  return ped;
}

export function spawnMotosaiStands(scene) {
  if (!GAMEPLAY.motosaiStands) return;
  const sois = (G.world && G.world.sois) || [];
  G.world.motosaiStands = [];
  const n = Math.min(4, sois.length);
  for (let i = 0; i < n; i++) {
    const s = sois[i];
    const alongZ = s.axis === 'z';
    const x = alongZ ? (s.x0 + s.x1) / 2 : s.x0 + 2.8;
    const z = alongZ ? s.z0 + 2.8 : (s.z0 + s.z1) / 2;
    const heading = alongZ ? 0 : PI / 2;
    const bike = makeVehicle('bike', scene);
    bike.pos.set(x, 0, z);
    bike.heading = heading;
    bike.mesh.position.copy(bike.pos);
    bike.mesh.rotation.y = heading;
    bike.driver = null;
    bike.vel = 0;
    bike.motosaiStand = true;
    bike._standHome = { x, z, heading };
    const rider = spawnPed(scene, new THREE.Vector3(x + (alongZ ? 1.15 : 0), 0, z + (alongZ ? 0 : 1.15)));
    dressMotosaiVest(rider);
    wearBikeHelmet(rider, 0xffcf2a);
    rider.anchor = { slot: rider.mesh.position.clone(), facing: heading + PI };
    rider.motosaiRider = true;
    rider.speed = 0;
    const waiter = spawnPed(scene, new THREE.Vector3(x + (alongZ ? 1.7 : 0.4), 0, z + (alongZ ? 0.4 : 1.7)));
    waiter.anchor = { slot: waiter.mesh.position.clone(), facing: heading + PI };
    waiter.motosaiWait = true;
    waiter.speed = 0;
    bike.standRider = rider;
    G.world.motosaiStands.push({ bike, rider, waiter, soi: s, x, z });
  }
  if (GAMEPLAY.btsMotosai && G.world.bts) {
    const x = G.world.bts.x + 7.6, z = -22, heading = 0;
    const bike = makeVehicle('bike', scene);
    bike.pos.set(x, 0, z);
    bike.heading = heading;
    bike.mesh.position.copy(bike.pos);
    bike.mesh.rotation.y = heading;
    bike.driver = null;
    bike.vel = 0;
    bike.motosaiStand = true;
    bike._standHome = { x, z, heading };
    const rider = spawnPed(scene, new THREE.Vector3(x + 1.15, 0, z));
    dressMotosaiVest(rider);
    wearBikeHelmet(rider, 0xffcf2a);
    rider.anchor = { slot: rider.mesh.position.clone(), facing: heading + PI };
    rider.motosaiRider = true;
    rider.speed = 0;
    const waiter = spawnPed(scene, new THREE.Vector3(x + 1.7, 0, z + 0.4));
    waiter.anchor = { slot: waiter.mesh.position.clone(), facing: heading + PI };
    waiter.motosaiWait = true;
    waiter.speed = 0;
    bike.standRider = rider;
    G.world.motosaiStands.push({ bike, rider, waiter, soi: null, x, z, bts: true });
  }
}

export function makeIceCartMesh() {
  const g = new THREE.Group();
  g.name = 'ice-cart';
  const box = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.7, 1.15), new THREE.MeshStandardMaterial({ color: 0xf0f4f8, roughness: 0.55 }));
  box.position.y = 0.55; g.add(box);
  const lid = new THREE.Mesh(new THREE.BoxGeometry(0.74, 0.08, 1.18), new THREE.MeshStandardMaterial({ color: 0x2a7d8e, roughness: 0.5 }));
  lid.position.y = 0.94; g.add(lid);
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.9, 5), new THREE.MeshStandardMaterial({ color: 0x333333 }));
  pole.position.y = 1.35; g.add(pole);
  const umb = new THREE.Mesh(new THREE.ConeGeometry(0.7, 0.28, 8), new THREE.MeshStandardMaterial({ color: 0xff6a9a, roughness: 0.7 }));
  umb.position.y = 1.85; umb.rotation.x = PI; g.add(umb);
  const tire = new THREE.MeshStandardMaterial({ color: 0x111111, roughness: 0.8 });
  for (const z of [-0.38, 0.38]) for (const x of [-0.28, 0.28]) {
    const w = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, 0.08, 8), tire);
    w.rotation.z = PI / 2; w.position.set(x, 0.12, z); g.add(w);
  }
  return g;
}

export function spawnIceCarts(scene) {
  if (!GAMEPLAY.iceCart) return;
  const sois = (G.world && G.world.sois) || [];
  G.iceCarts = [];
  const n = Math.min(2, sois.length);
  for (let i = 0; i < n; i++) {
    const s = sois[i];
    const alongZ = s.axis === 'z';
    const t0 = 0.28 + i * 0.22;
    const x = alongZ ? (s.x0 + s.x1) * 0.5 : s.x0 + (s.x1 - s.x0) * t0;
    const z = alongZ ? s.z0 + (s.z1 - s.z0) * t0 : (s.z0 + s.z1) * 0.5;
    const mesh = makeIceCartMesh();
    mesh.position.set(x, 0, z);
    scene.add(mesh);
    const vendor = spawnPed(scene, new THREE.Vector3(x, 0, z), 'vendor');
    vendor.iceCart = true;
    vendor.anchor = { slot: vendor.mesh.position.clone(), facing: alongZ ? 0 : PI / 2 };
    vendor.speed = 0;
    G.iceCarts.push({ mesh, vendor, soi: s, alongZ, t: t0, dir: 1, ding: rand(2, 6) });
  }
}

export function spawnBtsSongthaew(scene) {
  if (!GAMEPLAY.btsSongthaew) return;
  const bts = G.world && G.world.bts;
  if (!bts) return;
  const x = bts.x + 11.5, z = -22, heading = PI / 2;
  const v = makeVehicle('songthaew', scene);
  v.pos.set(x, 0, z);
  v.heading = heading;
  v.mesh.position.copy(v.pos);
  v.mesh.rotation.y = heading;
  v.driver = null;
  v.vel = 0;
  v.btsSongthaew = true;
  v._standHome = { x, z, heading };
  const waiter = spawnPed(scene, new THREE.Vector3(x + 2.4, 0, z + 0.4), 'laborer');
  waiter.anchor = { slot: waiter.mesh.position.clone(), facing: heading + PI };
  waiter.btsSongthaew = true;
  waiter.speed = 0;
  waiter.state = 'idle';
  G.world.btsSongthaew = { vehicle: v, waiter, x, z };
}

export function spawnBtsTuktuk(scene) {
  if (!GAMEPLAY.btsTuktuk) return;
  const bts = G.world && G.world.bts;
  if (!bts) return;
  const x = bts.x + 11.5, z = -14.2, heading = PI / 2;
  const v = makeVehicle('tuktuk', scene);
  v.pos.set(x, 0, z);
  v.heading = heading;
  v.mesh.position.copy(v.pos);
  v.mesh.rotation.y = heading;
  v.driver = null;
  v.vel = 0;
  v.btsTuktuk = true;
  v._standHome = { x, z, heading };
  const waiter = spawnPed(scene, new THREE.Vector3(x + 1.8, 0, z + 0.5), 'vendor');
  waiter.anchor = { slot: waiter.mesh.position.clone(), facing: heading + PI };
  waiter.btsTuktuk = true;
  waiter.speed = 0;
  waiter.state = 'idle';
  G.world.btsTuktuk = { vehicle: v, waiter, x, z };
}

// A handful of parked, enterable cars at the curb so there's always a ride (and a
// songthaew for the taxi job) without chasing moving traffic on foot.
export function spawnParkedCars(scene) {
  const kinds = ['camry', 'sedan', 'hilux', 'songthaew', 'songthaew', 'tuktuk'];
  let placed = 0, guard = 0;
  while (placed < 10 && guard++ < 200) {
    const lane = irand(-GRID/2 + 1, GRID/2 - 1);          // NS road, x in -200..200
    const x = lane * BLOCK + (Math.random() < 0.5 ? -4.5 : 4.5);  // against a curb
    const z = rand(-HALF + 20, HALF - 20);
    if (x < -195) continue;                                // keep out of the river
    const v = makeVehicle(pick(kinds), scene);
    v.pos.set(x, 0, z); v.mesh.position.copy(v.pos);
    v.heading = Math.random() < 0.5 ? 0 : PI;
    v.mesh.rotation.y = v.heading;
    v.driver = null; v.vel = 0;                            // parked: enterable, no AI
    placed++;
  }
}

// One drivable longtail at the river pier gap (z=-50) — step through the embankment to board.
export function spawnBoat(scene) {
  // A small fleet of driveable longtails along the channel (the one by the pier
  // at z=-50 plus two more) so the river is a real traversal option, not a
  // single boat you can lose.
  for (const [x, z] of [[-212, -50], [-228, 60], [-222, -150]]) {
    const v = makeVehicle('boat', scene);
    v.pos.set(x, 0.3, z); v.mesh.position.copy(v.pos);
    v.heading = 0; v.mesh.rotation.y = 0;
    v.driver = null; v.vel = 0;
  }
  if (GAMEPLAY.boatHijack) {
    for (const [x, z, heading] of [[-230, 90, 0], [-218, -90, PI], [-236, 170, 0]]) {
      const v = makeVehicle('boat', scene);
      v.pos.set(x, 0.3, z); v.mesh.position.copy(v.pos);
      v.heading = heading; v.mesh.rotation.y = heading;
      v.driver = 'boatman';
      v.npc = { kind: 'boat', cruise: rand(5.5, 8.5), dir: Math.abs(heading) < 1 ? 1 : -1 };
      v.vel = v.npc.cruise * 0.7;
    }
  }
}

export function spawnPeds(scene, n) {
  for (let i = 0; i < n; i++) {
    const pos = sidewalkPos(rand(-HALF + 12, HALF - 12), rand(-HALF + 12, HALF - 12), 8);
    if (i < n - 2 && Math.random() < 0.10) {
      spawnWalkingPair(scene, pos);
      i += 1;
    } else if (i < n - 2 && Math.random() < 0.16) {
      const count = irand(2, 3);
      spawnPedGroup(scene, pos, count);
      i += count - 1;
    } else {
      spawnPed(scene, pos);
    }
  }
}

export function spawnDogs(scene, n) {
  for (let i = 0; i < n; i++) {
    let pos;
    if (GAMEPLAY.dogRoadLife && i < n * 0.4) {
      const road = irand(-GRID / 2 + 1, GRID / 2) * BLOCK;
      const along = rand(-HALF + 20, HALF - 20);
      const curb = ROAD_WIDTH / 2 - 0.55;
      if (Math.random() < 0.5) pos = new THREE.Vector3(road + (Math.random() < 0.5 ? -curb : curb), 0, along);
      else pos = new THREE.Vector3(along, 0, road + (Math.random() < 0.5 ? -curb : curb));
    } else {
      pos = new THREE.Vector3(rand(-HALF + 20, HALF - 20), 0, rand(-HALF + 20, HALF - 20));
    }
    spawnDog(scene, pos);
  }
}

// =============================================================================
// 7. RAIN PARTICLES
// =============================================================================

export function makeRain(scene) {
  const N = 1200;
  const positions = new Float32Array(N * 3);
  for (let i = 0; i < N; i++) {
    positions[i*3+0] = rand(-60, 60);
    positions[i*3+1] = rand(0, 40);
    positions[i*3+2] = rand(-60, 60);
  }
  const geom = new THREE.BufferGeometry();
  geom.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  const mat = new THREE.PointsMaterial({ color: 0xaaccff, size: 0.08, transparent: true, opacity: 0.0, depthWrite: false });
  const pts = new THREE.Points(geom, mat);
  pts.frustumCulled = false;
  scene.add(pts);
  return {
    points: pts, mat, N,
    update(dt, playerPos, strength) {
      const fall = 28 * dt;
      const arr = pts.geometry.attributes.position.array;
      for (let i = 0; i < N; i++) {
        arr[i*3+1] -= fall;
        if (arr[i*3+1] < 0) {
          arr[i*3+0] = playerPos.x + rand(-50, 50);
          arr[i*3+1] = rand(20, 40);
          arr[i*3+2] = playerPos.z + rand(-50, 50);
        }
      }
      pts.geometry.attributes.position.needsUpdate = true;
      pts.position.set(0, 0, 0);
      mat.opacity = lerp(mat.opacity, strength * 0.55, 0.05);
    }
  };
}

// =============================================================================

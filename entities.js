// =============================================================================
// ENTITIES — extracted from main.js (see numbered sections). No logic change.
// =============================================================================
import * as THREE from 'three';
import {
  makeStaticBaker, PI, TAU, clamp, lerp, rand, irand, pick, sign, dist2, COLORS, G, PRICE, PAINT_COLORS, BUSINESSES, ROAD_WIDTH, PED_TARGET, GAMEPLAY, TRAFFIC_TARGET, trafficTarget, _camTarget, _camOffset, _fireDir, _ray, _bbox, _vBox, _blackColor, disposeObject, BLOCK, GRID, HALF, lerpAngle
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
    const special = ped.gang || ped.isTarget || ped.isMugger || ped.anchor || ped.alms || ped.cowboy || ped.boatNoodle || ped.pierWait || ped.somTam || ped.btsMalai || ped.plaKat || ped.chaYen || ped.roti || ped.mango || ped.phromFruit || ped.kanom || ped.squid || ped.songthaewRide || ped.watSweep || ped.yaoGold || ped.yaoDuck || ped.yaoFortune || ped.sevenAtm || ped.btsBusker || ped.watLotus || ped.watAmulet || ped.watDrum || ped.sevenShop || ped.sevenSlush || ped.btsPaper || ped.btsShine || ped.mallGuard || ped.bankGuard || ped.mallDir || ped.gunClerk || ped.starterClerk || ped.officeSmoke || ped.bankQueue || ped.mallFood || ped.mallTech || ped.mallPharm || ped.mallRoma || ped.mallWatch || ped.mallManga || ped.mallSushi || ped.mallCafe || ped.mallThreads || ped.mallSeven || ped.mallArcade || ped.gymBag || ped.homeAuntie || ped.stationPorter || ped.garageMech || ped.klongDock || ped.sengClerk || ped.airportCrew || ped.airportCargo || ped.airportTower || ped.airportTaxi || ped.soiBarber || ped.yaowaratNight || ped.yaoPhoto || ped.btsWait;
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
    bowl.name = 'alms-bowl';
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

export function makeGeckoMesh() {
  const g = new THREE.Group();
  g.name = 'stall-gecko';
  const hide = new THREE.MeshStandardMaterial({ color: pick([0xc8c070, 0xb0a060, 0xd0c898]), roughness: 0.85 });
  const body = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.03, 0.14), hide);
  g.add(body);
  const head = new THREE.Mesh(new THREE.BoxGeometry(0.045, 0.03, 0.05), hide);
  head.position.z = 0.09; g.add(head);
  const tail = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.02, 0.1), hide);
  tail.position.z = -0.11; tail.rotation.y = 0.3; g.add(tail);
  return g;
}

export function spawnGeckos(scene) {
  if (!GAMEPLAY.stallGecko) return;
  G.geckos = [];
  const stalls = (G.world && G.world.foodStalls) || [];
  const n = Math.min(4, stalls.length);
  for (let i = 0; i < n; i++) {
    const f = stalls[i];
    const mesh = makeGeckoMesh();
    const ox = rand(-0.4, 0.4), oz = rand(-0.3, 0.3);
    mesh.position.set(f.pos.x + ox, 1.72, f.pos.z + oz);
    mesh.rotation.x = -0.2;
    mesh.visible = false;
    scene.add(mesh);
    G.geckos.push({ mesh, home: { x: f.pos.x + ox, y: 1.72, z: f.pos.z + oz }, heading: rand(0, TAU), timer: rand(0.8, 2.4), chirp: rand(2, 6) });
  }
}

export function spawnStallIncense(scene) {
  if (!GAMEPLAY.stallIncense) return;
  const stalls = (G.world && G.world.foodStalls) || [];
  G.stallIncense = [];
  const n = Math.min(4, stalls.length);
  for (let i = 0; i < n; i++) {
    const f = stalls[i];
    const g = new THREE.Group();
    g.name = 'stall-incense';
    const coil = new THREE.Mesh(
      new THREE.TorusGeometry(0.09, 0.018, 6, 10),
      new THREE.MeshStandardMaterial({ color: 0x4a3a22, roughness: 0.85, emissive: 0xff5510, emissiveIntensity: 0.15 })
    );
    coil.name = 'incense-coil';
    coil.rotation.x = PI / 2;
    g.add(coil);
    const glow = new THREE.Mesh(
      new THREE.SphereGeometry(0.025, 6, 5),
      new THREE.MeshStandardMaterial({ color: 0xff6622, emissive: 0xff3300, emissiveIntensity: 0.4, roughness: 0.4 })
    );
    glow.name = 'incense-ember';
    glow.position.set(0.09, 0, 0);
    g.add(glow);
    const smoke = new THREE.Mesh(
      new THREE.SphereGeometry(0.08, 6, 5),
      new THREE.MeshBasicMaterial({ color: 0x887766, transparent: true, opacity: 0.18, depthWrite: false })
    );
    smoke.name = 'incense-smoke';
    smoke.position.set(0.04, 0.12, 0);
    g.add(smoke);
    g.position.set(f.pos.x + 0.35, 1.55, f.pos.z + 0.2);
    scene.add(g);
    G.stallIncense.push({ mesh: g, coil, glow, smoke, t: i * 0.7, stall: f });
  }
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

function makeHyacinthMesh() {
  const g = new THREE.Group();
  g.name = 'hyacinth';
  const leafMat = new THREE.MeshStandardMaterial({ color: pick([0x2f7a3a, 0x3a8a40, 0x256838]), roughness: 0.85, side: THREE.DoubleSide });
  const n = 6;
  for (let i = 0; i < n; i++) {
    const a = (i / n) * TAU + rand(-0.2, 0.2);
    const r = 0.22 + (i % 3) * 0.12;
    const leaf = new THREE.Mesh(new THREE.CircleGeometry(0.18 + (i % 2) * 0.06, 7), leafMat);
    leaf.rotation.x = -PI / 2 + rand(-0.12, 0.12);
    leaf.position.set(Math.sin(a) * r, 0.02, Math.cos(a) * r);
    g.add(leaf);
  }
  const bloom = new THREE.Mesh(
    new THREE.ConeGeometry(0.05, 0.16, 5),
    new THREE.MeshStandardMaterial({ color: 0x7a4aaa, roughness: 0.55, emissive: 0x4a2060, emissiveIntensity: 0.12 })
  );
  bloom.position.y = 0.12;
  g.add(bloom);
  return g;
}

export function spawnHyacinth(scene) {
  if (!GAMEPLAY.hyacinth) return;
  const cx = -229;
  G.hyacinth = [];
  const zs = [-170, -110, -40, 20, 90, 155];
  for (let i = 0; i < zs.length; i++) {
    const mesh = makeHyacinthMesh();
    const x = cx + (i % 2 === 0 ? 8.5 : -7.2);
    const z = zs[i];
    mesh.position.set(x, 0.1, z);
    mesh.rotation.y = rand(0, TAU);
    scene.add(mesh);
    G.hyacinth.push({ mesh, phase: rand(0, TAU), drift: 0.32 + i * 0.03, x, z });
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
  if (GAMEPLAY.rainPoncho) {
    const cape = new THREE.Mesh(
      new THREE.ConeGeometry(0.28, 0.5, 6, 1, true),
      new THREE.MeshStandardMaterial({
        color: pick([0xffcf4a, 0x2a6aad, 0xe8e8e0]),
        roughness: 0.35,
        transparent: true,
        opacity: 0.78,
        side: THREE.DoubleSide,
      })
    );
    cape.name = 'rain-poncho';
    cape.visible = false;
    cape.position.set(0, 1.12, 0.04);
    cape.rotation.x = 0.18;
    g.add(cape);
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
  if (GAMEPLAY.rainPoncho && ped.mesh && !ped.mesh.getObjectByName('rain-poncho')) {
    const cape = new THREE.Mesh(
      new THREE.ConeGeometry(0.26, 0.55, 6, 1, true),
      new THREE.MeshStandardMaterial({
        color: pick([0xffcf4a, 0x2a6aad, 0xe8e8e0]),
        roughness: 0.35,
        transparent: true,
        opacity: 0.78,
        side: THREE.DoubleSide,
      })
    );
    cape.name = 'rain-poncho';
    cape.visible = false;
    cape.position.set(0, 1.22, 0.04);
    ped.mesh.add(cape);
  }
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
    const ranks = [
      { x: G.world.bts.x + 7.6, z: -22, stop: 'asok' },
      { x: 100 + 7.6, z: -20, stop: 'phrom' },
    ];
    for (const r of ranks) {
      const x = r.x, z = r.z, heading = 0;
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
      G.world.motosaiStands.push({ bike, rider, waiter, soi: null, x, z, bts: r.stop === 'asok' ? true : r.stop });
    }
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

export function spawnLottery(scene) {
  if (!GAMEPLAY.lottery) return;
  const pack = (seven) => {
    if (!seven || !seven.pos) return null;
    const hz = seven.hz || 4;
    const x = seven.pos.x + 2.4;
    const z = seven.pos.z + hz + 1.6;
    const ped = spawnPed(scene, new THREE.Vector3(x, 0, z), 'vendor');
    ped.lottery = true;
    ped.anchor = { slot: ped.mesh.position.clone(), facing: PI };
    ped.speed = 0;
    ped.state = 'idle';
    const board = new THREE.Group();
    board.name = 'lottery-board';
    const pole = new THREE.Mesh(
      new THREE.CylinderGeometry(0.04, 0.05, 1.45, 6),
      new THREE.MeshStandardMaterial({ color: 0x2a2a2a, roughness: 0.6 })
    );
    pole.position.y = 0.72; board.add(pole);
    const sheet = new THREE.Mesh(
      new THREE.BoxGeometry(0.72, 0.95, 0.04),
      new THREE.MeshStandardMaterial({ color: 0xf5e6a3, roughness: 0.7 })
    );
    sheet.position.set(0, 1.38, 0.05); board.add(sheet);
    for (let r = 0; r < 4; r++) {
      const strip = new THREE.Mesh(
        new THREE.BoxGeometry(0.56, 0.12, 0.02),
        new THREE.MeshStandardMaterial({ color: pick([0xc03030, 0x2a7d3a, 0x2a4a8a, 0xd9a020]), roughness: 0.55 })
      );
      strip.position.set(0, 1.62 - r * 0.18, 0.08); board.add(strip);
    }
    board.position.set(x - 0.5, 0, z + 0.2);
    scene.add(board);
    return { ped, board, pos: new THREE.Vector3(x, 0, z), readyAt: 0 };
  };
  G.lottery = pack(G.world && (G.world.sevenWalkIn || (G.world.sevenElevens && G.world.sevenElevens[0])));
  const south = (G.world.sevenElevens || []).find(s => s && s.pos && Math.abs(s.pos.x) < 8 && s.pos.z < -80);
  G.southLottery = pack(south);
  const west = (G.world.sevenElevens || []).find(s => s && s.pos && s.pos.x < -50 && s.pos.z > 0 && s.pos.z < 60);
  G.westLottery = pack(west);
  const east = (G.world.sevenElevens || []).find(s => s && s.pos && s.pos.x > 100 && s.pos.z < 0 && s.pos.z > -80);
  G.eastLottery = pack(east);
}

export function makeKanomKrokMesh() {
  const g = new THREE.Group();
  g.name = 'kanomkrok-cart';
  const box = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.48, 1.15), new THREE.MeshStandardMaterial({ color: 0x6a3a18, roughness: 0.8 }));
  box.position.y = 0.46; g.add(box);
  const pan = new THREE.Mesh(
    new THREE.CylinderGeometry(0.34, 0.34, 0.06, 12),
    new THREE.MeshStandardMaterial({ color: 0x3a3a40, roughness: 0.4, metalness: 0.45, emissive: 0x331808, emissiveIntensity: 0.2 })
  );
  pan.name = 'kanom-pan';
  pan.position.set(0, 0.74, 0.06);
  g.add(pan);
  const cakeMat = new THREE.MeshStandardMaterial({ color: 0xe8c070, roughness: 0.65 });
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * TAU;
    const cake = new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.06, 0.04, 6), cakeMat);
    cake.name = 'kanom-cake';
    cake.position.set(Math.sin(a) * 0.2, 0.79, 0.06 + Math.cos(a) * 0.2);
    g.add(cake);
  }
  const ladle = new THREE.Mesh(
    new THREE.BoxGeometry(0.04, 0.01, 0.28),
    new THREE.MeshStandardMaterial({ color: 0x888890, metalness: 0.45, roughness: 0.4 })
  );
  ladle.name = 'kanom-ladle';
  ladle.position.set(0.16, 0.88, 0.08);
  g.add(ladle);
  const umb = new THREE.Mesh(
    new THREE.ConeGeometry(0.68, 0.24, 8),
    new THREE.MeshStandardMaterial({ color: 0xc03030, roughness: 0.7, side: THREE.DoubleSide })
  );
  umb.position.y = 1.88; umb.rotation.x = PI; g.add(umb);
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 1.0, 5), new THREE.MeshStandardMaterial({ color: 0x333333 }));
  pole.position.y = 1.35; g.add(pole);
  const tire = new THREE.MeshStandardMaterial({ color: 0x111111, roughness: 0.8 });
  for (const z of [-0.38, 0.38]) for (const x of [-0.3, 0.3]) {
    const w = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, 0.08, 8), tire);
    w.rotation.z = PI / 2; w.position.set(x, 0.12, z); g.add(w);
  }
  return g;
}

export function spawnKanomKrok(scene) {
  if (!GAMEPLAY.kanomKrok) return;
  const pack = (seven) => {
    if (!seven || !seven.pos) return null;
    const hz = seven.hz || 4;
    const x = seven.pos.x - 2.2;
    const z = seven.pos.z + hz + 1.6;
    const mesh = makeKanomKrokMesh();
    mesh.position.set(x, 0, z);
    scene.add(mesh);
    const vendor = spawnPed(scene, new THREE.Vector3(x + 0.65, 0, z + 0.1), 'vendor');
    vendor.kanom = true;
    vendor.anchor = { slot: vendor.mesh.position.clone(), facing: PI };
    vendor.speed = 0;
    vendor.state = 'idle';
    vendor.heading = PI;
    if (vendor.mesh) vendor.mesh.rotation.y = PI;
    return { mesh, vendor, x, z, t: 0 };
  };
  G.kanomKrok = pack(G.world && (G.world.sevenWalkIn || (G.world.sevenElevens && G.world.sevenElevens[0])));
  const south = (G.world.sevenElevens || []).find(s => s && s.pos && Math.abs(s.pos.x) < 8 && s.pos.z < -80);
  G.southKanomKrok = pack(south);
  const west = (G.world.sevenElevens || []).find(s => s && s.pos && s.pos.x < -50 && s.pos.z > 0 && s.pos.z < 60);
  G.westKanomKrok = pack(west);
  const east = (G.world.sevenElevens || []).find(s => s && s.pos && s.pos.x > 100 && s.pos.z < 0 && s.pos.z > -80);
  G.eastKanomKrok = pack(east);
}

export function makeSquidGrillMesh() {
  const g = new THREE.Group();
  g.name = 'squid-cart';
  const box = new THREE.Mesh(new THREE.BoxGeometry(0.95, 0.5, 1.25), new THREE.MeshStandardMaterial({ color: 0x4a2a18, roughness: 0.82 }));
  box.position.y = 0.48; g.add(box);
  const coalMat = new THREE.MeshStandardMaterial({ color: 0x1a1210, roughness: 0.7, emissive: 0xff5510, emissiveIntensity: 0.4 });
  const coals = new THREE.Mesh(new THREE.BoxGeometry(0.72, 0.08, 0.85), coalMat);
  coals.name = 'squid-coals';
  coals.position.y = 0.78; g.add(coals);
  g.userData.coalMat = coalMat;
  const grate = new THREE.Mesh(new THREE.BoxGeometry(0.74, 0.02, 0.88), new THREE.MeshStandardMaterial({ color: 0x3a3a40, metalness: 0.45, roughness: 0.4 }));
  grate.position.y = 0.84; g.add(grate);
  const bodyMat = new THREE.MeshStandardMaterial({ color: 0xd8c8b0, roughness: 0.6 });
  for (let i = 0; i < 4; i++) {
    const sk = new THREE.Group();
    sk.name = 'squid-stick';
    const stick = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.7, 4), new THREE.MeshStandardMaterial({ color: 0xc8a070, roughness: 0.7 }));
    stick.rotation.x = PI / 2;
    sk.add(stick);
    const body = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.05, 0.22), bodyMat);
    body.position.z = 0.08;
    sk.add(body);
    const tent = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.03, 0.08), bodyMat);
    tent.position.z = -0.12;
    sk.add(tent);
    sk.position.set((i - 1.5) * 0.16, 0.92, 0);
    g.add(sk);
  }
  const umb = new THREE.Mesh(
    new THREE.ConeGeometry(0.7, 0.26, 8),
    new THREE.MeshStandardMaterial({ color: 0xc03030, roughness: 0.7, side: THREE.DoubleSide })
  );
  umb.position.y = 1.9; umb.rotation.x = PI; g.add(umb);
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 1.05, 5), new THREE.MeshStandardMaterial({ color: 0x333333 }));
  pole.position.y = 1.38; g.add(pole);
  const puff = new THREE.Mesh(
    new THREE.SphereGeometry(0.2, 6, 5),
    new THREE.MeshBasicMaterial({ color: 0x887766, transparent: true, opacity: 0.2, depthWrite: false })
  );
  puff.name = 'squid-smoke';
  puff.position.set(0, 1.12, 0);
  g.add(puff);
  const tire = new THREE.MeshStandardMaterial({ color: 0x111111, roughness: 0.8 });
  for (const z of [-0.42, 0.42]) for (const x of [-0.34, 0.34]) {
    const w = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, 0.08, 8), tire);
    w.rotation.z = PI / 2; w.position.set(x, 0.12, z); g.add(w);
  }
  return g;
}

export function spawnSquidGrill(scene) {
  if (!GAMEPLAY.squidGrill) return;
  const poi = G.world && G.world.poi && G.world.poi.yaowarat;
  if (!poi) return;
  const x = poi.x + 3.2, z = poi.z + 22;
  const mesh = makeSquidGrillMesh();
  mesh.position.set(x, 0, z);
  scene.add(mesh);
  const vendor = spawnPed(scene, new THREE.Vector3(x + 0.7, 0, z), 'vendor');
  vendor.squid = true;
  vendor.anchor = { slot: vendor.mesh.position.clone(), facing: PI };
  vendor.speed = 0;
  vendor.state = 'idle';
  vendor.heading = PI;
  if (vendor.mesh) vendor.mesh.rotation.y = PI;
  G.squidGrill = { mesh, vendor, x, z, t: 0, coalMat: mesh.userData.coalMat };
}

function makeYaoGoldMesh() {
  const g = new THREE.Group();
  g.name = 'yao-gold';
  const frame = new THREE.Mesh(
    new THREE.BoxGeometry(2.4, 2.2, 0.18),
    new THREE.MeshStandardMaterial({ color: 0x3a1a12, roughness: 0.7 })
  );
  frame.position.y = 1.2;
  g.add(frame);
  const glass = new THREE.Mesh(
    new THREE.PlaneGeometry(2.05, 1.7),
    new THREE.MeshStandardMaterial({ color: 0x8899aa, transparent: true, opacity: 0.28, metalness: 0.4, roughness: 0.2 })
  );
  glass.position.set(0, 1.2, 0.1);
  g.add(glass);
  const goldMat = new THREE.MeshStandardMaterial({
    color: 0xe8c04a, roughness: 0.35, metalness: 0.75, emissive: 0xd4a020, emissiveIntensity: 0.15,
  });
  g.userData.goldMat = goldMat;
  for (let i = 0; i < 5; i++) {
    const tray = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.04, 0.18), goldMat);
    tray.name = 'yao-gold-tray';
    tray.position.set(-0.7 + i * 0.35, 0.85 + (i % 2) * 0.45, 0.02);
    g.add(tray);
  }
  const sign = new THREE.Mesh(
    new THREE.BoxGeometry(1.6, 0.28, 0.08),
    new THREE.MeshStandardMaterial({ color: 0xa8261f, roughness: 0.6, emissive: 0xff2233, emissiveIntensity: 0.2 })
  );
  sign.name = 'yao-gold-sign';
  sign.position.set(0, 2.42, 0.06);
  g.add(sign);
  g.userData.signMat = sign.material;
  return g;
}

export function spawnYaoGold(scene) {
  if (!GAMEPLAY.yaoGold) return;
  const poi = G.world && G.world.poi && G.world.poi.yaowarat;
  if (!poi) return;
  const x = poi.x - 8.2, z = poi.z - 22;
  const mesh = makeYaoGoldMesh();
  mesh.position.set(x, 0, z);
  mesh.rotation.y = PI / 2;
  scene.add(mesh);
  const shoppers = [];
  for (let i = 0; i < 3; i++) {
    const px = x + 1.15, pz = z + (i - 1) * 0.75;
    const ped = spawnPed(scene, new THREE.Vector3(px, 0, pz), i === 1 ? 'tourist' : 'local');
    ped.yaoGold = true;
    ped.speed = 0;
    ped.state = 'idle';
    ped.heading = -PI / 2;
    ped.anchor = { slot: new THREE.Vector3(px, 0, pz), facing: -PI / 2 };
    if (ped.mesh) {
      ped.mesh.rotation.y = -PI / 2;
      ped.mesh.visible = false;
    }
    shoppers.push(ped);
  }
  G.yaoGold = { mesh, shoppers, x, z, t: 0, goldMat: mesh.userData.goldMat, signMat: mesh.userData.signMat };
}

function makeYaoDuckMesh() {
  const g = new THREE.Group();
  g.name = 'yao-duck';
  const frame = new THREE.Mesh(
    new THREE.BoxGeometry(2.2, 2.15, 0.16),
    new THREE.MeshStandardMaterial({ color: 0x2a1810, roughness: 0.75 })
  );
  frame.position.y = 1.15;
  g.add(frame);
  const glass = new THREE.Mesh(
    new THREE.PlaneGeometry(1.9, 1.65),
    new THREE.MeshStandardMaterial({ color: 0x8899aa, transparent: true, opacity: 0.22, metalness: 0.35, roughness: 0.22 })
  );
  glass.position.set(0, 1.15, 0.09);
  g.add(glass);
  const rod = new THREE.Mesh(
    new THREE.CylinderGeometry(0.018, 0.018, 1.7, 6),
    new THREE.MeshStandardMaterial({ color: 0x888890, metalness: 0.55, roughness: 0.4 })
  );
  rod.rotation.z = PI / 2;
  rod.position.set(0, 1.92, 0.02);
  g.add(rod);
  const duckMat = new THREE.MeshStandardMaterial({
    color: 0x7a2410, roughness: 0.45, metalness: 0.15, emissive: 0xc04010, emissiveIntensity: 0.18,
  });
  g.userData.duckMat = duckMat;
  for (let i = 0; i < 5; i++) {
    const duck = new THREE.Group();
    duck.name = 'yao-duck-body';
    const hook = new THREE.Mesh(
      new THREE.CylinderGeometry(0.008, 0.008, 0.26, 4),
      new THREE.MeshStandardMaterial({ color: 0x777780, metalness: 0.55, roughness: 0.4 })
    );
    hook.position.y = -0.13;
    duck.add(hook);
    const body = new THREE.Mesh(new THREE.SphereGeometry(0.09, 8, 6), duckMat);
    body.scale.set(0.85, 1.4, 0.7);
    body.position.y = -0.4;
    duck.add(body);
    const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.032, 0.11, 6), duckMat);
    neck.position.set(0, -0.26, 0.03);
    neck.rotation.x = 0.45;
    duck.add(neck);
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.038, 6, 5), duckMat);
    head.position.set(0, -0.2, 0.08);
    duck.add(head);
    duck.position.set(-0.64 + i * 0.32, 1.92, 0.02);
    g.add(duck);
  }
  const lamp = new THREE.Mesh(
    new THREE.BoxGeometry(1.6, 0.06, 0.08),
    new THREE.MeshStandardMaterial({ color: 0xffcc66, roughness: 0.4, emissive: 0xffaa33, emissiveIntensity: 0.2 })
  );
  lamp.name = 'yao-duck-lamp';
  lamp.position.set(0, 2.08, 0.04);
  g.add(lamp);
  g.userData.lampMat = lamp.material;
  const sign = new THREE.Mesh(
    new THREE.BoxGeometry(1.5, 0.26, 0.08),
    new THREE.MeshStandardMaterial({ color: 0xa8261f, roughness: 0.6, emissive: 0xff2233, emissiveIntensity: 0.2 })
  );
  sign.name = 'yao-duck-sign';
  sign.position.set(0, 2.38, 0.06);
  g.add(sign);
  g.userData.signMat = sign.material;
  return g;
}

export function spawnYaoDuck(scene) {
  if (!GAMEPLAY.yaoDuck) return;
  const poi = G.world && G.world.poi && G.world.poi.yaowarat;
  if (!poi) return;
  const x = poi.x + 8.2, z = poi.z - 22;
  const mesh = makeYaoDuckMesh();
  mesh.position.set(x, 0, z);
  mesh.rotation.y = -PI / 2;
  scene.add(mesh);
  const shoppers = [];
  for (let i = 0; i < 2; i++) {
    const px = x - 1.15, pz = z + (i - 0.5) * 0.8;
    const ped = spawnPed(scene, new THREE.Vector3(px, 0, pz), i === 0 ? 'tourist' : 'local');
    ped.yaoDuck = true;
    ped.speed = 0;
    ped.state = 'idle';
    ped.heading = PI / 2;
    ped.anchor = { slot: new THREE.Vector3(px, 0, pz), facing: PI / 2 };
    if (ped.mesh) {
      ped.mesh.rotation.y = PI / 2;
      ped.mesh.visible = false;
    }
    shoppers.push(ped);
  }
  G.yaoDuck = { mesh, shoppers, x, z, t: 0, duckMat: mesh.userData.duckMat, lampMat: mesh.userData.lampMat, signMat: mesh.userData.signMat };
}

export function spawnYaoFortune(scene) {
  if (!GAMEPLAY.yaoFortune) return;
  const poi = G.world && G.world.poi && G.world.poi.yaowarat;
  if (!poi) return;
  const x = poi.x - 8.2, z = poi.z + 22;
  const g = new THREE.Group();
  g.name = 'yao-fortune';
  const table = new THREE.Mesh(
    new THREE.CylinderGeometry(0.42, 0.44, 0.08, 10),
    new THREE.MeshStandardMaterial({ color: 0x6a1a18, roughness: 0.7 })
  );
  table.position.y = 0.72;
  g.add(table);
  const cloth = new THREE.Mesh(
    new THREE.CircleGeometry(0.4, 10),
    new THREE.MeshStandardMaterial({ color: 0xc03030, roughness: 0.75 })
  );
  cloth.rotation.x = -PI / 2;
  cloth.position.y = 0.77;
  g.add(cloth);
  const colors = [0xf5f0e4, 0xe8c04a, 0x2a4a8a, 0xc03030];
  for (let i = 0; i < 4; i++) {
    const card = new THREE.Mesh(
      new THREE.BoxGeometry(0.1, 0.01, 0.14),
      new THREE.MeshStandardMaterial({ color: colors[i], roughness: 0.65 })
    );
    card.name = 'yao-card';
    const a = (i / 4) * TAU;
    card.position.set(Math.sin(a) * 0.16, 0.79, Math.cos(a) * 0.16);
    card.rotation.y = a;
    g.add(card);
  }
  const lamp = new THREE.Mesh(
    new THREE.CylinderGeometry(0.05, 0.07, 0.16, 8),
    new THREE.MeshStandardMaterial({ color: 0xffcc66, roughness: 0.4, emissive: 0xffaa33, emissiveIntensity: 0.2 })
  );
  lamp.name = 'yao-fortune-lamp';
  lamp.position.set(0.22, 0.9, -0.12);
  g.add(lamp);
  g.userData.lampMat = lamp.material;
  const stick = new THREE.Mesh(
    new THREE.CylinderGeometry(0.012, 0.012, 0.22, 5),
    new THREE.MeshStandardMaterial({ color: 0xc8a070, roughness: 0.7 })
  );
  stick.position.set(-0.18, 0.9, 0.12);
  g.add(stick);
  g.position.set(x, 0, z);
  scene.add(g);
  const vendor = spawnPed(scene, new THREE.Vector3(x + 0.55, 0, z), 'local');
  vendor.yaoFortune = true;
  vendor.anchor = { slot: vendor.mesh.position.clone(), facing: -PI / 2 };
  vendor.speed = 0;
  vendor.state = 'idle';
  vendor.heading = -PI / 2;
  if (vendor.mesh) {
    vendor.mesh.rotation.y = -PI / 2;
    vendor.mesh.visible = false;
  }
  G.yaoFortune = { mesh: g, vendor, x, z, t: 0, lampMat: g.userData.lampMat };
}

export function makeCoconutCartMesh() {
  const g = new THREE.Group();
  g.name = 'coconut-cart';
  const box = new THREE.Mesh(new THREE.BoxGeometry(0.85, 0.55, 1.2), new THREE.MeshStandardMaterial({ color: 0x6a4a28, roughness: 0.8 }));
  box.position.y = 0.5; g.add(box);
  const green = new THREE.MeshStandardMaterial({ color: 0x3a8a3a, roughness: 0.7 });
  for (let i = 0; i < 5; i++) {
    const nut = new THREE.Mesh(new THREE.SphereGeometry(0.14, 7, 6), green);
    nut.position.set((i % 3 - 1) * 0.22, 0.88, (i < 3 ? -0.2 : 0.22));
    g.add(nut);
  }
  const machete = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.02, 0.42), new THREE.MeshStandardMaterial({ color: 0x888890, metalness: 0.5, roughness: 0.35 }));
  machete.position.set(0.32, 0.82, 0); g.add(machete);
  const tire = new THREE.MeshStandardMaterial({ color: 0x111111, roughness: 0.8 });
  for (const z of [-0.4, 0.4]) for (const x of [-0.32, 0.32]) {
    const w = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, 0.08, 8), tire);
    w.rotation.z = PI / 2; w.position.set(x, 0.12, z); g.add(w);
  }
  return g;
}

export function makeMooPingMesh() {
  const g = new THREE.Group();
  g.name = 'mooping-cart';
  const box = new THREE.Mesh(new THREE.BoxGeometry(0.95, 0.5, 1.35), new THREE.MeshStandardMaterial({ color: 0x5a3a22, roughness: 0.82 }));
  box.position.y = 0.48; g.add(box);
  const coalMat = new THREE.MeshStandardMaterial({ color: 0x1a1210, roughness: 0.7, emissive: 0xff5510, emissiveIntensity: 0.55 });
  const coals = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.08, 0.9), coalMat);
  coals.name = 'mooping-coals';
  coals.position.y = 0.78; g.add(coals);
  const grate = new THREE.Mesh(new THREE.BoxGeometry(0.72, 0.02, 0.92), new THREE.MeshStandardMaterial({ color: 0x3a3a40, metalness: 0.45, roughness: 0.4 }));
  grate.position.y = 0.84; g.add(grate);
  const stickMat = new THREE.MeshStandardMaterial({ color: 0xc8a070, roughness: 0.7 });
  const meatMat = new THREE.MeshStandardMaterial({ color: 0xa03a22, roughness: 0.65 });
  for (let i = 0; i < 6; i++) {
    const sk = new THREE.Group();
    const stick = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.7, 4), stickMat);
    stick.rotation.x = PI / 2;
    sk.add(stick);
    for (let k = 0; k < 3; k++) {
      const meat = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.04, 0.08), meatMat);
      meat.position.z = -0.18 + k * 0.14;
      sk.add(meat);
    }
    sk.position.set((i % 3 - 1) * 0.18, 0.9, i < 3 ? -0.12 : 0.18);
    g.add(sk);
  }
  const umb = new THREE.Mesh(new THREE.ConeGeometry(0.7, 0.28, 8), new THREE.MeshStandardMaterial({ color: 0xc03030, roughness: 0.7, side: THREE.DoubleSide }));
  umb.position.y = 1.95; umb.rotation.x = PI; g.add(umb);
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 1.1, 5), new THREE.MeshStandardMaterial({ color: 0x333333 }));
  pole.position.y = 1.4; g.add(pole);
  const puff = new THREE.Mesh(
    new THREE.SphereGeometry(0.22, 6, 5),
    new THREE.MeshBasicMaterial({ color: 0x887766, transparent: true, opacity: 0.22, depthWrite: false })
  );
  puff.name = 'mooping-smoke';
  puff.position.set(0, 1.15, 0);
  g.add(puff);
  const tire = new THREE.MeshStandardMaterial({ color: 0x111111, roughness: 0.8 });
  for (const z of [-0.42, 0.42]) for (const x of [-0.34, 0.34]) {
    const w = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, 0.08, 8), tire);
    w.rotation.z = PI / 2; w.position.set(x, 0.12, z); g.add(w);
  }
  g.userData.coalMat = coalMat;
  return g;
}

export function spawnLaundry(scene) {
  if (!GAMEPLAY.soiLaundry) return;
  const sois = (G.world && G.world.sois) || [];
  G.laundry = [];
  const n = Math.min(3, sois.length);
  const shirtColors = [0xf0f0f0, 0xd44b3b, 0x2a5aad, 0x1e9a5e, 0xffcf4a];
  for (let i = 0; i < n; i++) {
    const s = sois[i];
    const alongZ = s.axis === 'z';
    const g = new THREE.Group();
    g.name = 'laundry-line';
    const midX = (s.x0 + s.x1) * 0.5, midZ = (s.z0 + s.z1) * 0.5;
    const t = 0.35 + i * 0.12;
    const cx = alongZ ? midX : s.x0 + (s.x1 - s.x0) * t;
    const cz = alongZ ? s.z0 + (s.z1 - s.z0) * t : midZ;
    const span = alongZ ? (s.x1 - s.x0) + 2.4 : (s.z1 - s.z0) + 2.4;
    const rope = new THREE.Mesh(
      new THREE.CylinderGeometry(0.015, 0.015, span, 4),
      new THREE.MeshStandardMaterial({ color: 0xc8b090, roughness: 0.7 })
    );
    rope.position.y = 2.35;
    if (alongZ) rope.rotation.z = PI / 2;
    else rope.rotation.x = PI / 2;
    g.add(rope);
    const count = 5;
    for (let k = 0; k < count; k++) {
      const u = (k + 0.5) / count - 0.5;
      const shirt = new THREE.Mesh(
        new THREE.BoxGeometry(0.28, 0.38, 0.04),
        new THREE.MeshStandardMaterial({ color: shirtColors[(i + k) % shirtColors.length], roughness: 0.85 })
      );
      shirt.position.set(
        alongZ ? u * span * 0.7 : 0,
        2.1,
        alongZ ? 0 : u * span * 0.7
      );
      g.add(shirt);
    }
    g.position.set(cx, 0, cz);
    scene.add(g);
    G.laundry.push({ mesh: g, soi: s, x: cx, z: cz });
  }
}

export function spawnSoiPa(scene) {
  if (!GAMEPLAY.soiPa) return;
  const sois = (G.world && G.world.sois) || [];
  G.soiPa = [];
  const n = Math.min(3, sois.length);
  for (let i = 0; i < n; i++) {
    const s = sois[sois.length - 1 - i];
    const alongZ = s.axis === 'z';
    const t = 0.28 + i * 0.18;
    const x = alongZ ? (s.x0 + s.x1) * 0.5 + (alongZ ? 1.6 : 0) : s.x0 + (s.x1 - s.x0) * t;
    const z = alongZ ? s.z0 + (s.z1 - s.z0) * t : (s.z0 + s.z1) * 0.5 + 1.6;
    const g = new THREE.Group();
    g.name = 'soi-pa';
    const pole = new THREE.Mesh(
      new THREE.CylinderGeometry(0.07, 0.09, 4.4, 6),
      new THREE.MeshStandardMaterial({ color: 0x8a8a82, roughness: 0.7, metalness: 0.2 })
    );
    pole.position.y = 2.2;
    g.add(pole);
    const horn = new THREE.Mesh(
      new THREE.ConeGeometry(0.28, 0.55, 8),
      new THREE.MeshStandardMaterial({ color: 0x3a3a40, roughness: 0.45, metalness: 0.35 })
    );
    horn.name = 'pa-horn';
    horn.position.set(alongZ ? 0.22 : 0, 3.85, alongZ ? 0 : 0.22);
    if (alongZ) horn.rotation.z = -PI / 2;
    else horn.rotation.x = PI / 2;
    g.add(horn);
    const box = new THREE.Mesh(
      new THREE.BoxGeometry(0.22, 0.28, 0.16),
      new THREE.MeshStandardMaterial({ color: 0x2a2a28, roughness: 0.6 })
    );
    box.position.y = 3.5;
    g.add(box);
    g.position.set(x, 0, z);
    scene.add(g);
    G.soiPa.push({ mesh: g, soi: s, x, z });
  }
}

export function spawnSoiCctv(scene) {
  if (!GAMEPLAY.soiCctv) return;
  const sois = (G.world && G.world.sois) || [];
  G.soiCctv = [];
  const n = Math.min(3, sois.length);
  for (let i = 0; i < n; i++) {
    const s = sois[i];
    const alongZ = s.axis === 'z';
    const t = 0.18 + i * 0.12;
    const x = alongZ ? (s.x0 + s.x1) * 0.5 + 1.55 : s.x0 + (s.x1 - s.x0) * t;
    const z = alongZ ? s.z0 + (s.z1 - s.z0) * t : (s.z0 + s.z1) * 0.5 + 1.55;
    const g = new THREE.Group();
    g.name = 'soi-cctv';
    const pole = new THREE.Mesh(
      new THREE.CylinderGeometry(0.045, 0.055, 3.4, 5),
      new THREE.MeshStandardMaterial({ color: 0x6a6a68, roughness: 0.65, metalness: 0.25 })
    );
    pole.position.y = 1.7;
    g.add(pole);
    const arm = new THREE.Mesh(
      new THREE.BoxGeometry(0.06, 0.05, 0.55),
      new THREE.MeshStandardMaterial({ color: 0x4a4a48, roughness: 0.5, metalness: 0.3 })
    );
    arm.position.set(alongZ ? 0.22 : 0, 3.25, alongZ ? 0 : 0.22);
    g.add(arm);
    const body = new THREE.Mesh(
      new THREE.BoxGeometry(0.16, 0.12, 0.22),
      new THREE.MeshStandardMaterial({ color: 0x2a2a2c, roughness: 0.45 })
    );
    body.position.set(alongZ ? 0.42 : 0, 3.18, alongZ ? 0 : 0.42);
    g.add(body);
    const lens = new THREE.Mesh(
      new THREE.CylinderGeometry(0.045, 0.05, 0.06, 8),
      new THREE.MeshStandardMaterial({ color: 0x111118, roughness: 0.25, metalness: 0.4 })
    );
    lens.rotation.x = PI / 2;
    lens.position.set(alongZ ? 0.42 : 0, 3.18, alongZ ? 0.14 : 0.42);
    g.add(lens);
    const led = new THREE.Mesh(
      new THREE.SphereGeometry(0.025, 6, 5),
      new THREE.MeshStandardMaterial({ color: 0xff2020, emissive: 0xff1010, emissiveIntensity: 0.15, roughness: 0.4 })
    );
    led.name = 'soi-cctv-led';
    led.position.set(alongZ ? 0.5 : 0, 3.26, alongZ ? 0 : 0.5);
    g.add(led);
    g.position.set(x, 0, z);
    scene.add(g);
    G.soiCctv.push({ mesh: g, led, soi: s, x, z });
  }
}

function addSagWire(scene, ax, ay, az, bx, by, bz, sag, mat) {
  const g = new THREE.Group();
  g.name = 'soi-wire';
  const segs = 6;
  const up = new THREE.Vector3(0, 1, 0);
  const dir = new THREE.Vector3();
  for (let i = 0; i < segs; i++) {
    const t0 = i / segs, t1 = (i + 1) / segs;
    const drop = (t) => 4 * t * (1 - t) * sag;
    const x0 = ax + (bx - ax) * t0, y0 = ay + (by - ay) * t0 - drop(t0), z0 = az + (bz - az) * t0;
    const x1 = ax + (bx - ax) * t1, y1 = ay + (by - ay) * t1 - drop(t1), z1 = az + (bz - az) * t1;
    dir.set(x1 - x0, y1 - y0, z1 - z0);
    const len = dir.length() || 0.01;
    const m = new THREE.Mesh(new THREE.CylinderGeometry(0.016, 0.016, 1, 4), mat);
    m.position.set((x0 + x1) * 0.5, (y0 + y1) * 0.5, (z0 + z1) * 0.5);
    m.scale.set(1, len, 1);
    m.quaternion.setFromUnitVectors(up, dir.normalize());
    g.add(m);
  }
  scene.add(g);
  return g;
}

export function spawnSoiWires(scene) {
  if (!GAMEPLAY.soiWires) return;
  const poles = G.soiPa || [];
  G.soiWires = { cables: [], sparks: [], t: 0 };
  if (poles.length < 2) return;
  const mat = new THREE.MeshStandardMaterial({ color: 0x1c1c18, roughness: 0.9 });
  const y = 3.7;
  for (let i = 0; i < poles.length - 1; i++) {
    const a = poles[i], b = poles[i + 1];
    const sag = 0.85 + i * 0.12;
    G.soiWires.cables.push(addSagWire(scene, a.x, y, a.z, b.x, y, b.z, sag, mat));
  }
  for (let i = 0; i < poles.length; i++) {
    const p = poles[i];
    const soi = p.soi;
    const alongZ = soi && soi.axis === 'z';
    const ox = alongZ ? -3.2 : 0, oz = alongZ ? 0 : -3.2;
    G.soiWires.cables.push(addSagWire(scene, p.x, y, p.z, p.x + ox, y - 0.4, p.z + oz, 0.55, mat));
  }
  const a0 = poles[0];
  const xfmr = new THREE.Mesh(
    new THREE.BoxGeometry(0.42, 0.34, 0.3),
    new THREE.MeshStandardMaterial({ color: 0x6a6a38, roughness: 0.7, metalness: 0.15 })
  );
  xfmr.name = 'soi-transformer';
  xfmr.position.set(a0.x + 0.22, 3.15, a0.z);
  scene.add(xfmr);
  G.soiWires.transformer = xfmr;
  for (let i = 0; i < Math.min(2, G.soiWires.cables.length); i++) {
    const c = G.soiWires.cables[i];
    const spark = new THREE.Mesh(
      new THREE.SphereGeometry(0.055, 6, 5),
      new THREE.MeshStandardMaterial({ color: 0xc8fff8, emissive: 0x88eeff, emissiveIntensity: 0, roughness: 0.25 })
    );
    spark.name = 'soi-spark';
    const mid = c.children[Math.floor(c.children.length / 2)];
    if (mid) spark.position.copy(mid.position);
    else spark.position.set(a0.x, y - 0.8, a0.z);
    scene.add(spark);
    G.soiWires.sparks.push(spark);
  }
}

function makeFrogMesh() {
  const g = new THREE.Group();
  g.name = 'rain-frog';
  const skin = new THREE.MeshStandardMaterial({ color: pick([0x3a7a32, 0x4a6a28, 0x2a5a30]), roughness: 0.8 });
  const body = new THREE.Mesh(new THREE.SphereGeometry(0.09, 7, 6), skin);
  body.scale.set(1.15, 0.7, 1.35);
  body.position.y = 0.07;
  g.add(body);
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.055, 6, 5), skin);
  head.position.set(0, 0.1, 0.08);
  g.add(head);
  const eyeMat = new THREE.MeshStandardMaterial({ color: 0x111111, roughness: 0.4 });
  for (const s of [-1, 1]) {
    const eye = new THREE.Mesh(new THREE.SphereGeometry(0.018, 5, 4), eyeMat);
    eye.position.set(s * 0.035, 0.13, 0.11);
    g.add(eye);
  }
  return g;
}

export function spawnRainFrogs(scene) {
  if (!GAMEPLAY.rainFrogs) return;
  const floods = ((G.world && G.world.flood) || []).filter(f => f && f.soi);
  const sois = (G.world && G.world.sois) || [];
  const patches = floods.length ? floods : sois.map(s => ({ x0: s.x0, x1: s.x1, z0: s.z0, z1: s.z1, soi: true }));
  G.rainFrogs = [];
  if (!patches.length) return;
  for (let i = 0; i < 6; i++) {
    const p = patches[i % patches.length];
    const x = p.x0 + (p.x1 - p.x0) * (0.18 + (i % 3) * 0.28);
    const z = p.z0 + (p.z1 - p.z0) * (0.22 + Math.floor(i / 3) * 0.4);
    const mesh = makeFrogMesh();
    mesh.position.set(x, 0, z);
    mesh.visible = false;
    scene.add(mesh);
    G.rainFrogs.push({ mesh, patch: p, x, z, t: i * 0.37, heading: i * 1.1, hop: 8 + i * 0.7 });
  }
}

function makePlasticChair() {
  const g = new THREE.Group();
  g.name = 'plastic-chair';
  const mat = new THREE.MeshStandardMaterial({ color: 0xd8d0c0, roughness: 0.7 });
  const seat = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.04, 0.42), mat);
  seat.position.y = 0.42; g.add(seat);
  const back = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.46, 0.04), mat);
  back.position.set(0, 0.65, -0.2); g.add(back);
  const steel = new THREE.MeshStandardMaterial({ color: 0x888890, roughness: 0.5, metalness: 0.3 });
  for (const [sx, sz] of [[-0.16, -0.16], [0.16, -0.16], [-0.16, 0.16], [0.16, 0.16]]) {
    const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.018, 0.42, 5), steel);
    leg.position.set(sx, 0.21, sz); g.add(leg);
  }
  return g;
}

export function spawnSoiChairs(scene) {
  if (!GAMEPLAY.soiChairs) return;
  const sois = (G.world && G.world.sois) || [];
  if (sois.length < 3) return;
  const s = sois[2];
  const alongZ = s.axis === 'z';
  const t = 0.72;
  const midX = alongZ ? (s.x0 + s.x1) * 0.5 : s.x0 + (s.x1 - s.x0) * t;
  const midZ = alongZ ? s.z0 + (s.z1 - s.z0) * t : (s.z0 + s.z1) * 0.5;
  const ox = alongZ ? 1.7 : 0, oz = alongZ ? 0 : 1.7;
  const facing = alongZ ? -PI / 2 : 0;
  G.soiChairs = { soi: s, seats: [], crates: [], x: midX + ox, z: midZ + oz };
  const crateMat = new THREE.MeshStandardMaterial({ color: 0xc45a1a, roughness: 0.75 });
  for (let i = 0; i < 2; i++) {
    const chair = makePlasticChair();
    const x = midX + ox + (alongZ ? 0 : (i - 0.5) * 0.85);
    const z = midZ + oz + (alongZ ? (i - 0.5) * 0.85 : 0);
    chair.position.set(x, 0, z);
    chair.rotation.y = facing;
    scene.add(chair);
    G.soiChairs.seats.push({ mesh: chair, x, z, facing });
  }
  for (let i = 0; i < 2; i++) {
    const crate = new THREE.Mesh(new THREE.BoxGeometry(0.38, 0.28, 0.38), crateMat);
    crate.name = 'beer-crate';
    const x = midX + ox + (alongZ ? 0.55 : (i - 0.5) * 0.5);
    const z = midZ + oz + (alongZ ? (i - 0.5) * 0.5 : 0.55);
    crate.position.set(x, 0.14, z);
    scene.add(crate);
    G.soiChairs.crates.push(crate);
  }
}

export function spawnSoiMechanic(scene) {
  if (!GAMEPLAY.soiMechanic) return;
  const sois = (G.world && G.world.sois) || [];
  if (sois.length < 4) return;
  const s = sois[3];
  const alongZ = s.axis === 'z';
  const t = 0.22;
  const x = alongZ ? (s.x0 + s.x1) * 0.5 + 1.8 : s.x0 + (s.x1 - s.x0) * t;
  const z = alongZ ? s.z0 + (s.z1 - s.z0) * t : (s.z0 + s.z1) * 0.5 + 1.8;
  const heading = alongZ ? PI / 2 : 0;
  const stand = new THREE.Group();
  stand.name = 'paddock-stand';
  const steel = new THREE.MeshStandardMaterial({ color: 0x4a4a50, roughness: 0.45, metalness: 0.4 });
  const bar = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.55, 0.08), steel);
  bar.position.y = 0.28; stand.add(bar);
  const base = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.06, 0.28), steel);
  base.position.y = 0.03; stand.add(base);
  stand.position.set(x, 0, z);
  scene.add(stand);
  const bike = makeVehicle('bike', scene);
  bike.pos.set(x, 0, z);
  bike.heading = heading;
  bike.mesh.position.set(x, 0.28, z);
  bike.mesh.rotation.y = heading;
  bike.driver = null;
  bike.vel = 0;
  bike.soiMechanic = true;
  bike._standHome = { x, y: 0.28, z, heading };
  const ped = spawnPed(scene, new THREE.Vector3(x + (alongZ ? 0 : 1.1), 0, z + (alongZ ? 1.1 : 0)), 'laborer');
  ped.soiMechanic = true;
  ped.anchor = { slot: ped.mesh.position.clone(), facing: heading + PI };
  ped.speed = 0;
  ped.state = 'idle';
  ped.heading = heading + PI;
  ped.mesh.rotation.y = ped.heading;
  const wrench = new THREE.Mesh(
    new THREE.BoxGeometry(0.04, 0.04, 0.28),
    new THREE.MeshStandardMaterial({ color: 0x888890, metalness: 0.5, roughness: 0.35 })
  );
  wrench.name = 'wrench';
  const pp = ped.mesh.userData.parts;
  if (pp && pp.foreR) { wrench.position.set(0.02, -0.22, 0.08); pp.foreR.add(wrench); }
  else { wrench.position.set(0.22, 1.05, 0.12); ped.mesh.add(wrench); }
  G.soiMechanic = { ped, bike, stand, soi: s, x, z };
}

export function spawnSoiBarber(scene) {
  if (!GAMEPLAY.soiBarber) return;
  const sois = (G.world && G.world.sois) || [];
  if (sois.length < 5) return;
  const s = sois[4];
  const alongZ = s.axis === 'z';
  const t = 0.48;
  const x = alongZ ? (s.x0 + s.x1) * 0.5 + 1.7 : s.x0 + (s.x1 - s.x0) * t;
  const z = alongZ ? s.z0 + (s.z1 - s.z0) * t : (s.z0 + s.z1) * 0.5 + 1.7;
  const facing = alongZ ? -PI / 2 : 0;
  const chair = makePlasticChair();
  chair.name = 'barber-chair';
  chair.position.set(x, 0, z);
  chair.rotation.y = facing;
  scene.add(chair);
  const cape = new THREE.Mesh(
    new THREE.BoxGeometry(0.55, 0.02, 0.7),
    new THREE.MeshStandardMaterial({ color: 0x1a3a6a, roughness: 0.7 })
  );
  cape.name = 'barber-cape';
  cape.position.set(x, 0.46, z + (alongZ ? 0.02 : 0.02));
  scene.add(cape);
  const pole = new THREE.Mesh(
    new THREE.CylinderGeometry(0.04, 0.05, 1.8, 6),
    new THREE.MeshStandardMaterial({ color: 0x8a8a82, roughness: 0.55, metalness: 0.25 })
  );
  pole.position.set(x + (alongZ ? 0.55 : 0), 0.9, z + (alongZ ? 0 : 0.55));
  scene.add(pole);
  const stripe = new THREE.Mesh(
    new THREE.CylinderGeometry(0.06, 0.06, 0.45, 8),
    new THREE.MeshStandardMaterial({ color: 0xc03030, roughness: 0.45, emissive: 0x801010, emissiveIntensity: 0.2 })
  );
  stripe.name = 'barber-pole';
  stripe.position.set(pole.position.x, 1.85, pole.position.z);
  scene.add(stripe);
  const mirror = new THREE.Mesh(
    new THREE.BoxGeometry(0.35, 0.42, 0.03),
    new THREE.MeshStandardMaterial({ color: 0xa8c8d8, roughness: 0.15, metalness: 0.4 })
  );
  mirror.name = 'barber-mirror';
  mirror.position.set(pole.position.x, 1.35, pole.position.z);
  scene.add(mirror);
  const ped = spawnPed(scene, new THREE.Vector3(x + (alongZ ? 0 : 0.85), 0, z + (alongZ ? 0.85 : 0)), 'laborer');
  ped.soiBarber = true;
  ped.anchor = { slot: ped.mesh.position.clone(), facing: facing + PI };
  ped.speed = 0;
  ped.state = 'idle';
  ped.heading = facing + PI;
  if (ped.mesh) ped.mesh.rotation.y = ped.heading;
  const clip = new THREE.Mesh(
    new THREE.BoxGeometry(0.05, 0.04, 0.16),
    new THREE.MeshStandardMaterial({ color: 0x888890, metalness: 0.5, roughness: 0.35 })
  );
  clip.name = 'clippers';
  const pp = ped.mesh.userData.parts;
  if (pp && pp.foreR) { clip.position.set(0.02, -0.2, 0.08); pp.foreR.add(clip); }
  else { clip.position.set(0.22, 1.05, 0.12); ped.mesh.add(clip); }
  G.soiBarber = { ped, chair, cape, pole: stripe, mirror, clip, soi: s, x, z, facing };
}

export function spawnSoiCowboy(scene) {
  if (!GAMEPLAY.soiCowboy) return;
  const bar = (BUSINESSES || []).find(b => b.id === 'bar');
  const origin = (bar && bar.pos) || new THREE.Vector3(44, 0, 90);
  const x = origin.x - 2.6;
  const colors = [0xff2a86, 0x21f0ff, 0xffcf4a, 0xff3344];
  G.soiCowboy = { signs: [], origin: { x: origin.x, z: origin.z } };
  if (G.world && G.world.poi) G.world.poi.cowboy = new THREE.Vector3(origin.x, 0, origin.z);
  for (let i = 0; i < 4; i++) {
    const z = origin.z - 14 + i * 4;
    const col = colors[i];
    const g = new THREE.Group();
    g.name = 'cowboy-neon';
    const face = new THREE.Mesh(
      new THREE.BoxGeometry(0.16, 3.1, 3.2),
      new THREE.MeshStandardMaterial({ color: 0x161018, roughness: 0.72 })
    );
    face.position.y = 1.55;
    g.add(face);
    const signMat = new THREE.MeshStandardMaterial({
      color: col, emissive: col, emissiveIntensity: 0.25, roughness: 0.42,
    });
    if (G.nightEmissive) G.nightEmissive.push({ mat: signMat, dayIntensity: 0.22, nightIntensity: 1.75 });
    const sign = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.62, 2.4), signMat);
    sign.name = 'cowboy-sign';
    sign.position.set(0.14, 3.2, 0);
    g.add(sign);
    const awning = new THREE.Mesh(
      new THREE.BoxGeometry(1.15, 0.07, 3.2),
      new THREE.MeshStandardMaterial({ color: col, roughness: 0.78 })
    );
    awning.position.set(0.55, 2.48, 0);
    g.add(awning);
    const light = new THREE.PointLight(col, 0, 9, 2);
    light.position.set(0.55, 2.7, 0);
    g.add(light);
    if (G.nightLights) G.nightLights.push({ light, base: 1.05 });
    g.position.set(x, 0, z);
    scene.add(g);
    G.soiCowboy.signs.push({ mesh: g, mat: signMat, light, x, z });
  }
}

function makeCheckpointCone() {
  const g = new THREE.Group();
  g.name = 'checkpoint-cone';
  const body = new THREE.Mesh(
    new THREE.ConeGeometry(0.18, 0.56, 7),
    new THREE.MeshStandardMaterial({ color: 0xff6a1a, roughness: 0.55, emissive: 0xff3a00, emissiveIntensity: 0.14 })
  );
  body.position.y = 0.28;
  g.add(body);
  const stripe = new THREE.Mesh(
    new THREE.CylinderGeometry(0.11, 0.14, 0.055, 7),
    new THREE.MeshStandardMaterial({ color: 0xf4f4f4, roughness: 0.45 })
  );
  stripe.position.y = 0.2;
  g.add(stripe);
  return g;
}

function dressCheckpointCop(ped, slot) {
  const pp = ped.mesh.userData.parts;
  recolorTorso(pp, 0x8a7f4a, 0.7);
  const pants = new THREE.MeshStandardMaterial({ color: 0x4a4030, roughness: 0.8 });
  for (const part of (pp.pantsParts || [pp.legL, pp.legR])) if (part) part.material = pants;
  const vest = new THREE.Mesh(
    new THREE.BoxGeometry(0.42, 0.38, 0.28),
    new THREE.MeshStandardMaterial({ color: 0xc8e04a, roughness: 0.6, emissive: 0x88aa20, emissiveIntensity: 0.16 })
  );
  vest.name = 'checkpoint-vest';
  vest.position.set(0, 1.18, 0.04);
  ped.mesh.add(vest);
  if (pp.head) {
    const cap = new THREE.Group();
    cap.name = 'cop-cap';
    const crown = new THREE.Mesh(
      new THREE.CylinderGeometry(0.1, 0.12, 0.08, 8),
      new THREE.MeshStandardMaterial({ color: 0x3a3424, roughness: 0.7 })
    );
    crown.position.y = 0.14;
    cap.add(crown);
    const brim = new THREE.Mesh(
      new THREE.BoxGeometry(0.22, 0.02, 0.28),
      new THREE.MeshStandardMaterial({ color: 0x2a261c, roughness: 0.65 })
    );
    brim.position.set(0, 0.1, 0.04);
    cap.add(brim);
    pp.head.add(cap);
  }
  const torch = new THREE.Group();
  torch.name = 'flashlight';
  const handle = new THREE.Mesh(
    new THREE.CylinderGeometry(0.022, 0.022, 0.18, 6),
    new THREE.MeshStandardMaterial({ color: 0x1a1a1e, roughness: 0.45, metalness: 0.35 })
  );
  handle.rotation.x = PI / 2;
  torch.add(handle);
  const head = new THREE.Mesh(
    new THREE.CylinderGeometry(0.038, 0.03, 0.07, 6),
    new THREE.MeshStandardMaterial({ color: 0x2a2a30, roughness: 0.4, metalness: 0.4 })
  );
  head.rotation.x = PI / 2;
  head.position.z = 0.12;
  torch.add(head);
  const lens = new THREE.Mesh(
    new THREE.CircleGeometry(0.032, 8),
    new THREE.MeshStandardMaterial({ color: 0xfff2c0, emissive: 0xffe080, emissiveIntensity: 1.4, roughness: 0.2 })
  );
  lens.position.z = 0.16;
  torch.add(lens);
  const beam = new THREE.Mesh(
    new THREE.ConeGeometry(0.42, 2.1, 8, 1, true),
    new THREE.MeshBasicMaterial({ color: 0xffe6a0, transparent: true, opacity: 0.16, depthWrite: false, side: THREE.DoubleSide })
  );
  beam.name = 'flashlight-beam';
  beam.rotation.x = PI / 2;
  beam.position.z = 1.22;
  torch.add(beam);
  const light = new THREE.PointLight(0xffe0a0, 0, 16, 2);
  light.position.z = 0.2;
  torch.add(light);
  if (pp.foreR) {
    torch.position.set(0.02, -0.22, 0.1);
    torch.rotation.set(-0.4, 0, 0.15);
    pp.foreR.add(torch);
  } else {
    torch.position.set(0.22, 1.1, 0.18);
    ped.mesh.add(torch);
  }
  ped.checkpoint = true;
  ped.anchor = { slot: new THREE.Vector3(slot.x, 0, slot.z), facing: slot.facing };
  ped.speed = 0;
  ped.state = 'idle';
  ped.heading = slot.facing;
  ped.mesh.rotation.y = slot.facing;
  ped.mesh.position.set(slot.x, 0, slot.z);
  return { torch, light, beam };
}

export function spawnCheckpoint(scene) {
  if (!GAMEPLAY.nightCheckpoint) return;
  const x = 50, z = 100;
  const g = new THREE.Group();
  g.name = 'checkpoint';
  const cones = [];
  for (let i = 0; i < 5; i++) {
    const cone = makeCheckpointCone();
    cone.position.set(x - 2.5, 0, z - 8 + i * 4);
    g.add(cone);
    cones.push(cone);
  }
  const bar = new THREE.Mesh(
    new THREE.BoxGeometry(1.6, 0.12, 0.08),
    new THREE.MeshStandardMaterial({ color: 0xc03030, roughness: 0.5 })
  );
  bar.position.set(x - 2.5, 0.95, z + 10);
  g.add(bar);
  const post = new THREE.Mesh(
    new THREE.CylinderGeometry(0.03, 0.03, 0.95, 5),
    new THREE.MeshStandardMaterial({ color: 0x222222, roughness: 0.6 })
  );
  post.position.set(x - 2.5, 0.48, z + 10);
  g.add(post);
  const spikes = new THREE.Group();
  spikes.name = 'checkpoint-spikes';
  const strip = new THREE.Mesh(
    new THREE.BoxGeometry(7.2, 0.08, 0.42),
    new THREE.MeshStandardMaterial({ color: 0x1a1a1e, roughness: 0.88 })
  );
  strip.position.y = 0.05;
  spikes.add(strip);
  const spikeMat = new THREE.MeshStandardMaterial({ color: 0x9a9aa0, metalness: 0.55, roughness: 0.35 });
  for (let i = -4; i <= 4; i++) {
    const tooth = new THREE.Mesh(new THREE.ConeGeometry(0.07, 0.26, 4), spikeMat);
    tooth.position.set(i * 0.78, 0.18, 0);
    spikes.add(tooth);
  }
  spikes.position.set(x, 0, z);
  spikes.visible = false;
  g.add(spikes);
  scene.add(g);
  const slot = { x: x + ROAD_WIDTH / 2 + 1.35, z, facing: -PI / 2 };
  const cop = spawnPed(scene, new THREE.Vector3(slot.x, 0, slot.z), 'office');
  const kit = dressCheckpointCop(cop, slot);
  cop.mesh.visible = false;
  if (kit.beam) kit.beam.visible = false;
  if (G.nightLights) G.nightLights.push({ light: kit.light, base: 1.6 });
  G.checkpoint = {
    x, z, mesh: g, cones, cop, light: kit.light, beam: kit.beam, spikes,
    active: false, flagged: false, late: false,
  };
}

export function spawnSevenBikes(scene) {
  if (!GAMEPLAY.sevenBikes) return;
  const rack = (seven) => {
    if (!seven || !seven.pos) return [];
    const hx = seven.hx || 5;
    const px = seven.pos.x - hx - 1.55;
    const heading = PI / 2;
    const list = [];
    const n = 5;
    for (let i = 0; i < n; i++) {
      const z = seven.pos.z - 2.2 + i * 1.15;
      const x = px + (i % 2) * 0.18;
      const bike = makeVehicle('bike', scene);
      bike.pos.set(x, 0, z);
      bike.heading = heading;
      bike.mesh.position.copy(bike.pos);
      bike.mesh.rotation.y = heading;
      bike.driver = null;
      bike.vel = 0;
      bike.sevenParked = true;
      bike._standHome = { x, z, heading };
      if (GAMEPLAY.bikeSeatCover) {
        const cover = new THREE.Mesh(
          new THREE.BoxGeometry(0.28, 0.04, 0.42),
          new THREE.MeshStandardMaterial({
            color: pick([0xc8d8e0, 0xe8e0c8, 0xb0c8d8]),
            roughness: 0.35,
            transparent: true,
            opacity: 0.72,
          })
        );
        cover.name = 'seat-cover';
        cover.visible = false;
        cover.position.set(0, 0.78, -0.08);
        bike.mesh.add(cover);
        bike.seatCover = cover;
      }
      list.push(bike);
    }
    return list;
  };
  const walk = G.world && (G.world.sevenWalkIn || (G.world.sevenElevens && G.world.sevenElevens[0]));
  G.sevenBikes = rack(walk);
  const south = (G.world.sevenElevens || []).find(s => s && s.pos && Math.abs(s.pos.x) < 8 && s.pos.z < -80);
  G.southSevenBikes = rack(south);
  const west = (G.world.sevenElevens || []).find(s => s && s.pos && s.pos.x < -50 && s.pos.z > 0 && s.pos.z < 60);
  G.westSevenBikes = rack(west);
  const east = (G.world.sevenElevens || []).find(s => s && s.pos && s.pos.x > 100 && s.pos.z < 0 && s.pos.z > -80);
  G.eastSevenBikes = rack(east);
}

export function spawnSevenGuard(scene) {
  if (!GAMEPLAY.sevenGuard) return;
  const make = (seven, chairName) => {
    if (!seven || !seven.pos) return null;
    const hz = seven.hz || 4;
    const x = seven.pos.x - 3.1, z = seven.pos.z + hz + 1.15;
    const chair = new THREE.Group();
    chair.name = chairName;
    const seat = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.04, 0.42), new THREE.MeshStandardMaterial({ color: 0xd8d0c0, roughness: 0.7 }));
    seat.position.y = 0.42; chair.add(seat);
    const back = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.46, 0.04), seat.material);
    back.position.set(0, 0.65, -0.2); chair.add(back);
    for (const [sx, sz] of [[-0.16, -0.16], [0.16, -0.16], [-0.16, 0.16], [0.16, 0.16]]) {
      const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.018, 0.42, 5), new THREE.MeshStandardMaterial({ color: 0x888890, roughness: 0.5, metalness: 0.3 }));
      leg.position.set(sx, 0.21, sz); chair.add(leg);
    }
    chair.position.set(x, 0, z);
    scene.add(chair);
    const ped = spawnPed(scene, new THREE.Vector3(x, 0, z), 'laborer');
    recolorTorso(ped.mesh.userData.parts, 0x1a3a6a, 0.7);
    ped.sevenGuard = true;
    ped.anchor = { slot: new THREE.Vector3(x, 0.42, z), facing: PI };
    ped.speed = 0;
    ped.state = 'idle';
    ped.heading = PI;
    ped.mesh.position.set(x, 0.42, z);
    ped.mesh.rotation.y = PI;
    const torch = new THREE.Group();
    torch.name = 'flashlight';
    const handle = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.16, 6), new THREE.MeshStandardMaterial({ color: 0x1a1a1e, roughness: 0.45 }));
    handle.rotation.x = PI / 2; torch.add(handle);
    const beam = new THREE.Mesh(
      new THREE.ConeGeometry(0.35, 1.6, 8, 1, true),
      new THREE.MeshBasicMaterial({ color: 0xffe6a0, transparent: true, opacity: 0.14, depthWrite: false, side: THREE.DoubleSide })
    );
    beam.name = 'flashlight-beam';
    beam.rotation.x = PI / 2; beam.position.z = 0.95; torch.add(beam);
    const light = new THREE.PointLight(0xffe0a0, 0, 10, 2);
    light.position.z = 0.2; torch.add(light);
    const pp = ped.mesh.userData.parts;
    if (pp && pp.foreR) { torch.position.set(0.02, -0.2, 0.08); pp.foreR.add(torch); }
    else { torch.position.set(0.2, 0.9, 0.15); ped.mesh.add(torch); }
    beam.visible = false;
    return { ped, chair, light, beam, x, z };
  };
  const walk = G.world && (G.world.sevenWalkIn || (G.world.sevenElevens && G.world.sevenElevens[0]));
  G.sevenGuard = make(walk, 'seven-chair');
  const south = (G.world.sevenElevens || []).find(s => s && s.pos && Math.abs(s.pos.x) < 8 && s.pos.z < -80);
  G.southSevenGuard = make(south, 'south-seven-chair');
  const west = (G.world.sevenElevens || []).find(s => s && s.pos && s.pos.x < -50 && s.pos.z > 0 && s.pos.z < 60);
  G.westSevenGuard = make(west, 'west-seven-chair');
  const east = (G.world.sevenElevens || []).find(s => s && s.pos && s.pos.x > 100 && s.pos.z < 0 && s.pos.z > -80);
  G.eastSevenGuard = make(east, 'east-seven-chair');
}

export function spawnMallGuard(scene) {
  if (!GAMEPLAY.mallGuard) return;
  const mall = G.world && G.world.poi && G.world.poi.terminal21;
  if (!mall) return;
  const x = mall.x - 3.4, z = mall.z + 0.4;
  const chair = new THREE.Group();
  chair.name = 'mall-chair';
  const seat = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.04, 0.42), new THREE.MeshStandardMaterial({ color: 0xd8d0c0, roughness: 0.7 }));
  seat.position.y = 0.42; chair.add(seat);
  const back = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.46, 0.04), seat.material);
  back.position.set(0, 0.65, -0.2); chair.add(back);
  for (const [sx, sz] of [[-0.16, -0.16], [0.16, -0.16], [-0.16, 0.16], [0.16, 0.16]]) {
    const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.018, 0.42, 5), new THREE.MeshStandardMaterial({ color: 0x888890, roughness: 0.5, metalness: 0.3 }));
    leg.position.set(sx, 0.21, sz); chair.add(leg);
  }
  chair.position.set(x, 0, z);
  scene.add(chair);
  const ped = spawnPed(scene, new THREE.Vector3(x, 0, z), 'laborer');
  recolorTorso(ped.mesh.userData.parts, 0x1a3a6a, 0.7);
  ped.mallGuard = true;
  ped.anchor = { slot: new THREE.Vector3(x, 0.42, z), facing: PI };
  ped.speed = 0;
  ped.state = 'idle';
  ped.heading = PI;
  ped.mesh.position.set(x, 0.42, z);
  ped.mesh.rotation.y = PI;
  const torch = new THREE.Group();
  torch.name = 'flashlight';
  const handle = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.16, 6), new THREE.MeshStandardMaterial({ color: 0x1a1a1e, roughness: 0.45 }));
  handle.rotation.x = PI / 2; torch.add(handle);
  const beam = new THREE.Mesh(
    new THREE.ConeGeometry(0.35, 1.6, 8, 1, true),
    new THREE.MeshBasicMaterial({ color: 0xffe6a0, transparent: true, opacity: 0.14, depthWrite: false, side: THREE.DoubleSide })
  );
  beam.name = 'flashlight-beam';
  beam.rotation.x = PI / 2; beam.position.z = 0.95; torch.add(beam);
  const light = new THREE.PointLight(0xffe0a0, 0, 10, 2);
  light.position.z = 0.2; torch.add(light);
  const pp = ped.mesh.userData.parts;
  if (pp && pp.foreR) { torch.position.set(0.02, -0.2, 0.08); pp.foreR.add(torch); }
  else { torch.position.set(0.2, 0.9, 0.15); ped.mesh.add(torch); }
  beam.visible = false;
  G.mallGuard = { ped, chair, light, beam, x, z };
}

export function spawnBankGuard(scene) {
  if (!GAMEPLAY.bankGuard) return;
  const bank = G.world && G.world.poi && G.world.poi.bank;
  if (!bank) return;
  const x = bank.x - 3.4, z = bank.z + 0.4;
  const chair = new THREE.Group();
  chair.name = 'bank-chair';
  const seat = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.04, 0.42), new THREE.MeshStandardMaterial({ color: 0xd8d0c0, roughness: 0.7 }));
  seat.position.y = 0.42; chair.add(seat);
  const back = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.46, 0.04), seat.material);
  back.position.set(0, 0.65, -0.2); chair.add(back);
  for (const [sx, sz] of [[-0.16, -0.16], [0.16, -0.16], [-0.16, 0.16], [0.16, 0.16]]) {
    const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.018, 0.42, 5), new THREE.MeshStandardMaterial({ color: 0x888890, roughness: 0.5, metalness: 0.3 }));
    leg.position.set(sx, 0.21, sz); chair.add(leg);
  }
  chair.position.set(x, 0, z);
  scene.add(chair);
  const ped = spawnPed(scene, new THREE.Vector3(x, 0, z), 'laborer');
  recolorTorso(ped.mesh.userData.parts, 0x1a3a6a, 0.7);
  ped.bankGuard = true;
  ped.anchor = { slot: new THREE.Vector3(x, 0.42, z), facing: 0 };
  ped.speed = 0;
  ped.state = 'idle';
  ped.heading = 0;
  ped.mesh.position.set(x, 0.42, z);
  ped.mesh.rotation.y = 0;
  const torch = new THREE.Group();
  torch.name = 'flashlight';
  const handle = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.16, 6), new THREE.MeshStandardMaterial({ color: 0x1a1a1e, roughness: 0.45 }));
  handle.rotation.x = PI / 2; torch.add(handle);
  const beam = new THREE.Mesh(
    new THREE.ConeGeometry(0.35, 1.6, 8, 1, true),
    new THREE.MeshBasicMaterial({ color: 0xffe6a0, transparent: true, opacity: 0.14, depthWrite: false, side: THREE.DoubleSide })
  );
  beam.name = 'flashlight-beam';
  beam.rotation.x = PI / 2; beam.position.z = 0.95; torch.add(beam);
  const light = new THREE.PointLight(0xffe0a0, 0, 10, 2);
  light.position.z = 0.2; torch.add(light);
  const pp = ped.mesh.userData.parts;
  if (pp && pp.foreR) { torch.position.set(0.02, -0.2, 0.08); pp.foreR.add(torch); }
  else { torch.position.set(0.2, 0.9, 0.15); ped.mesh.add(torch); }
  beam.visible = false;
  G.bankGuard = { ped, chair, light, beam, x, z };
}

export function spawnBankQueue(scene) {
  if (!GAMEPLAY.bankQueue) return;
  const bank = G.world && G.world.bank;
  if (!bank || !bank.teller) return;
  const tx = bank.teller.x, tz = bank.teller.z;
  const queue = [];
  for (let i = 0; i < 2; i++) {
    const x = tx + i * 0.12, z = tz + i * 0.85;
    const ped = spawnPed(scene, new THREE.Vector3(x, 0, z), i === 0 ? 'office' : 'local');
    ped.bankQueue = true;
    ped.speed = 0;
    ped.state = 'idle';
    ped.heading = PI;
    ped.anchor = { slot: new THREE.Vector3(x, 0, z), facing: PI };
    if (ped.mesh) {
      ped.mesh.rotation.y = PI;
      ped.mesh.visible = false;
    }
    if (i === 0 && ped.mesh) {
      const book = new THREE.Mesh(
        new THREE.BoxGeometry(0.09, 0.012, 0.12),
        new THREE.MeshStandardMaterial({ color: 0xc45a18, roughness: 0.55 })
      );
      book.name = 'bank-passbook';
      const parts = ped.mesh.userData && ped.mesh.userData.parts;
      if (parts && parts.foreR) { book.position.set(0.02, -0.28, 0.06); parts.foreR.add(book); }
      else { book.position.set(0.22, 1.05, 0.12); ped.mesh.add(book); }
      ped._passbook = book;
    }
    queue.push(ped);
  }
  G.bankQueue = { queue, x: tx, z: tz, t: 0, hours: [9, 16] };
  const door = G.world && G.world.poi && G.world.poi.bank;
  if (door) {
    const ax = door.x + 4.4, az = door.z + 0.6;
    const machine = new THREE.Mesh(
      new THREE.BoxGeometry(0.7, 1.5, 0.45),
      new THREE.MeshStandardMaterial({ color: 0x1a3a6a, roughness: 0.4, metalness: 0.3 })
    );
    machine.name = 'bank-atm';
    machine.position.set(ax, 0.85, az);
    scene.add(machine);
    const atmQueue = [];
    for (let i = 0; i < 2; i++) {
      const x = ax + 1.05 + i * 0.8;
      const z = az + i * 0.18;
      const ped = spawnPed(scene, new THREE.Vector3(x, 0, z), i === 0 ? 'office' : 'local');
      ped.bankQueue = true;
      ped.speed = 0;
      ped.state = 'idle';
      ped.heading = -PI / 2;
      ped.anchor = { slot: new THREE.Vector3(x, 0, z), facing: -PI / 2 };
      if (ped.mesh) {
        ped.mesh.rotation.y = -PI / 2;
        ped.mesh.visible = false;
      }
      if (i === 0 && ped.mesh) {
        const card = new THREE.Mesh(
          new THREE.BoxGeometry(0.08, 0.05, 0.004),
          new THREE.MeshStandardMaterial({ color: 0xc45a18, roughness: 0.45, metalness: 0.2 })
        );
        card.name = 'bank-atm-card';
        const parts = ped.mesh.userData && ped.mesh.userData.parts;
        if (parts && parts.foreR) { card.position.set(0.02, -0.28, 0.06); parts.foreR.add(card); }
        else { card.position.set(0.22, 1.05, 0.12); ped.mesh.add(card); }
        ped._atmCard = card;
      }
      atmQueue.push(ped);
    }
    G.bankAtm = { queue: atmQueue, machine, x: ax, z: az, t: 0, hours: [6, 22] };
  }
}

export function spawnGunClerk(scene) {
  if (!GAMEPLAY.gunClerk) return;
  const shop = G.world && G.world.gunShop;
  if (!shop) return;
  const x = shop.x, z = shop.z + 1.7;
  const ped = spawnPed(scene, new THREE.Vector3(x, 0, z), 'laborer');
  recolorTorso(ped.mesh.userData.parts, 0x2a2a32, 0.7);
  ped.gunClerk = true;
  ped.anchor = { slot: new THREE.Vector3(x, 0, z), facing: PI };
  ped.speed = 0;
  ped.state = 'idle';
  ped.heading = PI;
  if (ped.mesh) {
    ped.mesh.rotation.y = PI;
    ped.mesh.visible = false;
  }
  const cloth = new THREE.Mesh(
    new THREE.BoxGeometry(0.12, 0.02, 0.16),
    new THREE.MeshStandardMaterial({ color: 0x6a6a70, roughness: 0.85 })
  );
  cloth.name = 'gun-cloth';
  const parts = ped.mesh && ped.mesh.userData && ped.mesh.userData.parts;
  if (parts && parts.foreR) {
    cloth.position.set(0.02, -0.22, 0.08);
    parts.foreR.add(cloth);
  } else if (ped.mesh) {
    cloth.position.set(0.22, 1.05, 0.12);
    ped.mesh.add(cloth);
  }
  G.gunClerk = { ped, cloth, x, z, t: 0 };
  const cx = x + 1.4, cz = z - 2.0;
  const shopper = spawnPed(scene, new THREE.Vector3(cx, 0, cz), 'office');
  shopper.gunClerk = true;
  shopper.gunShop = true;
  shopper.speed = 0;
  shopper.state = 'idle';
  shopper.heading = 0;
  shopper.anchor = { slot: new THREE.Vector3(cx, 0, cz), facing: 0 };
  if (shopper.mesh) {
    shopper.mesh.rotation.y = 0;
    shopper.mesh.visible = false;
  }
  const cse = new THREE.Mesh(
    new THREE.BoxGeometry(0.16, 0.08, 0.28),
    new THREE.MeshStandardMaterial({ color: 0x3a2a1a, roughness: 0.7, metalness: 0.15 })
  );
  cse.name = 'gun-case';
  const sp = shopper.mesh && shopper.mesh.userData && shopper.mesh.userData.parts;
  if (sp && sp.foreL) {
    cse.position.set(0.02, -0.24, 0.08);
    sp.foreL.add(cse);
  } else if (shopper.mesh) {
    cse.position.set(-0.18, 1.0, 0.1);
    shopper.mesh.add(cse);
  }
  G.gunShopper = { ped: shopper, x: cx, z: cz, t: 0 };
}

export function spawnStarterClerk(scene) {
  if (!GAMEPLAY.starterClerk) return;
  const shop = (G.world && G.world.gunShops || []).find(s => s && s.id === 'starter');
  if (!shop || !shop.pos) return;
  const x = shop.pos.x, z = shop.pos.z + 1.7;
  const ped = spawnPed(scene, new THREE.Vector3(x, 0, z), 'laborer');
  recolorTorso(ped.mesh.userData.parts, 0x3a2a22, 0.7);
  ped.starterClerk = true;
  ped.anchor = { slot: new THREE.Vector3(x, 0, z), facing: PI };
  ped.speed = 0;
  ped.state = 'idle';
  ped.heading = PI;
  if (ped.mesh) {
    ped.mesh.rotation.y = PI;
    ped.mesh.visible = false;
  }
  const cloth = new THREE.Mesh(
    new THREE.BoxGeometry(0.12, 0.02, 0.16),
    new THREE.MeshStandardMaterial({ color: 0x8a6a40, roughness: 0.85 })
  );
  cloth.name = 'starter-gun-cloth';
  const parts = ped.mesh && ped.mesh.userData && ped.mesh.userData.parts;
  if (parts && parts.foreR) {
    cloth.position.set(0.02, -0.22, 0.08);
    parts.foreR.add(cloth);
  } else if (ped.mesh) {
    cloth.position.set(0.22, 1.05, 0.12);
    ped.mesh.add(cloth);
  }
  G.starterClerk = { ped, cloth, x, z, t: 0 };
  const cx = x + 1.4, cz = z - 1.6;
  const shopper = spawnPed(scene, new THREE.Vector3(cx, 0, cz), 'office');
  shopper.starterClerk = true;
  shopper.starterShop = true;
  shopper.speed = 0;
  shopper.state = 'idle';
  shopper.heading = 0;
  shopper.anchor = { slot: new THREE.Vector3(cx, 0, cz), facing: 0 };
  if (shopper.mesh) {
    shopper.mesh.rotation.y = 0;
    shopper.mesh.visible = false;
  }
  const cse = new THREE.Mesh(
    new THREE.BoxGeometry(0.16, 0.08, 0.28),
    new THREE.MeshStandardMaterial({ color: 0x4a3a28, roughness: 0.7, metalness: 0.15 })
  );
  cse.name = 'starter-case';
  const sp = shopper.mesh && shopper.mesh.userData && shopper.mesh.userData.parts;
  if (sp && sp.foreL) {
    cse.position.set(0.02, -0.24, 0.08);
    sp.foreL.add(cse);
  } else if (shopper.mesh) {
    cse.position.set(-0.18, 1.0, 0.1);
    shopper.mesh.add(cse);
  }
  G.starterShopper = { ped: shopper, x: cx, z: cz, t: 0 };
}

export function spawnHomeAuntie(scene) {
  if (!GAMEPLAY.homeAuntie) return;
  const door = G.world && G.world.poi && G.world.poi.safehouse;
  if (!door) return;
  const x = door.x - 2.4, z = door.z + 1.6;
  const chair = new THREE.Group();
  chair.name = 'home-chair';
  const seat = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.04, 0.42), new THREE.MeshStandardMaterial({ color: 0xd8d0c0, roughness: 0.7 }));
  seat.position.y = 0.42; chair.add(seat);
  const back = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.46, 0.04), seat.material);
  back.position.set(0, 0.65, -0.2); chair.add(back);
  for (const [sx, sz] of [[-0.16, -0.16], [0.16, -0.16], [-0.16, 0.16], [0.16, 0.16]]) {
    const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.018, 0.42, 5), new THREE.MeshStandardMaterial({ color: 0x888890, roughness: 0.5, metalness: 0.3 }));
    leg.position.set(sx, 0.21, sz); chair.add(leg);
  }
  chair.position.set(x, 0, z);
  scene.add(chair);
  const ped = spawnPed(scene, new THREE.Vector3(x, 0, z), 'local');
  recolorTorso(ped.mesh.userData.parts, 0xc45a3a, 0.7);
  ped.homeAuntie = true;
  ped.anchor = { slot: new THREE.Vector3(x, 0.42, z), facing: PI };
  ped.speed = 0;
  ped.state = 'idle';
  ped.heading = PI;
  if (ped.mesh) {
    ped.mesh.position.set(x, 0.42, z);
    ped.mesh.rotation.y = PI;
    ped.mesh.visible = false;
  }
  const paper = new THREE.Group();
  paper.name = 'home-paper';
  const sheet = new THREE.Mesh(
    new THREE.BoxGeometry(0.16, 0.02, 0.2),
    new THREE.MeshStandardMaterial({ color: 0xf5f0e4, roughness: 0.85 })
  );
  paper.add(sheet);
  const page = new THREE.Mesh(
    new THREE.BoxGeometry(0.14, 0.004, 0.18),
    new THREE.MeshStandardMaterial({ color: 0xe8e0d0, roughness: 0.9 })
  );
  page.name = 'home-paper-page';
  page.position.y = 0.014;
  paper.add(page);
  const parts = ped.mesh && ped.mesh.userData && ped.mesh.userData.parts;
  if (parts && parts.foreL) {
    paper.position.set(0.02, -0.18, 0.1);
    paper.rotation.set(-0.9, 0.2, 0.15);
    parts.foreL.add(paper);
  } else if (ped.mesh) {
    paper.position.set(-0.12, 0.72, 0.16);
    ped.mesh.add(paper);
  }
  G.homeAuntie = { ped, chair, x, z, t: 0 };
}

export function spawnStationPorter(scene) {
  if (!GAMEPLAY.stationPorter) return;
  const spawn = G.world && G.world.spawns && G.world.spawns.player;
  if (!spawn) return;
  const porters = [];
  const slots = [
    { x: spawn.x - 5.2, z: spawn.z - 2.8, facing: 0, kind: 'laborer' },
    { x: spawn.x + 5.6, z: spawn.z - 2.6, facing: 0, kind: 'laborer' },
  ];
  for (let i = 0; i < slots.length; i++) {
    const slot = slots[i];
    const ped = spawnPed(scene, new THREE.Vector3(slot.x, 0, slot.z), slot.kind);
    recolorTorso(ped.mesh.userData.parts, 0xc03030, 0.7);
    ped.stationPorter = true;
    ped.speed = 0;
    ped.state = 'idle';
    ped.heading = slot.facing;
    ped.anchor = { slot: new THREE.Vector3(slot.x, 0, slot.z), facing: slot.facing };
    if (ped.mesh) {
      ped.mesh.rotation.y = slot.facing;
      ped.mesh.visible = false;
    }
    const bag = new THREE.Group();
    bag.name = 'station-bag';
    const body = new THREE.Mesh(
      new THREE.BoxGeometry(0.18, 0.22, 0.12),
      new THREE.MeshStandardMaterial({ color: i === 0 ? 0x2a4a8a : 0xffcf4a, roughness: 0.65 })
    );
    bag.add(body);
    const handle = new THREE.Mesh(
      new THREE.BoxGeometry(0.1, 0.04, 0.02),
      new THREE.MeshStandardMaterial({ color: 0x2a2a32, roughness: 0.5 })
    );
    handle.position.y = 0.14;
    bag.add(handle);
    const parts = ped.mesh && ped.mesh.userData && ped.mesh.userData.parts;
    if (parts && parts.foreR) {
      bag.position.set(0.02, -0.22, 0.08);
      parts.foreR.add(bag);
    } else if (ped.mesh) {
      bag.position.set(0.22, 1.05, 0.12);
      ped.mesh.add(bag);
    }
    ped._bag = bag;
    porters.push(ped);
  }
  G.stationPorter = { porters, x: spawn.x, z: spawn.z, t: 0 };
  const sitters = [];
  const sitSlots = [
    { x: spawn.x - 2.4, z: spawn.z + 2.6, facing: PI, kind: 'office' },
    { x: spawn.x + 2.2, z: spawn.z + 2.8, facing: PI, kind: 'local' },
  ];
  for (let i = 0; i < sitSlots.length; i++) {
    const slot = sitSlots[i];
    const chair = new THREE.Group();
    chair.name = 'station-chair';
    const seat = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.04, 0.42), new THREE.MeshStandardMaterial({ color: 0xd8d0c0, roughness: 0.7 }));
    seat.position.y = 0.42; chair.add(seat);
    const back = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.46, 0.04), seat.material);
    back.position.set(0, 0.65, -0.2); chair.add(back);
    for (const [sx, sz] of [[-0.16, -0.16], [0.16, -0.16], [-0.16, 0.16], [0.16, 0.16]]) {
      const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.018, 0.42, 5), new THREE.MeshStandardMaterial({ color: 0x888890, roughness: 0.5, metalness: 0.3 }));
      leg.position.set(sx, 0.21, sz); chair.add(leg);
    }
    chair.position.set(slot.x, 0, slot.z);
    scene.add(chair);
    const ped = spawnPed(scene, new THREE.Vector3(slot.x, 0, slot.z), slot.kind);
    ped.stationPorter = true;
    ped.stationSit = true;
    ped.speed = 0;
    ped.state = 'idle';
    ped.heading = slot.facing;
    ped.anchor = { slot: new THREE.Vector3(slot.x, 0.42, slot.z), facing: slot.facing };
    if (ped.mesh) {
      ped.mesh.position.set(slot.x, 0.42, slot.z);
      ped.mesh.rotation.y = slot.facing;
      ped.mesh.visible = false;
    }
    const phone = new THREE.Mesh(
      new THREE.BoxGeometry(0.05, 0.09, 0.01),
      new THREE.MeshStandardMaterial({ color: 0x1a1a22, roughness: 0.4, emissive: 0x4a8aff, emissiveIntensity: 0.2 })
    );
    phone.name = 'station-phone';
    const parts = ped.mesh && ped.mesh.userData && ped.mesh.userData.parts;
    if (parts && parts.foreR) {
      phone.position.set(0.02, -0.26, 0.06);
      parts.foreR.add(phone);
    } else if (ped.mesh) {
      phone.position.set(0.2, 0.95, 0.12);
      ped.mesh.add(phone);
    }
    ped._phone = phone;
    sitters.push(ped);
  }
  G.stationSit = { sitters, x: spawn.x, z: spawn.z, t: 0 };
}

export function spawnGarageMech(scene) {
  if (!GAMEPLAY.garageMech) return;
  const g = G.world && G.world.garages && G.world.garages[0];
  if (!g || !g.pos) return;
  const x = g.pos.x + 5.4, z = g.pos.z - 4.8;
  const ped = spawnPed(scene, new THREE.Vector3(x, 0, z), 'laborer');
  recolorTorso(ped.mesh.userData.parts, 0xc45a18, 0.7);
  ped.garageMech = true;
  ped.speed = 0;
  ped.state = 'idle';
  ped.heading = -PI / 2;
  ped.anchor = { slot: new THREE.Vector3(x, 0, z), facing: -PI / 2 };
  if (ped.mesh) {
    ped.mesh.rotation.y = -PI / 2;
    ped.mesh.visible = false;
  }
  const wrench = new THREE.Mesh(
    new THREE.BoxGeometry(0.04, 0.04, 0.28),
    new THREE.MeshStandardMaterial({ color: 0x888890, metalness: 0.5, roughness: 0.35 })
  );
  wrench.name = 'garage-wrench';
  const parts = ped.mesh && ped.mesh.userData && ped.mesh.userData.parts;
  if (parts && parts.foreR) {
    wrench.position.set(0.02, -0.22, 0.08);
    parts.foreR.add(wrench);
  } else if (ped.mesh) {
    wrench.position.set(0.22, 1.05, 0.12);
    ped.mesh.add(wrench);
  }
  G.garageMech = { ped, x, z, t: 0 };
  const cx = g.pos.x + 2.8, cz = g.pos.z - 6.6;
  const wait = spawnPed(scene, new THREE.Vector3(cx, 0, cz), 'office');
  wait.garageMech = true;
  wait.garageWait = true;
  wait.speed = 0;
  wait.state = 'idle';
  wait.heading = 0;
  wait.anchor = { slot: new THREE.Vector3(cx, 0, cz), facing: 0 };
  if (wait.mesh) {
    wait.mesh.rotation.y = 0;
    wait.mesh.visible = false;
  }
  const helm = new THREE.Mesh(
    new THREE.BoxGeometry(0.12, 0.08, 0.14),
    new THREE.MeshStandardMaterial({ color: 0x1a1a22, roughness: 0.45, metalness: 0.3 })
  );
  helm.name = 'garage-helmet';
  const wp = wait.mesh && wait.mesh.userData && wait.mesh.userData.parts;
  if (wp && wp.foreL) {
    helm.position.set(0.02, -0.24, 0.06);
    wp.foreL.add(helm);
  } else if (wait.mesh) {
    helm.position.set(-0.18, 1.0, 0.1);
    wait.mesh.add(helm);
  }
  G.garageWait = { ped: wait, x: cx, z: cz, t: 0 };
}

export function spawnKlongDock(scene) {
  if (!GAMEPLAY.klongDock) return;
  const poi = G.world && G.world.poi && G.world.poi.klongToey;
  if (!poi) return;
  const hands = [];
  const slots = [
    { x: poi.x - 4.2, z: poi.z - 3.1, facing: PI, kind: 'laborer' },
    { x: poi.x + 5.1, z: poi.z - 2.6, facing: -PI / 2, kind: 'laborer' },
  ];
  for (let i = 0; i < slots.length; i++) {
    const slot = slots[i];
    const ped = spawnPed(scene, new THREE.Vector3(slot.x, 0, slot.z), slot.kind);
    recolorTorso(ped.mesh.userData.parts, 0xe8b020, 0.7);
    ped.klongDock = true;
    ped.speed = 0;
    ped.state = 'idle';
    ped.heading = slot.facing;
    ped.anchor = { slot: new THREE.Vector3(slot.x, 0, slot.z), facing: slot.facing };
    if (ped.mesh) {
      ped.mesh.rotation.y = slot.facing;
      ped.mesh.visible = false;
    }
    const crate = new THREE.Mesh(
      new THREE.BoxGeometry(0.22, 0.16, 0.18),
      new THREE.MeshStandardMaterial({ color: i === 0 ? 0xb45a2a : 0x3a6a8a, roughness: 0.7, metalness: 0.2 })
    );
    crate.name = 'dock-crate';
    const parts = ped.mesh && ped.mesh.userData && ped.mesh.userData.parts;
    if (parts && parts.foreR) {
      crate.position.set(0.02, -0.22, 0.1);
      parts.foreR.add(crate);
    } else if (ped.mesh) {
      crate.position.set(0.22, 1.05, 0.12);
      ped.mesh.add(crate);
    }
    hands.push(ped);
  }
  G.klongDock = { hands, x: poi.x, z: poi.z, t: 0 };
  const cx = poi.x + 1.6, cz = poi.z + 5.8;
  const check = spawnPed(scene, new THREE.Vector3(cx, 0, cz), 'office');
  recolorTorso(check.mesh.userData.parts, 0x2a4a6a, 0.7);
  check.klongDock = true;
  check.klongCheck = true;
  check.speed = 0;
  check.state = 'idle';
  check.heading = PI;
  check.anchor = { slot: new THREE.Vector3(cx, 0, cz), facing: PI };
  if (check.mesh) {
    check.mesh.rotation.y = PI;
    check.mesh.visible = false;
  }
  const clip = new THREE.Mesh(
    new THREE.BoxGeometry(0.12, 0.16, 0.02),
    new THREE.MeshStandardMaterial({ color: 0xf0ead8, roughness: 0.7 })
  );
  clip.name = 'klong-clip';
  const cp = check.mesh && check.mesh.userData && check.mesh.userData.parts;
  if (cp && cp.foreL) {
    clip.position.set(0.02, -0.22, 0.06);
    cp.foreL.add(clip);
  } else if (check.mesh) {
    clip.position.set(-0.18, 1.0, 0.1);
    check.mesh.add(clip);
  }
  G.klongCheck = { ped: check, x: cx, z: cz, t: 0 };
}

export function spawnSengClerk(scene) {
  if (!GAMEPLAY.sengClerk) return;
  const poi = G.world && G.world.poi && G.world.poi.goldShop;
  if (!poi) return;
  const x = poi.x, z = poi.z + 5.2;
  const ped = spawnPed(scene, new THREE.Vector3(x, 0, z), 'laborer');
  recolorTorso(ped.mesh.userData.parts, 0x8a2020, 0.7);
  ped.sengClerk = true;
  ped.speed = 0;
  ped.state = 'idle';
  ped.heading = PI;
  ped.anchor = { slot: new THREE.Vector3(x, 0, z), facing: PI };
  if (ped.mesh) {
    ped.mesh.rotation.y = PI;
    ped.mesh.visible = false;
  }
  const tray = new THREE.Mesh(
    new THREE.BoxGeometry(0.16, 0.02, 0.1),
    new THREE.MeshStandardMaterial({ color: 0xffcf4a, metalness: 0.65, roughness: 0.28 })
  );
  tray.name = 'seng-tray';
  const parts = ped.mesh && ped.mesh.userData && ped.mesh.userData.parts;
  if (parts && parts.foreR) {
    tray.position.set(0.02, -0.22, 0.08);
    parts.foreR.add(tray);
  } else if (ped.mesh) {
    tray.position.set(0.22, 1.05, 0.12);
    ped.mesh.add(tray);
  }
  G.sengClerk = { ped, x, z, t: 0 };
  const cx = x + 1.55, cz = z + 0.85;
  const shopper = spawnPed(scene, new THREE.Vector3(cx, 0, cz), 'office');
  shopper.sengClerk = true;
  shopper.sengShop = true;
  shopper.speed = 0;
  shopper.state = 'idle';
  shopper.heading = PI;
  shopper.anchor = { slot: new THREE.Vector3(cx, 0, cz), facing: PI };
  if (shopper.mesh) {
    shopper.mesh.rotation.y = PI;
    shopper.mesh.visible = false;
  }
  const chain = new THREE.Mesh(
    new THREE.TorusGeometry(0.04, 0.008, 6, 10),
    new THREE.MeshStandardMaterial({ color: 0xffcf4a, metalness: 0.7, roughness: 0.28 })
  );
  chain.name = 'seng-chain';
  const sp = shopper.mesh && shopper.mesh.userData && shopper.mesh.userData.parts;
  if (sp && sp.foreL) {
    chain.position.set(0.02, -0.24, 0.06);
    sp.foreL.add(chain);
  } else if (shopper.mesh) {
    chain.position.set(-0.18, 1.0, 0.1);
    shopper.mesh.add(chain);
  }
  G.sengShopper = { ped: shopper, x: cx, z: cz, t: 0 };
}

export function spawnAirportCrew(scene) {
  if (!GAMEPLAY.airportCrew) return;
  const poi = G.world && G.world.poi && G.world.poi.suvarnabhumi;
  if (!poi) return;
  const hands = [];
  const slots = [
    { x: poi.x - 3.5, z: poi.z - 6.2, facing: PI / 2, kind: 'laborer' },
    { x: poi.x - 3.5, z: poi.z + 7.4, facing: PI / 2, kind: 'laborer' },
  ];
  for (let i = 0; i < slots.length; i++) {
    const slot = slots[i];
    const ped = spawnPed(scene, new THREE.Vector3(slot.x, 0, slot.z), slot.kind);
    recolorTorso(ped.mesh.userData.parts, 0xff6a00, 0.7);
    ped.airportCrew = true;
    ped.speed = 0;
    ped.state = 'idle';
    ped.heading = slot.facing;
    ped.anchor = { slot: new THREE.Vector3(slot.x, 0, slot.z), facing: slot.facing };
    if (ped.mesh) {
      ped.mesh.rotation.y = slot.facing;
      ped.mesh.visible = false;
    }
    const paddle = new THREE.Mesh(
      new THREE.BoxGeometry(0.05, 0.28, 0.08),
      new THREE.MeshStandardMaterial({ color: 0xff6a00, roughness: 0.55, emissive: 0x401000, emissiveIntensity: 0.25 })
    );
    paddle.name = 'marshal-paddle';
    const parts = ped.mesh && ped.mesh.userData && ped.mesh.userData.parts;
    if (parts && parts.foreR) {
      paddle.position.set(0.02, -0.28, 0.08);
      parts.foreR.add(paddle);
    } else if (ped.mesh) {
      paddle.position.set(0.22, 1.15, 0.12);
      ped.mesh.add(paddle);
    }
    hands.push(ped);
  }
  G.airportCrew = { hands, x: poi.x, z: poi.z, t: 0 };
}

export function spawnAirportCargo(scene) {
  if (!GAMEPLAY.airportCargo) return;
  if (!G.world || !G.world.airport) return;
  const sx = 209, sz = -118;
  const hands = [];
  const slots = [
    { x: sx + 7.4, z: sz - 3.2, facing: -PI / 2, kind: 'laborer' },
    { x: sx + 7.4, z: sz + 4.1, facing: -PI / 2, kind: 'laborer' },
  ];
  for (let i = 0; i < slots.length; i++) {
    const slot = slots[i];
    const ped = spawnPed(scene, new THREE.Vector3(slot.x, 0, slot.z), slot.kind);
    recolorTorso(ped.mesh.userData.parts, 0x3a6a8a, 0.7);
    ped.airportCargo = true;
    ped.speed = 0;
    ped.state = 'idle';
    ped.heading = slot.facing;
    ped.anchor = { slot: new THREE.Vector3(slot.x, 0, slot.z), facing: slot.facing };
    if (ped.mesh) {
      ped.mesh.rotation.y = slot.facing;
      ped.mesh.visible = false;
    }
    const crate = new THREE.Mesh(
      new THREE.BoxGeometry(0.24, 0.18, 0.2),
      new THREE.MeshStandardMaterial({ color: i === 0 ? 0xc8a22a : 0xb45a2a, roughness: 0.7, metalness: 0.15 })
    );
    crate.name = 'cargo-crate';
    const parts = ped.mesh && ped.mesh.userData && ped.mesh.userData.parts;
    if (parts && parts.foreR) {
      crate.position.set(0.02, -0.24, 0.1);
      parts.foreR.add(crate);
    } else if (ped.mesh) {
      crate.position.set(0.22, 1.05, 0.12);
      ped.mesh.add(crate);
    }
    hands.push(ped);
  }
  G.airportCargo = { hands, x: sx, z: sz, t: 0 };
}

export function spawnAirportTower(scene) {
  if (!GAMEPLAY.airportTower) return;
  const poi = G.world && G.world.poi && G.world.poi.airportTower;
  if (!poi) return;
  const x = poi.x + 4.8, z = poi.z;
  const ped = spawnPed(scene, new THREE.Vector3(x, 0, z), 'office');
  recolorTorso(ped.mesh.userData.parts, 0x1a3a6a, 0.7);
  ped.airportTower = true;
  ped.speed = 0;
  ped.state = 'idle';
  ped.heading = PI / 2;
  ped.anchor = { slot: new THREE.Vector3(x, 0, z), facing: PI / 2 };
  if (ped.mesh) {
    ped.mesh.rotation.y = PI / 2;
    ped.mesh.visible = false;
  }
  const binocs = new THREE.Group();
  binocs.name = 'tower-binocs';
  const mat = new THREE.MeshStandardMaterial({ color: 0x2a2a32, roughness: 0.45, metalness: 0.35 });
  for (const ox of [-0.035, 0.035]) {
    const tube = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.026, 0.16, 8), mat);
    tube.rotation.x = PI / 2;
    tube.position.x = ox;
    binocs.add(tube);
  }
  const bridge = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.018, 0.03), mat);
  binocs.add(bridge);
  const parts = ped.mesh && ped.mesh.userData && ped.mesh.userData.parts;
  if (parts && parts.foreR) {
    binocs.position.set(0.02, -0.22, 0.1);
    parts.foreR.add(binocs);
  } else if (ped.mesh) {
    binocs.position.set(0.22, 1.15, 0.12);
    ped.mesh.add(binocs);
  }
  G.towerCtl = { ped, x, z, t: 0 };
}

export function spawnAirportTaxi(scene) {
  if (!GAMEPLAY.airportTaxi) return;
  if (!G.world || !G.world.airport) return;
  const pack = (cx, cz) => {
    const touts = [];
    const slots = [
      { x: cx + 6.4, z: cz - 2.2, facing: PI / 2, kind: 'laborer' },
      { x: cx + 6.4, z: cz + 2.4, facing: PI / 2, kind: 'laborer' },
    ];
    for (let i = 0; i < slots.length; i++) {
      const slot = slots[i];
      const ped = spawnPed(scene, new THREE.Vector3(slot.x, 0, slot.z), slot.kind);
      recolorTorso(ped.mesh.userData.parts, 0xe8c020, 0.7);
      ped.airportTaxi = true;
      ped.speed = 0;
      ped.state = 'idle';
      ped.heading = slot.facing;
      ped.anchor = { slot: new THREE.Vector3(slot.x, 0, slot.z), facing: slot.facing };
      if (ped.mesh) {
        ped.mesh.rotation.y = slot.facing;
        ped.mesh.visible = false;
      }
      const slate = new THREE.Mesh(
        new THREE.BoxGeometry(0.12, 0.16, 0.02),
        new THREE.MeshStandardMaterial({ color: 0xf0ead8, roughness: 0.7 })
      );
      slate.name = 'taxi-slate';
      const parts = ped.mesh && ped.mesh.userData && ped.mesh.userData.parts;
      if (parts && parts.foreR) {
        slate.position.set(0.02, -0.22, 0.08);
        parts.foreR.add(slate);
      } else if (ped.mesh) {
        slate.position.set(0.22, 1.05, 0.12);
        ped.mesh.add(slate);
      }
      touts.push(ped);
    }
    return { touts, x: cx, z: cz, t: 0 };
  };
  G.airportTaxi = pack(209, 50);
  G.southAirportTaxi = pack(209, -50);
  const bx = 209 - 6.4, bz = 0;
  const hands = [];
  const bagSlots = [
    { x: bx, z: bz - 2.2, facing: PI / 2 },
    { x: bx, z: bz + 2.4, facing: PI / 2 },
  ];
  for (let i = 0; i < bagSlots.length; i++) {
    const slot = bagSlots[i];
    const ped = spawnPed(scene, new THREE.Vector3(slot.x, 0, slot.z), 'laborer');
    recolorTorso(ped.mesh.userData.parts, 0x2a5a8a, 0.7);
    ped.airportTaxi = true;
    ped.airportBags = true;
    ped.speed = 0;
    ped.state = 'idle';
    ped.heading = slot.facing;
    ped.anchor = { slot: new THREE.Vector3(slot.x, 0, slot.z), facing: slot.facing };
    if (ped.mesh) {
      ped.mesh.rotation.y = slot.facing;
      ped.mesh.visible = false;
    }
    const cse = new THREE.Mesh(
      new THREE.BoxGeometry(0.18, 0.14, 0.28),
      new THREE.MeshStandardMaterial({ color: i === 0 ? 0xc8a22a : 0x3a3a44, roughness: 0.65, metalness: 0.15 })
    );
    cse.name = 'bag-case';
    const parts = ped.mesh && ped.mesh.userData && ped.mesh.userData.parts;
    if (parts && parts.foreR) {
      cse.position.set(0.02, -0.24, 0.1);
      parts.foreR.add(cse);
    } else if (ped.mesh) {
      cse.position.set(0.22, 1.05, 0.12);
      ped.mesh.add(cse);
    }
    hands.push(ped);
  }
  G.airportBags = { hands, x: 209, z: 0, t: 0 };
}

export function spawnMallDirectory(scene) {
  if (!GAMEPLAY.mallDir) return;
  const mall = G.world && G.world.mall;
  if (!mall || !mall.center) return;
  const x = mall.center.x, z = mall.center.z - 4;
  const g = new THREE.Group();
  g.name = 'mall-directory';
  const board = new THREE.Mesh(
    new THREE.BoxGeometry(1.15, 0.72, 0.08),
    new THREE.MeshStandardMaterial({ color: 0x1a2230, roughness: 0.45 })
  );
  board.position.y = 1.28;
  g.add(board);
  const screen = new THREE.Mesh(
    new THREE.BoxGeometry(1.02, 0.58, 0.04),
    new THREE.MeshStandardMaterial({ color: 0x88e0ff, emissive: 0x226688, emissiveIntensity: 0.4, roughness: 0.3 })
  );
  screen.name = 'mall-dir-screen';
  screen.position.set(0, 1.28, 0.05);
  g.add(screen);
  g.position.set(x, 0, z);
  g.rotation.y = PI;
  scene.add(g);
  const clerk = spawnPed(scene, new THREE.Vector3(x - 1.6, 0, z + 1.35), 'office');
  clerk.mallDir = true;
  clerk.anchor = { slot: new THREE.Vector3(x - 1.6, 0, z + 1.35), facing: PI };
  clerk.speed = 0;
  clerk.state = 'idle';
  clerk.heading = PI;
  if (clerk.mesh) clerk.mesh.rotation.y = PI;
  G.mallDir = { mesh: g, screen, clerk, x, z, t: 0, idx: 0 };
}

export function spawnMallFood(scene) {
  if (!GAMEPLAY.mallFood) return;
  const mall = G.world && G.world.mall;
  const shop = mall && (mall.shops || []).find(s => s && s.name === 'Pier 21 Food Court');
  if (!shop || !shop.pos) return;
  const x = shop.pos.x, z = shop.pos.z;
  const table = new THREE.Group();
  table.name = 'mall-food-table';
  const top = new THREE.Mesh(
    new THREE.CylinderGeometry(0.55, 0.55, 0.05, 10),
    new THREE.MeshStandardMaterial({ color: 0xd8c8b0, roughness: 0.7 })
  );
  top.position.y = 0.72;
  table.add(top);
  const pole = new THREE.Mesh(
    new THREE.CylinderGeometry(0.04, 0.05, 0.7, 8),
    new THREE.MeshStandardMaterial({ color: 0x888890, roughness: 0.5, metalness: 0.3 })
  );
  pole.position.y = 0.35;
  table.add(pole);
  table.position.set(x, 0, z);
  scene.add(table);
  const slots = [
    { x: x - 0.7, z: z + 0.15, facing: PI / 2, kind: 'office' },
    { x: x + 0.7, z: z - 0.1, facing: -PI / 2, kind: 'tourist' },
    { x: x + 0.05, z: z - 0.75, facing: 0, kind: 'local' },
  ];
  const eaters = [];
  for (let i = 0; i < slots.length; i++) {
    const slot = slots[i];
    const ped = spawnPed(scene, new THREE.Vector3(slot.x, 0, slot.z), slot.kind);
    ped.mallFood = true;
    ped.speed = 0;
    ped.state = 'idle';
    ped.heading = slot.facing;
    ped.anchor = { slot: new THREE.Vector3(slot.x, 0.42, slot.z), facing: slot.facing };
    if (ped.mesh) {
      ped.mesh.position.set(slot.x, 0.42, slot.z);
      ped.mesh.rotation.y = slot.facing;
      ped.mesh.visible = false;
    }
    if (i === 0 && ped.mesh) {
      const tray = new THREE.Mesh(
        new THREE.BoxGeometry(0.16, 0.02, 0.22),
        new THREE.MeshStandardMaterial({ color: 0xf0ead8, roughness: 0.6 })
      );
      tray.name = 'mall-food-tray';
      const bowl = new THREE.Mesh(
        new THREE.CylinderGeometry(0.045, 0.04, 0.04, 8),
        new THREE.MeshStandardMaterial({ color: 0xff5a3a, roughness: 0.55 })
      );
      bowl.position.y = 0.03;
      tray.add(bowl);
      const parts = ped.mesh.userData && ped.mesh.userData.parts;
      if (parts && parts.foreL) { tray.position.set(0.02, -0.22, 0.08); parts.foreL.add(tray); }
      else { tray.position.set(-0.18, 0.95, 0.12); ped.mesh.add(tray); }
    }
    eaters.push(ped);
  }
  G.mallFood = { table, eaters, x, z, t: 0 };
}

export function spawnMallTech(scene) {
  if (!GAMEPLAY.mallTech) return;
  const mall = G.world && G.world.mall;
  const shop = mall && (mall.shops || []).find(s => s && s.name === 'Tokyo Tech');
  if (!shop || !shop.pos) return;
  const x = shop.pos.x, z = shop.pos.z;
  const lookers = [];
  const slots = [
    { x: x - 0.7, z: z + 0.1, facing: 0, kind: 'tourist' },
    { x: x + 0.65, z: z - 0.15, facing: 0.15, kind: 'office' },
  ];
  for (let i = 0; i < slots.length; i++) {
    const slot = slots[i];
    const ped = spawnPed(scene, new THREE.Vector3(slot.x, 0, slot.z), slot.kind);
    ped.mallTech = true;
    ped.speed = 0;
    ped.state = 'idle';
    ped.heading = slot.facing;
    ped.anchor = { slot: new THREE.Vector3(slot.x, 0, slot.z), facing: slot.facing };
    if (ped.mesh) {
      ped.mesh.rotation.y = slot.facing;
      ped.mesh.visible = false;
    }
    const phone = new THREE.Mesh(
      new THREE.BoxGeometry(0.05, 0.09, 0.012),
      new THREE.MeshStandardMaterial({ color: 0x1a1a22, emissive: 0x226688, emissiveIntensity: 0.35, roughness: 0.35 })
    );
    phone.name = 'mall-tech-phone';
    const parts = ped.mesh && ped.mesh.userData && ped.mesh.userData.parts;
    if (parts && parts.foreL) {
      phone.position.set(0.02, -0.22, 0.08);
      parts.foreL.add(phone);
    } else if (ped.mesh) {
      phone.position.set(-0.16, 1.05, 0.14);
      ped.mesh.add(phone);
    }
    ped._phone = phone;
    lookers.push(ped);
  }
  G.mallTech = { lookers, x, z, t: 0 };
}

export function spawnMallPharm(scene) {
  if (!GAMEPLAY.mallPharm) return;
  const mall = G.world && G.world.mall;
  const shop = mall && (mall.shops || []).find(s => s && s.name === 'Paris Pharmacy');
  if (!shop || !shop.pos) return;
  const x = shop.pos.x, z = shop.pos.z;
  const clerk = spawnPed(scene, new THREE.Vector3(x + 1.55, 0, z), 'office');
  recolorTorso(clerk.mesh.userData.parts, 0xe8f0ea, 0.75);
  clerk.mallPharm = true;
  clerk.pharmRole = 'clerk';
  clerk.speed = 0;
  clerk.state = 'idle';
  clerk.heading = -PI / 2;
  clerk.anchor = { slot: new THREE.Vector3(x + 1.55, 0, z), facing: -PI / 2 };
  if (clerk.mesh) {
    clerk.mesh.rotation.y = -PI / 2;
    clerk.mesh.visible = false;
  }
  const customer = spawnPed(scene, new THREE.Vector3(x - 0.15, 0, z + 0.12), 'local');
  customer.mallPharm = true;
  customer.pharmRole = 'customer';
  customer.speed = 0;
  customer.state = 'idle';
  customer.heading = PI / 2;
  customer.anchor = { slot: new THREE.Vector3(x - 0.15, 0, z + 0.12), facing: PI / 2 };
  if (customer.mesh) {
    customer.mesh.rotation.y = PI / 2;
    customer.mesh.visible = false;
  }
  const bag = new THREE.Group();
  bag.name = 'mall-pharm-bag';
  const paper = new THREE.Mesh(
    new THREE.BoxGeometry(0.12, 0.16, 0.06),
    new THREE.MeshStandardMaterial({ color: 0xf4f0e8, roughness: 0.8 })
  );
  bag.add(paper);
  const cross = new THREE.Mesh(
    new THREE.BoxGeometry(0.08, 0.03, 0.01),
    new THREE.MeshStandardMaterial({ color: 0xc03030, roughness: 0.55 })
  );
  cross.position.set(0, 0.02, 0.035);
  bag.add(cross);
  const parts = customer.mesh && customer.mesh.userData && customer.mesh.userData.parts;
  if (parts && parts.foreL) {
    bag.position.set(0.02, -0.22, 0.08);
    parts.foreL.add(bag);
  } else if (customer.mesh) {
    bag.position.set(-0.16, 0.95, 0.12);
    customer.mesh.add(bag);
  }
  customer._bag = bag;
  G.mallPharm = { clerk, customer, x, z, t: 0 };
}

export function spawnMallRoma(scene) {
  if (!GAMEPLAY.mallRoma) return;
  const mall = G.world && G.world.mall;
  const shop = mall && (mall.shops || []).find(s => s && s.name === 'Roma Boutique');
  if (!shop || !shop.pos) return;
  const x = shop.pos.x, z = shop.pos.z;
  const clerk = spawnPed(scene, new THREE.Vector3(x - 1.55, 0, z), 'office');
  recolorTorso(clerk.mesh.userData.parts, 0xc45a7a, 0.7);
  clerk.mallRoma = true;
  clerk.romaRole = 'clerk';
  clerk.speed = 0;
  clerk.state = 'idle';
  clerk.heading = PI / 2;
  clerk.anchor = { slot: new THREE.Vector3(x - 1.55, 0, z), facing: PI / 2 };
  if (clerk.mesh) {
    clerk.mesh.rotation.y = PI / 2;
    clerk.mesh.visible = false;
  }
  const customer = spawnPed(scene, new THREE.Vector3(x + 0.15, 0, z - 0.12), 'tourist');
  customer.mallRoma = true;
  customer.romaRole = 'customer';
  customer.speed = 0;
  customer.state = 'idle';
  customer.heading = -PI / 2;
  customer.anchor = { slot: new THREE.Vector3(x + 0.15, 0, z - 0.12), facing: -PI / 2 };
  if (customer.mesh) {
    customer.mesh.rotation.y = -PI / 2;
    customer.mesh.visible = false;
  }
  const bag = new THREE.Group();
  bag.name = 'mall-roma-bag';
  const paper = new THREE.Mesh(
    new THREE.BoxGeometry(0.14, 0.18, 0.05),
    new THREE.MeshStandardMaterial({ color: 0xff2a86, roughness: 0.7 })
  );
  bag.add(paper);
  const handle = new THREE.Mesh(
    new THREE.BoxGeometry(0.1, 0.06, 0.012),
    new THREE.MeshStandardMaterial({ color: 0x2a2a32, roughness: 0.55 })
  );
  handle.position.y = 0.12;
  bag.add(handle);
  const parts = customer.mesh && customer.mesh.userData && customer.mesh.userData.parts;
  if (parts && parts.foreL) {
    bag.position.set(0.02, -0.22, 0.08);
    parts.foreL.add(bag);
  } else if (customer.mesh) {
    bag.position.set(-0.16, 0.95, 0.12);
    customer.mesh.add(bag);
  }
  customer._bag = bag;
  G.mallRoma = { clerk, customer, x, z, t: 0 };
}

export function spawnMallWatch(scene) {
  if (!GAMEPLAY.mallWatch) return;
  const mall = G.world && G.world.mall;
  const shop = mall && (mall.shops || []).find(s => s && s.name === 'Watch Boutique');
  if (!shop || !shop.pos) return;
  const x = shop.pos.x, z = shop.pos.z, y = shop.pos.y || 10;
  const clerk = spawnPed(scene, new THREE.Vector3(x + 1.55, 0, z), 'office');
  recolorTorso(clerk.mesh.userData.parts, 0x2a4a3a, 0.7);
  clerk.mallWatch = true;
  clerk.watchRole = 'clerk';
  clerk.speed = 0;
  clerk.state = 'idle';
  clerk.heading = -PI / 2;
  clerk.anchor = { slot: new THREE.Vector3(x + 1.55, y, z), facing: -PI / 2 };
  if (clerk.mesh) {
    clerk.mesh.position.y = y;
    clerk.mesh.rotation.y = -PI / 2;
    clerk.mesh.visible = false;
  }
  const customer = spawnPed(scene, new THREE.Vector3(x - 0.15, 0, z + 0.12), 'tourist');
  customer.mallWatch = true;
  customer.watchRole = 'customer';
  customer.speed = 0;
  customer.state = 'idle';
  customer.heading = PI / 2;
  customer.anchor = { slot: new THREE.Vector3(x - 0.15, y, z + 0.12), facing: PI / 2 };
  if (customer.mesh) {
    customer.mesh.position.y = y;
    customer.mesh.rotation.y = PI / 2;
    customer.mesh.visible = false;
  }
  const tray = new THREE.Group();
  tray.name = 'mall-watch-tray';
  const pad = new THREE.Mesh(
    new THREE.BoxGeometry(0.16, 0.02, 0.1),
    new THREE.MeshStandardMaterial({ color: 0x1a3a28, roughness: 0.7 })
  );
  tray.add(pad);
  const face = new THREE.Mesh(
    new THREE.CylinderGeometry(0.03, 0.03, 0.012, 10),
    new THREE.MeshStandardMaterial({ color: 0xd9a134, metalness: 0.55, roughness: 0.35, emissive: 0x886622, emissiveIntensity: 0.2 })
  );
  face.name = 'mall-watch-face';
  face.rotation.x = PI / 2;
  face.position.y = 0.02;
  tray.add(face);
  const parts = clerk.mesh && clerk.mesh.userData && clerk.mesh.userData.parts;
  if (parts && parts.foreR) {
    tray.position.set(0.02, -0.22, 0.08);
    parts.foreR.add(tray);
  } else if (clerk.mesh) {
    tray.position.set(0.22, 1.05, 0.12);
    clerk.mesh.add(tray);
  }
  clerk._tray = tray;
  G.mallWatch = { clerk, customer, x, z, y, t: 0 };
}

export function spawnMallManga(scene) {
  if (!GAMEPLAY.mallManga) return;
  const mall = G.world && G.world.mall;
  const shop = mall && (mall.shops || []).find(s => s && s.name === 'Manga Café');
  if (!shop || !shop.pos) return;
  const x = shop.pos.x, z = shop.pos.z, y = (shop.pos.y || 5) + 0.42;
  const readers = [];
  const slots = [
    { x: x - 0.65, z: z - 0.1, facing: PI, kind: 'tourist' },
    { x: x + 0.7, z: z + 0.12, facing: PI, kind: 'office' },
  ];
  for (let i = 0; i < slots.length; i++) {
    const slot = slots[i];
    const ped = spawnPed(scene, new THREE.Vector3(slot.x, 0, slot.z), slot.kind);
    ped.mallManga = true;
    ped.speed = 0;
    ped.state = 'idle';
    ped.heading = slot.facing;
    ped.anchor = { slot: new THREE.Vector3(slot.x, y, slot.z), facing: slot.facing };
    if (ped.mesh) {
      ped.mesh.position.set(slot.x, y, slot.z);
      ped.mesh.rotation.y = slot.facing;
      ped.mesh.visible = false;
    }
    const book = new THREE.Group();
    book.name = 'mall-manga-book';
    const cover = new THREE.Mesh(
      new THREE.BoxGeometry(0.12, 0.02, 0.16),
      new THREE.MeshStandardMaterial({ color: i === 0 ? 0x21f0ff : 0xff2a86, roughness: 0.65 })
    );
    book.add(cover);
    const page = new THREE.Mesh(
      new THREE.BoxGeometry(0.1, 0.004, 0.14),
      new THREE.MeshStandardMaterial({ color: 0xf5f0e4, roughness: 0.85 })
    );
    page.name = 'mall-manga-page';
    page.position.y = 0.014;
    book.add(page);
    const parts = ped.mesh && ped.mesh.userData && ped.mesh.userData.parts;
    if (parts && parts.foreL) {
      book.position.set(0.02, -0.18, 0.1);
      book.rotation.set(-0.9, 0.2, 0.15);
      parts.foreL.add(book);
    } else if (ped.mesh) {
      book.position.set(-0.12, 0.72, 0.16);
      ped.mesh.add(book);
    }
    ped._book = book;
    readers.push(ped);
  }
  G.mallManga = { readers, x, z, y, t: 0 };
}

export function spawnMallSushi(scene) {
  if (!GAMEPLAY.mallSushi) return;
  const mall = G.world && G.world.mall;
  const shop = mall && (mall.shops || []).find(s => s && s.name === 'Sushi Bar');
  if (!shop || !shop.pos) return;
  const x = shop.pos.x, z = shop.pos.z, y = shop.pos.y || 5;
  const chef = spawnPed(scene, new THREE.Vector3(x + 1.55, 0, z), 'laborer');
  recolorTorso(chef.mesh.userData.parts, 0xf4f0e8, 0.75);
  chef.mallSushi = true;
  chef.sushiRole = 'chef';
  chef.speed = 0;
  chef.state = 'idle';
  chef.heading = -PI / 2;
  chef.anchor = { slot: new THREE.Vector3(x + 1.55, y, z), facing: -PI / 2 };
  if (chef.mesh) {
    chef.mesh.position.y = y;
    chef.mesh.rotation.y = -PI / 2;
    chef.mesh.visible = false;
  }
  const plate = new THREE.Group();
  plate.name = 'mall-sushi-plate';
  const dish = new THREE.Mesh(
    new THREE.CylinderGeometry(0.07, 0.08, 0.012, 10),
    new THREE.MeshStandardMaterial({ color: 0xf5f0e4, roughness: 0.45 })
  );
  plate.add(dish);
  const rice = new THREE.Mesh(
    new THREE.BoxGeometry(0.05, 0.018, 0.03),
    new THREE.MeshStandardMaterial({ color: 0xf8f4ea, roughness: 0.8 })
  );
  rice.position.y = 0.016;
  plate.add(rice);
  const fish = new THREE.Mesh(
    new THREE.BoxGeometry(0.06, 0.01, 0.028),
    new THREE.MeshStandardMaterial({ color: 0xff8a3a, roughness: 0.55 })
  );
  fish.name = 'mall-sushi-fish';
  fish.position.y = 0.028;
  plate.add(fish);
  const parts = chef.mesh && chef.mesh.userData && chef.mesh.userData.parts;
  if (parts && parts.foreR) {
    plate.position.set(0.02, -0.22, 0.08);
    parts.foreR.add(plate);
  } else if (chef.mesh) {
    plate.position.set(0.22, 1.05, 0.12);
    chef.mesh.add(plate);
  }
  chef._plate = plate;
  const customer = spawnPed(scene, new THREE.Vector3(x - 0.15, 0, z + 0.12), 'tourist');
  customer.mallSushi = true;
  customer.sushiRole = 'customer';
  customer.speed = 0;
  customer.state = 'idle';
  customer.heading = PI / 2;
  customer.anchor = { slot: new THREE.Vector3(x - 0.15, y, z + 0.12), facing: PI / 2 };
  if (customer.mesh) {
    customer.mesh.position.y = y;
    customer.mesh.rotation.y = PI / 2;
    customer.mesh.visible = false;
  }
  G.mallSushi = { chef, customer, x, z, y, t: 0 };
}

export function spawnMallCafe(scene) {
  if (!GAMEPLAY.mallCafe) return;
  const mall = G.world && G.world.mall;
  const shop = mall && (mall.shops || []).find(s => s && s.name === 'Le Café');
  if (!shop || !shop.pos) return;
  const x = shop.pos.x, z = shop.pos.z, y = shop.pos.y || 10;
  const clerk = spawnPed(scene, new THREE.Vector3(x - 1.55, 0, z), 'office');
  recolorTorso(clerk.mesh.userData.parts, 0x5a3a28, 0.7);
  clerk.mallCafe = true;
  clerk.cafeRole = 'clerk';
  clerk.speed = 0;
  clerk.state = 'idle';
  clerk.heading = PI / 2;
  clerk.anchor = { slot: new THREE.Vector3(x - 1.55, y, z), facing: PI / 2 };
  if (clerk.mesh) {
    clerk.mesh.position.y = y;
    clerk.mesh.rotation.y = PI / 2;
    clerk.mesh.visible = false;
  }
  const cup = new THREE.Group();
  cup.name = 'mall-cafe-cup';
  const saucer = new THREE.Mesh(
    new THREE.CylinderGeometry(0.045, 0.045, 0.008, 10),
    new THREE.MeshStandardMaterial({ color: 0xf5f0e4, roughness: 0.45 })
  );
  cup.add(saucer);
  const mug = new THREE.Mesh(
    new THREE.CylinderGeometry(0.028, 0.024, 0.04, 10),
    new THREE.MeshStandardMaterial({ color: 0xffcf4a, roughness: 0.5 })
  );
  mug.position.y = 0.024;
  cup.add(mug);
  const steam = new THREE.Mesh(
    new THREE.CylinderGeometry(0.008, 0.014, 0.05, 6),
    new THREE.MeshStandardMaterial({ color: 0xe8e4dc, emissive: 0x887766, emissiveIntensity: 0.18, transparent: true, opacity: 0.45, roughness: 1 })
  );
  steam.name = 'mall-cafe-steam';
  steam.position.y = 0.06;
  cup.add(steam);
  const parts = clerk.mesh && clerk.mesh.userData && clerk.mesh.userData.parts;
  if (parts && parts.foreR) {
    cup.position.set(0.02, -0.22, 0.08);
    parts.foreR.add(cup);
  } else if (clerk.mesh) {
    cup.position.set(0.22, 1.05, 0.12);
    clerk.mesh.add(cup);
  }
  clerk._cup = cup;
  const customer = spawnPed(scene, new THREE.Vector3(x + 0.15, 0, z - 0.12), 'tourist');
  customer.mallCafe = true;
  customer.cafeRole = 'customer';
  customer.speed = 0;
  customer.state = 'idle';
  customer.heading = -PI / 2;
  customer.anchor = { slot: new THREE.Vector3(x + 0.15, y, z - 0.12), facing: -PI / 2 };
  if (customer.mesh) {
    customer.mesh.position.y = y;
    customer.mesh.rotation.y = -PI / 2;
    customer.mesh.visible = false;
  }
  G.mallCafe = { clerk, customer, x, z, y, t: 0 };
}

export function spawnMallThreads(scene) {
  if (!GAMEPLAY.mallThreads) return;
  const mall = G.world && G.world.mall;
  const shop = mall && (mall.shops || []).find(s => s && s.name === 'London Threads');
  if (!shop || !shop.pos) return;
  const x = shop.pos.x, z = shop.pos.z, y = shop.pos.y || 10;
  const clerk = spawnPed(scene, new THREE.Vector3(x, 0, z + 1.55), 'office');
  recolorTorso(clerk.mesh.userData.parts, 0x3a2a58, 0.7);
  clerk.mallThreads = true;
  clerk.threadsRole = 'clerk';
  clerk.speed = 0;
  clerk.state = 'idle';
  clerk.heading = PI;
  clerk.anchor = { slot: new THREE.Vector3(x, y, z + 1.55), facing: PI };
  if (clerk.mesh) {
    clerk.mesh.position.y = y;
    clerk.mesh.rotation.y = PI;
    clerk.mesh.visible = false;
  }
  const hanger = new THREE.Group();
  hanger.name = 'mall-threads-hanger';
  const hook = new THREE.Mesh(
    new THREE.CylinderGeometry(0.006, 0.006, 0.08, 6),
    new THREE.MeshStandardMaterial({ color: 0x888890, roughness: 0.4, metalness: 0.45 })
  );
  hanger.add(hook);
  const bar = new THREE.Mesh(
    new THREE.BoxGeometry(0.16, 0.01, 0.02),
    new THREE.MeshStandardMaterial({ color: 0x888890, roughness: 0.4, metalness: 0.45 })
  );
  bar.position.y = -0.04;
  hanger.add(bar);
  const shirt = new THREE.Mesh(
    new THREE.BoxGeometry(0.14, 0.16, 0.03),
    new THREE.MeshStandardMaterial({ color: 0xb24bff, roughness: 0.7 })
  );
  shirt.name = 'mall-threads-shirt';
  shirt.position.y = -0.13;
  hanger.add(shirt);
  const parts = clerk.mesh && clerk.mesh.userData && clerk.mesh.userData.parts;
  if (parts && parts.foreR) {
    hanger.position.set(0.02, -0.18, 0.08);
    parts.foreR.add(hanger);
  } else if (clerk.mesh) {
    hanger.position.set(0.22, 1.05, 0.12);
    clerk.mesh.add(hanger);
  }
  clerk._hanger = hanger;
  const customer = spawnPed(scene, new THREE.Vector3(x + 0.12, 0, z - 0.15), 'tourist');
  customer.mallThreads = true;
  customer.threadsRole = 'customer';
  customer.speed = 0;
  customer.state = 'idle';
  customer.heading = 0;
  customer.anchor = { slot: new THREE.Vector3(x + 0.12, y, z - 0.15), facing: 0 };
  if (customer.mesh) {
    customer.mesh.position.y = y;
    customer.mesh.rotation.y = 0;
    customer.mesh.visible = false;
  }
  G.mallThreads = { clerk, customer, x, z, y, t: 0 };
}

export function spawnMallSeven(scene) {
  if (!GAMEPLAY.mallSeven) return;
  const mall = G.world && G.world.mall;
  const shop = mall && (mall.shops || []).find(s => s && s.name === '7-Eleven');
  if (!shop || !shop.pos) return;
  const x = shop.pos.x, z = shop.pos.z, y = shop.pos.y || 0;
  const clerk = spawnPed(scene, new THREE.Vector3(x + 1.55, 0, z), 'office');
  recolorTorso(clerk.mesh.userData.parts, 0x2a6a3a, 0.7);
  clerk.mallSeven = true;
  clerk.sevenRole = 'clerk';
  clerk.speed = 0;
  clerk.state = 'idle';
  clerk.heading = -PI / 2;
  clerk.anchor = { slot: new THREE.Vector3(x + 1.55, y, z), facing: -PI / 2 };
  if (clerk.mesh) {
    clerk.mesh.position.y = y;
    clerk.mesh.rotation.y = -PI / 2;
    clerk.mesh.visible = false;
  }
  const scan = new THREE.Mesh(
    new THREE.BoxGeometry(0.04, 0.08, 0.03),
    new THREE.MeshStandardMaterial({ color: 0x1a1a22, emissive: 0x39ff7a, emissiveIntensity: 0.25, roughness: 0.4 })
  );
  scan.name = 'mall-seven-scan';
  const parts = clerk.mesh && clerk.mesh.userData && clerk.mesh.userData.parts;
  if (parts && parts.foreR) {
    scan.position.set(0.02, -0.22, 0.08);
    parts.foreR.add(scan);
  } else if (clerk.mesh) {
    scan.position.set(0.22, 1.05, 0.12);
    clerk.mesh.add(scan);
  }
  clerk._scan = scan;
  const customer = spawnPed(scene, new THREE.Vector3(x - 0.15, 0, z + 0.12), 'local');
  customer.mallSeven = true;
  customer.sevenRole = 'customer';
  customer.speed = 0;
  customer.state = 'idle';
  customer.heading = PI / 2;
  customer.anchor = { slot: new THREE.Vector3(x - 0.15, y, z + 0.12), facing: PI / 2 };
  if (customer.mesh) {
    customer.mesh.position.y = y;
    customer.mesh.rotation.y = PI / 2;
    customer.mesh.visible = false;
  }
  const bag = new THREE.Group();
  bag.name = 'mall-seven-bag';
  const paper = new THREE.Mesh(
    new THREE.BoxGeometry(0.12, 0.16, 0.05),
    new THREE.MeshStandardMaterial({ color: 0xff7a2a, roughness: 0.7 })
  );
  bag.add(paper);
  const stripe = new THREE.Mesh(
    new THREE.BoxGeometry(0.12, 0.03, 0.012),
    new THREE.MeshStandardMaterial({ color: 0x39ff7a, roughness: 0.55 })
  );
  stripe.position.set(0, 0.02, 0.032);
  bag.add(stripe);
  const cparts = customer.mesh && customer.mesh.userData && customer.mesh.userData.parts;
  if (cparts && cparts.foreL) {
    bag.position.set(0.02, -0.22, 0.08);
    cparts.foreL.add(bag);
  } else if (customer.mesh) {
    bag.position.set(-0.16, 0.95, 0.12);
    customer.mesh.add(bag);
  }
  customer._bag = bag;
  G.mallSeven = { clerk, customer, x, z, y, t: 0 };
}

export function spawnMallArcade(scene) {
  if (!GAMEPLAY.mallArcade) return;
  const mall = G.world && G.world.mall;
  const shop = mall && (mall.shops || []).find(s => s && s.name === 'Akihabara Arcade');
  if (!shop || !shop.pos) return;
  const x = shop.pos.x, z = shop.pos.z, y = shop.pos.y || 5;
  const players = [];
  const slots = [
    { x: x - 0.35, z: z - 0.7, facing: -PI / 2, kind: 'tourist' },
    { x: x - 0.35, z: z + 0.7, facing: -PI / 2, kind: 'office' },
  ];
  for (let i = 0; i < slots.length; i++) {
    const slot = slots[i];
    const ped = spawnPed(scene, new THREE.Vector3(slot.x, 0, slot.z), slot.kind);
    ped.mallArcade = true;
    ped.speed = 0;
    ped.state = 'idle';
    ped.heading = slot.facing;
    ped.anchor = { slot: new THREE.Vector3(slot.x, y, slot.z), facing: slot.facing };
    if (ped.mesh) {
      ped.mesh.position.y = y;
      ped.mesh.rotation.y = slot.facing;
      ped.mesh.visible = false;
    }
    const stick = new THREE.Group();
    stick.name = 'mall-arcade-stick';
    const base = new THREE.Mesh(
      new THREE.BoxGeometry(0.05, 0.02, 0.05),
      new THREE.MeshStandardMaterial({ color: 0x2a2a32, roughness: 0.5 })
    );
    stick.add(base);
    const shaft = new THREE.Mesh(
      new THREE.CylinderGeometry(0.008, 0.01, 0.07, 6),
      new THREE.MeshStandardMaterial({ color: 0x888890, roughness: 0.4, metalness: 0.35 })
    );
    shaft.position.y = 0.04;
    stick.add(shaft);
    const ball = new THREE.Mesh(
      new THREE.SphereGeometry(0.016, 8, 6),
      new THREE.MeshStandardMaterial({ color: 0xff2a86, emissive: 0x882244, emissiveIntensity: 0.3, roughness: 0.45 })
    );
    ball.name = 'mall-arcade-ball';
    ball.position.y = 0.08;
    stick.add(ball);
    const parts = ped.mesh && ped.mesh.userData && ped.mesh.userData.parts;
    if (parts && parts.foreR) {
      stick.position.set(0.02, -0.22, 0.08);
      parts.foreR.add(stick);
    } else if (ped.mesh) {
      stick.position.set(0.22, 1.05, 0.12);
      ped.mesh.add(stick);
    }
    ped._stick = stick;
    players.push(ped);
  }
  G.mallArcade = { players, x, z, y, t: 0 };
}

export function spawnGymBag(scene) {
  if (!GAMEPLAY.gymBag) return;
  const gym = G.world && G.world.poi && G.world.poi.gym;
  if (!gym) return;
  const x = gym.x, z = gym.z;
  const bag = new THREE.Group();
  bag.name = 'gym-heavy-bag';
  bag.position.set(x - 1.6, 0, z - 1.35);
  const hook = new THREE.Mesh(
    new THREE.CylinderGeometry(0.02, 0.02, 0.7, 6),
    new THREE.MeshStandardMaterial({ color: 0x888890, roughness: 0.4, metalness: 0.4 })
  );
  hook.position.y = 2.15;
  bag.add(hook);
  const body = new THREE.Mesh(
    new THREE.CylinderGeometry(0.22, 0.24, 1.1, 10),
    new THREE.MeshStandardMaterial({ color: 0xc45a18, roughness: 0.7 })
  );
  body.position.y = 1.15;
  bag.add(body);
  scene.add(bag);
  const fighter = spawnPed(scene, new THREE.Vector3(x - 1.6, 0, z - 0.35), 'laborer');
  recolorTorso(fighter.mesh.userData.parts, 0x1a1a22, 0.75);
  fighter.gymBag = true;
  fighter.gymRole = 'pad';
  fighter.speed = 0;
  fighter.state = 'idle';
  fighter.heading = PI;
  fighter.anchor = { slot: new THREE.Vector3(x - 1.6, 0, z - 0.35), facing: PI };
  if (fighter.mesh) {
    fighter.mesh.rotation.y = PI;
    fighter.mesh.visible = false;
  }
  const trainer = spawnPed(scene, new THREE.Vector3(x + 1.5, 0, z + 1.2), 'office');
  trainer.gymBag = true;
  trainer.gymRole = 'watch';
  trainer.speed = 0;
  trainer.state = 'idle';
  trainer.heading = -PI / 2;
  trainer.anchor = { slot: new THREE.Vector3(x + 1.5, 0, z + 1.2), facing: -PI / 2 };
  if (trainer.mesh) {
    trainer.mesh.rotation.y = -PI / 2;
    trainer.mesh.visible = false;
  }
  G.gymBag = { bag, fighter, trainer, x, z, t: 0 };
  const cx = x + 1.6, cz = z - 1.4;
  const wait = spawnPed(scene, new THREE.Vector3(cx, 0, cz), 'laborer');
  recolorTorso(wait.mesh.userData.parts, 0x3a1a1a, 0.75);
  wait.gymBag = true;
  wait.gymWait = true;
  wait.speed = 0;
  wait.state = 'idle';
  wait.heading = -PI / 2;
  wait.anchor = { slot: new THREE.Vector3(cx, 0, cz), facing: -PI / 2 };
  if (wait.mesh) {
    wait.mesh.rotation.y = -PI / 2;
    wait.mesh.visible = false;
  }
  const wrap = new THREE.Mesh(
    new THREE.BoxGeometry(0.06, 0.04, 0.1),
    new THREE.MeshStandardMaterial({ color: 0xe8e0d0, roughness: 0.7 })
  );
  wrap.name = 'gym-wrap';
  const wp = wait.mesh && wait.mesh.userData && wait.mesh.userData.parts;
  if (wp && wp.foreL) {
    wrap.position.set(0.02, -0.22, 0.04);
    wp.foreL.add(wrap);
  } else if (wait.mesh) {
    wrap.position.set(-0.18, 1.0, 0.1);
    wait.mesh.add(wrap);
  }
  G.gymWait = { ped: wait, x: cx, z: cz, t: 0 };
}

export function spawnSevenAtm(scene) {
  if (!GAMEPLAY.sevenAtm) return;
  const pack = (ax, az, machineName) => {
    if (ax == null || az == null) return null;
    let machine = null;
    if (machineName) {
      machine = new THREE.Mesh(
        new THREE.BoxGeometry(0.7, 1.5, 0.45),
        new THREE.MeshStandardMaterial({ color: 0x1a3a6a, roughness: 0.4, metalness: 0.3 })
      );
      machine.name = machineName;
      machine.position.set(ax, 0.85, az);
      scene.add(machine);
    }
    const queue = [];
    for (let i = 0; i < 2; i++) {
      const x = ax + 1.05 + i * 0.8;
      const z = az + i * 0.18;
      const ped = spawnPed(scene, new THREE.Vector3(x, 0, z), i === 0 ? 'office' : 'local');
      ped.sevenAtm = true;
      ped.speed = 0;
      ped.state = 'idle';
      ped.heading = -PI / 2;
      ped.anchor = { slot: new THREE.Vector3(x, 0, z), facing: -PI / 2 };
      if (ped.mesh) {
        ped.mesh.rotation.y = -PI / 2;
        ped.mesh.visible = false;
      }
      if (i === 0 && ped.mesh) {
        const card = new THREE.Mesh(
          new THREE.BoxGeometry(0.08, 0.05, 0.004),
          new THREE.MeshStandardMaterial({ color: 0xc45a18, roughness: 0.45, metalness: 0.2 })
        );
        card.name = 'seven-atm-card';
        const parts = ped.mesh.userData && ped.mesh.userData.parts;
        if (parts && parts.foreR) { card.position.set(0.02, -0.28, 0.06); parts.foreR.add(card); }
        else { card.position.set(0.22, 1.05, 0.12); ped.mesh.add(card); }
        ped._atmCard = card;
      }
      queue.push(ped);
    }
    return { queue, ax, az, t: 0, machine };
  };
  const walk = G.world && G.world.sevenWalkIn;
  G.sevenAtm = walk && walk.atm ? pack(walk.atm.x, walk.atm.z, null) : null;
  const south = (G.world.sevenElevens || []).find(s => s && s.pos && Math.abs(s.pos.x) < 8 && s.pos.z < -80);
  if (south && south.pos) {
    const hz = south.hz || 4;
    G.southSevenAtm = pack(south.pos.x + 4.2, south.pos.z + hz + 1.4, 'south-seven-atm');
  }
  const west = (G.world.sevenElevens || []).find(s => s && s.pos && s.pos.x < -50 && s.pos.z > 0 && s.pos.z < 60);
  if (west && west.pos) {
    const hz = west.hz || 4;
    G.westSevenAtm = pack(west.pos.x + 4.2, west.pos.z + hz + 1.4, 'west-seven-atm');
  }
  const east = (G.world.sevenElevens || []).find(s => s && s.pos && s.pos.x > 100 && s.pos.z < 0 && s.pos.z > -80);
  if (east && east.pos) {
    const hz = east.hz || 4;
    G.eastSevenAtm = pack(east.pos.x + 4.2, east.pos.z + hz + 1.4, 'east-seven-atm');
  }
}

export function spawnSevenShoppers(scene) {
  if (!GAMEPLAY.sevenShoppers) return;
  const pack = (seven) => {
    if (!seven || !seven.pos) return null;
    const hz = seven.hz || 4;
    const doorZ = seven.pos.z + hz + 0.35;
    const curbZ = doorZ + 4.2;
    const shoppers = [];
    for (let i = 0; i < 3; i++) {
      const x = seven.pos.x + (i - 1) * 0.55;
      const ped = spawnPed(scene, new THREE.Vector3(x, 0, curbZ), i === 1 ? 'office' : 'local');
      ped.sevenShop = true;
      ped.speed = 0;
      ped.state = 'idle';
      ped._shopT = i * 0.32;
      ped._shopDir = 1;
      ped._shopX = x;
      if (ped.mesh) ped.mesh.visible = false;
      const bag = new THREE.Mesh(
        new THREE.BoxGeometry(0.14, 0.2, 0.1),
        new THREE.MeshStandardMaterial({ color: pick([0xff5a23, 0x2a2a2a, 0xf5f5f0]), roughness: 0.7 })
      );
      bag.name = 'seven-bag';
      bag.visible = false;
      const parts = ped.mesh && ped.mesh.userData && ped.mesh.userData.parts;
      if (parts && parts.foreL) { bag.position.set(0.02, -0.3, 0.04); parts.foreL.add(bag); }
      else if (ped.mesh) { bag.position.set(-0.18, 0.95, 0.08); ped.mesh.add(bag); }
      ped._sevenBag = bag;
      shoppers.push(ped);
    }
    return { shoppers, doorZ, curbZ, x: seven.pos.x, z: seven.pos.z };
  };
  G.sevenShoppers = pack(G.world && G.world.sevenWalkIn);
  const south = (G.world.sevenElevens || []).find(s => s && s.pos && Math.abs(s.pos.x) < 8 && s.pos.z < -80);
  G.southSevenShoppers = pack(south);
  const west = (G.world.sevenElevens || []).find(s => s && s.pos && s.pos.x < -50 && s.pos.z > 0 && s.pos.z < 60);
  G.westSevenShoppers = pack(west);
  const east = (G.world.sevenElevens || []).find(s => s && s.pos && s.pos.x > 100 && s.pos.z < 0 && s.pos.z > -80);
  G.eastSevenShoppers = pack(east);
}

export function spawnSevenSlush(scene) {
  if (!GAMEPLAY.sevenSlush) return;
  const seven = G.world && G.world.sevenWalkIn;
  if (!seven || !seven.pos) return;
  const hz = seven.hz || 4;
  const x = seven.pos.x + 2.55, z = seven.pos.z + hz - 1.2;
  const g = new THREE.Group();
  g.name = 'seven-slush';
  const cab = new THREE.Mesh(
    new THREE.BoxGeometry(0.62, 0.85, 0.42),
    new THREE.MeshStandardMaterial({ color: 0xe8eaee, roughness: 0.45, metalness: 0.15 })
  );
  cab.position.y = 0.48;
  g.add(cab);
  const tray = new THREE.Mesh(
    new THREE.BoxGeometry(0.56, 0.04, 0.16),
    new THREE.MeshStandardMaterial({ color: 0x2a2a30, roughness: 0.5 })
  );
  tray.position.set(0, 0.92, 0.18);
  g.add(tray);
  const colors = [0xe23a6a, 0x2ec8c0];
  for (let i = 0; i < 2; i++) {
    const tank = new THREE.Mesh(
      new THREE.CylinderGeometry(0.12, 0.12, 0.38, 10),
      new THREE.MeshStandardMaterial({
        color: colors[i], roughness: 0.25, transparent: true, opacity: 0.72,
        emissive: colors[i], emissiveIntensity: 0.18,
      })
    );
    tank.name = 'seven-slush-tank';
    tank.position.set(-0.14 + i * 0.28, 1.22, 0);
    g.add(tank);
    const lid = new THREE.Mesh(
      new THREE.CylinderGeometry(0.13, 0.13, 0.04, 10),
      new THREE.MeshStandardMaterial({ color: 0xd0d4da, roughness: 0.4, metalness: 0.2 })
    );
    lid.position.set(-0.14 + i * 0.28, 1.43, 0);
    g.add(lid);
    const spout = new THREE.Mesh(
      new THREE.BoxGeometry(0.04, 0.1, 0.08),
      new THREE.MeshStandardMaterial({ color: 0x3a3a40, roughness: 0.45, metalness: 0.3 })
    );
    spout.position.set(-0.14 + i * 0.28, 0.98, 0.16);
    g.add(spout);
  }
  g.position.set(x, 0, z);
  scene.add(g);
  const px = x - 0.7, pz = z;
  const ped = spawnPed(scene, new THREE.Vector3(px, 0, pz), 'office');
  ped.sevenSlush = true;
  ped.speed = 0;
  ped.state = 'idle';
  ped.heading = PI / 2;
  ped.anchor = { slot: new THREE.Vector3(px, 0, pz), facing: PI / 2 };
  if (ped.mesh) {
    ped.mesh.rotation.y = PI / 2;
    ped.mesh.visible = false;
  }
  const cup = new THREE.Mesh(
    new THREE.CylinderGeometry(0.04, 0.035, 0.1, 8),
    new THREE.MeshStandardMaterial({ color: 0xe23a6a, roughness: 0.4, transparent: true, opacity: 0.85 })
  );
  cup.name = 'seven-slush-cup';
  const parts = ped.mesh && ped.mesh.userData && ped.mesh.userData.parts;
  if (parts && parts.foreR) { cup.position.set(0.02, -0.26, 0.05); parts.foreR.add(cup); }
  else if (ped.mesh) { cup.position.set(0.2, 1.05, 0.1); ped.mesh.add(cup); }
  ped._slushCup = cup;
  G.sevenSlush = { mesh: g, customer: ped, x, z, t: 0 };
}

export function spawnBtsBusker(scene) {
  if (!GAMEPLAY.btsBusker) return;
  const bts = G.world && G.world.bts;
  if (!bts) return;
  const stand = (x, z, stop) => {
    const ped = spawnPed(scene, new THREE.Vector3(x, 0, z), 'local');
    ped.btsBusker = true;
    ped.stop = stop;
    ped.speed = 0;
    ped.state = 'idle';
    ped.heading = 0;
    ped.anchor = { slot: new THREE.Vector3(x, 0, z), facing: 0 };
    if (ped.mesh) {
      ped.mesh.rotation.y = 0;
      ped.mesh.visible = false;
    }
    const guitar = new THREE.Group();
    guitar.name = 'bts-guitar';
    const wood = new THREE.MeshStandardMaterial({ color: 0x8a5a28, roughness: 0.65 });
    const body = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.07, 0.34), wood);
    guitar.add(body);
    const neck = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.035, 0.4), wood);
    neck.position.z = 0.34;
    guitar.add(neck);
    const parts = ped.mesh && ped.mesh.userData && ped.mesh.userData.parts;
    if (parts && parts.foreL) {
      guitar.position.set(0.02, -0.18, 0.12);
      guitar.rotation.set(-0.4, 0.6, 0.9);
      parts.foreL.add(guitar);
    } else if (ped.mesh) {
      guitar.position.set(-0.18, 0.95, 0.18);
      ped.mesh.add(guitar);
    }
    const hat = new THREE.Mesh(
      new THREE.CylinderGeometry(0.16, 0.2, 0.06, 10),
      new THREE.MeshStandardMaterial({ color: 0x3a2a18, roughness: 0.85 })
    );
    hat.name = 'bts-busker-hat';
    hat.position.set(x + 0.45, 0.04, z + 0.35);
    scene.add(hat);
    return { ped, guitar, hat, x, z, t: 0, stop };
  };
  G.btsBusker = stand(bts.x + 4.6, -26.6, 'asok');
  G.phromBusker = stand(100 + 4.6, -26.6, 'phrom');
}

export function spawnBtsPaper(scene) {
  if (!GAMEPLAY.btsPaper) return;
  const bts = G.world && G.world.bts;
  if (!bts) return;
  const rack = (x, z, stop) => {
    const g = new THREE.Group();
    g.name = 'bts-paper-rack';
    const frame = new THREE.Mesh(
      new THREE.BoxGeometry(0.85, 1.15, 0.12),
      new THREE.MeshStandardMaterial({ color: 0x3a3a40, roughness: 0.6, metalness: 0.25 })
    );
    frame.position.y = 0.7;
    g.add(frame);
    const colors = [0xc03030, 0x1a3a6a, 0xf0ead8, 0x2a6a3a, 0xe8c04a, 0xf5f0e4];
    for (let i = 0; i < 6; i++) {
      const paper = new THREE.Mesh(
        new THREE.BoxGeometry(0.22, 0.28, 0.02),
        new THREE.MeshStandardMaterial({ color: colors[i], roughness: 0.8 })
      );
      paper.name = 'bts-paper';
      paper.position.set(-0.28 + (i % 3) * 0.28, 0.55 + Math.floor(i / 3) * 0.38, 0.08);
      g.add(paper);
    }
    g.position.set(x, 0, z);
    scene.add(g);
    const vendor = spawnPed(scene, new THREE.Vector3(x + 0.7, 0, z + 0.15), 'laborer');
    vendor.btsPaper = true;
    vendor.stop = stop;
    vendor.anchor = { slot: vendor.mesh.position.clone(), facing: PI };
    vendor.speed = 0;
    vendor.state = 'idle';
    vendor.heading = PI;
    if (vendor.mesh) vendor.mesh.rotation.y = PI;
    return { mesh: g, vendor, x, z, t: 0, stop };
  };
  G.btsPaper = rack(bts.x - 1.0, -27.8, 'asok');
  G.phromPaper = rack(100 - 1.0, -27.8, 'phrom');
}

export function spawnBtsShine(scene) {
  if (!GAMEPLAY.btsShine) return;
  const bts = G.world && G.world.bts;
  if (!bts) return;
  const stand = (x, z, stop) => {
    const g = new THREE.Group();
    g.name = 'bts-shine';
    const box = new THREE.Mesh(
      new THREE.BoxGeometry(0.55, 0.32, 0.42),
      new THREE.MeshStandardMaterial({ color: 0x6a4a28, roughness: 0.82 })
    );
    box.name = 'shine-box';
    box.position.y = 0.22;
    g.add(box);
    const tinMat = [
      new THREE.MeshStandardMaterial({ color: 0x3a2a18, roughness: 0.45, metalness: 0.25 }),
      new THREE.MeshStandardMaterial({ color: 0x1a1a1e, roughness: 0.45, metalness: 0.25 }),
    ];
    for (let i = 0; i < 2; i++) {
      const tin = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.04, 8), tinMat[i]);
      tin.name = 'shine-tin';
      tin.position.set(-0.1 + i * 0.16, 0.4, 0.04);
      g.add(tin);
    }
    const cloth = new THREE.Mesh(
      new THREE.BoxGeometry(0.14, 0.02, 0.1),
      new THREE.MeshStandardMaterial({ color: 0xc03030, roughness: 0.75 })
    );
    cloth.name = 'shine-cloth';
    cloth.position.set(0.16, 0.42, 0.02);
    g.add(cloth);
    const stool = new THREE.Mesh(
      new THREE.CylinderGeometry(0.14, 0.16, 0.08, 8),
      new THREE.MeshStandardMaterial({ color: 0x4a3a22, roughness: 0.8 })
    );
    stool.position.set(0.48, 0.22, 0);
    g.add(stool);
    g.position.set(x, 0, z);
    scene.add(g);
    const vendor = spawnPed(scene, new THREE.Vector3(x + 0.48, 0, z), 'laborer');
    vendor.btsShine = true;
    vendor.stop = stop;
    vendor.anchor = { slot: new THREE.Vector3(x + 0.48, 0.38, z), facing: -PI / 2 };
    vendor.speed = 0;
    vendor.state = 'idle';
    vendor.heading = -PI / 2;
    if (vendor.mesh) {
      vendor.mesh.position.set(x + 0.48, 0.38, z);
      vendor.mesh.rotation.y = -PI / 2;
      vendor.mesh.visible = false;
    }
    return { mesh: g, vendor, x, z, t: 0, stop };
  };
  G.btsShine = stand(bts.x + 8.4, 9.2, 'asok');
  G.phromShine = stand(100 + 8.4, 9.2, 'phrom');
}

export function spawnOfficeSmoke(scene) {
  if (!GAMEPLAY.officeSmoke) return;
  const bts = G.world && G.world.bts;
  const sx = bts ? bts.x : -50;
  const pack = (slots, stop) => {
    const smokers = [];
    for (let i = 0; i < slots.length; i++) {
      const slot = slots[i];
      const ped = spawnPed(scene, new THREE.Vector3(slot.x, 0, slot.z), 'office');
      ped.officeSmoke = true;
      ped.stop = stop;
      ped.speed = 0;
      ped.state = 'idle';
      ped.heading = slot.facing;
      ped.anchor = { slot: new THREE.Vector3(slot.x, 0, slot.z), facing: slot.facing };
      if (ped.mesh) {
        ped.mesh.rotation.y = slot.facing;
        ped.mesh.visible = false;
      }
      const cig = new THREE.Group();
      cig.name = 'office-cig';
      const stick = new THREE.Mesh(
        new THREE.CylinderGeometry(0.01, 0.01, 0.07, 6),
        new THREE.MeshStandardMaterial({ color: 0xf0ead8, roughness: 0.7 })
      );
      stick.rotation.x = PI / 2;
      cig.add(stick);
      const ember = new THREE.Mesh(
        new THREE.SphereGeometry(0.012, 6, 5),
        new THREE.MeshStandardMaterial({ color: 0xff6a18, emissive: 0xff4a10, emissiveIntensity: 0.5, roughness: 0.4 })
      );
      ember.name = 'office-cig-ember';
      ember.position.z = 0.04;
      cig.add(ember);
      const parts = ped.mesh && ped.mesh.userData && ped.mesh.userData.parts;
      if (parts && parts.foreR) { cig.position.set(0.02, -0.28, 0.06); parts.foreR.add(cig); }
      else if (ped.mesh) { cig.position.set(0.22, 1.05, 0.12); ped.mesh.add(cig); }
      ped._cig = cig;
      ped._ember = ember;
      smokers.push(ped);
    }
    return { smokers, x: slots[0].x, z: slots[0].z, t: 0, stop };
  };
  G.officeSmoke = pack([
    { x: sx - 9.2, z: 12.4, facing: PI / 2 },
    { x: sx - 10.0, z: 13.1, facing: 0 },
    { x: sx - 8.4, z: 12.8, facing: -PI / 2 },
  ], 'asok');
  G.phromSmoke = pack([
    { x: 100 - 9.2, z: 12.4, facing: PI / 2 },
    { x: 100 - 10.0, z: 13.1, facing: 0 },
    { x: 100 - 8.4, z: 12.8, facing: -PI / 2 },
  ], 'phrom');
}

export function spawnBtsSitters(scene) {
  if (!GAMEPLAY.btsSitters) return;
  const bts = G.world && G.world.bts;
  const sx = bts ? bts.x : -50;
  const PY = (bts && bts.platformY) || 13.9;
  const yAtAsok = (z) => ((z + 25) / 20) * PY;
  const yAtPhrom = (z) => ((z + 22) / 17) * PY;
  const slots = [
    { x: sx - 3.2, z: -24.4, y: 0.42, facing: PI / 2, kind: 'office', stop: 'asok' },
    { x: sx - 2.15, z: -17.2, y: yAtAsok(-17.2) + 0.42, facing: PI / 2, kind: 'tourist', stop: 'asok' },
    { x: sx + 2.15, z: -11.4, y: yAtAsok(-11.4) + 0.42, facing: -PI / 2, kind: 'office', stop: 'asok' },
    { x: 100 - 2.0, z: -21.6, y: 0.42, facing: PI / 2, kind: 'tourist', stop: 'phrom' },
    { x: 100 + 1.9, z: -14.8, y: yAtPhrom(-14.8) + 0.42, facing: -PI / 2, kind: 'office', stop: 'phrom' },
    { x: 100 - 1.9, z: -9.6, y: yAtPhrom(-9.6) + 0.42, facing: PI / 2, kind: 'local', stop: 'phrom' },
  ];
  G.btsSitters = [];
  for (const slot of slots) {
    const ped = spawnPed(scene, new THREE.Vector3(slot.x, 0, slot.z), slot.kind);
    ped.btsSit = true;
    ped.stop = slot.stop;
    ped.anchor = { slot: new THREE.Vector3(slot.x, slot.y, slot.z), facing: slot.facing };
    ped.speed = 0;
    ped.state = 'idle';
    ped.heading = slot.facing;
    ped.mesh.position.set(slot.x, slot.y, slot.z);
    ped.mesh.rotation.y = slot.facing;
    G.btsSitters.push(ped);
  }
}

function makeTurtleMesh() {
  const g = new THREE.Group();
  g.name = 'wat-turtle';
  const shell = new THREE.Mesh(
    new THREE.SphereGeometry(0.16, 8, 6, 0, TAU, 0, PI / 2),
    new THREE.MeshStandardMaterial({ color: pick([0x4a5a30, 0x3a4a28, 0x5a4a28]), roughness: 0.9 })
  );
  shell.position.y = 0.04;
  shell.scale.set(1.15, 0.55, 1.35);
  g.add(shell);
  const head = new THREE.Mesh(
    new THREE.BoxGeometry(0.07, 0.05, 0.12),
    new THREE.MeshStandardMaterial({ color: 0x6a5a38, roughness: 0.85 })
  );
  head.position.set(0, 0.06, 0.2);
  g.add(head);
  return g;
}

export function spawnWatTurtles(scene) {
  if (!GAMEPLAY.watTurtles) return;
  const temple = G.world && G.world.poi && G.world.poi.temple;
  if (!temple) return;
  const cx = temple.x + 6.2, cz = temple.z - 7.4;
  const pond = new THREE.Group();
  pond.name = 'wat-pond';
  const water = new THREE.Mesh(
    new THREE.CircleGeometry(2.15, 14),
    new THREE.MeshStandardMaterial({ color: 0x3a6a58, roughness: 0.25, metalness: 0.15, transparent: true, opacity: 0.88 })
  );
  water.rotation.x = -PI / 2;
  water.position.y = 0.08;
  pond.add(water);
  const rim = new THREE.Mesh(
    new THREE.TorusGeometry(2.15, 0.12, 6, 16),
    new THREE.MeshStandardMaterial({ color: 0xc8b090, roughness: 0.85 })
  );
  rim.rotation.x = PI / 2;
  rim.position.y = 0.12;
  pond.add(rim);
  pond.position.set(cx, 0, cz);
  scene.add(pond);
  G.watTurtles = [];
  for (let i = 0; i < 4; i++) {
    const mesh = makeTurtleMesh();
    const ang = (i / 4) * TAU;
    const r = 0.7 + i * 0.22;
    mesh.position.set(cx + Math.sin(ang) * r, 0.12, cz + Math.cos(ang) * r);
    scene.add(mesh);
    G.watTurtles.push({ mesh, cx, cz, ang, r, spin: 0.35 + i * 0.08 });
  }
  G.watPond = pond;
}

export function spawnWatFeed(scene) {
  if (!GAMEPLAY.watFeed) return;
  const pond = G.watPond;
  const turtles = G.watTurtles;
  if (!pond || !turtles || !turtles.length) return;
  const cx = turtles[0].cx, cz = turtles[0].cz;
  const x = cx + 2.05, z = cz + 0.15;
  const g = new THREE.Group();
  g.name = 'wat-feed';
  const can = new THREE.Mesh(
    new THREE.CylinderGeometry(0.08, 0.09, 0.16, 8),
    new THREE.MeshStandardMaterial({ color: 0xc45a18, roughness: 0.55, metalness: 0.15 })
  );
  can.position.y = 0.14;
  g.add(can);
  const lid = new THREE.Mesh(
    new THREE.CylinderGeometry(0.085, 0.085, 0.03, 8),
    new THREE.MeshStandardMaterial({ color: 0x8a3a10, roughness: 0.5 })
  );
  lid.position.y = 0.23;
  g.add(lid);
  g.position.set(x, 0, z);
  scene.add(g);
  G.watFeed = { mesh: g, x, z, cx, cz, feedT: 0 };
}

export function spawnWatBell(scene) {
  if (!GAMEPLAY.watBell) return;
  const temple = G.world && G.world.poi && G.world.poi.temple;
  if (!temple) return;
  const x = temple.x - 5.4, z = temple.z + 4.8;
  const g = new THREE.Group();
  g.name = 'wat-bell-frame';
  const wood = new THREE.MeshStandardMaterial({ color: 0x6a4a28, roughness: 0.8 });
  for (const sx of [-0.55, 0.55]) {
    const post = new THREE.Mesh(new THREE.BoxGeometry(0.12, 2.4, 0.12), wood);
    post.position.set(sx, 1.2, 0);
    g.add(post);
  }
  const beam = new THREE.Mesh(new THREE.BoxGeometry(1.35, 0.12, 0.12), wood);
  beam.position.y = 2.35;
  g.add(beam);
  const bronze = new THREE.MeshStandardMaterial({ color: 0xb08a3a, roughness: 0.4, metalness: 0.55 });
  const bell = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.28, 0.55, 10), bronze);
  bell.name = 'wat-bell';
  bell.position.y = 1.85;
  g.add(bell);
  const rim = new THREE.Mesh(new THREE.TorusGeometry(0.28, 0.03, 6, 12), bronze);
  rim.position.y = 1.58;
  rim.rotation.x = PI / 2;
  bell.add(rim);
  const striker = new THREE.Mesh(
    new THREE.CylinderGeometry(0.03, 0.04, 0.55, 5),
    new THREE.MeshStandardMaterial({ color: 0x4a3a22, roughness: 0.75 })
  );
  striker.name = 'wat-bell-striker';
  striker.position.set(0.42, 1.55, 0);
  striker.rotation.z = 0.35;
  g.add(striker);
  g.position.set(x, 0, z);
  scene.add(g);
  G.watBell = { mesh: g, bell, striker, x, z, ringT: 0 };
}

export function spawnWatDrum(scene) {
  if (!GAMEPLAY.watDrum) return;
  const temple = G.world && G.world.poi && G.world.poi.temple;
  if (!temple) return;
  const x = temple.x + 5.4, z = temple.z + 4.8;
  const g = new THREE.Group();
  g.name = 'wat-drum-frame';
  const wood = new THREE.MeshStandardMaterial({ color: 0x6a4a28, roughness: 0.8 });
  for (const sx of [-0.55, 0.55]) {
    const post = new THREE.Mesh(new THREE.BoxGeometry(0.12, 2.2, 0.12), wood);
    post.position.set(sx, 1.1, 0);
    g.add(post);
  }
  const beam = new THREE.Mesh(new THREE.BoxGeometry(1.35, 0.12, 0.12), wood);
  beam.position.y = 2.15;
  g.add(beam);
  const hide = new THREE.MeshStandardMaterial({ color: 0x5a2a14, roughness: 0.75 });
  const drum = new THREE.Mesh(new THREE.CylinderGeometry(0.32, 0.32, 0.55, 12), hide);
  drum.name = 'wat-drum';
  drum.rotation.z = PI / 2;
  drum.position.y = 1.55;
  g.add(drum);
  const skin = new THREE.MeshStandardMaterial({ color: 0xe8d8b0, roughness: 0.7 });
  for (const sx of [-0.28, 0.28]) {
    const head = new THREE.Mesh(new THREE.CircleGeometry(0.32, 12), skin);
    head.rotation.y = PI / 2;
    head.position.set(sx, 1.55, 0);
    g.add(head);
  }
  const beater = new THREE.Mesh(
    new THREE.CylinderGeometry(0.025, 0.035, 0.62, 5),
    new THREE.MeshStandardMaterial({ color: 0x4a3a22, roughness: 0.75 })
  );
  beater.name = 'wat-drum-beater';
  beater.position.set(0.55, 1.35, 0.15);
  beater.rotation.z = 0.55;
  g.add(beater);
  g.position.set(x, 0, z);
  scene.add(g);
  const monk = spawnPed(scene, new THREE.Vector3(x + 0.85, 0, z + 0.1), 'monk');
  monk.watDrum = true;
  monk.anchor = { slot: monk.mesh.position.clone(), facing: -PI / 2 };
  monk.speed = 0;
  monk.state = 'idle';
  monk.heading = -PI / 2;
  if (monk.mesh) {
    monk.mesh.rotation.y = -PI / 2;
    monk.mesh.visible = false;
    const bowl = monk.mesh.getObjectByName('alms-bowl');
    if (bowl) bowl.visible = false;
  }
  G.watDrum = { mesh: g, drum, beater, monk, x, z, t: 0, beatT: 0 };
}

function makeBatMesh() {
  const g = new THREE.Group();
  g.name = 'wat-bat';
  const hide = new THREE.MeshStandardMaterial({ color: 0x2a2218, roughness: 0.9 });
  const body = new THREE.Mesh(new THREE.SphereGeometry(0.07, 6, 5), hide);
  body.scale.set(0.7, 0.55, 1.15);
  g.add(body);
  const wingL = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.02, 0.16), hide);
  wingL.name = 'bat-wing';
  wingL.position.set(-0.22, 0, 0);
  g.add(wingL);
  const wingR = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.02, 0.16), hide);
  wingR.name = 'bat-wing';
  wingR.position.set(0.22, 0, 0);
  g.add(wingR);
  return g;
}

export function spawnWatBats(scene) {
  if (!GAMEPLAY.watBats) return;
  const temple = G.world && G.world.poi && G.world.poi.temple;
  if (!temple) return;
  G.watBats = [];
  for (let i = 0; i < 6; i++) {
    const mesh = makeBatMesh();
    mesh.visible = false;
    scene.add(mesh);
    G.watBats.push({
      mesh,
      cx: temple.x,
      cz: temple.z,
      r: 4.5 + i * 0.85,
      y: 7.2 + (i % 3) * 0.7,
      t: i * 0.9,
      spin: 0.55 + i * 0.08,
    });
  }
}

function makePigeonMesh() {
  const g = new THREE.Group();
  g.name = 'bts-pigeon';
  const grey = new THREE.MeshStandardMaterial({ color: pick([0x7a7a78, 0x6a6a6c, 0x8a8480]), roughness: 0.85 });
  const body = new THREE.Mesh(new THREE.SphereGeometry(0.055, 6, 5), grey);
  body.scale.set(0.75, 0.55, 1.15);
  g.add(body);
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.03, 5, 4), grey);
  head.position.set(0, 0.03, 0.07);
  g.add(head);
  const wingL = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.015, 0.08), grey);
  wingL.name = 'pigeon-wing';
  wingL.position.set(-0.08, 0.01, 0);
  g.add(wingL);
  const wingR = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.015, 0.08), grey);
  wingR.name = 'pigeon-wing';
  wingR.position.set(0.08, 0.01, 0);
  g.add(wingR);
  return g;
}

export function spawnBtsPigeons(scene) {
  if (!GAMEPLAY.btsPigeons) return;
  const bts = G.world && G.world.bts;
  const py = (bts && bts.platformY) || 13.9;
  const stations = [
    { sx: bts ? bts.x : -50, py: py + 0.12, n: 8, z0: -7.2, dz: 2.4, stop: 'asok' },
    { sx: 100, py: py + 0.12, n: 6, z0: -4.2, dz: 3.2, stop: 'phrom' },
  ];
  G.btsPigeons = [];
  for (const st of stations) {
    for (let i = 0; i < st.n; i++) {
      const side = i < st.n / 2 ? -1 : 1;
      const k = i % (st.n / 2);
      const home = { x: st.sx + side * 3.35, y: st.py, z: st.z0 + k * st.dz };
      const mesh = makePigeonMesh();
      mesh.position.set(home.x, home.y, home.z);
      mesh.visible = false;
      scene.add(mesh);
      G.btsPigeons.push({
        mesh, home, t: i * 0.4, state: 'loaf', heading: side > 0 ? -PI / 2 : PI / 2, stop: st.stop,
      });
    }
  }
}

export function spawnWatRobes(scene) {
  if (!GAMEPLAY.watRobes) return;
  const temple = G.world && G.world.poi && G.world.poi.temple;
  if (!temple) return;
  const x = temple.x - 1.2, z = temple.z + 8.2;
  const g = new THREE.Group();
  g.name = 'wat-robes';
  const wood = new THREE.MeshStandardMaterial({ color: 0x6a4a28, roughness: 0.85 });
  const span = 6.4;
  for (const sx of [-span / 2, span / 2]) {
    const post = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.06, 2.6, 6), wood);
    post.position.set(sx, 1.3, 0);
    g.add(post);
  }
  const rope = new THREE.Mesh(
    new THREE.CylinderGeometry(0.015, 0.015, span, 4),
    new THREE.MeshStandardMaterial({ color: 0xc8b090, roughness: 0.7 })
  );
  rope.position.y = 2.45;
  rope.rotation.z = PI / 2;
  g.add(rope);
  const saffron = [0xe07020, 0xd45a18, 0xc44a10, 0xe88830, 0xb83a0c, 0xdc6820];
  for (let i = 0; i < 6; i++) {
    const robe = new THREE.Mesh(
      new THREE.BoxGeometry(0.32, 0.85, 0.05),
      new THREE.MeshStandardMaterial({ color: saffron[i], roughness: 0.88, side: THREE.DoubleSide })
    );
    robe.name = 'saffron-robe';
    robe.position.set(-span * 0.38 + i * 0.85, 1.95, 0);
    g.add(robe);
  }
  g.position.set(x, 0, z);
  scene.add(g);
  G.watRobes = { mesh: g, x, z, t: 0 };
}

export function spawnWatLotus(scene) {
  if (!GAMEPLAY.watLotus) return;
  const temple = G.world && G.world.poi && G.world.poi.temple;
  if (!temple) return;
  const x = temple.x + 8.4, z = temple.z + 2.2;
  const g = new THREE.Group();
  g.name = 'wat-lotus-stand';
  const tub = new THREE.Mesh(
    new THREE.CylinderGeometry(0.42, 0.38, 0.32, 10),
    new THREE.MeshStandardMaterial({ color: 0x4a3a28, roughness: 0.8 })
  );
  tub.position.y = 0.22;
  g.add(tub);
  const water = new THREE.Mesh(
    new THREE.CircleGeometry(0.36, 10),
    new THREE.MeshStandardMaterial({ color: 0x3a6a88, roughness: 0.25, metalness: 0.15, transparent: true, opacity: 0.7 })
  );
  water.rotation.x = -PI / 2;
  water.position.y = 0.36;
  g.add(water);
  const petal = new THREE.MeshStandardMaterial({ color: 0xe878a0, roughness: 0.55 });
  const pad = new THREE.MeshStandardMaterial({ color: 0x2a7a38, roughness: 0.8 });
  for (let i = 0; i < 5; i++) {
    const bloom = new THREE.Group();
    bloom.name = 'wat-lotus';
    const leaf = new THREE.Mesh(new THREE.CircleGeometry(0.1, 8), pad);
    leaf.rotation.x = -PI / 2;
    bloom.add(leaf);
    const flower = new THREE.Mesh(new THREE.ConeGeometry(0.07, 0.12, 7), petal);
    flower.position.y = 0.08;
    bloom.add(flower);
    const a = (i / 5) * TAU;
    bloom.position.set(Math.sin(a) * 0.18, 0.38, Math.cos(a) * 0.18);
    g.add(bloom);
  }
  g.position.set(x, 0, z);
  scene.add(g);
  const vendor = spawnPed(scene, new THREE.Vector3(x + 0.7, 0, z + 0.15), 'vendor');
  vendor.watLotus = true;
  vendor.anchor = { slot: vendor.mesh.position.clone(), facing: PI };
  vendor.speed = 0;
  vendor.state = 'idle';
  vendor.heading = PI;
  if (vendor.mesh) vendor.mesh.rotation.y = PI;
  G.watLotus = { mesh: g, vendor, x, z, t: 0 };
  const mx = temple.x + 3.4, mz = temple.z - 11.6;
  const box = new THREE.Group();
  box.name = 'wat-merit-box';
  const gold = new THREE.MeshStandardMaterial({ color: 0xd9a134, roughness: 0.45, metalness: 0.55 });
  const body = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.7, 0.32), gold);
  body.position.y = 0.55;
  box.add(body);
  const slot = new THREE.Mesh(
    new THREE.BoxGeometry(0.16, 0.04, 0.04),
    new THREE.MeshStandardMaterial({ color: 0x3a2a12, roughness: 0.7 })
  );
  slot.position.y = 0.92;
  box.add(slot);
  box.position.set(mx + 0.45, 0, mz - 0.15);
  scene.add(box);
  const attendant = spawnPed(scene, new THREE.Vector3(mx, 0, mz), 'monk');
  attendant.watLotus = true;
  attendant.watMerit = true;
  attendant.speed = 0;
  attendant.state = 'idle';
  attendant.heading = PI;
  attendant.anchor = { slot: new THREE.Vector3(mx, 0, mz), facing: PI };
  if (attendant.mesh) {
    attendant.mesh.rotation.y = PI;
    attendant.mesh.visible = false;
    const bowl = attendant.mesh.getObjectByName('alms-bowl');
    if (bowl) bowl.visible = false;
  }
  const tray = new THREE.Mesh(
    new THREE.BoxGeometry(0.14, 0.02, 0.1),
    new THREE.MeshStandardMaterial({ color: 0xffcf4a, metalness: 0.55, roughness: 0.35 })
  );
  tray.name = 'wat-merit-tray';
  const parts = attendant.mesh && attendant.mesh.userData && attendant.mesh.userData.parts;
  if (parts && parts.foreR) {
    tray.position.set(0.02, -0.22, 0.06);
    parts.foreR.add(tray);
  } else if (attendant.mesh) {
    tray.position.set(0.22, 1.05, 0.12);
    attendant.mesh.add(tray);
  }
  G.watMerit = { ped: attendant, box, x: mx, z: mz, t: 0 };
}

export function spawnWatAmulet(scene) {
  if (!GAMEPLAY.watAmulet) return;
  const temple = G.world && G.world.poi && G.world.poi.temple;
  if (!temple) return;
  const x = temple.x - 8.8, z = temple.z + 1.0;
  const g = new THREE.Group();
  g.name = 'wat-amulet-board';
  const board = new THREE.Mesh(
    new THREE.BoxGeometry(0.85, 1.15, 0.08),
    new THREE.MeshStandardMaterial({ color: 0x5a3a18, roughness: 0.8 })
  );
  board.position.y = 1.05;
  g.add(board);
  const gold = [
    new THREE.MeshStandardMaterial({ color: 0xe8c04a, roughness: 0.35, metalness: 0.65, emissive: 0xd4a020, emissiveIntensity: 0.12 }),
    new THREE.MeshStandardMaterial({ color: 0xb08a3a, roughness: 0.4, metalness: 0.55, emissive: 0x8a6010, emissiveIntensity: 0.1 }),
  ];
  for (let i = 0; i < 6; i++) {
    const charm = new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.055, 0.02, 8), gold[i % 2]);
    charm.name = 'wat-amulet';
    charm.rotation.x = PI / 2;
    charm.position.set(-0.22 + (i % 3) * 0.22, 0.75 + Math.floor(i / 3) * 0.38, 0.06);
    g.add(charm);
  }
  g.position.set(x, 0, z);
  scene.add(g);
  const vendor = spawnPed(scene, new THREE.Vector3(x + 0.7, 0, z + 0.12), 'vendor');
  vendor.watAmulet = true;
  vendor.anchor = { slot: vendor.mesh.position.clone(), facing: PI };
  vendor.speed = 0;
  vendor.state = 'idle';
  vendor.heading = PI;
  if (vendor.mesh) {
    vendor.mesh.rotation.y = PI;
    vendor.mesh.visible = false;
  }
  G.watAmulet = { mesh: g, vendor, x, z, t: 0 };
}

export function spawnWatCats(scene) {
  if (!GAMEPLAY.watCats) return;
  const temple = G.world && G.world.poi && G.world.poi.temple;
  if (!temple) return;
  const homes = [
    { x: temple.x - 6.2, z: temple.z - 3.8 },
    { x: temple.x - 9.4, z: temple.z - 4.2 },
    { x: temple.x + 4.4, z: temple.z - 5.6 },
    { x: temple.x + 7.2, z: temple.z - 8.8 },
  ];
  G.watCats = [];
  for (let i = 0; i < homes.length; i++) {
    const home = homes[i];
    const mesh = makeCatMesh();
    mesh.name = 'wat-cat';
    mesh.position.set(home.x, 0, home.z);
    scene.add(mesh);
    G.watCats.push({
      mesh,
      home: { x: home.x, z: home.z },
      heading: (i * 1.4) % TAU,
      state: 'loaf',
      t: i * 0.5,
    });
  }
}

export function makeChaYenMesh() {
  const g = new THREE.Group();
  g.name = 'chayen-cart';
  const box = new THREE.Mesh(new THREE.BoxGeometry(0.88, 0.5, 1.15), new THREE.MeshStandardMaterial({ color: 0x7a3a18, roughness: 0.8 }));
  box.position.y = 0.48; g.add(box);
  const urn = new THREE.Mesh(
    new THREE.CylinderGeometry(0.16, 0.18, 0.42, 8),
    new THREE.MeshStandardMaterial({ color: 0xc45a18, roughness: 0.45, metalness: 0.2, emissive: 0xa03a08, emissiveIntensity: 0.18 })
  );
  urn.name = 'chayen-urn';
  urn.position.set(-0.18, 0.95, 0);
  g.add(urn);
  const lid = new THREE.Mesh(
    new THREE.CylinderGeometry(0.17, 0.17, 0.04, 8),
    new THREE.MeshStandardMaterial({ color: 0x8a8a82, metalness: 0.4, roughness: 0.4 })
  );
  lid.position.set(-0.18, 1.18, 0);
  g.add(lid);
  const milk = new THREE.Mesh(
    new THREE.CylinderGeometry(0.07, 0.07, 0.16, 6),
    new THREE.MeshStandardMaterial({ color: 0xe8e0d0, roughness: 0.55 })
  );
  milk.position.set(0.18, 0.86, -0.12);
  g.add(milk);
  const ice = new THREE.Mesh(
    new THREE.BoxGeometry(0.22, 0.12, 0.22),
    new THREE.MeshStandardMaterial({ color: 0xc8e8f0, roughness: 0.25, transparent: true, opacity: 0.7 })
  );
  ice.position.set(0.2, 0.82, 0.16);
  g.add(ice);
  const cup = new THREE.Mesh(
    new THREE.CylinderGeometry(0.05, 0.045, 0.14, 6),
    new THREE.MeshStandardMaterial({ color: 0xe8a030, roughness: 0.5 })
  );
  cup.name = 'chayen-cup';
  cup.position.set(0.32, 0.84, 0.02);
  g.add(cup);
  const umb = new THREE.Mesh(
    new THREE.ConeGeometry(0.68, 0.24, 8),
    new THREE.MeshStandardMaterial({ color: 0xff6a1a, roughness: 0.7, side: THREE.DoubleSide })
  );
  umb.position.y = 1.88; umb.rotation.x = PI; g.add(umb);
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 1.0, 5), new THREE.MeshStandardMaterial({ color: 0x333333 }));
  pole.position.y = 1.35; g.add(pole);
  const tire = new THREE.MeshStandardMaterial({ color: 0x111111, roughness: 0.8 });
  for (const z of [-0.38, 0.38]) for (const x of [-0.3, 0.3]) {
    const w = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, 0.08, 8), tire);
    w.rotation.z = PI / 2; w.position.set(x, 0.12, z); g.add(w);
  }
  return g;
}

export function spawnChaYen(scene) {
  if (!GAMEPLAY.chaYen) return;
  const sois = (G.world && G.world.sois) || [];
  G.chaYen = [];
  if (!sois.length) return;
  const ranked = sois.slice().sort((a, b) => {
    const la = a.axis === 'z' ? (a.z1 - a.z0) : (a.x1 - a.x0);
    const lb = b.axis === 'z' ? (b.z1 - b.z0) : (b.x1 - b.x0);
    return lb - la;
  });
  const s = ranked[4] || ranked[ranked.length - 1] || ranked[0];
  const alongZ = s.axis === 'z';
  const t0 = 0.72;
  const x = alongZ ? (s.x0 + s.x1) * 0.5 : s.x0 + (s.x1 - s.x0) * t0;
  const z = alongZ ? s.z0 + (s.z1 - s.z0) * t0 : (s.z0 + s.z1) * 0.5;
  const mesh = makeChaYenMesh();
  mesh.position.set(x, 0, z);
  scene.add(mesh);
  const vendor = spawnPed(scene, new THREE.Vector3(x, 0, z), 'vendor');
  vendor.chaYen = true;
  vendor.anchor = { slot: vendor.mesh.position.clone(), facing: alongZ ? 0 : PI / 2 };
  vendor.speed = 0;
  G.chaYen.push({ mesh, vendor, soi: s, alongZ, t: t0, dir: -1 });
}

export function makeRotiMesh() {
  const g = new THREE.Group();
  g.name = 'roti-cart';
  const box = new THREE.Mesh(new THREE.BoxGeometry(0.95, 0.48, 1.2), new THREE.MeshStandardMaterial({ color: 0xc45a18, roughness: 0.8 }));
  box.position.y = 0.46; g.add(box);
  const pan = new THREE.Mesh(
    new THREE.CylinderGeometry(0.32, 0.32, 0.04, 12),
    new THREE.MeshStandardMaterial({ color: 0x3a3a40, roughness: 0.4, metalness: 0.45, emissive: 0x331808, emissiveIntensity: 0.2 })
  );
  pan.name = 'roti-pan';
  pan.position.set(0, 0.74, 0.08);
  g.add(pan);
  const dough = new THREE.Mesh(
    new THREE.CylinderGeometry(0.22, 0.22, 0.02, 10),
    new THREE.MeshStandardMaterial({ color: 0xe8c878, roughness: 0.7 })
  );
  dough.name = 'roti-dough';
  dough.position.set(0, 0.77, 0.08);
  g.add(dough);
  const banana = new THREE.Mesh(
    new THREE.CapsuleGeometry(0.035, 0.16, 4, 6),
    new THREE.MeshStandardMaterial({ color: 0xe8c020, roughness: 0.6 })
  );
  banana.rotation.z = 0.6;
  banana.position.set(0.28, 0.82, -0.22);
  g.add(banana);
  const spatula = new THREE.Mesh(
    new THREE.BoxGeometry(0.06, 0.01, 0.28),
    new THREE.MeshStandardMaterial({ color: 0x888890, metalness: 0.45, roughness: 0.4 })
  );
  spatula.name = 'roti-spatula';
  spatula.position.set(0.18, 0.86, 0.12);
  spatula.rotation.y = 0.4;
  g.add(spatula);
  const umb = new THREE.Mesh(
    new THREE.ConeGeometry(0.7, 0.26, 8),
    new THREE.MeshStandardMaterial({ color: 0x2a6aad, roughness: 0.7, side: THREE.DoubleSide })
  );
  umb.position.y = 1.9; umb.rotation.x = PI; g.add(umb);
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 1.05, 5), new THREE.MeshStandardMaterial({ color: 0x333333 }));
  pole.position.y = 1.38; g.add(pole);
  const tire = new THREE.MeshStandardMaterial({ color: 0x111111, roughness: 0.8 });
  for (const z of [-0.4, 0.4]) for (const x of [-0.32, 0.32]) {
    const w = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, 0.08, 8), tire);
    w.rotation.z = PI / 2; w.position.set(x, 0.12, z); g.add(w);
  }
  return g;
}

export function spawnRotiCart(scene) {
  if (!GAMEPLAY.rotiCart) return;
  const sois = (G.world && G.world.sois) || [];
  G.rotiCart = [];
  if (!sois.length) return;
  const ranked = sois.slice().sort((a, b) => {
    const la = a.axis === 'z' ? (a.z1 - a.z0) : (a.x1 - a.x0);
    const lb = b.axis === 'z' ? (b.z1 - b.z0) : (b.x1 - b.x0);
    return lb - la;
  });
  const s = ranked[5] || ranked[ranked.length - 1] || ranked[0];
  const alongZ = s.axis === 'z';
  const t0 = 0.34;
  const x = alongZ ? (s.x0 + s.x1) * 0.5 : s.x0 + (s.x1 - s.x0) * t0;
  const z = alongZ ? s.z0 + (s.z1 - s.z0) * t0 : (s.z0 + s.z1) * 0.5;
  const mesh = makeRotiMesh();
  mesh.position.set(x, 0, z);
  scene.add(mesh);
  const vendor = spawnPed(scene, new THREE.Vector3(x, 0, z), 'vendor');
  vendor.roti = true;
  vendor.anchor = { slot: vendor.mesh.position.clone(), facing: alongZ ? 0 : PI / 2 };
  vendor.speed = 0;
  G.rotiCart.push({ mesh, vendor, soi: s, alongZ, t: t0, dir: 1 });
}

export function spawnCoconutCarts(scene) {
  if (!GAMEPLAY.coconutCart) return;
  const sois = (G.world && G.world.sois) || [];
  G.coconutCarts = [];
  if (!sois.length) return;
  let s = sois[0], best = 0;
  for (const cand of sois) {
    const len = cand.axis === 'z' ? (cand.z1 - cand.z0) : (cand.x1 - cand.x0);
    if (len > best) { best = len; s = cand; }
  }
  const alongZ = s.axis === 'z';
  const t0 = 0.4;
  const x = alongZ ? (s.x0 + s.x1) * 0.5 : s.x0 + (s.x1 - s.x0) * t0;
  const z = alongZ ? s.z0 + (s.z1 - s.z0) * t0 : (s.z0 + s.z1) * 0.5;
  const mesh = makeCoconutCartMesh();
  mesh.position.set(x, 0, z);
  scene.add(mesh);
  const vendor = spawnPed(scene, new THREE.Vector3(x, 0, z), 'vendor');
  vendor.coconutCart = true;
  vendor.anchor = { slot: vendor.mesh.position.clone(), facing: alongZ ? 0 : PI / 2 };
  vendor.speed = 0;
  G.coconutCarts.push({ mesh, vendor, soi: s, alongZ, t: t0, dir: 1 });
}

export function makeSomTamMesh() {
  const g = new THREE.Group();
  g.name = 'somtam-cart';
  const box = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.5, 1.25), new THREE.MeshStandardMaterial({ color: 0x4a6a2a, roughness: 0.82 }));
  box.position.y = 0.48; g.add(box);
  const board = new THREE.Mesh(new THREE.BoxGeometry(0.72, 0.04, 0.7), new THREE.MeshStandardMaterial({ color: 0xc8b080, roughness: 0.7 }));
  board.position.y = 0.76; g.add(board);
  const mortar = new THREE.Mesh(
    new THREE.CylinderGeometry(0.16, 0.2, 0.28, 8),
    new THREE.MeshStandardMaterial({ color: 0x6a5a48, roughness: 0.75 })
  );
  mortar.name = 'somtam-mortar';
  mortar.position.set(-0.12, 0.94, 0.08);
  g.add(mortar);
  const pestle = new THREE.Mesh(
    new THREE.CylinderGeometry(0.035, 0.05, 0.42, 6),
    new THREE.MeshStandardMaterial({ color: 0x8a6a40, roughness: 0.7 })
  );
  pestle.name = 'somtam-pestle';
  pestle.position.set(-0.12, 1.18, 0.08);
  pestle.rotation.z = 0.25;
  g.add(pestle);
  const papaya = new THREE.MeshStandardMaterial({ color: 0x7a9a2a, roughness: 0.65 });
  for (let i = 0; i < 3; i++) {
    const fruit = new THREE.Mesh(new THREE.SphereGeometry(0.09, 6, 5), papaya);
    fruit.scale.set(0.7, 1.15, 0.7);
    fruit.position.set(0.22, 0.88, -0.18 + i * 0.16);
    g.add(fruit);
  }
  const chili = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.04, 0.08), new THREE.MeshStandardMaterial({ color: 0xc03020, roughness: 0.6 }));
  chili.position.set(0.28, 0.8, 0.22);
  g.add(chili);
  const umb = new THREE.Mesh(
    new THREE.ConeGeometry(0.7, 0.26, 8),
    new THREE.MeshStandardMaterial({ color: 0xff8a2a, roughness: 0.7, side: THREE.DoubleSide })
  );
  umb.position.y = 1.92; umb.rotation.x = PI; g.add(umb);
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 1.05, 5), new THREE.MeshStandardMaterial({ color: 0x333333 }));
  pole.position.y = 1.38; g.add(pole);
  const tire = new THREE.MeshStandardMaterial({ color: 0x111111, roughness: 0.8 });
  for (const z of [-0.4, 0.4]) for (const x of [-0.32, 0.32]) {
    const w = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, 0.08, 8), tire);
    w.rotation.z = PI / 2; w.position.set(x, 0.12, z); g.add(w);
  }
  return g;
}

export function spawnPlaKat(scene) {
  if (!GAMEPLAY.plaKat) return;
  const sois = (G.world && G.world.sois) || [];
  if (sois.length < 2) return;
  const ranked = sois.slice().sort((a, b) => {
    const la = a.axis === 'z' ? (a.z1 - a.z0) : (a.x1 - a.x0);
    const lb = b.axis === 'z' ? (b.z1 - b.z0) : (b.x1 - b.x0);
    return lb - la;
  });
  const s = ranked[3] || ranked[0];
  const alongZ = s.axis === 'z';
  const t = 0.38;
  const x = alongZ ? (s.x0 + s.x1) * 0.5 + 1.55 : s.x0 + (s.x1 - s.x0) * t;
  const z = alongZ ? s.z0 + (s.z1 - s.z0) * t : (s.z0 + s.z1) * 0.5 + 1.55;
  const g = new THREE.Group();
  g.name = 'plakat-rack';
  const pole = new THREE.Mesh(
    new THREE.CylinderGeometry(0.04, 0.05, 2.2, 5),
    new THREE.MeshStandardMaterial({ color: 0x6a5a3a, roughness: 0.75 })
  );
  pole.position.y = 1.1;
  g.add(pole);
  const bar = new THREE.Mesh(
    new THREE.BoxGeometry(1.15, 0.04, 0.04),
    new THREE.MeshStandardMaterial({ color: 0x4a4a48, roughness: 0.55, metalness: 0.25 })
  );
  bar.position.y = 2.05;
  g.add(bar);
  const bagMat = new THREE.MeshStandardMaterial({
    color: 0x8ec8e8, roughness: 0.2, metalness: 0.05, transparent: true, opacity: 0.35,
  });
  const fishColors = [0xc44a3a, 0x2a6aad, 0xc8a227, 0x6a2a8a, 0x1e9a5e, 0xd44b3b];
  const bags = [];
  for (let i = 0; i < 6; i++) {
    const bag = new THREE.Group();
    bag.name = 'plakat-bag';
    const water = new THREE.Mesh(new THREE.SphereGeometry(0.11, 8, 6), bagMat.clone());
    water.scale.set(0.85, 1.15, 0.85);
    bag.add(water);
    const fish = new THREE.Mesh(
      new THREE.SphereGeometry(0.035, 5, 4),
      new THREE.MeshStandardMaterial({ color: fishColors[i], roughness: 0.45, emissive: fishColors[i], emissiveIntensity: 0.12 })
    );
    fish.name = 'plakat-fish';
    fish.position.y = -0.02;
    bag.add(fish);
    bag.position.set(-0.45 + i * 0.18, 1.72, 0);
    g.add(bag);
    bags.push(bag);
  }
  g.position.set(x, 0, z);
  scene.add(g);
  const vendor = spawnPed(scene, new THREE.Vector3(x + (alongZ ? 0.7 : 0), 0, z + (alongZ ? 0 : 0.7)), 'vendor');
  vendor.plaKat = true;
  vendor.anchor = { slot: vendor.mesh.position.clone(), facing: alongZ ? PI / 2 : 0 };
  vendor.speed = 0;
  vendor.state = 'idle';
  G.plaKat = { mesh: g, vendor, bags, soi: s, x, z };
}

export function spawnSomTam(scene) {
  if (!GAMEPLAY.somTam) return;
  const sois = (G.world && G.world.sois) || [];
  G.somTam = [];
  if (!sois.length) return;
  const ranked = sois.slice().sort((a, b) => {
    const la = a.axis === 'z' ? (a.z1 - a.z0) : (a.x1 - a.x0);
    const lb = b.axis === 'z' ? (b.z1 - b.z0) : (b.x1 - b.x0);
    return lb - la;
  });
  const s = ranked[2] || ranked[0];
  const alongZ = s.axis === 'z';
  const t0 = 0.62;
  const x = alongZ ? (s.x0 + s.x1) * 0.5 : s.x0 + (s.x1 - s.x0) * t0;
  const z = alongZ ? s.z0 + (s.z1 - s.z0) * t0 : (s.z0 + s.z1) * 0.5;
  const mesh = makeSomTamMesh();
  mesh.position.set(x, 0, z);
  scene.add(mesh);
  const vendor = spawnPed(scene, new THREE.Vector3(x, 0, z), 'vendor');
  vendor.somTam = true;
  vendor.anchor = { slot: vendor.mesh.position.clone(), facing: alongZ ? 0 : PI / 2 };
  vendor.speed = 0;
  G.somTam.push({ mesh, vendor, soi: s, alongZ, t: t0, dir: 1 });
}

export function spawnMooPing(scene) {
  if (!GAMEPLAY.mooPing) return;
  const sois = (G.world && G.world.sois) || [];
  G.mooPing = [];
  if (!sois.length) return;
  const ranked = sois.slice().sort((a, b) => {
    const la = a.axis === 'z' ? (a.z1 - a.z0) : (a.x1 - a.x0);
    const lb = b.axis === 'z' ? (b.z1 - b.z0) : (b.x1 - b.x0);
    return lb - la;
  });
  const s = ranked[1] || ranked[0];
  const alongZ = s.axis === 'z';
  const t0 = 0.55;
  const x = alongZ ? (s.x0 + s.x1) * 0.5 : s.x0 + (s.x1 - s.x0) * t0;
  const z = alongZ ? s.z0 + (s.z1 - s.z0) * t0 : (s.z0 + s.z1) * 0.5;
  const mesh = makeMooPingMesh();
  mesh.position.set(x, 0, z);
  scene.add(mesh);
  const vendor = spawnPed(scene, new THREE.Vector3(x, 0, z), 'vendor');
  vendor.mooPing = true;
  vendor.anchor = { slot: vendor.mesh.position.clone(), facing: alongZ ? 0 : PI / 2 };
  vendor.speed = 0;
  G.mooPing.push({ mesh, vendor, soi: s, alongZ, t: t0, dir: 1, coalMat: mesh.userData.coalMat });
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

export function addHireSign(v, color = 0xffcf4a) {
  if (!v || !v.mesh || v.hireSign) return;
  const sign = new THREE.Mesh(
    new THREE.BoxGeometry(0.58, 0.22, 0.14),
    new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 0.4, roughness: 0.45 })
  );
  sign.name = 'hire-sign';
  const y = (v.spec && v.spec.kind === 'tuktuk') ? 1.72 : 2.05;
  sign.position.set(0, y, 0.15);
  v.mesh.add(sign);
  v.hireSign = sign;
}

export function spawnBtsMalai(scene) {
  if (!GAMEPLAY.btsMalai) return;
  const bts = G.world && G.world.bts;
  if (!bts) return;
  const stand = (x, z, stop) => {
    const g = new THREE.Group();
    g.name = 'malai-stand';
    const crate = new THREE.Mesh(
      new THREE.BoxGeometry(0.7, 0.38, 0.55),
      new THREE.MeshStandardMaterial({ color: 0x8a6a3a, roughness: 0.8 })
    );
    crate.position.y = 0.22;
    g.add(crate);
    const jasmine = new THREE.MeshStandardMaterial({ color: 0xf4f0e0, roughness: 0.55 });
    const marigold = new THREE.MeshStandardMaterial({ color: 0xff8a1a, roughness: 0.55 });
    for (let i = 0; i < 5; i++) {
      const strand = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.03, 0.55, 5), i % 2 ? marigold : jasmine);
      strand.name = 'malai-strand';
      strand.position.set(-0.22 + i * 0.11, 0.72, 0.02);
      g.add(strand);
    }
    const pole = new THREE.Mesh(
      new THREE.CylinderGeometry(0.02, 0.02, 1.15, 5),
      new THREE.MeshStandardMaterial({ color: 0x333333 })
    );
    pole.position.set(0.28, 0.7, -0.12);
    g.add(pole);
    const sign = new THREE.Mesh(
      new THREE.BoxGeometry(0.42, 0.18, 0.04),
      new THREE.MeshStandardMaterial({ color: 0xc44a3a, roughness: 0.6, emissive: 0x802020, emissiveIntensity: 0.15 })
    );
    sign.name = 'malai-sign';
    sign.position.set(0.28, 1.32, -0.12);
    g.add(sign);
    g.position.set(x, 0, z);
    scene.add(g);
    const vendor = spawnPed(scene, new THREE.Vector3(x + 0.55, 0, z + 0.35), 'vendor');
    vendor.btsMalai = true;
    vendor.stop = stop;
    vendor.anchor = { slot: vendor.mesh.position.clone(), facing: PI / 2 };
    vendor.speed = 0;
    vendor.state = 'idle';
    vendor.heading = PI / 2;
    if (vendor.mesh) vendor.mesh.rotation.y = PI / 2;
    return { mesh: g, vendor, x, z, t: 0, stop };
  };
  G.btsMalai = stand(bts.x - 6.4, -16.2, 'asok');
  G.phromMalai = stand(100 - 6.4, -16.2, 'phrom');
}

export function makeMangoStickyMesh() {
  const g = new THREE.Group();
  g.name = 'mango-cart';
  const box = new THREE.Mesh(new THREE.BoxGeometry(0.95, 0.5, 1.2), new THREE.MeshStandardMaterial({ color: 0x2a6a38, roughness: 0.8 }));
  box.position.y = 0.48; g.add(box);
  const rice = new THREE.Mesh(
    new THREE.CylinderGeometry(0.16, 0.18, 0.16, 8),
    new THREE.MeshStandardMaterial({ color: 0xf4eee0, roughness: 0.7 })
  );
  rice.name = 'sticky-rice';
  rice.position.set(-0.18, 0.82, 0.08);
  g.add(rice);
  const cream = new THREE.Mesh(
    new THREE.CylinderGeometry(0.07, 0.08, 0.14, 6),
    new THREE.MeshStandardMaterial({ color: 0xfff4d8, roughness: 0.45, emissive: 0xffcc88, emissiveIntensity: 0.12 })
  );
  cream.name = 'coconut-cream';
  cream.position.set(0.22, 0.84, -0.12);
  g.add(cream);
  const mangoMat = new THREE.MeshStandardMaterial({ color: 0xffb020, roughness: 0.55 });
  for (let i = 0; i < 3; i++) {
    const half = new THREE.Mesh(new THREE.SphereGeometry(0.09, 7, 5, 0, TAU, 0, PI / 2), mangoMat);
    half.name = 'mango-half';
    half.rotation.x = PI / 2;
    half.position.set(0.08 + i * 0.16, 0.8, 0.18);
    g.add(half);
  }
  const plate = new THREE.Mesh(
    new THREE.CylinderGeometry(0.12, 0.12, 0.03, 8),
    new THREE.MeshStandardMaterial({ color: 0xf0e8d8, roughness: 0.6 })
  );
  plate.name = 'mango-plate';
  plate.position.set(0.28, 0.78, 0.08);
  g.add(plate);
  const umb = new THREE.Mesh(
    new THREE.ConeGeometry(0.72, 0.26, 8),
    new THREE.MeshStandardMaterial({ color: 0xffcf4a, roughness: 0.7, side: THREE.DoubleSide })
  );
  umb.position.y = 1.92; umb.rotation.x = PI; g.add(umb);
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 1.05, 5), new THREE.MeshStandardMaterial({ color: 0x333333 }));
  pole.position.y = 1.38; g.add(pole);
  const tire = new THREE.MeshStandardMaterial({ color: 0x111111, roughness: 0.8 });
  for (const z of [-0.4, 0.4]) for (const x of [-0.32, 0.32]) {
    const w = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, 0.08, 8), tire);
    w.rotation.z = PI / 2; w.position.set(x, 0.12, z); g.add(w);
  }
  return g;
}

export function spawnMangoSticky(scene) {
  if (!GAMEPLAY.mangoSticky) return;
  const bts = G.world && G.world.bts;
  if (!bts) return;
  const cart = (x, z, stop) => {
    const mesh = makeMangoStickyMesh();
    mesh.position.set(x, 0, z);
    scene.add(mesh);
    const vendor = spawnPed(scene, new THREE.Vector3(x + 0.7, 0, z + 0.15), 'vendor');
    vendor.mango = true;
    vendor.stop = stop;
    vendor.anchor = { slot: vendor.mesh.position.clone(), facing: PI / 2 };
    vendor.speed = 0;
    vendor.state = 'idle';
    vendor.heading = PI / 2;
    if (vendor.mesh) {
      vendor.mesh.rotation.y = PI / 2;
      vendor.mesh.visible = false;
    }
    return { mesh, vendor, x, z, t: 0, stop };
  };
  G.mangoSticky = cart(bts.x - 8.8, -22.4, 'asok');
  G.phromMango = cart(100 - 8.8, 8.8, 'phrom');
}

export function makePhromFruitMesh() {
  const g = new THREE.Group();
  g.name = 'phrom-fruit';
  const box = new THREE.Mesh(
    new THREE.BoxGeometry(0.95, 0.5, 1.15),
    new THREE.MeshStandardMaterial({ color: 0x2a8a3a, roughness: 0.78 })
  );
  box.position.y = 0.48;
  g.add(box);
  const blender = new THREE.Mesh(
    new THREE.CylinderGeometry(0.09, 0.1, 0.28, 8),
    new THREE.MeshStandardMaterial({
      color: 0xffb020, roughness: 0.3, transparent: true, opacity: 0.7,
      emissive: 0xff8800, emissiveIntensity: 0.12,
    })
  );
  blender.name = 'phrom-blender';
  blender.position.set(-0.18, 0.92, 0.05);
  g.add(blender);
  const base = new THREE.Mesh(
    new THREE.CylinderGeometry(0.11, 0.12, 0.08, 8),
    new THREE.MeshStandardMaterial({ color: 0x2a2a30, roughness: 0.45, metalness: 0.3 })
  );
  base.position.set(-0.18, 0.76, 0.05);
  g.add(base);
  const fruitMat = [
    new THREE.MeshStandardMaterial({ color: 0xc03030, roughness: 0.6 }),
    new THREE.MeshStandardMaterial({ color: 0xffb020, roughness: 0.55 }),
    new THREE.MeshStandardMaterial({ color: 0xe8d24a, roughness: 0.55 }),
    new THREE.MeshStandardMaterial({ color: 0x2ec86a, roughness: 0.6 }),
  ];
  for (let i = 0; i < 4; i++) {
    const fruit = new THREE.Mesh(new THREE.SphereGeometry(0.08, 7, 5), fruitMat[i]);
    fruit.name = 'phrom-fruit-piece';
    fruit.position.set(0.08 + (i % 2) * 0.18, 0.82, (i < 2 ? 0.16 : -0.1));
    g.add(fruit);
  }
  const cup = new THREE.Mesh(
    new THREE.CylinderGeometry(0.045, 0.04, 0.12, 7),
    new THREE.MeshStandardMaterial({ color: 0xff6a2a, roughness: 0.4, transparent: true, opacity: 0.8 })
  );
  cup.name = 'phrom-cup';
  cup.position.set(0.28, 0.84, 0.18);
  g.add(cup);
  const umb = new THREE.Mesh(
    new THREE.ConeGeometry(0.7, 0.24, 8),
    new THREE.MeshStandardMaterial({ color: 0xff8a1a, roughness: 0.7, side: THREE.DoubleSide })
  );
  umb.position.y = 1.9;
  umb.rotation.x = PI;
  g.add(umb);
  const pole = new THREE.Mesh(
    new THREE.CylinderGeometry(0.02, 0.02, 1.02, 5),
    new THREE.MeshStandardMaterial({ color: 0x333333 })
  );
  pole.position.y = 1.36;
  g.add(pole);
  const tire = new THREE.MeshStandardMaterial({ color: 0x111111, roughness: 0.8 });
  for (const z of [-0.38, 0.38]) for (const x of [-0.32, 0.32]) {
    const w = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, 0.08, 8), tire);
    w.rotation.z = PI / 2;
    w.position.set(x, 0.12, z);
    g.add(w);
  }
  return g;
}

export function spawnPhromFruit(scene) {
  if (!GAMEPLAY.phromFruit) return;
  const cart = (x, z, stop) => {
    const mesh = makePhromFruitMesh();
    mesh.position.set(x, 0, z);
    scene.add(mesh);
    const vendor = spawnPed(scene, new THREE.Vector3(x + 0.7, 0, z + 0.12), 'vendor');
    vendor.phromFruit = true;
    vendor.stop = stop;
    vendor.anchor = { slot: vendor.mesh.position.clone(), facing: PI / 2 };
    vendor.speed = 0;
    vendor.state = 'idle';
    vendor.heading = PI / 2;
    if (vendor.mesh) {
      vendor.mesh.rotation.y = PI / 2;
      vendor.mesh.visible = false;
    }
    return { mesh, vendor, x, z, t: 0, stop };
  };
  G.phromFruit = cart(100 - 8.2, -24.8, 'phrom');
  const bts = G.world && G.world.bts;
  G.asokFruit = bts ? cart(bts.x - 8.8, 8.8, 'asok') : null;
}

export function spawnBtsGates(scene) {
  if (!GAMEPLAY.btsGates) return;
  const bts = G.world && G.world.bts;
  if (!bts) return;
  const PY = bts.platformY || 13.9;
  const zGate = -4.85;
  const bodyMat = new THREE.MeshStandardMaterial({ color: 0xe8d24a, roughness: 0.45 });
  const teal = new THREE.MeshStandardMaterial({ color: 0x2a7d8e, roughness: 0.5 });
  const station = (sx, stop) => {
    const gates = [];
    for (let i = 0; i < 3; i++) {
      const g = new THREE.Group();
      g.name = 'bts-gate';
      const x = sx - 1.2 + i * 1.2;
      const body = new THREE.Mesh(new THREE.BoxGeometry(0.42, 1.05, 0.55), bodyMat);
      body.position.y = 0.52;
      g.add(body);
      const stripe = new THREE.Mesh(new THREE.BoxGeometry(0.44, 0.08, 0.56), teal);
      stripe.position.y = 0.95;
      g.add(stripe);
      const flap = new THREE.Mesh(
        new THREE.BoxGeometry(0.04, 0.7, 0.38),
        new THREE.MeshStandardMaterial({ color: 0xf4f0e0, roughness: 0.4 })
      );
      flap.name = 'bts-flap';
      flap.position.set(0.22, 0.55, 0);
      g.add(flap);
      g.position.set(x, PY, zGate);
      scene.add(g);
      gates.push({ mesh: g, flap, x, z: zGate });
    }
    const machine = new THREE.Group();
    machine.name = 'bts-ticket-machine';
    const kiosk = new THREE.Mesh(
      new THREE.BoxGeometry(0.55, 1.35, 0.4),
      new THREE.MeshStandardMaterial({ color: 0x2a7d8e, roughness: 0.5 })
    );
    kiosk.position.y = 0.68;
    machine.add(kiosk);
    const screen = new THREE.Mesh(
      new THREE.BoxGeometry(0.36, 0.28, 0.04),
      new THREE.MeshStandardMaterial({ color: 0x88e0ff, emissive: 0x226688, emissiveIntensity: 0.4, roughness: 0.3 })
    );
    screen.name = 'bts-ticket-screen';
    screen.position.set(0, 1.15, 0.22);
    machine.add(screen);
    const slot = new THREE.Mesh(
      new THREE.BoxGeometry(0.18, 0.04, 0.06),
      new THREE.MeshStandardMaterial({ color: 0x111111 })
    );
    slot.position.set(0, 0.72, 0.22);
    machine.add(slot);
    machine.position.set(sx + 5.2, 0, -24.5);
    scene.add(machine);
    return { gates, machine, sx, zGate, py: PY, openT: 0, _pz: null, stop };
  };
  G.btsGates = station(bts.x, 'asok');
  G.phromGates = station(100, 'phrom');
}

export function spawnBtsSongthaew(scene) {
  if (!GAMEPLAY.btsSongthaew) return;
  const bts = G.world && G.world.bts;
  if (!bts) return;
  const rank = (x, z, stop) => {
    const heading = PI / 2;
    const v = makeVehicle('songthaew', scene);
    v.pos.set(x, 0, z);
    v.heading = heading;
    v.mesh.position.copy(v.pos);
    v.mesh.rotation.y = heading;
    v.driver = null;
    v.vel = 0;
    v.btsSongthaew = true;
    v._standHome = { x, z, heading };
    addHireSign(v, 0xffcf4a);
    const waiter = spawnPed(scene, new THREE.Vector3(x + 2.4, 0, z + 0.4), 'laborer');
    waiter.anchor = { slot: waiter.mesh.position.clone(), facing: heading + PI };
    waiter.btsSongthaew = true;
    waiter.speed = 0;
    waiter.state = 'idle';
    waiter.stop = stop;
    const riders = [];
    if (GAMEPLAY.songthaewRiders) {
      for (let i = 0; i < 3; i++) {
        const ped = spawnPed(scene, new THREE.Vector3(x, 0, z), i === 1 ? 'tourist' : 'local');
        ped.songthaewRide = true;
        ped.stop = stop;
        ped.speed = 0;
        ped.state = 'idle';
        ped.heading = heading + PI;
        if (ped.mesh) {
          scene.remove(ped.mesh);
          v.mesh.add(ped.mesh);
          // sit the side benches under the canopy (standing y=1.08 clips the roof)
          ped.mesh.position.set((i % 2 === 0 ? -0.42 : 0.42), 0.55, -0.25 - i * 0.52);
          ped.mesh.rotation.set(0.08, PI, 0);
          const parts = ped.mesh.userData && ped.mesh.userData.parts;
          if (parts) {
            if (parts.legL) parts.legL.rotation.x = 1.22;
            if (parts.legR) parts.legR.rotation.x = 1.12;
            if (parts.shinL) parts.shinL.rotation.x = -1.08;
            if (parts.shinR) parts.shinR.rotation.x = -0.98;
            if (parts.armL) parts.armL.rotation.x = -0.4;
            if (parts.armR) parts.armR.rotation.x = -0.28;
          }
        }
        riders.push(ped);
      }
    }
    return { vehicle: v, waiter, riders, x, z, stop };
  };
  G.world.btsSongthaew = rank(bts.x + 11.5, -22, 'asok');
  G.world.phromSongthaew = rank(100 + 11.5, -22, 'phrom');
}

function makeWatBroom() {
  const g = new THREE.Group();
  g.name = 'wat-broom';
  const shaft = new THREE.Mesh(
    new THREE.CylinderGeometry(0.016, 0.02, 1.15, 5),
    new THREE.MeshStandardMaterial({ color: 0x6a4a28, roughness: 0.85 })
  );
  shaft.position.y = 0.55;
  g.add(shaft);
  const head = new THREE.Mesh(
    new THREE.BoxGeometry(0.22, 0.1, 0.08),
    new THREE.MeshStandardMaterial({ color: 0xc8b070, roughness: 0.9 })
  );
  head.position.y = 0.02;
  g.add(head);
  return g;
}

export function spawnWatSweep(scene) {
  if (!GAMEPLAY.watSweep) return;
  const temple = G.world && G.world.poi && G.world.poi.temple;
  if (!temple) return;
  G.watSweep = [];
  for (let i = 0; i < 2; i++) {
    const z = temple.z - 11.2 + i * 1.2;
    const x = temple.x - 2 + i * 3.4;
    const ped = spawnPed(scene, new THREE.Vector3(x, 0, z), 'monk');
    ped.watSweep = true;
    ped.speed = 0;
    ped.state = 'idle';
    ped._sweepT = i * 0.35;
    ped._sweepDir = 1;
    ped._sweepZ = z;
    ped._sweepX0 = temple.x - 5.5;
    ped._sweepX1 = temple.x + 6.5;
    const broom = makeWatBroom();
    broom.position.set(0.28, 0.12, 0.18);
    broom.rotation.set(0.55, 0, 0.4);
    if (ped.mesh) {
      ped.mesh.add(broom);
      ped.mesh.visible = false;
      const bowl = ped.mesh.getObjectByName('alms-bowl');
      if (bowl) bowl.visible = false;
    }
    ped._broom = broom;
    G.watSweep.push(ped);
  }
}

export function spawnBtsTuktuk(scene) {
  if (!GAMEPLAY.btsTuktuk) return;
  const bts = G.world && G.world.bts;
  if (!bts) return;
  const rank = (x, z, stop) => {
    const heading = PI / 2;
    const v = makeVehicle('tuktuk', scene);
    v.pos.set(x, 0, z);
    v.heading = heading;
    v.mesh.position.copy(v.pos);
    v.mesh.rotation.y = heading;
    v.driver = null;
    v.vel = 0;
    v.btsTuktuk = true;
    v._standHome = { x, z, heading };
    addHireSign(v, 0x21f0ff);
    const waiter = spawnPed(scene, new THREE.Vector3(x + 1.8, 0, z + 0.5), 'vendor');
    waiter.anchor = { slot: waiter.mesh.position.clone(), facing: heading + PI };
    waiter.btsTuktuk = true;
    waiter.speed = 0;
    waiter.state = 'idle';
    waiter.stop = stop;
    return { vehicle: v, waiter, x, z, stop };
  };
  G.world.btsTuktuk = rank(bts.x + 11.5, -14.2, 'asok');
  G.world.phromTuktuk = rank(100 + 11.5, -14.2, 'phrom');
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
export function spawnBoatNoodle(scene) {
  if (!GAMEPLAY.boatNoodle) return;
  const pier = G.world && G.world.poi && G.world.poi.pier;
  const x = pier ? pier.x - 2.8 : -215;
  const z = pier ? pier.z : -50;
  const g = new THREE.Group();
  g.name = 'noodle-boat';
  const hull = new THREE.Mesh(
    new THREE.BoxGeometry(1.35, 0.42, 4.2),
    new THREE.MeshStandardMaterial({ color: 0x8a3a28, roughness: 0.72 })
  );
  hull.position.y = 0.28;
  g.add(hull);
  const trim = new THREE.Mesh(
    new THREE.BoxGeometry(1.45, 0.1, 4.3),
    new THREE.MeshStandardMaterial({ color: 0xd0b050, roughness: 0.55 })
  );
  trim.position.y = 0.5;
  g.add(trim);
  const pot = new THREE.Mesh(
    new THREE.CylinderGeometry(0.28, 0.32, 0.28, 8),
    new THREE.MeshStandardMaterial({ color: 0x2a2a30, metalness: 0.45, roughness: 0.4, emissive: 0xff5510, emissiveIntensity: 0.25 })
  );
  pot.name = 'noodle-pot';
  pot.position.set(0, 0.72, 0.4);
  g.add(pot);
  const puff = new THREE.Mesh(
    new THREE.SphereGeometry(0.22, 6, 5),
    new THREE.MeshBasicMaterial({ color: 0x887766, transparent: true, opacity: 0.22, depthWrite: false })
  );
  puff.name = 'noodle-steam';
  puff.position.set(0, 1.05, 0.4);
  g.add(puff);
  const umb = new THREE.Mesh(
    new THREE.ConeGeometry(0.85, 0.32, 8),
    new THREE.MeshStandardMaterial({ color: 0xc44a2a, roughness: 0.7, side: THREE.DoubleSide })
  );
  umb.position.y = 1.85;
  umb.rotation.x = PI;
  g.add(umb);
  const pole = new THREE.Mesh(
    new THREE.CylinderGeometry(0.025, 0.025, 1.2, 5),
    new THREE.MeshStandardMaterial({ color: 0x333333 })
  );
  pole.position.y = 1.25;
  g.add(pole);
  g.position.set(x, 0.22, z);
  scene.add(g);
  const vendor = spawnPed(scene, new THREE.Vector3(x, 0, z), 'vendor');
  vendor.boatNoodle = true;
  vendor.anchor = { slot: vendor.mesh.position.clone(), facing: PI / 2 };
  vendor.speed = 0;
  vendor.state = 'idle';
  G.boatNoodle = { mesh: g, vendor, x, z0: z, t: 0.5, dir: 1 };
}

export function spawnPierWait(scene) {
  if (!GAMEPLAY.pierWait) return;
  const pier = G.world && G.world.poi && G.world.poi.pier;
  if (!pier) return;
  const x = pier.x + 2.6, z = pier.z;
  const post = new THREE.Group();
  post.name = 'pier-wait';
  const pole = new THREE.Mesh(
    new THREE.CylinderGeometry(0.04, 0.045, 1.15, 6),
    new THREE.MeshStandardMaterial({ color: 0x3a3a40, roughness: 0.55, metalness: 0.2 })
  );
  pole.position.y = 0.58;
  post.add(pole);
  const ring = new THREE.Mesh(
    new THREE.TorusGeometry(0.16, 0.045, 8, 14),
    new THREE.MeshStandardMaterial({ color: 0xe24a1a, roughness: 0.55 })
  );
  ring.name = 'pier-ring';
  ring.position.set(0, 1.05, 0.08);
  ring.rotation.x = PI / 2;
  post.add(ring);
  const stripe = new THREE.Mesh(
    new THREE.TorusGeometry(0.16, 0.02, 6, 14),
    new THREE.MeshStandardMaterial({ color: 0xf5f0e4, roughness: 0.6 })
  );
  stripe.position.copy(ring.position);
  stripe.rotation.x = PI / 2;
  post.add(stripe);
  post.position.set(x, 0, z + 2.2);
  scene.add(post);
  const waiters = [];
  for (let i = 0; i < 3; i++) {
    const px = x + (i - 1) * 0.15, pz = z - 0.4 + i * 0.95;
    const ped = spawnPed(scene, new THREE.Vector3(px, 0, pz), i === 1 ? 'office' : 'local');
    ped.pierWait = true;
    ped.speed = 0;
    ped.state = 'idle';
    ped.heading = -PI / 2;
    ped.anchor = { slot: new THREE.Vector3(px, 0, pz), facing: -PI / 2 };
    if (ped.mesh) {
      ped.mesh.rotation.y = -PI / 2;
      ped.mesh.visible = false;
    }
    const bag = new THREE.Mesh(
      new THREE.BoxGeometry(0.12, 0.18, 0.08),
      new THREE.MeshStandardMaterial({ color: pick([0xff5a23, 0x2a4a8a, 0xf5f0e4]), roughness: 0.7 })
    );
    bag.name = 'pier-bag';
    const parts = ped.mesh && ped.mesh.userData && ped.mesh.userData.parts;
    if (parts && parts.foreL) { bag.position.set(0.02, -0.28, 0.04); parts.foreL.add(bag); }
    else if (ped.mesh) { bag.position.set(-0.16, 0.95, 0.08); ped.mesh.add(bag); }
    ped._pierBag = bag;
    waiters.push(ped);
  }
  G.pierWait = { mesh: post, waiters, x, z, t: 0 };
  const cx = x - 1.6, cz = z + 2.2;
  const clerk = spawnPed(scene, new THREE.Vector3(cx, 0, cz), 'office');
  recolorTorso(clerk.mesh.userData.parts, 0x1a5a8a, 0.7);
  clerk.pierWait = true;
  clerk.pierClerk = true;
  clerk.speed = 0;
  clerk.state = 'idle';
  clerk.heading = PI / 2;
  clerk.anchor = { slot: new THREE.Vector3(cx, 0, cz), facing: PI / 2 };
  if (clerk.mesh) {
    clerk.mesh.rotation.y = PI / 2;
    clerk.mesh.visible = false;
  }
  const ticket = new THREE.Mesh(
    new THREE.BoxGeometry(0.08, 0.12, 0.02),
    new THREE.MeshStandardMaterial({ color: 0xf0ead8, roughness: 0.7 })
  );
  ticket.name = 'pier-ticket';
  const parts = clerk.mesh && clerk.mesh.userData && clerk.mesh.userData.parts;
  if (parts && parts.foreR) {
    ticket.position.set(0.02, -0.22, 0.06);
    parts.foreR.add(ticket);
  } else if (clerk.mesh) {
    ticket.position.set(0.22, 1.05, 0.12);
    clerk.mesh.add(ticket);
  }
  G.pierClerk = { ped: clerk, x: cx, z: cz, t: 0 };
  const fx = pier.x + 5.2, fz = pier.z + 9.4;
  const fisher = spawnPed(scene, new THREE.Vector3(fx, 0, fz), 'laborer');
  recolorTorso(fisher.mesh.userData.parts, 0x3a5a4a, 0.7);
  fisher.pierWait = true;
  fisher.pierFish = true;
  fisher.speed = 0;
  fisher.state = 'idle';
  fisher.heading = -PI / 2;
  fisher.anchor = { slot: new THREE.Vector3(fx, 0, fz), facing: -PI / 2 };
  if (fisher.mesh) {
    fisher.mesh.rotation.y = -PI / 2;
    fisher.mesh.visible = false;
  }
  const rod = new THREE.Mesh(
    new THREE.CylinderGeometry(0.012, 0.018, 1.35, 5),
    new THREE.MeshStandardMaterial({ color: 0x4a3a22, roughness: 0.7 })
  );
  rod.name = 'pier-rod';
  const fp = fisher.mesh && fisher.mesh.userData && fisher.mesh.userData.parts;
  if (fp && fp.foreR) {
    rod.position.set(0.02, -0.55, 0.08);
    rod.rotation.z = 0.85;
    fp.foreR.add(rod);
  } else if (fisher.mesh) {
    rod.position.set(0.22, 1.15, 0.12);
    rod.rotation.z = 0.85;
    fisher.mesh.add(rod);
  }
  G.pierFish = { ped: fisher, x: fx, z: fz, t: 0 };
}

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

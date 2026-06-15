// Bangkok 3D — Phase 1 Prototype
// Single-file game in vanilla three.js. Procedural geometry, no external assets.
// Sections: Engine · World · Player · Vehicles · AI · Combat · Wanted · Mission · HUD · Loop

import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { makeAudio } from './audio.js';
import { makeInput } from './input.js';
export * from './npcs.js';
import {
  CROWD_CURVE, buildClusterAnchors, crowdFactor, crowdTarget, makeBarkSprite, resyncCrowd, spawnAnchoredPed, spawnBark, spawnSpikeStrip, updateArmorPickups, updateBarks, updateClusters, updateDogs, updateFoodStalls, updateMuggings, updatePeds, updateSpikes, updateVigilante, vigilanteEnd, vigilanteSpawnTarget
} from './npcs.js';
export * from './combat.js';
import {
  cycleWeapon, doBulletRaycast, doMeleeHit, firePistol, fireSMG, fireShotgun, scarePeds, triggerHitStop, updateAmmoHud, updateBullets, updateCombat
} from './combat.js';
export * from './hud.js';
import {
  bindHud
} from './hud.js';
export * from './missions.js';
import {
  makeMissionSystem
} from './missions.js';
export * from './daynight.js';
import {
  DAY_LENGTH, FESTIVAL_PERIOD, KRATHONG_COUNT, RIVER_CX, festivalScheduled, makeKrathong, makeSkyLantern, spawnSkyLantern, startFestival, stopFestival, updateDayNight, updateFestival
} from './daynight.js';
import {
  makeStaticBaker, PI, TAU, clamp, lerp, rand, irand, pick, sign, dist2, COLORS, G,
  PRICE, PAINT_COLORS, ROAD_WIDTH, PED_TARGET, GAMEPLAY, _camTarget, _camOffset, _fireDir,
  _ray, _bbox, _vBox, _blackColor, disposeObject, BLOCK, GRID, HALF, lerpAngle
} from './core.js';

// =============================================================================
// 0. UTILITIES
// =============================================================================

// (moved to ./core.js)

// pooled fire FX lights (created lazily, reused every shot, decayed in the loop)
let _copsKilled = 0;

// Bump wanted level and refresh the "last seen" tracker. Replaces the same
// three-line pattern that was copy-pasted across combat/cop code.
export function raiseWanted(n) {
  const prev = G.wanted.stars;
  G.wanted.stars = Math.max(G.wanted.stars, n);
  G.wanted.lastSeenAt = performance.now();
  G.wanted.lastSeenPos.copy(G.player.group.position);
  if (G.wanted.stars > prev) {                 // escalation feedback
    if (G.hud && G.hud.flashWanted) G.hud.flashWanted();
    if (G.hud) G.hud.showNotif('WANTED ' + '★'.repeat(G.wanted.stars));
    if (G.audio && G.audio.siren) G.audio.siren();
  }
}

// Apply damage to the player, soaking into armor first when enabled.
export function damagePlayer(amount) {
  const p = G.player;
  if (GAMEPLAY.armor && p.armor > 0) {
    const absorbed = Math.min(p.armor, amount * 0.6);
    p.armor -= absorbed;
    amount  -= absorbed;
  }
  p.hp -= amount;
  p.hitFlashT = 0.3;
  p.regenLockT = 5;   // no passive regen for a few seconds after taking a hit
  if (p.hp <= 0) gameOver();
}

// Award credit for a downed cop; first kill hands over the pistol (README).
export function onCopKilled() {
  _copsKilled++;
  if (GAMEPLAY.pistolOnCopKill && _copsKilled === 1 && !G.player.weapons.pistol) {
    G.player.weapons.pistol = true;
    G.player.pistolAmmo = G.player.pistolMag;
    updateAmmoHud();
    G.hud.showNotif('Picked up a 9mm');
  }
  // sustained cop-killing brings out the unmarked Crime Suppression units (3★)
  if (_copsKilled >= 3 && G.wanted.stars < 3) {
    raiseWanted(3);
    G.hud.showNotif('Crime Suppression deployed ★★★');
  }
  if (_copsKilled >= 6 && G.wanted.stars < 4) {
    raiseWanted(4);
    G.hud.showNotif('SWAT deployed ★★★★');
  }
}

// (moved to ./core.js)

// =============================================================================
// 1. AUDIO → ./audio.js

// =============================================================================
// 2. INPUT → ./input.js

// =============================================================================
// 3. WORLD GENERATION — Sukhumvit, procedural
// =============================================================================

// Block-grid: ~500x500m playable. We use a 10x10 block grid, each block ~50m.
// Roads on the grid lines. Sois are smaller cross streets. BTS elevated track
// runs east-west down the middle on concrete pillars.

// (moved to ./core.js)

export function buildWorld(scene) {
  const world = {
    bounds: { min: new THREE.Vector3(-HALF, 0, -HALF), max: new THREE.Vector3(HALF, 0, HALF) },
    buildings: [],       // {pos, size, mesh}
    intersections: [],   // grid vertex positions (for traffic & cops)
    spawns: { player: new THREE.Vector3(0, 0.0, 100) },
    poi: {},             // points of interest (mission markers)
    sevenElevens: [],
    minimap: null,       // canvas-rendered base layer
  };

  // Day/night caches — populated below, consumed by updateDayNight() so it never
  // has to traverse the whole scene graph each frame.
  G.nightLights = [];    // [{light, base}] accent PointLights that scale with night
  G.nightEmissive = [];  // [{mat, dayIntensity, nightIntensity}] materials that ramp at night

  // Scratch transform objects, reused while composing InstancedMesh matrices.
  const _m = new THREE.Matrix4();
  const _m2 = new THREE.Matrix4();
  const _q = new THREE.Quaternion();
  const _e = new THREE.Euler();
  const _p = new THREE.Vector3();
  const _s = new THREE.Vector3();

  // Build one InstancedMesh from an array of Matrix4 and add it to the scene.
  // Returns null (and adds nothing) for empty arrays so callers can stay terse.
  function addInstanced(geo, mat, matrices, cast, receive) {
    if (!matrices.length) return null;
    const inst = new THREE.InstancedMesh(geo, mat, matrices.length);
    for (let k = 0; k < matrices.length; k++) inst.setMatrixAt(k, matrices[k]);
    inst.instanceMatrix.needsUpdate = true;
    // Instances are positioned via per-instance matrices on origin-centered base
    // geometry, so the default bounding sphere (base geo at the world origin) would
    // frustum-cull the entire batch whenever the origin is off-screen. These batches
    // span the whole map and can't be culled as a unit anyway, so disable per-object
    // frustum culling (same as the rain/smoke Points).
    inst.frustumCulled = false;
    inst.castShadow = !!cast;
    inst.receiveShadow = !!receive;
    scene.add(inst);
    return inst;
  }

  // Static-geometry bakers (flushed at the end of buildWorld). `baker` handles the
  // shadow-casting solids (buildings, sidewalks); `flatBaker` the ground-hugging
  // overlays (road stripes) that neither cast nor receive. Helper bakes an
  // axis-rotated/positioned piece via the shared scratch matrix.
  const baker = makeStaticBaker();
  const flatBaker = makeStaticBaker();
  const ONE = new THREE.Vector3(1, 1, 1);
  const _bm = new THREE.Matrix4(), _bq = new THREE.Quaternion(), _be = new THREE.Euler(), _bp = new THREE.Vector3();
  function bake(target, geo, material, x, y, z, rotY, rotX, rotZ, cast, receive) {
    _be.set(rotX || 0, rotY || 0, rotZ || 0);
    _bq.setFromEuler(_be);
    _bp.set(x, y, z);
    _bm.compose(_bp, _bq, ONE);
    target.add(geo, _bm, material, cast, receive);
  }
  // Bake a built (but not scene-added) Group of static meshes: resolve each
  // child's world matrix and feed it to the baker, grouped by its own material.
  // Lets the prop-building code stay as-is — just bakeGroup() instead of scene.add.
  function bakeGroup(group, cast, receive) {
    group.updateMatrixWorld(true);
    group.traverse(o => {
      if (o.isMesh) baker.add(o.geometry, o.matrixWorld, o.material, cast, receive);
    });
  }

  // ---- ground / asphalt ----
  const groundMat = new THREE.MeshStandardMaterial({ color: COLORS.asphalt, roughness: 0.9 });
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(HALF*2 + 200, HALF*2 + 200, 1, 1), groundMat);
  ground.rotation.x = -PI/2; ground.position.y = 0; ground.receiveShadow = true;
  scene.add(ground);

  // ---- road grid ----
  const roadMat = new THREE.MeshStandardMaterial({ color: 0x3a3d42, roughness: 0.85 });
  const stripeMat = new THREE.MeshBasicMaterial({ color: 0xffe699 });
  const sidewalkMat = new THREE.MeshStandardMaterial({ color: COLORS.sidewalk, roughness: 1.0 });

  const ROAD_W = 12, SIDEWALK_W = 3;

  // Stripe base geometries — reused (cloned + baked) by the flat baker, not added
  // to the scene directly. ~1,800 individual stripe planes collapse to one mesh.
  const stripeGeoEW = new THREE.PlaneGeometry(3, 0.4);
  const stripeGeoNS = new THREE.PlaneGeometry(0.4, 3);

  // Build major roads on grid lines (avenues)
  for (let i = -GRID/2; i <= GRID/2; i++) {
    const p = i * BLOCK;
    // east-west road
    const rdEW = new THREE.Mesh(new THREE.PlaneGeometry(HALF*2, ROAD_W), roadMat);
    rdEW.rotation.x = -PI/2; rdEW.position.set(0, 0.02, p); rdEW.receiveShadow = true; scene.add(rdEW);
    // north-south road
    const rdNS = new THREE.Mesh(new THREE.PlaneGeometry(ROAD_W, HALF*2), roadMat);
    rdNS.rotation.x = -PI/2; rdNS.position.set(p, 0.02, 0); rdNS.receiveShadow = true; scene.add(rdNS);
    // center stripes (baked → merged)
    for (let s = -HALF+10; s <= HALF-10; s += 6) {
      bake(flatBaker, stripeGeoEW, stripeMat, s, 0.025, p, 0, -PI/2, 0, false, false);
      bake(flatBaker, stripeGeoNS, stripeMat, p, 0.025, s, 0, -PI/2, 0, false, false);
    }
  }

  // intersections (grid vertices) — used to place lamps, traffic & cops
  for (let i = -GRID/2; i <= GRID/2; i++) {
    for (let j = -GRID/2; j <= GRID/2; j++) {
      world.intersections.push(new THREE.Vector3(i*BLOCK, 0, j*BLOCK));
    }
  }

  // sidewalks bordering blocks (baked → one merged mesh)
  const blockHalf = BLOCK/2 - ROAD_W/2;
  const swLong = new THREE.PlaneGeometry(BLOCK - ROAD_W, SIDEWALK_W*2);
  const swShort = new THREE.PlaneGeometry(SIDEWALK_W*2, BLOCK - ROAD_W - SIDEWALK_W*4);
  for (let i = -GRID/2; i < GRID/2; i++) {
    for (let j = -GRID/2; j < GRID/2; j++) {
      const cx = (i + 0.5) * BLOCK;
      const cz = (j + 0.5) * BLOCK;
      bake(baker, swLong,  sidewalkMat, cx, 0.04, cz - blockHalf + SIDEWALK_W, 0, -PI/2, 0, false, true);
      bake(baker, swLong,  sidewalkMat, cx, 0.04, cz + blockHalf - SIDEWALK_W, 0, -PI/2, 0, false, true);
      bake(baker, swShort, sidewalkMat, cx - blockHalf + SIDEWALK_W, 0.04, cz, 0, -PI/2, 0, false, true);
      bake(baker, swShort, sidewalkMat, cx + blockHalf - SIDEWALK_W, 0.04, cz, 0, -PI/2, 0, false, true);
    }
  }
  swLong.dispose(); swShort.dispose();

  // ---- buildings ----
  // Buildings flank the road on all 4 sides of each block, forming a street canyon.
  // Each block: 4 corner buildings + a row of shop-houses marching along each side
  // between the corners. The block interior becomes a small courtyard / alley gap.
  const buildingMatPool = COLORS.building.map(c => new THREE.MeshStandardMaterial({
    color: c, roughness: 0.85,
  }));
  // Shop-level (ground floor) palette — Bangkok shophouse fronts: cream, terracotta,
  // faded pink, dirty white, gray-blue. Different from upper-floor colors so each
  // building reads as having a distinct "shop band" at street level.
  const SHOP_COLORS = [0xe0c885, 0xa84a3a, 0xd49a92, 0xd9d2c7, 0x7a8fa0, 0xc9b48e, 0xb8a07a];
  const shopMatPool = SHOP_COLORS.map(c => new THREE.MeshStandardMaterial({
    color: c, roughness: 0.95,
  }));
  // windows: procedurally drawn grid, split into two textures sharing one cell
  // layout — a muted daytime albedo (glass tower in sunlight, not "lit at night")
  // and a bright-cells-on-black emissive that carries the night look. One shared
  // material for all window planes (instances cheaply, one nightEmissive entry).
  const winTex = makeWindowTexture();
  const winMat = new THREE.MeshStandardMaterial({
    map: winTex.map, emissiveMap: winTex.emissiveMap, emissive: 0xffe6a8, emissiveIntensity: 0.0, roughness: 0.6,
  });
  G.nightEmissive.push({ mat: winMat, dayIntensity: 0.0, nightIntensity: 1.0 });

  const SIDEWALK_EDGE = BLOCK/2 - ROAD_W/2 - SIDEWALK_W*2; // 13: distance from block center to inner sidewalk edge
  const SHOP_LEVEL_H = 4; // height of ground-floor shop band

  // ---- Rooftop-decor instancing pools ----
  // placeBuilding scatters water tanks, AC condensers, antennas and dishes across
  // many rooftops. Rather than one Mesh each (thousands of draw calls), we collect
  // a per-instance Matrix4 here and build one InstancedMesh per prop type afterwards.
  // Unit geometries (radius 1 / height 1) are scaled per instance via the matrix.
  const tankGeo = new THREE.CylinderGeometry(1, 1, 1, 10);   // scaled by (R, H, R)
  const tankMatDark = new THREE.MeshStandardMaterial({ color: 0x202020, roughness: 0.7 });
  const tankMatBlue = new THREE.MeshStandardMaterial({ color: 0x355088, roughness: 0.7 });
  const tankLegGeo = new THREE.BoxGeometry(0.08, 0.3, 0.08);
  const tankLegMat = new THREE.MeshStandardMaterial({ color: 0x222222, roughness: 0.9 });
  const acGeo = new THREE.BoxGeometry(0.55, 0.35, 0.4);
  const acMat = new THREE.MeshStandardMaterial({ color: 0xb8b8b8, roughness: 0.6, metalness: 0.4 });
  const antGeo = new THREE.CylinderGeometry(0.035, 0.035, 1, 6); // scaled by (1, H, 1)
  const antMat = new THREE.MeshStandardMaterial({ color: 0x555555, roughness: 0.6 });
  const dishGeo = new THREE.SphereGeometry(0.32, 8, 6, 0, TAU, 0, PI/3);
  const dishMat = new THREE.MeshStandardMaterial({ color: 0xdddddd, roughness: 0.4, metalness: 0.3 });
  const tankDarkM = [], tankBlueM = [], tankLegM = [], acM = [], antM = [], dishM = [];
  // Neon sign materials pooled by color: every sign of a given color shares one
  // emissive material (and so one nightEmissive ramp entry) and merges into one
  // mesh — turning hundreds of per-sign materials + draw calls into six of each.
  const neonMatPool = new Map();
  // Awning tarp + hanging-sign materials pooled by color for the same reason.
  const awningMatPool = new Map();
  const getAwningMat = c => {
    let m = awningMatPool.get(c);
    if (!m) { m = new THREE.MeshStandardMaterial({ color: c, roughness: 0.85, side: THREE.DoubleSide }); awningMatPool.set(c, m); }
    return m;
  };
  const hangSignMatPool = new Map();
  const getHangSignMat = c => {
    let m = hangSignMatPool.get(c);
    if (!m) { m = new THREE.MeshBasicMaterial({ color: c }); hangSignMatPool.set(c, m); }
    return m;
  };
  const hangArmMat = new THREE.MeshStandardMaterial({ color: 0x222222 });

  // placeBuilding: shop band on bottom 4m + upper floors above, plus optional
  // window strips and neon sign on the faces that look toward a road. All of the
  // static boxes/planes are routed through the baker (merged per material at the
  // end of buildWorld) rather than added as individual meshes.
  // frontFaces: array of {ax: 'x'|'z', sign: +1|-1} for each road-facing face.
  function placeBuilding(bx, bz, dimX, dimZ, h, frontFaces) {
    const upperH = Math.max(0.1, h - SHOP_LEVEL_H);
    const upperMat = buildingMatPool[irand(0, buildingMatPool.length - 1)];
    const upperGeo = new THREE.BoxGeometry(dimX, upperH, dimZ);
    bake(baker, upperGeo, upperMat, bx, SHOP_LEVEL_H + upperH/2, bz, 0, 0, 0, true, true);
    upperGeo.dispose();

    const shopMat = shopMatPool[irand(0, shopMatPool.length - 1)];
    const shopGeo = new THREE.BoxGeometry(dimX, SHOP_LEVEL_H, dimZ);
    bake(baker, shopGeo, shopMat, bx, SHOP_LEVEL_H/2, bz, 0, 0, 0, true, true);
    shopGeo.dispose();

    // Collision AABB only — no mesh ref needed; bullet raycasts test pos/size
    // directly (doBulletRaycast), and the resolvers always used pos/size anyway.
    world.buildings.push({
      pos: new THREE.Vector3(bx, h/2, bz),
      size: new THREE.Vector3(dimX, h, dimZ),
    });

    // window strip on tall buildings — emissive panels on each road-facing face
    if (h > 22) {
      const winH = upperH - 2;
      for (const face of frontFaces) {
        if (face.ax === 'z') {
          const winW = dimX - 1.5;
          if (winW <= 0.5) continue;
          const g = new THREE.PlaneGeometry(winW, winH);
          bake(baker, g, winMat, bx, SHOP_LEVEL_H + upperH/2, bz + face.sign * (dimZ/2 + 0.02), face.sign < 0 ? PI : 0, 0, 0, false, false);
          g.dispose();
        } else {
          const winW = dimZ - 1.5;
          if (winW <= 0.5) continue;
          const g = new THREE.PlaneGeometry(winW, winH);
          bake(baker, g, winMat, bx + face.sign * (dimX/2 + 0.02), SHOP_LEVEL_H + upperH/2, bz, face.sign > 0 ? PI/2 : -PI/2, 0, 0, false, false);
          g.dispose();
        }
      }
    }

    // neon sign on shop level for short/mid buildings — on the first road-facing face.
    // Self-illuminated via an emissive material (no real PointLight) so hundreds of
    // signs cost nothing at runtime; the emissive ramps up at night via nightEmissive.
    if (h < 32 && Math.random() < 0.8 && frontFaces.length > 0) {
      const face = frontFaces[0];
      const neonColor = pick(COLORS.neon);
      const faceWidth = face.ax === 'z' ? dimX : dimZ;
      const sw = rand(2, Math.min(faceWidth, 6));
      const sh = rand(1.0, 2.0);
      let signMat = neonMatPool.get(neonColor);
      if (!signMat) {
        signMat = new THREE.MeshStandardMaterial({
          color: neonColor, emissive: neonColor, emissiveIntensity: 0.15, roughness: 0.5,
        });
        neonMatPool.set(neonColor, signMat);
        G.nightEmissive.push({ mat: signMat, dayIntensity: 0.15, nightIntensity: 1.4 });
      }
      const g = new THREE.PlaneGeometry(sw, sh);
      if (face.ax === 'z') {
        bake(baker, g, signMat, bx, rand(2.5, 3.7), bz + face.sign * (dimZ/2 + 0.05), face.sign < 0 ? PI : 0, 0, 0, false, false);
      } else {
        bake(baker, g, signMat, bx + face.sign * (dimX/2 + 0.05), rand(2.5, 3.7), bz, face.sign > 0 ? PI/2 : -PI/2, 0, 0, false, false);
      }
      g.dispose();
    }

    // awning: tarp slab projecting out from the shop level over the sidewalk
    if (h < 34 && Math.random() < 0.55 && frontFaces.length > 0) {
      const tarpColors = [0x3a5a8a, 0xa83a3a, 0x3a8a5a, 0xcfa83a, 0x4a4a4a, 0xc26b3a];
      const tarpMat = getAwningMat(pick(tarpColors));
      for (const face of frontFaces) {
        const projDepth = rand(1.6, 2.4);
        const projY = SHOP_LEVEL_H - 0.35;
        if (face.ax === 'z') {
          const aw = Math.max(0.5, dimX - 0.6);
          const g = new THREE.BoxGeometry(aw, 0.06, projDepth);
          bake(baker, g, tarpMat, bx, projY, bz + face.sign * (dimZ/2 + projDepth/2), 0, -0.05 * face.sign, 0, false, false);
          g.dispose();
        } else {
          const aw = Math.max(0.5, dimZ - 0.6);
          const g = new THREE.BoxGeometry(projDepth, 0.06, aw);
          bake(baker, g, tarpMat, bx + face.sign * (dimX/2 + projDepth/2), projY, bz, 0, 0, 0.05 * face.sign, false, false);
          g.dispose();
        }
      }
    }

    // Rooftop detail: water tanks, AC condensers, antennas, occasional setback cap.
    // These break up the cube silhouette and read "Bangkok" at any distance.
    if (h > 8 && dimX > 2.5 && dimZ > 2.5) {
      const roofY = h;

      // Setback: tall buildings get a smaller cap on top.
      if (h > 42 && Math.random() < 0.32) {
        const setH = rand(6, 14);
        const setX = Math.max(2, dimX * rand(0.55, 0.78));
        const setZ = Math.max(2, dimZ * rand(0.55, 0.78));
        const setMat = buildingMatPool[irand(0, buildingMatPool.length - 1)];
        const setGeo = new THREE.BoxGeometry(setX, setH, setZ);
        bake(baker, setGeo, setMat, bx, roofY + setH/2, bz, 0, 0, 0, true, true);
        setGeo.dispose();
        // window strip on the setback's main face
        if (frontFaces.length > 0 && setH > 5) {
          const face = frontFaces[0];
          const g = new THREE.PlaneGeometry(face.ax === 'z' ? setX - 1 : setZ - 1, setH - 1.5);
          if (face.ax === 'z') {
            bake(baker, g, winMat, bx, roofY + setH/2, bz + face.sign * (setZ/2 + 0.02), face.sign < 0 ? PI : 0, 0, 0, false, false);
          } else {
            bake(baker, g, winMat, bx + face.sign * (setX/2 + 0.02), roofY + setH/2, bz, face.sign > 0 ? PI/2 : -PI/2, 0, 0, false, false);
          }
          g.dispose();
        }
      }

      // Water tank (cylinder on stubby legs) — iconic Bangkok rooftop. Instanced:
      // unit cylinder scaled to (R, H, R); legs are a shared box instanced too.
      if (Math.random() < 0.6) {
        const tankR = rand(0.45, 0.85);
        const tankH = rand(1.2, 2.0);
        const tankDark = Math.random() < 0.72;
        const tankX = bx + rand(-dimX/2 + tankR + 0.3, dimX/2 - tankR - 0.3);
        const tankZ = bz + rand(-dimZ/2 + tankR + 0.3, dimZ/2 - tankR - 0.3);
        _p.set(tankX, roofY + tankH/2 + 0.3, tankZ);
        _q.identity();
        _s.set(tankR, tankH, tankR);
        (tankDark ? tankDarkM : tankBlueM).push(_m.compose(_p, _q, _s).clone());
        for (const [lx, lz] of [[-tankR*0.7, -tankR*0.7], [tankR*0.7, -tankR*0.7], [-tankR*0.7, tankR*0.7], [tankR*0.7, tankR*0.7]]) {
          _p.set(tankX + lx, roofY + 0.15, tankZ + lz);
          _q.identity();
          _s.set(1, 1, 1);
          tankLegM.push(_m.compose(_p, _q, _s).clone());
        }
      }

      // AC condensers — small clustered boxes (instanced, shared geo/material)
      const numAC = irand(0, 3);
      for (let k = 0; k < numAC; k++) {
        _p.set(
          bx + rand(-dimX/2 + 0.4, dimX/2 - 0.4),
          roofY + 0.175,
          bz + rand(-dimZ/2 + 0.4, dimZ/2 - 0.4)
        );
        _q.setFromEuler(_e.set(0, rand(0, TAU), 0));
        _s.set(1, 1, 1);
        acM.push(_m.compose(_p, _q, _s).clone());
      }

      // Antenna / satellite dish (instanced; antenna is a unit cylinder scaled in Y)
      if (Math.random() < 0.5) {
        const antH = rand(1.5, 3);
        const antX = bx + rand(-dimX/2 + 0.3, dimX/2 - 0.3);
        const antZ = bz + rand(-dimZ/2 + 0.3, dimZ/2 - 0.3);
        _p.set(antX, roofY + antH/2, antZ);
        _q.identity();
        _s.set(1, antH, 1);
        antM.push(_m.compose(_p, _q, _s).clone());
        if (Math.random() < 0.45) {
          _p.set(antX + 0.25, roofY + antH * 0.7, antZ);
          _q.setFromEuler(_e.set(0, 0, -PI/2));
          _s.set(1, 1, 1);
          dishM.push(_m.compose(_p, _q, _s).clone());
        }
      }
    }

    // perpendicular hanging sign — sticks out from the facade (Thai-shophouse style)
    if (h > 8 && Math.random() < 0.35 && frontFaces.length > 0) {
      const face = frontFaces[0];
      const armLen = 1.2;
      const signW = rand(1.0, 1.6), signH = rand(0.5, 0.9);
      const signMat = getHangSignMat(pick([0xa84a3a, 0xcfa83a, 0xe0c885, 0x3a8a5a, 0x1a1a1a, 0xb24bff]));
      const heightY = Math.min(h - 1, rand(4.5, 7));
      if (face.ax === 'z') {
        const ga = new THREE.BoxGeometry(0.05, 0.05, armLen);
        bake(baker, ga, hangArmMat, bx, heightY, bz + face.sign * (dimZ/2 + armLen/2), 0, 0, 0, false, false);
        ga.dispose();
        const gs = new THREE.BoxGeometry(signW, signH, 0.05);
        bake(baker, gs, signMat, bx, heightY - signH/2 - 0.05, bz + face.sign * (dimZ/2 + armLen), 0, 0, 0, false, false);
        gs.dispose();
      } else {
        const ga = new THREE.BoxGeometry(armLen, 0.05, 0.05);
        bake(baker, ga, hangArmMat, bx + face.sign * (dimX/2 + armLen/2), heightY, bz, 0, 0, 0, false, false);
        ga.dispose();
        const gs = new THREE.BoxGeometry(0.05, signH, signW);
        bake(baker, gs, signMat, bx + face.sign * (dimX/2 + armLen), heightY - signH/2 - 0.05, bz, 0, 0, 0, false, false);
        gs.dispose();
      }
    }
  }

  // Temple block — replaces normal buildings in one block with a wat compound.
  const TEMPLE_I = 2, TEMPLE_J = -2;
  const RIVER_I = -GRID/2;  // westmost column (x ≈ -250..-200) is the Chao Phraya
  const GARAGE_I = 3, GARAGE_J = -1;  // block reserved for the U-Spray garage
  const YAO_I = -2, YAO_J0 = 2, YAO_J1 = 3;  // two-block Yaowarat market street
  const GUN_I = 3, GUN_J = 1;  // block reserved for the gun shop
  const SAFE_I = -1, SAFE_J = 1;  // block reserved for the buyable safehouse (≈ -25, 75)

  for (let i = -GRID/2; i < GRID/2; i++) {
    for (let j = -GRID/2; j < GRID/2; j++) {
      if (i === TEMPLE_I && j === TEMPLE_J) continue; // temple placed after loop
      if (i === RIVER_I) continue;                    // river column — no buildings
      if (i === GARAGE_I && j === GARAGE_J) continue; // U-Spray garage block
      if (i === SAFE_I && j === SAFE_J) continue;      // safehouse block
      if (i === YAO_I && (j === YAO_J0 || j === YAO_J1)) continue; // Yaowarat market
      if (i === GUN_I && j === GUN_J) continue; // gun shop block
      const cx = (i + 0.5) * BLOCK;
      const cz = (j + 0.5) * BLOCK;

      // Tall-building bias: central blocks more likely to have skyscrapers,
      // outer blocks more likely to be shop-houses.
      const distFromCenter = Math.hypot(i + 0.5, j + 0.5);
      const tallChance = lerp(0.32, 0.06, clamp(distFromCenter / (GRID/2), 0, 1));

      // ---- 4 corner buildings ----
      for (const [sx, sz] of [[+1,+1],[+1,-1],[-1,+1],[-1,-1]]) {
        const csx = rand(7, 9), csz = rand(7, 9);
        const bx = cx + sx * (SIDEWALK_EDGE - csx/2);
        const bz = cz + sz * (SIDEWALK_EDGE - csz/2);
        const isTall = Math.random() < tallChance * 1.4;
        const h = isTall ? rand(45, 95) : rand(10, 26);
        placeBuilding(bx, bz, csx, csz, h, [
          { ax: 'z', sign: sz },
          { ax: 'x', sign: sx },
        ]);
      }

      // ---- 4 sides — march along the sidewalk between corner zones ----
      const sides = [
        { ax: 'z', sign: +1 }, // north side: buildings face +z
        { ax: 'z', sign: -1 }, // south side
        { ax: 'x', sign: +1 }, // east side
        { ax: 'x', sign: -1 }, // west side
      ];
      // Corner zones occupy ±SIDEWALK_EDGE inward by ~9m. Side marching avoids them.
      const SIDE_END = SIDEWALK_EDGE - 9;
      for (const side of sides) {
        let cursor = -SIDE_END + rand(0, 1);
        while (SIDE_END - cursor >= 4.5) {
          const remaining = SIDE_END - cursor;
          const wantBig = Math.random() < 0.2;
          const w = Math.min(remaining, wantBig ? rand(10, 16) : rand(4.5, 8.5));
          const d = rand(7, 9);
          const isTall = Math.random() < (wantBig ? tallChance * 1.5 : tallChance * 0.4);
          const h = isTall ? rand(40, 90) : rand(9, 24);

          let bx, bz, dimX, dimZ;
          if (side.ax === 'z') {
            bx = cx + cursor + w/2;
            bz = cz + side.sign * (SIDEWALK_EDGE - d/2);
            dimX = w; dimZ = d;
          } else {
            bz = cz + cursor + w/2;
            bx = cx + side.sign * (SIDEWALK_EDGE - d/2);
            dimX = d; dimZ = w;
          }
          placeBuilding(bx, bz, dimX, dimZ, h, [{ ax: side.ax, sign: side.sign }]);

          cursor += w + rand(0.0, 0.8);
        }
      }
    }
  }

  // ---- Build rooftop-decor InstancedMeshes from the matrices gathered above ----
  addInstanced(tankGeo, tankMatDark, tankDarkM, true, false); // tanks cast shadow
  addInstanced(tankGeo, tankMatBlue, tankBlueM, true, false);
  addInstanced(tankLegGeo, tankLegMat, tankLegM, false, false);
  addInstanced(acGeo, acMat, acM, false, false);
  addInstanced(antGeo, antMat, antM, false, false);
  addInstanced(dishGeo, dishMat, dishM, false, false);

  // ---- Temple compound (wat) — a landmark block with viharn + chedi ----
  {
    const cx = (TEMPLE_I + 0.5) * BLOCK;
    const cz = (TEMPLE_J + 0.5) * BLOCK;
    const wallMat = new THREE.MeshStandardMaterial({ color: 0xddd0b8, roughness: 0.95 });
    const wallH = 2.4;
    const wallExtent = SIDEWALK_EDGE;
    // perimeter wall with gaps for gates (south + east gates)
    function wallStrip(x, y, z, sx, sy, sz) {
      const w = new THREE.Mesh(new THREE.BoxGeometry(sx, sy, sz), wallMat);
      w.position.set(x, y, z); w.castShadow = true; w.receiveShadow = true; scene.add(w);
    }
    // north + west walls full, south + east walls with a gap in the middle (gate)
    wallStrip(cx, wallH/2, cz + wallExtent, wallExtent*2, wallH, 0.7);
    wallStrip(cx - wallExtent, wallH/2, cz, 0.7, wallH, wallExtent*2);
    // south wall: two segments leaving a 4m gate
    wallStrip(cx - (wallExtent+3)/2, wallH/2, cz - wallExtent, wallExtent - 3, wallH, 0.7);
    wallStrip(cx + (wallExtent+3)/2, wallH/2, cz - wallExtent, wallExtent - 3, wallH, 0.7);
    // east wall: two segments leaving a gate
    wallStrip(cx + wallExtent, wallH/2, cz - (wallExtent+3)/2, 0.7, wallH, wallExtent - 3);
    wallStrip(cx + wallExtent, wallH/2, cz + (wallExtent+3)/2, 0.7, wallH, wallExtent - 3);

    // Main viharn (hall) — cream walls with stacked golden roofs
    const viharnMat = new THREE.MeshStandardMaterial({ color: 0xf5ead8, roughness: 0.85 });
    const roofMat = new THREE.MeshStandardMaterial({ color: 0xd9a134, roughness: 0.5, metalness: 0.65 });
    const viharn = new THREE.Mesh(new THREE.BoxGeometry(13, 5.5, 8), viharnMat);
    viharn.position.set(cx + 1.5, 2.75, cz + 1);
    viharn.castShadow = true; viharn.receiveShadow = true; scene.add(viharn);
    // tiered pyramid roof (3 levels)
    const r1 = new THREE.Mesh(new THREE.ConeGeometry(9.5, 3.6, 4), roofMat);
    r1.position.set(cx + 1.5, 7.5, cz + 1); r1.rotation.y = PI/4; r1.castShadow = true; scene.add(r1);
    const r2 = new THREE.Mesh(new THREE.ConeGeometry(7, 3.0, 4), roofMat);
    r2.position.set(cx + 1.5, 10.0, cz + 1); r2.rotation.y = PI/4; scene.add(r2);
    const r3 = new THREE.Mesh(new THREE.ConeGeometry(4.5, 2.6, 4), roofMat);
    r3.position.set(cx + 1.5, 12.4, cz + 1); r3.rotation.y = PI/4; scene.add(r3);
    const spire = new THREE.Mesh(new THREE.ConeGeometry(0.3, 2.2, 6), roofMat);
    spire.position.set(cx + 1.5, 14.8, cz + 1); scene.add(spire);

    // Chedi (white bell-spire) in corner
    const chediWhiteMat = new THREE.MeshStandardMaterial({ color: 0xf3eede, roughness: 0.75 });
    const chediGoldMat = new THREE.MeshStandardMaterial({ color: 0xd9a134, roughness: 0.5, metalness: 0.6 });
    const chediX = cx - 8, chediZ = cz - 6;
    const cBase = new THREE.Mesh(new THREE.CylinderGeometry(2.2, 2.8, 3, 12), chediWhiteMat);
    cBase.position.set(chediX, 1.5, chediZ); cBase.castShadow = true; scene.add(cBase);
    const cBell = new THREE.Mesh(new THREE.SphereGeometry(1.95, 14, 10, 0, TAU, 0, PI/2), chediWhiteMat);
    cBell.position.set(chediX, 3.0, chediZ); scene.add(cBell);
    const cTube = new THREE.Mesh(new THREE.CylinderGeometry(0.55, 0.7, 2, 8), chediWhiteMat);
    cTube.position.set(chediX, 5.5, chediZ); scene.add(cTube);
    const cSpire = new THREE.Mesh(new THREE.ConeGeometry(0.5, 5.5, 8), chediGoldMat);
    cSpire.position.set(chediX, 9.3, chediZ); scene.add(cSpire);

    // soft warm glow over the temple — a real accent light, cached for day/night
    const templeLight = new THREE.PointLight(0xffd577, 0.6, 30, 2);
    templeLight.position.set(cx, 7, cz);
    scene.add(templeLight);
    G.nightLights.push({ light: templeLight, base: 0.8 });

    // collision: viharn + chedi base
    world.buildings.push({
      pos: new THREE.Vector3(cx + 1.5, 2.75, cz + 1),
      size: new THREE.Vector3(13, 5.5, 8),
      mesh: viharn,
    });
    world.buildings.push({
      pos: new THREE.Vector3(chediX, 4.5, chediZ),
      size: new THREE.Vector3(5, 9, 5),
      mesh: cBase,
    });
    world.poi.temple = new THREE.Vector3(cx, 0, cz);
  }

  // ---- Power lines: utility poles + tangled overhead wires (the Bangkok cue) ----
  const poleMat = new THREE.MeshStandardMaterial({ color: 0x554a3e, roughness: 0.9 });
  const wireMat = new THREE.MeshStandardMaterial({ color: 0x0a0a0a, roughness: 0.95 });
  const junctionMat = new THREE.MeshStandardMaterial({ color: 0x1a1a1a, roughness: 0.9 });
  const POLE_H = 6.4, POLE_R = 0.13;
  const POLE_SPACING = 28;
  // shared geometries (reuse across many poles)
  const poleGeo = new THREE.CylinderGeometry(POLE_R*0.85, POLE_R, POLE_H, 6);
  const armGeoEW = new THREE.BoxGeometry(1.6, 0.10, 0.10);
  const armGeoNS = new THREE.BoxGeometry(0.10, 0.10, 1.6);
  const junctionGeo = new THREE.BoxGeometry(0.32, 0.5, 0.28);
  const wireGeo = new THREE.CylinderGeometry(0.035, 0.035, 1, 4); // unit; scaled in Y
  // Instancing accumulators — one Matrix4 per instance, built into InstancedMeshes below.
  const poleM = [], armEWM = [], armNSM = [], junctionM = [], wireM = [];

  function makePole(x, z, isEW) {
    _q.identity(); _s.set(1, 1, 1);
    _p.set(x, POLE_H/2, z);
    poleM.push(_m.compose(_p, _q, _s).clone());
    _p.set(x, POLE_H - 0.55, z);
    (isEW ? armEWM : armNSM).push(_m.compose(_p, _q, _s).clone());
    if (Math.random() < 0.4) {
      _p.set(x, 4.0 + rand(-0.3, 0.4), z);
      junctionM.push(_m.compose(_p, _q, _s).clone());
    }
  }

  function makeWire(x1, z1, x2, z2, y, lateral, isEW) {
    const dx = x2 - x1, dz = z2 - z1;
    const len = Math.hypot(dx, dz);
    if (len < 1 || len > POLE_SPACING * 1.6) return;
    let cx, cz;
    if (isEW) { cx = (x1+x2)/2; cz = (z1+z2)/2 + lateral; }
    else      { cx = (x1+x2)/2 + lateral; cz = (z1+z2)/2; }
    _p.set(cx, y, cz);
    // unit cylinder long-axis is Y; scale Y by length, then rotate to run along road
    _q.setFromEuler(_e.set(isEW ? 0 : PI/2, 0, isEW ? PI/2 : 0));
    _s.set(1, len, 1);
    wireM.push(_m.compose(_p, _q, _s).clone());
  }

  // Poles along EW roads — on both sidewalks (north & south of each road)
  for (let i = -GRID/2; i <= GRID/2; i++) {
    const zRoad = i * BLOCK;
    for (const zSign of [-1, +1]) {
      const zPole = zRoad + zSign * 8.5;
      let prevX = null;
      for (let x = -HALF + 14; x <= HALF - 14; x += POLE_SPACING) {
        makePole(x, zPole, true);
        if (prevX !== null) {
          for (const off of [-0.55, 0, 0.55]) {
            makeWire(prevX, zPole, x, zPole, POLE_H - 0.7 + rand(-0.05, 0.05), off, true);
          }
        }
        prevX = x;
      }
    }
  }
  // Poles along NS roads
  for (let i = -GRID/2; i <= GRID/2; i++) {
    const xRoad = i * BLOCK;
    for (const xSign of [-1, +1]) {
      const xPole = xRoad + xSign * 8.5;
      let prevZ = null;
      for (let z = -HALF + 14; z <= HALF - 14; z += POLE_SPACING) {
        makePole(xPole, z, false);
        if (prevZ !== null) {
          for (const off of [-0.55, 0, 0.55]) {
            makeWire(xPole, prevZ, xPole, z, POLE_H - 0.7 + rand(-0.05, 0.05), off, false);
          }
        }
        prevZ = z;
      }
    }
  }
  // Build power-line InstancedMeshes (poles cast+receive shadow like the originals)
  addInstanced(poleGeo, poleMat, poleM, true, true);
  addInstanced(armGeoEW, poleMat, armEWM, false, false);
  addInstanced(armGeoNS, poleMat, armNSM, false, false);
  addInstanced(junctionGeo, junctionMat, junctionM, false, false);
  addInstanced(wireGeo, wireMat, wireM, false, false);

  // ---- Parked motorbikes — clusters along curbs (Bangkok parking is everywhere) ----
  // One InstancedMesh per part type (frame / wheel / handle). The original gave each
  // cluster a random frame color; instancing forces a single shared frame material,
  // so we pick one representative Bangkok-red — the silhouette is what reads at range.
  const bikeFrameMat = new THREE.MeshStandardMaterial({ color: 0xd6363c, roughness: 0.55, metalness: 0.3 });
  const bikeWheelMat = new THREE.MeshStandardMaterial({ color: 0x111111, roughness: 0.85 });
  const bikeHandleMat = new THREE.MeshStandardMaterial({ color: 0x111111 });
  const bikeWheelGeo = new THREE.TorusGeometry(0.3, 0.075, 6, 12);
  const bikeFrameGeo = new THREE.BoxGeometry(0.5, 0.4, 1.5);
  const bikeHandleGeo = new THREE.BoxGeometry(0.7, 0.05, 0.06);
  const bikeFrameM = [], bikeWheelM = [], bikeHandleM = [];
  // Local (within-bike) part transforms, baked once and reused for every bike.
  const _wheelQ = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, PI/2, 0));
  const localFrame  = new THREE.Matrix4().compose(new THREE.Vector3(0, 0.5, 0), new THREE.Quaternion(), new THREE.Vector3(1,1,1));
  const localWheelF = new THREE.Matrix4().compose(new THREE.Vector3(0, 0.3, 0.75), _wheelQ, new THREE.Vector3(1,1,1));
  const localWheelR = new THREE.Matrix4().compose(new THREE.Vector3(0, 0.3, -0.75), _wheelQ, new THREE.Vector3(1,1,1));
  const localHandle = new THREE.Matrix4().compose(new THREE.Vector3(0, 1.0, 0.65), new THREE.Quaternion(), new THREE.Vector3(1,1,1));
  for (let i = -GRID/2; i < GRID/2; i++) {
    for (let j = -GRID/2; j < GRID/2; j++) {
      if (i === RIVER_I) continue;   // no parked bikes in the river
      const cx = (i + 0.5) * BLOCK;
      const cz = (j + 0.5) * BLOCK;
      const numClusters = irand(1, 3);
      for (let n = 0; n < numClusters; n++) {
        const side = pick([
          { ax: 'z', sign: +1 }, { ax: 'z', sign: -1 },
          { ax: 'x', sign: +1 }, { ax: 'x', sign: -1 },
        ]);
        const clusterSize = irand(2, 5);
        const t0 = rand(-12, 12 - clusterSize * 0.9);
        for (let k = 0; k < clusterSize; k++) {
          let bx, bz, ry;
          if (side.ax === 'z') {
            bx = cx + t0 + k * 0.9;
            bz = cz + side.sign * 15.5;
            ry = (side.sign > 0 ? 0 : PI) + rand(-0.12, 0.12);
          } else {
            bz = cz + t0 + k * 0.9;
            bx = cx + side.sign * 15.5;
            ry = (side.sign > 0 ? -PI/2 : PI/2) + rand(-0.12, 0.12);
          }
          // group (bike) transform, then world = group * localPart
          _p.set(bx, 0.05, bz);
          _q.setFromEuler(_e.set(0, ry, 0));
          _s.set(1, 1, 1);
          _m2.compose(_p, _q, _s);
          bikeFrameM.push(new THREE.Matrix4().multiplyMatrices(_m2, localFrame));
          bikeWheelM.push(new THREE.Matrix4().multiplyMatrices(_m2, localWheelF));
          bikeWheelM.push(new THREE.Matrix4().multiplyMatrices(_m2, localWheelR));
          bikeHandleM.push(new THREE.Matrix4().multiplyMatrices(_m2, localHandle));
        }
      }
    }
  }
  addInstanced(bikeFrameGeo, bikeFrameMat, bikeFrameM, false, false);
  addInstanced(bikeWheelGeo, bikeWheelMat, bikeWheelM, false, false);
  addInstanced(bikeHandleGeo, bikeHandleMat, bikeHandleM, false, false);

  // ---- Sidewalk props: food carts, plant pots, trash piles ----
  // All static, so each prop group is baked (merged per material) instead of
  // added as its own group of meshes. Umbrella tarps are pooled by color so the
  // ~5 colors stay 5 materials (and merge cleanly) instead of one-per-cart.
  const tarpColors2 = [0xa83a3a, 0x3a5a8a, 0x3a8a5a, 0xcfa83a, 0xc26b3a];
  const umbrellaMatPool = new Map();
  const getUmbrellaMat = c => {
    let m = umbrellaMatPool.get(c);
    if (!m) { m = new THREE.MeshStandardMaterial({ color: c, roughness: 0.8, side: THREE.DoubleSide }); umbrellaMatPool.set(c, m); }
    return m;
  };
  const propPotMat = new THREE.MeshStandardMaterial({ color: 0x6b4a3a, roughness: 0.95 });
  const propLeafMat = new THREE.MeshStandardMaterial({ color: 0x3a6a3a, roughness: 0.8, side: THREE.DoubleSide });
  const propTrashMat = new THREE.MeshStandardMaterial({ color: 0x222222, roughness: 1.0 });
  const propCartBodyMat = new THREE.MeshStandardMaterial({ color: 0xdedede, roughness: 0.7 });
  const propCartPoleMat = new THREE.MeshStandardMaterial({ color: 0x666 });
  const propLeafGeo = new THREE.ConeGeometry(0.15, 0.9, 4);
  const propPotGeo = new THREE.CylinderGeometry(0.32, 0.25, 0.5, 8);
  const propCartBodyGeo = new THREE.BoxGeometry(1.4, 0.9, 0.8);
  const propCartWheelGeo = new THREE.CylinderGeometry(0.16, 0.16, 0.1, 8);
  const propCartPoleGeo = new THREE.CylinderGeometry(0.04, 0.04, 2, 6);
  for (let i = -GRID/2; i < GRID/2; i++) {
    for (let j = -GRID/2; j < GRID/2; j++) {
      if (i === RIVER_I) continue;   // no sidewalk props in the river
      const cx = (i + 0.5) * BLOCK;
      const cz = (j + 0.5) * BLOCK;
      const numProps = irand(2, 4);
      for (let n = 0; n < numProps; n++) {
        const side = pick([
          { ax: 'z', sign: +1 }, { ax: 'z', sign: -1 },
          { ax: 'x', sign: +1 }, { ax: 'x', sign: -1 },
        ]);
        const t = rand(-12, 12);
        let px, pz;
        if (side.ax === 'z') {
          px = cx + t;
          pz = cz + side.sign * (15 + rand(-1.5, 1.5));
        } else {
          pz = cz + t;
          px = cx + side.sign * (15 + rand(-1.5, 1.5));
        }
        const propType = irand(0, 3);
        if (propType === 0) {
          // food cart with umbrella
          const cart = new THREE.Group();
          const body = new THREE.Mesh(propCartBodyGeo, propCartBodyMat);
          body.position.y = 0.55; cart.add(body);
          const pole = new THREE.Mesh(propCartPoleGeo, propCartPoleMat);
          pole.position.y = 1.0; cart.add(pole);
          const umbrella = new THREE.Mesh(new THREE.ConeGeometry(1.3, 0.5, 8), getUmbrellaMat(pick(tarpColors2)));
          umbrella.position.y = 2.0; cart.add(umbrella);
          for (const xx of [-0.5, 0.5]) {
            const w = new THREE.Mesh(propCartWheelGeo, bikeWheelMat);
            w.rotation.z = PI/2; w.position.set(xx, 0.16, 0.45);
            cart.add(w);
          }
          cart.position.set(px, 0, pz);
          cart.rotation.y = rand(0, TAU);
          bakeGroup(cart, false, false);
        } else if (propType === 1 || propType === 3) {
          // plant pot with leaves
          const pot = new THREE.Group();
          const potBody = new THREE.Mesh(propPotGeo, propPotMat);
          potBody.position.y = 0.25; pot.add(potBody);
          for (let k = 0; k < 5; k++) {
            const leaf = new THREE.Mesh(propLeafGeo, propLeafMat);
            leaf.position.y = 0.9;
            leaf.rotation.z = rand(-0.6, 0.6);
            leaf.rotation.x = rand(-0.4, 0.4);
            leaf.rotation.y = k * TAU/5 + rand(-0.2, 0.2);
            pot.add(leaf);
          }
          pot.position.set(px, 0, pz);
          bakeGroup(pot, false, false);
        } else {
          // trash pile — a few small dark boxes
          const tg = new THREE.Group();
          for (let k = 0; k < irand(2, 5); k++) {
            const b = new THREE.Mesh(
              new THREE.BoxGeometry(rand(0.25, 0.5), rand(0.2, 0.4), rand(0.25, 0.5)),
              propTrashMat
            );
            b.position.set(rand(-0.4, 0.4), rand(0.15, 0.3), rand(-0.4, 0.4));
            b.rotation.y = rand(0, TAU);
            tg.add(b);
          }
          tg.position.set(px, 0, pz);
          bakeGroup(tg, false, false);
        }
      }
    }
  }

  // ---- BTS Skytrain elevated track running east-west at z=0 ----
  const pillarMat = new THREE.MeshStandardMaterial({ color: 0x9b9b9b, roughness: 0.85 });
  const beamMat   = new THREE.MeshStandardMaterial({ color: 0x7d7d7d, roughness: 0.85 });
  const pillarGeo = new THREE.CylinderGeometry(1.0, 1.3, 14, 8);
  const pillarM = [];
  for (let x = -HALF + 10; x <= HALF - 10; x += 18) {
    _p.set(x, 7, 0); _q.identity(); _s.set(1, 1, 1);
    pillarM.push(_m.compose(_p, _q, _s).clone());
  }
  addInstanced(pillarGeo, pillarMat, pillarM, true, true); // pillars cast+receive shadow
  const beam = new THREE.Mesh(new THREE.BoxGeometry(HALF*2, 1.2, 6), beamMat);
  beam.position.set(0, 14.5, 0); beam.castShadow = true; scene.add(beam);

  // A Skytrain that slides along the track (visual only)
  {
    const train = new THREE.Group();
    const carMat = new THREE.MeshStandardMaterial({ color: 0xdedede, roughness: 0.5, metalness: 0.3 });
    const stripeMat = new THREE.MeshStandardMaterial({ color: 0x2a7d8e, roughness: 0.5 });
    const trainWinMat = new THREE.MeshStandardMaterial({ color: 0x223340, emissive: 0x66ccff, emissiveIntensity: 0.0, roughness: 0.4 });
    G.nightEmissive.push({ mat: trainWinMat, dayIntensity: 0.0, nightIntensity: 1.2 });
    for (let c = 0; c < 3; c++) {
      const x0 = (c - 1) * 9.4;
      const car = new THREE.Mesh(new THREE.BoxGeometry(9, 2.6, 2.8), carMat);
      car.position.set(x0, 0, 0); car.castShadow = true; train.add(car);
      const stripe = new THREE.Mesh(new THREE.BoxGeometry(9.05, 0.45, 2.85), stripeMat);
      stripe.position.set(x0, -0.75, 0); train.add(stripe);
      for (const zs of [-1, 1]) {
        const win = new THREE.Mesh(new THREE.PlaneGeometry(8, 1.0), trainWinMat);
        win.position.set(x0, 0.25, zs * 1.41); win.rotation.y = zs > 0 ? 0 : PI; train.add(win);
      }
    }
    train.position.set(0, 16.5, 0);
    scene.add(train);
    G.bts = { mesh: train, dir: 1, speed: 24, min: -HALF + 18, max: HALF - 18 };
  }

  // BTS Skytrain station — elevated platform + canopy + stair tower
  {
    const sx = -50; // station centered above this pillar
    const stationFloorY = 13.6;
    const platformMat = new THREE.MeshStandardMaterial({ color: 0xcfcfcf, roughness: 0.7 });
    const platform = new THREE.Mesh(new THREE.BoxGeometry(22, 0.6, 11), platformMat);
    platform.position.set(sx, stationFloorY, 0); platform.castShadow = true; scene.add(platform);
    // canopy roof
    const canopyMat = new THREE.MeshStandardMaterial({ color: 0x2a7d8e, roughness: 0.5 });
    const canopy = new THREE.Mesh(new THREE.BoxGeometry(23, 0.35, 12), canopyMat);
    canopy.position.set(sx, stationFloorY + 4.5, 0); canopy.castShadow = true; scene.add(canopy);
    // 4 columns supporting canopy
    const colMat = new THREE.MeshStandardMaterial({ color: 0xe8e8e8, roughness: 0.6 });
    for (const cx2 of [sx-9, sx+9]) for (const cz2 of [-4.5, 4.5]) {
      const col = new THREE.Mesh(new THREE.CylinderGeometry(0.25, 0.25, 4.4, 8), colMat);
      col.position.set(cx2, stationFloorY + 2.5, cz2); scene.add(col);
    }
    // side walls (low) on north & south edges of platform
    const sideWallMat = new THREE.MeshStandardMaterial({ color: 0xbbbbbb, roughness: 0.7 });
    const wallN = new THREE.Mesh(new THREE.BoxGeometry(22, 1.1, 0.18), sideWallMat);
    wallN.position.set(sx, stationFloorY + 0.85, 5.5); scene.add(wallN);
    const wallS = new THREE.Mesh(new THREE.BoxGeometry(22, 1.1, 0.18), sideWallMat);
    wallS.position.set(sx, stationFloorY + 0.85, -5.5); scene.add(wallS);
    // stair tower descending to street level on the south side
    const stairMat = new THREE.MeshStandardMaterial({ color: 0xc8c8c8, roughness: 0.85 });
    const stairTower = new THREE.Mesh(new THREE.BoxGeometry(4, stationFloorY, 3), stairMat);
    stairTower.position.set(sx, stationFloorY/2, -8.5); stairTower.castShadow = true; scene.add(stairTower);
    // collision for stair tower so the player can walk against it
    world.buildings.push({
      pos: new THREE.Vector3(sx, stationFloorY/2, -8.5),
      size: new THREE.Vector3(4, stationFloorY, 3),
      mesh: stairTower,
    });
    // station sign
    const stationSign = new THREE.Mesh(
      new THREE.PlaneGeometry(6, 1.0),
      new THREE.MeshBasicMaterial({ color: 0x21f0ff })
    );
    stationSign.position.set(sx, stationFloorY + 5.0, 6.05);
    scene.add(stationSign);
  }

  // ---- Street lamps at intersections ----
  // ~480 lamps. Previously each had its own PointLight (pathological for forward
  // rendering); now the poles and bulb heads are instanced, and the bulbs glow via
  // a shared emissive material that ramps at night instead of being real lights.
  const lampMat = new THREE.MeshStandardMaterial({ color: 0x333333, roughness: 0.7 });
  const bulbMat = new THREE.MeshStandardMaterial({
    color: 0xffd577, emissive: 0xffd577, emissiveIntensity: 0.2, roughness: 0.4,
  });
  G.nightEmissive.push({ mat: bulbMat, dayIntensity: 0.2, nightIntensity: 1.4 });
  const lampPoleGeo = new THREE.CylinderGeometry(0.12, 0.15, 6, 6);
  const lampBulbGeo = new THREE.SphereGeometry(0.35, 8, 8);
  const lampPoleM = [], lampBulbM = [];
  for (const inter of world.intersections) {
    if (inter.x < -HALF + BLOCK) continue;  // skip lamps standing in the river
    for (const offset of [[-3,-3],[3,-3],[-3,3],[3,3]]) {
      const x = inter.x + offset[0]*1.2, z = inter.z + offset[1]*1.2;
      _q.identity(); _s.set(1, 1, 1);
      _p.set(x, 3, z); lampPoleM.push(_m.compose(_p, _q, _s).clone());
      _p.set(x, 6, z); lampBulbM.push(_m.compose(_p, _q, _s).clone());
    }
  }
  addInstanced(lampPoleGeo, lampMat, lampPoleM, false, false);
  addInstanced(lampBulbGeo, bulbMat, lampBulbM, false, false);

  // ---- 7-Elevens (the door chime is non-negotiable) ----
  // Place a couple of obvious 7-Eleven storefronts.
  const elevenSpots = [
    new THREE.Vector3( 80, 0,  80),
    new THREE.Vector3(-90, 0,  30),
    new THREE.Vector3(  0, 0, -110),
    new THREE.Vector3(120, 0, -40),
  ];
  for (const p of elevenSpots) {
    const store = new THREE.Group();
    const body = new THREE.Mesh(new THREE.BoxGeometry(10, 4, 8), new THREE.MeshStandardMaterial({ color: 0xf3f3f3, roughness: 0.6 }));
    body.position.y = 2; store.add(body);
    const sign = new THREE.Mesh(
      new THREE.PlaneGeometry(8, 1.4),
      new THREE.MeshBasicMaterial({ color: 0xff5a23 })
    );
    sign.position.set(0, 3.8, 4.05); store.add(sign);
    const sign2 = new THREE.Mesh(
      new THREE.PlaneGeometry(8, 1.4),
      new THREE.MeshBasicMaterial({ color: 0x21bb6a })
    );
    sign2.position.set(0, 2.4, 4.05); store.add(sign2);
    const door = new THREE.Mesh(new THREE.PlaneGeometry(2.4, 2.6), new THREE.MeshBasicMaterial({ color: 0x113355 }));
    door.position.set(0, 1.3, 4.06); store.add(door);
    const pl = new THREE.PointLight(0xff8855, 0.8, 14, 2);
    pl.position.set(0, 3.5, 5); store.add(pl);
    store.position.copy(p);
    scene.add(store);
    world.sevenElevens.push({ pos: p.clone(), group: store, chimed: 0 });
  }

  // ---- Shrines (spirit houses) — small gold structures ----
  for (let n = 0; n < 6; n++) {
    const sp = new THREE.Vector3(rand(-HALF+40, HALF-40), 0, rand(-HALF+40, HALF-40));
    // snap inside a block, not on a road
    sp.x = Math.round(sp.x / BLOCK) * BLOCK + (sp.x < 0 ? BLOCK/2-15 : -BLOCK/2+15);
    sp.z = Math.round(sp.z / BLOCK) * BLOCK + (sp.z < 0 ? BLOCK/2-15 : -BLOCK/2+15);
    const shrine = new THREE.Group();
    const base = new THREE.Mesh(new THREE.BoxGeometry(1.5, 1.2, 1.5), new THREE.MeshStandardMaterial({ color: 0xc6a056, roughness: 0.4, metalness: 0.6 }));
    base.position.y = 0.6; shrine.add(base);
    const roof = new THREE.Mesh(new THREE.ConeGeometry(1.4, 1.2, 4), new THREE.MeshStandardMaterial({ color: 0xffcf4a, metalness: 0.7, roughness: 0.3 }));
    roof.position.y = 1.8; roof.rotation.y = PI/4; shrine.add(roof);
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 2, 6), new THREE.MeshStandardMaterial({ color: 0x884422 }));
    pole.position.y = 1; shrine.add(pole);
    const pl = new THREE.PointLight(0xffcf4a, 0.6, 10, 2);
    pl.position.y = 2; shrine.add(pl);
    shrine.position.copy(sp);
    scene.add(shrine);
  }

  // ---- Mission marker: Uncle Seng's gold shop (yellow pillar of light) ----
  const goldShop = new THREE.Group();
  const shopBody = new THREE.Mesh(
    new THREE.BoxGeometry(12, 6, 8),
    new THREE.MeshStandardMaterial({ color: 0xb02020, roughness: 0.5 })
  );
  shopBody.position.y = 3; goldShop.add(shopBody);
  const shopSign = new THREE.Mesh(new THREE.PlaneGeometry(10, 1.8), new THREE.MeshBasicMaterial({ color: 0xffcf4a }));
  shopSign.position.set(0, 5.6, 4.05); goldShop.add(shopSign);
  const goldDoor = new THREE.Mesh(new THREE.PlaneGeometry(2.6, 3.2), new THREE.MeshBasicMaterial({ color: 0x1a1a1a }));
  goldDoor.position.set(0, 1.6, 4.06); goldShop.add(goldDoor);
  const goldGlow = new THREE.PointLight(0xffcf4a, 1.4, 22, 2); goldGlow.position.set(0, 4, 6); goldShop.add(goldGlow);
  const goldShopPos = new THREE.Vector3(-160, 0, -160);
  goldShop.position.copy(goldShopPos);
  scene.add(goldShop);
  world.poi.goldShop = goldShopPos.clone();

  // Pillar of light to attract player
  const pillarBeam = new THREE.Mesh(
    new THREE.CylinderGeometry(1.2, 1.2, 80, 16, 1, true),
    new THREE.MeshBasicMaterial({ color: 0xffcf4a, transparent: true, opacity: 0.18, side: THREE.DoubleSide, depthWrite: false })
  );
  pillarBeam.position.copy(goldShopPos); pillarBeam.position.y = 40;
  scene.add(pillarBeam);
  world.poi.goldShopBeam = pillarBeam;

  // ---- Hua Lamphong station marker (player spawn) ----
  // Just a small platform with a teal canopy at the spawn point.
  const station = new THREE.Group();
  const platform = new THREE.Mesh(new THREE.BoxGeometry(16, 0.4, 8), new THREE.MeshStandardMaterial({ color: 0xbfa676, roughness: 0.8 }));
  platform.position.y = 0.2; station.add(platform);
  const canopy = new THREE.Mesh(new THREE.BoxGeometry(16, 0.3, 8), new THREE.MeshStandardMaterial({ color: 0x2a8e8e, roughness: 0.5 }));
  canopy.position.y = 4.5; station.add(canopy);
  for (const dx of [-7, 7]) for (const dz of [-3.5, 3.5]) {
    const col = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.2, 4.3, 6), new THREE.MeshStandardMaterial({ color: 0xeeeeee }));
    col.position.set(dx, 2.3, dz); station.add(col);
  }
  station.position.copy(world.spawns.player);
  station.position.y = 0;
  scene.add(station);

  // ---- Distant city ring: low-detail silhouettes outside the playable bounds ----
  // Fakes a bigger world. Just unlit boxes in a 250..500m band from origin.
  const ringColors = [0x7a7a88, 0x8d8794, 0x9a8a70, 0x837a7a, 0x6e7077, 0x878291, 0x9b9082];
  const ringMats = ringColors.map(c => new THREE.MeshStandardMaterial({ color: c, roughness: 0.95 }));
  const RING_INNER = HALF + 30;   // start just past the play area
  const RING_OUTER = HALF + 280;  // ~280m of fake skyline depth
  const RING_COUNT = 380;
  // Boxes + caps + landmark tower bodies are all unit cubes scaled per instance.
  // Accumulate one matrix array per ring material so each color is one InstancedMesh.
  const ringBoxGeo = new THREE.BoxGeometry(1, 1, 1);
  const ringBoxM = ringMats.map(() => []);
  for (let n = 0; n < RING_COUNT; n++) {
    const ang = rand(0, TAU);
    const r = rand(RING_INNER, RING_OUTER);
    const x = Math.cos(ang) * r;
    const z = Math.sin(ang) * r;
    // height: bias toward tall in the inner band (foreground skyline) and short on the far edge
    const tDist = (r - RING_INNER) / (RING_OUTER - RING_INNER);
    const h = lerp(rand(35, 110), rand(15, 50), tDist);
    const w = rand(10, 22);
    const d = rand(10, 22);
    const mi = irand(0, ringMats.length - 1);
    _q.identity();
    _p.set(x, h/2, z); _s.set(w, h, d);
    ringBoxM[mi].push(_m.compose(_p, _q, _s).clone());
    // occasional darker rooftop cap for silhouette variation
    if (Math.random() < 0.35) {
      const capH = rand(2, 6);
      const capW = w * rand(0.5, 0.85);
      const capD = d * rand(0.5, 0.85);
      _p.set(x, h + capH/2, z); _s.set(capW, capH, capD);
      ringBoxM[mi].push(_m.compose(_p, _q, _s).clone());
    }
  }
  // A couple of landmark towers — taller than everything else (bodies fold into the
  // material[0] box instances; the pointed cone tips stay as a few plain meshes).
  for (let n = 0; n < 4; n++) {
    const ang = rand(0, TAU);
    const r = rand(HALF + 80, HALF + 200);
    const x = Math.cos(ang) * r;
    const z = Math.sin(ang) * r;
    const h = rand(180, 260);
    const w = rand(14, 22);
    const d = rand(14, 22);
    _q.identity();
    _p.set(x, h/2, z); _s.set(w, h, d);
    ringBoxM[0].push(_m.compose(_p, _q, _s).clone());
    // pointed cap
    const tipH = rand(6, 14);
    const tip = new THREE.Mesh(new THREE.ConeGeometry(w*0.4, tipH, 4), ringMats[0]);
    tip.position.set(x, h + tipH/2, z);
    tip.rotation.y = PI/4;
    scene.add(tip);
  }
  // Build the distant-ring InstancedMeshes (no shadows on distant ring — perf)
  for (let mi = 0; mi < ringMats.length; mi++) {
    addInstanced(ringBoxGeo, ringMats[mi], ringBoxM[mi], false, false);
  }

  // ---- Chao Phraya river along the west edge ----
  // The westmost block column is water: a murky plane raised above the road
  // decals so it hides them, an embankment wall (collision) with a pier gap, a
  // riverside pier, and a few longtail boats.
  {
    const RIVER_W = -HALF;                 // map's west edge
    const RIVER_E = -HALF + BLOCK - 8;      // east bank ≈ x=-208
    const riverCX = (RIVER_E + RIVER_W) / 2;
    const riverWidth = RIVER_E - RIVER_W;
    const PIER_Z = -50;                     // pier sits on this EW road line

    const waterMat = new THREE.MeshStandardMaterial({ color: 0x3f5147, roughness: 0.35, metalness: 0.1, transparent: true, opacity: 0.92 });
    const water = new THREE.Mesh(new THREE.PlaneGeometry(riverWidth, HALF*2 + 40), waterMat);
    water.rotation.x = -PI/2; water.position.set(riverCX, 0.12, 0); water.receiveShadow = true;
    scene.add(water);

    // embankment wall along the east bank, split to leave a gap at the pier
    const bankMat = new THREE.MeshStandardMaterial({ color: 0x6a6a6a, roughness: 0.95 });
    const bankH = 1.0, bankY = 0.5, gapHalf = 4;
    const nLen = HALF - (PIER_Z + gapHalf), nC = (PIER_Z + gapHalf + HALF) / 2;
    const sLen = (PIER_Z - gapHalf) - (-HALF), sC = (-HALF + PIER_Z - gapHalf) / 2;
    const wallN = new THREE.Mesh(new THREE.BoxGeometry(0.8, bankH, nLen), bankMat);
    wallN.position.set(RIVER_E, bankY, nC); scene.add(wallN);
    const wallS = new THREE.Mesh(new THREE.BoxGeometry(0.8, bankH, sLen), bankMat);
    wallS.position.set(RIVER_E, bankY, sC); scene.add(wallS);
    world.buildings.push({ pos: new THREE.Vector3(RIVER_E, bankY, nC), size: new THREE.Vector3(0.8, bankH, nLen), mesh: wallN });
    world.buildings.push({ pos: new THREE.Vector3(RIVER_E, bankY, sC), size: new THREE.Vector3(0.8, bankH, sLen), mesh: wallS });

    // pier jutting west over the water from the gap
    const pierLen = 30, pierW = 5, pierWX = RIVER_E - pierLen, pierCX = RIVER_E - pierLen / 2;
    const pierMat = new THREE.MeshStandardMaterial({ color: 0x7a5a3a, roughness: 0.9 });
    const deck = new THREE.Mesh(new THREE.BoxGeometry(pierLen, 0.3, pierW), pierMat);
    deck.position.set(pierCX, 0.7, PIER_Z); deck.castShadow = true; deck.receiveShadow = true; scene.add(deck);
    const railMat = new THREE.MeshStandardMaterial({ color: 0x4a3a2a, roughness: 0.9 });
    for (const zoff of [-pierW/2, pierW/2]) {
      const rail = new THREE.Mesh(new THREE.BoxGeometry(pierLen, 0.5, 0.1), railMat);
      rail.position.set(pierCX, 1.1, PIER_Z + zoff); scene.add(rail);
    }
    const pilMat = new THREE.MeshStandardMaterial({ color: 0x5a4a3a, roughness: 0.95 });
    for (let px = pierWX + 2; px < RIVER_E; px += 7) {
      for (const zoff of [-pierW/2 + 0.4, pierW/2 - 0.4]) {
        const pil = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.2, 2.4, 6), pilMat);
        pil.position.set(px, -0.4, PIER_Z + zoff); scene.add(pil);
      }
    }

    // longtail boats — a long thin hull + a raised stern motor pole
    for (let n = 0; n < 4; n++) {
      const boat = new THREE.Group();
      const hull = new THREE.Mesh(new THREE.BoxGeometry(1.1, 0.5, 6), new THREE.MeshStandardMaterial({ color: pick([0x9a3a3a, 0x3a5a9a, 0xcfa83a, 0xe0c885]), roughness: 0.7 }));
      hull.position.y = 0.25; boat.add(hull);
      const trim = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.12, 6.1), new THREE.MeshStandardMaterial({ color: 0x222222, roughness: 0.9 }));
      trim.position.y = 0.5; boat.add(trim);
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 2.4, 6), new THREE.MeshStandardMaterial({ color: 0x333333 }));
      pole.position.set(0, 0.9, -3.1); pole.rotation.x = 0.5; boat.add(pole);
      boat.position.set(rand(RIVER_W + 6, RIVER_E - 6), 0.18, rand(-HALF + 30, HALF - 30));
      boat.rotation.y = rand(-0.3, 0.3) + (Math.random() < 0.5 ? 0 : PI);
      scene.add(boat);
    }
  }

  // ---- U-Spray garage: drive in to repair the car + lose the cops for a fee ----
  {
    const gx = (GARAGE_I + 0.5) * BLOCK, gz = (GARAGE_J + 0.5) * BLOCK; // (175, -25)
    const depth = 11, wWidth = 14, wH = 5, wY = wH / 2;
    const wallMat = new THREE.MeshStandardMaterial({ color: 0x4a6a7a, roughness: 0.8 });
    const roofMat = new THREE.MeshStandardMaterial({ color: 0x2a3540, roughness: 0.8 });
    // 3-sided shed, open to the south road
    const back = new THREE.Mesh(new THREE.BoxGeometry(wWidth, wH, 0.6), wallMat);
    back.position.set(gx, wY, gz + depth / 2); back.castShadow = true; back.receiveShadow = true; scene.add(back);
    const sideW = new THREE.Mesh(new THREE.BoxGeometry(0.6, wH, depth), wallMat);
    sideW.position.set(gx - wWidth / 2, wY, gz); sideW.castShadow = true; scene.add(sideW);
    const sideE = new THREE.Mesh(new THREE.BoxGeometry(0.6, wH, depth), wallMat);
    sideE.position.set(gx + wWidth / 2, wY, gz); sideE.castShadow = true; scene.add(sideE);
    const roof = new THREE.Mesh(new THREE.BoxGeometry(wWidth + 0.6, 0.5, depth + 0.6), roofMat);
    roof.position.set(gx, wH + 0.25, gz); roof.castShadow = true; scene.add(roof);
    // neon sign over the opening
    const signMat = new THREE.MeshStandardMaterial({ color: 0x21f0ff, emissive: 0x21f0ff, emissiveIntensity: 0.4, roughness: 0.5 });
    G.nightEmissive.push({ mat: signMat, dayIntensity: 0.4, nightIntensity: 1.6 });
    const sign = new THREE.Mesh(new THREE.PlaneGeometry(8, 1.4), signMat);
    sign.position.set(gx, wH - 0.2, gz - depth / 2 - 0.4); sign.rotation.y = PI; scene.add(sign);
    // collision: back + two sides (front left open to drive in)
    world.buildings.push({ pos: new THREE.Vector3(gx, wY, gz + depth / 2), size: new THREE.Vector3(wWidth, wH, 0.6), mesh: back });
    world.buildings.push({ pos: new THREE.Vector3(gx - wWidth / 2, wY, gz), size: new THREE.Vector3(0.6, wH, depth), mesh: sideW });
    world.buildings.push({ pos: new THREE.Vector3(gx + wWidth / 2, wY, gz), size: new THREE.Vector3(0.6, wH, depth), mesh: sideE });
    // service trigger zone
    world.garages = world.garages || [];
    world.garages.push({ pos: new THREE.Vector3(gx, 0, gz), r: 7, cooldownUntil: 0 });
    // garage door — where retrieved/stored vehicles sit (front, on the open south side)
    world.garageDoor = new THREE.Vector3(gx, 0, gz - depth / 2 - 4);
  }

  // ---- Safehouse: a buyable townhouse that becomes your respawn point ----
  {
    const hx = (SAFE_I + 0.5) * BLOCK, hz = (SAFE_J + 0.5) * BLOCK;  // ≈ (-25, 75)
    const wallMat = new THREE.MeshStandardMaterial({ color: 0xb8a78a, roughness: 0.85 });
    const roofMat = new THREE.MeshStandardMaterial({ color: 0x6a3a2a, roughness: 0.8 });
    const doorMat = new THREE.MeshStandardMaterial({ color: 0x3a2a1a, roughness: 0.7 });
    // two-storey shophouse front, set back from the south road
    const W = 9, D = 8, H = 8;
    const body = new THREE.Mesh(new THREE.BoxGeometry(W, H, D), wallMat);
    body.position.set(hx, H / 2, hz); body.castShadow = true; body.receiveShadow = true; scene.add(body);
    const roof = new THREE.Mesh(new THREE.BoxGeometry(W + 0.8, 0.6, D + 0.8), roofMat);
    roof.position.set(hx, H + 0.3, hz); roof.castShadow = true; scene.add(roof);
    const doorZ = hz - D / 2 - 0.05;
    const door = new THREE.Mesh(new THREE.BoxGeometry(1.6, 3.2, 0.2), doorMat);
    door.position.set(hx, 1.6, doorZ); scene.add(door);
    // a little balcony slab for silhouette
    const balcony = new THREE.Mesh(new THREE.BoxGeometry(W * 0.8, 0.2, 1.4), wallMat);
    balcony.position.set(hx, 4.4, hz - D / 2 - 0.7); balcony.castShadow = true; scene.add(balcony);
    // sign over the door — red FOR SALE until bought, green HOME after (toggled at runtime)
    const signMat = new THREE.MeshStandardMaterial({ color: 0xff3344, emissive: 0xff3344, emissiveIntensity: 0.5, roughness: 0.5 });
    G.nightEmissive.push({ mat: signMat, dayIntensity: 0.5, nightIntensity: 1.4 });
    const sign = new THREE.Mesh(new THREE.PlaneGeometry(4, 1), signMat);
    sign.position.set(hx, H - 1, hz - D / 2 - 0.12); sign.rotation.y = PI; scene.add(sign);
    // collision: the house body is a solid building
    world.buildings.push({ pos: new THREE.Vector3(hx, H / 2, hz), size: new THREE.Vector3(W, H, D) });
    world.poi.safehouse = new THREE.Vector3(hx, 0, doorZ - 2.5);   // stand-here door spot
    world.safehouseSign = signMat;
    G.econ.safehouse.pos = new THREE.Vector3(hx, 0, doorZ - 4);    // respawn just outside the door
  }

  // ---- Gun shop: buy weapons/ammo with cash (on foot) ----
  {
    const gx = (GUN_I + 0.5) * BLOCK, gz = (GUN_J + 0.5) * BLOCK; // (175, 75)
    const depth = 10, wWidth = 12, wH = 4.5, wY = wH / 2;
    const wallMat = new THREE.MeshStandardMaterial({ color: 0x3a3f4a, roughness: 0.85 });
    const back = new THREE.Mesh(new THREE.BoxGeometry(wWidth, wH, 0.6), wallMat);
    back.position.set(gx, wY, gz + depth / 2); back.castShadow = true; back.receiveShadow = true; scene.add(back);
    const sideW = new THREE.Mesh(new THREE.BoxGeometry(0.6, wH, depth), wallMat);
    sideW.position.set(gx - wWidth / 2, wY, gz); sideW.castShadow = true; scene.add(sideW);
    const sideE = new THREE.Mesh(new THREE.BoxGeometry(0.6, wH, depth), wallMat);
    sideE.position.set(gx + wWidth / 2, wY, gz); sideE.castShadow = true; scene.add(sideE);
    const roof = new THREE.Mesh(new THREE.BoxGeometry(wWidth + 0.6, 0.5, depth + 0.6), wallMat);
    roof.position.set(gx, wH + 0.25, gz); roof.castShadow = true; scene.add(roof);
    const counter = new THREE.Mesh(new THREE.BoxGeometry(wWidth - 2, 1.0, 0.8), new THREE.MeshStandardMaterial({ color: 0x6a5a45, roughness: 0.8 }));
    counter.position.set(gx, 0.5, gz - depth / 2 + 2.5); scene.add(counter);
    const signMat = new THREE.MeshStandardMaterial({ color: 0xff3344, emissive: 0xff3344, emissiveIntensity: 0.4, roughness: 0.5 });
    G.nightEmissive.push({ mat: signMat, dayIntensity: 0.4, nightIntensity: 1.6 });
    const sign = new THREE.Mesh(new THREE.PlaneGeometry(7, 1.3), signMat);
    sign.position.set(gx, wH - 0.1, gz - depth / 2 - 0.4); sign.rotation.y = PI; scene.add(sign);
    world.buildings.push({ pos: new THREE.Vector3(gx, wY, gz + depth / 2), size: new THREE.Vector3(wWidth, wH, 0.6), mesh: back });
    world.buildings.push({ pos: new THREE.Vector3(gx - wWidth / 2, wY, gz), size: new THREE.Vector3(0.6, wH, depth), mesh: sideW });
    world.buildings.push({ pos: new THREE.Vector3(gx + wWidth / 2, wY, gz), size: new THREE.Vector3(0.6, wH, depth), mesh: sideE });
    world.gunShop = new THREE.Vector3(gx, 0, gz - depth / 2 + 1.5); // stand at the open front
  }

  // ---- Yaowarat: a dense Chinatown market street (blocks (-2, 2..3)) ----
  {
    const laneX = (YAO_I + 0.5) * BLOCK;        // -75: centre of the market lane
    const zStart = YAO_J0 * BLOCK + 6;          // 106
    const zEnd = (YAO_J1 + 1) * BLOCK - 6;      // 194
    const crossZ = YAO_J1 * BLOCK;              // 150: internal cross-road to keep clear
    const redMat = new THREE.MeshStandardMaterial({ color: 0xa8261f, roughness: 0.8 });
    const goldMat = new THREE.MeshStandardMaterial({ color: 0xd9a134, roughness: 0.5, metalness: 0.6 });
    const creamMat = new THREE.MeshStandardMaterial({ color: 0xe6d8b8, roughness: 0.85 });

    // paifang gate across the south entrance
    for (const gx of [laneX - 8, laneX + 8]) {
      const pillar = new THREE.Mesh(new THREE.BoxGeometry(1.4, 9, 1.4), redMat);
      pillar.position.set(gx, 4.5, zStart - 1); pillar.castShadow = true; scene.add(pillar);
      world.buildings.push({ pos: new THREE.Vector3(gx, 4.5, zStart - 1), size: new THREE.Vector3(1.4, 9, 1.4), mesh: pillar });
    }
    for (let k = 0; k < 3; k++) {
      const beam = new THREE.Mesh(new THREE.BoxGeometry(20 - k*3, 0.7, 1.6), goldMat);
      beam.position.set(laneX, 9 + k*1.2, zStart - 1); beam.castShadow = true; scene.add(beam);
      const eaves = new THREE.Mesh(new THREE.BoxGeometry(21 - k*3, 0.22, 2.6), redMat);
      eaves.position.set(laneX, 9.45 + k*1.2, zStart - 1); scene.add(eaves);
    }

    // shophouse rows lining the lane (low, dense) with neon + collision; gap at the cross-road
    for (const sideSign of [-1, +1]) {
      const rowX = laneX + sideSign * 14;       // -89 / -61
      for (let z = zStart; z < zEnd; z += rand(7, 10)) {
        if (Math.abs(z - crossZ) < 8) continue; // keep the cross-road clear of buildings
        const w = rand(6, 8), d = rand(7, 9), h = rand(9, 16);
        const body = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), Math.random() < 0.5 ? redMat : creamMat);
        body.position.set(rowX, h/2, z); body.castShadow = true; body.receiveShadow = true; scene.add(body);
        const shop = new THREE.Mesh(new THREE.BoxGeometry(w, 3, d + 0.2), redMat);
        shop.position.set(rowX, 1.5, z); scene.add(shop);
        world.buildings.push({ pos: new THREE.Vector3(rowX, h/2, z), size: new THREE.Vector3(w, h, d), mesh: body });
        const neonColor = pick(COLORS.neon);
        const nm = new THREE.MeshStandardMaterial({ color: neonColor, emissive: neonColor, emissiveIntensity: 0.2, roughness: 0.5 });
        G.nightEmissive.push({ mat: nm, dayIntensity: 0.2, nightIntensity: 1.5 });
        const sgn = new THREE.Mesh(new THREE.PlaneGeometry(0.8, rand(2, 3.5)), nm);
        sgn.position.set(rowX - sideSign * (w/2 + 0.06), rand(3.5, 5.5), z);
        sgn.rotation.y = sideSign > 0 ? -PI/2 : PI/2;
        scene.add(sgn);
      }
    }

    // hanging red lanterns strung over the lane (instanced)
    const lanternMat = new THREE.MeshStandardMaterial({ color: 0xd11a1a, emissive: 0xd11a1a, emissiveIntensity: 0.3, roughness: 0.6 });
    G.nightEmissive.push({ mat: lanternMat, dayIntensity: 0.25, nightIntensity: 1.4 });
    const lanternGeo = new THREE.SphereGeometry(0.32, 8, 8);
    const lanternM = [];
    for (let z = zStart + 4; z < zEnd; z += 6) {
      if (Math.abs(z - crossZ) < 8) continue;
      for (const lx of [laneX - 3, laneX, laneX + 3]) {
        _q.identity(); _s.set(1, 1.3, 1); _p.set(lx, rand(4.5, 6), z);
        lanternM.push(_m.compose(_p, _q, _s).clone());
      }
    }
    addInstanced(lanternGeo, lanternMat, lanternM, false, false);

    // packed market stalls — tables + legs instanced; awnings/goods individual (varied colours)
    const stallTop = [0xa8261f, 0xd9a134, 0x2a7d8e, 0x3a8a5a, 0xcfa83a];
    const tableMat = new THREE.MeshStandardMaterial({ color: 0x6a5a45, roughness: 0.9 });
    const legMat = new THREE.MeshStandardMaterial({ color: 0x444444 });
    const stallLegGeo = new THREE.CylinderGeometry(0.04, 0.04, 2, 5);
    const tableGeo = new THREE.BoxGeometry(3, 0.9, 2);
    const tableM = [], legM = [];
    _q.identity(); _s.set(1, 1, 1);
    for (let z = zStart + 3; z < zEnd; z += rand(4.5, 6.5)) {
      if (Math.abs(z - crossZ) < 8) continue;
      for (const sx of [laneX - 4, laneX + 4]) {
        _p.set(sx, 0.45, z); tableM.push(_m.compose(_p, _q, _s).clone());
        for (const px of [-1.4, 1.4]) for (const pz of [-0.9, 0.9]) {
          _p.set(sx + px, 1.0, z + pz); legM.push(_m.compose(_p, _q, _s).clone());
        }
        const awn = new THREE.Mesh(new THREE.BoxGeometry(3.4, 0.1, 2.4), new THREE.MeshStandardMaterial({ color: pick(stallTop), roughness: 0.8, side: THREE.DoubleSide }));
        awn.position.set(sx, 2.0, z); scene.add(awn);
        for (let q = 0; q < 2; q++) {
          const gbox = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.3, 0.4), new THREE.MeshStandardMaterial({ color: pick(stallTop) }));
          gbox.position.set(sx + rand(-1, 1), 1.05, z + rand(-0.6, 0.6)); scene.add(gbox);
        }
      }
    }
    addInstanced(tableGeo, tableMat, tableM, true, false);
    addInstanced(stallLegGeo, legMat, legM, false, false);

    world.poi.yaowarat = new THREE.Vector3(laneX, 0, (zStart + zEnd) / 2);
  }

  // ---- Hidden amulets: a collectible hunt across the districts ----
  {
    world.collectibles = [];
    const amMat = new THREE.MeshStandardMaterial({ color: 0xffcf4a, emissive: 0xffcf4a, emissiveIntensity: 0.7, roughness: 0.3, metalness: 0.6 });
    const amGeo = new THREE.OctahedronGeometry(0.4);
    for (let n = 0; n < 15; n++) {
      // place on a road (grid line) so each is always reachable, never inside a building
      let x, z;
      if (Math.random() < 0.5) {
        const gi = irand(-GRID/2 + 1, GRID/2 - 1);   // x in -200..200, east of the river
        x = gi * BLOCK + rand(-1.5, 1.5);
        z = rand(-HALF + 14, HALF - 14);
      } else {
        const gj = irand(-GRID/2 + 1, GRID/2 - 1);
        z = gj * BLOCK + rand(-1.5, 1.5);
        x = rand(-195, HALF - 14);                    // keep east of the riverside road
      }
      const m = new THREE.Mesh(amGeo, amMat);          // shared geo/mat — never disposed
      m.position.set(x, 1.3, z); scene.add(m);
      world.collectibles.push({ mesh: m, taken: false });
    }
  }

  // ---- Street-food stalls: a second collectible set; visit on foot to eat + heal ----
  {
    world.foodStalls = [];
    const cartGeo = new THREE.BoxGeometry(1.6, 0.9, 1.0);
    const cartMat = new THREE.MeshStandardMaterial({ color: 0x8a6a3a, roughness: 0.8 });
    const parasolGeo = new THREE.ConeGeometry(1.3, 0.6, 8);
    for (let n = 0; n < 10; n++) {
      let x, z;
      if (Math.random() < 0.5) {
        const gi = irand(-GRID/2 + 1, GRID/2 - 1);
        x = gi * BLOCK + (Math.random() < 0.5 ? -5 : 5); z = rand(-HALF + 14, HALF - 14);
      } else {
        const gj = irand(-GRID/2 + 1, GRID/2 - 1);
        z = gj * BLOCK + (Math.random() < 0.5 ? -5 : 5); x = rand(-190, HALF - 14);
      }
      const stall = new THREE.Group();
      const cart = new THREE.Mesh(cartGeo, cartMat); cart.position.y = 0.6; stall.add(cart);
      const glowColor = pick([0xffaa33, 0xff5a5a, 0x39c6c0]);
      const glowMat = new THREE.MeshStandardMaterial({ color: glowColor, emissive: glowColor, emissiveIntensity: 0.7, roughness: 0.5 });
      const parasol = new THREE.Mesh(parasolGeo, glowMat); parasol.position.y = 1.9; stall.add(parasol);
      stall.position.set(x, 0, z); scene.add(stall);
      world.foodStalls.push({ pos: new THREE.Vector3(x, 0, z), visited: false, glowMat });
    }
  }

  // ---- Body-armor pickups: respawning vests scattered road-adjacent ----
  {
    world.armorPickups = [];
    const armorMat = new THREE.MeshStandardMaterial({ color: 0x3a7bd5, emissive: 0x3a7bd5, emissiveIntensity: 0.6, roughness: 0.4, metalness: 0.5 });
    const armorGeo = new THREE.BoxGeometry(0.5, 0.7, 0.25);
    for (let n = 0; n < 6; n++) {
      let x, z;
      if (Math.random() < 0.5) {
        const gi = irand(-GRID/2 + 1, GRID/2 - 1);
        x = gi * BLOCK + (Math.random() < 0.5 ? -5 : 5); z = rand(-HALF + 14, HALF - 14);
      } else {
        const gj = irand(-GRID/2 + 1, GRID/2 - 1);
        z = gj * BLOCK + (Math.random() < 0.5 ? -5 : 5); x = rand(-190, HALF - 14);
      }
      const m = new THREE.Mesh(armorGeo, armorMat);   // shared geo/mat — toggled, never disposed
      m.position.set(x, 1.1, z); scene.add(m);
      world.armorPickups.push({ mesh: m, pos: new THREE.Vector3(x, 0, z), readyAt: 0 });
    }
  }

  // ---- Flush static-geometry bakers → a handful of merged meshes ----
  // Everything routed through `baker`/`flatBaker` above (road stripes, sidewalks,
  // building/shop/setback boxes, window + neon planes) collapses here into one
  // merged mesh per material, cutting thousands of draw calls.
  const mergedSolid = baker.flush(scene);
  const mergedFlat = flatBaker.flush(scene);
  G._mergedMeshCount = mergedSolid + mergedFlat;

  // ---- Render minimap base (top-down 2D snapshot of roads/landmarks) ----
  world.minimap = makeMinimapBase(world);

  return world;
}

export function makeWindowTexture() {
  // Two canvases, one cell layout. Albedo: blue-grey mullions + glass cells that
  // read as a daytime curtain wall. Emissive: black except the "lit" cells, so
  // only those glow when the night ramp raises emissiveIntensity.
  const ca = document.createElement('canvas'); ca.width = 64; ca.height = 128;
  const ce = document.createElement('canvas'); ce.width = 64; ce.height = 128;
  const ga = ca.getContext('2d');
  const ge = ce.getContext('2d');
  // emissive base/unlit values match the pre-split texture exactly, so the
  // night look (bright cells + faint plane sheen) is byte-identical to before.
  ga.fillStyle = '#454b55'; ga.fillRect(0,0,64,128);
  ge.fillStyle = '#1a1d22'; ge.fillRect(0,0,64,128);
  for (let y = 6; y < 128; y += 10) {
    for (let x = 4; x < 64; x += 10) {
      const lit = Math.random() < 0.55;
      // day glass: sky-tinted panes with slight variance, regardless of lit state
      const v = 90 + Math.random() * 50 | 0;
      ga.fillStyle = `rgb(${v-20},${v},${v+25|0})`;
      ga.fillRect(x, y, 6, 6);
      ge.fillStyle = lit ? `rgb(${200+Math.random()*55|0},${180+Math.random()*60|0},${120+Math.random()*80|0})` : '#0e1014';
      ge.fillRect(x, y, 6, 6);
    }
  }
  const map = new THREE.CanvasTexture(ca);
  map.wrapS = map.wrapT = THREE.RepeatWrapping;
  const emissiveMap = new THREE.CanvasTexture(ce);
  emissiveMap.wrapS = emissiveMap.wrapT = THREE.RepeatWrapping;
  return { map, emissiveMap };
}

export function makeMinimapBase(world) {
  const SIZE = 256;
  const c = document.createElement('canvas'); c.width = SIZE; c.height = SIZE;
  const g = c.getContext('2d');
  // background
  g.fillStyle = '#1a1d22'; g.fillRect(0,0,SIZE,SIZE);
  // blocks
  g.fillStyle = '#23262b';
  for (let i = -GRID/2; i < GRID/2; i++) {
    for (let j = -GRID/2; j < GRID/2; j++) {
      const x = mapW(i*BLOCK + BLOCK/2 - (BLOCK-12)/2);
      const y = mapW(j*BLOCK + BLOCK/2 - (BLOCK-12)/2);
      const s = (BLOCK-12) * (SIZE/(HALF*2));
      g.fillRect(x, y, s, s);
    }
  }
  // roads
  g.strokeStyle = '#ffcf4a'; g.lineWidth = 3;
  for (let i = -GRID/2; i <= GRID/2; i++) {
    g.beginPath();
    g.moveTo(mapW(-HALF), mapW(i*BLOCK)); g.lineTo(mapW(HALF), mapW(i*BLOCK)); g.stroke();
    g.beginPath();
    g.moveTo(mapW(i*BLOCK), mapW(-HALF)); g.lineTo(mapW(i*BLOCK), mapW(HALF)); g.stroke();
  }
  // BTS line
  g.strokeStyle = '#21f0ff'; g.lineWidth = 2; g.setLineDash([4,3]);
  g.beginPath(); g.moveTo(mapW(-HALF), mapW(0)); g.lineTo(mapW(HALF), mapW(0)); g.stroke();
  g.setLineDash([]);

  // Chao Phraya river along the west edge
  g.fillStyle = '#3a5550';
  const rvX = mapW(-HALF);
  const rvW = mapW(-HALF + BLOCK - 8) - rvX;
  g.fillRect(rvX, 0, rvW, SIZE);

  // U-Spray garages
  g.fillStyle = '#21f0ff';
  for (const ga of (world.garages || [])) {
    g.fillRect(mapW(ga.pos.x) - 3, mapW(ga.pos.z) - 3, 6, 6);
  }

  // Gun shop
  if (world.gunShop) {
    g.fillStyle = '#ff3344';
    g.fillRect(mapW(world.gunShop.x) - 3, mapW(world.gunShop.z) - 3, 6, 6);
  }

  // Yaowarat market street
  if (world.poi && world.poi.yaowarat) {
    g.fillStyle = '#c0392b';
    g.fillRect(mapW(world.poi.yaowarat.x) - 4, mapW(world.poi.yaowarat.z) - 9, 8, 18);
  }

  return c;

  function mapW(v) { return (v + HALF) * (SIZE / (HALF*2)); }
}

// =============================================================================
// 4. PLAYER + CAMERA
// =============================================================================

export function makePlayer(scene) {
  const group = new THREE.Group();
  // body capsule
  const bodyMat = new THREE.MeshStandardMaterial({ color: 0xd44b3b, roughness: 0.7 });
  const pantsMat = new THREE.MeshStandardMaterial({ color: 0x232a35, roughness: 0.8 });
  const skinMat = new THREE.MeshStandardMaterial({ color: 0xc69472, roughness: 0.8 });

  const torso = new THREE.Mesh(new THREE.CapsuleGeometry(0.34, 0.6, 4, 8), bodyMat);
  torso.position.y = 1.05; torso.castShadow = true; group.add(torso);
  const legGeo = new THREE.CapsuleGeometry(0.28, 0.55, 4, 8);
  legGeo.translate(0, -0.555, 0);   // origin at the hip so rotation pivots there, not mid-thigh
  const legs = new THREE.Mesh(legGeo, pantsMat);
  legs.position.y = 1.0; legs.castShadow = true; group.add(legs);
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.22, 12, 10), skinMat);
  head.position.y = 1.65; head.castShadow = true; group.add(head);

  // arms (used for swinging while punching)
  const armGeo = new THREE.CapsuleGeometry(0.1, 0.5, 4, 6);
  armGeo.translate(0, -0.35, 0);    // origin at the shoulder so swings pivot there, not mid-arm
  const armL = new THREE.Mesh(armGeo, bodyMat);
  armL.position.set(-0.42, 1.5, 0); armL.castShadow = true; group.add(armL);
  const armR = new THREE.Mesh(armGeo, bodyMat);
  armR.position.set( 0.42, 1.5, 0); armR.castShadow = true; group.add(armR);

  // pistol model (hidden by default)
  const pistol = new THREE.Group();
  const gunBody = new THREE.Mesh(new THREE.BoxGeometry(0.10, 0.12, 0.22), new THREE.MeshStandardMaterial({ color: 0x222, metalness: 0.7, roughness: 0.4 }));
  pistol.add(gunBody);
  const gunGrip = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.18, 0.10), new THREE.MeshStandardMaterial({ color: 0x111 }));
  gunGrip.position.set(-0.02, -0.13, 0); pistol.add(gunGrip);
  pistol.visible = false;
  group.add(pistol);

  group.position.copy(G.world.spawns.player);
  scene.add(group);

  return {
    group, torso, legs, head, armL, armR, pistol,
    velocity: new THREE.Vector3(),
    yaw: 0, pitch: 0,
    grounded: true,
    hp: 100, hpMax: 100,
    stam: 100, stamMax: 100,
    armor: 0, armorMax: 100,
    sprintLock: false,
    weapons: { fists: true, pistol: false, smg: false, shotgun: false },
    activeWeapon: 'fists',
    pistolAmmo: 0, pistolMag: 12, pistolReserve: 36,
    smgAmmo: 0, smgMag: 30, smgReserve: 90,
    shotgunAmmo: 0, shotgunMag: 6, shotgunReserve: 24,
    inVehicle: null,
    // combat anim state
    attackTimer: 0, attackKind: null, attackCooldown: 0,
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
  const cam = new THREE.PerspectiveCamera(72, window.innerWidth / window.innerHeight, 0.1, 2200);
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

export function makeVehicleMesh(kind) {
  const g = new THREE.Group();
  g.userData.kind = kind;
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
  return g;
}

export function makeVehicle(kind, scene) {
  const mesh = makeVehicleMesh(kind);
  scene.add(mesh);
  const spec = mesh.userData.spec;
  // head/tail lights — per-vehicle materials that glow at night (driven from
  // G.nightK in updateVehicles; per-vehicle so disposeObject stays safe).
  const dims = mesh.userData.dims;
  const headMat = new THREE.MeshStandardMaterial({ color: 0x999999, emissive: 0xfff2cc, emissiveIntensity: 0 });
  const tailMat = new THREE.MeshStandardMaterial({ color: 0x331111, emissive: 0xff2222, emissiveIntensity: 0 });
  const lightGeo = new THREE.PlaneGeometry(0.3, 0.18);
  const lz = dims.L * 0.46, lx = dims.W * 0.3, ly = dims.H * 0.32 + 0.2;
  for (const sx of [-1, 1]) {
    const hl = new THREE.Mesh(lightGeo, headMat);
    hl.position.set(sx * lx, ly, lz); mesh.add(hl);
    const tl = new THREE.Mesh(lightGeo, tailMat);
    tl.position.set(sx * lx, ly, -lz); tl.rotation.y = PI; mesh.add(tl);
  }
  const veh = {
    kind, mesh, spec,
    pos: mesh.position,
    vel: 0,            // forward speed (m/s)
    heading: 0,        // yaw radians
    hp: 100,
    smoke: null, fire: null,
    dead: false,
    driver: null,      // 'player' | npc obj | null
    npc: null,
    audio: null,
    isCop: kind === 'cop' || kind === 'fortuner' || kind === 'swat',
    lights: [headMat, tailMat],
    boundsHalf: { x: mesh.userData.dims.W * 0.5, z: mesh.userData.dims.L * 0.5 },
  };
  G.vehicles.push(veh);
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
export function makePedMesh() {
  const g = new THREE.Group();
  const roll = Math.random();
  let kind;
  if (roll < 0.07) kind = 'monk';
  else if (roll < 0.20) kind = 'tourist';
  else if (roll < 0.34) kind = 'office';
  else if (roll < 0.44) kind = 'vendor';
  else if (roll < 0.55) kind = 'laborer';
  else kind = 'local';

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

  // head + hair/hat
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.135, 10, 8), skinMat);
  head.position.y = 1.5; head.castShadow = true; g.add(head);
  if (kind === 'vendor' || kind === 'laborer') {
    const hat = new THREE.Mesh(new THREE.ConeGeometry(0.26, 0.2, 10), new THREE.MeshStandardMaterial({ color: 0xcba76a, roughness: 0.9 }));
    hat.position.y = 1.6; g.add(hat);                                   // conical straw hat
  } else if (kind === 'tourist' && Math.random() < 0.6) {
    const cap = new THREE.Mesh(new THREE.SphereGeometry(0.15, 8, 6, 0, TAU, 0, PI/2), new THREE.MeshStandardMaterial({ color: pick([0xb03030, 0x305080, 0xf0f0f0]) }));
    cap.position.y = 1.55; g.add(cap);
  } else if (kind !== 'monk') {
    const hair = new THREE.Mesh(new THREE.SphereGeometry(0.145, 8, 6, 0, TAU, 0, PI/1.7), new THREE.MeshStandardMaterial({ color: pick([0x1a1410, 0x2a2018, 0x0a0a0a]) }));
    hair.position.y = 1.5; g.add(hair);
  }

  // limbs — geometry offset so the mesh origin sits at the joint (rotation.x pivots there)
  function limb(len, r, mat, cast) {
    const geo = new THREE.CapsuleGeometry(r, len, 3, 6);
    geo.translate(0, -(len / 2 + r), 0);
    const m = new THREE.Mesh(geo, mat); m.castShadow = !!cast; return m;
  }
  const hipY = 0.92, shoulderY = 1.42;
  let legL, legR;
  if (skirt) {
    const sk = new THREE.Mesh(new THREE.ConeGeometry(0.26, 0.5, 10), pantsMat);
    sk.position.y = 0.7; sk.castShadow = true; g.add(sk);
    legL = limb(0.3, 0.07, skinMat, false); legL.position.set(-0.08, 0.42, 0);
    legR = limb(0.3, 0.07, skinMat, false); legR.position.set( 0.08, 0.42, 0);
  } else {
    legL = limb(0.62, 0.085, pantsMat, true); legL.position.set(-0.09, hipY, 0);
    legR = limb(0.62, 0.085, pantsMat, true); legR.position.set( 0.09, hipY, 0);
  }
  g.add(legL); g.add(legR);
  const armL = limb(0.5, 0.06, armMat, false); armL.position.set(-0.25, shoulderY, 0); g.add(armL);
  const armR = limb(0.5, 0.06, armMat, false); armR.position.set( 0.25, shoulderY, 0); g.add(armR);

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
  }

  const build = rand(0.92, 1.08);
  g.scale.set(build, rand(0.94, 1.06), build);
  g.userData.parts = { torso, head, legL, legR, armL, armR };
  g.userData.kind = kind;
  g.userData.phase = rand(0, TAU);
  return g;
}

// Shared limb animator for peds + foot cops: advances a per-mesh walk phase and
// swings legs/arms (arms opposite the same-side leg). `moving` false → near-still
// idle with a faint breathing bob.
export function animateWalk(mesh, speed, dt, moving) {
  const p = mesh.userData.parts; if (!p) return;
  const ud = mesh.userData;
  ud.phase = (ud.phase || 0) + (moving ? (1.6 + speed) * dt * 2.0 : dt * 1.2);
  const amp = moving ? Math.min(0.7, 0.3 + speed * 0.16) : 0.05;
  const s = Math.sin(ud.phase), c = Math.sin(ud.phase + PI);
  if (p.legL) p.legL.rotation.x = s * amp;
  if (p.legR) p.legR.rotation.x = c * amp;
  if (p.armL) p.armL.rotation.x = c * amp * 0.9;
  if (p.armR) p.armR.rotation.x = s * amp * 0.9;
  if (p.torso) p.torso.position.y = 1.18 + (moving ? 0 : Math.sin(ud.phase * 0.7) * 0.012);
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

export function spawnPed(scene, pos) {
  const m = makePedMesh();
  m.position.copy(pos);
  m.userData.heading = rand(0, TAU);
  scene.add(m);
  const ped = {
    mesh: m,
    heading: m.userData.heading,
    speed: rand(0.9, 1.7),
    state: 'walking',
    waitT: 0,
    panicT: 0,
    hp: 30,
    dead: false,
  };
  G.peds.push(ped);
  return ped;
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

export function spawnTraffic(scene) {
  // Each road segment can hold some cars. We sample edges and place vehicles.
  const kinds = ['camry','camry','camry','sedan','sedan','tuktuk','hilux','songthaew','songthaew','bus','luxsedan','luxsedan','bike','bike'];
  for (let n = 0; n < 28; n++) {
    let kind = pick(kinds);
    if (Math.random() < 0.04) kind = 'supercar';   // rare spawn
    const v = makeVehicle(kind, scene);
    // pick a random horizontal or vertical road
    const isEW = Math.random() < 0.5;
    const lane = irand(-GRID/2, GRID/2);
    const t = rand(-HALF + 10, HALF - 10);
    if (isEW) { v.pos.set(t, 0, lane * BLOCK + (Math.random()<0.5 ? -2.5 : 2.5)); v.heading = Math.random()<0.5 ? 0 : PI; }
    else      { v.pos.set(lane * BLOCK + (Math.random()<0.5 ? -2.5 : 2.5), 0, t); v.heading = Math.random()<0.5 ? PI/2 : -PI/2; }
    v.mesh.position.copy(v.pos);
    v.mesh.rotation.y = v.heading;
    v.npc = {
      kind: 'traffic',
      // assign nearest grid intersection ahead as the immediate target
      targetIdx: null,
      cruiseSpeed: rand(8, 14) * (kind==='bike'?1.2:1) * (kind==='tuktuk'?0.7:1),
      reactionT: 0,
      stopT: 0,
      honkCooldown: rand(5, 20),
    };
    v.vel = v.npc.cruiseSpeed;
  }
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
  const v = makeVehicle('boat', scene);
  v.pos.set(-212, 0.3, -50); v.mesh.position.copy(v.pos);
  v.heading = 0; v.mesh.rotation.y = 0;
  v.driver = null; v.vel = 0;
}

export function spawnPeds(scene, n) {
  for (let i = 0; i < n; i++) {
    spawnPed(scene, sidewalkPos(rand(-HALF + 12, HALF - 12), rand(-HALF + 12, HALF - 12), 8));
  }
}

export function spawnDogs(scene, n) {
  for (let i = 0; i < n; i++) {
    spawnDog(scene, new THREE.Vector3(rand(-HALF+20, HALF-20), 0, rand(-HALF+20, HALF-20)));
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
// 8. ENGINE / SCENE INIT
// =============================================================================

// =============================================================================
//  SAVE / LOAD (localStorage) — autosaves money/gear/amulets/time/position
// =============================================================================
const SAVE_KEY = 'gtabkk_save_v1';

export function saveGame() {
  try {
    const p = G.player;
    if (!p) return;
    localStorage.setItem(SAVE_KEY, JSON.stringify({
      cash: G.cash, armor: p.armor, dayT: G.time.dayT, copsKilled: _copsKilled,
      weapons: { pistol: !!p.weapons.pistol, smg: !!p.weapons.smg, shotgun: !!p.weapons.shotgun },
      pistolAmmo: p.pistolAmmo, pistolReserve: p.pistolReserve,
      smgAmmo: p.smgAmmo, smgReserve: p.smgReserve,
      shotgunAmmo: p.shotgunAmmo, shotgunReserve: p.shotgunReserve,
      amulets: (G.world.collectibles || []).map(a => a.taken),
      food: (G.world.foodStalls || []).map(f => f.visited), foodVisited: G.foodVisited || 0,
      collected: G.collected || 0,
      welcomeDone: !!G._welcomeDone,
      soiRunWon: !!G._soiRunWon, hitDone: !!G._hitDone,
      px: p.group.position.x, pz: p.group.position.z,
      // property / ownership economy
      safehouseOwned: !!G.econ.safehouse.owned,
      garageRented: !!G.econ.garage.rented,
      garageStored: G.econ.garage.stored,
    }));
  } catch (e) { /* storage unavailable — ignore */ }
}

const SETTINGS_KEY = 'gtabkk_settings';
export function applySettings() { if (G.audio && G.audio.setVolume) G.audio.setVolume(G.settings.volume); }
export function saveSettings() { try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(G.settings)); } catch (e) {} }
export function loadSettings() {
  G.settings = { sensitivity: 1, volume: 0.55 };
  try { const s = JSON.parse(localStorage.getItem(SETTINGS_KEY)); if (s) Object.assign(G.settings, s); } catch (e) {}
  applySettings();
  const se = document.getElementById('opt-sens'), ve = document.getElementById('opt-vol');
  if (se) se.value = G.settings.sensitivity;
  if (ve) ve.value = G.settings.volume;
}

export function loadGame() {
  let s = null;
  try { s = JSON.parse(localStorage.getItem(SAVE_KEY)); } catch (e) { s = null; }
  if (!s || !G.player) return;
  const p = G.player;
  if (typeof s.cash === 'number') G.cash = s.cash;
  if (typeof s.armor === 'number') p.armor = s.armor;
  if (typeof s.dayT === 'number') G.time.dayT = s.dayT;
  if (typeof s.copsKilled === 'number') _copsKilled = s.copsKilled;
  if (s.weapons) {
    p.weapons.pistol = !!s.weapons.pistol;
    p.weapons.smg = !!s.weapons.smg;
    p.weapons.shotgun = !!s.weapons.shotgun;
    if (typeof s.pistolAmmo === 'number') p.pistolAmmo = s.pistolAmmo;
    if (typeof s.pistolReserve === 'number') p.pistolReserve = s.pistolReserve;
    if (typeof s.smgAmmo === 'number') p.smgAmmo = s.smgAmmo;
    if (typeof s.smgReserve === 'number') p.smgReserve = s.smgReserve;
    if (typeof s.shotgunAmmo === 'number') p.shotgunAmmo = s.shotgunAmmo;
    if (typeof s.shotgunReserve === 'number') p.shotgunReserve = s.shotgunReserve;
  }
  if (Array.isArray(s.amulets) && G.world.collectibles) {
    s.amulets.forEach((taken, i) => {
      const a = G.world.collectibles[i];
      if (taken && a && !a.taken) { a.taken = true; G.scene.remove(a.mesh); }
    });
    G.collected = (typeof s.collected === 'number') ? s.collected : s.amulets.filter(Boolean).length;
  }
  if (Array.isArray(s.food) && G.world.foodStalls) {
    s.food.forEach((v, i) => { const f = G.world.foodStalls[i]; if (v && f && !f.visited) { f.visited = true; f.glowMat.emissiveIntensity = 0; f.glowMat.color.setHex(0x555555); } });
    G.foodVisited = (typeof s.foodVisited === 'number') ? s.foodVisited : s.food.filter(Boolean).length;
  }
  if (typeof s.px === 'number' && typeof s.pz === 'number') p.group.position.set(s.px, 0, s.pz);
  if (s.soiRunWon) G._soiRunWon = true;
  if (s.hitDone) G._hitDone = true;
  if (s.welcomeDone) { G._welcomeDone = true; if (G.mission.resume) G.mission.resume(true); }
  // property / ownership economy
  if (s.safehouseOwned) { G.econ.safehouse.owned = true; markSafehouseOwned(); }
  if (s.garageRented) G.econ.garage.rented = true;
  if (Array.isArray(s.garageStored)) {
    G.econ.garage.stored = s.garageStored
      .filter(v => v && typeof v.kind === 'string')
      .map(v => ({ kind: v.kind, color: v.color | 0, plate: String(v.plate || ''), hp: typeof v.hp === 'number' ? v.hp : 100 }))
      .slice(0, G.econ.garage.capacity);
  }
  G.hud.setCash(G.cash);
  updateAmmoHud();
}

async function init() {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x1a1a26);
  scene.fog = new THREE.FogExp2(0x556677, 0.0015);
  G.scene = scene;

  const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.0;
  document.getElementById('app').appendChild(renderer.domElement);
  G.renderer = renderer;

  // Sun (directional light)
  const sun = new THREE.DirectionalLight(0xffe0a0, 1.3);
  sun.position.set(80, 100, 40);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  const d = 80;
  sun.shadow.camera.left = -d; sun.shadow.camera.right = d;
  sun.shadow.camera.top = d; sun.shadow.camera.bottom = -d;
  sun.shadow.camera.near = 1; sun.shadow.camera.far = 300;
  sun.shadow.bias = -0.0008;
  scene.add(sun);
  scene.add(sun.target);   // target must be in the scene graph so per-frame re-anchoring takes effect
  G.sun = sun;

  // Hemisphere fill — ground color is warm concrete bounce, not dark soil
  const hemi = new THREE.HemisphereLight(0xa8c7ff, 0x8a7f72, 0.55);
  scene.add(hemi);
  G.hemi = hemi;

  // Ambient at night
  const amb = new THREE.AmbientLight(0x404856, 0.15);
  scene.add(amb);
  G.amb = amb;

  // Camera
  const camRig = makeCamera();
  G.camera = camRig.cam;
  G.camRig = camRig;
  window.addEventListener('resize', () => {
    camRig.cam.aspect = window.innerWidth / window.innerHeight;
    camRig.cam.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
  });

  // Audio
  G.audio = makeAudio();

  // Loading bar
  setProgress(20);

  // World
  G.world = buildWorld(scene);
  setProgress(60);

  // Player
  G.player = makePlayer(scene);
  setProgress(72);

  // Spawn vehicles, peds, dogs
  spawnTraffic(scene);
  spawnParkedCars(scene);
  spawnBoat(scene);
  // a parked, enterable cop car — the Vigilante ride
  { const v = spawnCopCar(scene, new THREE.Vector3(50, 0, 90)); v.driver = null; v.vel = 0; v.heading = 0; v.mesh.rotation.y = 0; }
  spawnPeds(scene, 60);
  spawnDogs(scene, 16);
  buildClusterAnchors();
  setProgress(88);

  // A parked motorbike right next to the player so they can grab it immediately
  const bike = makeVehicle('bike', scene);
  bike.pos.set(G.world.spawns.player.x + 5, 0, G.world.spawns.player.z + 1);
  bike.heading = -PI/2;
  bike.vel = 0;
  bike.mesh.position.copy(bike.pos);
  bike.mesh.rotation.y = bike.heading;
  bike.npc = null; // unmanned

  // Park one more nearby — a tuk-tuk
  const tuk = makeVehicle('tuktuk', scene);
  tuk.pos.set(G.world.spawns.player.x - 7, 0, G.world.spawns.player.z + 1);
  tuk.heading = PI/2;
  tuk.mesh.position.copy(tuk.pos); tuk.mesh.rotation.y = tuk.heading;
  tuk.npc = null;

  // Rain
  G.rain = makeRain(scene);

  // Bullets pool
  G.bulletGeom = new THREE.SphereGeometry(0.06, 6, 6);
  G.bulletMat = new THREE.MeshBasicMaterial({ color: 0xffeebb });

  // HUD bind
  G.hud = bindHud();

  // Mission
  G.mission = makeMissionSystem();
  G.mission.start('welcome');

  // Input
  G.input = makeInput();

  // Click anywhere → request pointer lock
  renderer.domElement.addEventListener('click', () => {
    if (G.state === 'playing' && !G.input.pointerLocked) G.input.requestLock();
    if (G.audio.ctx.state === 'suspended') G.audio.ctx.resume();
  });

  // Tab → map zoom (placeholder)
  setProgress(100);

  // Reveal start button once everything is ready
  const startBtn = document.getElementById('startbtn');
  startBtn.classList.add('ready');
  startBtn.addEventListener('click', () => {
    document.getElementById('loading').style.opacity = '0';
    setTimeout(() => document.getElementById('loading').style.display = 'none', 800);
    G.state = 'playing';
    G.input.requestLock();
    if (G.audio.ctx.state === 'suspended') G.audio.ctx.resume();
    G.audio.bell();   // dawn bell to set tone
  });

  // Pause overlay: click to resume (re-locks the pointer)
  const pauseEl = document.getElementById('pause');
  if (pauseEl) pauseEl.addEventListener('click', () => {
    pauseEl.classList.remove('show');
    G.state = 'playing';
    G.input.requestLock();
  });

  // Game-over overlay: click to respawn and resume
  const goEl = document.getElementById('gameover');
  if (goEl) goEl.addEventListener('click', () => {
    goEl.classList.remove('show');
    respawnPlayer();
    G.state = 'playing';
    G.input.requestLock();
  });

  // Options menu sliders
  loadSettings();
  const optSens = document.getElementById('opt-sens');
  if (optSens) optSens.addEventListener('input', e => { G.settings.sensitivity = parseFloat(e.target.value); saveSettings(); });
  const optVol = document.getElementById('opt-vol');
  if (optVol) optVol.addEventListener('input', e => { G.settings.volume = parseFloat(e.target.value); applySettings(); saveSettings(); });

  // 7-Eleven store overlay buttons
  const sbind = (id, fn) => { const el = document.getElementById(id); if (el) el.addEventListener('click', fn); };
  sbind('buy-snack', () => storeBuy('snack'));
  sbind('buy-drink', () => storeBuy('drink'));
  sbind('buy-vest', () => storeBuy('vest'));
  sbind('store-leave', () => { document.getElementById('store').classList.remove('show'); G.state = 'playing'; G.input.requestLock(); });

  // Restore saved progress, then autosave on unload
  loadGame();
  window.addEventListener('beforeunload', saveGame);

  // Start loop
  G.clock = new THREE.Clock();
  loop();
}

export function setProgress(p) {
  const bar = document.getElementById('loadbar');
  if (bar) bar.style.width = p + '%';
}

// =============================================================================
// → ./hud.js
// → ./missions.js
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
const _skidGeo = new THREE.PlaneGeometry(0.34, 1.2); _skidGeo.rotateX(-PI / 2);  // lies flat, length along +Z
const _skidMat = new THREE.MeshBasicMaterial({ color: 0x0b0b0b, transparent: true, opacity: 0.5, depthWrite: false });
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
// 12. UPDATE LOOPS — Player / Vehicles / NPCs
// =============================================================================

export function updatePlayer(dt) {
  const p = G.player;
  if (p.inVehicle) { updatePlayerInVehicle(dt); return; }

  // mouse look
  const [dx, dy] = G.input.consumeMouseDelta();
  const sens = 0.0024 * (G.settings ? G.settings.sensitivity : 1);
  G.camRig.yaw   -= dx * sens;
  G.camRig.pitch -= dy * sens;
  G.camRig.pitch = clamp(G.camRig.pitch, -1.1, 0.6);

  // movement input
  const forward = (G.input.down('KeyW')?1:0) - (G.input.down('KeyS')?1:0);
  const strafe  = (G.input.down('KeyD')?1:0) - (G.input.down('KeyA')?1:0);
  const sprint  = G.input.down('ShiftLeft') && p.stam > 4;
  const moving = forward !== 0 || strafe !== 0;
  let speed = 3.4;
  if (sprint && moving) { speed = 6.4; p.stam = Math.max(0, p.stam - 22*dt); }
  else { p.stam = Math.min(p.stamMax, p.stam + 18*dt); }

  // calculate desired velocity in world space relative to camera yaw
  const fx = -Math.sin(G.camRig.yaw), fz = -Math.cos(G.camRig.yaw);
  const rx =  Math.cos(G.camRig.yaw), rz = -Math.sin(G.camRig.yaw);
  let vx = fx * forward + rx * strafe;
  let vz = fz * forward + rz * strafe;
  const len = Math.hypot(vx, vz);
  if (len > 0.001) { vx = vx / len * speed; vz = vz / len * speed; }
  p.velocity.x = lerp(p.velocity.x, vx, 0.25);
  p.velocity.z = lerp(p.velocity.z, vz, 0.25);
  // gravity / jump
  if (G.input.pressed('Space') && p.grounded && !G.input.down('ControlLeft')) {
    p.velocity.y = 5.0; p.grounded = false;
  }
  if (!p.grounded) {
    p.velocity.y -= 18 * dt;
  }
  p.group.position.addScaledVector(p.velocity, dt);
  if (p.group.position.y <= 0) { p.group.position.y = 0; p.velocity.y = 0; p.grounded = true; }

  resolvePlayerVsBuildings(p);

  // body face direction of movement (or aim if firing)
  if (p.activeWeapon === 'pistol' && G.input.rightDown) {
    p.yaw = G.camRig.yaw + PI;
  } else if (moving) {
    const desired = Math.atan2(vx, vz);
    p.yaw = lerpAngle(p.yaw, desired, 0.25);
  }
  p.group.rotation.y = p.yaw;

  // animations: leg bob, arm swing
  const tnow = performance.now() * 0.005;
  if (moving) {
    p.legs.rotation.x = Math.sin(tnow * speed * 0.5) * 0.5;
    p.torso.rotation.x = Math.sin(tnow * speed * 0.5) * 0.05;
    p.armL.rotation.x = -Math.sin(tnow * speed * 0.5) * 0.6;
    p.armR.rotation.x =  Math.sin(tnow * speed * 0.5) * 0.6;
    // footstep audio
    p._stepPhase = (p._stepPhase||0) + dt * speed;
    if (p._stepPhase > 0.6) { p._stepPhase = 0; G.audio.step(G.time.rainStrength > 0.3); }
  } else {
    p.legs.rotation.x *= 0.85;
    p.torso.rotation.x *= 0.85;
    p.armL.rotation.x *= 0.85;
    p.armR.rotation.x *= 0.85;
  }

  // Combat
  updateCombat(dt);

  // 7-Eleven proximity — snacks restore HP, a vest tops up armor
  for (const e of G.world.sevenElevens) {
    if (dist2(p.group.position, e.pos) < 7*7) {
      if (Date.now() - e.chimed > 4000) {
        G.audio.chime(); e.chimed = Date.now();
        const healed = p.hp < p.hpMax;
        const vested = GAMEPLAY.armor && p.armor < 50;
        if (healed) p.hp = p.hpMax;
        if (vested) p.armor = 50;
        if (healed || vested) {
          G.hud.showNotif('7-Eleven — ' + (healed && vested ? 'HP & armor restored' : healed ? 'HP restored' : 'armor restored'));
        }
      }
    }
  }
}

// Show a banner when the player crosses into a named district.
export function updateDistrict() {
  const p = G.player.group.position;
  const poi = G.world.poi;
  let zone;
  if (p.x < -185) zone = { en: 'Riverside', th: 'ริมแม่น้ำ' };
  else if (poi.yaowarat && dist2(p, poi.yaowarat) < 62*62) zone = { en: 'Yaowarat', th: 'เยาวราช' };
  else if (poi.temple && dist2(p, poi.temple) < 46*46) zone = { en: 'The Wat', th: 'วัด' };
  else zone = { en: 'Sukhumvit', th: 'สุขุมวิท' };
  if (zone.en !== G._districtName) {
    const first = G._districtName === undefined;   // don't banner the spawn district
    G._districtName = zone.en;
    if (!first) G.hud.showSubtitle(zone.en, zone.th, 2.2);
  }
}

// Slide the Skytrain back and forth along the elevated track.
export function updateBTS(dt) {
  const b = G.bts;
  if (!b) return;
  b.mesh.position.x += b.dir * b.speed * dt;
  if (b.mesh.position.x > b.max) b.dir = -1;
  else if (b.mesh.position.x < b.min) b.dir = 1;
  // rumble as the train passes over a player near the track (z≈0)
  const dx = b.mesh.position.x - G.player.group.position.x;
  if ((b._dxPrev || 0) * dx < 0 && Math.abs(G.player.group.position.z) < 45 && G.audio.rumble) G.audio.rumble();
  b._dxPrev = dx;
}

// Spin/bob the hidden amulets and collect them on touch.
export function updateCollectibles(dt) {
  const cs = G.world.collectibles;
  if (!cs) return;
  const pp = G.player.group.position;
  const tnow = performance.now() * 0.003;
  for (const a of cs) {
    if (a.taken) continue;
    a.mesh.rotation.y += dt * 2;
    a.mesh.position.y = 1.3 + Math.sin(tnow + a.mesh.position.x) * 0.15;
    if (dist2(a.mesh.position, pp) < 2.6 * 2.6) {
      a.taken = true;
      G.scene.remove(a.mesh);
      G.collected = (G.collected || 0) + 1;
      G.cash += 100;
      G.hud.setCash(G.cash);
      G.audio.blip({ freq: 880, dur: 0.1, gain: 0.12 });
      if (G.collected >= cs.length) {
        G.cash += 3000; G.hud.setCash(G.cash);
        G.hud.showNotif(`All ${cs.length} amulets found! +฿2,000`);
      } else {
        G.hud.showNotif(`Amulet ${G.collected}/${cs.length} (+฿100)`);
      }
    }
  }
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
    if (v.audio) { v.audio.set(0, false); }
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
  // accel
  if (forward > 0) v.vel += spec.accel * (boost ? 1.3 : 1) * dt;
  else if (forward < 0) {
    if (v.vel > 0.2) v.vel -= spec.brake * dt;
    else v.vel -= spec.accel * 0.6 * dt; // reverse
  } else {
    v.vel *= Math.pow(0.985, dt * 60);
  }
  if (handbrake) v.vel *= Math.pow(0.94, dt*60);
  const speedMul = v.tiresBlown ? 0.5 : 1;   // spike strips halve your top speed
  v.vel = clamp(v.vel, -spec.topSpeed * 0.4 * speedMul, spec.topSpeed * (boost ? 1.15 : 1) * speedMul);
  // steering — speed dependent
  const steerRate = spec.turn * (1 - Math.min(1, Math.abs(v.vel)/spec.topSpeed) * 0.4);
  v.heading += steer * steerRate * dt * (v.vel >= 0 ? 1 : -1) * (Math.abs(v.vel)>0.3 ? 1 : 0);
  // arcade handbrake drift: extra oversteer + lay rubber while sliding
  if (handbrake && Math.abs(v.vel) > 6 && Math.abs(steer) > 0.15 && spec.kind !== 'boat' && spec.kind !== 'bike') {
    v.heading += steer * 1.5 * dt * (v.vel >= 0 ? 1 : -1);
    spawnSkid(v);
  }

  // motorbike lean
  if (v.spec.kind === 'bike') {
    v.mesh.rotation.z = lerp(v.mesh.rotation.z || 0, -steer * 0.35, 0.15);
  } else if (v.spec.kind === 'tuktuk') {
    // tippy oversteer wiggle
    v.mesh.rotation.z = lerp(v.mesh.rotation.z || 0, -steer * 0.18 + Math.sin(performance.now()*0.01)*0.02, 0.2);
  }

  // apply motion
  v.pos.x += Math.sin(v.heading) * v.vel * dt;
  v.pos.z += Math.cos(v.heading) * v.vel * dt;
  if (v.spec.kind === 'boat') {            // keep the boat in the river channel
    v.pos.x = clamp(v.pos.x, -248, -210);
    v.pos.z = clamp(v.pos.z, -246, 246);
    v.pos.y = 0.3;
  }
  v.mesh.position.copy(v.pos);
  v.mesh.rotation.y = v.heading;

  if (v.spec.kind !== 'boat') resolveVehicleVsBuildings(v);

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

export function updateTrafficCar(v, dt) {
  const npc = v.npc;
  // simple grid following: pick a heading aligned with the road, choose new heading at intersections
  // collision check ahead with player vehicle / other cars / peds
  const headingX = Math.sin(v.heading), headingZ = Math.cos(v.heading);
  let block = false;
  for (const o of G.vehicles) {
    if (o === v) continue;
    const dx = o.pos.x - v.pos.x;
    const dz = o.pos.z - v.pos.z;
    const fwd = dx * headingX + dz * headingZ;
    const side = -dx * headingZ + dz * headingX;
    if (fwd > 0 && fwd < 8 && Math.abs(side) < 1.6) { block = true; break; }
  }
  // peds in road
  for (const ped of G.peds) {
    if (ped.dead) continue;
    const dx = ped.mesh.position.x - v.pos.x;
    const dz = ped.mesh.position.z - v.pos.z;
    const fwd = dx * headingX + dz * headingZ;
    const side = -dx * headingZ + dz * headingX;
    if (fwd > 0 && fwd < 5 && Math.abs(side) < 1.2) { block = true; break; }
  }
  // approaching intersection: random turn
  const nearIntersection = isNearGridLine(v.pos.x) && isNearGridLine(v.pos.z);
  if (nearIntersection && !npc.turnedRecently) {
    if (Math.random() < 0.25) {
      // 90-degree turn
      const turn = Math.random() < 0.5 ? PI/2 : -PI/2;
      v.heading += turn;
    }
    npc.turnedRecently = 0.8;
  }
  if (npc.turnedRecently > 0) npc.turnedRecently = Math.max(0, npc.turnedRecently - dt);

  // accel
  const target = block ? 0 : npc.cruiseSpeed;
  if (v.vel < target) v.vel = Math.min(target, v.vel + v.spec.accel * dt);
  else v.vel = Math.max(target, v.vel - v.spec.brake * dt);

  v.pos.x += Math.sin(v.heading) * v.vel * dt;
  v.pos.z += Math.cos(v.heading) * v.vel * dt;
  v.mesh.position.copy(v.pos);
  v.mesh.rotation.y = v.heading;

  // honk if blocked
  if (block && (npc.honkCooldown -= dt) <= 0) {
    G.audio.honk();
    npc.honkCooldown = rand(2, 6);
  }

  // bounds wrap / despawn-respawn far from player
  const playerPos = G.player.group.position;
  if (dist2(v.pos, playerPos) > 220*220) {
    // teleport ahead of player on a road
    respawnTraffic(v, playerPos);
  }
}

export function isNearGridLine(v) {
  const m = ((v + HALF) % BLOCK) - BLOCK/2;
  return Math.abs(m) < 1.5;
}

export function respawnTraffic(v, playerPos) {
  const angle = rand(0, TAU);
  const r = rand(70, 130);
  const x = clamp(playerPos.x + Math.cos(angle) * r, -HALF + 5, HALF - 5);
  const z = clamp(playerPos.z + Math.sin(angle) * r, -HALF + 5, HALF - 5);
  // snap to nearest road
  const ix = Math.round(x / BLOCK) * BLOCK;
  const iz = Math.round(z / BLOCK) * BLOCK;
  if (Math.abs(x - ix) < Math.abs(z - iz)) { v.pos.set(ix + (Math.random()<0.5?-2.5:2.5), 0, z); v.heading = Math.random()<0.5 ? 0 : PI; v.heading = (v.pos.x > ix ? 0 : PI); }
  else { v.pos.set(x, 0, iz + (Math.random()<0.5?-2.5:2.5)); v.heading = (v.pos.z > iz ? -PI/2 : PI/2); }
  v.vel = v.npc.cruiseSpeed * 0.7;
}

// =============================================================================
// → ./npcs.js
// → ./combat.js
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
// 17. INTERACTION — get in/out of vehicle
// =============================================================================

export function updateInteraction(dt) {
  const p = G.player;
  if (p.inVehicle) return;

  // Inside the garage shed, let updateGarageOwnership own the E key (rent/retrieve)
  // so the enter-vehicle prompt doesn't fight it. The garage door sits just
  // outside this radius, so a car parked/retrieved there is still enterable.
  const gg = G.world.garages && G.world.garages[0];
  if (gg && dist2(p.group.position, gg.pos) < gg.r * gg.r) return;

  // find nearest vehicle within reach that isn't a cop unit or a burning wreck
  let near = null, nd = Infinity;
  for (const v of G.vehicles) {
    if (v.driver || v.dead) continue; // occupied/cop/player, or a wreck about to despawn
    const d2 = dist2(v.pos, p.group.position);
    if (d2 < 8 && d2 < nd) { nd = d2; near = v; }
  }
  if (near) {
    G.hud.showPrompt('Press <b>E</b> to enter ' + vehicleName(near.kind), 0.5);
    if (G.input.pressed('KeyE')) {
      p.inVehicle = near;
      near.driver = 'player';
      near.npc = null;   // take over from the traffic AI if it was a moving car
      G.audio.blip({freq:300, dur:0.05, gain:0.08});
    }
  } else {
    updateGunShop(dt);   // E does shop business only when no vehicle is in reach
    update7Eleven(dt);
    updateSafehouse(dt);
  }
}

// Enter a 7-Eleven (on foot) to open the store overlay.
export function update7Eleven(dt) {
  const p = G.player;
  for (const e of G.world.sevenElevens) {
    if (dist2(p.group.position, e.pos) < 5 * 5) {
      G.hud.showPrompt('Press <b>E</b> to enter <b>7-Eleven</b>', 0.4);
      if (G.input.pressed('KeyE')) {
        G.state = 'store';
        document.getElementById('store').classList.add('show');
        document.exitPointerLock();
      }
      return;
    }
  }
}
// Safehouse (on foot at the door): buy it once, then rest to heal + save. Owning
// it makes it your respawn point instead of the police station.
export function updateSafehouse(dt) {
  const p = G.player;
  const door = G.world.poi && G.world.poi.safehouse;
  if (!door || dist2(p.group.position, door) > 6 * 6) return;
  const sh = G.econ.safehouse;
  if (!sh.owned) {
    G.hud.showPrompt(`Safehouse for sale — <b>E</b>: buy (฿${PRICE.safehouse.toLocaleString()})`, 0.4);
    if (G.input.pressed('KeyE')) {
      if (G.cash < PRICE.safehouse) { G.hud.showNotif('Not enough cash for the safehouse'); return; }
      G.cash -= PRICE.safehouse; G.hud.setCash(G.cash);
      sh.owned = true;
      markSafehouseOwned();
      G.hud.showNotif('Safehouse bought — you respawn here now');
      G.audio.chime();
      saveGame();
    }
  } else {
    G.hud.showPrompt('Home — <b>E</b>: rest (heal + save)', 0.4);
    if (G.input.pressed('KeyE')) {
      p.hp = p.hpMax; if (typeof p.stam === 'number') p.stam = p.stamMax;
      G.hud.showNotif('Rested at home — healed & saved');
      G.audio.chime();
      saveGame();
    }
  }
}
export function markSafehouseOwned() {
  const m = G.world.safehouseSign;
  if (m) { m.color.setHex(0x39ff7a); m.emissive.setHex(0x39ff7a); }   // FOR SALE → HOME
}

export function storeBuy(item) {
  const p = G.player;
  let ok = false;
  if (item === 'snack' && G.cash >= 20) { G.cash -= 20; p.hp = Math.min(p.hpMax, p.hp + 40); ok = true; }
  else if (item === 'drink' && G.cash >= 30) { G.cash -= 30; p.stam = p.stamMax; ok = true; }
  else if (item === 'vest' && G.cash >= 200) { G.cash -= 200; p.armor = p.armorMax; ok = true; }
  if (ok) { G.hud.setCash(G.cash); G.audio.chime(); }
  else G.hud.showNotif('Not enough cash');
}

// Gun shop: on foot in the shop zone, E buys the next thing you need (then ammo).
export function updateGunShop(dt) {
  const p = G.player;
  const shop = G.world.gunShop;
  if (!shop || dist2(p.group.position, shop) > 7 * 7) return;
  let label, cost, action;
  if (!p.weapons.pistol)    { label = 'Buy 9mm Pistol'; cost = 800;  action = 'pistol'; }
  else if (!p.weapons.shotgun) { label = 'Buy Shotgun'; cost = 2500; action = 'shotgun'; }
  else if (!p.weapons.smg)  { label = 'Buy SMG';        cost = 4000; action = 'smg'; }
  else                      { label = 'Buy ammo';       cost = 300;  action = 'ammo'; }
  G.hud.showPrompt(`Gun shop — <b>E</b>: ${label} (฿${cost})`, 0.4);
  if (G.input.pressed('KeyE')) {
    if (G.cash < cost) { G.hud.showNotif('Not enough cash'); return; }
    G.cash -= cost; G.hud.setCash(G.cash);
    if (action === 'pistol')   { p.weapons.pistol = true; p.pistolAmmo = p.pistolMag; p.pistolReserve = p.pistolMag * 3; }
    else if (action === 'smg') { p.weapons.smg = true; p.smgAmmo = p.smgMag; p.smgReserve = p.smgMag * 3; }
    else if (action === 'shotgun') { p.weapons.shotgun = true; p.shotgunAmmo = p.shotgunMag; p.shotgunReserve = p.shotgunMag * 3; }
    else { p.pistolReserve += p.pistolMag * 3; if (p.weapons.smg) p.smgReserve += p.smgMag * 3; if (p.weapons.shotgun) p.shotgunReserve += p.shotgunMag * 3; }
    updateAmmoHud();
    G.hud.showNotif(label + ' ✓');
    G.audio.blip({ freq: 600, dur: 0.1, gain: 0.12 });
  }
}

export function vehicleName(k) {
  return { bike: 'motorbike', tuktuk: 'tuk-tuk', hilux: 'pickup', camry: 'car', sedan: 'sedan', cop: 'cop pickup', fortuner: 'unmarked SUV', swat: 'SWAT van', songthaew: 'songthaew', boat: 'longtail boat', bus: 'bus', luxsedan: 'luxury sedan', supercar: 'supercar' }[k] || k;
}

// =============================================================================
// 18. CAMERA UPDATE
// =============================================================================

export function updateCamera(dt) {
  const p = G.player;
  const rig = G.camRig;
  // shake decay
  rig.shake *= Math.pow(0.001, dt);
  const shakeX = (Math.random()*2-1) * rig.shake;
  const shakeY = (Math.random()*2-1) * rig.shake;

  if (p.inVehicle) {
    _camTarget.copy(p.inVehicle.pos); _camTarget.y += 1.2;
    // chase camera: ride behind the vehicle heading, but slow yaw follow lets player look around
    const followYaw = p.inVehicle.heading + PI; // behind
    rig.yaw = lerpAngle(rig.yaw, followYaw, dt * 1.4);
    rig.targetDistance = p.inVehicle.spec.kind === 'bike' ? 4.8 : 6.5;
  } else {
    _camTarget.copy(p.group.position); _camTarget.y += 1.5;
    rig.targetDistance = 4.5;
  }
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
// → ./daynight.js
// 20. MAIN LOOP
// =============================================================================

// Songthaew taxi job — a free-roam activity (press J in a songthaew). Kept out
// of the mission chain so it doesn't disturb the story missions.
export function updateTaxi(dt) {
  const p = G.player;
  const t = G.taxi || (G.taxi = { stage: 'idle', markerPos: null, dest: null, beam: null, timeLeft: 0, fares: 0, fareValue: 0 });
  const inSong = p.inVehicle && p.inVehicle.kind === 'songthaew';

  if (t.stage !== 'idle' && !inSong) {           // bailed out of the cab
    G.hud.showNotif('Fare bailed.');
    taxiClear(t);
    return;
  }
  if (t.stage === 'idle') {
    if (inSong) {
      G.hud.showPrompt('Press <b>J</b> for a taxi fare', 0.4);
      if (G.input.pressed('KeyJ')) {
        t.stage = 'toPickup';
        t.markerPos = taxiRandPoint(p.inVehicle.pos, 90);
        taxiBeam(t, t.markerPos, 0xffcf4a);
        G.hud.showNotif('New fare — head to the yellow marker');
      }
    }
    return;
  }
  const v = p.inVehicle;
  if (t.stage === 'toPickup') {
    if (dist2(v.pos, t.markerPos) < 7 * 7) {
      t.dest = taxiRandPoint(v.pos, 150);
      t.markerPos = t.dest;
      taxiBeam(t, t.dest, 0x39ff7a);
      const d = Math.sqrt(dist2(v.pos, t.dest));
      t.timeLeft = 25 + d / 9;
      t.fareValue = Math.round(120 + d * 5);
      t.stage = 'toDropoff';
      G.hud.showNotif('Fare aboard — drop them at the green marker');
      G.audio.blip({ freq: 600, dur: 0.08, gain: 0.1 });
    } else {
      G.hud.showPrompt('Taxi: pick up the fare at the marker', 0.4);
    }
  } else if (t.stage === 'toDropoff') {
    t.timeLeft -= dt;
    if (t.timeLeft <= 0) { G.hud.showNotif('Fare gave up — too slow.'); taxiClear(t); return; }
    G.hud.showPrompt(`TAXI &nbsp; ⏱ ${t.timeLeft.toFixed(0)}s &nbsp;→&nbsp; ฿${t.fareValue}`, 0.4);
    if (dist2(v.pos, t.dest) < 8 * 8) {
      G.cash += t.fareValue; t.fares++;
      G.hud.setCash(G.cash);
      G.hud.showNotif(`Dropped off: +฿${t.fareValue} (fares: ${t.fares})`);
      G.audio.blip({ freq: 760, dur: 0.1, gain: 0.12 });
      taxiClear(t);
    }
  }
}
export function taxiRandPoint(from, maxd) {
  for (let tries = 0; tries < 24; tries++) {
    const gi = irand(-GRID/2 + 1, GRID/2 - 1), gj = irand(-GRID/2 + 1, GRID/2 - 1);
    const x = gi * BLOCK + (Math.random() < 0.5 ? -3 : 3), z = gj * BLOCK;
    const dx = x - from.x, dz = z - from.z, d2 = dx*dx + dz*dz;
    if (d2 > 45 * 45 && d2 < maxd * maxd) return new THREE.Vector3(x, 0, z);
  }
  return new THREE.Vector3(clamp(from.x + rand(-80, 80), -HALF + 12, HALF - 12), 0, clamp(from.z + rand(-80, 80), -HALF + 12, HALF - 12));
}
export function taxiBeam(t, pos, color) {
  if (!t.beam) {
    t.beam = new THREE.Mesh(
      new THREE.CylinderGeometry(1.2, 1.2, 80, 12, 1, true),
      new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.2, side: THREE.DoubleSide, depthWrite: false })
    );
    G.scene.add(t.beam);
  }
  t.beam.material.color.setHex(color);
  t.beam.position.set(pos.x, 40, pos.z);
  t.beam.visible = true;
}
export function taxiClear(t) {
  t.stage = 'idle'; t.markerPos = null; t.dest = null;
  if (t.beam) t.beam.visible = false;
}

// Full-screen, north-up map overlay (TAB). Draws the minimap base scaled up plus
// live markers (amulets, mission/taxi, cops, player heading).
let _fullmapCtx = null;
export function drawFullMap() {
  const cv = document.getElementById('fullmap');
  if (!cv) return;
  const ctx = _fullmapCtx || (_fullmapCtx = cv.getContext('2d'));
  const S = cv.width;
  ctx.clearRect(0, 0, S, S);
  if (G.world && G.world.minimap) ctx.drawImage(G.world.minimap, 0, 0, S, S);
  const to = v => (v + HALF) / (2 * HALF) * S;
  // POI labels
  const poi = G.world.poi || {};
  const labels = [
    { p: poi.goldShop, t: "Uncle Seng's" },
    { p: poi.temple, t: 'Temple' },
    { p: poi.yaowarat, t: 'Yaowarat' },
    { p: G.world.gunShop, t: 'Guns' },
    { p: poi.safehouse, t: G.econ.safehouse.owned ? 'Home' : 'Safehouse' },
  ];
  for (const ga of (G.world.garages || [])) labels.push({ p: ga.pos, t: G.econ.garage.rented ? 'Garage' : 'U-Spray' });
  ctx.fillStyle = '#cfe3e0'; ctx.font = '13px system-ui, sans-serif'; ctx.textAlign = 'center';
  for (const L of labels) if (L.p) ctx.fillText(L.t, to(L.p.x), to(L.p.z) - 8);
  ctx.textAlign = 'left';
  if (G.world.collectibles) {
    ctx.fillStyle = '#ffcf4a';
    for (const a of G.world.collectibles) if (!a.taken) {
      ctx.beginPath(); ctx.arc(to(a.mesh.position.x), to(a.mesh.position.z), 3.5, 0, TAU); ctx.fill();
    }
  }
  if (G.mission && G.mission.active && G.mission.active.markerPos) {
    ctx.fillStyle = '#ff2a86';
    ctx.beginPath(); ctx.arc(to(G.mission.active.markerPos.x), to(G.mission.active.markerPos.z), 7, 0, TAU); ctx.fill();
  }
  if (G.taxi && G.taxi.markerPos) {
    ctx.fillStyle = G.taxi.stage === 'toDropoff' ? '#39ff7a' : '#ffcf4a';
    ctx.beginPath(); ctx.arc(to(G.taxi.markerPos.x), to(G.taxi.markerPos.z), 7, 0, TAU); ctx.fill();
  }
  ctx.fillStyle = '#ff3333';
  for (const v of G.vehicles) if (v.isCop && v.driver) { ctx.beginPath(); ctx.arc(to(v.pos.x), to(v.pos.z), 3.5, 0, TAU); ctx.fill(); }
  const px = to(G.player.group.position.x), py = to(G.player.group.position.z);
  const fx = -Math.sin(G.player.yaw), fz = -Math.cos(G.player.yaw);
  ctx.strokeStyle = '#21f0ff'; ctx.lineWidth = 2.5;
  ctx.beginPath(); ctx.moveTo(px, py); ctx.lineTo(px + fx * 14, py + fz * 14); ctx.stroke();
  ctx.fillStyle = '#21f0ff';
  ctx.beginPath(); ctx.arc(px, py, 5, 0, TAU); ctx.fill();
}

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
      if (G.vehicles[i].isCop) { G.scene.remove(G.vehicles[i].mesh); disposeObject(G.vehicles[i].mesh); G.vehicles.splice(i, 1); }
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
const STORABLE = new Set(['bike', 'tuktuk', 'hilux', 'camry', 'sedan', 'songthaew', 'bus', 'luxsedan', 'supercar']);

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

export function updateGarageOwnership(dt) {
  const p = G.player;
  if (!G.world.garages || !G.world.garages.length) return;
  const g = G.world.garages[0], garage = G.econ.garage;
  if (p.inVehicle) {
    const v = p.inVehicle;
    if (dist2(v.pos, g.pos) >= (g.r + 1) * (g.r + 1)) return;
    if (!garage.rented) { G.hud.showPrompt('Garage — step out and rent it to store cars here', 0.4); return; }
    if (!STORABLE.has(v.kind)) return;                      // cop cars / boats aren't storable
    // only claim the prompt line when U-Spray isn't already offering a repair
    const servicing = v.hp < 100 || G.wanted.stars > 0;
    const full = garage.stored.length >= garage.capacity;
    if (!servicing) {
      G.hud.showPrompt(full
        ? `Garage full — <b>C</b>: repaint (฿${PRICE.repaint})`
        : `Garage — <b>K</b>: store this ${vehicleName(v.kind)} · <b>C</b>: repaint (฿${PRICE.repaint})`, 0.4);
    }
    if (G.input.pressed('KeyK') && !full) storeVehicle(v);
    else if (G.input.pressed('KeyC')) repaintVehicle(v);
  } else {
    if (dist2(p.group.position, g.pos) >= g.r * g.r) return;
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
export function updateRadio(dt) {
  const a = G.audio; if (!a || !a.radio) return;
  const inV = !!G.player.inVehicle;
  if (G.input && G.input.pressed && G.input.pressed('KeyM') && G.state === 'playing') {
    G.hud.showNotif('📻 ' + a.radio.next());
  }
  if (inV && !G._wasInVehicle) G.hud.showNotif('📻 ' + a.radio.names[a.radio.station]);
  G._wasInVehicle = inV;
  a.radio.tick(inV);
  a.duckEngine(inV && a.radio.station !== 0);
}

// Free-fly camera for photo mode: mouse to look, WASD to fly, Space/Ctrl up/down.
export function updatePhotoCam(dt) {
  const pc = G.photoCam;
  if (!pc) return;
  const [dx, dy] = G.input.consumeMouseDelta();
  const s = 0.0025 * (G.settings ? G.settings.sensitivity : 1);
  pc.yaw -= dx * s;
  pc.pitch = clamp(pc.pitch - dy * s, -1.4, 1.4);
  const cp = Math.cos(pc.pitch), sp = Math.sin(pc.pitch), cy = Math.cos(pc.yaw), sy = Math.sin(pc.yaw);
  const fwd = new THREE.Vector3(sy * cp, sp, cy * cp);
  const right = new THREE.Vector3(cy, 0, -sy);
  const speed = (G.input.down('ShiftLeft') ? 45 : 16) * dt;
  if (G.input.down('KeyW')) pc.pos.addScaledVector(fwd, speed);
  if (G.input.down('KeyS')) pc.pos.addScaledVector(fwd, -speed);
  if (G.input.down('KeyD')) pc.pos.addScaledVector(right, speed);
  if (G.input.down('KeyA')) pc.pos.addScaledVector(right, -speed);
  if (G.input.down('Space')) pc.pos.y += speed;
  if (G.input.down('ControlLeft')) pc.pos.y -= speed;
  pc.pos.y = Math.max(0.5, pc.pos.y);
  G.camera.position.copy(pc.pos);
  G.camera.lookAt(pc.pos.clone().add(fwd));
}

export function loop() {
  requestAnimationFrame(loop);
  const realDt = Math.min(0.05, G.clock.getDelta());
  // hit-stop: a brief global slow-mo on a solid melee/gun connect so impacts land
  let dt = realDt;
  if (G.hitStop > 0) { G.hitStop -= realDt; dt = realDt * 0.12; }

  // phone toggle
  if (G.input && G.input.pressed && G.input.pressed('KeyT') && (G.state === 'playing' || G.state === 'phone')) {
    const open = !document.getElementById('phone').classList.contains('open');
    G.hud.togglePhone(open);
    G.state = open ? 'phone' : 'playing';
    if (open) { document.exitPointerLock(); G.hud.setPhoneStats(); }
    else G.input.requestLock();
  }

  // full-map overlay (TAB)
  if (G.input && G.input.pressed && G.input.pressed('Tab') && (G.state === 'playing' || G.state === 'map')) {
    G.showMap = !G.showMap;
    document.getElementById('fullmap-wrap').classList.toggle('show', G.showMap);
    G.state = G.showMap ? 'map' : 'playing';
    if (G.showMap) document.exitPointerLock(); else G.input.requestLock();
  }

  // minimap zoom (N)
  if (G.input && G.input.pressed && G.input.pressed('KeyN') && G.state === 'playing') {
    const levels = [1, 1.7, 2.6];
    G.minimapZoom = levels[(levels.indexOf(G.minimapZoom || 1) + 1) % levels.length];
  }

  // photo mode (P): free-fly camera + hidden HUD, sim paused
  if (G.input && G.input.pressed && G.input.pressed('KeyP') && (G.state === 'playing' || G.state === 'photo')) {
    if (G.state === 'photo') {
      G.state = 'playing';
      document.getElementById('hud').classList.remove('hidden');
    } else {
      G.state = 'photo';
      document.getElementById('hud').classList.add('hidden');
      G.photoCam = { pos: G.camera.position.clone(), yaw: G.camRig.yaw, pitch: G.camRig.pitch };
    }
  }

  // options menu (O)
  if (G.input && G.input.pressed && G.input.pressed('KeyO') && (G.state === 'playing' || G.state === 'options')) {
    if (G.state === 'options') {
      G.state = 'playing';
      document.getElementById('options').classList.remove('show');
      G.input.requestLock();
    } else {
      G.state = 'options';
      document.getElementById('options').classList.add('show');
      document.exitPointerLock();
    }
  }

  if (G.state === 'playing') {
    updatePlayer(dt);
    updateDistrict();
    updateCollectibles(dt);
    updateFoodStalls(dt);
    updateArmorPickups(dt);
    updateInteraction(dt);
    updateGarage(dt);
    updateGarageOwnership(dt);
    updateRadio(dt);
    updateTaxi(dt);
    updateVehicles(dt);
    updatePeds(dt);
    updateClusters(dt);
    updateBarks(dt);
    updateMuggings(dt);
    updateSpikes(dt);
    updateVigilante(dt);
    updateDogs(dt);
    updateFootCops(dt);
    updateBullets(dt);
    updateParticles(dt);
    updateSkids(dt);
    updateDust(dt);
    updateWanted(dt);
    updateCamera(dt);
    updateBTS(dt);
    updateDayNight(dt);
    updateFestival(dt);
    // distant daytime traffic honks (ambient flavor)
    if (Math.random() < 0.004 * (1 - (G.nightK || 0))) G.audio.blip({ freq: 360, dur: 0.2, type: 'square', gain: 0.03, freqEnd: 330 });
    G._saveTimer = (G._saveTimer || 0) + dt;
    if (G._saveTimer > 8) { G._saveTimer = 0; saveGame(); }
    // one-time 100% celebration (cheap: amulet counter + 3 mission flags)
    if (!G._congrats) {
      const ms = (G._welcomeDone ? 1 : 0) + (G._soiRunWon ? 1 : 0) + (G._hitDone ? 1 : 0);
      const total = G.world.collectibles ? G.world.collectibles.length : 15;
      if ((G.collected || 0) / Math.max(1, total) * 70 + ms / 3 * 30 >= 99.5) {
        G._congrats = true;
        G.hud.showSubtitle('100% — KING OF KRUNG THEP', 'เจ้าพ่อกรุงเทพฯ', 5);
        G.hud.showNotif('100% complete!');
        if (G.audio.bell) G.audio.bell();
      }
    }
    // passive HP regen when out of combat for a few seconds
    if (G.player.regenLockT > 0) G.player.regenLockT -= dt;
    else if (G.player.hp < G.player.hpMax) G.player.hp = Math.min(G.player.hpMax, G.player.hp + 5 * dt);
    if (G.mission) G.mission.update(dt);
    G.hud.update(dt);
    G.hud.setBars(G.player.hp, G.player.armor, G.player.stam);
    G.hud.setVehicle(G.player.inVehicle ? G.player.inVehicle.hp : 0, !!G.player.inVehicle);
    G.hud.setCash(G.cash);
    G.hud.drawMinimap(G.player);
    if (G.input.endFrame) G.input.endFrame();
  } else if (G.state === 'phone') {
    updateCamera(dt);
    if (G.input.endFrame) G.input.endFrame();
  } else if (G.state === 'map') {
    drawFullMap();
    if (G.input.endFrame) G.input.endFrame();
  } else if (G.state === 'paused') {
    if (G.input.endFrame) G.input.endFrame();
  } else if (G.state === 'dead') {
    if (G.input.endFrame) G.input.endFrame();
  } else if (G.state === 'photo') {
    updatePhotoCam(dt);
    if (G.input.endFrame) G.input.endFrame();
  } else if (G.state === 'options') {
    if (G.input.endFrame) G.input.endFrame();
  } else if (G.state === 'store') {
    if (G.input.endFrame) G.input.endFrame();
  }

  G.renderer.render(G.scene, G.camera);
}

// =============================================================================
// 21. BOOT
// =============================================================================

init().catch(err => {
  console.error(err);
  document.getElementById('loading').innerHTML = `<h1 style="color:#ff2a86">ERROR</h1><pre style="color:#f5e9c8;max-width:600px;white-space:pre-wrap">${err.stack || err}</pre>`;
});

// =============================================================================
// WORLD — extracted from main.js (see numbered sections). No logic change.
// =============================================================================
import * as THREE from 'three';
import {
  makeStaticBaker, PI, TAU, clamp, lerp, rand, irand, pick, sign, dist2, COLORS, G, PRICE, PAINT_COLORS, ROAD_WIDTH, PED_TARGET, GAMEPLAY, _camTarget, _camOffset, _fireDir, _ray, _bbox, _vBox, _blackColor, disposeObject, BLOCK, GRID, HALF, lerpAngle
} from './core.js';
import { buildLandmarks } from './worldLandmarks.js';
import { updateDayNight } from './main.js';

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
  const MALL_I = -1, MALL_J = 0;  // block reserved for Terminal 21 at Asok (≈ -25, 25)
  const BANK_I = 1, BANK_J = -2;  // block reserved for the Krung Thep Bank (≈ 75, -75)

  for (let i = -GRID/2; i < GRID/2; i++) {
    for (let j = -GRID/2; j < GRID/2; j++) {
      if (i === TEMPLE_I && j === TEMPLE_J) continue; // temple placed after loop
      if (i === RIVER_I) continue;                    // river column — no buildings
      if (i === GARAGE_I && j === GARAGE_J) continue; // U-Spray garage block
      if (i === SAFE_I && j === SAFE_J) continue;      // safehouse block
      if (i === YAO_I && (j === YAO_J0 || j === YAO_J1)) continue; // Yaowarat market
      if (i === GUN_I && j === GUN_J) continue; // gun shop block
      if (i === MALL_I && j === MALL_J) continue; // Terminal 21 mall block
      if (i === BANK_I && j === BANK_J) continue; // Krung Thep Bank block
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

  // temple + power lines (kept inline to balance file sizes)
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


  buildLandmarks({ scene, world, _m, _m2, _p, _q, _s, _e, addInstanced, bakeGroup, TEMPLE_I, TEMPLE_J, GARAGE_I, GARAGE_J, SAFE_I, SAFE_J, RIVER_I, YAO_I, YAO_J0, YAO_J1, GUN_I, GUN_J, MALL_I, MALL_J, BANK_I, BANK_J, SIDEWALK_EDGE });
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

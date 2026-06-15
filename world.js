// =============================================================================
// WORLD — extracted from main.js (see numbered sections). No logic change.
// =============================================================================
import * as THREE from 'three';
import {
  makeStaticBaker, PI, TAU, clamp, lerp, rand, irand, pick, sign, dist2, COLORS, G, PRICE, PAINT_COLORS, ROAD_WIDTH, PED_TARGET, GAMEPLAY, _camTarget, _camOffset, _fireDir, _ray, _bbox, _vBox, _blackColor, disposeObject, BLOCK, GRID, HALF, lerpAngle
} from './core.js';
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

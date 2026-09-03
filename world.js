// =============================================================================
// WORLD — extracted from main.js (see numbered sections). No logic change.
// =============================================================================
import * as THREE from 'three';
import {
  makeStaticBaker, PI, TAU, clamp, lerp, rand, irand, pick, sign, dist2, COLORS, G, PRICE, PAINT_COLORS, ROAD_WIDTH, PED_TARGET, GAMEPLAY, indexBuilding, _camTarget, _camOffset, _fireDir, _ray, _bbox, _vBox, _blackColor, disposeObject, BLOCK, GRID, HALF, lerpAngle
} from './core.js';
import { buildLandmarks } from './worldLandmarks.js';
import { buildAirport, AIRPORT_I } from './airport.js';
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
    walkways: [],
    sois: [],
    flood: [],
    buildingCells: new Map(),
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
  const asphaltTex = makeAsphaltTextures();
  const sidewalkTex = makeSidewalkTexture();
  const facadeGrimeTex = makeFacadeGrimeTexture();
  const groundMat = new THREE.MeshStandardMaterial({
    color: COLORS.asphalt, roughness: 0.9,
    map: asphaltTex.map, roughnessMap: asphaltTex.roughnessMap,
  });
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(HALF*2 + 200, HALF*2 + 200, 1, 1), groundMat);
  ground.rotation.x = -PI/2; ground.position.y = 0; ground.receiveShadow = true;
  scene.add(ground);

  // ---- road grid ----
  const roadMat = new THREE.MeshStandardMaterial({
    color: 0x3a3d42, roughness: 0.85,
    map: asphaltTex.map, roughnessMap: asphaltTex.roughnessMap,
  });
  const stripeMat = new THREE.MeshBasicMaterial({ color: 0xffe699 });
  const sidewalkMat = new THREE.MeshStandardMaterial({ color: COLORS.sidewalk, roughness: 1.0, map: sidewalkTex.map });

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

  // Sidewalk occupancy bands — peds walk these instead of heading-jittering through walls.
  {
    const sw = ROAD_W / 2, band = 2.8;
    for (let i = -GRID / 2 + 1; i <= GRID / 2; i++) {
      const roadX = i * BLOCK;
      world.walkways.push({ x0: roadX - sw - band, x1: roadX - sw - 0.25, z0: -HALF + 2, z1: HALF - 2, axis: 'z' });
      world.walkways.push({ x0: roadX + sw + 0.25, x1: roadX + sw + band, z0: -HALF + 2, z1: HALF - 2, axis: 'z' });
    }
    for (let j = -GRID / 2; j <= GRID / 2; j++) {
      const roadZ = j * BLOCK;
      world.walkways.push({ x0: -HALF + 12, x1: HALF - 2, z0: roadZ - sw - band, z1: roadZ - sw - 0.25, axis: 'x' });
      world.walkways.push({ x0: -HALF + 12, x1: HALF - 2, z0: roadZ + sw + 0.25, z1: roadZ + sw + band, axis: 'x' });
    }
  }

  // ---- buildings ----
  // Buildings flank the road on all 4 sides of each block, forming a street canyon.
  // Each block: 4 corner buildings + a row of shop-houses marching along each side
  // between the corners. The block interior becomes a small courtyard / alley gap.
  // Facade material families — three readable looks instead of one flat pool.
  // Each is a small fixed set of shared materials, so the baker still merges every
  // facade into a handful of draw calls (one per material). placeBuilding picks a
  // family per building so towers read as glass, mid-rises as painted/concrete.
  //  - concrete: matte grey-beige, no metalness (weathered slabs)
  //  - painted:  warmer tinted renders, slightly rougher
  //  - glass:    cooler blue-grey, lower roughness + a touch of metalness so it
  //              catches the sky differently from the matte boxes
  const concreteMat = COLORS.building.map(c => new THREE.MeshStandardMaterial({
    color: c, roughness: 0.9, metalness: 0.0, map: facadeGrimeTex.map,
  }));
  const PAINTED_COLORS = [0xb7a98c, 0xc9b89a, 0xa89a8e, 0xbfa6a0, 0x9fb0a6, 0xc6b0a0];
  const paintedMat = PAINTED_COLORS.map(c => new THREE.MeshStandardMaterial({
    color: c, roughness: 0.82, metalness: 0.0,
  }));
  const GLASS_COLORS = [0x8a96a6, 0x7f8c9e, 0x93a0ad, 0x6f8092, 0x9aa6b2];
  const glassMat = GLASS_COLORS.map(c => new THREE.MeshStandardMaterial({
    // glassy facades reflect the sky env map — lower roughness + metalness so the
    // reflection reads; envMap stays cheap (only these materials sample it)
    color: c, roughness: 0.18, metalness: 0.6, envMap: G.envMap || null, envMapIntensity: 1.5,
  }));
  // Pick a body material for a building of height h: tall ones lean glass, the
  // rest split between concrete and painted. Returns one of the shared materials.
  function pickBodyMat(h) {
    const r = Math.random();
    if (h > 34) return r < 0.6 ? pick(glassMat) : (r < 0.8 ? pick(concreteMat) : pick(paintedMat));
    return r < 0.5 ? pick(concreteMat) : (r < 0.85 ? pick(paintedMat) : pick(glassMat));
  }
  // Thin parapet/roof-cap band — one shared dark-concrete material so every cap
  // merges into a single draw call. Caps the box silhouette so roofs don't look
  // like bare cut cubes.
  const capMat = new THREE.MeshStandardMaterial({ color: 0x4a4a50, roughness: 0.9 });
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
    map: winTex.map, emissiveMap: winTex.emissiveMap, emissive: 0xffe6a8, emissiveIntensity: 0.0, roughness: 0.45, metalness: 0.25,
  });
  G.nightEmissive.push({ mat: winMat, dayIntensity: 0.0, nightIntensity: 1.0 });

  // All window planes share winMat, so we can't set per-face texture .repeat on the
  // material. Instead we bake the tiling into each plane's UVs: a window-grid tile
  // is ~WIN_TILE metres, so a face of (w×h) gets round(w/TILE)×round(h/TILE) tiles.
  // This makes panes a consistent physical size on every building (so a wide tower
  // shows more columns, a tall one more rows) while still merging into one mesh.
  const WIN_TILE = 3.2;
  function winPlane(w, h) {
    const g = new THREE.PlaneGeometry(w, h);
    const uv = g.attributes.uv;
    const rx = Math.max(1, Math.round(w / WIN_TILE));
    const ry = Math.max(1, Math.round(h / WIN_TILE));
    for (let k = 0; k < uv.count; k++) uv.setXY(k, uv.getX(k) * rx, uv.getY(k) * ry);
    uv.needsUpdate = true;
    return g;
  }

  const SIDEWALK_EDGE = BLOCK/2 - ROAD_W/2 - SIDEWALK_W*2; // 13: distance from block center to inner sidewalk edge
  const SHOP_LEVEL_H = 4; // height of ground-floor shop band

  world.surfaceMaterials = {
    road: [roadMat],
    ground: [groundMat],
    sidewalk: [sidewalkMat],
    facades: concreteMat,
    puddleMat: null,
  };

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
  const thaiAtlas = makeThaiSignAtlas();
  const thaiSignMat = new THREE.MeshBasicMaterial({ map: thaiAtlas, toneMapped: false });
  const doorRecessMat = new THREE.MeshStandardMaterial({ color: 0x2a2420, roughness: 0.95 });
  function thaiSignPlane(w, h, idx) {
    const g = new THREE.PlaneGeometry(w, h);
    const col = idx % 4, row = (idx >> 2) & 1;
    const uv = g.attributes.uv;
    for (let k = 0; k < uv.count; k++) uv.setXY(k, col * 0.25 + uv.getX(k) * 0.25, (1 - row * 0.5) - (1 - uv.getY(k)) * 0.5);
    uv.needsUpdate = true;
    return g;
  }

  // placeBuilding: shop band on bottom 4m + upper floors above, plus optional
  // window strips and neon sign on the faces that look toward a road. All of the
  // static boxes/planes are routed through the baker (merged per material at the
  // end of buildWorld) rather than added as individual meshes.
  // frontFaces: array of {ax: 'x'|'z', sign: +1|-1} for each road-facing face.
  function placeBuilding(bx, bz, dimX, dimZ, h, frontFaces) {
    const upperH = Math.max(0.1, h - SHOP_LEVEL_H);
    const upperMat = pickBodyMat(h);
    const upperGeo = new THREE.BoxGeometry(dimX, upperH, dimZ);
    bake(baker, upperGeo, upperMat, bx, SHOP_LEVEL_H + upperH/2, bz, 0, 0, 0, true, true);
    upperGeo.dispose();

    const shopMat = shopMatPool[irand(0, shopMatPool.length - 1)];
    const shopGeo = new THREE.BoxGeometry(dimX, SHOP_LEVEL_H, dimZ);
    bake(baker, shopGeo, shopMat, bx, SHOP_LEVEL_H/2, bz, 0, 0, 0, true, true);
    shopGeo.dispose();

    // Parapet/roof cap — a thin slab slightly wider than the body that crowns the
    // roof, so the silhouette reads as a finished building rather than a cut cube.
    // Shared material → merges into one draw call across the whole city.
    if (h > 8) {
      const capH = 0.6, capOver = 0.25;
      const capGeo = new THREE.BoxGeometry(dimX + capOver, capH, dimZ + capOver);
      bake(baker, capGeo, capMat, bx, h - capH/2, bz, 0, 0, 0, true, true);
      capGeo.dispose();
    }

    // Cornice ledge: a thin protruding band at the top of the shop podium that
    // separates the ground floor from the tower above (a near-universal real
    // facade cue). Reuses capMat → no extra draw call. Skipped on tiny buildings.
    if (dimX > 3 && dimZ > 3 && h > 10) {
      const ledgeGeo = new THREE.BoxGeometry(dimX + 0.2, 0.35, dimZ + 0.2);
      bake(baker, ledgeGeo, capMat, bx, SHOP_LEVEL_H + 0.1, bz, 0, 0, 0, true, false);
      ledgeGeo.dispose();
    }

    // Collision AABB only — no mesh ref needed; bullet raycasts test pos/size
    // directly (doBulletRaycast), and the resolvers always used pos/size anyway.
    world.buildings.push({
      pos: new THREE.Vector3(bx, h/2, bz),
      size: new THREE.Vector3(dimX, h, dimZ),
    });

    // Door recess on a fraction of shop fronts so the podium isn't a flush slab.
    if (h < 28 && Math.random() < 0.42 && frontFaces.length > 0) {
      const face = frontFaces[0];
      const dw = 1.15, dh = 2.2;
      const g = new THREE.PlaneGeometry(dw, dh);
      if (face.ax === 'z') bake(baker, g, doorRecessMat, bx, 1.15, bz + face.sign * (dimZ / 2 + 0.03), face.sign < 0 ? PI : 0, 0, 0, false, false);
      else bake(baker, g, doorRecessMat, bx + face.sign * (dimX / 2 + 0.03), 1.15, bz, face.sign > 0 ? PI / 2 : -PI / 2, 0, 0, false, false);
      g.dispose();
    }

    // window strip on mid/tall buildings — emissive panels on each road-facing
    // face. Lowered the threshold from 22 to 16 so mid-rises get windows too; the
    // UV-tiled winPlane keeps panes a constant size whatever the floor count.
    if (h > 16) {
      const winH = upperH - 2;
      for (const face of frontFaces) {
        if (face.ax === 'z') {
          const winW = dimX - 1.5;
          if (winW <= 0.5) continue;
          const g = winPlane(winW, winH);
          bake(baker, g, winMat, bx, SHOP_LEVEL_H + upperH/2, bz + face.sign * (dimZ/2 + 0.02), face.sign < 0 ? PI : 0, 0, 0, false, false);
          g.dispose();
        } else {
          const winW = dimZ - 1.5;
          if (winW <= 0.5) continue;
          const g = winPlane(winW, winH);
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
        const setMat = pickBodyMat(h);
        const setGeo = new THREE.BoxGeometry(setX, setH, setZ);
        bake(baker, setGeo, setMat, bx, roofY + setH/2, bz, 0, 0, 0, true, true);
        setGeo.dispose();
        // parapet on the setback too
        const scapGeo = new THREE.BoxGeometry(setX + 0.25, 0.5, setZ + 0.25);
        bake(baker, scapGeo, capMat, bx, roofY + setH - 0.25, bz, 0, 0, 0, true, true);
        scapGeo.dispose();
        // window strip on the setback's main face
        if (frontFaces.length > 0 && setH > 5) {
          const face = frontFaces[0];
          const g = winPlane(face.ax === 'z' ? setX - 1 : setZ - 1, setH - 1.5);
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

    // perpendicular hanging sign — Thai-script atlas on a shared material (one draw call)
    if (h > 8 && Math.random() < 0.35 && frontFaces.length > 0) {
      const face = frontFaces[0];
      const armLen = 1.2;
      const signW = rand(1.0, 1.6), signH = rand(0.5, 0.9);
      const heightY = Math.min(h - 1, rand(4.5, 7));
      const gs = thaiSignPlane(signW, signH, irand(0, 7));
      if (face.ax === 'z') {
        const ga = new THREE.BoxGeometry(0.05, 0.05, armLen);
        bake(baker, ga, hangArmMat, bx, heightY, bz + face.sign * (dimZ/2 + armLen/2), 0, 0, 0, false, false);
        ga.dispose();
        bake(baker, gs, thaiSignMat, bx, heightY - signH/2 - 0.05, bz + face.sign * (dimZ/2 + armLen), face.sign < 0 ? PI : 0, 0, 0, false, false);
      } else {
        const ga = new THREE.BoxGeometry(armLen, 0.05, 0.05);
        bake(baker, ga, hangArmMat, bx + face.sign * (dimX/2 + armLen/2), heightY, bz, 0, 0, 0, false, false);
        ga.dispose();
        bake(baker, gs, thaiSignMat, bx + face.sign * (dimX/2 + armLen), heightY - signH/2 - 0.05, bz, face.sign > 0 ? PI/2 : -PI/2, 0, 0, false, false);
      }
      gs.dispose();
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
  const SOI_SPECS = GAMEPLAY.sois ? [
    { i: 0, j: -3, axis: 'z' }, { i: 1, j: -3, axis: 'x' },
    { i: 2, j: 1, axis: 'z' }, { i: -3, j: 0, axis: 'x' },
    { i: 3, j: 2, axis: 'z' }, { i: 0, j: 2, axis: 'x' },
    { i: -3, j: -3, axis: 'z' }, { i: 1, j: 3, axis: 'x' },
  ] : [];
  function soiCorridor(i, j, spec) {
    const cx = (i + 0.5) * BLOCK, cz = (j + 0.5) * BLOCK, half = 2.6;
    if (spec.axis === 'z') return { x0: cx - half, x1: cx + half, z0: cz - SIDEWALK_EDGE - 1, z1: cz + SIDEWALK_EDGE + 1, axis: 'z' };
    return { x0: cx - SIDEWALK_EDGE - 1, x1: cx + SIDEWALK_EDGE + 1, z0: cz - half, z1: cz + half, axis: 'x' };
  }
  function overlapsSoi(bx, bz, dimX, dimZ, c) {
    if (!c) return false;
    return (bx - dimX / 2) < c.x1 && (bx + dimX / 2) > c.x0 && (bz - dimZ / 2) < c.z1 && (bz + dimZ / 2) > c.z0;
  }

  for (let i = -GRID/2; i < GRID/2; i++) {
    for (let j = -GRID/2; j < GRID/2; j++) {
      if (i === TEMPLE_I && j === TEMPLE_J) continue; // temple placed after loop
      if (i === RIVER_I) continue;                    // river column — no buildings
      if (GAMEPLAY.airport && i === AIRPORT_I) continue; // Suvarnabhumi pocket
      if (i === GARAGE_I && j === GARAGE_J) continue; // U-Spray garage block
      if (i === SAFE_I && j === SAFE_J) continue;      // safehouse block
      if (i === YAO_I && (j === YAO_J0 || j === YAO_J1)) continue; // Yaowarat market
      if (i === GUN_I && j === GUN_J) continue; // gun shop block
      if (i === MALL_I && j === MALL_J) continue; // Terminal 21 mall block
      if (i === BANK_I && j === BANK_J) continue; // Krung Thep Bank block
      const cx = (i + 0.5) * BLOCK;
      const cz = (j + 0.5) * BLOCK;
      const soiSpec = SOI_SPECS.find(s => s.i === i && s.j === j);
      const soiC = soiSpec ? soiCorridor(i, j, soiSpec) : null;
      if (soiC) world.sois.push(soiC);

      // Tall-building bias: central blocks more likely to have skyscrapers,
      // outer blocks more likely to be shop-houses.
      const distFromCenter = Math.hypot(i + 0.5, j + 0.5);
      const tallChance = lerp(0.32, 0.06, clamp(distFromCenter / (GRID/2), 0, 1));

      // ---- 4 corner buildings ----
      for (const [sx, sz] of [[+1,+1],[+1,-1],[-1,+1],[-1,-1]]) {
        const csx = rand(7, 9), csz = rand(7, 9);
        const bx = cx + sx * (SIDEWALK_EDGE - csx/2);
        const bz = cz + sz * (SIDEWALK_EDGE - csz/2);
        if (overlapsSoi(bx, bz, csx, csz, soiC)) continue;
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
          if (overlapsSoi(bx, bz, dimX, dimZ, soiC)) { cursor += w + 0.2; continue; }
          placeBuilding(bx, bz, dimX, dimZ, h, [{ ax: side.ax, sign: side.sign }]);

          cursor += w + rand(0.0, 0.8);
        }
      }
    }
  }

  // Paint a thin carriageway down each soi so bikes can read the alley as a street.
  {
    const soiMat = new THREE.MeshStandardMaterial({
      color: 0x3a3d42, roughness: 0.85, map: asphaltTex.map, roughnessMap: asphaltTex.roughnessMap,
    });
    world.surfaceMaterials.road.push(soiMat);
    for (const s of world.sois) {
      const w = s.x1 - s.x0, d = s.z1 - s.z0;
      const g = new THREE.PlaneGeometry(w, d);
      bake(flatBaker, g, soiMat, (s.x0 + s.x1) / 2, 0.03, (s.z0 + s.z1) / 2, 0, -PI / 2, 0, false, false);
      g.dispose();
    }
  }

  // Downpour flood patches sit in a few courtyards — cars stall, bikes don't.
  if (GAMEPLAY.floodPatches) {
    const floodMat = new THREE.MeshStandardMaterial({
      color: 0x1a3040, roughness: 0.08, metalness: 0.35, transparent: true, opacity: 0,
      envMap: G.envMap || null, envMapIntensity: 1.1, depthWrite: false,
    });
    world.surfaceMaterials.floodMat = floodMat;
    const spots = [[1, 1], [-3, -2], [2, 3]];
    for (const [bi, bj] of spots) {
      const cx = (bi + 0.5) * BLOCK, cz = (bj + 0.5) * BLOCK;
      const hw = 7, hd = 7;
      world.flood.push({ x0: cx - hw, x1: cx + hw, z0: cz - hd, z1: cz + hd });
      const g = new THREE.PlaneGeometry(hw * 2, hd * 2);
      bake(flatBaker, g, floodMat, cx, 0.06, cz, 0, -PI / 2, 0, false, false);
      g.dispose();
    }
  }

  // ---- Build rooftop-decor InstancedMeshes from the matrices gathered above ----
  addInstanced(tankGeo, tankMatDark, tankDarkM, true, false); // tanks cast shadow
  addInstanced(tankGeo, tankMatBlue, tankBlueM, true, false);
  addInstanced(tankLegGeo, tankLegMat, tankLegM, false, false);
  addInstanced(acGeo, acMat, acM, false, false);
  addInstanced(antGeo, antMat, antM, false, false);
  addInstanced(dishGeo, dishMat, dishM, false, false);

  // ---- Wet-road puddles: one instanced decal batch, faded by updateDayNight ----
  {
    const puddleGeo = new THREE.CircleGeometry(1, 18);
    puddleGeo.rotateX(-PI / 2);
    const puddleMat = new THREE.MeshStandardMaterial({
      color: 0x080a0c, roughness: 0.05, metalness: 0.6,
      transparent: true, opacity: 0, depthWrite: false,
      envMap: G.envMap || null, envMapIntensity: 1.2,
    });
    const puddles = new THREE.InstancedMesh(puddleGeo, puddleMat, 40);
    puddles.frustumCulled = false;
    for (let k = 0; k < 40; k++) {
      const along = rand(-HALF + 12, HALF - 12);
      const road = irand(-GRID / 2, GRID / 2) * BLOCK;
      const side = Math.random() < 0.5 ? -1 : 1;
      const edge = ROAD_W / 2 - rand(0.8, 2.1);
      const ew = Math.random() < 0.5;
      _p.set(ew ? along : road + side * edge, 0.055 + k * 0.00001, ew ? road + side * edge : along);
      _q.setFromEuler(_e.set(0, rand(0, TAU), 0));
      const sx = rand(0.45, 1.45), sz = rand(0.25, 0.9);
      _s.set(sx, 1, sz);
      puddles.setMatrixAt(k, _m.compose(_p, _q, _s));
    }
    puddles.instanceMatrix.needsUpdate = true;
    scene.add(puddles);
    world.surfaceMaterials.puddleMat = puddleMat;
    world.puddles = puddles;
  }

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
        if (GAMEPLAY.airport && x > 198) continue;
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
    if (GAMEPLAY.airport && xRoad >= 200) continue;
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
  buildAirport(scene, world);
  world.buildingCells = new Map();
  for (const b of world.buildings) indexBuilding(world, b);
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

function makeThaiSignAtlas() {
  const c = document.createElement('canvas'); c.width = 512; c.height = 256;
  const g = c.getContext('2d');
  const names = ['ทอง', 'ส้มตำ', 'ซักรีด', 'ก๋วยเตี๋ยว', 'ยาดม', 'นวดแผนไทย', 'กาแฟ', 'ตัดผม'];
  const colors = ['#a84a3a', '#cfa83a', '#3a8a5a', '#c26b3a', '#1a1a1a', '#7a3a8a', '#3a5a8a', '#b04030'];
  g.textAlign = 'center'; g.textBaseline = 'middle';
  for (let i = 0; i < 8; i++) {
    const col = i % 4, row = i >> 2;
    g.fillStyle = colors[i]; g.fillRect(col * 128, row * 128, 128, 128);
    g.fillStyle = '#f5e9c8';
    // system-ui only: naming "Noto Sans Thai" / "Sarabun" without an @font-face
    // makes Chromium keep a pending FontFace. Playwright's page.screenshot waits
    // on document.fonts.ready and then CDP-captures the WebGL canvas — that pair
    // deadlocks under SwiftShader CI (fonts loaded, screenshot never returns).
    g.font = 'bold 32px system-ui, sans-serif';
    g.fillText(names[i], col * 128 + 64, row * 128 + 64);
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.needsUpdate = true;
  return tex;
}

export function makeWindowTexture() {
  // Two canvases, one cell layout. Albedo: dark mullion grid + glass cells that
  // read as a daytime curtain wall. Emissive: black except the "lit" cells, so
  // only those glow when the night ramp raises emissiveIntensity. The grid is
  // drawn as a regular 6×12 array of panes so the facade reads as clear rows and
  // columns of windows rather than noise — and the mullion frame between cells is
  // darkened on the albedo to make each pane pop.
  const ca = document.createElement('canvas'); ca.width = 64; ca.height = 128;
  const ce = document.createElement('canvas'); ce.width = 64; ce.height = 128;
  const ga = ca.getContext('2d');
  const ge = ce.getContext('2d');
  // mullion/spandrel base: a darker frame colour so the lit/glass cells read as
  // inset panes. Emissive base stays near-black so unlit facade barely glows.
  ga.fillStyle = '#34373f'; ga.fillRect(0,0,64,128);
  ge.fillStyle = '#1a1d22'; ge.fillRect(0,0,64,128);
  // faint horizontal floor-slab lines on the albedo every row → strong "floors" cue
  ga.fillStyle = '#2a2c33';
  for (let y = 4; y < 128; y += 10) ga.fillRect(0, y - 1, 64, 1);
  for (let y = 6; y < 128; y += 10) {
    // per-floor lit bias: whole floors tend to be lit or dark together, which is
    // how real towers look at night, instead of salt-and-pepper randomness.
    const floorLit = Math.random();
    for (let x = 4; x < 64; x += 10) {
      const lit = Math.random() < (0.25 + floorLit * 0.55);
      // day glass: sky-tinted panes with slight variance, regardless of lit state
      const v = 90 + Math.random() * 50 | 0;
      ga.fillStyle = `rgb(${v-20},${v},${v+25|0})`;
      ga.fillRect(x, y, 6, 6);
      // subtle top-edge highlight on each pane → a bit of glass sheen
      ga.fillStyle = `rgba(${v+30},${v+40},${v+55},0.5)`;
      ga.fillRect(x, y, 6, 1);
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

function canvasTex(canvas, srgb = true) {
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.anisotropy = 4;
  if (srgb && THREE.SRGBColorSpace) tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

export function makeAsphaltTextures() {
  const ca = document.createElement('canvas'); ca.width = ca.height = 512;
  const cr = document.createElement('canvas'); cr.width = cr.height = 512;
  const ga = ca.getContext('2d');
  const gr = cr.getContext('2d');
  ga.fillStyle = '#34383d'; ga.fillRect(0, 0, 512, 512);
  gr.fillStyle = '#d8d8d8'; gr.fillRect(0, 0, 512, 512);
  const img = ga.getImageData(0, 0, 512, 512);
  const rough = gr.getImageData(0, 0, 512, 512);
  for (let y = 0; y < 512; y++) {
    for (let x = 0; x < 512; x++) {
      const i = (y * 512 + x) * 4;
      const laneWear = Math.exp(-Math.pow((x % 256) - 78, 2) / 900) + Math.exp(-Math.pow((x % 256) - 178, 2) / 900);
      const speck = (Math.random() - 0.5) * 18 - laneWear * 8;
      img.data[i] = clamp(52 + speck, 35, 76);
      img.data[i + 1] = clamp(56 + speck, 38, 80);
      img.data[i + 2] = clamp(62 + speck, 42, 86);
      rough.data[i] = rough.data[i + 1] = rough.data[i + 2] = clamp(220 - laneWear * 42 + (Math.random() - 0.5) * 18, 145, 245);
    }
  }
  ga.putImageData(img, 0, 0);
  gr.putImageData(rough, 0, 0);
  ga.globalAlpha = 0.35;
  ga.strokeStyle = '#17191c'; ga.lineWidth = 2;
  for (let k = 0; k < 34; k++) {
    let x = rand(0, 512), y = rand(0, 512);
    ga.beginPath(); ga.moveTo(x, y);
    for (let s = 0; s < irand(3, 8); s++) { x += rand(-28, 28); y += rand(8, 34); ga.lineTo(x, y); }
    ga.stroke();
  }
  ga.globalAlpha = 0.22;
  for (let k = 0; k < 20; k++) {
    const x = rand(70, 442), y = rand(0, 512), r = rand(14, 44);
    const g = ga.createRadialGradient(x, y, 1, x, y, r);
    g.addColorStop(0, '#0e1012'); g.addColorStop(1, 'rgba(14,16,18,0)');
    ga.fillStyle = g; ga.beginPath(); ga.arc(x, y, r, 0, TAU); ga.fill();
    gr.fillStyle = 'rgba(80,80,80,0.28)'; gr.beginPath(); gr.arc(x, y, r * 0.85, 0, TAU); gr.fill();
  }
  const map = canvasTex(ca, true);
  const roughnessMap = canvasTex(cr, false);
  map.repeat.set(42, 42);
  roughnessMap.repeat.copy(map.repeat);
  return { map, roughnessMap };
}

export function makeSidewalkTexture() {
  const c = document.createElement('canvas'); c.width = c.height = 512;
  const g = c.getContext('2d');
  g.fillStyle = '#787878'; g.fillRect(0, 0, 512, 512);
  const img = g.getImageData(0, 0, 512, 512);
  for (let i = 0; i < img.data.length; i += 4) {
    const n = (Math.random() - 0.5) * 20;
    img.data[i] = clamp(120 + n, 96, 146);
    img.data[i + 1] = clamp(120 + n, 96, 146);
    img.data[i + 2] = clamp(116 + n, 92, 142);
  }
  g.putImageData(img, 0, 0);
  g.strokeStyle = 'rgba(45,45,45,0.45)';
  g.lineWidth = 3;
  for (let x = 0; x <= 512; x += 64) { g.beginPath(); g.moveTo(x, 0); g.lineTo(x, 512); g.stroke(); }
  for (let y = 0; y <= 512; y += 64) { g.beginPath(); g.moveTo(0, y); g.lineTo(512, y); g.stroke(); }
  g.globalAlpha = 0.16;
  for (let k = 0; k < 24; k++) {
    g.fillStyle = '#2b2b2b';
    g.beginPath(); g.ellipse(rand(0, 512), rand(0, 512), rand(8, 28), rand(4, 16), rand(0, TAU), 0, TAU); g.fill();
  }
  const map = canvasTex(c, true);
  map.repeat.set(18, 18);
  return { map };
}

export function makeFacadeGrimeTexture() {
  const c = document.createElement('canvas'); c.width = c.height = 512;
  const g = c.getContext('2d');
  const base = g.createLinearGradient(0, 0, 0, 512);
  base.addColorStop(0, '#d6d2c9');
  base.addColorStop(0.62, '#b8b1a7');
  base.addColorStop(1, '#7d776f');
  g.fillStyle = base; g.fillRect(0, 0, 512, 512);
  g.globalAlpha = 0.18;
  for (let k = 0; k < 70; k++) {
    const x = rand(0, 512), y = rand(60, 500), len = rand(30, 180);
    g.strokeStyle = '#4e4a45';
    g.lineWidth = rand(1, 5);
    g.beginPath(); g.moveTo(x, y); g.bezierCurveTo(x + rand(-8, 8), y + len * 0.35, x + rand(-12, 12), y + len * 0.75, x + rand(-8, 8), Math.min(512, y + len)); g.stroke();
  }
  g.globalAlpha = 0.08;
  g.fillStyle = '#101010';
  for (let y = 70; y < 490; y += 64) g.fillRect(0, y, 512, rand(2, 5));
  const map = canvasTex(c, true);
  map.repeat.set(1, 1);
  return { map };
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
  // arterials (yellow) + sois (gray) + khlong/river (blue) — Bangkok map legend
  g.strokeStyle = '#e0b020'; g.lineWidth = 3;
  for (let i = -GRID/2; i <= GRID/2; i++) {
    g.beginPath();
    g.moveTo(mapW(-HALF), mapW(i*BLOCK)); g.lineTo(mapW(HALF), mapW(i*BLOCK)); g.stroke();
    g.beginPath();
    g.moveTo(mapW(i*BLOCK), mapW(-HALF)); g.lineTo(mapW(i*BLOCK), mapW(HALF)); g.stroke();
  }
  g.strokeStyle = '#8a8d92'; g.lineWidth = 1.6;
  for (const s of (world.sois || [])) {
    g.beginPath();
    if (s.axis === 'z') { g.moveTo(mapW((s.x0 + s.x1) / 2), mapW(s.z0)); g.lineTo(mapW((s.x0 + s.x1) / 2), mapW(s.z1)); }
    else { g.moveTo(mapW(s.x0), mapW((s.z0 + s.z1) / 2)); g.lineTo(mapW(s.x1), mapW((s.z0 + s.z1) / 2)); }
    g.stroke();
  }
  // BTS line
  g.strokeStyle = '#21f0ff'; g.lineWidth = 2; g.setLineDash([4,3]);
  g.beginPath(); g.moveTo(mapW(-HALF), mapW(0)); g.lineTo(mapW(HALF), mapW(0)); g.stroke();
  g.setLineDash([]);

  // Chao Phraya river along the west edge
  g.fillStyle = '#3a6a88';
  const rvX = mapW(-HALF);
  const rvW = mapW(-HALF + BLOCK - 8) - rvX;
  g.fillRect(rvX, 0, rvW, SIZE);

  // U-Spray garages
  g.fillStyle = '#21f0ff';
  for (const ga of (world.garages || [])) {
    g.fillRect(mapW(ga.pos.x) - 3, mapW(ga.pos.z) - 3, 6, 6);
  }

  // Gun shops
  const gunShops = (world.gunShops && world.gunShops.length)
    ? world.gunShops
    : (world.gunShop ? [{ pos: world.gunShop }] : []);
  if (gunShops.length) {
    g.fillStyle = '#ff3344';
    for (const shop of gunShops) {
      const pos = shop.pos || shop;
      g.fillRect(mapW(pos.x) - 3, mapW(pos.z) - 3, 6, 6);
    }
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

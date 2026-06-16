// =============================================================================
// WORLD LANDMARKS — the temple, power lines, BTS, river, garage, safehouse, gun
// shop, Yaowarat, collectibles… Extracted from buildWorld; takes the buildWorld
// locals it needs via `env` (destructured back to the same names so the block
// code is verbatim). No logic change.
// =============================================================================
import * as THREE from 'three';
import {
  makeStaticBaker, PI, TAU, clamp, lerp, rand, irand, pick, sign, dist2, COLORS, G, PRICE, PAINT_COLORS, ROAD_WIDTH, PED_TARGET, GAMEPLAY, _camTarget, _camOffset, _fireDir, _ray, _bbox, _vBox, _blackColor, disposeObject, BLOCK, GRID, HALF, lerpAngle
} from './core.js';
import { makePedMesh } from './entities.js';

export function buildLandmarks(env) {
  const { scene, world, _m, _m2, _p, _q, _s, _e, addInstanced, bakeGroup, TEMPLE_I, TEMPLE_J, GARAGE_I, GARAGE_J, SAFE_I, SAFE_J, RIVER_I, YAO_I, YAO_J0, YAO_J1, GUN_I, GUN_J, MALL_I, MALL_J, SIDEWALK_EDGE } = env;
  // Walkable structures shared by the floor-support physics (mall + BTS platforms).
  world.walk = { platforms: [], ramps: [], solids: [] };

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
    // The platform is a walkable surface (worldSupportY) you reach by escalator.
    const PY = stationFloorY + 0.3;                                  // platform walk height
    world.walk.platforms.push({ x0: sx - 11, x1: sx + 11, z0: -5.5, z1: 5.5, y: PY });

    // side rails: visual low walls + height-gated solids on the platform level
    const sideWallMat = new THREE.MeshStandardMaterial({ color: 0xbbbbbb, roughness: 0.7 });
    const railWall = (px, pz, sxw, szw) => {
      const m = new THREE.Mesh(new THREE.BoxGeometry(sxw, 1.1, szw), sideWallMat);
      m.position.set(px, PY + 0.55, pz); scene.add(m);
      world.walk.solids.push({ x: px, z: pz, sx: sxw, sz: szw, y0: PY, y1: PY + 1.3 });
    };
    railWall(sx, 5.5, 22, 0.3);                                      // north edge (full)
    railWall(sx - 6.75, -5.5, 8.5, 0.3);                            // south edge (gap for the escalator)
    railWall(sx + 6.75, -5.5, 8.5, 0.3);
    railWall(sx - 11, 0, 0.3, 11); railWall(sx + 11, 0, 0.3, 11);   // west / east ends

    // walk-up escalator from the street to the platform (over the open avenue)
    const escMat = new THREE.MeshStandardMaterial({ color: 0x9a9a9a, roughness: 0.6, metalness: 0.2 });
    world.walk.ramps.push({ x0: sx - 2.5, x1: sx + 2.5, z0: -25, z1: -5, axis: 'z', yLo: 0, yHi: PY });
    const escLen = Math.hypot(20, PY), escAng = Math.atan2(PY, 20);
    const escMesh = new THREE.Mesh(new THREE.BoxGeometry(5, 0.5, escLen), escMat);
    escMesh.position.set(sx, PY / 2, -15); escMesh.rotation.x = -escAng; escMesh.castShadow = true; escMesh.receiveShadow = true; scene.add(escMesh);
    for (const sxr of [-2.6, 2.6]) {
      const r = new THREE.Mesh(new THREE.BoxGeometry(0.18, 1.0, escLen), sideWallMat);
      r.position.set(sx + sxr, PY / 2 + 0.6, -15); r.rotation.x = -escAng; scene.add(r);
    }
    // station sign
    const stationSign = new THREE.Mesh(
      new THREE.PlaneGeometry(6, 1.0),
      new THREE.MeshBasicMaterial({ color: 0x21f0ff })
    );
    stationSign.position.set(sx, stationFloorY + 5.0, 6.05);
    scene.add(stationSign);
    world.bts = { x: sx, platformY: PY };   // walkable platform info (probe / future use)
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
    world.buildings.push({   // solid: the storefront blocks you, the door still triggers at <5 m
      pos: new THREE.Vector3(p.x, 2, p.z),
      size: new THREE.Vector3(10, 4, 8),
    });
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
  world.buildings.push({   // solid: don't let the player walk through the shop
    pos: new THREE.Vector3(goldShopPos.x, 3, goldShopPos.z),
    size: new THREE.Vector3(12, 6, 8),
  });
  world.poi.goldShop = goldShopPos.clone();

  // ---- Terminal 21 — a 3-floor walk-in mall at the Asok BTS (Goal 4) ----
  // A real enclosed building you walk into (no teleport). Ground floor + two
  // mezzanine rings around a central atrium void, joined by crisscross escalators
  // you actually walk up (see physics.js mallSupportY). world.mall holds the floor
  // platforms, escalator ramps, height-gated solids (rails/counters) and shops.
  {
    const cx = (MALL_I + 0.5) * BLOCK, cz = (MALL_J + 0.5) * BLOCK;   // block center (-25, 25)
    const HW = 20, HD = 17, WALLH = 15, GAP = 9, F1 = 5, F2 = 10;     // half-extents, wall + floor heights
    const VX0 = cx - 9, VX1 = cx + 9, VZ0 = cz - 7, VZ1 = cz + 7;     // central atrium void
    const wallMat  = new THREE.MeshStandardMaterial({ color: 0x9aa6b2, roughness: 0.7 });
    const glassMat = new THREE.MeshStandardMaterial({ color: 0x2a3340, roughness: 0.3, metalness: 0.4, emissive: 0x0c1622 });
    const floorMat = new THREE.MeshStandardMaterial({ color: 0xcfc6b8, roughness: 0.85 });
    const roofMat  = new THREE.MeshStandardMaterial({ color: 0x3a3f47, roughness: 0.9 });
    const escMat   = new THREE.MeshStandardMaterial({ color: 0x7a8088, roughness: 0.5, metalness: 0.3 });
    const railMat  = new THREE.MeshStandardMaterial({ color: 0x2a3138, roughness: 0.6, metalness: 0.3 });
    const shopMat  = new THREE.MeshStandardMaterial({ color: 0xece3d3, roughness: 0.8 });

    const { platforms, ramps, solids } = world.walk;   // shared with the BTS platform
    const shops = [];

    const addWall = (px, pz, sx, sz, mat = wallMat) => {
      const m = new THREE.Mesh(new THREE.BoxGeometry(sx, WALLH, sz), mat);
      m.position.set(px, WALLH / 2, pz); m.castShadow = true; m.receiveShadow = true; scene.add(m);
      world.buildings.push({ pos: new THREE.Vector3(px, WALLH / 2, pz), size: new THREE.Vector3(sx, WALLH, sz) });
    };
    addWall(cx, cz + HD, HW * 2, 1);                    // north (solid, full height)
    addWall(cx - HW, cz, 1, HD * 2);                    // west
    addWall(cx + HW, cz, 1, HD * 2);                    // east
    const segW = HW - GAP / 2;                          // south wall split around the entrance
    addWall(cx - (GAP / 2 + segW / 2), cz - HD, segW, 1, glassMat);
    addWall(cx + (GAP / 2 + segW / 2), cz - HD, segW, 1, glassMat);

    // floor slab (visual) + support platform for one rectangle
    const slab = (x0, x1, z0, z1, y, mat = floorMat) => {
      const m = new THREE.Mesh(new THREE.BoxGeometry(x1 - x0, 0.3, z1 - z0), mat);
      m.position.set((x0 + x1) / 2, y - 0.15, (z0 + z1) / 2); m.receiveShadow = true; m.castShadow = true; scene.add(m);
      platforms.push({ x0, x1, z0, z1, y });
    };
    slab(cx - HW, cx + HW, cz - HD, cz + HD, 0.06);     // ground floor (full)
    for (const fy of [F1, F2]) {                        // mezzanine rings (4 strips around the void)
      slab(cx - HW, cx + HW, VZ1, cz + HD, fy);         // north strip
      slab(cx - HW, cx + HW, cz - HD, VZ0, fy);         // south strip
      slab(cx - HW, VX0, VZ0, VZ1, fy);                 // west strip
      slab(VX1, cx + HW, VZ0, VZ1, fy);                 // east strip
    }

    const roof = new THREE.Mesh(new THREE.BoxGeometry(HW * 2 + 8, 0.6, HD * 2 + 8), roofMat);   // wide eaves enclose the atrium
    roof.position.set(cx, WALLH + 0.3, cz); roof.castShadow = true; scene.add(roof);
    for (const [lx, lz, ly] of [[cx - 11, cz, 4], [cx + 11, cz, 4], [cx, VZ1 + 4, 9], [cx, VZ0 - 4, 9], [cx, cz, 13]])
      { const lamp = new THREE.PointLight(0xfff0d0, 0.6, 36, 2); lamp.position.set(lx, ly, lz); scene.add(lamp); }

    // crisscross escalators over the void (walkable ramps; visual box + side rails)
    const escalator = (x, zLo, zHi, yLo, yHi) => {
      ramps.push({ x0: x - 2, x1: x + 2, z0: zLo, z1: zHi, axis: 'z', yLo, yHi });
      const len = Math.hypot(zHi - zLo, yHi - yLo), ang = Math.atan2(yHi - yLo, zHi - zLo);
      const m = new THREE.Mesh(new THREE.BoxGeometry(4, 0.4, len), escMat);
      m.position.set(x, (yLo + yHi) / 2, (zLo + zHi) / 2); m.rotation.x = -ang; m.castShadow = true; m.receiveShadow = true; scene.add(m);
      for (const sx of [-2.1, 2.1]) {
        const r = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.9, len), railMat);
        r.position.set(x + sx, (yLo + yHi) / 2 + 0.6, (zLo + zHi) / 2); r.rotation.x = -ang; scene.add(r);
      }
    };
    escalator(cx - 4, VZ0 + 1, VZ1 + 1, 0, F1);         // A: ground → floor 1 (rises north)
    escalator(cx + 4, VZ0, VZ1, F2, F1);                // B: floor 1 → floor 2 (rises south)

    // fall rails around the void (height-gated to their floor; the escalator side
    // is left open). solids also block on the same floor only.
    const rail = (x, z, sx, sz, fy) => {
      const m = new THREE.Mesh(new THREE.BoxGeometry(sx, 1.0, sz), railMat);
      m.position.set(x, fy + 0.5, z); m.castShadow = true; scene.add(m);
      solids.push({ x, z, sx, sz, y0: fy, y1: fy + 1.4 });
    };
    rail(cx, VZ0, VX1 - VX0, 0.3, F1); rail(VX0, cz, 0.3, VZ1 - VZ0, F1); rail(VX1, cz, 0.3, VZ1 - VZ0, F1);  // F1: S/W/E
    rail(cx, VZ1, VX1 - VX0, 0.3, F2); rail(VX0, cz, 0.3, VZ1 - VZ0, F2); rail(VX1, cz, 0.3, VZ1 - VZ0, F2);  // F2: N/W/E

    // canvas-texture sign helper (the only place we draw text on geometry)
    const textSign = (text, w, h, bg, fg, px, py, pz, ry = 0) => {
      const cnv = document.createElement('canvas'); cnv.width = 512; cnv.height = 128;
      const c2 = cnv.getContext('2d');
      c2.fillStyle = bg; c2.fillRect(0, 0, 512, 128);
      c2.fillStyle = fg; c2.font = 'bold 60px system-ui, sans-serif'; c2.textAlign = 'center'; c2.textBaseline = 'middle';
      c2.fillText(text, 256, 70);
      const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(cnv) }));
      m.position.set(px, py, pz); m.rotation.y = ry; scene.add(m);
    };
    textSign('TERMINAL 21', 15, 3.6, '#101418', '#ffcf4a', cx, WALLH - 2.5, cz - HD - 0.06, PI);   // exterior marquee
    // floor markers (Terminal 21's floors are world cities)
    textSign('G · ASOK',  5, 1.1, '#101418', '#ffcf4a', VX0 - 0.05, 3.4, cz, PI / 2);
    textSign('1 · TOKYO', 5, 1.1, '#101418', '#21f0ff', VX0 - 0.05, F1 + 3.0, cz, PI / 2);
    textSign('2 · EUROPE',5, 1.1, '#101418', '#b24bff', VX0 - 0.05, F2 + 3.0, cz, PI / 2);

    // central directory desk (ground floor, under the void)
    const desk = new THREE.Mesh(new THREE.BoxGeometry(5, 1.1, 2), new THREE.MeshStandardMaterial({ color: 0x5a4a3a, roughness: 0.7 }));
    desk.position.set(cx, 0.6, cz - 4); desk.castShadow = true; scene.add(desk);
    solids.push({ x: cx, z: cz - 4, sx: 5, sz: 2, y0: 0, y1: 1.5 });
    textSign('DIRECTORY', 4.6, 1.3, '#1a2230', '#9fe0ff', cx, 2.5, cz - 5.06, PI);

    // themed shop fronts on every floor — each is browsable (floor-aware in updateMall)
    const defs = [
      { name: 'Pier 21 Food Court', color: '#ff5a3a', wall: 'N', along: -11, floor: 0 },
      { name: 'Tokyo Tech',         color: '#21f0ff', wall: 'N', along:  11, floor: 0 },
      { name: 'Roma Boutique',      color: '#ff2a86', wall: 'W', along:  -6, floor: 0 },
      { name: 'Paris Pharmacy',     color: '#b24bff', wall: 'E', along:  -6, floor: 0 },
      { name: '7-Eleven',           color: '#39ff7a', wall: 'E', along:   8, floor: 0 },
      { name: 'Akihabara Arcade',   color: '#ff2a86', wall: 'W', along:   0, floor: F1 },
      { name: 'Sushi Bar',          color: '#ff8a3a', wall: 'E', along:   0, floor: F1 },
      { name: 'Manga Café',         color: '#21f0ff', wall: 'S', along:   0, floor: F1 },
      { name: 'London Threads',     color: '#b24bff', wall: 'N', along:   0, floor: F2 },
      { name: 'Le Café',            color: '#ffcf4a', wall: 'W', along:   0, floor: F2 },
      { name: 'Watch Boutique',     color: '#39ff7a', wall: 'E', along:   0, floor: F2 },
    ];
    for (const d of defs) {
      const fy = d.floor;
      let cpx, cpz, ry, spx, spz, sgx, sgz, csx, csz;
      if (d.wall === 'N')      { cpx = cx + d.along; cpz = cz + HD - 2; ry = PI;       csx = 5; csz = 2; spx = cpx;     spz = cpz - 3; sgx = cpx;       sgz = cpz - 1.05; }
      else if (d.wall === 'S') { cpx = cx + d.along; cpz = cz - HD + 2; ry = 0;        csx = 5; csz = 2; spx = cpx;     spz = cpz + 3; sgx = cpx;       sgz = cpz + 1.05; }
      else if (d.wall === 'E') { cpx = cx + HW - 2;  cpz = cz + d.along; ry = -PI / 2; csx = 2; csz = 5; spx = cpx - 3; spz = cpz;     sgx = cpx - 1.05; sgz = cpz; }
      else                     { cpx = cx - HW + 2;  cpz = cz + d.along; ry =  PI / 2; csx = 2; csz = 5; spx = cpx + 3; spz = cpz;     sgx = cpx + 1.05; sgz = cpz; }
      const counter = new THREE.Mesh(new THREE.BoxGeometry(csx, 1.1, csz), shopMat);
      counter.position.set(cpx, fy + 0.55, cpz); counter.castShadow = true; scene.add(counter);
      solids.push({ x: cpx, z: cpz, sx: csx, sz: csz, y0: fy, y1: fy + 1.4 });
      textSign(d.name.toUpperCase(), 6, 1.2, '#0c0f14', d.color, sgx, fy + 2.6, sgz, ry);
      shops.push({ name: d.name, pos: new THREE.Vector3(spx, fy, spz) });
    }

    world.mall = { center: new THREE.Vector3(cx, 0, cz), hw: HW, hd: HD, shops };
    world.poi.terminal21 = new THREE.Vector3(cx, 0, cz - HD - 2);   // stand-here just outside the entrance
    const glow = new THREE.PointLight(0xffcf4a, 0.8, 24, 2); glow.position.set(cx, 5, cz - HD - 3); scene.add(glow);

    // ---- Elevator: a quick lift between floors (north strip, east of the escalators) ----
    const elx = cx + 12, elz = cz + HD - 1.2;
    const elMat = new THREE.MeshStandardMaterial({ color: 0x39424c, roughness: 0.5, metalness: 0.4 });
    for (const fy of [0, F1, F2]) {
      const cab = new THREE.Mesh(new THREE.BoxGeometry(2.8, 3, 0.4), elMat);
      cab.position.set(elx, fy + 1.5, elz + 0.5); cab.castShadow = true; scene.add(cab);
      const btn = new THREE.Mesh(new THREE.PlaneGeometry(0.35, 0.6), new THREE.MeshBasicMaterial({ color: 0x39ff7a }));
      btn.position.set(elx + 1.1, fy + 1.4, elz - 0.41); btn.rotation.y = PI; scene.add(btn);
      textSign('LIFT', 1.8, 0.7, '#101418', '#9fe0ff', elx, fy + 2.6, elz - 0.42, PI);
    }
    world.mall.elevator = new THREE.Vector3(elx, 0, elz - 1.8);   // stand-here spot in front of the lift
    world.mall.floors = [0, F1, F2];

    // ---- Window shoppers — a couple standing on every floor (decorative, no AI) ----
    for (const [px, pz, fy, rot] of [
      [cx - 6, cz - 12, 0, 1.2], [cx + 9, cz - 10, 0, 4.1],          // ground
      [cx - 15, cz, F1, 0.5], [cx + 11, cz + 1, F1, 3.3],          // floor 1 (W / E strips)
      [cx - 5, cz + 12, F2, 2.4], [cx + 8, cz - 13, F2, 5.6],       // floor 2 (N / S strips)
    ]) {
      const ped = makePedMesh();
      ped.position.set(px, fy, pz); ped.rotation.y = rot; ped.frustumCulled = false; scene.add(ped);
    }
  }

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

}

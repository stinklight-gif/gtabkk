// =============================================================================
// TRAFFIC SIGNALS — synchronized city-wide lights at every grid intersection.
// Built once as a handful of merged meshes (mast + housings, crosswalk stripes,
// and SIX globally-shared lamp materials whose emissive is toggled by the phase
// clock). AI cars read lightFor(dir) and halt at the stop line on red/amber;
// peds wait at the kerb when the cross has the green. The player obeys nothing —
// signals are world flavour, not a rule on the human driver. No postprocessing.
// =============================================================================
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { G, BLOCK, GRID, HALF, ROAD_WIDTH, makeStaticBaker, clamp } from './core.js';

// Phase cycle (seconds): N/S green → N/S amber → E/W green → E/W amber, repeat.
// One shared phase for the whole city: a car leaving one green never immediately
// meets a red, and the box always clears, so the grid can never deadlock.
const GREEN = 10.0, AMBER = 2.4, CYCLE = 2 * (GREEN + AMBER);

// dir convention matches vehicles.js: 0=N(+z) 1=E(+x) 2=S(-z) 3=W(-x).
// Even dirs travel along z (a "N/S" movement); odd dirs along x ("E/W").
export function lightFor(dir) {
  const t = G.traffic;
  if (!t) return 'green';
  return (dir % 2 === 0) ? t.ns : t.ew;
}

function lampMat(hex) {
  // Dark housing-colour body so an unlit lamp reads as a dead bulb; the colour
  // only appears when emissiveIntensity is driven up by the phase clock. Bloom
  // turns the lit one into a soft halo at night for free.
  return new THREE.MeshStandardMaterial({ color: 0x141414, emissive: hex, emissiveIntensity: 0, roughness: 0.5, metalness: 0.0 });
}

export function buildTrafficLights(scene) {
  const mats = {
    nsRed:   lampMat(0xff2a2a), nsAmber:   lampMat(0xffb02a), nsGreen:   lampMat(0x2bff5a),
    ewRed:   lampMat(0xff2a2a), ewAmber:   lampMat(0xffb02a), ewGreen:   lampMat(0x2bff5a),
  };

  // Static (non-toggling) parts share one dark material → one merged mesh.
  const darkMat = new THREE.MeshStandardMaterial({ color: 0x1c1f24, roughness: 0.7, metalness: 0.35 });
  const stripeMat = new THREE.MeshBasicMaterial({ color: 0xd8dbe0 });   // crosswalk paint (flat, unlit)
  const mastBaker = makeStaticBaker();
  const flatBaker = makeStaticBaker();

  // Base geometries — cloned + transformed per intersection, then merged.
  const poleGeo    = new THREE.BoxGeometry(0.22, 5.2, 0.22);
  const housingGeo = new THREE.BoxGeometry(0.46, 1.34, 0.30);
  const lampGeo    = new THREE.SphereGeometry(0.17, 8, 6);
  const barGeoZ    = new THREE.PlaneGeometry(0.5, 2.4);   // crosswalk bar long in z (N/S road)
  const barGeoX    = new THREE.PlaneGeometry(2.4, 0.5);   // crosswalk bar long in x (E/W road)

  const _m = new THREE.Matrix4(), _p = new THREE.Vector3(), _q = new THREE.Quaternion(), _e = new THREE.Euler(), ONE = new THREE.Vector3(1, 1, 1);
  function bake(baker, geo, mat, x, y, z, rotX) {
    _e.set(rotX || 0, 0, 0); _q.setFromEuler(_e); _p.set(x, y, z); _m.compose(_p, _q, ONE);
    baker.add(geo, _m, mat, false, false);
  }

  // Lamp spheres are grouped by material so each colour merges into one mesh.
  const lampGeos = { nsRed: [], nsAmber: [], nsGreen: [], ewRed: [], ewAmber: [], ewGreen: [] };
  function lamp(key, x, y, z) { const g = lampGeo.clone(); g.translate(x, y, z); lampGeos[key].push(g); }

  const RW = ROAD_WIDTH, RIVER_I = -GRID / 2;

  for (let i = -GRID / 2; i <= GRID / 2; i++) {
    if (i === RIVER_I) continue;                 // river column — no roads there
    for (let j = -GRID / 2; j <= GRID / 2; j++) {
      const cx = i * BLOCK, cz = j * BLOCK;
      const px = cx + RW / 2 + 0.9, pz = cz + RW / 2 + 0.9;  // mast on the NE corner

      // --- mast: a pole with two signal heads (one per axis) ---
      bake(mastBaker, poleGeo, darkMat, px, 2.6, pz);
      bake(mastBaker, housingGeo, darkMat, px - 0.45, 4.40, pz);          // N/S head
      bake(mastBaker, housingGeo, darkMat, px, 4.40, pz - 0.45);          // E/W head

      // --- lamps: red / amber / green stacked on each head ---
      lamp('nsRed',   px - 0.72, 4.82, pz);
      lamp('nsAmber', px - 0.72, 4.40, pz);
      lamp('nsGreen', px - 0.72, 3.98, pz);
      lamp('ewRed',   px, 4.82, pz - 0.72);
      lamp('ewAmber', px, 4.40, pz - 0.72);
      lamp('ewGreen', px, 3.98, pz - 0.72);

      // --- crosswalk paint: a zebra on the south approach (across the N/S road)
      //     and one on the west approach (across the E/W road). Stripes run with
      //     the flow, repeated across the carriageway. ---
      const half = RW / 2 - 1, n = 6, step = (RW - 2) / (n - 1);
      const zSouth = cz - RW / 2 - 1.3, xWest = cx - RW / 2 - 1.3;
      for (let b = 0; b < n; b++) {
        const o = -half + step * b;
        bake(flatBaker, barGeoZ, stripeMat, cx + o, 0.035, zSouth, -Math.PI / 2);   // across N/S road
        bake(flatBaker, barGeoX, stripeMat, xWest, 0.035, cz + o, -Math.PI / 2);    // across E/W road
      }
    }
  }

  mastBaker.flush(scene);
  flatBaker.flush(scene);

  // Merge each lamp colour into a single mesh sharing its toggle material.
  for (const key of Object.keys(lampGeos)) {
    const arr = lampGeos[key];
    if (!arr.length) continue;
    const merged = mergeGeometries(arr, false);
    arr.forEach(g => g.dispose());
    const mesh = new THREE.Mesh(merged, mats[key]);
    mesh.frustumCulled = false;   // spans the whole map; can't cull as a unit
    scene.add(mesh);
  }

  G.traffic = { t: 0, ns: 'green', ew: 'red', mats };
  updateTrafficLights(0);   // set the opening emissive state
}

export function updateTrafficLights(dt) {
  const t = G.traffic;
  if (!t) return;
  t.t = (t.t + dt) % CYCLE;
  const x = t.t;
  let ns, ew;
  if      (x < GREEN)               { ns = 'green'; ew = 'red';   }
  else if (x < GREEN + AMBER)       { ns = 'amber'; ew = 'red';   }
  else if (x < 2 * GREEN + AMBER)   { ns = 'red';   ew = 'green'; }
  else                              { ns = 'red';   ew = 'amber'; }
  t.ns = ns; t.ew = ew;

  // Drive the six shared materials — the only per-frame cost (brighter at night).
  const m = t.mats, on = 1.7 * (1 + (G.nightK || 0) * 0.7);
  m.nsRed.emissiveIntensity   = ns === 'red'   ? on : 0;
  m.nsAmber.emissiveIntensity = ns === 'amber' ? on : 0;
  m.nsGreen.emissiveIntensity = ns === 'green' ? on : 0;
  m.ewRed.emissiveIntensity   = ew === 'red'   ? on : 0;
  m.ewAmber.emissiveIntensity = ew === 'amber' ? on : 0;
  m.ewGreen.emissiveIntensity = ew === 'green' ? on : 0;
}

// =============================================================================
// CORE — shared helpers, constants, palettes, the global game object (G),
// pooled scratch, the static-geometry baker, disposeObject, lerpAngle. No game logic.
// =============================================================================
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

// Static-geometry baker: the city is ~7,700 individual static meshes (road
// stripes, sidewalks, building boxes, window/neon planes…). Rendered one-per
// draw call that's thousands of calls. The baker accumulates each static piece
// as a world-space-baked geometry clone, grouped by material, and flushes one
// merged Mesh per material — collapsing thousands of draw calls into a handful
// while preserving the exact look (geometry, position and per-material night
// ramps are all unchanged). Only ever fed provably-static geometry.
export function makeStaticBaker() {
  const buckets = new Map();  // material -> { geos, cast, receive }
  return {
    // geo: a (shared, unmodified) BufferGeometry; matrix: its world transform.
    add(geo, matrix, material, cast = false, receive = false) {
      let bk = buckets.get(material);
      if (!bk) { bk = { geos: [], cast, receive }; buckets.set(material, bk); }
      bk.geos.push(geo.clone().applyMatrix4(matrix));
    },
    flush(scene) {
      let meshes = 0;
      for (const [material, bk] of buckets) {
        if (!bk.geos.length) continue;
        const merged = mergeGeometries(bk.geos, false);
        bk.geos.forEach(g => g.dispose());
        const mesh = new THREE.Mesh(merged, material);
        mesh.castShadow = bk.cast; mesh.receiveShadow = bk.receive;
        mesh.frustumCulled = false;   // a merged mesh spans the map; its box can't cull usefully
        scene.add(mesh);
        meshes++;
      }
      buckets.clear();
      return meshes;
    },
  };
}

export const PI = Math.PI, TAU = PI * 2;
export const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
export const lerp  = (a, b, t) => a + (b - a) * t;
export const rand  = (a, b) => a + Math.random() * (b - a);
export const irand = (a, b) => Math.floor(rand(a, b + 1));
export const pick  = arr => arr[Math.floor(Math.random() * arr.length)];
export const sign  = x => (x > 0 ? 1 : x < 0 ? -1 : 0);
export const dist2 = (a, b) => { const dx = a.x - b.x, dz = a.z - b.z; return dx*dx + dz*dz; };

// Deterministic-ish color palettes per district
export const COLORS = {
  // Bangkok surfaces are sun-bleached, not charcoal — albedos must survive
  // daylight without rendering black (see goal2.md phase 1.3).
  asphalt:  0x34373c,
  sidewalk: 0x6f6f6f,
  curb:     0x3a3a3a,
  building: [0x7a7a88, 0x8d8794, 0x9a8a70, 0x837a7a, 0x6e7077],
  neon:     [0xff2a86, 0x21f0ff, 0xff7a1a, 0xb24bff, 0xffcf4a, 0x39ff7a],
  khlong:   0x3a4f3a,
};

// Global container, populated by init()
export const G = {
  THREE, scene: null, camera: null, renderer: null, clock: null,
  audio: null,           // AudioContext + helpers
  state: 'loading',      // 'playing' | 'paused' | 'phone' | 'map'
  input: null,           // keyboard/mouse state
  player: null,
  hud: null,
  mission: null,
  world: null,           // city geometry + spatial helpers
  vehicles: [],          // all vehicles in the world (NPC + player)
  peds: [],
  dogs: [],
  cops: [],
  bullets: [],
  particles: [],
  effects: [],
  time: { dayT: 0.27, weather: 'clear', rainStrength: 0, day: 0 }, // dayT 0..1; day = whole days elapsed
  // Festivals — Loy Krathong (night, floats/lanterns) and Songkran (day, water fight)
  festival: { type: null, floats: [], lanterns: [], watchers: [], announcedDay: -1, krathongFloated: 0 },
  wanted: { stars: 0, lastSeenAt: 0, lastSeenPos: new THREE.Vector3() },
  cash: 100,
  copsKilled: 0,         // lifetime cop takedowns (drives pistol/heat unlocks + phone stat)
  notifQueue: [],
  paused: false,
  hitStop: 0,            // seconds of slow-mo remaining after a solid hit
  skids: [],             // tire-skid decals (faded over time)
  dust: [],              // impact dust puffs
  groundHelpers: null,
  // Player property / ownership economy (persisted in the save).
  econ: {
    safehouse: { owned: false, pos: null },           // buyable respawn point
    garage: { rented: false, stored: [], capacity: 4, retrieveIdx: 0 }, // stored: [{kind,color,plate,hp}]
    businesses: {},                                   // id -> { owned, pending } passive-income holdings
  },
};

// Buyable businesses: walk up and E to buy; while owned they accrue passive
// income (rate/s, capped) you return to collect. Persisted in the save.
export const BUSINESSES = [
  { id: 'noodle',   name: 'Noodle Cart',          price: 5000,  rate: 25,  cap: 1500, pos: new THREE.Vector3(8, 0, 30) },
  { id: 'tukstand', name: 'Tuk-Tuk Stand',        price: 12000, rate: 50,  cap: 3000, pos: new THREE.Vector3(8, 0, -44) },
  { id: 't21unit',  name: 'Terminal 21 Retail Unit', price: 30000, rate: 110, cap: 7000, pos: new THREE.Vector3(-25, 0, 18) },
];

// Economy prices (one place to balance the money sinks).
export const PRICE = { safehouse: 12000, garageRent: 4000, repaint: 250 };
// Paint colors offered at the garage.
export const PAINT_COLORS = [0xd44b3b, 0xf3f3f3, 0x2a3a55, 0x1e9a5e, 0xe0b020, 0x101015, 0x8c3a8c, 0x35506e, 0xd96a2a];

window.GAME = G; // for poking around in the console

// -----------------------------------------------------------------------------
// Shared gameplay helpers + pooled temporaries (reused across the update loop to
// avoid per-frame allocations). GAMEPLAY flags gate the optional systems so any
// of them can be turned off with a one-line change.
// -----------------------------------------------------------------------------
export const ROAD_WIDTH = 12;          // matches buildWorld's local ROAD_W
export const PED_TARGET = 82;          // peak crowd cap; scaled by crowdFactor(dayT) per time of day

export const GAMEPLAY = {
  armor: true,            // armor soaks damage before HP
  vulnerableOnFoot: true, // cops can hurt the player while on foot
  pistolOnCopKill: true,  // first cop kill grants the 9mm (per README)
  wantedLOS: true,        // stars only decay once no cop is within sight
};

// pooled scratch objects (never returned/stored — copy out before reuse)
export const _camTarget = new THREE.Vector3();
export const _camOffset = new THREE.Vector3();
export const _fireDir   = new THREE.Vector3();
export const _ray       = new THREE.Raycaster();
export const _bbox      = new THREE.Box3();   // scratch AABB for ray-vs-building tests
export const _vBox      = new THREE.Vector3();
export const _blackColor = new THREE.Color(0x111111);

// Free GPU resources for a mesh/group that's leaving the scene for good.
export function disposeObject(obj) {
  obj.traverse(o => {
    if (o.geometry) o.geometry.dispose();
    const m = o.material;
    if (m) { if (Array.isArray(m)) m.forEach(x => x.dispose()); else m.dispose(); }
  });
}

export const BLOCK = 50;
export const GRID  = 10;
export const HALF  = (BLOCK * GRID) / 2; // 250

export function lerpAngle(a, b, t) {
  let d = b - a;
  while (d > PI) d -= TAU;
  while (d < -PI) d += TAU;
  return a + d * t;
}

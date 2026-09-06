// Suvarnabhumi pocket — easternmost building column (i = GRID/2-1, x≈200–250).
// Compact stand-in: one runway, a taxiway, a terminal, parked airliners, and a
// player-enterable jet that taxis on the ground. Not a 4 km² GIS airport.
import * as THREE from 'three';
import { G, GAMEPLAY, GRID, PI } from './core.js';
import { makeVehicle } from './entities.js';

export const AIRPORT_I = GRID / 2 - 1; // 4 — same skip pattern as the river column

export function buildAirport(scene, world) {
  if (!GAMEPLAY.airport) return;

  const asphalt = new THREE.MeshStandardMaterial({ color: 0x3a3e44, roughness: 0.92 });
  const runwayMat = new THREE.MeshStandardMaterial({ color: 0x2b2e33, roughness: 0.88 });
  const taxiMat = new THREE.MeshStandardMaterial({ color: 0x35383e, roughness: 0.9 });
  const markMat = new THREE.MeshBasicMaterial({ color: 0xe8e4d8 });
  const concrete = new THREE.MeshStandardMaterial({ color: 0x8a8e94, roughness: 0.82 });
  const glass = new THREE.MeshStandardMaterial({ color: 0x6a88a8, roughness: 0.25, metalness: 0.45, transparent: true, opacity: 0.72 });
  const purple = new THREE.MeshStandardMaterial({ color: 0x4a1a58, roughness: 0.55 });
  const gold = new THREE.MeshStandardMaterial({ color: 0xc9a020, roughness: 0.45, metalness: 0.35 });

  function ground(mat, x, z, w, d, y = 0.04) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, 0.08, d), mat);
    m.position.set(x, y, z); m.receiveShadow = true; scene.add(m);
  }
  function dash(x, z, w, d) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, 0.04, d), markMat);
    m.position.set(x, 0.09, z); scene.add(m);
  }
  function solid(pos, size, mat, cast = true) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(size.x, size.y, size.z), mat);
    m.position.copy(pos); m.castShadow = cast; m.receiveShadow = true; scene.add(m);
    const b = { pos: pos.clone(), size: size.clone() };
    world.buildings.push(b);
    return m;
  }

  // Apron fills the east column; runway on the far east, taxiway in the middle.
  ground(asphalt, 224, 0, 44, 430, 0.03);
  ground(runwayMat, 237, 0, 16, 400, 0.045);
  ground(taxiMat, 220, 0, 8, 360, 0.046);

  // Runway 01L / 19R centreline + thresholds
  for (let z = -185; z <= 185; z += 14) dash(237, z, 0.45, 7);
  for (let i = 0; i < 8; i++) {
    dash(237 - 4 + i * 1.15, -188, 0.7, 10);
    dash(237 - 4 + i * 1.15, 188, 0.7, 10);
  }
  dash(237, 0, 12, 1.2);
  const edgeMat = new THREE.MeshStandardMaterial({
    color: 0xc9a020, roughness: 0.45, metalness: 0.2,
    emissive: 0xc9a020, emissiveIntensity: 0.12,
  });
  const runwayLights = [];
  for (let z = -40; z <= 40; z += 20) {
    for (const x of [229.2, 244.8]) {
      const edge = new THREE.Mesh(new THREE.BoxGeometry(0.35, 0.05, 8), edgeMat);
      edge.name = 'runway-edge';
      edge.position.set(x, 0.1, z); scene.add(edge);
      runwayLights.push(edge);
    }
  }
  G.runwayLights = { lights: runwayLights, mat: edgeMat, t: 0 };

  const terminal = solid(new THREE.Vector3(209, 7, 0), new THREE.Vector3(10, 14, 52), concrete);
  const glassBand = new THREE.Mesh(new THREE.BoxGeometry(10.2, 5, 48), glass);
  glassBand.position.set(209, 6, 0); scene.add(glassBand);
  solid(new THREE.Vector3(209, 5, 50), new THREE.Vector3(10, 10, 26), concrete);
  solid(new THREE.Vector3(209, 5, -50), new THREE.Vector3(10, 10, 26), concrete);
  solid(new THREE.Vector3(212, 16, 96), new THREE.Vector3(5.5, 32, 5.5), concrete);
  const cab = new THREE.Mesh(new THREE.BoxGeometry(7, 4, 7), glass);
  cab.position.set(212, 33, 96); scene.add(cab);
  solid(new THREE.Vector3(209, 4, -118), new THREE.Vector3(12, 8, 22), concrete);

  const stripe = new THREE.Mesh(new THREE.BoxGeometry(10.3, 1.2, 52), purple);
  stripe.position.set(209, 12.2, 0); scene.add(stripe);
  const stripeGold = new THREE.Mesh(new THREE.BoxGeometry(10.35, 0.35, 52), gold);
  stripeGold.position.set(209, 12.9, 0); scene.add(stripeGold);

  // Roof lettering
  const canvas = document.createElement('canvas'); canvas.width = 512; canvas.height = 64;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#1a1c20'; ctx.fillRect(0, 0, 512, 64);
  ctx.fillStyle = '#e8e4d8';
  ctx.font = 'bold 36px system-ui, sans-serif';
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText('SUVARNABHUMI', 256, 32);
  const tex = new THREE.CanvasTexture(canvas);
  const sign = new THREE.Mesh(new THREE.PlaneGeometry(28, 3.4), new THREE.MeshBasicMaterial({ map: tex, toneMapped: false }));
  sign.position.set(209, 15.4, 0); sign.rotation.y = -PI / 2; scene.add(sign);

  const thai = document.createElement('canvas'); thai.width = 256; thai.height = 48;
  const tctx = thai.getContext('2d');
  tctx.fillStyle = '#4a1a58'; tctx.fillRect(0, 0, 256, 48);
  tctx.fillStyle = '#c9a020'; tctx.font = 'bold 28px system-ui, sans-serif'; // no named webfonts — see makeThaiSignAtlas
  tctx.textAlign = 'center'; tctx.textBaseline = 'middle';
  tctx.fillText('สุวรรณภูมิ', 128, 24);
  const thaiTex = new THREE.CanvasTexture(thai);
  const thaiSign = new THREE.Mesh(new THREE.PlaneGeometry(14, 2.4), new THREE.MeshBasicMaterial({ map: thaiTex, toneMapped: false }));
  thaiSign.position.set(209, 14.2, 0); thaiSign.rotation.y = -PI / 2; scene.add(thaiSign);

  // Windsock
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.14, 8, 6), new THREE.MeshStandardMaterial({ color: 0x888 }));
  pole.name = 'windsock-pole';
  pole.position.set(230, 4, -170); scene.add(pole);
  const sock = new THREE.Mesh(new THREE.ConeGeometry(0.7, 2.4, 6, 1, true), new THREE.MeshStandardMaterial({ color: 0xc45a1a, side: THREE.DoubleSide }));
  sock.name = 'windsock';
  sock.rotation.z = PI / 2; sock.position.set(231.4, 7.6, -170); scene.add(sock);
  G.windsock = { pole, sock, x: 230, z: -170, t: 0 };

  world.poi.suvarnabhumi = new THREE.Vector3(220, 0, 0);
  world.poi.airportTower = new THREE.Vector3(212, 0, 96);
  world.poi.airportRunway = new THREE.Vector3(237, 0, 0);
  world.airport = { x0: 200, x1: 248, z0: -220, z1: 220, terminal };
}

export function spawnAirportPlanes(scene) {
  if (!GAMEPLAY.airport) return;
  const stands = [
    { x: 220, z: -80, heading: 0, player: false },
    { x: 220, z: -30, heading: 0, player: false },
    { x: 220, z: 40, heading: 0, player: false },
    { x: 237, z: -140, heading: 0, player: true },
  ];
  for (const s of stands) {
    const v = makeVehicle('airliner', scene);
    v.pos.set(s.x, 0, s.z);
    v.mesh.position.copy(v.pos);
    v.heading = s.heading;
    v.mesh.rotation.y = s.heading;
    v.driver = null;
    v.vel = 0;
    v.hp = 220;
    v.npc = null;
    if (s.player) {
      v.playerJet = true;
      if (G.world && G.world.poi) G.world.poi.playerJet = v.pos.clone();
    }
  }
}

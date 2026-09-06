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
  // Festivals — Loy Krathong nights fill the river with floats and lanterns.
  festival: { type: null, floats: [], lanterns: [], watchers: [], announcedDay: -1, krathongFloated: 0 },
  wanted: { stars: 0, crime: 0, lastSeenAt: 0, lastSeenPos: new THREE.Vector3() },   // crime = accumulated heat points behind the stars
  heist: { active: false, stage: 0, crackT: 0, markerPos: null, beam: null, cooldownUntil: 0 }, // bank-heist set-piece
  cash: 100,
  minimapZoom: 2.4,
  policeOff: false,      // user toggle (pause menu): when true the whole wanted/cop system is suppressed
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
    upgrades: { engine: 0, nitro: 0, armor: 0, melee: 0 },      // account-wide vehicle + gym melee tuning (levels 0..3)
    bank: { balance: 0, lastDay: null, lastInterest: 0 },  // savings account at Krung Thep Bank (earns daily interest)
  },
};

export const BANK_INTEREST = 0.04;        // daily interest on the bank balance (compounded per in-game day)
export const BANK_INTEREST_CAP = 500000;  // interest only accrues on the first ฿500k (no runaway compounding)

// Garage vehicle upgrades: account-wide tuning levels you buy at the U-Spray,
// applied to whatever car you drive (see vehicles.js applyUpgrades). A money
// sink for late-game wealth that meaningfully changes chases/getaways.
export const UPGRADES = [
  { id: 'engine', label: 'Engine', max: 3, prices: [4000, 9000, 18000],  desc: 'Top speed + acceleration' },
  { id: 'nitro',  label: 'Nitro',  max: 3, prices: [3500, 8000, 16000],  desc: 'Stronger SHIFT boost' },
  { id: 'armor',  label: 'Armor',  max: 3, prices: [3000, 7000, 14000],  desc: 'Less crash damage' },
];

// Buyable businesses: walk up and E to buy; while owned they accrue passive
// income (rate/s, capped) you return to collect. Persisted in the save.
//
// Economy curve (for balancing): jobs are the primary earner — welcome ฿1,200,
// Soi Run ฿2,500, Hit ฿4,000, Delivery ฿6,000, Mall Job ฿8,000. Businesses are a
// supplement, not a replacement: combined ~140 ฿/s (down from 185), each
// recouping its price in ~4–5 min of accrual, with caps that punish neglect so
// you can't idle-hoard. Tuned so active jobs stay worthwhile vs. passive income.
export const BUSINESSES = [
  { id: 'noodle',   name: 'Noodle Cart',          price: 5000,  rate: 20, cap: 1200, pos: new THREE.Vector3(8, 0, 30) },
  { id: 'market',   name: 'Market Stall',         price: 7000,  rate: 28, cap: 1700, pos: new THREE.Vector3(-8, 0, -44) },
  { id: 'wash',     name: 'Car Wash',             price: 9000,  rate: 35, cap: 2100, pos: new THREE.Vector3(44, 0, 8) },
  { id: 'tukstand', name: 'Tuk-Tuk Stand',        price: 12000, rate: 40, cap: 2400, pos: new THREE.Vector3(8, 0, -90) },
  { id: 'bar',      name: 'Soi Cowboy Bar',       price: 18000, rate: 65, cap: 4000, pos: new THREE.Vector3(44, 0, 90) },
  { id: 't21unit',  name: 'Terminal 21 Retail Unit', price: 26000, rate: 80, cap: 4800, pos: new THREE.Vector3(-25, 0, 18) },
  { id: 'club',     name: 'Nightclub',            price: 70000,  rate: 180, cap: 9000,  minRank: 1, pos: new THREE.Vector3(-8, 0, 60) },
  { id: 'condo',    name: 'Condo Tower',          price: 150000, rate: 360, cap: 18000, minRank: 2, pos: new THREE.Vector3(54, 0, 90) },
];

// Wealth ladder: net worth (cash + bank + property value) sets your rank, which
// in turn gates the premium properties above (minRank). A goal to chase.
export const WEALTH_TIERS = [
  { name: 'Street Hustler', min: 0 },
  { name: 'Operator',       min: 75000 },
  { name: 'Boss',           min: 250000 },
  { name: 'Kingpin',        min: 600000 },
  { name: 'Tycoon',         min: 1500000 },
];
export function netWorth() {
  let nw = (G.cash || 0) + ((G.econ.bank && G.econ.bank.balance) || 0);
  for (const b of BUSINESSES) { const s = G.econ.businesses[b.id]; if (s && s.owned) nw += Math.round(b.price * BIZ_TIER_MUL[s.tier || 1]); }
  return Math.floor(nw);
}
export function wealthRank(nw) {
  let r = 0;
  for (let i = 0; i < WEALTH_TIERS.length; i++) if (nw >= WEALTH_TIERS[i].min) r = i;
  return r;
}
// Higher-rank perk: a discount on vehicle + property upgrades (8% per rank, capped
// at 30% for Tycoon). Kingpin (rank 3) also gets a one-off personal supercar.
export function rankDiscount() { return Math.min(0.30, (G._wealthRank || 0) * 0.08); }
// Property tiers: buy at Tier 1, upgrade to 3 for scaling income (a late-game
// money sink). One place so player.js (collect/upgrade) and hud.js (holdings)
// agree on the numbers.
export const BIZ_TIER_MUL = [0, 1, 1.9, 3.2];   // income + cap multiplier, indexed by tier (1..3)
export function bizRate(b, s) { return Math.round(b.rate * BIZ_TIER_MUL[(s && s.tier) || 1]); }
export function bizCap(b, s) { return Math.round(b.cap * BIZ_TIER_MUL[(s && s.tier) || 1]); }
export function bizUpgradeCost(b, tier) { return Math.round(b.price * (tier === 1 ? 1.3 : 2.2)); }   // cost tier → tier+1
export function bizManagerCost(b) { return Math.round(b.price * 0.6); }   // one-off: managed properties auto-bank their income
export function bizSaleValue(b, s) { return Math.round(b.price * BIZ_TIER_MUL[(s && s.tier) || 1] * 0.7); }   // divest for 70% of current value

// Gang turf: clear the gang in a zone to claim it; held turf pays passive income
// but rival gangs periodically try to retake it. Logic in npcs.js updateTurf.
export const TURFS = [
  { id: 'khlong', name: 'Khlong Toei',  center: new THREE.Vector3(-150, 0,  150), radius: 28 },
  { id: 'din',    name: 'Din Daeng',    center: new THREE.Vector3( 150, 0,  150), radius: 28 },
  { id: 'phra',   name: 'Phra Khanong', center: new THREE.Vector3( 150, 0, -150), radius: 28 },
];

// Story-mission milestones, in chain order — single source of truth for the
// completion % (phone + 100% celebration) so it tracks the story jobs plus
// Bout / Monsoon / Customs / 2 AM Soi.
export function missionMilestones() {
  const flags = [
    G._welcomeDone, G._soiRunWon, G._hitDone, G._deliveryDone, G._mallJobDone, G._getawayDone,
    G._boutDone, G._monsoonDone, G._customsDone, G._nightSoiDone,
  ];
  return { done: flags.reduce((n, f) => n + (f ? 1 : 0), 0), total: flags.length };
}

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
export const TRAFFIC_TARGET = 28;      // peak ambient cars; scaled by trafficFactor(dayT)

export const GAMEPLAY = {
  armor: true,            // armor soaks damage before HP
  vulnerableOnFoot: true, // cops can hurt the player while on foot
  pistolOnCopKill: true,  // first cop kill grants the 9mm (per README)
  wantedLOS: true,        // stars only decay once no cop is within sight
  fallDamage: true,       // long drops hurt (threshold ~2.8 m; a normal jump is free)
  // P1 — pedestrians occupy the city
  pedWalkways: true,
  pedBuildingCollision: true,
  pedCrosswalks: true,
  monkHeat: true,
  dogRoadLife: true,
  // P2 — traffic as a time-of-day city
  trafficDensity: true,
  trafficDestinations: true,
  bikeFilterWide: true,
  // P3 — driving feel (still arcade)
  vehicleKindFeel: true,
  fakeRpm: true,
  vehicleLimp: true,
  kerbScrub: true,
  // P4 — street-level world
  sois: true,
  yaowaratCarHostility: true,
  floodPatches: true,
  heatHaze: true,
  // P5 — audio occupies space
  spatialSiren: true,
  districtBeds: true,
  // P6 — missions that use the city
  watHeatSink: true,
  // P7 — honest UI
  honestAmmo: true,
  speedo: true,
  gamepad: true,
  tach: true,
  bikeLowside: true,
  coverVehicles: true,
  gltf: true,
  rapier: false,
  rollover: false,
  fuel: false,
  cover: true,
  clinch: true,
  btsHijack: true,
  fireAtTen: true,
  allRed: true,
  airport: true,
  btsRide: true,
  talkChase: true,
  yaowaratNight: true,
  boatHijack: true,
  sevenInterior: true,
  motosai: true,          // pillion motorcycle taxi, soi-only, pays more if you filter traffic
  motosaiStands: true,    // orange-vest bikes waiting at soi mouths; traffic bikes carry pillions
  burningHaze: true,      // third weather: burning-season haze (noon goes dirty, headlights, fog)
  schoolKids: true,       // morning uniforms walking the sois toward the BTS
  seekShade: true,        // midday / haze: wanderers pull onto walkways and stop
  stallSit: true,         // E to sit at a food stall, pay, eat, heal
  spiritWai: true,        // E at a spirit house: incense, heat cools
  soiCats: true,          // cats loaf at food stalls and bolt when you get close
  btsPlatform: true,      // commuters wait on Asok / Phrom Phong; PA when the train pulls in
  bikeHelmets: true,      // helmeted riders on bikes; stand/pillion heads get lids too
  officeCommute: true,    // evening office crowd walking the sois toward the BTS
  afternoonStorm: true,   // after the heat, a Gulf thunderstorm breaks mid-afternoon
  crossingGuard: true,    // yellow-vest stop-paddle at Asok and Phrom Phong during the school walk
  btsMotosai: true,       // extra orange-vest stands at the Asok and Phrom Phong BTS mouths
  rainPack: true,         // food stalls pack tarps and queues when the rain hits
  btsSongthaew: true,     // parked songthaew + hawker at the Asok and Phrom Phong BTS exits
  iceCart: true,          // vendor ice carts patrol the sois and ding
  btsTuktuk: true,        // parked tuk-tuk + driver at the Asok and Phrom Phong BTS exits
  khlongMonitor: true,    // water monitors loaf on the river bank and bolt
  stallGecko: true,       // tiny geckos on stall parasols after dark
  soiFootball: true,      // after-school kickabout in a soi
  mallShoppers: true,     // evening bags walking from Terminal 21 to the BTS
  lottery: true,          // Government Lottery board outside 7-Eleven; E buys a ticket
  watChant: true,         // dawn and dusk chant from the wat when you're nearby
  coconutCart: true,      // green-coconut cart on a soi; E for a drink
  soiLaundry: true,       // clothes lines strung across sois
  nightCheckpoint: true,  // night cones + flashlight cop; blow through and you get a star
  sevenBikes: true,       // parked motorbike clusters outside every 7-Eleven storefront
  hyacinth: true,         // water hyacinth mats drift on the khlong
  btsSitters: true,       // people sit the Asok and Phrom Phong BTS escalators with their phones
  mooPing: true,          // grilled-pork cart on a soi; E for a skewer
  watTurtles: true,       // turtles paddle the pond at the wat
  sevenGuard: true,       // plastic-chair security at every 7-Eleven storefront
  soiPa: true,            // village PA horns on soi poles; crackle at dawn and afternoon
  soiChairs: true,        // plastic chairs + beer crates; drinkers sit after dark
  soiMechanic: true,      // paddock-stand bike + mechanic; E repairs your ride for ฿80
  copSoiBlock: true,      // cop cars (not bikes) refuse authored sois; they stall at the mouth
  floodSois: true,        // after a downpour the sois sheet with water; cars crawl, bikes don't
  dawnAlms: true,         // 5–7h tak bat: monks walk a soi; E offers ฿20 and cools heat
  soiCowboy: true,        // neon bar strip at the Soi Cowboy kiosk; touts after 20:00
  phonePlaces: true,      // phone directory rows that were "somewhere" now point at a place
  longtailChase: true,    // steal a longtail with stars and river cops chase in the channel
  boatNoodle: true,       // kuay teow reua: a noodle boat works the pier; E for a bowl
  twoAmCheckpoint: true,  // 1:30–3:40 ด่าน: spike strip across the lane; blow through is 2★
  somTam: true,           // som tam cart on a soi; pestle, E for a plate
  btsMalai: true,         // phuang malai vendor at Asok and Phrom Phong BTS; E buys a garland
  cowboyClose: true,      // 4–5:30h drunks walk from Soi Cowboy toward the BTS
  plaKat: true,           // fighting-fish bags hanging on a soi; E buys a bag
  chaYen: true,           // Thai iced-tea cart on a soi; E for a cup
  soiBarber: true,        // plastic-chair barber on a soi; E for a cut
  btsGates: true,         // Asok and Phrom Phong ticket gates + Rabbit machines; hop is 1★
  soiWires: true,         // tangled cables between soi PA poles; sparks in the rain
  rainFrogs: true,        // frogs hop flooded sois while it rains
  soiCctv: true,          // soi pole cameras; a shot in view is a ping and 1★
  rotiCart: true,         // banana roti cart on a soi; E for a fold
  rainPoncho: true,       // plastic rain capes on motorbike riders when it pours
  bikeSeatCover: true,    // plastic seat covers on parked 7-Eleven bikes in the rain
  watBell: true,          // temple bell at the wat; E rings it and cools last-seen
  stallIncense: true,     // mosquito coils hang under stall parasols; glow after dusk
  mangoSticky: true,      // khao niao mamuang carts at Asok and Phrom Phong BTS; evening, E for a plate
  watBats: true,          // flying foxes circle the wat after dusk
  yaoPhotos: true,        // tourists stop to snap Yaowarat after 18:00
  kanomKrok: true,        // coconut pancake pan outside 7-Eleven; afternoon, E for a bag
  squidGrill: true,       // grilled-squid cart on Yaowarat after dark; E for a stick
  songthaewRiders: true,  // passengers sit the BTS songthaew bench; hop off when you take it
  watSweep: true,         // monks sweep the wat courtyard at dawn
  yaoGold: true,          // gold-shop window on Yaowarat; shoppers after dark
  sevenAtm: true,         // a short queue at the walk-in 7-Eleven ATM
  btsBusker: true,        // guitar buskers at the Asok and Phrom Phong BTS exits; E tips ฿20
  watRobes: true,         // saffron robes dry on a line in the wat courtyard
  btsPigeons: true,       // pigeons loaf the Asok platform by day and scatter
  watLotus: true,         // lotus stall at the wat; E buys a bloom, shrine offering cools extra
  watCats: true,          // temple cats loaf the wat courtyard and bolt when you get close
  sevenShoppers: true,    // people walk in and out of the walk-in 7-Eleven
  watFeed: true,          // pellet tin at the wat pond; E feeds the turtles
  btsPaper: true,         // newspaper racks at Asok and Phrom Phong BTS; morning papers, E for a copy
  yaoDuck: true,          // roast-duck window on Yaowarat; hanging birds after dark, E for a plate
  sevenSlush: true,       // slushie machine inside the walk-in 7-Eleven; tanks spin, E for a cup
  phromFruit: true,       // fruit smoothie cart at Phrom Phong BTS; blender spins, E for a cup
  pierWait: true,         // ferry passengers wait on the pier; E for a ฿15 express-boat ticket
  btsShine: true,         // shoe-shine boxes north of Asok and Phrom Phong BTS; E for a polish
  watAmulet: true,        // amulet board at the wat; E buys one, shrine offering cools extra
  yaoFortune: true,       // fortune teller on Yaowarat after dark; E for a reading that cools last-seen
  watDrum: true,          // temple drum opposite the bell; E beats it and cools last-seen
  mallGuard: true,        // plastic-chair security at the Terminal 21 entrance; torch after dark
  bankGuard: true,        // plastic-chair security at Krung Thep Bank; torch after dark
  mallDir: true,          // directory clerk at the Terminal 21 desk; E names a shop and floor
  officeSmoke: true,      // office smokers on the north-west Asok and Phrom Phong sidewalks at lunch; ember tips
  bankQueue: true,        // two customers wait at the Krung Thep Bank teller with a passbook; they hide after hours
  mallFood: true,         // eaters sit Pier 21 Food Court at Terminal 21; trays, they hide after 21:00
  gunClerk: true,         // clerk behind the Sukhumvit Gun Shop counter; they hide after hours
  mallTech: true,         // window shoppers at Tokyo Tech in Terminal 21; phones, they hide after 21:00
  mallPharm: true,        // pharmacist and a customer at Paris Pharmacy in Terminal 21; they hide after 21:00
  mallRoma: true,         // clerk and a customer at Roma Boutique in Terminal 21; they hide after 21:00
  mallWatch: true,        // clerk and a customer at Watch Boutique on Terminal 21 floor 2; they hide after 21:00
  mallManga: true,        // readers sit Manga Café on Terminal 21 floor 1; they hide after 21:00
  mallSushi: true,        // chef and a customer at Sushi Bar on Terminal 21 floor 1; they hide after 21:00
  mallCafe: true,         // barista and a customer at Le Café on Terminal 21 floor 2; they hide after 21:00
  mallThreads: true,      // clerk and a customer at London Threads on Terminal 21 floor 2; they hide after 21:00
  mallSeven: true,        // clerk and a customer at the Terminal 21 7-Eleven; they hide after 21:00
  mallArcade: true,       // two players at Akihabara Arcade cabinets on Terminal 21 floor 1; they hide after 21:00
  gymBag: true,           // a pad man hits the heavy bag at the Muay Thai gym; they hide after 21:00
  starterClerk: true,     // clerk behind the Hua Lamphong starter gun counter; they hide after 21:00
  homeAuntie: true,       // neighbor sits a plastic chair beside the safehouse door; they hide after 22:00
  stationPorter: true,    // red-vest porters with bags under the Hua Lamphong canopy; they hide after 22:00
  garageMech: true,       // mechanic at the U-Spray bay mouth; they hide after 19:00
  klongDock: true,        // dockhands at the Klong Toey container yard; they hide after 19:00
  sengClerk: true,        // clerk at Uncle Seng's gold-shop door; they hide after 20:00
  airportCrew: true,      // marshallers on the Suvarnabhumi apron; they hide after 21:00
  airportCargo: true,     // cargo hands at the south Suvarnabhumi shed; they hide after 19:00
  airportTower: true,     // controller at the Suvarnabhumi tower base; they hide after 22:00
  airportTaxi: true,      // taxi touts at the north Suvarnabhumi curb; they hide after 22:00
};
G.gameplay = GAMEPLAY;

export function indexBuilding(world, b) {
  if (!world.buildingCells) world.buildingCells = new Map();
  const i0 = Math.floor((b.pos.x - b.size.x / 2) / BLOCK);
  const i1 = Math.floor((b.pos.x + b.size.x / 2) / BLOCK);
  const j0 = Math.floor((b.pos.z - b.size.z / 2) / BLOCK);
  const j1 = Math.floor((b.pos.z + b.size.z / 2) / BLOCK);
  for (let i = i0; i <= i1; i++) {
    for (let j = j0; j <= j1; j++) {
      const k = i + ',' + j;
      let list = world.buildingCells.get(k);
      if (!list) { list = []; world.buildingCells.set(k, list); }
      list.push(b);
    }
  }
}

export function buildingsNear(x, z) {
  const cells = G.world && G.world.buildingCells;
  if (!cells) return (G.world && G.world.buildings) || [];
  const i = Math.round(x / BLOCK), j = Math.round(z / BLOCK);
  const out = [], seen = new Set();
  for (let di = -1; di <= 1; di++) {
    for (let dj = -1; dj <= 1; dj++) {
      const list = cells.get((i + di) + ',' + (j + dj));
      if (!list) continue;
      for (const b of list) {
        if (seen.has(b)) continue;
        seen.add(b);
        out.push(b);
      }
    }
  }
  return out;
}

export const TRAFFIC_CURVE = [
  [0, 0.28], [2, 0.18], [5, 0.22], [7, 0.70], [8.5, 1.0], [11, 0.75],
  [14, 0.70], [16, 0.85], [18.5, 1.0], [21, 0.80], [23, 0.45], [24, 0.28],
];
export function trafficFactor(dayT) {
  const h = ((dayT % 1) + 1) % 1 * 24;
  for (let i = 0; i < TRAFFIC_CURVE.length - 1; i++) {
    const a = TRAFFIC_CURVE[i], b = TRAFFIC_CURVE[i + 1];
    if (h >= a[0] && h <= b[0]) return lerp(a[1], b[1], (h - a[0]) / (b[0] - a[0]));
  }
  return TRAFFIC_CURVE[0][1];
}
export function trafficTarget() {
  if (!GAMEPLAY.trafficDensity) return TRAFFIC_TARGET;
  return Math.max(6, Math.round(TRAFFIC_TARGET * trafficFactor(G.time.dayT)));
}

export function inYaowarat(x, z) {
  const p = G.world && G.world.poi && G.world.poi.yaowarat;
  if (!p) return false;
  const dx = x - p.x, dz = z - p.z;
  return dx * dx + dz * dz < 62 * 62;
}
export function inWat(x, z) {
  const p = G.world && G.world.poi && G.world.poi.temple;
  if (!p) return false;
  const dx = x - p.x, dz = z - p.z;
  return dx * dx + dz * dz < 40 * 40;
}
export function inFlood(x, z) {
  const floods = G.world && G.world.flood;
  if (!floods) return false;
  for (const f of floods) {
    if (x >= f.x0 && x <= f.x1 && z >= f.z0 && z <= f.z1) return true;
  }
  return false;
}
export function onSoi(x, z) {
  const sois = G.world && G.world.sois;
  if (!sois) return false;
  for (const s of sois) {
    if (x >= s.x0 && x <= s.x1 && z >= s.z0 && z <= s.z1) return true;
  }
  return false;
}
export function inAirport(x, z) {
  if (!GAMEPLAY.airport) return false;
  const b = G.world && G.world.airport;
  if (b) return x >= b.x0 && x <= b.x1 && z >= b.z0 && z <= b.z1;
  return x >= 200 && x <= 248 && z >= -220 && z <= 220;
}
export function inRiver(x) {
  return x < -206;
}
export function hourOfDay() {
  return ((G.time.dayT % 1) + 1) % 1 * 24;
}
export function yaowaratNightOpen() {
  if (!GAMEPLAY.yaowaratNight) return false;
  const h = hourOfDay();
  return h >= 18 || h < 2;
}
export function onCarriageway(x, z) {
  // Roads are authored on the grid lines (x = i*BLOCK, z = j*BLOCK). Measure
  // distance to the nearest line, wrapping the JS negative-mod case.
  const rx = ((x % BLOCK) + BLOCK) % BLOCK;
  const rz = ((z % BLOCK) + BLOCK) % BLOCK;
  const dx = Math.min(rx, BLOCK - rx);
  const dz = Math.min(rz, BLOCK - rz);
  return dx < ROAD_WIDTH / 2 + 0.35 || dz < ROAD_WIDTH / 2 + 0.35 || onSoi(x, z) || inAirport(x, z);
}

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

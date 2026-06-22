// Physics probe: boots the real game headless and asserts the on-foot collision
// + Songkran water-throw fixes:
//   1. Player vs vehicles — you get pushed out of a car instead of through it.
//   2. Player vs shop landmarks — the gold shop is now solid (not walk-through).
//   3. Songkran F-throw — water shoves + startles the peds it lands on.
//
// Run:  CHROME_PATH=/path/to/chrome node tools/physics_test.mjs
// (same SwiftShader / save-slot-boot caveats as tools/smoke.mjs).

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.env.PHYS_TEST_PORT || 8807);
const MIME = {
  '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript',
  '.json': 'application/json', '.css': 'text/css', '.png': 'image/png', '.md': 'text/plain',
};

function serve() {
  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      const urlPath = decodeURIComponent(new URL(req.url, 'http://x').pathname);
      const file = path.normalize(path.join(ROOT, urlPath === '/' ? 'index.html' : urlPath));
      if (!file.startsWith(ROOT)) { res.writeHead(403); res.end(); return; }
      fs.readFile(file, (err, data) => {
        if (err) { res.writeHead(404); res.end('not found'); return; }
        res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
        res.end(data);
      });
    });
    server.on('error', reject);
    server.listen(PORT, '127.0.0.1', () => resolve(server));
  });
}

const waitFrames = (page, n) => page.evaluate(
  n => new Promise(done => { let i = 0; const tick = () => (++i >= n ? done() : requestAnimationFrame(tick)); requestAnimationFrame(tick); }),
  n,
);

async function main() {
  const server = await serve();
  const errors = [];
  const assert = (cond, msg) => { if (!cond) errors.push(msg); else console.log(`  ok: ${msg}`); };

  const browser = await chromium.launch({
    executablePath: process.env.CHROME_PATH || undefined,
    args: ['--no-sandbox', '--enable-unsafe-swiftshader', '--use-angle=swiftshader'],
  });
  try {
    // State-only probe (no screenshots) → render at low res so each SwiftShader
    // frame is ~4× cheaper, which is what dominates waitFrames runtime.
    const page = await browser.newPage({ viewport: { width: 640, height: 360 } });
    page.on('pageerror', err => errors.push(`pageerror: ${err.message}`));
    page.on('console', msg => { if (msg.type() === 'error') errors.push(`console.error: ${msg.text()}`); });

    console.log(`serving ${ROOT} on :${PORT}, booting game…`);
    await page.goto(`http://127.0.0.1:${PORT}/`, { waitUntil: 'domcontentloaded', timeout: 60_000 });
    await page.click('#slots button', { timeout: 180_000 });
    await page.waitForFunction(
      () => window.GAME && (window.GAME.state === 'playing' || window.GAME.state === 'paused'),
      null, { timeout: 180_000 },
    );
    console.log('game started');

    // ---- 1. Player vs vehicle -------------------------------------------------
    console.log('\n[1] player vs vehicle');
    const car = await page.evaluate(() => {
      const GAME = window.GAME;
      GAME.state = 'playing'; document.getElementById('pause').classList.remove('show');
      GAME.player.inVehicle = null; GAME.player.group.visible = true;
      const v = GAME.vehicles.find(v => v.boundsHalf && !v.dead);
      v.pos.set(0, 0, -130); if (v.group) v.group.position.set(0, 0, -130);
      v.heading = 0; v.vel = 0;
      GAME.player.group.position.set(0, 0, -130);   // overlap the car dead-centre
      GAME.player.velocity.set(0, 0, 0);
      return { hx: v.boundsHalf.x + 0.42, hz: v.boundsHalf.z + 0.42, idx: GAME.vehicles.indexOf(v) };
    });
    await waitFrames(page, 4);
    const carPen = await page.evaluate(i => {
      const GAME = window.GAME, v = GAME.vehicles[i], p = GAME.player.group.position;
      const c = Math.cos(v.heading), s = Math.sin(v.heading);
      const wx = p.x - v.pos.x, wz = p.z - v.pos.z;
      const lx = c * wx - s * wz, lz = s * wx + c * wz;
      return { lx, lz };
    }, car.idx);
    const carInside = Math.min(car.hx - Math.abs(carPen.lx), car.hz - Math.abs(carPen.lz));
    assert(carInside <= 0.2, `player is pushed out of the car (surface gap ${carInside.toFixed(2)} m, not deep inside)`);

    // ---- 2. Player vs shop landmark (gold shop) ------------------------------
    console.log('\n[2] player vs gold-shop landmark');
    await page.evaluate(() => {
      const GAME = window.GAME;
      GAME.state = 'playing';
      const g = GAME.world.poi.goldShop;
      GAME.player.group.position.set(g.x, 0, g.z);   // stand inside the shop footprint
      GAME.player.velocity.set(0, 0, 0);
    });
    await waitFrames(page, 4);
    const shopPen = await page.evaluate(() => {
      const GAME = window.GAME, g = GAME.world.poi.goldShop, p = GAME.player.group.position;
      const hx = 6 + 0.42, hz = 4 + 0.42;            // 12x8 box + player radius
      return Math.min(hx - Math.abs(p.x - g.x), hz - Math.abs(p.z - g.z));
    });
    assert(shopPen <= 0.2, `player is pushed out of the gold shop (surface gap ${shopPen.toFixed(2)} m)`);

    // ---- 3. Songkran water-throw physics -------------------------------------
    console.log('\n[3] Songkran F-throw shoves peds');
    await page.evaluate(() => {
      const GAME = window.GAME;
      GAME.state = 'playing'; document.getElementById('pause').classList.remove('show');
      GAME.time.day = 0; GAME.time.dayT = 0.5;        // schedule-driven Songkran (midday, day%4==0)
      GAME.player.inVehicle = null; GAME.player.group.visible = true;
      GAME.player.group.position.set(0, 0, -130);
      GAME.player.yaw = 0;                            // forward = (-sin,-cos) = (0,-1) → -z
    });
    await waitFrames(page, 6);                        // let the festival start
    const before = await page.evaluate(() => {
      const GAME = window.GAME;
      // put a stationary test ped 3 m in front of the player (beyond melee reach)
      const ped = GAME.peds.find(p => !p.dead) || GAME.peds[0];
      ped.mesh.position.set(0, 0, -133);
      ped.speed = 0; ped.state = 'idle'; ped.panicT = 0; ped.knockX = 0; ped.knockZ = 0;
      ped._id = 'wtest';
      const pp = GAME.player.group.position;
      return { type: GAME.festival.type, dist: Math.hypot(0 - pp.x, -133 - pp.z) };
    });
    assert(before.type === 'songkran', `Songkran festival is active (got "${before.type}")`);
    // throw water: hold F across a couple frames so the edge-triggered press lands
    await page.keyboard.down('KeyF');
    await waitFrames(page, 3);
    await page.keyboard.up('KeyF');
    await waitFrames(page, 4);
    const after = await page.evaluate(() => {
      const GAME = window.GAME, pp = GAME.player.group.position;
      const ped = GAME.peds.find(p => p._id === 'wtest');
      if (!ped) return null;
      return { dist: Math.hypot(ped.mesh.position.x - pp.x, ped.mesh.position.z - pp.z), panicT: ped.panicT };
    });
    assert(after, 'test ped still present after the throw');
    if (after) {
      assert(after.dist > before.dist + 0.3, `water throw pushed the ped away (${before.dist.toFixed(2)} → ${after.dist.toFixed(2)} m)`);
      assert(after.panicT > 0, `water throw startled the ped (panicT ${after.panicT.toFixed(2)})`);
    }

    // ---- 4. BTS Skytrain platform is walk-up ---------------------------------
    console.log('\n[4] BTS walk-up platform');
    const bts = await page.evaluate(() => window.GAME.world.bts);
    assert(bts && bts.platformY > 10, `BTS platform is registered (y=${bts && bts.platformY})`);
    // stand on the escalator halfway up
    await page.evaluate(b => {
      const GAME = window.GAME;
      GAME.state = 'playing'; document.getElementById('pause').classList.remove('show');
      GAME.player.inVehicle = null; GAME.player.velocity.set(0, 0, 0);
      GAME.player.group.position.set(b.x, 7, -15);          // BTS escalator mid-point
    }, bts);
    await waitFrames(page, 3);
    const escY = await page.evaluate(() => window.GAME.player.group.position.y);
    assert(escY > 5 && escY < 9, `BTS escalator is solid underfoot (y=${escY.toFixed(2)})`);
    // stand on the platform
    await page.evaluate(b => {
      const GAME = window.GAME;
      GAME.player.velocity.set(0, 0, 0);
      GAME.player.group.position.set(b.x, b.platformY + 0.3, 0);
    }, bts);
    await waitFrames(page, 3);
    const platY = await page.evaluate(() => window.GAME.player.group.position.y);
    assert(Math.abs(platY - bts.platformY) < 0.25, `BTS platform is solid — you stand at y≈${bts.platformY} (got ${platY.toFixed(2)})`);
    // walk up the escalator from the street and gain height
    const bUp0 = await page.evaluate(b => {
      const GAME = window.GAME;
      GAME.player.inVehicle = null; GAME.player.velocity.set(0, 0, 0);
      GAME.player.group.position.set(b.x, 0, -25);          // escalator foot
      GAME.camRig.yaw = Math.PI;                            // face up the ramp (+z)
      return GAME.player.group.position.y;
    }, bts);
    await page.keyboard.down('KeyW'); await waitFrames(page, 95); await page.keyboard.up('KeyW'); await waitFrames(page, 3);
    const bUp1 = await page.evaluate(() => window.GAME.player.group.position.y);
    assert(bUp1 > bUp0 + 4, `walking up the BTS escalator raises you (y ${bUp0.toFixed(1)} → ${bUp1.toFixed(1)})`);

    // ---- 5. Police helicopter at 4 stars -------------------------------------
    console.log('\n[5] police helicopter (4★)');
    await page.evaluate(() => {
      const G = window.GAME;
      G.state = 'playing'; document.getElementById('pause').classList.remove('show');
      G.player.inVehicle = null; G._inMall = false; G.player.group.position.set(0, 0, 0);
      G.wanted.stars = 4; G.wanted.lastSeenAt = performance.now();
    });
    await waitFrames(page, 8);
    const heli = await page.evaluate(() => {
      const G = window.GAME, p = G.player.group.position;
      return G.heli ? { y: G.heli.mesh.position.y, gap: Math.hypot(G.heli.mesh.position.x - p.x, G.heli.mesh.position.z - p.z) } : null;
    });
    assert(heli && heli.y > 30, `a helicopter spawns at 4★ and flies overhead (y=${heli && heli.y.toFixed(0)})`);
    assert(heli && heli.gap < 20, `the searchlight is over the player (gap ${heli && heli.gap.toFixed(0)} m)`);
    // it chases: move the player, the heli closes in
    await page.evaluate(() => window.GAME.player.group.position.set(80, 0, 80));
    await waitFrames(page, 36);
    const follow = await page.evaluate(() => { const h = window.GAME.heli, p = window.GAME.player.group.position; return h ? Math.hypot(h.mesh.position.x - p.x, h.mesh.position.z - p.z) : 999; });
    assert(follow < 30, `the helicopter chases the player (gap ${follow.toFixed(0)} m)`);
    // clear the heat → it leaves
    await page.evaluate(() => { window.GAME.wanted.stars = 0; });
    await waitFrames(page, 5);
    const gone = await page.evaluate(() => !window.GAME.heli);
    assert(gone, 'the helicopter leaves when the heat is gone');

    // ---- 6. Walk-in 7-Eleven -------------------------------------------------
    console.log('\n[6] walk-in 7-Eleven');
    const e = await page.evaluate(() => {
      const G = window.GAME, s = G.world.sevenElevens[0];
      G.state = 'playing'; document.getElementById('store').classList.remove('show');
      G.wanted.stars = 0; G.player.inVehicle = null; G.player.group.visible = true;
      G.player.group.position.set(s.pos.x, 0, s.pos.z + 6.5);   // just outside the front door
      G.player.velocity.set(0, 0, 0); G.camRig.yaw = 0;         // forward = -z, into the store
      return { x: s.pos.x, z: s.pos.z };
    });
    // Poll until inside: distance walked per frame-count varies with SwiftShader
    // frame timing, so step and check rather than assume a fixed walk distance.
    await page.keyboard.down('KeyW');
    let ins = null;
    for (let k = 0; k < 16 && !(ins && ins.in); k++) {
      await waitFrames(page, 8);
      ins = await page.evaluate(e => { const p = window.GAME.player.group.position; return { x: p.x, z: p.z, in: Math.abs(p.x - e.x) < 4.5 && p.z < e.z + 3.5 && p.z > e.z - 4 }; }, e);
    }
    await page.keyboard.up('KeyW'); await waitFrames(page, 3);
    assert(ins && ins.in, `you walk in through the 7-Eleven door (now at z ${ins && ins.z.toFixed(1)}, front was ${(e.z + 4).toFixed(1)})`);
    await page.keyboard.down('KeyE'); await waitFrames(page, 3); await page.keyboard.up('KeyE'); await waitFrames(page, 3);
    const shop = await page.evaluate(() => ({ state: window.GAME.state, title: document.querySelector('#store h3').textContent }));
    assert(shop.state === 'store' && /7-ELEVEN/.test(shop.title), 'the shop opens from inside the 7-Eleven');

    // ---- 7. Getaway Driver capstone mission ----------------------------------
    console.log('\n[7] Getaway Driver capstone');
    const gw = await page.evaluate(() => {
      const G = window.GAME;
      G.state = 'playing'; document.getElementById('store').classList.remove('show');
      G.wanted.stars = 0; G.mission.start('getaway');
      const m = G.mission.active;
      return { name: m.name, stage: m.stage, mx: m.markerPos.x, mz: m.markerPos.z, px: m.pickup.x, pz: m.pickup.z, drops: m.drops.map(d => ({ x: d.x, z: d.z })) };
    });
    assert(gw.name === 'Getaway Driver' && gw.stage === 1, 'the Mall Job unlocks the Getaway Driver capstone');
    assert(Math.hypot(gw.mx - gw.px, gw.mz - gw.pz) < 1, 'it points at the green pickup');
    // arrive by car → crew aboard, heat maxed (helicopter)
    await page.evaluate(g => {
      const G = window.GAME;
      const car = G.vehicles.find(v => v.spec && !v.dead) || G.vehicles[0];
      car.pos.set(g.px, 0, g.pz); if (car.group) car.group.position.copy(car.pos);
      car.driver = 'player'; car.npc = null; G.player.inVehicle = car;
      G.player.group.position.set(g.px, 0, g.pz);
    }, gw);
    await waitFrames(page, 6);
    const aboard = await page.evaluate(() => ({ stage: window.GAME.mission.active.stage, stars: window.GAME.wanted.stars }));
    assert(aboard.stage === 2 && aboard.stars >= 4, `crew aboard maxes the heat (stage ${aboard.stage}, ${aboard.stars}★)`);
    const gwCash0 = await page.evaluate(() => window.GAME.cash);
    for (let i = 0; i < gw.drops.length; i++) {
      await page.evaluate(d => {
        const G = window.GAME;
        G.player.group.position.set(d.x, 0, d.z);
        if (G.player.inVehicle) { G.player.inVehicle.pos.set(d.x, 0, d.z); if (G.player.inVehicle.group) G.player.inVehicle.group.position.copy(G.player.inVehicle.pos); }
      }, gw.drops[i]);
      await waitFrames(page, 5);
    }
    const gwDone = await page.evaluate(() => ({ stage: window.GAME.mission.active.stage, done: !!window.GAME._getawayDone, cash: window.GAME.cash }));
    assert(gwDone.done && gwDone.stage === 5, `hitting all drops completes the Getaway (stage ${gwDone.stage})`);
    assert(gwDone.cash > gwCash0, `the Getaway pays out (+฿${gwDone.cash - gwCash0})`);
    // completion % now tracks the full 6-job chain (not just the first 3)
    const comp = await page.evaluate(() => {
      const G = window.GAME; G.collected = 0;
      G._welcomeDone = G._soiRunWon = G._hitDone = true;
      G._deliveryDone = G._mallJobDone = G._getawayDone = false;
      G.hud.setPhoneStats(); const half = document.getElementById('ph-complete').textContent;
      G._deliveryDone = G._mallJobDone = G._getawayDone = true;
      G.hud.setPhoneStats(); const full = document.getElementById('ph-complete').textContent;
      return { half, full };
    });
    assert(comp.half === '15%' && comp.full === '30%', `completion tracks all 6 chain milestones (3 jobs ${comp.half} → 6 jobs ${comp.full})`);

    // ---- 8. Garage vehicle upgrades ------------------------------------------
    console.log('\n[8] garage vehicle upgrades');
    const setup = await page.evaluate(() => {
      const G = window.GAME;
      G.state = 'playing'; document.getElementById('garageup').classList.remove('show');
      G.wanted.stars = 0; G.econ.garage.rented = true; G.econ.upgrades = { engine: 0, nitro: 0, armor: 0 };
      G.cash = 50000; G.hud.setCash(50000);
      const car = G.vehicles.find(v => v.spec && !v.dead && !v.isCop) || G.vehicles[0];
      const g = G.world.garages[0];
      car.pos.set(g.pos.x, 0, g.pos.z); if (car.group) car.group.position.copy(car.pos);
      car.hp = 100; car.driver = 'player'; car.npc = null; G.player.inVehicle = car;
      G.player.group.position.set(g.pos.x, 0, g.pos.z);
      return { baseTop: car.spec.topSpeed };
    });
    await page.keyboard.down('KeyU'); await waitFrames(page, 3); await page.keyboard.up('KeyU'); await waitFrames(page, 3);
    const opened = await page.evaluate(() => ({ shown: document.getElementById('garageup').classList.contains('show'), n: document.querySelectorAll('#garageup-items button').length, state: window.GAME.state }));
    assert(opened.shown && opened.n === 3 && opened.state === 'store', 'U at the garage opens the upgrades menu (3 categories)');
    await page.click('#garageup-items button');   // first button = Engine
    await waitFrames(page, 2);
    const eng = await page.evaluate(() => ({ lvl: window.GAME.econ.upgrades.engine, cash: window.GAME.cash, top: window.GAME.player.inVehicle.spec.topSpeed }));
    assert(eng.lvl === 1 && eng.cash === 46000, `buying Engine costs ฿4,000 and levels up (lv ${eng.lvl}, cash ${eng.cash})`);
    assert(eng.top > setup.baseTop, `the Engine upgrade raises top speed (${setup.baseTop.toFixed(1)} → ${eng.top.toFixed(1)})`);
    await page.evaluate(() => document.querySelectorAll('#garageup-items button')[2].click());   // Armor
    await waitFrames(page, 2);
    const arm = await page.evaluate(() => ({ lvl: window.GAME.econ.upgrades.armor, mul: window.GAME.player.inVehicle.spec.armorMul }));
    assert(arm.lvl === 1 && arm.mul < 1, `the Armor upgrade softens crashes (armorMul ${arm.mul})`);
    // rank perk: upgrades get cheaper at higher wealth rank
    await page.evaluate(() => { window.GAME._wealthRank = 4; window.GAME.cash = 50000; window.GAME.hud.setCash(50000); });   // Tycoon → 30% off
    const cashPreNitro = await page.evaluate(() => window.GAME.cash);
    await page.evaluate(() => document.querySelectorAll('#garageup-items button')[1].click());   // Nitro (base ฿3,500)
    await waitFrames(page, 2);
    const nitro = await page.evaluate(() => ({ lvl: window.GAME.econ.upgrades.nitro, cash: window.GAME.cash }));
    const spentNitro = cashPreNitro - nitro.cash;
    assert(nitro.lvl === 1 && spentNitro > 2300 && spentNitro < 2600, `wealth rank discounts upgrades (Nitro ฿3,500 → ฿${spentNitro.toFixed(0)})`);
    await page.click('#garageup-leave'); await waitFrames(page, 3);
    const left = await page.evaluate(() => window.GAME.state);
    assert(left === 'playing', 'leaving the upgrades menu returns to the game');

    // ---- 9. River + boats ----------------------------------------------------
    console.log('\n[9] river + boats');
    const boatInfo = await page.evaluate(() => {
      const G = window.GAME;
      G.state = 'playing'; document.getElementById('garageup').classList.remove('show');
      G.player.inVehicle = null; G.wanted.stars = 0; G.econ.upgrades = { engine: 0, nitro: 0, armor: 0 };
      const boats = G.vehicles.filter(v => v.spec && v.spec.kind === 'boat');
      const b = boats[0];
      G.player.group.position.set(b.pos.x + 1.5, 0.3, b.pos.z + 1.5);   // alongside the pier boat
      return { pier: !!(G.world.poi && G.world.poi.pier), nBoats: boats.length, bz: b.pos.z };
    });
    assert(boatInfo.pier && boatInfo.nBoats >= 3, `the river has a pier POI + a boat fleet (${boatInfo.nBoats} boats)`);
    await page.keyboard.down('KeyE'); await waitFrames(page, 3); await page.keyboard.up('KeyE'); await waitFrames(page, 3);
    const inBoat = await page.evaluate(() => ({ inV: !!window.GAME.player.inVehicle, kind: window.GAME.player.inVehicle && window.GAME.player.inVehicle.spec.kind }));
    assert(inBoat.inV && inBoat.kind === 'boat', 'you can board the boat (E)');
    const boatBefore = await page.evaluate(() => ({ x: window.GAME.player.inVehicle.pos.x, z: window.GAME.player.inVehicle.pos.z }));
    await page.keyboard.down('KeyW');
    let boatAfter = boatBefore;
    for (let k = 0; k < 14 && Math.hypot(boatAfter.x - boatBefore.x, boatAfter.z - boatBefore.z) < 3; k++) {
      await waitFrames(page, 8);
      boatAfter = await page.evaluate(() => ({ x: window.GAME.player.inVehicle.pos.x, z: window.GAME.player.inVehicle.pos.z }));
    }
    await page.keyboard.up('KeyW'); await waitFrames(page, 3);
    const moved = Math.hypot(boatAfter.x - boatBefore.x, boatAfter.z - boatBefore.z);
    assert(moved > 3, `the boat drives on the river (moved ${moved.toFixed(1)} m)`);
    assert(boatAfter.x >= -248 && boatAfter.x <= -210 && boatAfter.z >= -246 && boatAfter.z <= 246, `the boat stays in the channel (x ${boatAfter.x.toFixed(0)}, z ${boatAfter.z.toFixed(0)})`);

    // ---- 10. Bank heist ------------------------------------------------------
    console.log('\n[10] bank heist');
    const bankInfo = await page.evaluate(() => {
      const G = window.GAME;
      G.state = 'playing'; G.player.inVehicle = null; G.wanted.stars = 0;
      G.heist.active = false; G.heist.stage = 0; G.heist.cooldownUntil = 0;
      const v = G.world.bank.vault;
      G.player.group.position.set(v.x, 0, v.z); G.player.velocity.set(0, 0, 0);
      return { hasVault: !!(G.world.bank && G.world.bank.vault), hasPoi: !!(G.world.poi && G.world.poi.bank) };
    });
    assert(bankInfo.hasVault && bankInfo.hasPoi, 'the bank has a vault + a map POI');
    await page.keyboard.down('KeyE'); await waitFrames(page, 3); await page.keyboard.up('KeyE'); await waitFrames(page, 3);
    const cracking = await page.evaluate(() => ({ active: window.GAME.heist.active, stage: window.GAME.heist.stage }));
    assert(cracking.active && cracking.stage === 1, 'E at the vault starts the heist (cracking)');
    await page.evaluate(() => { window.GAME.heist.crackT = 0.2; });   // shortcut the drill timer
    await waitFrames(page, 8);
    const alarm = await page.evaluate(() => ({ stage: window.GAME.heist.stage, stars: window.GAME.wanted.stars }));
    assert(alarm.stage === 2 && alarm.stars >= 5, `cracking the vault trips a max-heat alarm (stage ${alarm.stage}, ${alarm.stars}★)`);
    const flashed = await page.evaluate(() => document.getElementById('screen-flash').classList.contains('on'));
    assert(flashed, 'the vault alarm flashes the screen red');
    const heistCash0 = await page.evaluate(() => { const d = window.GAME.heist.markerPos; window.GAME.player.group.position.set(d.x, 0, d.z); return window.GAME.cash; });
    await waitFrames(page, 5);
    const heistDone = await page.evaluate(() => ({ active: window.GAME.heist.active, cash: window.GAME.cash, cd: window.GAME.heist.cooldownUntil > 0 }));
    assert(!heistDone.active && heistDone.cash > heistCash0, `delivering the loot pays out (+฿${heistDone.cash - heistCash0})`);
    assert(heistDone.cd, 'the vault goes on cooldown after a heist');

    // ---- 11. Gang turf takeover ----------------------------------------------
    console.log('\n[11] gang turf takeover');
    await page.evaluate(() => {
      const G = window.GAME;
      G.state = 'playing'; G.player.inVehicle = null; G.wanted.stars = 0;
      G.turfs = {}; G._turfRetal = 100;
      G.player.hp = G.player.hpMax; G.player.armor = 100;   // survive the fight during the test
      G.player.group.position.set(-150, 0, 150);   // Khlong Toei turf centre
      G.cash = 1000; G.hud.setCash(1000);
    });
    await waitFrames(page, 5);
    const gang = await page.evaluate(() => ({
      n: window.GAME.peds.filter(p => p.gang && p.turfId === 'khlong' && !p.dead).length,
      owned: !!(window.GAME.turfs.khlong && window.GAME.turfs.khlong.owned),
    }));
    assert(gang.n >= 3 && gang.n <= 5 && !gang.owned, `entering a turf spawns a hostile gang (${gang.n} members)`);
    await page.evaluate(() => window.GAME.peds.forEach(p => { if (p.gang && p.turfId === 'khlong') p.dead = true; }));   // wipe them (as combat would)
    await waitFrames(page, 3);
    const claimed = await page.evaluate(() => ({ owned: !!(window.GAME.turfs.khlong && window.GAME.turfs.khlong.owned), cash: window.GAME.cash }));
    assert(claimed.owned && claimed.cash > 1000, `clearing the gang claims the turf (+฿${claimed.cash - 1000} bonus)`);
    const c1 = await page.evaluate(() => window.GAME.cash);
    await waitFrames(page, 22);
    const c2 = await page.evaluate(() => window.GAME.cash);
    assert(c2 > c1, `held turf pays passive income (+฿${(c2 - c1).toFixed(0)})`);

    // ---- 12. Bank account (deposit / withdraw / interest) --------------------
    console.log('\n[12] bank account');
    await page.evaluate(() => {
      const G = window.GAME;
      G.state = 'playing'; G.player.inVehicle = null; G.heist.active = false; G.wanted.stars = 0;
      document.getElementById('bank').classList.remove('show');
      const t = G.world.bank.teller;
      G.player.group.position.set(t.x, 0, t.z); G.player.velocity.set(0, 0, 0);
      G.cash = 25000; G.hud.setCash(25000); G.econ.bank.balance = 0; G.econ.bank.lastDay = G.time.day;
    });
    await page.keyboard.down('KeyE'); await waitFrames(page, 3); await page.keyboard.up('KeyE'); await waitFrames(page, 3);
    const bankOpened = await page.evaluate(() => ({ shown: document.getElementById('bank').classList.contains('show'), state: window.GAME.state }));
    assert(bankOpened.shown && bankOpened.state === 'store', 'E at the teller opens the bank');
    await page.evaluate(() => { [...document.querySelectorAll('#bank-items button')].find(b => /Deposit.*10,000/.test(b.textContent)).click(); });
    await waitFrames(page, 2);
    const dep = await page.evaluate(() => ({ bal: window.GAME.econ.bank.balance, cash: window.GAME.cash }));
    assert(dep.bal === 10000 && Math.abs(dep.cash - 15000) < 10, `depositing moves cash into the balance (bal ฿${dep.bal}, cash ฿${dep.cash.toFixed(1)})`);   // cash ±trickle
    await page.evaluate(() => { [...document.querySelectorAll('#bank-items button')].find(b => /Withdraw all/.test(b.textContent)).click(); });
    await waitFrames(page, 2);
    const wd = await page.evaluate(() => ({ bal: window.GAME.econ.bank.balance, cash: window.GAME.cash }));
    assert(wd.bal === 0 && Math.abs(wd.cash - 25000) < 15, `withdraw-all returns it to cash (bal ฿${wd.bal}, cash ฿${wd.cash.toFixed(1)})`);
    await page.evaluate(() => document.getElementById('bank-leave').click());
    await waitFrames(page, 3);
    const bankLeft = await page.evaluate(() => window.GAME.state);
    assert(bankLeft === 'playing', 'leaving the bank returns to the game');
    // interest: a day elapses → the balance grows
    await page.evaluate(() => { const G = window.GAME; G.econ.bank.balance = 10000; G.econ.bank.lastDay = G.time.day; G.time.day += 1; });
    await waitFrames(page, 3);
    const interest = await page.evaluate(() => window.GAME.econ.bank.balance);
    assert(interest > 10000, `the balance earns daily interest (฿10,000 → ฿${interest})`);
    // interest is capped at the first ฿500k (no runaway compounding on huge balances)
    await page.evaluate(() => { const G = window.GAME; G.econ.bank.balance = 2000000; G.econ.bank.lastDay = G.time.day; G.time.day += 1; });
    await waitFrames(page, 3);
    const capped = await page.evaluate(() => window.GAME.econ.bank.balance);
    assert(Math.abs(capped - 2020000) < 50, `interest caps at ฿500k principal (฿2,000,000 +฿${capped - 2000000}, not +฿80,000)`);

    // property management at the bank: collect-all + hire a manager
    await page.evaluate(() => {
      const G = window.GAME;
      G.state = 'playing'; G.heist.active = false;
      G.econ.businesses.noodle = { owned: true, pending: 500, tier: 1, manager: false };
      G.econ.bank.balance = 0; G.cash = 20000; G.hud.setCash(20000);
      const t = G.world.bank.teller; G.player.group.position.set(t.x, 0, t.z);
    });
    await page.keyboard.down('KeyE'); await waitFrames(page, 3); await page.keyboard.up('KeyE'); await waitFrames(page, 3);
    await page.evaluate(() => { [...document.querySelectorAll('#bank-props button')].find(b => /Collect all/.test(b.textContent)).click(); });
    await waitFrames(page, 2);
    const coll = await page.evaluate(() => ({ pending: window.GAME.econ.businesses.noodle.pending, bal: window.GAME.econ.bank.balance }));
    assert(coll.pending < 1 && coll.bal >= 500, `collect-all sweeps property takings into the bank (bal ฿${coll.bal})`);
    await page.evaluate(() => { [...document.querySelectorAll('#bank-props button')].find(b => /Hire manager.*Noodle/.test(b.textContent)).click(); });
    await waitFrames(page, 2);
    const mgr = await page.evaluate(() => ({ manager: window.GAME.econ.businesses.noodle.manager, cash: window.GAME.cash }));
    assert(mgr.manager === true && mgr.cash < 20000, `you can hire a manager (cash ฿${mgr.cash})`);
    await page.evaluate(() => document.getElementById('bank-leave').click());
    await waitFrames(page, 3);
    const b0 = await page.evaluate(() => window.GAME.econ.bank.balance);
    await waitFrames(page, 22);
    const b1 = await page.evaluate(() => window.GAME.econ.bank.balance);
    assert(b1 > b0, `a managed property auto-banks its income (฿${b0.toFixed(0)} → ฿${b1.toFixed(0)})`);

    // selling/divesting: sell a property for cash; net worth drops → rank slips (two-way)
    await page.evaluate(() => {
      const G = window.GAME;
      G.state = 'playing'; G.heist.active = false;
      for (const id in G.econ.businesses) G.econ.businesses[id].owned = false;
      G.econ.businesses.condo = { owned: true, pending: 0, tier: 1, manager: false };   // a premium holding
      G.econ.bank.balance = 0; G.cash = 110000; G.hud.setCash(110000); G._wealthRank = 0;
      const t = G.world.bank.teller; G.player.group.position.set(t.x, 0, t.z);
    });
    await waitFrames(page, 3);
    const preRank = await page.evaluate(() => window.GAME._wealthRank);
    assert(preRank >= 2, `cash + a premium property lifts you to Boss rank (rank ${preRank})`);
    await page.keyboard.down('KeyE'); await waitFrames(page, 3); await page.keyboard.up('KeyE'); await waitFrames(page, 3);
    const hasSell = await page.evaluate(() => { const b = [...document.querySelectorAll('#bank-props button')].find(b => /Sell.*Condo/.test(b.textContent)); if (b) { b.click(); return true; } return false; });
    assert(hasSell, 'the bank offers a Sell button for an owned property');
    await waitFrames(page, 2);
    const sold = await page.evaluate(() => ({ owned: !!window.GAME.econ.businesses.condo.owned, cash: window.GAME.cash }));
    assert(!sold.owned && sold.cash > 110000, `selling divests it for cash (cash ฿${sold.cash.toFixed(0)})`);
    await page.evaluate(() => document.getElementById('bank-leave').click());
    await waitFrames(page, 5);
    const postRank = await page.evaluate(() => window.GAME._wealthRank);
    assert(postRank < preRank, `selling down drops your rank (${preRank} → ${postRank})`);

    // Kingpin perk: reaching rank 3 delivers a personal supercar
    await page.evaluate(() => {
      const G = window.GAME;
      G.state = 'playing'; G._wealthRank = 2; G._kingpinCar = false;
      for (const id in G.econ.businesses) G.econ.businesses[id].owned = false;
      G.econ.bank.balance = 0; G.cash = 650000; G.hud.setCash(650000);   // net worth → Kingpin (฿600k)
    });
    await waitFrames(page, 4);
    const kp = await page.evaluate(() => ({ rank: window.GAME._wealthRank, flag: !!window.GAME._kingpinCar, car: window.GAME.vehicles.some(v => v.plate === 'KINGPIN') }));
    assert(kp.rank >= 3 && kp.flag && kp.car, `reaching Kingpin delivers a personal supercar (rank ${kp.rank}, car ${kp.car})`);
  } catch (err) {
    errors.push(`harness: ${err.message}`);
  } finally {
    await browser.close();
    server.close();
  }

  if (errors.length) {
    console.error(`\nPHYSICS TEST FAILED (${errors.length} error${errors.length > 1 ? 's' : ''}):`);
    for (const e of errors) console.error(`  - ${e}`);
    process.exit(1);
  }
  console.log('\nphysics test passed');
}

main();

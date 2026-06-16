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
    const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
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

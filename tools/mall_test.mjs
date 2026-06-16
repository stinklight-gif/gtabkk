// Terminal 21 probe: boots the real game headless and asserts the mall works —
//   1. world.mall + world.poi.terminal21 exist with shop fronts.
//   2. The entrance is walkable: holding W from outside walks you into the atrium
//      (and sets the "inside the mall" flag) — i.e. the entrance gap is real.
//   3. A shop front browses: E at a shop opens the store overlay titled for that
//      shop, and buying spends cash + applies the effect.
//
// Run:  CHROME_PATH=/path/to/chrome node tools/mall_test.mjs
// (same SwiftShader / save-slot-boot caveats as tools/smoke.mjs).

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.env.MALL_TEST_PORT || 8815);
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

    // ---- 1. Mall data exists --------------------------------------------------
    console.log('\n[1] mall exists');
    const meta = await page.evaluate(() => {
      const GAME = window.GAME;
      return {
        hasPoi: !!(GAME.world.poi && GAME.world.poi.terminal21),
        shops: GAME.world.mall ? GAME.world.mall.shops.map(s => s.name) : null,
      };
    });
    assert(meta.hasPoi, 'world.poi.terminal21 is set');
    assert(meta.shops && meta.shops.length >= 3, `mall has shop fronts (${meta.shops && meta.shops.join(', ')})`);

    // ---- 2. Entrance is walkable ---------------------------------------------
    console.log('\n[2] walk in through the entrance');
    const start = await page.evaluate(() => {
      const GAME = window.GAME;
      GAME.state = 'playing'; document.getElementById('pause').classList.remove('show');
      GAME.player.inVehicle = null; GAME.player.group.visible = true;
      const e = GAME.world.poi.terminal21;             // just outside the entrance
      GAME.player.group.position.set(e.x, 0, e.z);
      GAME.player.velocity.set(0, 0, 0);
      GAME.camRig.yaw = Math.PI;                        // forward = +z (into the mall)
      GAME._inMall = false;
      return { z: GAME.player.group.position.z, centerZ: GAME.world.mall.center.z, hd: GAME.world.mall.hd };
    });
    await page.keyboard.down('KeyW');
    await waitFrames(page, 44);                         // hold W to stroll inside
    await page.keyboard.up('KeyW');
    await waitFrames(page, 3);
    const walked = await page.evaluate(() => ({ z: window.GAME.player.group.position.z, inMall: !!window.GAME._inMall }));
    const southWallZ = start.centerZ - start.hd;        // entrance line
    assert(walked.z > southWallZ + 2, `player walked through the entrance into the atrium (z ${start.z.toFixed(1)} → ${walked.z.toFixed(1)}, past ${southWallZ})`);
    assert(walked.inMall, 'inside-the-mall flag set after walking in');

    // ---- 2b. Escalators + upper floors are walkable ---------------------------
    console.log('\n[2b] escalators + floor support');
    // stand on escalator A's mid-point → the ramp surface holds you up
    await page.evaluate(() => {
      const GAME = window.GAME, c = GAME.world.mall.center;
      GAME.state = 'playing'; document.getElementById('pause').classList.remove('show');
      GAME.player.inVehicle = null; GAME.player.velocity.set(0, 0, 0);
      GAME.player.group.position.set(c.x - 4, 2.6, c.z + 1);   // escalator A surface, halfway up (ramp y≈2.5)
    });
    await waitFrames(page, 3);
    const onRamp = await page.evaluate(() => window.GAME.player.group.position.y);
    assert(onRamp > 2 && onRamp < 3, `the escalator is solid underfoot (stood at y=${onRamp.toFixed(2)})`);
    // stand on the floor-1 mezzanine → it's solid at y≈5
    await page.evaluate(() => {
      const GAME = window.GAME, c = GAME.world.mall.center;
      GAME.player.velocity.set(0, 0, 0);
      GAME.player.group.position.set(c.x, 5.2, c.z + 12);      // floor-1 north strip
    });
    await waitFrames(page, 3);
    const onF1 = await page.evaluate(() => window.GAME.player.group.position.y);
    assert(Math.abs(onF1 - 5) < 0.25, `floor 1 is solid — you stand at y≈5 (got ${onF1.toFixed(2)})`);
    // actually walk up escalator A and gain height (the reported bug)
    const climb0 = await page.evaluate(() => {
      const GAME = window.GAME, c = GAME.world.mall.center;
      GAME.player.inVehicle = null; GAME.player.velocity.set(0, 0, 0);
      GAME.player.group.position.set(c.x - 4, 0, c.z - 5);     // escalator A foot, on the ground
      GAME.camRig.yaw = Math.PI;                               // face up the ramp (+z)
      return GAME.player.group.position.y;
    });
    await page.keyboard.down('KeyW'); await waitFrames(page, 95); await page.keyboard.up('KeyW'); await waitFrames(page, 3);
    const climb1 = await page.evaluate(() => window.GAME.player.group.position.y);
    assert(climb1 > climb0 + 2.5, `walking up the escalator raises you (y ${climb0.toFixed(1)} → ${climb1.toFixed(1)})`);
    // the elevator lifts you a floor on E
    await page.evaluate(() => {
      const GAME = window.GAME, e = GAME.world.mall.elevator;
      GAME.player.inVehicle = null; GAME.player.velocity.set(0, 0, 0);
      GAME.player.group.position.set(e.x, 0, e.z);            // stand in the lift on the ground floor
    });
    await waitFrames(page, 2);
    await page.keyboard.down('KeyE'); await waitFrames(page, 3); await page.keyboard.up('KeyE'); await waitFrames(page, 4);
    const lift = await page.evaluate(() => window.GAME.player.group.position.y);
    assert(lift > 4 && lift < 11, `the elevator lifts you a floor (y=${lift.toFixed(2)})`);

    // ---- 3. Browse the food court: its own menu + buy ------------------------
    console.log('\n[3] shop has its own menu + buy');
    const shop0 = await page.evaluate(() => {
      const GAME = window.GAME;
      GAME.state = 'playing'; document.getElementById('pause').classList.remove('show');
      const s = GAME.world.mall.shops[0];                    // Pier 21 Food Court
      GAME.player.group.position.set(s.pos.x, 0, s.pos.z);
      GAME.player.velocity.set(0, 0, 0);
      GAME.cash = 2000; GAME.player.hp = 10;                 // set up a measurable buy
      GAME.hud.setCash(GAME.cash);
      return { name: s.name };
    });
    await page.keyboard.down('KeyE'); await waitFrames(page, 3); await page.keyboard.up('KeyE'); await waitFrames(page, 3);
    const browse = await page.evaluate(() => ({
      state: window.GAME.state,
      shown: document.getElementById('store').classList.contains('show'),
      title: document.querySelector('#store h3').textContent,
      items: [...document.querySelectorAll('#store-items button')].map(b => b.textContent),
    }));
    assert(browse.shown && browse.state === 'store', 'E at the shop front opens the store overlay');
    assert(browse.title === shop0.name.toUpperCase(), `store is titled for the shop ("${browse.title}")`);
    assert(browse.items.length >= 2 && browse.items.some(t => /Pad Thai|Som Tam|Tea/.test(t)), `food court has its own themed menu (${browse.items.length} items)`);
    const cashBefore = await page.evaluate(() => window.GAME.cash);
    await page.click('#store-items button');                 // buy the first item
    await waitFrames(page, 2);
    const bought = await page.evaluate(() => ({ cash: window.GAME.cash, hp: window.GAME.player.hp }));
    assert(bought.cash < cashBefore && bought.hp > 10, `buying spends cash + heals (cash ${cashBefore} → ${bought.cash}, hp ${bought.hp})`);

    // ---- 3b. An upper-floor shop browses on its own level --------------------
    console.log('\n[3b] upper-floor shop');
    const up = await page.evaluate(() => {
      const GAME = window.GAME;
      document.getElementById('store').classList.remove('show'); GAME.state = 'playing';
      const s = GAME.world.mall.shops.find(s => s.pos.y > 4 && s.pos.y < 9);   // a floor-1 shop
      GAME.player.group.position.set(s.pos.x, s.pos.y, s.pos.z);
      GAME.player.velocity.set(0, 0, 0); GAME.cash = 2000; GAME.hud.setCash(2000);
      return { name: s.name, y: s.pos.y };
    });
    await page.keyboard.down('KeyE'); await waitFrames(page, 3); await page.keyboard.up('KeyE'); await waitFrames(page, 3);
    const upOpen = await page.evaluate(() => ({
      shown: document.getElementById('store').classList.contains('show'),
      title: document.querySelector('#store h3').textContent,
    }));
    assert(upOpen.shown && upOpen.title === up.name.toUpperCase(), `upper-floor shop "${up.name}" (y≈${up.y}) browses on its own level`);

    // ---- 4. Clothing shop changes the player's outfit ------------------------
    console.log('\n[4] clothing shop cosmetics');
    const cloth = await page.evaluate(() => {
      const GAME = window.GAME;
      document.getElementById('store').classList.remove('show'); GAME.state = 'playing';
      const s = GAME.world.mall.shops.find(s => s.name === 'Roma Boutique');
      GAME.player.group.position.set(s.pos.x, 0, s.pos.z);
      GAME.player.velocity.set(0, 0, 0); GAME.cash = 2000; GAME.hud.setCash(2000);
      return { before: GAME.player.torso.material.color.getHex() };
    });
    await page.keyboard.down('KeyE'); await waitFrames(page, 3); await page.keyboard.up('KeyE'); await waitFrames(page, 3);
    const clothItems = await page.evaluate(() => [...document.querySelectorAll('#store-items button')].map(b => b.textContent));
    assert(clothItems.some(t => /Tee|Shirt|Jacket|Polo|Noir/.test(t)), `boutique sells clothing (${clothItems.length} items)`);
    await page.click('#store-items button');                 // buy the first outfit
    await waitFrames(page, 2);
    const after = await page.evaluate(() => ({ color: window.GAME.player.torso.material.color.getHex(), saved: window.GAME._shirtColor }));
    assert(after.color !== cloth.before, `buying clothing recolors the player (0x${cloth.before.toString(16)} → 0x${after.color.toString(16)})`);
    assert(after.saved === after.color, 'the chosen outfit is recorded for the save');
    // buy a hat → it appears on the player's head + is recorded as owned
    await page.evaluate(() => {
      const GAME = window.GAME;
      document.getElementById('store').classList.remove('show'); GAME.state = 'playing';
      const s = GAME.world.mall.shops.find(s => s.name === 'Roma Boutique');
      GAME.player.group.position.set(s.pos.x, s.pos.y, s.pos.z); GAME.cash = 2000;
    });
    await page.keyboard.down('KeyE'); await waitFrames(page, 3); await page.keyboard.up('KeyE'); await waitFrames(page, 3);
    const hatIdx = await page.evaluate(() => [...document.querySelectorAll('#store-items button')].findIndex(b => /Cap|Hat|Helmet/.test(b.textContent)));
    assert(hatIdx >= 0, 'the boutique sells a hat');
    await page.evaluate(i => document.querySelectorAll('#store-items button')[i].click(), hatIdx);
    await waitFrames(page, 2);
    const hat = await page.evaluate(() => ({ hat: window.GAME._hat, mesh: !!window.GAME.player._hat, owned: (window.GAME._owned || []).slice() }));
    assert(hat.hat && hat.hat !== 'none' && hat.mesh, `buying a hat puts it on the player (${hat.hat})`);
    assert(hat.owned.some(k => k.startsWith('hat:')), 'the hat is recorded as owned');

    // ---- 5. Safehouse wardrobe re-equips owned cosmetics ---------------------
    console.log('\n[5] safehouse wardrobe');
    await page.evaluate(() => {
      const GAME = window.GAME;
      document.getElementById('store').classList.remove('show'); GAME.state = 'playing';
      GAME.econ.safehouse.owned = true;
      const d = GAME.world.poi.safehouse;
      GAME.player.group.position.set(d.x, 0, d.z); GAME.player.velocity.set(0, 0, 0);
    });
    await waitFrames(page, 2);
    await page.keyboard.down('KeyF'); await waitFrames(page, 3); await page.keyboard.up('KeyF'); await waitFrames(page, 3);
    const ward = await page.evaluate(() => ({
      shown: document.getElementById('store').classList.contains('show'),
      title: document.querySelector('#store h3').textContent,
      items: [...document.querySelectorAll('#store-items button')].map(b => b.textContent),
    }));
    assert(ward.shown && ward.title === 'WARDROBE', 'F at home opens the wardrobe');
    assert(ward.items.some(t => /Remove/.test(t)), `wardrobe lists re-equip options (${ward.items.length} buttons)`);
  } catch (err) {
    errors.push(`harness: ${err.message}`);
  } finally {
    await browser.close();
    server.close();
  }

  if (errors.length) {
    console.error(`\nMALL TEST FAILED (${errors.length} error${errors.length > 1 ? 's' : ''}):`);
    for (const e of errors) console.error(`  - ${e}`);
    process.exit(1);
  }
  console.log('\nmall test passed');
}

main();

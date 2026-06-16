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

    // ---- 3. Browse a shop front + buy ----------------------------------------
    console.log('\n[3] browse a shop + buy');
    const shop0 = await page.evaluate(() => {
      const GAME = window.GAME;
      GAME.state = 'playing'; document.getElementById('pause').classList.remove('show');
      const s = GAME.world.mall.shops[0];
      GAME.player.group.position.set(s.pos.x, 0, s.pos.z);   // stand at the shop front
      GAME.player.velocity.set(0, 0, 0);
      GAME.cash = 1000; GAME.player.hp = 10;                 // set up a measurable buy
      GAME.hud.setCash(GAME.cash);
      return { name: s.name };
    });
    await page.keyboard.down('KeyE');
    await waitFrames(page, 3);
    await page.keyboard.up('KeyE');
    await waitFrames(page, 3);
    const browse = await page.evaluate(() => ({
      state: window.GAME.state,
      shown: document.getElementById('store').classList.contains('show'),
      title: document.querySelector('#store h3').textContent,
    }));
    assert(browse.shown && browse.state === 'store', 'E at the shop front opens the store overlay');
    assert(browse.title === shop0.name.toUpperCase(), `store is titled for the shop ("${browse.title}")`);
    await page.click('#buy-snack');
    await waitFrames(page, 2);
    const bought = await page.evaluate(() => ({ cash: window.GAME.cash, hp: window.GAME.player.hp }));
    assert(bought.cash < 1000 && bought.hp > 10, `buying spends cash + heals (cash ${bought.cash}, hp ${bought.hp})`);
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

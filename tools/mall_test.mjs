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
    await page.evaluate(() => { window.GAME.noBloom = true; });   // probes test gameplay, not visuals — skip the costly bloom pass

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
      const s = GAME.world.mall.shops.find(s => s.pos.y > 4 && s.pos.y < 9 && s.name !== 'Akihabara Arcade');   // a floor-1 *store* (not the arcade)
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

    // ---- 6. Mall Job mission (grab on floor 2 → heat → drop) ------------------
    console.log('\n[6] Mall Job mission');
    const m0 = await page.evaluate(() => {
      const GAME = window.GAME;
      document.getElementById('store').classList.remove('show'); GAME.state = 'playing';
      GAME.mission.start('mallJob');
      const m = GAME.mission.active;
      return { name: m.name, stage: m.stage };
    });
    assert(m0.name === 'Mall Job' && m0.stage === 1, 'Mall Job starts and points at the mall');
    // stage 1 → 2: reach the mall entrance
    await page.evaluate(() => { const m = window.GAME.mission.active; window.GAME.player.group.position.set(m.markerPos.x, 0, m.markerPos.z); window.GAME.player.velocity.set(0, 0, 0); });
    await waitFrames(page, 5);
    const m1 = await page.evaluate(() => ({ stage: window.GAME.mission.active.stage, my: window.GAME.mission.active.markerPos.y }));
    assert(m1.stage === 2 && m1.my > 8, `reaching the mall sends you to the 2nd-floor grab (stage ${m1.stage}, markerY ${m1.my.toFixed(0)})`);
    // stage 2 → 3: reach the floor-2 target → the alarm raises the heat
    await page.evaluate(() => { const m = window.GAME.mission.active; window.GAME.player.group.position.set(m.markerPos.x, m.markerPos.y, m.markerPos.z); window.GAME.wanted.stars = 0; });
    await waitFrames(page, 5);
    const m2 = await page.evaluate(() => ({ stage: window.GAME.mission.active.stage, stars: window.GAME.wanted.stars }));
    assert(m2.stage === 3 && m2.stars >= 1, `grabbing the goods trips the alarm (stage ${m2.stage}, ${m2.stars}★)`);
    // stage 3 → win: reach the drop
    const cash0 = await page.evaluate(() => window.GAME.cash);
    await page.evaluate(() => { const m = window.GAME.mission.active; window.GAME.player.group.position.set(m.markerPos.x, 0, m.markerPos.z); window.GAME.player.velocity.set(0, 0, 0); });
    await waitFrames(page, 5);
    const m3 = await page.evaluate(() => ({ stage: window.GAME.mission.active.stage, cash: window.GAME.cash }));
    assert(m3.stage === 5 && m3.cash > cash0, `reaching the drop completes the job (+฿${m3.cash - cash0})`);

    // ---- 7. Arcade mini-game (Akihabara Arcade, floor 1) ---------------------
    console.log('\n[7] arcade mini-game');
    await page.evaluate(() => {
      const GAME = window.GAME;
      GAME.state = 'playing'; document.getElementById('store').classList.remove('show');
      const s = GAME.world.mall.shops.find(s => s.name === 'Akihabara Arcade');
      GAME.player.group.position.set(s.pos.x, s.pos.y, s.pos.z); GAME.cash = 500; GAME.hud.setCash(500);
    });
    await page.keyboard.down('KeyE'); await waitFrames(page, 3); await page.keyboard.up('KeyE'); await waitFrames(page, 3);
    const inArc = await page.evaluate(() => ({ state: window.GAME.state, shown: document.getElementById('arcade').classList.contains('show') }));
    assert(inArc.state === 'arcade' && inArc.shown, 'E at the arcade launches Tuk-Tuk Dash');
    for (let r = 0; r < 3; r++) {                            // play 3 rounds, marker frozen on the bullseye
      await page.evaluate(() => { const a = window.GAME.arcade; if (a && !a.done && !a.locked) { a.marker = 0.5; a.speed = 0; } });
      await page.keyboard.down('Space'); await waitFrames(page, 2); await page.keyboard.up('Space'); await waitFrames(page, 18);
    }
    const arcDone = await page.evaluate(() => ({ done: !!(window.GAME.arcade && window.GAME.arcade.done), score: window.GAME.arcade && window.GAME.arcade.score, payout: window.GAME.arcade && window.GAME.arcade.payout, cash: window.GAME.cash }));
    assert(arcDone.done && arcDone.score > 0, `3 rounds scores points (score ${arcDone.score})`);
    assert(arcDone.payout > 0 && arcDone.cash > 500, `the arcade pays out cash (฿${arcDone.payout})`);
    await page.keyboard.down('Space'); await waitFrames(page, 3); await page.keyboard.up('Space'); await waitFrames(page, 3);
    const arcLeft = await page.evaluate(() => window.GAME.state);
    assert(arcLeft === 'playing', 'finishing the arcade returns you to the game');

    // ---- 8. Property empire (buy + tier upgrade + holdings) ------------------
    console.log('\n[8] property empire');
    await page.evaluate(() => {
      const GAME = window.GAME;
      document.getElementById('arcade').classList.remove('show'); document.getElementById('store').classList.remove('show');
      GAME.state = 'playing'; GAME.player.inVehicle = null;
      GAME.player.group.position.set(-25, 0, 18);            // the Terminal 21 retail-unit podium
      GAME.player.velocity.set(0, 0, 0); GAME.cash = 100000; GAME.hud.setCash(100000);
      for (const id in GAME.econ.businesses) GAME.econ.businesses[id].owned = false;   // start with none owned
    });
    await waitFrames(page, 2);
    await page.keyboard.down('KeyE'); await waitFrames(page, 3); await page.keyboard.up('KeyE'); await waitFrames(page, 3);
    const bizBought = await page.evaluate(() => ({ owned: !!(window.GAME.econ.businesses.t21unit && window.GAME.econ.businesses.t21unit.owned), tier: window.GAME.econ.businesses.t21unit.tier, cash: window.GAME.cash }));
    assert(bizBought.owned && bizBought.tier === 1 && bizBought.cash < 100000, `you can buy a property (Tier 1, cash ${bizBought.cash})`);
    await page.keyboard.down('KeyU'); await waitFrames(page, 3); await page.keyboard.up('KeyU'); await waitFrames(page, 3);   // upgrade a tier
    const upg = await page.evaluate(() => ({ tier: window.GAME.econ.businesses.t21unit.tier, cash: window.GAME.cash }));
    assert(upg.tier === 2 && upg.cash < bizBought.cash, `upgrading raises its tier (Tier ${upg.tier}, -฿${bizBought.cash - upg.cash})`);
    const c0 = await page.evaluate(() => { window.GAME.econ.businesses.t21unit.pending = 2000; return window.GAME.cash; });
    await page.keyboard.down('KeyE'); await waitFrames(page, 3); await page.keyboard.up('KeyE'); await waitFrames(page, 3);
    const collected = await page.evaluate(() => window.GAME.cash);
    assert(collected > c0, `you collect its passive income (+฿${collected - c0})`);
    const pop = await page.evaluate(() => {       // collect/buy call hud.cashPop; verify it renders a floating popup
      const t = typeof window.GAME.hud.cashPop;
      window.GAME.hud.cashPop(12345);
      return { t, n: document.querySelectorAll('.cash-pop').length, txt: [...document.querySelectorAll('.cash-pop')].pop()?.textContent };
    });
    assert(pop.t === 'function' && pop.n > 0, `cash rewards show a floating popup ("${pop.txt}")`);
    const bizLine = await page.evaluate(() => { window.GAME.hud.setPhoneStats(); return document.getElementById('ph-biz').textContent + ' || ' + document.getElementById('ph-biz-list').textContent; });
    assert(/1 \/ 8/.test(bizLine) && /฿152\/s/.test(bizLine), `phone holdings show the upgraded Tier-2 rate ("${bizLine}")`);

    // premium properties are gated behind a wealth rank
    await page.evaluate(() => {
      const GAME = window.GAME;
      GAME.state = 'playing'; GAME.player.inVehicle = null;
      for (const id in GAME.econ.businesses) GAME.econ.businesses[id].owned = false;
      GAME.econ.bank.balance = 0; GAME.cash = 5000; GAME.hud.setCash(5000); GAME._wealthRank = 0;
      GAME.player.group.position.set(54, 0, 90);   // the Condo Tower (premium, requires Boss rank)
      // clear vehicles near the kiosk so E buys the property (the enter radius is 8 m)
      for (const v of GAME.vehicles) if (Math.hypot(v.pos.x - 54, v.pos.z - 90) < 14) { v.pos.set(9000, 0, 9000); v.mesh.position.copy(v.pos); }
    });
    await waitFrames(page, 3);
    await page.keyboard.down('KeyE'); await waitFrames(page, 3); await page.keyboard.up('KeyE'); await waitFrames(page, 3);
    const locked = await page.evaluate(() => !!(window.GAME.econ.businesses.condo && window.GAME.econ.businesses.condo.owned));
    assert(!locked, 'a premium property stays locked below its wealth rank');
    await page.evaluate(() => {
      const GAME = window.GAME; GAME.cash = 300000; GAME.hud.setCash(300000);   // net worth → Boss rank
      for (const v of GAME.vehicles) if (Math.hypot(v.pos.x - 54, v.pos.z - 90) < 14) { v.pos.set(9000, 0, 9000); v.mesh.position.copy(v.pos); }
    });
    await waitFrames(page, 3);
    await page.keyboard.down('KeyE'); await waitFrames(page, 3); await page.keyboard.up('KeyE'); await waitFrames(page, 3);
    const unlocked = await page.evaluate(() => ({ owned: !!(window.GAME.econ.businesses.condo && window.GAME.econ.businesses.condo.owned), rank: window.GAME._wealthRank }));
    assert(unlocked.owned && unlocked.rank >= 2, `reaching the rank unlocks it (rank ${unlocked.rank})`);

    // property events: boom doubles income, trouble halts it until you pay to fix
    await page.evaluate(() => {
      const G = window.GAME;
      G.state = 'playing'; G.player.inVehicle = null; G._bizEventCD = 9999;   // suppress random events during the test
      G.econ.businesses.noodle = { owned: true, pending: 0, tier: 1, manager: false };
      G.player.group.position.set(8, 0, 30);   // the Noodle Cart
    });
    await page.evaluate(() => { window.GAME.econ.businesses.noodle.event = { type: 'boom', until: performance.now() + 60000 }; window.GAME.econ.businesses.noodle.pending = 0; });
    await waitFrames(page, 16);
    const boom = await page.evaluate(() => window.GAME.econ.businesses.noodle.pending);
    await page.evaluate(() => { window.GAME.econ.businesses.noodle.event = { type: 'trouble', until: performance.now() + 60000, fee: 750 }; window.GAME.econ.businesses.noodle.pending = 0; });
    await waitFrames(page, 16);
    const trouble = await page.evaluate(() => window.GAME.econ.businesses.noodle.pending);
    assert(boom > trouble + 5, `boom doubles income while trouble halts it (boom +${boom.toFixed(0)}, trouble +${trouble.toFixed(0)})`);
    await page.evaluate(() => { window.GAME.cash = 5000; window.GAME.hud.setCash(5000); });
    await page.keyboard.down('KeyE'); await waitFrames(page, 3); await page.keyboard.up('KeyE'); await waitFrames(page, 3);
    const fixed = await page.evaluate(() => ({ event: window.GAME.econ.businesses.noodle.event, cash: window.GAME.cash }));
    assert(!fixed.event && fixed.cash < 5000, `paying at the kiosk clears the trouble (cash ฿${fixed.cash.toFixed(0)})`);

    // the phone Activities hub lists what to do, with live status + distances
    const acts = await page.evaluate(() => {
      window.GAME.hud.setPhoneStats();
      const els = [...document.querySelectorAll('#ph-activities .act')];
      return { n: els.length, txt: document.getElementById('ph-activities').textContent };
    });
    assert(acts.n >= 6 && /Bank Heist/.test(acts.txt) && /Gang turf/.test(acts.txt) && /\dm/.test(acts.txt), `the phone Activities hub lists what to do with distances (${acts.n} entries)`);
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

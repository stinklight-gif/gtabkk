// HUD probe for Goal 3 (map/objective/radio pass). Boots the real game headless
// and asserts the new HUD surfaces actually work:
//   1. Minimap renders the Home + Garage icons (sample the canvas pixels).
//   2. The on-screen objective waypoint shows with a sane live distance, hides
//      its arrow when the marker is on-screen, and flips the arrow toward the
//      marker when the camera turns away (it goes off-screen).
//   3. The radio chip shows the tuned station while driving and changes on M.
//
// A focused assertion gate (the tools/smoke.mjs shots are the visual evidence:
// smoke_waypoint.png + smoke_map.png). Goal 3 named this node_modules/hud_test.mjs,
// but that path is gitignored — it lives here in tools/ so it stays tracked and
// runnable next to smoke.mjs.
//
// Run:  CHROME_PATH=/path/to/chrome node tools/hud_test.mjs
// (same SwiftShader / save-slot-boot caveats as tools/smoke.mjs).

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.env.HUD_TEST_PORT || 8799);
const MIME = {
  '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript',
  '.json': 'application/json', '.css': 'text/css', '.png': 'image/png',
  '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.md': 'text/plain',
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

    // ---- 1. Minimap Home + Garage icons --------------------------------------
    console.log('\n[1] minimap Home/Garage icons');
    // Sample the minimap canvas for the icon color near its computed position.
    // Force owned/rented so the glyphs render filled (solid → easy to detect).
    async function sampleIcon(which) {
      await page.evaluate(w => {
        const GAME = window.GAME;
        GAME.state = 'playing';
        document.getElementById('pause').classList.remove('show');
        GAME.minimapZoom = 1; GAME.camRig.yaw = 0; GAME.camRig.pitch = -0.05;
        GAME.player.inVehicle = null; GAME.player.group.visible = true;
        GAME.econ.safehouse.owned = true; GAME.econ.garage.rented = true;
        const tgt = w === 'home' ? GAME.world.poi.safehouse : GAME.world.garages[0].pos;
        GAME.player.group.position.set(tgt.x - 40, 0, tgt.z);   // stand 40 m west of it
      }, which);
      await waitFrames(page, 6);
      return page.evaluate(w => {
        const GAME = window.GAME, HALF = 250, SCALE = 256 / (HALF * 2);
        const p = GAME.player.group.position;
        const t = w === 'home' ? GAME.world.poi.safehouse : GAME.world.garages[0].pos;
        const cx = Math.round(128 + (t.x - p.x) * SCALE), cy = Math.round(128 + (t.z - p.z) * SCALE);
        const cnv = document.getElementById('minimap'), ctx = cnv.getContext('2d');
        const rad = 9, x0 = Math.max(0, cx - rad), y0 = Math.max(0, cy - rad);
        const ww = Math.min(cnv.width, cx + rad) - x0, hh = Math.min(cnv.height, cy + rad) - y0;
        const d = ctx.getImageData(x0, y0, ww, hh).data;
        let hits = 0;
        for (let i = 0; i < d.length; i += 4) {
          const r = d[i], g = d[i + 1], b = d[i + 2];
          if (w === 'home'   && g > 175 && b > 140 && b < 235 && r < 160 && g >= b - 10) hits++;   // teal
          if (w === 'garage' && b > 200 && r < 160 && g > 105 && g < 210 && b > g) hits++;          // blue
        }
        return { cx, cy, hits };
      }, which);
    }
    const home = await sampleIcon('home');
    assert(home.hits > 3, `Home icon renders on minimap (${home.hits} teal px near ${home.cx},${home.cy})`);
    const garage = await sampleIcon('garage');
    assert(garage.hits > 3, `Garage icon renders on minimap (${garage.hits} blue px near ${garage.cx},${garage.cy})`);

    // ---- 2. On-screen objective waypoint -------------------------------------
    console.log('\n[2] objective waypoint');
    const readWp = () => page.evaluate(() => {
      const el = document.getElementById('waypoint'), arrow = document.getElementById('wp-arrow');
      const m = (arrow.style.transform || '').match(/rotate\(([-\d.]+)deg\)/);
      return {
        shown: el.classList.contains('show'),
        arrowShown: arrow.style.display !== 'none',
        angle: m ? parseFloat(m[1]) : null,
        label: document.getElementById('wp-label').textContent,
        dist: parseFloat(document.getElementById('wp-dist').textContent),
      };
    });
    // marker straight ahead (+z); camera faces it (yaw = PI) → on-screen
    await page.evaluate(() => {
      const GAME = window.GAME;
      GAME.state = 'playing'; document.getElementById('pause').classList.remove('show');
      GAME.player.inVehicle = null; GAME.player.group.visible = true;
      GAME.player.group.position.set(0, 0, -110);
      GAME.mission.active = { name: 'Test Objective', markerPos: new GAME.THREE.Vector3(0, 0, -60) };
      if (GAME.taxi) GAME.taxi.stage = 'idle';
      GAME.camRig.yaw = Math.PI; GAME.camRig.pitch = -0.05; GAME.minimapZoom = 1;
    });
    await waitFrames(page, 6);
    const onScreen = await readWp();
    assert(onScreen.shown, 'waypoint pill is visible with a mission active');
    assert(!onScreen.arrowShown, 'waypoint arrow is hidden when the marker is on-screen');
    assert(onScreen.label === 'Test Objective', `waypoint shows the objective name ("${onScreen.label}")`);
    assert(Math.abs(onScreen.dist - 50) <= 4, `waypoint distance is sane (~50 m, got ${onScreen.dist})`);

    // turn the camera away in each direction → marker goes off opposite edges,
    // the arrow shows and its horizontal component flips toward the marker.
    const turn = async yaw => {
      await page.evaluate(y => { window.GAME.camRig.yaw = y; window.GAME.camRig.pitch = -0.05; }, yaw);
      await waitFrames(page, 5);
      return readWp();
    };
    const right = await turn(Math.PI + 1.3);
    const left = await turn(Math.PI - 1.3);
    assert(right.arrowShown && left.arrowShown, 'waypoint arrow shows when the marker is off-screen');
    const sinR = Math.sin(right.angle * Math.PI / 180), sinL = Math.sin(left.angle * Math.PI / 180);
    assert(right.angle !== null && left.angle !== null && Math.sign(sinR) === -Math.sign(sinL) && sinR !== 0,
      `arrow flips toward the marker as the camera turns (sinθ ${sinR.toFixed(2)} vs ${sinL.toFixed(2)})`);

    // ---- 3. Radio chip -------------------------------------------------------
    console.log('\n[3] radio chip');
    const readChip = () => page.evaluate(() => ({
      shown: document.getElementById('radio-chip').classList.contains('show'),
      text: document.getElementById('radio-chip').textContent,
      station: window.GAME.audio.radio.station,
      name: window.GAME.audio.radio.names[window.GAME.audio.radio.station],
    }));
    // on foot first → chip hidden
    const onFoot = await readChip();
    assert(!onFoot.shown, 'radio chip is hidden on foot');
    // drop into a real car with a station tuned in
    await page.evaluate(() => {
      const GAME = window.GAME;
      GAME.state = 'playing'; document.getElementById('pause').classList.remove('show');
      const car = GAME.vehicles.find(v => !v.driver && !v.dead && v.spec);
      car.pos.set(0, 0, -110); if (car.group) car.group.position.copy(car.pos);
      car.heading = 0; car.vel = 0;
      GAME.player.inVehicle = car; car.driver = 'player'; car.npc = null;
      GAME.player.group.visible = false;
      if (GAME.audio.radio.station === 0) GAME.audio.radio.next();   // ensure a music station
      GAME.camRig.yaw = Math.PI;
    });
    await waitFrames(page, 4);
    const driving = await readChip();
    assert(driving.shown, 'radio chip shows while driving');
    assert(driving.text.includes('📻') && driving.text.includes(driving.name),
      `radio chip shows the tuned station ("${driving.text}")`);
    // press M → station cycles, chip updates live
    await page.keyboard.down('KeyM');
    await waitFrames(page, 3);
    await page.keyboard.up('KeyM');
    await waitFrames(page, 3);
    const cycled = await readChip();
    assert(cycled.station !== driving.station, `M cycles the station live (${driving.station} → ${cycled.station})`);
    assert(cycled.text !== driving.text, `radio chip text updated on M ("${cycled.text}")`);
  } catch (err) {
    errors.push(`harness: ${err.message}`);
  } finally {
    await browser.close();
    server.close();
  }

  if (errors.length) {
    console.error(`\nHUD TEST FAILED (${errors.length} error${errors.length > 1 ? 's' : ''}):`);
    for (const e of errors) console.error(`  - ${e}`);
    process.exit(1);
  }
  console.log('\nhud test passed');
}

main();

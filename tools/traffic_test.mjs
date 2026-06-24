// Traffic-signal probe: boots the real game headless and asserts the living-city
// traffic system:
//   1. Signals exist and the city-wide phase cycles (N/S and E/W are never both
//      green — mutual exclusion is what keeps the grid from deadlocking).
//   2. An AI car approaching a RED halts before the intersection centre (stops at
//      the stop line, doesn't blow through).
//   3. The same car proceeds through on GREEN (no false-stop / no stranding).
//
// Run:  CHROME_PATH=/path/to/chrome node tools/traffic_test.mjs
// (same SwiftShader / save-slot-boot caveats as tools/smoke.mjs).

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.env.TRAFFIC_TEST_PORT || 8809);
const MIME = {
  '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript',
  '.json': 'application/json', '.css': 'text/css', '.png': 'image/png',
  '.svg': 'image/svg+xml', '.md': 'text/plain',
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
    const page = await browser.newPage({ viewport: { width: 640, height: 360 } });
    page.on('pageerror', err => errors.push(`pageerror: ${err.message}`));
    page.on('console', msg => { if (msg.type() === 'error') errors.push(`console.error: ${msg.text()}`); });

    console.log(`serving ${ROOT} on :${PORT}, booting game…`);
    await page.goto(`http://127.0.0.1:${PORT}/`, { waitUntil: 'commit', timeout: 60_000 });
    await page.click('#slots button', { timeout: 180_000 });
    await page.waitForFunction(
      () => window.GAME && (window.GAME.state === 'playing' || window.GAME.state === 'paused'),
      null, { timeout: 180_000 },
    );
    console.log('game started');
    await page.evaluate(async () => {
      window.GAME.noBloom = true;
      window.__TRAFFIC_MAIN = await import('./main.js');
    });   // gameplay probe — skip costly bloom and drive exported update functions directly

    // ---- 1. Signals exist + phase cycles with NS/EW mutually exclusive ---------
    console.log('\n[1] signals exist and the phase cycles');
    const exists = await page.evaluate(() => {
      const t = window.GAME.traffic;
      return !!(t && t.mats && typeof t.ns === 'string' && typeof t.ew === 'string');
    });
    assert(exists, 'G.traffic is initialised (ns/ew states + shared lamp materials)');

    // Drive the phase clock to four representative points and read the state the
    // loop computes from it — far cheaper than waiting out the real 24.8 s cycle
    // under SwiftShader. (dt is clamped to 0.05 s, so +2 frames barely moves t.)
    const phaseAt = async (t) => {
      await page.evaluate(v => {
        window.GAME.traffic.t = v;
        window.__TRAFFIC_MAIN.updateTrafficLights(0);
      }, t);
      return page.evaluate(() => ({ ns: window.GAME.traffic.ns, ew: window.GAME.traffic.ew }));
    };
    const gNS = await phaseAt(1.0);    // N/S green window
    const aNS = await phaseAt(11.0);   // N/S amber window
    const gEW = await phaseAt(13.0);   // E/W green window
    const aEW = await phaseAt(23.0);   // E/W amber window
    const all = [gNS, aNS, gEW, aEW];
    const seen = all.map(p => p.ns + '/' + p.ew).join(', ');
    assert(gNS.ns === 'green' && gEW.ew === 'green', `both axes get a green across the cycle (saw ${seen})`);
    assert(!all.some(p => p.ns === 'green' && p.ew === 'green'), 'N/S and E/W are never green at the same time');
    assert(gNS.ew === 'red' && gEW.ns === 'red', 'the cross is red while an axis runs (green/amber)');

    // ---- 2. An AI car halts at the stop line on red --------------------------
    console.log('\n[2] AI car stops at a red light');
    // Use the intersection at (100,100). Isolate it: clear other vehicles nearby,
    // park the player off to the side, force the phase so N/S is RED, and drop a
    // N/S-bound (dir 0, +z) traffic car ~18 m before the stop line.
    const setup = await page.evaluate(() => {
      const GAME = window.GAME, BLOCK = 50, LANE = 2.5;
      GAME.state = 'playing'; document.getElementById('pause').classList.remove('show');
      GAME.player.inVehicle = null; GAME.player.group.visible = true;
      GAME.player.group.position.set(130, 0, 100);   // off to the side, within recycle range
      GAME.player.velocity && GAME.player.velocity.set(0, 0, 0);
      GAME.wanted.stars = 0;
      const cx = 100, cz = 100;
      // clear traffic near the junction so nothing blocks/queues ahead of the test car
      for (const v of GAME.vehicles) {
        if (v === GAME.player.inVehicle) continue;
        const d = Math.hypot(v.pos.x - cx, v.pos.z - cz);
        if (d < 40 && v.npc && v.npc.kind === 'traffic') v.pos.set(cx - 220, 0, cz - 220);
      }
      // pick a traffic car and stage it heading north toward the junction
      const car = GAME.vehicles.find(v => v.npc && v.npc.kind === 'traffic' && !v.dead);
      car.npc.cruiseSpeed = Math.min(car.npc.cruiseSpeed, 9);   // a clean, repeatable stop
      const startZ = cz - 18;
      car.pos.set(cx - LANE, 0, startZ);             // left-hand lane, dir 0 → x offset -2.5
      car.heading = 0; car.vel = car.npc.cruiseSpeed; car.npc.dir = 0; car.npc.turnCD = 1.5;
      if (car.mesh) { car.mesh.position.copy(car.pos); car.mesh.rotation.y = 0; }
      // helper used each iteration: shove any OTHER traffic car that respawns ahead
      // in the test lane far away, so nothing blocks the green-light proceed test.
      window.__clearAhead = () => {
        for (const v of GAME.vehicles) {
          if (v === car || !(v.npc && v.npc.kind === 'traffic')) continue;
          if (Math.abs(v.pos.x - cx) < 3 && v.pos.z > car.pos.z - 2 && v.pos.z < cz + 30) {
            v.pos.set(cx - 200, 0, cz - 200); if (v.mesh) v.mesh.position.copy(v.pos);
          }
        }
      };
      // force the global phase into the N/S-RED window and pin it
      GAME.traffic.t = 13.0;
      return { idx: GAME.vehicles.indexOf(car), cx, cz, startZ };
    });
    // Run the real traffic update directly. This keeps the test deterministic
    // under slow SwiftShader while still exercising updateTrafficCar + lightFor.
    const red = await page.evaluate(i => {
      const G = window.GAME, main = window.__TRAFFIC_MAIN, v = G.vehicles[i];
      for (let k = 0; k < 70; k++) {
        G.traffic.t = 13.0;
        main.updateTrafficLights(0);
        window.__clearAhead();
        main.updateTrafficCar(v, 0.1);
        if (Math.abs(v.vel) < 0.4 && v.pos.z < 96) break;
      }
      return { z: v.pos.z, vel: v.vel, ns: G.traffic.ns };
    }, setup.idx);
    const stoppedZ = red.z, finalVel = red.vel;
    const stopLine = setup.cz - (12 / 2 + 1.6);   // ROAD_WIDTH/2 + margin = 7.6 → z ≈ 92.4
    assert(stoppedZ < setup.cz - 4, `car halted before the junction centre (z ${stoppedZ.toFixed(1)} < ${setup.cz}, line ≈ ${stopLine.toFixed(1)})`);
    assert(Math.abs(finalVel) < 0.6, `car is stopped at the red (vel ${finalVel.toFixed(2)} m/s)`);

    // ---- 3. The same car proceeds on green -----------------------------------
    console.log('\n[3] AI car proceeds through on green');
    const beforeZ = await page.evaluate(i => window.GAME.vehicles[i].pos.z, setup.idx);
    const afterZ = await page.evaluate(i => {
      const G = window.GAME, main = window.__TRAFFIC_MAIN, v = G.vehicles[i];
      for (let k = 0; k < 80; k++) {
        G.traffic.t = 1.0;
        main.updateTrafficLights(0);
        v.npc.dir = 0;
        v.npc.turnCD = 999;
        window.__clearAhead();
        main.updateTrafficCar(v, 0.1);
        if (v.pos.z > 102) break;
      }
      return v.pos.z;
    }, setup.idx);
    assert(afterZ > beforeZ + 6, `car advanced through the junction on green (z ${beforeZ.toFixed(1)} → ${afterZ.toFixed(1)})`);

    console.log('');
    if (errors.length) { console.error('FAILURES:\n - ' + errors.join('\n - ')); process.exitCode = 1; }
    else console.log('ALL TRAFFIC CHECKS PASSED');
  } finally {
    await browser.close();
    server.close();
  }
}

main().catch(e => { console.error(e); process.exitCode = 1; });

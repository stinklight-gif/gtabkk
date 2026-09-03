// Headless smoke test: boots the real game in headless Chromium (SwiftShader),
// fails on any page error, and captures noon + night screenshot evidence.
//
// Usage:
//   npm install --no-save playwright && npx playwright install chromium
//   node tools/smoke.mjs
//
// Outputs smoke_noon.png and smoke_night.png in the repo root and prints the
// renderer draw-call count for each shot. Exits non-zero on any failure.
//
// Hard-won details (don't rediscover them):
// - Without --enable-unsafe-swiftshader / --use-angle=swiftshader, WebGL context
//   creation fails silently in headless containers and the loader never finishes.
// - Under SwiftShader the frame-time clamp (dt <= 0.05) makes the sim run at a
//   fraction of wall-clock speed. Never assert wall-clock timing — drive state
//   directly through the window.GAME debug API and wait in rAF frames.
// - If pointer lock ever drops, the game flips to 'paused'; force-resume with
//   GAME.state = 'playing' before each shot.
// - CHROME_PATH overrides the browser binary for sandboxes where Playwright's
//   CDN is blocked (any Chrome/Chromium close to Playwright's pinned version).

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.env.SMOKE_PORT || 8765);
const MIME = {
  '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript',
  '.json': 'application/json', '.css': 'text/css', '.png': 'image/png',
  '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.md': 'text/plain',
  '.gltf': 'model/gltf+json', '.bin': 'application/octet-stream',
};

const SHOTS = [
  { name: 'smoke_noon.png',  dayT: 0.5  },  // 12:00 — daytime + busy sidewalks
  { name: 'smoke_night.png', dayT: 0.87 },  // ~20:50 — full neon
  { name: 'smoke_3am.png',   dayT: 0.13 },  // ~03:00 — dead streets (same spot as noon)
  { name: 'smoke_festival.png', dayT: 0.9, festival: true },  // Loy Krathong on the river
  { name: 'smoke_waypoint.png', dayT: 0.5, waypoint: true },  // objective waypoint + radio chip, in a car
  { name: 'smoke_map.png',      dayT: 0.5, tabmap: true   },  // TAB full map: icons, legend, objective line
  { name: 'smoke_mall.png',     dayT: 0.5, mall: true     },  // inside Terminal 21: atrium, shops, directory
  { name: 'smoke_bts.png',      dayT: 0.5, bts: true      },  // up on the Asok BTS platform (walk-up)
  { name: 'smoke_heli.png',     dayT: 0.88, heli: true    },  // night 4★ chase: police helicopter + searchlight
  { name: 'smoke_river.png',    dayT: 0.45, river: true   },  // the Chao Phraya pier + driveable boats
  { name: 'smoke_bank.png',     dayT: 0.55, bank: true    },  // Krung Thep Bank facade (robbable vault inside)
];
// Extra one-off shots for tuning, e.g. SMOKE_SHOTS="dawn=0.30,dusk=0.78"
// (these don't run in CI — only the two standard shots above are asserted).
for (const pair of (process.env.SMOKE_SHOTS || '').split(',').filter(Boolean)) {
  const [label, t] = pair.split('=');
  SHOTS.push({ name: `smoke_${label}.png`, dayT: Number(t) });
}

function serve() {
  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      const urlPath = decodeURIComponent(new URL(req.url, 'http://x').pathname);
      let file = path.normalize(path.join(ROOT, urlPath === '/' ? 'index.html' : urlPath));
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

// Wait n requestAnimationFrame ticks in the page — frame-count, not wall-clock,
// so it works at SwiftShader's ~4 fps too.
const waitFrames = (page, n) => page.evaluate(
  n => new Promise(done => { let i = 0; const tick = () => (++i >= n ? done() : requestAnimationFrame(tick)); requestAnimationFrame(tick); }),
  n
);

async function main() {
  const server = await serve();
  const errors = [];
  const browser = await chromium.launch({
    executablePath: process.env.CHROME_PATH || undefined,
    args: ['--no-sandbox', '--enable-unsafe-swiftshader', '--use-angle=swiftshader'],
  });
  try {
    // 1024×576 keeps the screenshots clear while cutting ~40% of the per-frame
    // SwiftShader render cost — needed now that the suite has 10 shots.
    const page = await browser.newPage({ viewport: { width: 854, height: 480 } });
    page.on('pageerror', err => errors.push(`pageerror: ${err.message}`));
    page.on('console', msg => {
      if (msg.type() !== 'error') return;
      const loc = msg.location();
      errors.push(`console.error: ${msg.text()}${loc && loc.url ? ` (${loc.url})` : ''}`);
    });

    console.log(`serving ${ROOT} on :${PORT}, booting game…`);
    await page.goto(`http://127.0.0.1:${PORT}/`, { waitUntil: 'commit', timeout: 60_000 });
    // Playwright auto-waits for the button to become clickable (the .ready class
    // drops its pointer-events:none). World build is CPU-rendered → generous timeout.
    await page.click('#slots button', { timeout: 180_000 });
    await page.waitForFunction(
      () => window.GAME && (window.GAME.state === 'playing' || window.GAME.state === 'paused'),
      null, { timeout: 180_000 },
    );
    console.log('game started');
    await page.evaluate(() => {
      const GAME = window.GAME;
      GAME.noBloom = true;          // same as realism_pass_test: SwiftShader dies on the bloom RTs
      GAME.renderer.setPixelRatio(1);
    });
    const fontProbe = await page.evaluate(() => ({
      status: document.fonts ? document.fonts.status : 'unknown',
      loading: document.fonts ? [...document.fonts].filter(f => f.status === 'loading').map(f => f.family) : [],
    }));
    if (fontProbe.status === 'loading' || fontProbe.loading.length) {
      errors.push(`document.fonts still loading after boot (${fontProbe.status}: ${fontProbe.loading.join(', ') || 'ready pending'})`);
    } else {
      console.log(`fonts: ${fontProbe.status}`);
    }

    for (const shot of SHOTS) {
      await page.evaluate(({ dayT, festival, waypoint, tabmap, mall, bts, heli, river, bank }) => {
        const GAME = window.GAME;
        GAME._holdFrame = false;
        GAME.state = 'playing';                                  // force-resume if pointer lock dropped
        document.getElementById('pause').classList.remove('show');
        document.getElementById('fullmap-wrap').classList.remove('show');  // clear a prior TAB-map shot
        GAME.showMap = false;
        GAME.time.dayT = dayT;
        GAME._rainTarget = 0; GAME.time.rainStrength = 0;        // force clear weather
        GAME.time.weather = 'clear';
        GAME._weatherUntil = 1e9;
        if (festival) {
          // schedule-driven: set the in-game date to a Loy Krathong night and stand on the river
          GAME.time.day = 2;                                     // day % 4 === 2 + night → Loy Krathong
          GAME.player.group.position.set(-228, 0, -120);
          GAME.camRig.yaw = Math.PI; GAME.camRig.pitch = -0.15; // look down-river (the floats recede north)
        } else if (waypoint || tabmap) {
          // objective waypoint + radio chip: set a mission marker, drop into a car
          GAME.player.group.position.set(0, 0, -110);
          GAME.mission.active = { name: 'Soi Run', markerPos: new GAME.THREE.Vector3(10, 0, -55) };
          if (GAME.taxi) GAME.taxi.stage = 'idle';
          const car = GAME.vehicles.find(v => !v.driver && !v.dead && v.spec);
          if (car) {
            car.pos.set(0, 0, -110); if (car.group) car.group.position.copy(car.pos);
            car.heading = 0; car.vel = 0;                        // heading 0 → chase cam settles to yaw PI
            GAME.player.inVehicle = car; car.driver = 'player'; car.npc = null;
            GAME.player.group.visible = false;
          }
          if (GAME.audio && GAME.audio.radio && GAME.audio.radio.station === 0) GAME.audio.radio.next();
          GAME.camRig.yaw = Math.PI; GAME.camRig.pitch = -0.06;
          if (tabmap) {                                          // open the full-screen TAB map overlay
            GAME.econ.businesses.noodle = { owned: true, pending: 800 };   // show one owned business (filled icon)
            GAME.showMap = true;
            document.getElementById('fullmap-wrap').classList.add('show');
            GAME.state = 'map';
          }
        } else if (mall) {
          // stand on floor 1 looking south + down across the atrium void (the south
          // wall sits behind the view, so all three levels read without bleed-through)
          const c = GAME.world.mall ? GAME.world.mall.center : { x: -25, z: 25 };
          GAME.player.inVehicle = null; GAME.player.group.visible = true;
          GAME.player.group.position.set(c.x, 5.1, c.z + 11);
          GAME.camRig.yaw = 0; GAME.camRig.pitch = -0.12;
        } else if (bts) {
          // up on the Asok BTS platform, looking out + down over the street
          const b = GAME.world.bts;
          GAME.player.inVehicle = null; GAME.player.group.visible = true;
          GAME.player.group.position.set(b.x, b.platformY + 0.1, -2);
          GAME.camRig.yaw = 0; GAME.camRig.pitch = -0.16;
        } else if (heli) {
          // night 4★ chase — the police helicopter spawns overhead next frames
          GAME.player.inVehicle = null; GAME.player.group.visible = true;
          GAME.player.group.position.set(0, 0, -130); GAME._inMall = false;
          GAME.wanted.stars = 4; GAME.wanted.lastSeenAt = performance.now();
          GAME.camRig.yaw = Math.PI; GAME.camRig.pitch = 0.28;   // look up at the chopper
        } else if (river) {
          // riverside pier looking west over the Chao Phraya at the longtail boats
          GAME.player.inVehicle = null; GAME.player.group.visible = true;
          GAME.player.group.position.set(-204, 1.4, -50);
          GAME.camRig.yaw = Math.PI / 2; GAME.camRig.pitch = -0.08;   // yaw +PI/2 → look due west
          GAME.time.day = 1; GAME.festival.type = null; GAME.wanted.stars = 0;
          document.getElementById('subtitle').classList.remove('show');
        } else if (bank) {
          // outside Krung Thep Bank, looking south at the columned facade
          GAME.player.inVehicle = null; GAME.player.group.visible = true;
          const b = GAME.world.poi.bank;
          GAME.player.group.position.set(b.x, 1.6, b.z + 9);
          GAME.camRig.yaw = 0; GAME.camRig.pitch = -0.04;                        // look south (-z) at the facade
          GAME.time.day = 1; GAME.festival.type = null; GAME.wanted.stars = 0;
          document.getElementById('subtitle').classList.remove('show');
        } else {
          GAME.player.group.position.set(0, 0, -130);            // street level, mid-map
          GAME.camRig.yaw = Math.PI; GAME.camRig.pitch = -0.02;  // aim down the street
        }
        GAME.camRig.shake = 0;
        if (GAME.resyncCrowd) GAME.resyncCrowd();                // snap crowd to this hour (busy noon vs dead 3am)
      }, shot);
      await waitFrames(page, (shot.festival || shot.waypoint || shot.tabmap || shot.mall || shot.bts || shot.heli || shot.river || shot.bank) ? 20 : 12);  // let day/night + camera settle
      // Do not use Playwright page.screenshot: after living-city, CDP
      // captureScreenshot deadlocks SwiftShader (fonts loaded, then 120s hang).
      // Read the presented canvas in-page after one explicit render.
      const dataUrl = await page.evaluate(({ tabmap }) => {
        const GAME = window.GAME;
        GAME.noBloom = true;
        GAME._holdFrame = true;
        if (tabmap) {
          const c = document.getElementById('fullmap');
          if (!c) throw new Error('fullmap canvas missing');
          return c.toDataURL('image/png');
        }
        if (!GAME.renderer || !GAME.scene || !GAME.camera) throw new Error('renderer missing');
        GAME.renderer.setRenderTarget(null);
        GAME.renderer.render(GAME.scene, GAME.camera);
        if (GAME.hud && GAME.hud.drawWaypoint) GAME.hud.drawWaypoint();
        return GAME.renderer.domElement.toDataURL('image/png');
      }, { tabmap: !!shot.tabmap });
      if (!dataUrl || !dataUrl.startsWith('data:image/png')) throw new Error(`canvas capture failed for ${shot.name}`);
      fs.writeFileSync(path.join(ROOT, shot.name), Buffer.from(dataUrl.split(',')[1], 'base64'));
      await page.evaluate(() => { window.GAME._holdFrame = false; });
      const size = fs.statSync(path.join(ROOT, shot.name)).size;
      const calls = await page.evaluate(() => window.GAME.renderer.info.render.calls);
      console.log(`${shot.name}: ${(size / 1024).toFixed(0)} KB, draw calls = ${calls}`);
      if (size < 20_480) errors.push(`${shot.name} is suspiciously small (${size} bytes)`);
    }
  } catch (err) {
    errors.push(`harness: ${err.message}`);
  } finally {
    await browser.close();
    server.close();
  }

  if (errors.length) {
    console.error(`\nSMOKE TEST FAILED (${errors.length} error${errors.length > 1 ? 's' : ''}):`);
    for (const e of errors) console.error(`  - ${e}`);
    process.exit(1);
  }
  console.log('\nsmoke test passed');
}

main();

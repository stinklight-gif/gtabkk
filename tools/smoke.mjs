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
};

const SHOTS = [
  { name: 'smoke_noon.png',  dayT: 0.5  },  // 12:00 — daytime + busy sidewalks
  { name: 'smoke_night.png', dayT: 0.87 },  // ~20:50 — full neon
  { name: 'smoke_3am.png',   dayT: 0.13 },  // ~03:00 — dead streets (same spot as noon)
  { name: 'smoke_festival.png', dayT: 0.9, festival: true },  // Loy Krathong on the river
  { name: 'smoke_songkran.png', dayT: 0.5, songkran: true },  // Songkran water fight in the street
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
    const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
    page.on('pageerror', err => errors.push(`pageerror: ${err.message}`));
    page.on('console', msg => {
      if (msg.type() !== 'error') return;
      const loc = msg.location();
      errors.push(`console.error: ${msg.text()}${loc && loc.url ? ` (${loc.url})` : ''}`);
    });

    console.log(`serving ${ROOT} on :${PORT}, booting game…`);
    await page.goto(`http://127.0.0.1:${PORT}/`, { waitUntil: 'domcontentloaded', timeout: 60_000 });
    // Playwright auto-waits for the button to become clickable (the .ready class
    // drops its pointer-events:none). World build is CPU-rendered → generous timeout.
    await page.click('#startbtn', { timeout: 180_000 });
    await page.waitForFunction(
      () => window.GAME && (window.GAME.state === 'playing' || window.GAME.state === 'paused'),
      null, { timeout: 180_000 },
    );
    console.log('game started');

    for (const shot of SHOTS) {
      await page.evaluate(({ dayT, festival, songkran }) => {
        const GAME = window.GAME;
        GAME.state = 'playing';                                  // force-resume if pointer lock dropped
        document.getElementById('pause').classList.remove('show');
        GAME.time.dayT = dayT;
        GAME._rainTarget = 0; GAME.time.rainStrength = 0;        // force clear weather
        GAME.time.weather = 'clear';
        GAME._weatherUntil = 1e9;
        if (festival) {
          // schedule-driven: set the in-game date to a Loy Krathong night and stand on the river
          GAME.time.day = 2;                                     // day % 4 === 2 + night → Loy Krathong
          GAME.player.group.position.set(-228, 0, -120);
          GAME.camRig.yaw = Math.PI; GAME.camRig.pitch = -0.15; // look down-river (the floats recede north)
        } else if (songkran) {
          GAME.time.day = 0;                                     // day % 4 === 0 + midday → Songkran
          GAME.player.group.position.set(0, 0, -130);
          GAME.camRig.yaw = Math.PI; GAME.camRig.pitch = -0.04;  // street full of splashing peds
        } else {
          GAME.player.group.position.set(0, 0, -130);            // street level, mid-map
          GAME.camRig.yaw = Math.PI; GAME.camRig.pitch = -0.02;  // aim down the street
        }
        GAME.camRig.shake = 0;
        if (GAME.resyncCrowd) GAME.resyncCrowd();                // snap crowd to this hour (busy noon vs dead 3am)
      }, shot);
      await waitFrames(page, (shot.festival || shot.songkran) ? 24 : 14);  // let day/night + camera (+ festival) settle
      await page.screenshot({ path: path.join(ROOT, shot.name), timeout: 120_000 });
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

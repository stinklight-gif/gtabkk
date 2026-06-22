// One-off: screenshot the Krung Thep Bank overlay with a rich property portfolio,
// to eyeball the money/property UI (account + property accounts: collect-all,
// managers, sell). Not part of CI. Run:
//   CHROME_PATH=… node tools/shot_bank.mjs
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.env.SHOT_PORT || 8766);
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png' };

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
const waitFrames = (page, n) => page.evaluate(n => new Promise(done => { let i = 0; const t = () => (++i >= n ? done() : requestAnimationFrame(t)); requestAnimationFrame(t); }), n);

async function main() {
  const server = await serve();
  const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || undefined, args: ['--no-sandbox', '--enable-unsafe-swiftshader', '--use-angle=swiftshader'] });
  try {
    const page = await browser.newPage({ viewport: { width: 1024, height: 576 } });
    await page.goto(`http://127.0.0.1:${PORT}/`, { waitUntil: 'domcontentloaded', timeout: 60_000 });
    await page.click('#slots button', { timeout: 180_000 });
    await page.waitForFunction(() => window.GAME && window.GAME.state === 'playing', null, { timeout: 180_000 });

    await page.evaluate(() => {
      const G = window.GAME;
      G.state = 'playing'; G.player.inVehicle = null; G.wanted.stars = 0; G.heist.active = false;
      G.cash = 240000; G.hud.setCash(240000);
      G.econ.bank.balance = 185000; G.econ.bank.lastDay = G.time.day; G._wealthRank = 2;
      const own = (id, tier, mgr, pending) => { G.econ.businesses[id] = { owned: true, tier, manager: mgr, pending: pending || 0 }; };
      own('noodle', 3, true, 0); own('market', 2, false, 1200); own('wash', 1, false, 800);
      own('tukstand', 2, true, 0); own('bar', 1, false, 2400); own('t21unit', 3, false, 3000);
      G.econ.businesses.bar.event = { type: 'boom', until: performance.now() + 60000 };
      const t = G.world.bank.teller; G.player.group.position.set(t.x, 0, t.z); G.player.velocity.set(0, 0, 0);
    });
    await page.keyboard.down('KeyE'); await waitFrames(page, 3); await page.keyboard.up('KeyE'); await waitFrames(page, 5);
    const shown = await page.evaluate(() => document.getElementById('bank').classList.contains('show'));
    await page.screenshot({ path: path.join(ROOT, 'shot_bank_ui.png') });
    console.log('bank overlay shown:', shown, '→ shot_bank_ui.png');
  } finally {
    await browser.close();
    server.close();
  }
}
main();

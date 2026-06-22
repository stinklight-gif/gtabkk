// One-off: boot the game in a touch/mobile context (landscape iPhone-ish) and
// screenshot it, to verify the on-screen touch controls render + lay out right.
// Not part of CI. Run: CHROME_PATH=… node tools/shot_mobile.mjs
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.env.SHOT_PORT || 8768);
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png' };

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
  const errors = [];
  const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || undefined, args: ['--no-sandbox', '--enable-unsafe-swiftshader', '--use-angle=swiftshader'] });
  try {
    const ctx = await browser.newContext({ viewport: { width: 844, height: 390 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
    const page = await ctx.newPage();
    page.on('pageerror', e => errors.push('pageerror: ' + e.message));
    page.on('console', m => { if (m.type() === 'error') errors.push('console.error: ' + m.text()); });
    await page.goto(`http://127.0.0.1:${PORT}/`, { waitUntil: 'domcontentloaded', timeout: 60_000 });
    await page.click('#slots button', { timeout: 180_000 });
    await page.waitForFunction(() => window.GAME && window.GAME.state === 'playing', null, { timeout: 180_000 });
    await page.evaluate(() => { const G = window.GAME; G.player.inVehicle = null; G.wanted.stars = 0; });
    await waitFrames(page, 8);
    const diag = await page.evaluate(() => ({
      isTouch: !!(window.GAME.input && window.GAME.input.isTouch),
      bodyTouch: document.body.classList.contains('is-touch'),
      touchShown: getComputedStyle(document.getElementById('touch')).display,
      buttons: document.querySelectorAll('#touch button').length,
    }));
    console.log('mobile diag:', JSON.stringify(diag), '| errors:', errors.length);
    if (errors.length) console.log(errors.slice(0, 5).join('\n'));

    // functional: synthetic touches should drive virtual keys + look delta
    const fn = await page.evaluate(() => {
      const G = window.GAME;
      const fire = (el, type, x, y) => {
        const t = new Touch({ identifier: 7, target: el, clientX: x, clientY: y });
        el.dispatchEvent(new TouchEvent(type, { bubbles: true, cancelable: true, changedTouches: [t], touches: type === 'touchend' ? [] : [t] }));
      };
      const eBtn = document.querySelector('#touch button[data-key="KeyE"]');
      const er = eBtn.getBoundingClientRect();
      fire(eBtn, 'touchstart', er.left + er.width / 2, er.top + er.height / 2);
      const eDown = G.input.down('KeyE');
      fire(eBtn, 'touchend', er.left + er.width / 2, er.top + er.height / 2);
      const eUp = G.input.down('KeyE');
      const base = document.getElementById('stick-base'), br = base.getBoundingClientRect();
      const cx = br.left + br.width / 2, cy = br.top + br.height / 2;
      fire(base, 'touchstart', cx, cy - 60);    // push the stick up = forward
      const wDown = G.input.down('KeyW');
      fire(base, 'touchend', cx, cy - 60);
      const wUp = G.input.down('KeyW');
      const look = document.getElementById('touch-look');
      fire(look, 'touchstart', 620, 200); fire(look, 'touchmove', 690, 200);
      const ldx = G.input.consumeMouseDelta()[0];
      return { eDown, eUp, wDown, wUp, ldx };
    });
    console.log('touch input:', JSON.stringify(fn));
    await page.screenshot({ path: path.join(ROOT, 'shot_mobile.png') });
    console.log('→ shot_mobile.png');
  } finally {
    await browser.close();
    server.close();
  }
}
main();

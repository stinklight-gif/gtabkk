// Realism/performance pass probe:
// - boots the real game in Chromium
// - verifies the performance budget HUD and LOD counters
// - opens/closes the vehicle/pedestrian showcase
// - starts and completes Moto Drop end to end through the live update loop
//
// Run:
//   CHROME_PATH="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" node tools/realism_pass_test.mjs

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.env.REALISM_TEST_PORT || 8817);
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

async function main() {
  const server = await serve();
  const errors = [];
  const assert = (cond, msg) => { if (cond) console.log(`  ok: ${msg}`); else errors.push(msg); };

  const browser = await chromium.launch({
    executablePath: process.env.CHROME_PATH || undefined,
    args: ['--no-sandbox', '--enable-unsafe-swiftshader', '--use-angle=swiftshader'],
  });

  try {
    const page = await browser.newPage({ viewport: { width: 854, height: 480 } });
    page.on('pageerror', err => errors.push(`pageerror: ${err.message}`));
    page.on('console', msg => { if (msg.type() === 'error') errors.push(`console.error: ${msg.text()}`); });

    console.log(`serving ${ROOT} on :${PORT}, booting game...`);
    await page.goto(`http://127.0.0.1:${PORT}/?debug=1`, { waitUntil: 'commit', timeout: 180_000 });
    await page.click('#slots button', { timeout: 180_000 });
    await page.waitForFunction(
      () => window.GAME && (window.GAME.state === 'playing' || window.GAME.state === 'paused'),
      null, { timeout: 180_000 },
    );
    await page.evaluate(async () => {
      window.__REALISM_MAIN = await import('./main.js');
      window.GAME.noBloom = true;
      window.GAME.state = 'playing';
    });

    console.log('\n[1] performance budget + LOD');
    const budget = await page.evaluate(() => {
      const G = window.GAME, main = window.__REALISM_MAIN;
      G.perf = { ...(G.perf || {}), enabled: true, acc: 0, frames: 0 };
      const passEval = main.evaluatePerformanceBudget({
        fps: 60, drawCalls: 500, triangles: 300000, visibleMeshes: 500,
        activeEntities: 130, nearLodEntities: 70, farLodEntities: 22,
      });
      const failEval = main.evaluatePerformanceBudget({
        fps: 30, drawCalls: 1500, triangles: 800000, visibleMeshes: 1400,
        activeEntities: 260, nearLodEntities: 150, farLodEntities: 0,
      });
      main.updateEntityLod();
      G.renderer.setRenderTarget(null);
      G.renderer.render(G.scene, G.camera);
      main.updatePerformanceBudget(0.5);
      const txt = document.getElementById('perf').textContent;
      const lod = G.lodStats || {};
      const snap = G.perf && G.perf.snapshot;
      return { txt, lod, snap, passEval, failEval };
    });
    assert(/VISUAL BUDGET/.test(budget.txt) && /draw calls/.test(budget.txt) && /entities/.test(budget.txt), 'budget overlay exposes FPS/draw calls/entities');
    assert((budget.snap && budget.snap.drawCalls > 0 && budget.snap.visibleMeshes > 0), 'budget snapshot has live render and mesh counts');
    assert((budget.snap && budget.snap.budgets && budget.snap.budgets.drawCalls && budget.snap.budgets.farLodEntities), 'budget snapshot exposes pass/fail threshold results');
    assert(budget.passEval && budget.passEval.pass === true && budget.passEval.status === 'ok', 'budget evaluator passes an in-budget synthetic scene');
    assert(budget.failEval && budget.failEval.pass === false && budget.failEval.status === 'bad' && budget.failEval.fps.pass === false, 'budget evaluator fails an over-budget synthetic scene');
    assert((budget.lod.vehicleLow || 0) > 0 || (budget.lod.pedLow || 0) > 0, 'near/far LOD counters are active');

    console.log('\n[2] showcase mode');
    const showcase = await page.evaluate(() => {
      const G = window.GAME, main = window.__REALISM_MAIN;
      G.state = 'playing';
      main.startDebugShowcase();
      G.renderer.setRenderTarget(null);
      G.renderer.render(G.showcase.scene, G.showcase.camera);
      return {
        state: G.state,
        shown: document.getElementById('showcase').classList.contains('show'),
        children: G.showcase && G.showcase.root.children.length,
      };
    });
    assert(showcase.state === 'showcase' && showcase.shown, 'showcase mode opens');
    assert(showcase.children >= 25, 'showcase contains vehicle and pedestrian variant display objects');
    const showcaseClosed = await page.evaluate(() => {
      const G = window.GAME, main = window.__REALISM_MAIN;
      main.closeDebugShowcase();
      return { state: G.state, shown: document.getElementById('showcase').classList.contains('show') };
    });
    assert(showcaseClosed.state === 'playing' && !showcaseClosed.shown, 'showcase mode exits back to play');

    console.log('\n[3] Moto Drop loop');
    await page.evaluate(() => {
      const G = window.GAME;
      const bike = G.vehicles.find(v => !v.dead && (v.kind === 'bike' || v.kind === 'tuktuk'));
      if (!bike) throw new Error('no Moto Drop vehicle available');
      bike.pos.copy(G.player.group.position).add(new G.THREE.Vector3(1.5, 0, 0));
      bike.heading = 0; bike.vel = 0; bike.driver = 'player'; bike.npc = null;
      bike.mesh.position.copy(bike.pos); bike.mesh.rotation.y = bike.heading;
      G.player.inVehicle = bike; G.player.group.visible = false; G.player.group.position.copy(bike.pos);
      G.wanted.stars = 0;
      if (G.quickDrop) G.quickDrop.stage = 'idle';
    });
    const pickup = await page.evaluate(() => {
      const G = window.GAME, main = window.__REALISM_MAIN;
      G.state = 'playing';
      window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyJ' }));
      main.updateQuickDelivery(0.016);
      window.dispatchEvent(new KeyboardEvent('keyup', { code: 'KeyJ' }));
      if (G.input && G.input.endFrame) G.input.endFrame();
      main.updateQuickDelivery(0.016);
      const q = G.quickDrop;
      return { stage: q && q.stage, reward: q && q.reward, marker: !!(q && q.markerPos), prompt: document.getElementById('prompt').textContent, cash: G.cash };
    });
    assert(pickup.stage === 'toPickup' && pickup.marker && pickup.reward === 0, 'Moto Drop starts from bike/tuk-tuk input with a pickup marker');
    assert(/MOTO PICKUP/.test(pickup.prompt), 'Moto Drop HUD prompt shows pickup distance');

    const active = await page.evaluate(() => {
      const G = window.GAME, q = G.quickDrop, v = G.player.inVehicle;
      v.pos.copy(q.markerPos);
      v.mesh.position.copy(v.pos);
      G.player.group.position.copy(v.pos);
      window.__REALISM_MAIN.updateQuickDelivery(0.1);
      return {
        stage: q.stage,
        reward: q.reward,
        marker: !!q.markerPos,
        prompt: document.getElementById('prompt').textContent,
        cash: G.cash,
        totalTime: q.totalTime,
      };
    });
    assert(active.stage === 'toDropoff' && active.marker && active.reward > 0 && active.totalTime > 0, 'Moto Drop transitions from pickup to timed drop-off with reward');
    assert(/MOTO DROP/.test(active.prompt), 'Moto Drop HUD prompt shows timer and payout');

    const heat = await page.evaluate(() => {
      const q = window.GAME.quickDrop;
      q.timeLeft = q.totalTime * 0.52;
      window.__REALISM_MAIN.updateQuickDelivery(0.1);
      return { stars: window.GAME.wanted.stars, heatLevel: q.heatLevel };
    });
    assert(heat.stars >= 1 && heat.heatLevel >= 1, 'Moto Drop escalates wanted pressure during the run');

    await page.evaluate(() => {
      const G = window.GAME, q = G.quickDrop, v = G.player.inVehicle;
      v.pos.copy(q.dest);
      v.mesh.position.copy(v.pos);
      G.player.group.position.copy(v.pos);
      window.__REALISM_MAIN.updateQuickDelivery(0.1);
    });
    const done = await page.evaluate(() => {
      const G = window.GAME, q = G.quickDrop;
      return {
        stage: q.stage,
        deliveries: q.deliveries,
        streak: q.streak,
        lastResult: q.lastResult,
        cash: G.cash,
        reward: q.reward,
        notif: document.getElementById('notif').textContent,
      };
    });
    assert(done.stage === 'idle' && done.deliveries >= 1 && done.lastResult === 'delivered', 'Moto Drop returns to idle after drop-off and records a delivery');
    assert(done.streak >= 1, 'Moto Drop increments the delivery streak on success');
    assert(done.cash > active.cash, 'Moto Drop pays cash on completion');
    assert(/Moto Drop delivered/.test(done.notif), 'Moto Drop completion notification is shown');

    const failed = await page.evaluate(() => {
      const G = window.GAME, main = window.__REALISM_MAIN, v = G.player.inVehicle;
      G.wanted.stars = 0;
      window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyJ' }));
      main.updateQuickDelivery(0.016);
      window.dispatchEvent(new KeyboardEvent('keyup', { code: 'KeyJ' }));
      if (G.input && G.input.endFrame) G.input.endFrame();
      main.updateQuickDelivery(0.016);
      const q = G.quickDrop;
      v.pos.copy(q.markerPos);
      v.mesh.position.copy(v.pos);
      G.player.group.position.copy(v.pos);
      main.updateQuickDelivery(0.1);
      q.timeLeft = 0.01;
      main.updateQuickDelivery(0.2);
      return {
        stage: q.stage,
        lastResult: q.lastResult,
        failReason: q.failReason,
        failures: q.failures,
        streak: q.streak,
        notif: document.getElementById('notif').textContent,
      };
    });
    assert(failed.stage === 'idle' && failed.lastResult === 'failed' && failed.failReason === 'timeout', 'Moto Drop timeout failure returns to idle with failure reason');
    assert(failed.failures >= 1 && failed.streak === 0, 'Moto Drop failure count increments and resets streak');

    console.log('\n[4] driving, collision, camera, and traffic feel');
    const driving = await page.evaluate(() => {
      const G = window.GAME, main = window.__REALISM_MAIN;
      const down = code => window.dispatchEvent(new KeyboardEvent('keydown', { code }));
      const up = code => window.dispatchEvent(new KeyboardEvent('keyup', { code }));
      const sync = v => {
        if (v.mesh) { v.mesh.position.copy(v.pos); v.mesh.rotation.y = v.heading; }
        if (v.group) { v.group.position.copy(v.pos); v.group.rotation.y = v.heading; }
      };
      const cars = G.vehicles.filter(v => v && v.spec && v.boundsHalf && !v.dead && v.spec.kind !== 'boat');
      const playerCar = cars.find(v => ['sedan', 'camry', 'hilux', 'tuktuk'].includes(v.kind)) || cars[0];
      const blocker = cars.find(v => v !== playerCar && !v.isCop) || cars[1];
      const trafficCar = G.vehicles.find(v => v !== playerCar && v !== blocker && v.npc && v.npc.kind === 'traffic' && !v.dead);
      if (!playerCar || !blocker || !trafficCar) throw new Error('not enough vehicles for driving probe');
      for (const v of G.vehicles) {
        if (v !== playerCar && v !== blocker && v !== trafficCar) {
          v.pos.set(-220, 0, -220 - G.vehicles.indexOf(v) * 2);
          v.vel = 0;
          sync(v);
        }
      }
      G.state = 'playing';
      document.getElementById('pause').classList.remove('show');
      G.wanted.stars = 0;
      G.player.inVehicle = playerCar;
      G.player.group.visible = false;
      playerCar.driver = 'player'; playerCar.npc = null; playerCar.dead = false; playerCar.hp = 100;

      playerCar.pos.set(0, 0, -140); playerCar.heading = 0; playerCar.vel = 14;
      playerCar.yawRate = 0; playerCar.steerAngle = 0; playerCar.steerInput = 0; playerCar.throttle = 0; playerCar.brakeInput = 0;
      sync(playerCar); G.player.group.position.copy(playerCar.pos);
      const brakeStart = playerCar.vel;
      down('KeyS');
      for (let i = 0; i < 4; i++) main.updatePlayerInVehicle(0.1);
      up('KeyS');
      if (G.input && G.input.endFrame) G.input.endFrame();
      const brakeVel = playerCar.vel;

      playerCar.pos.set(0, 0, -130); playerCar.heading = 0; playerCar.vel = 8;
      playerCar.yawRate = 0; playerCar.steerAngle = 0; playerCar.steerInput = 0; playerCar.throttle = 0; playerCar.brakeInput = 0;
      sync(playerCar); G.player.group.position.copy(playerCar.pos);
      down('KeyA');
      main.updatePlayerInVehicle(0.1);
      const firstHeading = playerCar.heading;
      const firstYawRate = playerCar.yawRate || 0;
      for (let i = 0; i < 3; i++) main.updatePlayerInVehicle(0.1);
      up('KeyA');
      if (G.input && G.input.endFrame) G.input.endFrame();
      const fourthHeading = playerCar.heading;
      const fourthYawRate = playerCar.yawRate || 0;

      G.camRig.yaw = 0; G.camRig.pitch = -0.05; G.camRig.distance = 4.5; G.camera.fov = 72; G.camera.updateProjectionMatrix();
      G.camRig.targetSmooth = null;
      playerCar.vel = playerCar.spec.topSpeed * 0.72;
      for (let i = 0; i < 10; i++) main.updateCamera(0.1);
      const camera = { fov: G.camera.fov, targetDistance: G.camRig.targetDistance, distance: G.camRig.distance, pitch: G.camRig.pitch };

      playerCar.pos.set(20, 0, -120); playerCar.heading = 0; playerCar.vel = 9; playerCar.hp = 100;
      blocker.pos.set(20, 0, -118.8); blocker.heading = 0; blocker.vel = 0; blocker.hp = 100; blocker.driver = null; blocker.npc = null; blocker.dead = false;
      playerCar._vehHitAt = 0; blocker._vehHitAt = 0; G.camRig.shake = 0;
      sync(playerCar); sync(blocker);
      const gapBefore = Math.hypot(playerCar.pos.x - blocker.pos.x, playerCar.pos.z - blocker.pos.z);
      main.resolveVehicleVsVehicles(playerCar);
      const gapAfter = Math.hypot(playerCar.pos.x - blocker.pos.x, playerCar.pos.z - blocker.pos.z);
      const collision = {
        gapBefore, gapAfter,
        velAfter: playerCar.vel,
        playerHp: playerCar.hp,
        blockerHp: blocker.hp,
        shake: G.camRig.shake || 0,
      };

      if (G.traffic) { G.traffic.ns = 'green'; G.traffic.ew = 'red'; G.traffic.t = 1; }
      playerCar.pos.set(-2.5, 0, -15); playerCar.heading = 0; playerCar.vel = 0; playerCar.driver = 'player'; sync(playerCar);
      G.player.inVehicle = playerCar; G.player.group.position.copy(playerCar.pos);
      trafficCar.pos.set(-2.5, 0, -22); trafficCar.heading = 0; trafficCar.vel = 8;
      trafficCar.npc = trafficCar.npc || { kind: 'traffic' };
      trafficCar.npc.kind = 'traffic'; trafficCar.npc.dir = 0; trafficCar.npc.turnCD = 2; trafficCar.npc.cruiseSpeed = 9; trafficCar.npc.honkCooldown = 99;
      trafficCar.dead = false; trafficCar.driver = null; sync(trafficCar);
      const trafficStart = trafficCar.vel;
      for (let i = 0; i < 5; i++) {
        if (G.traffic) { G.traffic.ns = 'green'; G.traffic.ew = 'red'; G.traffic.t = 1; }
        main.updateTrafficCar(trafficCar, 0.12);
      }
      const traffic = { start: trafficStart, end: trafficCar.vel, z: trafficCar.pos.z, playerZ: playerCar.pos.z };
      return { brakeStart, brakeVel, firstHeading, fourthHeading, firstYawRate, fourthYawRate, camera, collision, traffic };
    });
    assert(driving.brakeVel < driving.brakeStart * 0.72 && driving.brakeVel > -1.5, `vehicle braking cuts speed without snapping into reverse (${driving.brakeStart.toFixed(1)} -> ${driving.brakeVel.toFixed(1)})`);
    assert(Math.abs(driving.firstYawRate) > 0.01 && Math.abs(driving.fourthYawRate) >= Math.abs(driving.firstYawRate), 'steering yaw rate builds smoothly over repeated frames');
    assert(Math.abs(driving.fourthHeading) > Math.abs(driving.firstHeading) * 1.4, 'vehicle heading continues turning as steering input builds');
    assert(driving.camera.fov > 74 && driving.camera.targetDistance > 6, `driving camera responds to speed (FOV ${driving.camera.fov.toFixed(1)}, distance ${driving.camera.targetDistance.toFixed(1)})`);
    assert(driving.collision.gapAfter > driving.collision.gapBefore + 0.2 && driving.collision.velAfter < 7, 'vehicle collision separates overlapping cars and damps player speed');
    assert(driving.collision.playerHp < 100 && driving.collision.blockerHp < 100 && driving.collision.shake > 0, 'vehicle collision applies damage and camera shake');
    assert(driving.traffic.end < driving.traffic.start * 0.65 && driving.traffic.z < driving.traffic.playerZ - 1.5, 'traffic car brakes for the player vehicle ahead');
  } catch (err) {
    errors.push(`harness: ${err.message}`);
  } finally {
    await browser.close();
    server.close();
  }

  if (errors.length) {
    console.error(`\nREALISM PASS TEST FAILED (${errors.length} error${errors.length > 1 ? 's' : ''}):`);
    for (const e of errors) console.error(`  - ${e}`);
    process.exit(1);
  }
  console.log('\nrealism pass test passed');
}

main();

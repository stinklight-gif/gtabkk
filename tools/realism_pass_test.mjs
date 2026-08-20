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
      // Static-only pass: pin the camera to a fixed transform, hide every spawned
      // entity, re-render. Both halves matter — peds/traffic/dogs spawn at random
      // (~40% swing in the live totals) and the camera is wherever the previous
      // probe left it (which changes what frustum culling keeps). With both
      // pinned, what's left is the baked city plus the instanced prop batches
      // from one fixed viewpoint, which is identical every boot and can therefore
      // carry a tight bound instead of a noise-proof loose one.
      const ents = [];
      for (const arr of [G.peds, G.vehicles, G.dogs, G.cops]) {
        for (const e of (arr || [])) if (e && e.mesh && e.mesh.visible) { ents.push(e.mesh); e.mesh.visible = false; }
      }
      const camSave = { p: G.camera.position.clone(), q: G.camera.quaternion.clone() };
      G.camera.position.set(2, 6, 48);
      G.camera.quaternion.identity();
      G.camera.rotateY(Math.PI);
      G.camera.updateMatrixWorld(true);
      G.renderer.render(G.scene, G.camera);
      const staticInfo = { calls: G.renderer.info.render.calls, triangles: G.renderer.info.render.triangles };
      G.camera.position.copy(camSave.p); G.camera.quaternion.copy(camSave.q);
      G.camera.updateMatrixWorld(true);
      for (const m of ents) m.visible = true;
      return { txt, lod, snap, passEval, failEval, staticInfo };
    });
    assert(/VISUAL BUDGET/.test(budget.txt) && /draw calls/.test(budget.txt) && /entities/.test(budget.txt), 'budget overlay exposes FPS/draw calls/entities');
    assert((budget.snap && budget.snap.drawCalls > 0 && budget.snap.visibleMeshes > 0), 'budget snapshot has live render and mesh counts');
    assert((budget.snap && budget.snap.budgets && budget.snap.budgets.drawCalls && budget.snap.budgets.farLodEntities), 'budget snapshot exposes pass/fail threshold results');
    assert(budget.passEval && budget.passEval.pass === true && budget.passEval.status === 'ok', 'budget evaluator passes an in-budget synthetic scene');
    assert(budget.failEval && budget.failEval.pass === false && budget.failEval.status === 'bad' && budget.failEval.fps.pass === false, 'budget evaluator fails an over-budget synthetic scene');
    assert((budget.lod.vehicleLow || 0) > 0 || (budget.lod.pedLow || 0) > 0, 'near/far LOD counters are active');

    // --- live scene against the real budget ---
    // Everything above this point tests the budget *evaluator* on synthetic
    // numbers; nothing tested the actual scene. That is how the live triangle
    // count drifted to ~575k against a documented 450k ceiling without any build
    // going red — and it stayed invisible because smoke.mjs was reading
    // renderer.info AFTER the bloom composite and printing "1".
    console.log(`    live scene: ${budget.snap.drawCalls} draw calls, ${budget.snap.triangles} triangles`);
    assert(budget.snap.triangles <= 450000, `live triangle count within budget (${budget.snap.triangles} <= 450000)`);
    // Draw calls are NOT within the documented 900 target — the live figure here
    // ranges ~800-1420 depending on how the crowd happened to spawn, and a 4-star
    // night chase reaches ~1.6k. This bound is a regression ratchet, not a claim
    // the budget is met; see README "Performance" for the open gap, and lower it
    // as the gap closes rather than raising it to make a change fit. It sits well
    // clear of the observed spread on purpose: a bound inside the noise is a test
    // that fails at random, which is worse than no test. The tight guard is the
    // static one below, which does not move between runs.
    assert(budget.snap.drawCalls <= 1800, `live draw calls no worse than the current ratchet (${budget.snap.drawCalls} <= 1800, target is 900)`);
    console.log(`    static city: ${budget.staticInfo.calls} draw calls, ${budget.staticInfo.triangles} triangles`);
    // The tight guards. Bounds sit ~10-20% above the observed spread because the
    // city itself is procedurally generated per boot (building heights, parked-bike
    // cluster counts), so even a pinned camera moves by a couple of percent.
    assert(budget.staticInfo.calls <= 400, `static city draw calls held (${budget.staticInfo.calls} <= 400)`);
    assert(budget.staticInfo.triangles <= 420000, `static city triangles held (${budget.staticInfo.triangles} <= 420000)`);

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
      const collisionStartVel = playerCar.vel;
      blocker.pos.set(20, 0, -118.8); blocker.heading = 0; blocker.vel = 0; blocker.hp = 100; blocker.driver = null; blocker.npc = null; blocker.dead = false;
      playerCar._vehHitAt = 0; blocker._vehHitAt = 0; blocker._impactVX = 0; blocker._impactVZ = 0; blocker._impactSpin = 0; G.camRig.shake = 0;
      sync(playerCar); sync(blocker);
      const gapBefore = Math.hypot(playerCar.pos.x - blocker.pos.x, playerCar.pos.z - blocker.pos.z);
      main.resolveVehicleVsVehicles(playerCar);
      const gapAfter = Math.hypot(playerCar.pos.x - blocker.pos.x, playerCar.pos.z - blocker.pos.z);
      const collision = {
        gapBefore, gapAfter,
        velBefore: collisionStartVel,
        velAfter: playerCar.vel,
        targetImpact: Math.hypot(blocker._impactVX || 0, blocker._impactVZ || 0),
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
    // Absolute decel band, not a ratio: the probe picks its car with a `find` over
    // G.vehicles, so which spec it gets depends on spawn ordering, and the old
    // `< brakeStart * 0.72` bound sat within ~2% of the result for some of them.
    // "Sheds real speed without snapping into reverse" is what we actually mean.
    assert(driving.brakeVel < driving.brakeStart - 3.0 && driving.brakeVel > -1.5, `vehicle braking cuts speed without snapping into reverse (${driving.brakeStart.toFixed(1)} -> ${driving.brakeVel.toFixed(1)})`);
    assert(Math.abs(driving.firstYawRate) > 0.01 && Math.abs(driving.fourthYawRate) >= Math.abs(driving.firstYawRate), 'steering yaw rate builds smoothly over repeated frames');
    assert(Math.abs(driving.fourthHeading) > Math.abs(driving.firstHeading) * 1.4, 'vehicle heading continues turning as steering input builds');
    assert(driving.camera.fov > 74 && driving.camera.targetDistance > 6, `driving camera responds to speed (FOV ${driving.camera.fov.toFixed(1)}, distance ${driving.camera.targetDistance.toFixed(1)})`);
    assert(driving.collision.gapAfter > driving.collision.gapBefore + 0.2 && driving.collision.velAfter < driving.collision.velBefore && driving.collision.targetImpact > 2, 'vehicle collision separates cars, damps the player, and shoves the target');
    assert(driving.collision.playerHp < 100 && driving.collision.blockerHp < 100 && driving.collision.shake > 0, 'vehicle collision applies damage and camera shake');
    assert(driving.traffic.end < driving.traffic.start * 0.65 && driving.traffic.z < driving.traffic.playerZ - 1.5, 'traffic car brakes for the player vehicle ahead');

    console.log('\n[5] weight and consequence');
    const weight = await page.evaluate(() => {
      const G = window.GAME, main = window.__REALISM_MAIN;
      const down = code => window.dispatchEvent(new KeyboardEvent('keydown', { code }));
      const up = code => window.dispatchEvent(new KeyboardEvent('keyup', { code }));
      // Spawn a known car rather than inheriting whatever the driving probe's
      // `find` happened to land on. The eligible kinds are not interchangeable —
      // a tuktuk is 350 kg and turns at 2.0, a hilux is 1800 kg and turns at 1.6,
      // and reset(16) is top speed for one and mid-range for the other. Which one
      // spawned first is down to random traffic, so the friction-circle numbers
      // moved run to run (coasting seen anywhere from 0.115 to 0.270) and the
      // braking-vs-coasting ordering occasionally inverted. Pinning the kind is
      // what makes this section reproducible.
      const car = main.makeVehicle('camry', G.scene);
      car.driver = 'player'; car.npc = null; car.dead = false; car.hp = 100;
      car.pos.set(0, 0, -140); car.heading = 0;
      if (car.mesh) { car.mesh.position.copy(car.pos); car.mesh.rotation.y = 0; }
      G.player.inVehicle = car;
      G.player.group.visible = false;
      const spec = car.spec;
      const reset = v => {
        car.pos.set(0, 0, -140); car.heading = 0; car.vel = v;
        car.yawRate = 0; car.steerAngle = 0; car.steerInput = 0;
        car.throttle = 0; car.brakeInput = 0; car.latVel = 0; car._aLong = 0;
        car.mesh.position.copy(car.pos); car.mesh.rotation.y = car.heading;
        G.player.group.position.copy(car.pos);
      };
      const clearKeys = () => { for (const k of ['KeyW','KeyA','KeyS','KeyD']) up(k); if (G.input && G.input.endFrame) G.input.endFrame(); };
      // updatePlayerInVehicle resolves building collisions, so a long open-throttle run
      // would drive the car across the city and into a wall. Re-pin it to the same
      // clear spot every step — we're measuring the speed curve, not the map.
      const stepPinned = (n, dt) => {
        for (let i = 0; i < n; i++) {
          main.updatePlayerInVehicle(dt);
          car.pos.set(0, 0, -140); car.heading = 0;
          car.mesh.position.copy(car.pos); car.mesh.rotation.y = 0;
          G.player.group.position.copy(car.pos);
        }
      };

      // --- accel taper: the engine must pull harder low than near the top ---
      reset(0); down('KeyW');
      stepPinned(6, 0.1);   // let throttle ease in
      let v0 = car.vel;
      stepPinned(10, 0.1);
      const gainLow = car.vel - v0;
      const velLow = car.vel;
      reset(spec.topSpeed * 0.85); car.throttle = 1;
      stepPinned(6, 0.1);
      v0 = car.vel;
      stepPinned(10, 0.1);
      const gainHigh = car.vel - v0;

      // --- terminal velocity: drag must replace the clamp, not break topSpeed ---
      reset(0);
      let overshoot = 0;
      for (let i = 0; i < 60; i++) { stepPinned(5, 0.1); overshoot = Math.max(overshoot, car.vel); }
      const terminal = car.vel;
      clearKeys();

      // --- friction circle: braking mid-corner must cost lateral grip ---
      const cornerRun = brake => {
        reset(16); car.steerInput = 1; car.steerAngle = 0.3;
        if (brake) down('KeyS');
        for (let i = 0; i < 6; i++) { car.steerInput = 1; main.updatePlayerInVehicle(0.08); }
        if (brake) up('KeyS');
        if (G.input && G.input.endFrame) G.input.endFrame();
        return Math.abs(car.heading);
      };
      const turnCoast = cornerRun(false);
      const turnBraking = cornerRun(true);
      clearKeys();

      // --- line of sight through a real building ---
      const p = G.player.group.position;
      const b = G.world.buildings.find(x => x.size.y > 6) || G.world.buildings[0];
      const nx = b.pos.x + b.size.x / 2 + 3, nz = b.pos.z;
      const fx = b.pos.x - b.size.x / 2 - 3;
      const losThrough = main.hasLineOfSight(nx, 1.5, nz, fx, 1.5, nz);          // straight through it
      const losClear = main.hasLineOfSight(nx, 1.5, nz, nx + 6, 1.5, nz);        // along the open side

      // --- heat accumulates with the size of the crime ---
      G.policeOff = false;
      G.wanted.stars = 0; G.wanted.crime = 0;
      main.raiseWanted(2, 2);
      const starsOnce = G.wanted.stars;
      for (let i = 0; i < 12; i++) main.raiseWanted(2, 5);
      const starsSpree = G.wanted.stars;
      const crimeSpree = G.wanted.crime;

      return {
        gainLow, gainHigh, velLow, terminal, overshoot, topSpeed: spec.topSpeed,
        turnCoast, turnBraking, losThrough, losClear,
        starsOnce, starsSpree, crimeSpree,
      };
    });
    assert(weight.gainHigh > 0 && weight.gainHigh < weight.gainLow * 0.6, `engine pull tapers with speed (low +${weight.gainLow.toFixed(2)} from ${weight.velLow.toFixed(1)} vs high +${weight.gainHigh.toFixed(2)} m/s)`);
    assert(weight.terminal > weight.topSpeed * 0.9 && weight.overshoot <= weight.topSpeed * 1.03, `drag settles at spec top speed without a clamp (${weight.terminal.toFixed(1)} of ${weight.topSpeed}, peak ${weight.overshoot.toFixed(1)})`);
    assert(weight.turnBraking < weight.turnCoast, `braking mid-corner costs lateral grip (turned ${weight.turnBraking.toFixed(3)} braking vs ${weight.turnCoast.toFixed(3)} coasting)`);
    assert(weight.losThrough === false && weight.losClear === true, 'line of sight is blocked by a building and clear in the open');
    assert(weight.starsSpree > weight.starsOnce, `wanted heat accumulates with the spree (${weight.starsOnce}★ once -> ${weight.starsSpree}★ after 12, ${weight.crimeSpree} pts)`);

    console.log('\n[6] on-foot weight and fall damage');
    const foot = await page.evaluate(() => {
      const G = window.GAME, main = window.__REALISM_MAIN;
      const p = G.player;
      const place = (y, vy) => {
        G.player.inVehicle = null; p.group.visible = true;
        p.group.position.set(0, y, -140);
        p.velocity.set(0, vy, 0);
        p.hp = p.hpMax; p.armor = 0; p.grounded = false; p._fallV = 0; p.landStunT = 0;
      };
      const settle = () => { for (let i = 0; i < 200 && !p.grounded; i++) main.updatePlayer(1 / 60); };

      place(20, 0); settle();
      const hpBigDrop = p.hp;
      place(0.9, 0); settle();
      const hpStepDown = p.hp;
      place(0, 5.0); p.grounded = false; settle();      // a normal jump arc
      const hpJump = p.hp;

      // dt-invariance: the same second of acceleration at two step sizes
      const runAccel = (steps, dt) => {
        p.group.position.set(0, 0, -140); p.velocity.set(0, 0, 0); p.grounded = true;
        window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyW' }));
        for (let i = 0; i < steps; i++) main.updatePlayer(dt);
        window.dispatchEvent(new KeyboardEvent('keyup', { code: 'KeyW' }));
        if (G.input && G.input.endFrame) G.input.endFrame();
        return Math.hypot(p.velocity.x, p.velocity.z);
      };
      const fast = runAccel(60, 1 / 60);
      const slow = runAccel(15, 1 / 15);
      return { hpBigDrop, hpStepDown, hpJump, hpMax: p.hpMax, fast, slow };
    });
    assert(foot.hpBigDrop < foot.hpMax && foot.hpBigDrop > 0, `a long fall hurts without being an instant kill (${foot.hpBigDrop.toFixed(0)}/${foot.hpMax} HP)`);
    assert(foot.hpStepDown === foot.hpMax, 'a step down off a kerb costs nothing');
    assert(foot.hpJump === foot.hpMax, 'a normal jump costs nothing');
    assert(Math.abs(foot.fast - foot.slow) < Math.max(0.35, foot.fast * 0.08), `on-foot acceleration is frame-rate independent (${foot.fast.toFixed(2)} at 60 Hz vs ${foot.slow.toFixed(2)} at 15 Hz)`);
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

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
  '.gltf': 'model/gltf+json', '.bin': 'application/octet-stream',
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
    page.on('pageerror', err => errors.push(`pageerror: ${err.message}${err.stack ? ' | ' + String(err.stack).split('\n').slice(0, 4).join(' > ') : ''}`));
    page.on('console', msg => { if (msg.type() === 'error') errors.push(`console.error: ${msg.text()}`); });

    console.log(`serving ${ROOT} on :${PORT}, booting game...`);
    await page.goto(`http://127.0.0.1:${PORT}/?debug=1&smoke=1`, { waitUntil: 'commit', timeout: 180_000 });
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
      window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyY' }));
      main.updateQuickDelivery(0.016);
      window.dispatchEvent(new KeyboardEvent('keyup', { code: 'KeyY' }));
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

    const done = await page.evaluate(() => {
      const G = window.GAME, q = G.quickDrop, v = G.player.inVehicle;
      v.pos.copy(q.dest);
      v.mesh.position.copy(v.pos);
      G.player.group.position.copy(v.pos);
      window.__REALISM_MAIN.updateQuickDelivery(0.1);
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
      window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyY' }));
      main.updateQuickDelivery(0.016);
      window.dispatchEvent(new KeyboardEvent('keyup', { code: 'KeyY' }));
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
      let playerCar = cars.find(v => ['sedan', 'camry', 'hilux'].includes(v.kind));
      if (!playerCar) { playerCar = main.makeVehicle('camry', G.scene); playerCar.pos.set(0, 0, -140); }
      let blocker = cars.find(v => v !== playerCar && !v.isCop && v.spec.kind !== 'bike' && v.spec.kind !== 'bus');
      if (!blocker) { blocker = main.makeVehicle('sedan', G.scene); blocker.pos.set(20, 0, -100); }
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
      // Probe [4] leaves whatever sedan/camry/hilux `find` hit, plus collision
      // impulses and whatever weather the boot rolled. A leftover _impactVX
      // shoves the pinned car off x=0 onto the kerb, and kerbScrub then
      // settles well short of spec.topSpeed * 0.9 (CI: 20.9 of 24).
      G.time.weather = 'clear';
      G.time.rainStrength = 0;
      G._rainTarget = 0;
      // Occupied slice: wanderers and traffic can stand on the pin strip at
      // (0,-150) and steal engine pull / terminal speed. Shove them aside.
      const clearPin = () => {
        for (const ped of G.peds || []) {
          if (!ped || !ped.mesh) continue;
          if (Math.hypot(ped.mesh.position.x, ped.mesh.position.z + 150) < 14) {
            ped.mesh.position.set(90, 0, 90);
            if (ped.anchor && ped.anchor.slot) ped.anchor.slot.set(90, 0, 90);
          }
        }
        for (const v of G.vehicles || []) {
          if (!v || v === G.player.inVehicle || !v.pos) continue;
          if (Math.hypot(v.pos.x, v.pos.z + 150) < 14) {
            v.pos.set(80, 0, 80);
            if (v.mesh) v.mesh.position.copy(v.pos);
          }
        }
      };
      clearPin();
      let car = main.makeVehicle('camry', G.scene);
      G.player.inVehicle = car;
      car.driver = 'player';
      car.npc = null;
      const spec = car.spec;
      const reset = v => {
        car.pos.set(0, 0, -150); car.heading = 0; car.vel = v;
        car.yawRate = 0; car.steerAngle = 0; car.steerInput = 0;
        car.throttle = 0; car.brakeInput = 0; car.latVel = 0; car._aLong = 0;
        car._impactVX = 0; car._impactVZ = 0; car._impactSpin = 0;
        car.hp = 100; car._burning = false; car.dead = false; car.tiresBlown = false;
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
          car.pos.set(0, 0, -150); car.heading = 0;
          car.mesh.position.copy(car.pos); car.mesh.rotation.y = 0;
          G.player.group.position.copy(car.pos);
          car._impactVX = 0; car._impactVZ = 0; car._impactSpin = 0;
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

    console.log('\n[7] P0 gameplay flags default on');
    const flags = await page.evaluate(() => {
      const g = window.GAME.gameplay || {};
      return g;
    });
    for (const k of ['pedWalkways','pedBuildingCollision','pedCrosswalks','monkHeat','dogRoadLife','trafficDensity','trafficDestinations','bikeFilterWide','vehicleKindFeel','fakeRpm','vehicleLimp','kerbScrub','sois','yaowaratCarHostility','floodPatches','heatHaze','spatialSiren','districtBeds','watHeatSink','honestAmmo','speedo','gamepad','tach','bikeLowside','coverVehicles','gltf','cover','clinch','btsHijack','fireAtTen','allRed','airport','btsRide','talkChase','yaowaratNight','boatHijack','sevenInterior','motosai','motosaiStands','burningHaze','schoolKids','seekShade','stallSit','spiritWai','soiCats','btsPlatform','bikeHelmets','officeCommute','afternoonStorm','crossingGuard','btsMotosai','rainPack','btsSongthaew','iceCart','btsTuktuk','khlongMonitor','stallGecko','soiFootball','mallShoppers','lottery','watChant','coconutCart','soiLaundry','nightCheckpoint','sevenBikes','hyacinth','btsSitters','mooPing','watTurtles','sevenGuard','soiPa','soiChairs','soiMechanic','copSoiBlock','floodSois','dawnAlms','soiCowboy','phonePlaces','longtailChase','boatNoodle','twoAmCheckpoint','somTam','btsMalai','cowboyClose','plaKat','chaYen','soiBarber','btsGates','soiWires','rainFrogs','soiCctv','rotiCart','rainPoncho','bikeSeatCover','watBell','stallIncense','mangoSticky','watBats','yaoPhotos','kanomKrok','squidGrill','songthaewRiders','watSweep','yaoGold','sevenAtm','btsBusker','watRobes','btsPigeons','watLotus','watCats','sevenShoppers','watFeed','btsPaper','yaoDuck','sevenSlush','phromFruit','pierWait','btsShine','watAmulet','yaoFortune','watDrum','mallGuard','bankGuard','mallDir','officeSmoke','bankQueue','mallFood','gunClerk','mallTech','mallPharm','mallRoma','mallWatch','mallManga','mallSushi','mallCafe','mallThreads','mallSeven','mallArcade','gymBag','starterClerk','homeAuntie','stationPorter','garageMech','klongDock','sengClerk','airportCrew','airportCargo','airportTower','airportTaxi']) {
      assert(flags[k] === true, `GAMEPLAY.${k} defaults on`);
    }
    assert(flags.rapier === false, 'GAMEPLAY.rapier stays off until arcade bands are matched');

    console.log('\n[8] P1 pedestrians vs buildings + walkways');
    const peds = await page.evaluate(() => {
      const G = window.GAME, main = window.__REALISM_MAIN;
      const ways = (G.world.walkways || []).length;
      const wanderer = G.peds.find(p => !p.dead && !p.anchor && !p.gang && !p.isMugger && !p.isTarget && !p.pillion && !p.motosaiRider && !p.motosaiWait && !p.school && !p.btsWait && !p.commute && !p.crossingGuard && !p.iceCart && !p.football && !p.mallShop && !p.lottery && !p.coconutCart && !p.songthaewRide && !p.watSweep && !p.yaoGold && !p.yaoDuck && !p.yaoFortune && !p.sevenAtm && !p.btsBusker && !p.watLotus && !p.watAmulet && !p.watDrum && !p.sevenShop && !p.sevenSlush && !p.btsPaper && !p.phromFruit && !p.pierWait && !p.btsShine && !p.mallGuard && !p.bankGuard && !p.mallDir && !p.gunClerk && !p.officeSmoke && !p.bankQueue && !p.mallFood && !p.mallTech && !p.mallPharm && !p.mallRoma && !p.mallWatch && !p.mallManga && !p.mallSushi && !p.mallCafe && !p.mallThreads && !p.mallSeven && !p.mallArcade && !p.gymBag && !p.starterClerk && !p.homeAuntie && !p.stationPorter && !p.garageMech && !p.klongDock && !p.sengClerk && !p.airportCrew && !p.airportCargo && !p.airportTower && !p.airportTaxi);
      const b = G.world.buildings.find(x => x.size.y > 8 && x.size.x > 4 && x.size.z > 4) || G.world.buildings[0];
      const insideBefore = wanderer && b && Math.abs(wanderer.mesh.position.x - b.pos.x) < b.size.x / 2 && Math.abs(wanderer.mesh.position.z - b.pos.z) < b.size.z / 2;
      if (wanderer && b) {
        wanderer.mesh.position.set(b.pos.x, 0, b.pos.z);
        wanderer.anchor = null; wanderer.panicT = 0; wanderer.gang = false;
        main.updatePeds(0.05);
      }
      const p = wanderer && wanderer.mesh.position;
      const outside = p && b && (Math.abs(p.x - b.pos.x) >= b.size.x / 2 - 0.02 || Math.abs(p.z - b.pos.z) >= b.size.z / 2 - 0.02);
      return { ways, outside, hadPed: !!wanderer, insideBefore };
    });
    assert(peds.ways > 20, `walkways authored (${peds.ways})`);
    assert(peds.hadPed && peds.outside, 'wanderer pushed out of a building AABB');

    console.log('\n[9] P2 traffic density vs time of day');
    const traf = await page.evaluate(() => {
      const G = window.GAME, main = window.__REALISM_MAIN;
      const count = () => G.vehicles.filter(v => v && v.npc && v.npc.kind === 'traffic' && !v.isCop && v.driver !== 'player' && !v.dead).length;
      G.time.dayT = 0.13;
      for (let i = 0; i < 40; i++) main.updateTrafficPopulation(0.2);
      const n3 = count();
      G.time.dayT = 0.35;
      for (let i = 0; i < 40; i++) main.updateTrafficPopulation(0.2);
      const n8 = count();
      return { n3, n8 };
    });
    assert(traf.n8 > traf.n3, `rush hour has more ambient cars than 3am (${traf.n8} vs ${traf.n3})`);

    console.log('\n[10] P3 per-kind feel + limp');
    const feel = await page.evaluate(() => {
      const G = window.GAME, main = window.__REALISM_MAIN;
      const specs = {};
      for (const kind of ['tuktuk', 'camry', 'supercar', 'bike']) {
        let v = G.vehicles.find(x => x && x.spec && x.spec.kind === kind);
        if (!v) { v = main.makeVehicle(kind, G.scene); v.pos.set(-200, 0, -200); }
        specs[kind] = { floor: v.spec.frictionFloor, powerYaw: v.spec.powerYaw, grip: v.spec.grip };
      }
      const car = G.player.inVehicle || G.vehicles.find(v => v.spec && v.spec.kind !== 'boat');
      car.hp = 20; car.pos.set(0, 0, -140); car.heading = 0; car.vel = 0; car.throttle = 1;
      G.player.inVehicle = car; car.driver = 'player';
      const down = code => window.dispatchEvent(new KeyboardEvent('keydown', { code }));
      const up = code => window.dispatchEvent(new KeyboardEvent('keyup', { code }));
      down('KeyW');
      for (let i = 0; i < 20; i++) {
        main.updatePlayerInVehicle(0.1);
        car.pos.set(0, 0, -140); car.heading = 0;
      }
      const limpVel = car.vel;
      up('KeyW'); if (G.input && G.input.endFrame) G.input.endFrame();
      car.hp = 100; car.vel = 0; car.throttle = 0;
      return { specs, limpVel, top: car.spec.topSpeed };
    });
    assert(feel.specs.tuktuk && feel.specs.supercar && feel.specs.tuktuk.floor > feel.specs.supercar.floor, 'tuk-tuk friction floor is more forgiving than supercar');
    assert(feel.specs.tuktuk.powerYaw > 0, 'tuk-tuk has power-oversteer yaw');
    assert(feel.limpVel < feel.top * 0.7, `limping car is slower than spec top (${feel.limpVel.toFixed(1)} of ${feel.top})`);

    console.log('\n[11] P4 sois + flood');
    const world = await page.evaluate(() => {
      const G = window.GAME;
      return {
        sois: (G.world.sois || []).length,
        flood: (G.world.flood || []).length,
        walkways: (G.world.walkways || []).length,
      };
    });
    assert(world.sois >= 4, `sois cut through blocks (${world.sois})`);
    assert(world.flood >= 2, `flood patches exist (${world.flood})`);

    console.log('\n[12] P5 audio world API');
    const aud = await page.evaluate(() => {
      const a = window.GAME.audio || {};
      return {
        updateWorld: typeof a.updateWorld === 'function',
        btsChime: typeof a.btsChime === 'function',
        scrape: typeof a.scrape === 'function',
        stations: (a.radio && a.radio.names) || [],
      };
    });
    assert(aud.updateWorld && aud.btsChime && aud.scrape, 'spatial/district/BTS/scrape audio hooks exist');
    assert(aud.stations.indexOf('WAT RADIO') >= 0, 'Wat Radio station exists');

    console.log('\n[13] P6 missions use the city');
    const miss = await page.evaluate(() => {
      const G = window.GAME;
      const names = G.mission && G.mission.missions ? Object.keys(G.mission.missions) : [];
      G.mission.start('bout');
      const bout = G.mission.active && G.mission.active.name;
      G.mission.start('monsoon');
      const monsoon = G.mission.active && G.mission.active.name;
      const rain = G.time.rainStrength;
      return { names, bout, monsoon, rain };
    });
    assert(miss.names.indexOf('bout') >= 0 && miss.names.indexOf('monsoon') >= 0, 'Lumpinee and Monsoon missions exist');
    assert(/Lumpinee|Bout/i.test(miss.bout), `bout starts (${miss.bout})`);
    assert(/Monsoon/i.test(miss.monsoon) && miss.rain > 0.5, `monsoon starts and forces rain (${miss.monsoon}, rain ${miss.rain})`);

    console.log('\n[14] P7 honest ammo HUD + speedo');
    const ui = await page.evaluate(() => {
      const G = window.GAME, main = window.__REALISM_MAIN;
      G.player.weapons.pistol = true; G.player.activeWeapon = 'pistol';
      G.player.pistolAmmo = 12; G.player.pistolReserve = 36;
      main.updateAmmoHud();
      const ammo = document.getElementById('ammo-line').textContent;
      const sub = document.getElementById('ammo-sub').textContent;
      const v = G.vehicles.find(x => x && x.spec && x.spec.kind !== 'boat');
      G.player.inVehicle = v; v.driver = 'player'; v.vel = 10;
      if (G.hud.setSpeed) G.hud.setSpeed(v.vel, true, 0.6);
      const speedo = document.getElementById('speedo');
      const tachRow = document.getElementById('tach-row');
      const tach = document.getElementById('tach-fill');
      return {
        ammo, sub,
        speedShown: speedo && speedo.style.display !== 'none',
        speedText: speedo && speedo.textContent,
        tachShown: tachRow && tachRow.style.display !== 'none',
        tachW: tach && tach.style.width,
      };
    });
    assert(/12/.test(ui.ammo) && /36/.test(ui.ammo), `ammo HUD shows mag | reserve ("${ui.ammo}")`);
    assert(ui.speedShown && /km\/h/.test(ui.speedText), `speedo shows km/h ("${ui.speedText}")`);
    assert(ui.tachShown && parseFloat(ui.tachW) > 0, `tach bar visible ("${ui.tachW}")`);

    console.log('\n[15] P8.0 bike lowside + vehicle LOS');
    const p80 = await page.evaluate(() => {
      const G = window.GAME, main = window.__REALISM_MAIN;
      const bike = G.vehicles.find(v => v && v.spec && v.spec.kind === 'bike' && !v.dead) || main.makeVehicle('bike', G.scene);
      G.player.inVehicle = bike; bike.driver = 'player'; bike.npc = null;
      bike.pos.set(0, 0, -140); bike.heading = 0; bike.vel = 12; bike.latVel = 9; bike.hp = 100;
      bike.mesh.position.copy(bike.pos);
      main.updatePlayerInVehicle(0.05);
      const dumped = G.player.inVehicle === null;
      const bus = G.vehicles.find(v => v && v.spec && v.spec.kind === 'bus') || main.makeVehicle('bus', G.scene);
      bus.pos.set(20, 0, -120); bus.heading = 0; bus.dead = false;
      if (bus.boundsHalf) {
        /* keep */
      }
      const blocked = main.hasLineOfSight(20, 1.5, -130, 20, 1.5, -110);
      const clear = main.hasLineOfSight(-40, 1.5, -80, -40, 1.5, -70);
      return { dumped, blocked, clear, weatherCycle: true };
    });
    assert(p80.dumped, 'extreme bike latVel dumps the player (lowside)');
    assert(p80.blocked === false, 'line of sight is blocked by a vehicle AABB');
    assert(p80.clear === true, 'open ground still has line of sight');

    console.log('\n[16] P8.1 hero GLTF bike');
    await page.waitForFunction(() => {
      const G = window.GAME;
      if (!G.gameplay.gltf) return true;
      const bike = G.vehicles.find(v => v && v.kind === 'bike' && v.mesh);
      return !!(bike && bike.mesh.getObjectByName('gltf-hero'));
    }, null, { timeout: 20_000 }).catch(() => {});
    const gltf = await page.evaluate(() => {
      const G = window.GAME;
      const bike = G.vehicles.find(v => v && v.kind === 'bike' && v.mesh);
      return {
        flag: !!(G.gameplay && G.gameplay.gltf),
        hero: !!(bike && bike.mesh.getObjectByName('gltf-hero')),
      };
    });
    assert(gltf.flag && gltf.hero, 'hero Wave GLTF attached as gltf-hero on a bike');

    console.log('\n[17] P8.2 Klong Toey pocket + Customs');
    const port = await page.evaluate(() => {
      const G = window.GAME;
      G.player.group.position.set(-150, 0, 150);
      window.__REALISM_MAIN.updateDistrict();
      const names = G.mission && G.mission.missions ? Object.keys(G.mission.missions) : [];
      G.mission.start('customs');
      return {
        district: G._districtName,
        poi: !!(G.world.poi && G.world.poi.klongToey),
        names,
        mission: G.mission.active && G.mission.active.name,
        buildings: G.world.buildings.length,
      };
    });
    assert(port.poi && port.district === 'Klong Toey', `Klong Toey banner/POI (${port.district})`);
    assert(port.names.indexOf('customs') >= 0 && /Customs/i.test(port.mission), 'Customs Issue starts');

    console.log('\n[18] follow-on cover/clinch/cleaver/alms/fire/radio');
    const more = await page.evaluate(() => {
      const G = window.GAME;
      const stations = (G.audio.radio && G.audio.radio.names) || [];
      return {
        cover: !!G.gameplay.cover,
        clinch: !!G.gameplay.clinch,
        gym: !!(G.world.poi && G.world.poi.gym),
        cleaver: !!(G.world.cleaver && G.world.cleaver.mesh),
        bottle: !!(G.world.bottle),
        morlam: stations.indexOf('MOR LAM EXPRESS') >= 0,
        cowboy: stations.indexOf('SOI COWBOY CLASSICS') >= 0,
        nightSoi: !!(G.mission.missions && G.mission.missions.nightSoi),
        fireAtTen: !!G.gameplay.fireAtTen,
        rapierOff: G.gameplay.rapier === false,
      };
    });
    assert(more.cover && more.clinch && more.gym && more.cleaver && more.bottle, 'cover, clinch, gym, cleaver, bottle exist');
    assert(more.morlam && more.cowboy, 'Mor Lam and Soi Cowboy stations exist');
    assert(more.nightSoi && more.fireAtTen && more.rapierOff, 'night race + fire-at-10 + rapier off');

    console.log('\n[19] Suvarnabhumi pocket + ground taxi');
    const bkk = await page.evaluate(() => {
      const G = window.GAME, main = window.__REALISM_MAIN;
      const plane = G.vehicles.find(v => v && v.kind === 'airliner' && v.playerJet) || G.vehicles.find(v => v && v.kind === 'airliner');
      const n = G.vehicles.filter(v => v && v.kind === 'airliner' && !v.dead).length;
      G.player.group.position.set(220, 0, 0);
      main.updateDistrict();
      let moved = 0, turned = 0;
      if (plane) {
        G.player.inVehicle = plane; plane.driver = 'player'; plane.npc = null;
        plane.pos.set(237, 0, -40); plane.heading = 0; plane.vel = 0; plane.hp = 220;
        plane.throttle = 1; plane.steerAngle = 0; plane.yawRate = 0; plane.latVel = 0;
        plane.mesh.position.copy(plane.pos); plane.mesh.rotation.y = 0;
        window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyW' }));
        for (let i = 0; i < 20; i++) main.updatePlayerInVehicle(0.1);
        moved = plane.pos.z + 40;
        window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyA' }));
        plane.steerInput = 1;
        for (let i = 0; i < 16; i++) main.updatePlayerInVehicle(0.1);
        window.dispatchEvent(new KeyboardEvent('keyup', { code: 'KeyW' }));
        window.dispatchEvent(new KeyboardEvent('keyup', { code: 'KeyA' }));
        if (G.input && G.input.endFrame) G.input.endFrame();
        turned = Math.abs(plane.heading);
      }
      return {
        flag: !!(G.gameplay && G.gameplay.airport),
        poi: !!(G.world.poi && G.world.poi.suvarnabhumi),
        district: G._districtName,
        n,
        moved,
        turned,
        kind: plane && plane.spec && plane.spec.kind,
      };
    });
    assert(bkk.flag && bkk.poi && bkk.district === 'Suvarnabhumi', `Suvarnabhumi banner/POI (${bkk.district})`);
    assert(bkk.n >= 3 && bkk.kind === 'airliner', `parked airliners exist (${bkk.n})`);
    assert(bkk.moved > 1.5, `player can taxi an airliner on the ground (dz ${bkk.moved.toFixed(1)})`);
    assert(bkk.turned > 0.04, `player can steer an airliner on the ground (heading ${bkk.turned.toFixed(3)})`);

    console.log('\n[20] BTS commute ride + next stop');
    const bts = await page.evaluate(() => {
      const G = window.GAME, main = window.__REALISM_MAIN;
      const stops = (G.bts && G.bts.stops) || [];
      G.player.inVehicle = null;
      G.player.group.position.set(-50, 14, 0);
      G.bts.mesh.position.x = -50; G.bts.dir = 1;
      G._btsRide = { from: -50, armed: true };
      G.bts.mesh.position.x = 100;
      main.updateBTS(0.05);
      return {
        nStops: stops.length,
        dumped: !G._btsRide,
        x: G.player.group.position.x,
        y: G.player.group.position.y,
        visible: G.player.group.visible,
      };
    });
    assert(bts.nStops >= 2, `BTS has a next stop (${bts.nStops} stations)`);
    assert(bts.dumped && bts.visible && Math.abs(bts.x - 100) < 12 && bts.y > 12, `commute dumps at the next platform (x=${bts.x.toFixed(1)} y=${bts.y.toFixed(1)})`);

    console.log('\n[21] Talk Radio chase call-out');
    const talk = await page.evaluate(() => {
      const G = window.GAME, main = window.__REALISM_MAIN;
      const car = G.vehicles.find(v => v && v.spec && v.spec.kind === 'camry') || G.vehicles[0];
      G.player.inVehicle = car; car.driver = 'player';
      G.wanted.stars = 3; G._districtName = 'Sukhumvit'; G._talkChaseOn = false; G._talkChaseT = 0;
      const names = G.audio.radio.names;
      let guard = 0;
      while (names[G.audio.radio.station] !== 'TALK RADIO AM' && guard++ < 12) G.audio.radio.next();
      main.updateRadio(0.2);
      const on = !!G._talkChaseOn;
      G.wanted.stars = 0;
      main.updateRadio(0.2);
      const off = !G._talkChaseOn;
      G.player.inVehicle = null; car.driver = null;
      return { on, off, station: names[G.audio.radio.station] };
    });
    assert(talk.station === 'TALK RADIO AM' && talk.on && talk.off, `Talk Radio mentions the chase then clears (${talk.station})`);

    console.log('\n[22] Yaowarat night market');
    const yao = await page.evaluate(() => {
      const G = window.GAME, main = window.__REALISM_MAIN;
      G.time.dayT = 20 / 24;
      main.updateYaowaratNight(0.2);
      const nightOn = !!(G.world.yaowaratNight && G.world.yaowaratNight.group && G.world.yaowaratNight.group.visible);
      const crate = !!(G.world.yaowaratCrate && G.world.yaowaratCrate.mesh);
      G.time.dayT = 0.4;
      main.updateYaowaratNight(0.2);
      const dayOff = !(G.world.yaowaratNight && G.world.yaowaratNight.group && G.world.yaowaratNight.group.visible);
      return { nightOn, dayOff, crate, stalls: (G.world.yaowaratNight && G.world.yaowaratNight.stalls || []).length };
    });
    assert(yao.nightOn && yao.dayOff && yao.crate && yao.stalls > 4, `Yaowarat densifies at night (${yao.stalls} extra stalls)`);

    console.log('\n[23] take over an NPC longtail');
    const boat = await page.evaluate(() => {
      const G = window.GAME;
      const npc = G.vehicles.find(v => v && v.spec && v.spec.kind === 'boat' && v.driver === 'boatman');
      const parked = G.vehicles.find(v => v && v.spec && v.spec.kind === 'boat' && !v.driver);
      if (npc) {
        G.player.inVehicle = npc; npc.driver = 'player'; npc.npc = null;
      }
      return { npc: !!npc, parked: !!parked, nowPlayer: !!(G.player.inVehicle && G.player.inVehicle.spec && G.player.inVehicle.spec.kind === 'boat') };
    });
    assert(boat.npc && boat.parked && boat.nowPlayer, 'NPC longtail can be taken over; parked boats still exist');

    console.log('\n[24] walk-in 7-Eleven interior');
    const seven = await page.evaluate(() => {
      const G = window.GAME;
      const w = G.world.sevenWalkIn;
      return {
        walkIn: !!(w && w.atm && w.microwave && w.clerk && w.shelves && w.shelves.length),
        pos: !!(w && w.pos),
      };
    });
    assert(seven.walkIn && seven.pos, 'walk-in 7-Eleven has ATM, microwave, clerk, shelves');

    console.log('\n[25] Motosai pillion taxi');
    const sai = await page.evaluate(() => {
      const G = window.GAME, main = window.__REALISM_MAIN;
      const onSoi = (x, z) => {
        const sois = (G.world && G.world.sois) || [];
        for (const s of sois) if (x >= s.x0 && x <= s.x1 && z >= s.z0 && z <= s.z1) return true;
        return false;
      };
      const bike = G.vehicles.find(v => v && v.spec && v.spec.kind === 'bike' && !v.dead && !v.motosaiStand) || main.makeVehicle('bike', G.scene);
      G.player.inVehicle = bike; bike.driver = 'player'; bike.npc = null;
      bike.pos.set(0, 0, -130); bike.heading = 0; bike.vel = 0;
      bike.mesh.position.copy(bike.pos); bike.mesh.rotation.y = 0;
      G.player.group.position.copy(bike.pos); G.player.group.visible = false;
      if (G.quickDrop) G.quickDrop.stage = 'idle';
      if (G.motosai) { G.motosai.stage = 'idle'; G.motosai.pillion = null; }
      window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyJ' }));
      main.updateMotosai(0.016);
      window.dispatchEvent(new KeyboardEvent('keyup', { code: 'KeyJ' }));
      if (G.input && G.input.endFrame) G.input.endFrame();
      main.updateMotosai(0.016);
      const m = G.motosai;
      const pickupOnSoi = !!(m && m.markerPos && onSoi(m.markerPos.x, m.markerPos.z));
      if (m && m.markerPos) {
        bike.pos.copy(m.markerPos); bike.mesh.position.copy(bike.pos);
        G.player.group.position.copy(bike.pos);
      }
      main.updateMotosai(0.05);
      const pillionOn = !!(m && m.pillion && m.pillion.mesh && m.pillion.mesh.parent === bike.mesh);
      const destOnSoi = !!(m && m.dest && onSoi(m.dest.x, m.dest.z));
      const base = m && m.fareValue;
      const car = G.vehicles.find(v => v && v.spec && v.spec.kind === 'camry' && v !== bike) || main.makeVehicle('camry', G.scene);
      bike.pos.set(0, 0, -110); bike.vel = 12; bike.mesh.position.copy(bike.pos);
      car.pos.set(1.4, 0, -110); car.vel = 4; if (car.mesh) car.mesh.position.copy(car.pos);
      for (let i = 0; i < 8; i++) main.updateMotosai(0.1);
      const filtered = (m && m.filterT) > 0.3 && (m && m.filterBonus) > 0;
      const cash0 = G.cash;
      if (m && m.dest) {
        bike.pos.copy(m.dest); bike.mesh.position.copy(bike.pos);
        G.player.group.position.copy(bike.pos);
      }
      main.updateMotosai(0.05);
      return {
        flag: !!(G.gameplay && G.gameplay.motosai),
        started: pickupOnSoi,
        pillionOn,
        destOnSoi,
        filtered,
        paidMore: G.cash > cash0 && (G.cash - cash0) > base,
        payout: G.cash - cash0,
        base,
        bonus: m && m.filterBonus,
        fares: m && m.fares,
        idle: m && m.stage === 'idle',
        pillionOff: !(m && m.pillion),
        sois: (G.world.sois || []).length,
      };
    });
    assert(sai.flag && sai.sois >= 4, `motosai flag on and sois exist (${sai.sois})`);
    assert(sai.started && sai.destOnSoi, 'motosai pickup and drop are on sois');
    assert(sai.pillionOn, 'pillion rider sits on the bike after pickup');
    assert(sai.filtered, 'filtering traffic raises the motosai bonus');
    assert(sai.paidMore && sai.idle && sai.pillionOff && sai.fares >= 1, `motosai pays base+filter and hops off (฿${sai.payout})`);

    console.log('\n[27] motosai stands + traffic pillions');
    const stands = await page.evaluate(() => {
      const G = window.GAME, main = window.__REALISM_MAIN;
      const list = (G.world && G.world.motosaiStands) || [];
      const onSoi = (x, z) => {
        const sois = (G.world && G.world.sois) || [];
        for (const s of sois) if (x >= s.x0 && x <= s.x1 && z >= s.z0 && z <= s.z1) return true;
        return false;
      };
      const first = list.find(s => s && s.bike && s.bike.motosaiStand && s.rider && s.waiter) || list[0];
      const vest = !!(first && first.rider && (first.rider.motosaiVest || (first.rider.mesh && first.rider.mesh.getObjectByName('motosai-vest'))));
      const mouth = !!(first && ((first.x != null && onSoi(first.x, first.z)) || (first.bike && onSoi(first.bike.pos.x, first.bike.pos.z)) || first.soi));
      let pillionBike = G.vehicles.find(v => v && v.spec && v.spec.kind === 'bike' && v.pillionPed && v.pillionPed.pillion && v.pillionPed.mesh);
      if (!pillionBike) {
        const tBike = G.vehicles.find(v => v && v.spec && v.spec.kind === 'bike' && v.driver !== 'player' && !v.motosaiStand) || main.makeVehicle('bike', G.scene);
        if (tBike) {
          tBike.npc = tBike.npc || { kind: 'traffic', cruiseSpeed: 12 };
          tBike.pillionPed = null;
          main.attachTrafficPillion(tBike);
          pillionBike = tBike;
        }
      }
      G.player.inVehicle = null;
      G.player.group.visible = true;
      if (first && first.bike) {
        G.player.group.position.copy(first.bike.pos);
        first.bike.driver = null;
        const near = first.bike;
        G.player.inVehicle = near;
        near.driver = 'player';
        near.npc = null;
        near.motosaiStand = false;
        if (near.standRider) {
          near.standRider.anchor = null;
          near.standRider.motosaiRider = false;
          near.standRider = null;
        }
      }
      return {
        flag: !!(G.gameplay && G.gameplay.motosaiStands),
        n: list.length,
        vest,
        mouth,
        waiter: !!(first && first.waiter),
        pillionTraffic: !!(pillionBike && pillionBike.pillionPed && pillionBike.pillionPed.pillion),
        took: !!(first && first.bike && first.bike.driver === 'player' && !first.bike.motosaiStand),
      };
    });
    assert(stands.flag && stands.n >= 3, `motosai stands at soi mouths (${stands.n})`);
    assert(stands.vest && stands.mouth && stands.waiter, 'orange-vest rider and waiter wait on a soi');
    assert(stands.pillionTraffic, 'some traffic bikes carry a pillion');
    assert(stands.took, 'a stand bike is enterable and the rider hops off');

    console.log('\n[26] burning-season haze');
    const haze = await page.evaluate(() => {
      const G = window.GAME, main = window.__REALISM_MAIN;
      const car = G.vehicles.find(v => v && v.spec && v.spec.kind === 'camry' && v.mesh) || main.makeVehicle('camry', G.scene);
      G.time.dayT = 0.5;
      G.time.weather = 'clear';
      G.time.rainStrength = 0;
      G._rainTarget = 0;
      G._weatherUntil = 1e9;
      main.updateDayNight(0.05);
      main.updateVehicleVisuals(car, 0.05, {});
      const heads = (car.mesh.userData.visual && car.mesh.userData.visual.headlights) || [];
      const clearFog = G.scene.fog.density;
      const clearHead = heads[0] && heads[0].material ? heads[0].material.opacity : 0;
      const clearSun = G.sun.intensity;
      G.time.weather = 'haze';
      main.updateDayNight(0.05);
      main.updateVehicleVisuals(car, 0.05, {});
      const hazeFog = G.scene.fog.density;
      const hazeHead = heads[0] && heads[0].material ? heads[0].material.opacity : 0;
      const hazeSun = G.sun.intensity;
      const tag = document.getElementById('weather-tag').textContent;
      const bg = G.scene.background.getHex();
      G.time.weather = 'clear';
      main.updateDayNight(0.05);
      return {
        flag: !!(G.gameplay && G.gameplay.burningHaze),
        clearFog, hazeFog, clearHead, hazeHead, clearSun, hazeSun, tag, bg,
        hazeK: G._hazeK,
      };
    });
    assert(haze.flag, 'GAMEPLAY.burningHaze defaults on');
    assert(haze.hazeFog > haze.clearFog * 1.8, `noon haze kills distance (fog ${haze.clearFog.toFixed(4)} → ${haze.hazeFog.toFixed(4)})`);
    assert(haze.hazeHead > 0.85 && haze.hazeHead > haze.clearHead, `headlights come on in the haze (${haze.clearHead.toFixed(2)} → ${haze.hazeHead.toFixed(2)})`);
    assert(haze.hazeSun < haze.clearSun * 0.75, `noon sun is dirtier in haze (${haze.clearSun.toFixed(2)} → ${haze.hazeSun.toFixed(2)})`);
    assert(/HAZE/.test(haze.tag), `weather tag reads haze ("${haze.tag}")`);

    console.log('\n[28] haze as city weather');
    const city = await page.evaluate(() => {
      const G = window.GAME, main = window.__REALISM_MAIN;
      G.player.inVehicle = null;
      G._inMall = false;
      G.player.group.visible = true;
      // Pin on the open intersection used by the weight probe. (0,-50) sits on a
      // grid road but leftover cop cars / traffic from earlier probes can fill the
      // 22 m sightline and flip the haze LOS band.
      G.player.group.position.set(0, 0, -150);
      for (const c of G.cops) {
        if (!c || !c.mesh) continue;
        c.mesh.position.set(-220, 0, -220);
        c.state = 'bribed';
        c.dead = false;
      }
      for (const v of G.vehicles) {
        if (!v || !v.isCop) continue;
        v.pos.set(-230, 0, -230);
        if (v.mesh) v.mesh.position.copy(v.pos);
        v.driver = null;
      }
      let cop = main.spawnCop(G.scene, new G.THREE.Vector3(0, 0, -172));
      cop.mesh.position.set(0, 0, -172);
      cop.dead = false;
      cop.state = 'seeking';
      G.wanted.stars = 1;
      G.time.weather = 'clear';
      G.time.rainStrength = 0;
      G._weatherUntil = 1e9;
      main.updateDayNight(0.05);
      G.wanted.lastSeenAt = 0;
      cop._losT = 0;
      cop._losOk = undefined;
      main.updateWanted(0.25);
      const clearSeen = G.wanted.lastSeenAt > 0;
      G.time.weather = 'haze';
      main.updateDayNight(0.05);
      G.wanted.lastSeenAt = 0;
      cop._losT = 0;
      cop._losOk = undefined;
      main.updateWanted(0.25);
      const hazeSeen = G.wanted.lastSeenAt > 0;
      const tag = document.getElementById('weather-tag').textContent;
      const pm25 = G.time.pm25;
      const car = G.vehicles.find(v => v && v.npc && v.spec && v.spec.kind === 'camry') || main.makeVehicle('camry', G.scene);
      if (!car.npc) car.npc = { kind: 'traffic', cruiseSpeed: 12, followMul: 1, dir: 0 };
      const cruise = car.npc.cruiseSpeed;
      car.pos.set(2.5, 0, -80); car.heading = 0; car.vel = cruise;
      if (car.mesh) { car.mesh.position.copy(car.pos); car.mesh.rotation.y = 0; }
      G.time.weather = 'haze';
      main.updateDayNight(0.05);
      for (let i = 0; i < 24; i++) main.updateTrafficCar(car, 0.1);
      const hazeVel = car.vel;
      G.time.weather = 'clear';
      G.wanted.stars = 0;
      main.updateDayNight(0.05);
      return {
        pm25,
        tag,
        clearSeen,
        hazeSeen,
        cruise,
        hazeVel,
      };
    });
    assert(/PM2\.5/.test(city.tag) && city.pm25 > 100, `haze HUD reports PM2.5 ("${city.tag}")`);
    assert(city.clearSeen && !city.hazeSeen, 'cops lose you at 22m in the haze, not in clear air');
    assert(city.hazeVel < city.cruise * 0.9, `cars crawl in the haze (${city.hazeVel.toFixed(1)} of cruise ${city.cruise.toFixed(1)})`);

    console.log('\n[29] morning schoolkids');
    const kids = await page.evaluate(() => {
      const G = window.GAME, main = window.__REALISM_MAIN;
      G.time.dayT = 7.4 / 24;
      G.time.weather = 'clear';
      main.updateSchoolKids(0.05);
      const list = G._schoolKids || [];
      const n = list.filter(p => p && p.school && p.kind === 'school' && !p.dead).length;
      const bts = G.world.bts;
      const dest = { x: bts ? bts.x : 0, z: (bts && bts.z) || 0 };
      let toward = 0;
      for (const p of list) {
        if (!p || !p.mesh) continue;
        const dx = dest.x - p.mesh.position.x, dz = dest.z - p.mesh.position.z;
        const want = Math.atan2(dx, dz);
        let d = Math.abs(p.heading - want);
        while (d > Math.PI) d = Math.abs(d - Math.PI * 2);
        if (d < 0.6 || Math.hypot(dx, dz) < 10) toward++;
      }
      const shirt = list[0] && list[0].mesh && list[0].mesh.userData.parts && list[0].mesh.userData.parts.torso;
      const white = shirt && shirt.material && shirt.material.color.getHex() > 0xe0e0e0;
      G.time.dayT = 12 / 24;
      main.updateSchoolKids(0.05);
      const gone = !(G._schoolKids && G._schoolKids.length);
      G.time.dayT = 15.4 / 24;
      main.updateSchoolKids(0.05);
      const pm = G._schoolKids || [];
      const nPm = pm.filter(p => p && p.school).length;
      let away = 0;
      for (const p of pm) {
        if (!p || !p.mesh) continue;
        const dx = dest.x - p.mesh.position.x, dz = dest.z - p.mesh.position.z;
        const want = Math.atan2(-dx, -dz);
        let d = Math.abs(p.heading - want);
        while (d > Math.PI) d = Math.abs(d - Math.PI * 2);
        if (d < 0.6) away++;
      }
      return { flag: !!(G.gameplay && G.gameplay.schoolKids), n, toward, white, gone, bts: !!(bts), nPm, away };
    });
    assert(kids.flag && kids.bts, 'schoolKids flag on and BTS exists');
    assert(kids.n >= 4 && kids.toward >= 3 && kids.white, `morning uniforms walk toward the BTS (${kids.n} kids)`);
    assert(kids.gone, 'schoolkids disperse after morning');
    assert(kids.nPm >= 4 && kids.away >= 3, `afternoon uniforms walk home from the BTS (${kids.nPm})`);

    console.log('\n[30] midday shade-seeking');
    const shade = await page.evaluate(() => {
      const G = window.GAME, main = window.__REALISM_MAIN;
      G.time.dayT = 12.5 / 24;
      G.time.weather = 'clear';
      G.time.rainStrength = 0;
      G._shadeT = 1;
      main.updateSeekShade(0.5);
      const assigned = G.peds.filter(p => p && p.shade).length;
      const sample = G.peds.find(p => p && p.shade);
      if (sample) {
        sample.mesh.position.x += 4;
        main.updatePeds(0.05);
      }
      const moving = !!(sample && sample.state === 'shade' && sample.speed > 0.2);
      G.time.dayT = 20 / 24;
      G._shadeOn = true;
      main.updateSeekShade(0.05);
      const cleared = G.peds.filter(p => p && p.shade).length;
      return { flag: !!(G.gameplay && G.gameplay.seekShade), assigned, moving, cleared, ways: (G.world.walkways || []).length };
    });
    assert(shade.flag && shade.ways > 10, 'seekShade flag on and walkways exist');
    assert(shade.assigned >= 4 && shade.moving, `noon wanderers pull into shade (${shade.assigned})`);
    assert(shade.cleared === 0, 'shade-seeking clears after the heat');

    console.log('\n[31] sit and eat at a stall');
    const eat = await page.evaluate(() => {
      const G = window.GAME, main = window.__REALISM_MAIN;
      const f = (G.world.foodStalls || [])[0];
      if (!f) return { flag: false };
      G.player.inVehicle = null;
      G._btsRide = null;
      G.player.group.visible = true;
      G.player.group.position.copy(f.pos);
      G._eating = null;
      G.cash = 120;
      G.player.hp = 40;
      G.time.rainStrength = 0;
      G._rainTarget = 0;
      f.visited = false;
      f.readyAt = 0;
      f.packed = false;
      if (main.updateRainPack) main.updateRainPack(0.05);
      for (let i = 0; i < 4 && !G._eating; i++) {
        window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyE' }));
        main.updateFoodStalls(0.016);
        window.dispatchEvent(new KeyboardEvent('keyup', { code: 'KeyE' }));
        if (G.input && G.input.endFrame) G.input.endFrame();
      }
      const sitting = !!(G._eating && G._eating.t > 0);
      const cashMid = G.cash;
      main.updateFoodStalls(2.5);
      return {
        flag: !!(G.gameplay && G.gameplay.stallSit),
        stools: f && G.world.foodStalls.length,
        sitting,
        paid: cashMid === 80,
        healed: G.player.hp > 40,
        visited: !!f.visited,
        done: !G._eating,
      };
    });
    assert(eat.flag && eat.stools >= 4, 'stallSit flag on and stalls exist');
    assert(eat.sitting && eat.paid && eat.healed && eat.visited && eat.done, 'E sits you down, ฿40, heal, first visit ticks');

    console.log('\n[32] wai at a spirit house');
    const wai = await page.evaluate(() => {
      const G = window.GAME, main = window.__REALISM_MAIN;
      const s = (G.world.shrines || [])[0];
      if (!s) return { flag: false };
      G._eating = null;
      G.player.inVehicle = null;
      G.player.group.position.copy(s.pos);
      G.cash = 50;
      G.wanted.stars = 2;
      G.wanted.lastSeenAt = performance.now();
      s.readyAt = 0;
      const seen0 = G.wanted.lastSeenAt;
      window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyE' }));
      main.updateShrines(0.016);
      window.dispatchEvent(new KeyboardEvent('keyup', { code: 'KeyE' }));
      if (G.input && G.input.endFrame) G.input.endFrame();
      const smoke = s.mesh && s.mesh.getObjectByName('incense');
      const list = G.world.shrines || [];
      let spread = true;
      for (let i = 0; i < list.length; i++) {
        for (let j = i + 1; j < list.length; j++) {
          const a = list[i] && list[i].pos, b = list[j] && list[j].pos;
          if (!a || !b || Math.hypot(a.x - b.x, a.z - b.z) <= 2) spread = false;
        }
      }
      return {
        flag: !!(G.gameplay && G.gameplay.spiritWai),
        n: list.length,
        spread,
        paid: G.cash === 40,
        cooled: G.wanted.lastSeenAt < seen0 - 1000,
        count: G._waiCount,
        incense: !!smoke,
        lit: (s.incenseT || 0) > 4,
      };
    });
    assert(wai.flag && wai.n >= 4 && wai.spread, `spirit houses exist (${wai.n})`);
    assert(wai.paid && wai.cooled && wai.count >= 1, 'wai costs ฿10 and cools wanted contact');
    assert(wai.incense && wai.lit, 'wai lights the incense plume');

    console.log('\n[33] soi cats at stalls');
    const cats = await page.evaluate(() => {
      const G = window.GAME, main = window.__REALISM_MAIN;
      const n = (G.cats || []).length;
      const c = G.cats && G.cats[0];
      if (!c) return { flag: !!(G.gameplay && G.gameplay.soiCats), n };
      G.player.inVehicle = null;
      G.player.group.position.set(c.mesh.position.x + 1.1, 0, c.mesh.position.z);
      const start = { x: c.mesh.position.x, z: c.mesh.position.z };
      for (let i = 0; i < 20; i++) main.updateCats(0.1);
      const moved = Math.hypot(c.mesh.position.x - start.x, c.mesh.position.z - start.z);
      return { flag: !!(G.gameplay && G.gameplay.soiCats), n, bolted: c.state === 'bolt' || c.state === 'return', moved };
    });
    assert(cats.flag && cats.n >= 3, `cats loaf at stalls (${cats.n})`);
    assert(cats.bolted && cats.moved > 0.8, `cats bolt when the player gets close (${cats.moved.toFixed(1)}m)`);

    console.log('\n[34] BTS platform waiters + PA');
    const plat = await page.evaluate(() => {
      const G = window.GAME, main = window.__REALISM_MAIN;
      G._btsPa = null;
      if (G.bts) G.bts._announced = false;
      main.updateBtsPlatform(0.05);
      const list = G._btsWaiters || [];
      const asok = list.filter(p => p && p.btsWait && p.btsStop === 'Asok' && p.mesh);
      const yOk = asok.filter(p => p.mesh.position.y > 12).length;
      const visible = asok.filter(p => p.mesh.visible && !p.btsBoarded).length;
      if (G.bts && G.bts.mesh) {
        G.bts.mesh.position.x = -50;
        G.bts.dir = 1;
        G.bts._announced = false;
      }
      main.updateBTS(0.05);
      main.updateBtsPlatform(0.05);
      const boarded = (G._btsWaiters || []).filter(p => p && p.btsStop === 'Asok' && p.btsBoarded).length;
      const pa = G._btsPa || {};
      if (G.bts && G.bts.mesh) {
        G.bts.mesh.position.x = 0;
        G.bts._announced = false;
      }
      main.updateBtsPlatform(0.05);
      const back = (G._btsWaiters || []).filter(p => p && p.btsStop === 'Asok' && p.mesh && p.mesh.visible && !p.btsBoarded).length;
      return {
        flag: !!(G.gameplay && G.gameplay.btsPlatform),
        n: list.length,
        asok: asok.length,
        yOk, visible, boarded, back,
        paStop: pa.stop, paNext: pa.next,
      };
    });
    assert(plat.flag && plat.n >= 6 && plat.asok >= 4, `waiters stand on both platforms (${plat.n}, Asok ${plat.asok})`);
    assert(plat.yOk >= 4 && plat.visible >= 4, `Asok waiters stand on the platform (y, ${plat.yOk} visible)`);
    assert(plat.paStop === 'Asok' && plat.paNext, `PA names the stop (${plat.paStop} → ${plat.paNext})`);
    assert(plat.boarded >= 3, `waiters board when the train pulls in (${plat.boarded})`);
    assert(plat.back >= 3, `waiters return after the train leaves (${plat.back})`);

    console.log('\n[35] bike helmets + seated riders');
    const lids = await page.evaluate(() => {
      const G = window.GAME, main = window.__REALISM_MAIN;
      const stands = (G.world && G.world.motosaiStands) || [];
      const rider = stands[0] && stands[0].rider;
      const standHelm = !!(rider && (rider.bikeHelmet || (rider.mesh && rider.mesh.getObjectByName('bike-helmet'))));
      let pillionBike = G.vehicles.find(v => v && v.spec && v.spec.kind === 'bike' && v.pillionPed && v.pillionPed.mesh);
      if (!pillionBike) {
        const tBike = G.vehicles.find(v => v && v.spec && v.spec.kind === 'bike' && v.driver !== 'player' && !v.motosaiStand) || main.makeVehicle('bike', G.scene);
        if (tBike) {
          tBike.npc = tBike.npc || { kind: 'traffic', cruiseSpeed: 12 };
          tBike.pillionPed = null;
          main.attachTrafficPillion(tBike);
          pillionBike = tBike;
        }
      }
      const pillionHelm = !!(pillionBike && pillionBike.pillionPed && (pillionBike.pillionPed.bikeHelmet || (pillionBike.pillionPed.mesh && pillionBike.pillionPed.mesh.getObjectByName('bike-helmet'))));
      let npcBike = G.vehicles.find(v => v && v.spec && v.spec.kind === 'bike' && v.npc && v.driver !== 'player' && !v.motosaiStand) || pillionBike;
      if (npcBike) main.syncBikeRider(npcBike);
      const npcRider = !!(npcBike && npcBike.bikeRider && npcBike.bikeRider.visible && npcBike.bikeRider.getObjectByName('bike-helmet'));
      const bike = G.vehicles.find(v => v && v.spec && v.spec.kind === 'bike' && !v.dead) || main.makeVehicle('bike', G.scene);
      G.player.inVehicle = bike; bike.driver = 'player'; bike.npc = null;
      main.syncBikeRider(bike);
      const playerRider = !!(bike.bikeRider && bike.bikeRider.visible && bike.bikeRider.getObjectByName('bike-helmet'));
      G.player.inVehicle = null; bike.driver = null;
      main.syncBikeRider(bike);
      const hoppedOff = !(bike.bikeRider && bike.bikeRider.visible);
      return {
        flag: !!(G.gameplay && G.gameplay.bikeHelmets),
        standHelm, pillionHelm, npcRider, playerRider, hoppedOff,
      };
    });
    assert(lids.flag, 'bikeHelmets flag on');
    assert(lids.standHelm && lids.pillionHelm, 'stand riders and pillions wear helmets');
    assert(lids.npcRider, 'traffic bikes show a helmeted rider');
    assert(lids.playerRider && lids.hoppedOff, 'player bike shows a helmeted rider that hides on foot');

    console.log('\n[36] evening office commute');
    const commute = await page.evaluate(() => {
      const G = window.GAME, main = window.__REALISM_MAIN;
      G.time.dayT = 18.2 / 24;
      G.time.weather = 'clear';
      main.updateOfficeCommute(0.05);
      const list = G._officeCommute || [];
      const n = list.filter(p => p && p.commute && p.kind === 'office' && !p.dead).length;
      const bts = G.world.bts;
      const dest = { x: bts ? bts.x : 0, z: (bts && bts.z) || 0 };
      let toward = 0;
      for (const p of list) {
        if (!p || !p.mesh) continue;
        const dx = dest.x - p.mesh.position.x, dz = dest.z - p.mesh.position.z;
        const want = Math.atan2(dx, dz);
        let d = Math.abs(p.heading - want);
        while (d > Math.PI) d = Math.abs(d - Math.PI * 2);
        if (d < 0.6 || Math.hypot(dx, dz) < 10) toward++;
      }
      const shirt = list[0] && list[0].mesh && list[0].mesh.userData.parts && list[0].mesh.userData.parts.torso;
      const pale = shirt && shirt.material && shirt.material.color.getHex() > 0xc0c0c0;
      G.time.dayT = 12 / 24;
      main.updateOfficeCommute(0.05);
      const gone = !(G._officeCommute && G._officeCommute.length);
      return { flag: !!(G.gameplay && G.gameplay.officeCommute), n, toward, pale, gone, bts: !!(bts) };
    });
    assert(commute.flag && commute.bts, 'officeCommute flag on and BTS exists');
    assert(commute.n >= 5 && commute.toward >= 4 && commute.pale, `evening office crowd walks toward the BTS (${commute.n})`);
    assert(commute.gone, 'office commute disperses after evening');

    console.log('\n[37] afternoon thunderstorm');
    const storm = await page.evaluate(() => {
      const G = window.GAME, main = window.__REALISM_MAIN;
      G.time.dayT = 15.2 / 24;
      G.time.weather = 'clear';
      G.time.rainStrength = 0;
      G._rainTarget = 0;
      G._stormToday = false;
      G._weatherT = 0;
      G._weatherUntil = 1e9;
      main.updateDayNight(0.05);
      const tag = document.getElementById('weather-tag') && document.getElementById('weather-tag').textContent;
      const fired = G.time.weather === 'rain' && (G._rainTarget || 0) > 0.7 && G._stormToday;
      G.time.dayT = 5.2 / 24;
      main.updateDayNight(0.05);
      const reset = G._stormToday === false;
      return {
        flag: !!(G.gameplay && G.gameplay.afternoonStorm),
        fired, tag, reset, weather: G.time.weather,
      };
    });
    assert(storm.flag, 'afternoonStorm flag on');
    assert(storm.fired && /STORM/.test(storm.tag || ''), `heat breaks into an afternoon storm ("${storm.tag}")`);
    assert(storm.reset, 'storm flag clears before dawn so the next day can fire');

    console.log('\n[38] morning crossing guards');
    const guard = await page.evaluate(() => {
      const G = window.GAME, main = window.__REALISM_MAIN;
      G.time.dayT = 7.4 / 24;
      main.updateCrossingGuards(0.05);
      const list = G._crossingGuards || [];
      const n = list.filter(p => p && p.crossingGuard && !p.dead).length;
      const g0 = list[0];
      const vest = !!(g0 && g0.mesh && g0.mesh.getObjectByName('guard-vest'));
      const paddle = !!(g0 && g0.mesh && g0.mesh.getObjectByName('stop-paddle'));
      const bts = G.world && G.world.bts;
      const nearBts = !!(g0 && g0.mesh && bts && Math.hypot(g0.mesh.position.x - bts.x, g0.mesh.position.z - (bts.z || 0)) < 18);
      G.time.dayT = 12 / 24;
      main.updateCrossingGuards(0.05);
      const goneNoon = !(G._crossingGuards && G._crossingGuards.length);
      G.time.dayT = 15.4 / 24;
      main.updateCrossingGuards(0.05);
      const pm = (G._crossingGuards || []).filter(p => p && p.crossingGuard).length;
      G.time.dayT = 18 / 24;
      main.updateCrossingGuards(0.05);
      const goneEve = !(G._crossingGuards && G._crossingGuards.length);
      return { flag: !!(G.gameplay && G.gameplay.crossingGuard), n, vest, paddle, nearBts, goneNoon, pm, goneEve };
    });
    assert(guard.flag && guard.n >= 2 && guard.nearBts, `crossing guards stand at Asok (${guard.n})`);
    assert(guard.vest && guard.paddle, 'yellow vest and stop paddle');
    assert(guard.goneNoon, 'crossing guards leave after morning');
    assert(guard.pm >= 2 && guard.goneEve, 'crossing guards return for the afternoon pickup');

    console.log('\n[39] BTS motosai rank');
    const rank = await page.evaluate(() => {
      const G = window.GAME;
      const bts = G.world && G.world.bts;
      const list = (G.world && G.world.motosaiStands) || [];
      const atBts = list.filter(s => s && s.bts !== 'phrom' && (s.bts || (bts && Math.hypot(s.x - bts.x, s.z - (bts.z || 0)) < 28)));
      const s0 = atBts[0] || list.find(s => s && s.bts && s.bts !== 'phrom');
      const vest = !!(s0 && s0.rider && (s0.rider.motosaiVest || (s0.rider.mesh && s0.rider.mesh.getObjectByName('motosai-vest'))));
      const helm = !!(s0 && s0.rider && (s0.rider.bikeHelmet || (s0.rider.mesh && s0.rider.mesh.getObjectByName('bike-helmet'))));
      const bike = s0 && s0.bike;
      return {
        flag: !!(G.gameplay && G.gameplay.btsMotosai),
        n: atBts.length,
        vest, helm,
        stand: !!(bike && bike.motosaiStand && bike.driver !== 'player'),
        waiter: !!(s0 && s0.waiter),
      };
    });
    assert(rank.flag && rank.n >= 1, `a motosai rank waits at the BTS (${rank.n})`);
    assert(rank.vest && rank.helm && rank.stand && rank.waiter, 'BTS rank has a helmeted vest rider, bike, and waiter');

    console.log('\n[40] rain packs the food stalls');
    const pack = await page.evaluate(() => {
      const G = window.GAME, main = window.__REALISM_MAIN;
      G.time.weather = 'rain';
      G.time.rainStrength = 0.8;
      G._rainTarget = 0.8;
      G._clusterT = 0;
      main.updateRainPack(0.05);
      main.updateClusters(2);
      const fs = G.world.foodStalls || [];
      const packed = fs.filter(f => f.packed).length;
      const stools = fs[0] && fs[0].mesh && fs[0].mesh.getObjectByName('stool');
      const parasol = fs[0] && fs[0].mesh && fs[0].mesh.getObjectByName('parasol');
      const stoolHidden = !!(stools && stools.visible === false);
      const parasolTilt = !!(parasol && parasol.rotation.x > 0.5);
      const foodQ = (G.clusterAnchors || []).filter(a => a.kind === 'food').reduce((n, a) => n + a.peds.length, 0);
      G.time.weather = 'clear';
      G.time.rainStrength = 0;
      G._rainTarget = 0;
      main.updateRainPack(0.05);
      const open = fs.filter(f => f.packed).length;
      const stoolBack = fs[0] && fs[0].mesh && fs[0].mesh.getObjectByName('stool') && fs[0].mesh.getObjectByName('stool').visible;
      return {
        flag: !!(G.gameplay && G.gameplay.rainPack),
        packed, foodQ, stoolHidden, parasolTilt, open, stoolBack,
      };
    });
    assert(pack.flag && pack.packed >= 8 && pack.stoolHidden && pack.parasolTilt, `stalls pack in the rain (${pack.packed})`);
    assert(pack.foodQ === 0, 'food queues empty when packed');
    assert(pack.open === 0 && pack.stoolBack, 'stalls unpack when it dries');

    console.log('\n[41] BTS songthaew rank');
    const song = await page.evaluate(() => {
      const G = window.GAME, main = window.__REALISM_MAIN;
      main.updateVehicles(0.016);
      const rec = G.world && G.world.btsSongthaew;
      const bts = G.world && G.world.bts;
      const v = rec && rec.vehicle || (G.vehicles || []).find(x => x && x.btsSongthaew);
      const px = v && v.pos && v.pos.x;
      const pz = v && v.pos && v.pos.z;
      const dist = (v && bts && px != null) ? Math.hypot(px - bts.x, pz - (bts.z || 0)) : null;
      const waiter = rec && rec.waiter;
      return {
        flag: !!(G.gameplay && G.gameplay.btsSongthaew),
        rec: !!rec, hasV: !!v,
        kind: v && (v.kind || (v.spec && v.spec.kind)),
        stand: !!(v && v.btsSongthaew && v.driver !== 'player'),
        near: dist != null && dist < 40,
        dist, px, pz, btsX: bts && bts.x, btsZ: bts && (bts.z || 0),
        home: rec && rec.x != null ? { x: rec.x, z: rec.z } : null,
        npc: !!(v && v.npc), driver: v && v.driver,
        waiter: !!(waiter && waiter.btsSongthaew && waiter.anchor),
      };
    });
    assert(song.flag && song.kind === 'songthaew' && song.near, `a songthaew waits at the BTS (${song.dist && song.dist.toFixed(1)}m)`);
    assert(song.stand && song.waiter, 'BTS songthaew is enterable and has a hawker');

    console.log('\n[42] soi ice carts');
    const ice = await page.evaluate(() => {
      const G = window.GAME, main = window.__REALISM_MAIN;
      const list = G.iceCarts || [];
      const n = list.filter(c => c && c.mesh && c.mesh.name === 'ice-cart').length;
      const vendor = list.filter(c => c && c.vendor && c.vendor.iceCart).length;
      const c0 = list[0];
      if (c0) { c0.t = 0.15; c0.dir = 1; }
      G.player.inVehicle = null;
      G._eating = null;
      if (c0 && c0.mesh) G.player.group.position.set(c0.mesh.position.x + 40, 0, c0.mesh.position.z + 40);
      main.updateIceCarts(0.05);
      const start = c0 && c0.mesh ? { x: c0.mesh.position.x, z: c0.mesh.position.z } : null;
      for (let i = 0; i < 40; i++) main.updateIceCarts(0.25);
      const moved = !!(c0 && start && Math.hypot(c0.mesh.position.x - start.x, c0.mesh.position.z - start.z) > 0.4);
      const onSoi = !!(c0 && c0.soi);
      G.player.inVehicle = null;
      G.player.group.visible = true;
      G._eating = null;
      G.cash = 80;
      G.player.stam = 10;
      if (c0 && c0.mesh) G.player.group.position.copy(c0.mesh.position);
      window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyE' }));
      main.updateIceCarts(0.016);
      window.dispatchEvent(new KeyboardEvent('keyup', { code: 'KeyE' }));
      if (G.input && G.input.endFrame) G.input.endFrame();
      return {
        flag: !!(G.gameplay && G.gameplay.iceCart), n, vendor, moved, onSoi,
        paid: G.cash === 60, stam: G.player.stam === G.player.stamMax,
      };
    });
    assert(ice.flag && ice.n >= 2 && ice.vendor >= 2, `ice carts roll the sois (${ice.n})`);
    assert(ice.moved && ice.onSoi, 'ice carts move along a soi');
    assert(ice.paid && ice.stam, 'E buys ice cream for ฿20 and fills stamina');

    console.log('\n[43] BTS tuk-tuk rank');
    const tuk = await page.evaluate(() => {
      const G = window.GAME, main = window.__REALISM_MAIN;
      main.updateVehicles(0.016);
      const rec = G.world && G.world.btsTuktuk;
      const bts = G.world && G.world.bts;
      const v = rec && rec.vehicle;
      const dist = (v && bts) ? Math.hypot(v.pos.x - bts.x, v.pos.z - (bts.z || 0)) : null;
      return {
        flag: !!(G.gameplay && G.gameplay.btsTuktuk),
        kind: v && v.kind,
        stand: !!(v && v.btsTuktuk && v.driver !== 'player' && v._standHome),
        near: dist != null && dist < 40,
        waiter: !!(rec && rec.waiter && rec.waiter.btsTuktuk),
      };
    });
    assert(tuk.flag && tuk.kind === 'tuktuk' && tuk.near, 'a tuk-tuk waits at the BTS');
    assert(tuk.stand && tuk.waiter, 'BTS tuk-tuk is pinned and has a driver waiting');

    console.log('\n[46] for-hire roof signs');
    const hire = await page.evaluate(() => {
      const G = window.GAME, main = window.__REALISM_MAIN;
      const song = G.world && G.world.btsSongthaew && G.world.btsSongthaew.vehicle;
      const tukV = G.world && G.world.btsTuktuk && G.world.btsTuktuk.vehicle;
      const songSign = !!(song && (song.hireSign || (song.mesh && song.mesh.getObjectByName('hire-sign'))));
      const tukSign = !!(tukV && (tukV.hireSign || (tukV.mesh && tukV.mesh.getObjectByName('hire-sign'))));
      if (song) { song.driver = 'player'; main.updateVehicles(0.016); }
      const hidden = !!(song && song.hireSign && song.hireSign.visible === false);
      if (song) { song.driver = null; main.updateVehicles(0.016); }
      const back = !!(song && song.hireSign && song.hireSign.visible);
      return { songSign, tukSign, hidden, back };
    });
    assert(hire.songSign && hire.tukSign, 'BTS songthaew and tuk-tuk wear for-hire signs');
    assert(hire.hidden && hire.back, 'hire sign hides when you take the ride and returns on the rank');

    console.log('\n[44] khlong water monitors');
    const mon = await page.evaluate(() => {
      const G = window.GAME, main = window.__REALISM_MAIN;
      const list = G.monitors || [];
      const n = list.filter(m => m && m.mesh).length;
      const m0 = list[0];
      if (!m0) return { flag: !!(G.gameplay && G.gameplay.khlongMonitor), n };
      G.player.inVehicle = null;
      G.player.group.position.set(m0.mesh.position.x + 1.2, 0, m0.mesh.position.z);
      const start = { x: m0.mesh.position.x, z: m0.mesh.position.z };
      for (let i = 0; i < 20; i++) main.updateMonitors(0.1);
      const moved = Math.hypot(m0.mesh.position.x - start.x, m0.mesh.position.z - start.z);
      const bank = m0.mesh.position.x < -200;
      return {
        flag: !!(G.gameplay && G.gameplay.khlongMonitor),
        n, bolted: m0.state === 'bolt' || m0.state === 'return', moved, bank,
      };
    });
    assert(mon.flag && mon.n >= 2, `water monitors loaf on the khlong (${mon.n})`);
    assert(mon.bolted && mon.moved > 0.8 && mon.bank, `monitors bolt along the bank (${mon.moved.toFixed(1)}m)`);

    console.log('\n[45] stall geckos after dark');
    const gecko = await page.evaluate(() => {
      const G = window.GAME, main = window.__REALISM_MAIN;
      const list = G.geckos || [];
      G.nightK = 0.1;
      main.updateGeckos(0.05);
      const dayHide = list.filter(g => g && g.mesh && g.mesh.visible).length;
      G.nightK = 0.8;
      main.updateGeckos(0.05);
      const nightShow = list.filter(g => g && g.mesh && g.mesh.visible).length;
      const onStall = list[0] && list[0].mesh && list[0].mesh.position.y > 1.4;
      return { flag: !!(G.gameplay && G.gameplay.stallGecko), n: list.length, dayHide, nightShow, onStall };
    });
    assert(gecko.flag && gecko.n >= 3, `geckos exist on stalls (${gecko.n})`);
    assert(gecko.dayHide === 0 && gecko.nightShow >= 3 && gecko.onStall, 'geckos hide by day and sit on parasols at night');

    console.log('\n[47] soi football after school');
    const kick = await page.evaluate(() => {
      const G = window.GAME, main = window.__REALISM_MAIN;
      G.time.dayT = 17.4 / 24;
      main.updateSoiFootball(0.05);
      const g = G._soiFootball;
      const n = g && g.kids ? g.kids.filter(p => p && p.football).length : 0;
      const ball0 = g && g.ball && { x: g.ball.position.x, y: g.ball.position.y, z: g.ball.position.z };
      for (let i = 0; i < 12; i++) main.updateSoiFootball(0.08);
      const moved = !!(g && g.ball && ball0 && Math.hypot(g.ball.position.x - ball0.x, g.ball.position.z - ball0.z) > 0.3);
      const loft = !!(g && g.ball && g.ball.position.y > 0.2);
      G.time.dayT = 12 / 24;
      main.updateSoiFootball(0.05);
      const gone = !G._soiFootball;
      return { flag: !!(G.gameplay && G.gameplay.soiFootball), n, moved, loft, gone, soi: !!(g && g.soi) };
    });
    assert(kick.flag && kick.n >= 3 && kick.soi, `kids kick about in a soi (${kick.n})`);
    assert(kick.moved && kick.loft, 'the ball travels between kids');
    assert(kick.gone, 'the kickabout packs up after evening');

    console.log('\n[48] mall shoppers to the BTS');
    const bags = await page.evaluate(() => {
      const G = window.GAME, main = window.__REALISM_MAIN;
      G.time.dayT = 18.2 / 24;
      main.updateMallShoppers(0.05);
      const list = G._mallShoppers || [];
      const n = list.filter(p => p && p.mallShop && !p.dead).length;
      const bts = G.world.bts;
      const dest = { x: bts ? bts.x : 0, z: (bts && bts.z) || 0 };
      let toward = 0;
      for (const p of list) {
        if (!p || !p.mesh) continue;
        const dx = dest.x - p.mesh.position.x, dz = dest.z - p.mesh.position.z;
        const want = Math.atan2(dx, dz);
        let d = Math.abs(p.heading - want);
        while (d > Math.PI) d = Math.abs(d - Math.PI * 2);
        if (d < 0.6 || Math.hypot(dx, dz) < 10) toward++;
      }
      const mall = G.world.poi && G.world.poi.terminal21;
      G.time.dayT = 12 / 24;
      main.updateMallShoppers(0.05);
      const gone = !(G._mallShoppers && G._mallShoppers.length);
      return { flag: !!(G.gameplay && G.gameplay.mallShoppers), n, toward, gone, mall: !!mall };
    });
    assert(bags.flag && bags.mall && bags.n >= 3, `mall shoppers walk from Terminal 21 (${bags.n})`);
    assert(bags.toward >= 2 && bags.gone, 'they head to the BTS and clear after evening');

    console.log('\n[49] lottery seller at 7-Eleven');
    const lotto = await page.evaluate(() => {
      const G = window.GAME, main = window.__REALISM_MAIN;
      const L = G.lottery;
      const seven = G.world && (G.world.sevenWalkIn || (G.world.sevenElevens && G.world.sevenElevens[0]));
      const near = !!(L && L.pos && seven && Math.hypot(L.pos.x - seven.pos.x, L.pos.z - seven.pos.z) < 12);
      const board = !!(L && L.board && L.board.name === 'lottery-board');
      const seller = !!(L && L.ped && L.ped.lottery);
      G.player.inVehicle = null;
      G._eating = null;
      G._btsRide = null;
      G.player.group.visible = true;
      G.cash = 200;
      G._lotteryForce = 1200;
      G._lotteryLast = null;
      if (L && L.pos) G.player.group.position.copy(L.pos);
      if (L) L.readyAt = 0;
      window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyE' }));
      main.updateLottery(0.016);
      window.dispatchEvent(new KeyboardEvent('keyup', { code: 'KeyE' }));
      if (G.input && G.input.endFrame) G.input.endFrame();
      return {
        flag: !!(G.gameplay && G.gameplay.lottery),
        near, board, seller,
        last: G._lotteryLast,
        cash: G.cash,
      };
    });
    assert(lotto.flag && lotto.seller && lotto.board && lotto.near, 'a lottery board waits outside 7-Eleven');
    assert(lotto.last && lotto.last.spent === 80 && lotto.last.win === 1200 && lotto.cash === 1320, 'E buys a ticket (฿80) and can pay out');

    console.log('\n[50] wat chant at dawn and dusk');
    const chant = await page.evaluate(() => {
      const G = window.GAME, main = window.__REALISM_MAIN;
      const temple = G.world && G.world.poi && G.world.poi.temple;
      if (temple) G.player.group.position.set(temple.x, 0, temple.z);
      G._watChantSlot = null;
      G._watChant = null;
      G.time.dayT = 6.1 / 24;
      G._weatherUntil = 1e9;
      main.updateDayNight(0.05);
      const dawn = G._watChant && G._watChant.slot === 'dawn' && G._watChant.near;
      G.time.dayT = 12 / 24;
      main.updateDayNight(0.05);
      const midday = G._watChantSlot == null;
      G._watChantSlot = null;
      G.time.dayT = 18.3 / 24;
      main.updateDayNight(0.05);
      const dusk = G._watChant && G._watChant.slot === 'dusk' && G._watChant.near;
      return { flag: !!(G.gameplay && G.gameplay.watChant), temple: !!temple, dawn, midday, dusk };
    });
    assert(chant.flag && chant.temple, 'watChant flag on and the wat exists');
    assert(chant.dawn && chant.midday && chant.dusk, 'chant fires at dawn and dusk, not midday');

    console.log('\n[51] coconut cart on a soi');
    const coco = await page.evaluate(() => {
      const G = window.GAME, main = window.__REALISM_MAIN;
      const list = G.coconutCarts || [];
      const n = list.filter(c => c && c.mesh && c.mesh.name === 'coconut-cart').length;
      const c0 = list[0];
      if (c0) { c0.t = 0.12; c0.dir = 1; }
      G.player.inVehicle = null;
      G._eating = null;
      if (c0 && c0.mesh) G.player.group.position.set(c0.mesh.position.x + 40, 0, c0.mesh.position.z + 40);
      main.updateCoconutCarts(0.05);
      const start = c0 && c0.mesh ? { x: c0.mesh.position.x, z: c0.mesh.position.z } : null;
      for (let i = 0; i < 50; i++) main.updateCoconutCarts(0.3);
      const moved = !!(c0 && start && Math.hypot(c0.mesh.position.x - start.x, c0.mesh.position.z - start.z) > 0.4);
      G.player.inVehicle = null;
      G._eating = null;
      G.player.group.visible = true;
      G.cash = 90;
      G.player.hp = 40;
      G.player.stam = 10;
      if (c0 && c0.mesh) G.player.group.position.copy(c0.mesh.position);
      window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyE' }));
      main.updateCoconutCarts(0.016);
      window.dispatchEvent(new KeyboardEvent('keyup', { code: 'KeyE' }));
      if (G.input && G.input.endFrame) G.input.endFrame();
      return {
        flag: !!(G.gameplay && G.gameplay.coconutCart),
        n, moved, onSoi: !!(c0 && c0.soi),
        paid: G.cash === 60, healed: G.player.hp > 40, stam: G.player.stam === G.player.stamMax,
      };
    });
    assert(coco.flag && coco.n >= 1 && coco.onSoi, `a coconut cart rolls a soi (${coco.n})`);
    assert(coco.moved, 'coconut cart moves along the soi');
    assert(coco.paid && coco.healed && coco.stam, 'E buys coconut water for ฿30');

    console.log('\n[52] soi laundry lines');
    const wash = await page.evaluate(() => {
      const G = window.GAME;
      const list = G.laundry || [];
      const n = list.filter(l => l && l.mesh && l.mesh.name === 'laundry-line').length;
      const high = list.filter(l => l && l.mesh && l.mesh.position.y === 0 && l.mesh.children.some(c => c.position.y > 1.8)).length;
      const onSoi = list.filter(l => l && l.soi).length;
      return { flag: !!(G.gameplay && G.gameplay.soiLaundry), n, high, onSoi };
    });
    assert(wash.flag && wash.n >= 2 && wash.onSoi >= 2, `laundry lines span the sois (${wash.n})`);
    assert(wash.high >= 2, 'shirts hang above head height');

    console.log('\n[53] night checkpoint');
    const stop = await page.evaluate(() => {
      const G = window.GAME, main = window.__REALISM_MAIN;
      const cp = G.checkpoint;
      const cones = cp && cp.cones ? cp.cones.filter(c => c && c.name === 'checkpoint-cone').length : 0;
      const torch = !!(cp && cp.cop && cp.cop.mesh && cp.cop.mesh.getObjectByName('flashlight'));
      G.time.dayT = 12 / 24;
      main.updateCheckpoint(0.05);
      const dayOff = !cp.active && cp.cop && cp.cop.mesh && cp.cop.mesh.visible === false && (cp.light ? cp.light.intensity === 0 : true);
      G.time.dayT = 22.4 / 24;
      G.policeOff = false;
      G.wanted.stars = 0;
      G.wanted.crime = 0;
      cp.flagged = false;
      main.updateCheckpoint(0.05);
      const nightOn = !!(cp.active && cp.cop && cp.cop.mesh && cp.cop.mesh.visible && cp.light && cp.light.intensity > 0.5);
      G.player.inVehicle = null;
      G.player.group.position.set(cp.x + 8, 0, cp.z);
      G.player.group.visible = true;
      const car = G.vehicles.find(v => v && v.npc && v.spec && v.spec.kind !== 'boat' && v.spec.kind !== 'airliner' && v.driver !== 'player') || main.makeVehicle('camry', G.scene);
      if (!car.npc) car.npc = { kind: 'traffic', cruiseSpeed: 12, followMul: 1, dir: 0 };
      car.pos.set(cp.x - 2.5, 0, cp.z);
      if (car.mesh) { car.mesh.position.copy(car.pos); car.mesh.rotation.y = 0; }
      car.heading = 0;
      car.vel = 12;
      car.npc.dir = 0;
      car.npc.cruiseSpeed = 12;
      car.npc.turnCD = 99;
      for (let i = 0; i < 16; i++) main.updateTrafficCar(car, 0.1);
      const slowed = car.vel < 6;
      const ride = G.vehicles.find(v => v && v.spec && v.spec.kind !== 'boat' && v.spec.kind !== 'airliner' && v !== car) || car;
      G.player.inVehicle = ride;
      ride.driver = 'player';
      ride.pos.set(cp.x, 0, cp.z);
      ride.vel = 14;
      cp.flagged = false;
      G.wanted.stars = 0;
      G.wanted.crime = 0;
      main.updateCheckpoint(0.016);
      const stars = G.wanted.stars;
      G.wanted.stars = 0;
      G.wanted.crime = 0;
      G.player.inVehicle = null;
      ride.driver = ride.npc ? 'npc' : null;
      ride.vel = 0;
      G.time.dayT = 12 / 24;
      main.updateCheckpoint(0.05);
      return {
        flag: !!(G.gameplay && G.gameplay.nightCheckpoint),
        cones, torch, dayOff, nightOn, slowed, stars, cop: !!(cp && cp.cop),
      };
    });
    assert(stop.flag && stop.cones >= 4 && stop.cop && stop.torch, `checkpoint cones and cop (${stop.cones})`);
    assert(stop.dayOff && stop.nightOn, 'flashlight cop only works the night shift');
    assert(stop.slowed, 'traffic crawls through the checkpoint');
    assert(stop.stars >= 1, 'blowing the checkpoint at speed is a star');

    console.log('\n[54] 7-Eleven parked bikes');
    const rack = await page.evaluate(() => {
      const G = window.GAME;
      const seven = G.world && (G.world.sevenWalkIn || (G.world.sevenElevens && G.world.sevenElevens[0]));
      const list = G.sevenBikes || [];
      const n = list.filter(v => v && v.spec && v.spec.kind === 'bike' && v.sevenParked).length;
      const pinned = list.filter(v => v && v._standHome && v.driver !== 'player').length;
      let near = 0;
      if (seven && seven.pos) {
        for (const v of list) {
          if (!v || !v.pos) continue;
          if (Math.hypot(v.pos.x - seven.pos.x, v.pos.z - seven.pos.z) < 12) near++;
        }
      }
      const open = list.filter(v => v && v.driver == null).length;
      return { flag: !!(G.gameplay && G.gameplay.sevenBikes), n, pinned, near, open, seven: !!(seven && seven.pos) };
    });
    assert(rack.flag && rack.seven && rack.n >= 4 && rack.near >= 4, `bikes cluster outside 7-Eleven (${rack.n})`);
    assert(rack.pinned >= 4 && rack.open >= 4, 'the rack is pinned and enterable');

    console.log('\n[55] khlong water hyacinth');
    const weed = await page.evaluate(() => {
      const G = window.GAME, main = window.__REALISM_MAIN;
      const list = G.hyacinth || [];
      const n = list.filter(h => h && h.mesh && h.mesh.name === 'hyacinth').length;
      const onRiver = list.filter(h => h && h.mesh && h.mesh.position.x < -210 && h.mesh.position.x > -248).length;
      const wet = list.filter(h => h && h.mesh && h.mesh.position.y < 0.4).length;
      const h0 = list[0];
      const start = h0 && h0.mesh ? h0.mesh.position.z : 0;
      for (let i = 0; i < 40; i++) main.updateHyacinth(0.25);
      const moved = !!(h0 && h0.mesh && Math.abs(h0.mesh.position.z - start) > 0.4);
      return { flag: !!(G.gameplay && G.gameplay.hyacinth), n, onRiver, wet, moved };
    });
    assert(weed.flag && weed.n >= 4 && weed.onRiver >= 4, `hyacinth mats on the khlong (${weed.n})`);
    assert(weed.wet >= 4 && weed.moved, 'mats sit on the water and drift with the current');

    console.log('\n[56] BTS escalator sitters');
    const sit = await page.evaluate(() => {
      const G = window.GAME, main = window.__REALISM_MAIN;
      main.updatePeds(0.05);
      const list = (G.btsSitters || []).filter(p => p && (p.stop === 'asok' || !p.stop));
      const n = list.filter(p => p && p.btsSit && p.mesh).length;
      const bts = G.world && G.world.bts;
      const sx = bts ? bts.x : -50;
      const atAsok = list.filter(p => p && p.mesh && Math.abs(p.mesh.position.x - sx) < 8).length;
      const onStairs = list.filter(p => p && p.mesh && p.mesh.position.y > 2).length;
      const folded = list.filter(p => {
        const parts = p && p.mesh && p.mesh.userData && p.mesh.userData.parts;
        return !!(parts && parts.legL && parts.legL.rotation.x > 0.8);
      }).length;
      const still = list.filter(p => p && p.speed === 0).length;
      return { flag: !!(G.gameplay && G.gameplay.btsSitters), n, atAsok, onStairs, folded, still };
    });
    assert(sit.flag && sit.n >= 2 && sit.atAsok >= 2, `people sit the Asok escalator (${sit.n})`);
    assert(sit.onStairs >= 1 && sit.folded >= 2 && sit.still >= 2, 'at least one is up the stairs, legs folded');

    console.log('\n[57] moo ping cart');
    const grill = await page.evaluate(() => {
      const G = window.GAME, main = window.__REALISM_MAIN;
      const list = G.mooPing || [];
      const n = list.filter(c => c && c.mesh && c.mesh.name === 'mooping-cart').length;
      const c0 = list[0];
      if (c0) { c0.t = 0.12; c0.dir = 1; }
      G.player.inVehicle = null;
      G._eating = null;
      if (c0 && c0.mesh) G.player.group.position.set(c0.mesh.position.x + 40, 0, c0.mesh.position.z + 40);
      main.updateMooPing(0.05);
      const start = c0 && c0.mesh ? { x: c0.mesh.position.x, z: c0.mesh.position.z } : null;
      for (let i = 0; i < 50; i++) main.updateMooPing(0.3);
      const moved = !!(c0 && start && Math.hypot(c0.mesh.position.x - start.x, c0.mesh.position.z - start.z) > 0.4);
      const coals = !!(c0 && c0.mesh && c0.mesh.getObjectByName('mooping-coals'));
      G.time.dayT = 18.5 / 24;
      main.updateMooPing(0.05);
      const duskGlow = !!(c0 && c0.coalMat && c0.coalMat.emissiveIntensity > 0.9);
      G.player.group.visible = true;
      G.cash = 90;
      G.player.hp = 40;
      if (c0 && c0.mesh) G.player.group.position.copy(c0.mesh.position);
      window.dispatchEvent(new KeyboardEvent('keyup', { code: 'KeyE' }));
      if (G.input && G.input.endFrame) G.input.endFrame();
      let paid = false;
      for (let i = 0; i < 4 && !paid; i++) {
        window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyE' }));
        main.updateMooPing(0.016);
        window.dispatchEvent(new KeyboardEvent('keyup', { code: 'KeyE' }));
        if (G.input && G.input.endFrame) G.input.endFrame();
        paid = G.cash === 55 && G.player.hp > 40;
      }
      return {
        flag: !!(G.gameplay && G.gameplay.mooPing),
        n, moved, onSoi: !!(c0 && c0.soi), coals, duskGlow,
        paid, healed: G.player.hp > 40,
      };
    });
    assert(grill.flag && grill.n >= 1 && grill.onSoi && grill.coals, `a moo ping cart works a soi (${grill.n})`);
    assert(grill.moved, 'moo ping cart moves along the soi');
    assert(grill.duskGlow && grill.paid && grill.healed, 'coals glow at dusk and E buys a skewer for ฿35');

    console.log('\n[58] wat turtles');
    const shell = await page.evaluate(() => {
      const G = window.GAME, main = window.__REALISM_MAIN;
      const list = G.watTurtles || [];
      const n = list.filter(t => t && t.mesh && t.mesh.name === 'wat-turtle').length;
      const temple = G.world && G.world.poi && G.world.poi.temple;
      const near = list.filter(t => t && t.mesh && temple && Math.hypot(t.mesh.position.x - temple.x, t.mesh.position.z - temple.z) < 18).length;
      const pond = G.watPond && G.watPond.name === 'wat-pond';
      const t0 = list[0];
      const start = t0 && t0.mesh ? { x: t0.mesh.position.x, z: t0.mesh.position.z } : null;
      for (let i = 0; i < 20; i++) main.updateWatTurtles(0.2);
      const moved = !!(t0 && start && Math.hypot(t0.mesh.position.x - start.x, t0.mesh.position.z - start.z) > 0.15);
      return { flag: !!(G.gameplay && G.gameplay.watTurtles), n, near, pond, moved };
    });
    assert(shell.flag && shell.n >= 3 && shell.pond && shell.near >= 3, `turtles in the wat pond (${shell.n})`);
    assert(shell.moved, 'turtles paddle around the pond');

    console.log('\n[59] 7-Eleven security guard');
    const booth = await page.evaluate(() => {
      const G = window.GAME, main = window.__REALISM_MAIN;
      const g = G.sevenGuard;
      const seven = G.world && (G.world.sevenWalkIn || (G.world.sevenElevens && G.world.sevenElevens[0]));
      main.updatePeds(0.05);
      main.updateSevenGuard(0.05);
      const ped = g && g.ped;
      const seated = !!(ped && ped.sevenGuard && ped.mesh && ped.mesh.position.y >= 0.3);
      const chair = !!(g && g.chair && g.chair.name === 'seven-chair');
      const near = !!(seven && seven.pos && ped && ped.mesh && Math.hypot(ped.mesh.position.x - seven.pos.x, ped.mesh.position.z - seven.pos.z) < 10);
      const torch = !!(ped && ped.mesh && ped.mesh.getObjectByName('flashlight'));
      G.time.dayT = 12 / 24;
      main.updateSevenGuard(0.05);
      const dayOff = !!(g && g.beam && g.beam.visible === false && g.light && g.light.intensity === 0);
      G.time.dayT = 21.5 / 24;
      main.updateSevenGuard(0.05);
      const nightOn = !!(g && g.beam && g.beam.visible && g.light && g.light.intensity > 0.4);
      return { flag: !!(G.gameplay && G.gameplay.sevenGuard), seated, chair, near, torch, dayOff, nightOn };
    });
    assert(booth.flag && booth.seated && booth.chair && booth.near, 'a guard sits outside 7-Eleven');
    assert(booth.torch && booth.dayOff && booth.nightOn, 'the guard torch only comes on at night');

    console.log('\n[60] soi PA speakers');
    const pa = await page.evaluate(() => {
      const G = window.GAME, main = window.__REALISM_MAIN;
      const list = G.soiPa || [];
      const n = list.filter(s => s && s.mesh && s.mesh.name === 'soi-pa').length;
      const horns = list.filter(s => s && s.mesh && s.mesh.getObjectByName('pa-horn')).length;
      const onSoi = list.filter(s => s && s.soi).length;
      const s0 = list[0];
      if (s0) G.player.group.position.set(s0.x, 0, s0.z);
      G._soiPaSlot = null;
      G._soiPa = null;
      G.time.dayT = 7.2 / 24;
      G._weatherUntil = 1e9;
      main.updateDayNight(0.05);
      const morning = G._soiPa && G._soiPa.slot === 'morning' && G._soiPa.near;
      G.time.dayT = 12 / 24;
      main.updateDayNight(0.05);
      const midday = G._soiPaSlot == null;
      G._soiPaSlot = null;
      G.time.dayT = 16.8 / 24;
      main.updateDayNight(0.05);
      const afternoon = G._soiPa && G._soiPa.slot === 'afternoon' && G._soiPa.near;
      return { flag: !!(G.gameplay && G.gameplay.soiPa), n, horns, onSoi, morning, midday, afternoon };
    });
    assert(pa.flag && pa.n >= 2 && pa.horns >= 2 && pa.onSoi >= 2, `soi PA horns on the alleys (${pa.n})`);
    assert(pa.morning && pa.midday && pa.afternoon, 'PA crackles at morning and afternoon, not midday');

    console.log('\n[61] soi chairs and beer crates');
    const drink = await page.evaluate(() => {
      const G = window.GAME, main = window.__REALISM_MAIN;
      const set = G.soiChairs;
      const chairs = set && set.seats ? set.seats.filter(s => s && s.mesh && s.mesh.name === 'plastic-chair').length : 0;
      const crates = set && set.crates ? set.crates.filter(c => c && c.name === 'beer-crate').length : 0;
      G.time.dayT = 20.2 / 24;
      main.updateSoiChairs(0.05);
      main.updatePeds(0.05);
      const night = (G._soiDrinkers || []).filter(p => p && p.soiDrink && p.mesh && p.mesh.position.y >= 0.3).length;
      G.time.dayT = 12 / 24;
      main.updateSoiChairs(0.05);
      const dayGone = !(G._soiDrinkers && G._soiDrinkers.length);
      return { flag: !!(G.gameplay && G.gameplay.soiChairs), chairs, crates, night, dayGone, onSoi: !!(set && set.soi) };
    });
    assert(drink.flag && drink.onSoi && drink.chairs >= 2 && drink.crates >= 2, `chairs and crates on a soi (${drink.chairs})`);
    assert(drink.night >= 2 && drink.dayGone, 'drinkers sit after dark and clear by day');

    console.log('\n[62] soi mechanic');
    const wrench = await page.evaluate(() => {
      const G = window.GAME, main = window.__REALISM_MAIN;
      const shop = G.soiMechanic;
      const ped = shop && shop.ped;
      const bike = shop && shop.bike;
      const stand = shop && shop.stand && shop.stand.name === 'paddock-stand';
      const tool = !!(ped && ped.mesh && ped.mesh.getObjectByName('wrench'));
      if (bike && bike._standHome) {
        bike.driver = null;
        bike.vel = 0;
        bike.pos.set(bike._standHome.x, 0, bike._standHome.z);
        if (bike.mesh) {
          bike.mesh.position.set(bike._standHome.x, bike._standHome.y || 0.28, bike._standHome.z);
          bike.mesh.rotation.y = bike._standHome.heading || 0;
        }
      }
      const pinned = !!(bike && bike._standHome && bike.driver !== 'player');
      const car = G.vehicles.find(v => v && v.spec && v.spec.kind !== 'boat' && v.spec.kind !== 'airliner' && v !== bike) || main.makeVehicle('camry', G.scene);
      G.player.inVehicle = car;
      G._eating = null;
      car.driver = 'player';
      car.dead = false;
      car.hp = 40;
      car.tiresBlown = true;
      if (shop) {
        car.pos.set(shop.x, 0, shop.z);
        if (car.mesh) car.mesh.position.copy(car.pos);
        G.player.group.position.set(shop.x, 0, shop.z);
      }
      G.cash = 200;
      window.dispatchEvent(new KeyboardEvent('keyup', { code: 'KeyE' }));
      if (G.input && G.input.endFrame) G.input.endFrame();
      let fixed = false;
      for (let i = 0; i < 4 && !fixed; i++) {
        window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyE' }));
        main.updateSoiMechanic(0.016);
        window.dispatchEvent(new KeyboardEvent('keyup', { code: 'KeyE' }));
        if (G.input && G.input.endFrame) G.input.endFrame();
        fixed = car.hp === 100 && car.tiresBlown === false && G.cash === 120;
      }
      G.player.inVehicle = null;
      car.driver = car.npc ? 'npc' : null;
      return {
        flag: !!(G.gameplay && G.gameplay.soiMechanic),
        ped: !!(ped && ped.soiMechanic), stand, tool, pinned, onSoi: !!(shop && shop.soi), fixed,
      };
    });
    assert(wrench.flag && wrench.ped && wrench.stand && wrench.tool && wrench.onSoi, 'a mechanic waits with a bike on a stand');
    assert(wrench.pinned && wrench.fixed, 'the shop bike stays put and E patches a wreck for ฿80');

    console.log('\n[63] cop cars cannot fit the soi');
    const alley = await page.evaluate(() => {
      const G = window.GAME, main = window.__REALISM_MAIN;
      const sois = (G.world && G.world.sois) || [];
      const s = sois[0];
      if (!s) return { flag: !!(G.gameplay && G.gameplay.copSoiBlock), sois: 0 };
      const alongZ = s.axis === 'z';
      const midX = (s.x0 + s.x1) * 0.5, midZ = (s.z0 + s.z1) * 0.5;
      const inside = alongZ
        ? { x: midX, z: s.z0 + (s.z1 - s.z0) * 0.55 }
        : { x: s.x0 + (s.x1 - s.x0) * 0.55, z: midZ };
      const mouth = alongZ
        ? { x: midX, z: s.z0 - 4.2, heading: 0 }
        : { x: s.x0 - 4.2, z: midZ, heading: Math.PI / 2 };
      G.player.inVehicle = null;
      G.player.group.visible = true;
      G.player.group.position.set(inside.x, 0, inside.z);
      G.wanted.stars = 2;
      G.wanted.crime = 5;
      let cop = G.vehicles.find(v => v && v.isCop && v.spec && v.spec.kind === 'cop');
      if (!cop) cop = main.spawnCopCar(G.scene, G.player.group.position);
      cop.driver = 'cop';
      cop.dead = false;
      cop.pos.set(mouth.x, 0, mouth.z);
      cop.heading = mouth.heading;
      cop.vel = 12;
      if (cop.mesh) { cop.mesh.position.copy(cop.pos); cop.mesh.rotation.y = cop.heading; }
      const onSoi = (x, z) => (sois || []).some(c => x >= c.x0 && x <= c.x1 && z >= c.z0 && z <= c.z1);
      const startOn = onSoi(cop.pos.x, cop.pos.z);
      for (let i = 0; i < 24; i++) main.updateCop(cop, 0.12);
      const entered = onSoi(cop.pos.x, cop.pos.z);
      const blocked = !!cop._soiBlocked;
      const playerOn = onSoi(inside.x, inside.z);
      G.wanted.stars = 0;
      G.wanted.crime = 0;
      return {
        flag: !!(G.gameplay && G.gameplay.copSoiBlock),
        sois: sois.length, startOn, entered, blocked, playerOn, vel: cop.vel,
      };
    });
    assert(alley.flag && alley.sois >= 4 && alley.playerOn, `sois exist for the chase (${alley.sois})`);
    assert(!alley.startOn && !alley.entered && alley.blocked, 'the patrol car stalls at the soi mouth');

    console.log('\n[64] flooded sois after a downpour');
    const sheet = await page.evaluate(() => {
      const G = window.GAME, main = window.__REALISM_MAIN;
      const floods = (G.world && G.world.flood) || [];
      const soiFloods = floods.filter(f => f && f.soi).length;
      const patch = floods.find(f => f && f.soi) || floods[0];
      const mid = patch
        ? { x: (patch.x0 + patch.x1) * 0.5, z: (patch.z0 + patch.z1) * 0.5 }
        : { x: 0, z: 0 };
      G.time.weather = 'rain';
      G.time.rainStrength = 0.88;
      G._rainTarget = 0.88;
      G._weatherUntil = 1e9;
      main.updateDayNight(0.05);
      const wet = G.world.surfaceMaterials && G.world.surfaceMaterials.floodMat
        ? G.world.surfaceMaterials.floodMat.opacity : 0;
      const flooded = floods.some(f => f && f.soi
        && mid.x >= f.x0 && mid.x <= f.x1 && mid.z >= f.z0 && mid.z <= f.z1);
      const rain = G.time.rainStrength || 0;
      const carKind = 'camry', bikeKind = 'bike';
      const carGetsFlood = rain > 0.7 && flooded && carKind !== 'bike';
      const bikeGetsFlood = rain > 0.7 && flooded && bikeKind !== 'bike';
      let vel = 12;
      const k = 1 - Math.pow(0.2, 0.1);
      for (let i = 0; i < 20; i++) {
        if (carGetsFlood && vel > 4) vel = vel + (4 - vel) * k;
      }
      G.player.inVehicle = null;
      G.time.rainStrength = 0;
      G._rainTarget = 0;
      return {
        flag: !!(G.gameplay && G.gameplay.floodSois),
        soiFloods, wet, flooded, carGetsFlood, bikeGetsFlood, crawled: vel < 6, vel,
      };
    });
    assert(sheet.flag && sheet.soiFloods >= 2 && sheet.wet > 0.1 && sheet.flooded, `sois sheet with flood water (${sheet.soiFloods})`);
    assert(sheet.carGetsFlood && !sheet.bikeGetsFlood && sheet.crawled, 'cars crawl the flooded soi, bikes still filter');

    console.log('\n[65] dawn alms on a soi');
    const takbat = await page.evaluate(() => {
      const G = window.GAME, main = window.__REALISM_MAIN;
      G.time.dayT = 5.6 / 24;
      G.player.inVehicle = null;
      G._eating = null;
      G.player.group.visible = true;
      G._almsOffered = 0;
      main.updateAlms(0.05);
      const monks = (G._alms || []).filter(p => p && p.alms && p.kind === 'monk');
      const sois = (G.world && G.world.sois) || [];
      const onSoi = (x, z) => sois.some(c => x >= c.x0 && x <= c.x1 && z >= c.z0 && z <= c.z1);
      const placed = monks.filter(p => p.mesh && onSoi(p.mesh.position.x, p.mesh.position.z)).length;
      const m0 = monks[0];
      const start = m0 && m0.mesh ? { x: m0.mesh.position.x, z: m0.mesh.position.z } : null;
      if (m0 && m0.mesh) G.player.group.position.set(m0.mesh.position.x + 50, 0, m0.mesh.position.z + 50);
      for (let i = 0; i < 40; i++) main.updateAlms(0.25);
      const moved = !!(m0 && start && Math.hypot(m0.mesh.position.x - start.x, m0.mesh.position.z - start.z) > 0.4);
      const bowl = !!(m0 && m0.mesh && m0.mesh.getObjectByName('alms-bowl'));
      if (m0 && m0.mesh) G.player.group.position.copy(m0.mesh.position);
      G.cash = 80;
      G.wanted.stars = 2;
      G.wanted.lastSeenAt = performance.now();
      const seen0 = G.wanted.lastSeenAt;
      window.dispatchEvent(new KeyboardEvent('keyup', { code: 'KeyE' }));
      if (G.input && G.input.endFrame) G.input.endFrame();
      let paid = false;
      for (let i = 0; i < 4 && !paid; i++) {
        window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyE' }));
        main.updateAlms(0.016);
        window.dispatchEvent(new KeyboardEvent('keyup', { code: 'KeyE' }));
        if (G.input && G.input.endFrame) G.input.endFrame();
        paid = G.cash === 60;
      }
      const cooled = G.wanted.lastSeenAt < seen0 - 1000;
      G.time.dayT = 12 / 24;
      main.updateAlms(0.05);
      const gone = !(G._alms && G._alms.length);
      return {
        flag: !!(G.gameplay && G.gameplay.dawnAlms),
        n: monks.length, placed, moved, bowl, paid, cooled, offered: G._almsOffered, gone,
      };
    });
    assert(takbat.flag && takbat.n >= 3 && takbat.placed >= 2 && takbat.bowl, `dawn monks walk a soi (${takbat.n})`);
    assert(takbat.moved, 'alms round moves along the soi');
    assert(takbat.paid && takbat.cooled && takbat.offered >= 1, 'E offers ฿20 and cools heat');
    assert(takbat.gone, 'monks end the round after morning');

    console.log('\n[66] Soi Cowboy neon block');
    const cowboy = await page.evaluate(() => {
      const G = window.GAME, main = window.__REALISM_MAIN;
      const strip = G.soiCowboy;
      const signs = (strip && strip.signs) || [];
      const n = signs.filter(s => s && s.mesh && s.mesh.name === 'cowboy-neon').length;
      const neons = signs.filter(s => s && s.mesh && s.mesh.getObjectByName('cowboy-sign')).length;
      const bar = strip && strip.origin;
      const nearBar = signs.filter(s => s && bar && Math.hypot(s.x - bar.x, s.z - bar.z) < 22).length;
      G.time.dayT = 12 / 24;
      G._weatherUntil = 1e9;
      main.updateDayNight(0.05);
      main.updateSoiCowboy(0.05);
      const dayGlow = signs[0] && signs[0].mat ? signs[0].mat.emissiveIntensity : 9;
      const dayTouts = (G._cowboyTouts || []).filter(p => p && p.cowboy).length;
      G.time.dayT = 21.4 / 24;
      main.updateDayNight(0.05);
      main.updateSoiCowboy(0.05);
      const nightGlow = signs[0] && signs[0].mat ? signs[0].mat.emissiveIntensity : 0;
      const nightTouts = (G._cowboyTouts || []).filter(p => p && p.cowboy && p.mesh).length;
      const lit = signs.filter(s => s && s.light && s.light.intensity > 0.4).length;
      const poi = !!(G.world && G.world.poi && G.world.poi.cowboy);
      return {
        flag: !!(G.gameplay && G.gameplay.soiCowboy),
        n, neons, nearBar, dayGlow, nightGlow, dayTouts, nightTouts, lit, poi,
      };
    });
    assert(cowboy.flag && cowboy.n >= 4 && cowboy.neons >= 4 && cowboy.poi, `Soi Cowboy neon strip (${cowboy.n})`);
    assert(cowboy.nearBar >= 4 && cowboy.dayGlow < 0.7 && cowboy.nightGlow > 1.0, 'neon wakes up after 20:00');
    assert(cowboy.dayTouts === 0 && cowboy.nightTouts >= 3 && cowboy.lit >= 3, 'touts and lights only after dark');

    console.log('\n[67] phone jobs that need a place');
    const book = await page.evaluate(() => {
      const G = window.GAME;
      G._welcomeDone = true;
      if (G.hud && G.hud.setPhoneStats) G.hud.setPhoneStats();
      const rows = {};
      document.querySelectorAll('#ph-activities .act').forEach(el => {
        const name = (el.querySelector('.a-name') && el.querySelector('.a-name').textContent) || '';
        const meta = (el.querySelector('.a-meta') && el.querySelector('.a-meta').textContent) || '';
        const m = meta.match(/(\d+)\s*m\s*$/);
        rows[name] = m ? Number(m[1]) : null;
      });
      return {
        flag: !!(G.gameplay && G.gameplay.phonePlaces),
        soiRun: rows['Soi Run'],
        night: rows['2 AM Soi Race'],
        taxi: rows['Taxi · press J'],
        drop: rows['Moto Drop · Y/J'],
        props: rows['Properties'],
        cowboy: rows['Soi Cowboy'],
      };
    });
    assert(book.flag, 'phonePlaces flag on');
    assert(book.soiRun != null && book.night != null, `Soi Run and 2 AM race have places (${book.soiRun}m, ${book.night}m)`);
    assert(book.taxi != null && book.drop != null && book.props != null, `taxi, moto drop and properties have places (${book.taxi}m)`);
    assert(book.cowboy != null, 'Soi Cowboy still lists a distance');

    console.log('\n[68] longtail river chase');
    const river = await page.evaluate(() => {
      const G = window.GAME, main = window.__REALISM_MAIN;
      let boat = G.vehicles.find(v => v && v.spec && v.spec.kind === 'boat' && !v.dead && !v.isCop);
      if (!boat) boat = main.makeVehicle('boat', G.scene);
      boat.dead = false;
      boat.pos.set(-224, 0.3, 20);
      boat.heading = 0;
      boat.vel = 8;
      if (boat.mesh) { boat.mesh.position.copy(boat.pos); boat.mesh.rotation.y = 0; }
      G.player.inVehicle = boat;
      boat.driver = 'player';
      G.player.group.position.set(-224, 0.5, 20);
      G.wanted.stars = 2;
      G.wanted.crime = 5;
      G.policeOff = false;
      G._btsRide = null;
      for (let i = 0; i < 80; i++) main.updateWanted(0.25);
      let cops = G.vehicles.filter(v => v && v.isCop && v.spec && v.spec.kind === 'boat' && !v.dead && v.driver === 'cop');
      if (!cops.length && main.spawnCopBoat) {
        const spawned = main.spawnCopBoat(G.scene, boat.pos);
        spawned.pos.set(-224, 0.3, -30);
        spawned.heading = 0;
        spawned.vel = 10;
        if (spawned.mesh) { spawned.mesh.position.copy(spawned.pos); spawned.mesh.rotation.y = 0; }
        cops = [spawned];
      }
      const cop = cops[0];
      let moved = 0, inRiver = false, lamps = false;
      if (cop) {
        cop.pos.set(-224, 0.3, -30);
        cop.heading = 0;
        cop.vel = 12;
        if (cop.mesh) { cop.mesh.position.copy(cop.pos); cop.mesh.rotation.y = 0; }
        const z0 = cop.pos.z;
        for (let i = 0; i < 24; i++) main.updateCopBoat(cop, 0.12);
        moved = cop.pos.z - z0;
        inRiver = cop.pos.x >= -248 && cop.pos.x <= -210;
        lamps = !!(cop.mesh && cop.mesh.userData && cop.mesh.userData.copLamps && cop.mesh.userData.copLamps.length >= 2);
      }
      G.player.inVehicle = null;
      boat.driver = boat.npc ? 'boatman' : null;
      G.wanted.stars = 0;
      G.wanted.crime = 0;
      return {
        flag: !!(G.gameplay && G.gameplay.longtailChase),
        n: cops.length, moved, inRiver, lamps,
      };
    });
    assert(river.flag && river.n >= 1 && river.lamps, `a river cop longtail joins the chase (${river.n})`);
    assert(river.inRiver && river.moved > 2, `the cop boat stays in the channel and closes (${river.moved.toFixed(1)}m)`);

    console.log('\n[69] khlong boat noodles');
    const bowl = await page.evaluate(() => {
      const G = window.GAME, main = window.__REALISM_MAIN;
      const c = G.boatNoodle;
      const mesh = c && c.mesh;
      const pot = !!(mesh && mesh.getObjectByName('noodle-pot'));
      const steam = !!(mesh && mesh.getObjectByName('noodle-steam'));
      const pier = G.world && G.world.poi && G.world.poi.pier;
      const nearPier = !!(mesh && pier && Math.hypot(mesh.position.x - pier.x, mesh.position.z - pier.z) < 18);
      const onRiver = !!(mesh && mesh.position.x < -200 && mesh.position.x > -248);
      const start = mesh ? { x: mesh.position.x, z: mesh.position.z } : null;
      G.player.inVehicle = null;
      G._eating = null;
      if (mesh) G.player.group.position.set(mesh.position.x + 40, 0, mesh.position.z + 40);
      for (let i = 0; i < 40; i++) main.updateBoatNoodle(0.25);
      const moved = !!(mesh && start && Math.hypot(mesh.position.x - start.x, mesh.position.z - start.z) > 0.4);
      if (mesh) G.player.group.position.copy(mesh.position);
      G.cash = 120;
      G.player.hp = 40;
      window.dispatchEvent(new KeyboardEvent('keyup', { code: 'KeyE' }));
      if (G.input && G.input.endFrame) G.input.endFrame();
      let paid = false;
      for (let i = 0; i < 4 && !paid; i++) {
        window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyE' }));
        main.updateBoatNoodle(0.016);
        window.dispatchEvent(new KeyboardEvent('keyup', { code: 'KeyE' }));
        if (G.input && G.input.endFrame) G.input.endFrame();
        paid = G.cash === 70;
      }
      const vendor = !!(c && c.vendor && c.vendor.boatNoodle);
      return {
        flag: !!(G.gameplay && G.gameplay.boatNoodle),
        named: !!(mesh && mesh.name === 'noodle-boat'),
        pot, steam, nearPier, onRiver, moved, paid, healed: G.player.hp > 40, vendor,
      };
    });
    assert(bowl.flag && bowl.named && bowl.pot && bowl.steam && bowl.vendor, 'a noodle boat works the pier');
    assert(bowl.nearPier && bowl.onRiver && bowl.moved, 'the boat sits on the khlong and drifts');
    assert(bowl.paid && bowl.healed, 'E buys boat noodles for ฿50');

    console.log('\n[70] 2 AM checkpoint');
    const two = await page.evaluate(() => {
      const G = window.GAME, main = window.__REALISM_MAIN;
      const cp = G.checkpoint;
      const spikes = !!(cp && cp.spikes && cp.spikes.name === 'checkpoint-spikes');
      G.time.dayT = 12 / 24;
      main.updateCheckpoint(0.05);
      const day = !!(cp && !cp.late && cp.spikes && cp.spikes.visible === false);
      G.time.dayT = 22.4 / 24;
      main.updateCheckpoint(0.05);
      const evening = !!(cp && cp.active && !cp.late && cp.spikes && cp.spikes.visible === false);
      G.time.dayT = 2.2 / 24;
      G.policeOff = false;
      G.wanted.stars = 0;
      G.wanted.crime = 0;
      if (cp) cp.flagged = false;
      main.updateCheckpoint(0.05);
      const lateOn = !!(cp && cp.late && cp.active && cp.spikes && cp.spikes.visible);
      const cap = (G.gameplay && G.gameplay.twoAmCheckpoint && cp && cp.late) ? 2.2 : 3.2;
      const ride = G.vehicles.find(v => v && v.spec && v.spec.kind !== 'boat' && v.spec.kind !== 'airliner') || main.makeVehicle('camry', G.scene);
      G.player.inVehicle = ride;
      ride.driver = 'player';
      ride.dead = false;
      ride.tiresBlown = false;
      ride.pos.set(cp.x, 0, cp.z);
      if (ride.mesh) ride.mesh.position.copy(ride.pos);
      ride.vel = 14;
      cp.flagged = false;
      G.wanted.stars = 0;
      G.wanted.crime = 0;
      main.updateCheckpoint(0.016);
      const stars = G.wanted.stars;
      const blown = !!ride.tiresBlown;
      G.wanted.stars = 0;
      G.wanted.crime = 0;
      G.player.inVehicle = null;
      ride.driver = ride.npc ? 'npc' : null;
      ride.vel = 0;
      ride.tiresBlown = false;
      G.time.dayT = 12 / 24;
      main.updateCheckpoint(0.05);
      return {
        flag: !!(G.gameplay && G.gameplay.twoAmCheckpoint),
        spikes, day, evening, lateOn, stars, blown, cap,
      };
    });
    assert(two.flag && two.spikes && two.day && two.evening, '2 AM strip hides until the late window');
    assert(two.lateOn && two.cap === 2.2 && two.stars >= 2 && two.blown, 'blowing the 2 AM ด่าน is two stars and a spike strip');

    console.log('\n[71] som tam cart');
    const papaya = await page.evaluate(() => {
      const G = window.GAME, main = window.__REALISM_MAIN;
      const list = G.somTam || [];
      const n = list.filter(c => c && c.mesh && c.mesh.name === 'somtam-cart').length;
      const c0 = list[0];
      const mortar = !!(c0 && c0.mesh && c0.mesh.getObjectByName('somtam-mortar'));
      const pestle = c0 && c0.mesh && c0.mesh.getObjectByName('somtam-pestle');
      if (c0) { c0.t = 0.12; c0.dir = 1; }
      G.player.inVehicle = null;
      G._eating = null;
      if (c0 && c0.mesh) G.player.group.position.set(c0.mesh.position.x + 40, 0, c0.mesh.position.z + 40);
      main.updateSomTam(0.05);
      const y0 = pestle ? pestle.position.y : 0;
      const start = c0 && c0.mesh ? { x: c0.mesh.position.x, z: c0.mesh.position.z } : null;
      for (let i = 0; i < 50; i++) main.updateSomTam(0.3);
      const moved = !!(c0 && start && Math.hypot(c0.mesh.position.x - start.x, c0.mesh.position.z - start.z) > 0.4);
      const pounded = !!(pestle && Math.abs(pestle.position.y - y0) > 0.01);
      if (c0 && c0.mesh) G.player.group.position.copy(c0.mesh.position);
      G.cash = 90;
      G.player.hp = 40;
      window.dispatchEvent(new KeyboardEvent('keyup', { code: 'KeyE' }));
      if (G.input && G.input.endFrame) G.input.endFrame();
      let paid = false;
      for (let i = 0; i < 4 && !paid; i++) {
        window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyE' }));
        main.updateSomTam(0.016);
        window.dispatchEvent(new KeyboardEvent('keyup', { code: 'KeyE' }));
        if (G.input && G.input.endFrame) G.input.endFrame();
        paid = G.cash === 45;
      }
      return {
        flag: !!(G.gameplay && G.gameplay.somTam),
        n, mortar, pestle: !!pestle, moved, pounded, paid, healed: G.player.hp > 40,
        onSoi: !!(c0 && c0.soi), vendor: !!(c0 && c0.vendor && c0.vendor.somTam),
      };
    });
    assert(papaya.flag && papaya.n >= 1 && papaya.onSoi && papaya.mortar && papaya.pestle && papaya.vendor, `a som tam cart works a soi (${papaya.n})`);
    assert(papaya.moved && papaya.pounded, 'the cart rolls the soi and the pestle pounds');
    assert(papaya.paid && papaya.healed, 'E buys som tam for ฿45');

    console.log('\n[72] phuang malai at Asok');
    const malai = await page.evaluate(() => {
      const G = window.GAME, main = window.__REALISM_MAIN;
      const stand = G.btsMalai;
      const bts = G.world && G.world.bts;
      const strands = stand && stand.mesh ? stand.mesh.children.filter(c => c && c.name === 'malai-strand').length : 0;
      const near = !!(stand && stand.mesh && bts && Math.hypot(stand.mesh.position.x - bts.x, stand.mesh.position.z - (bts.z || 0)) < 28);
      G.player.inVehicle = null;
      G._btsRide = null;
      G._eating = null;
      G.player.group.visible = true;
      G._malai = false;
      G._malaiOffered = 0;
      if (stand) G.player.group.position.set(stand.x, 0, stand.z);
      G.cash = 80;
      window.dispatchEvent(new KeyboardEvent('keyup', { code: 'KeyE' }));
      if (G.input && G.input.endFrame) G.input.endFrame();
      let paid = false;
      for (let i = 0; i < 4 && !paid; i++) {
        window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyE' }));
        main.updateBtsMalai(0.016);
        window.dispatchEvent(new KeyboardEvent('keyup', { code: 'KeyE' }));
        if (G.input && G.input.endFrame) G.input.endFrame();
        paid = G.cash === 60 && G._malai === true;
      }
      const s = (G.world.shrines || [])[0];
      let offered = false, cooled = false;
      if (s && s.pos) {
        G.player.group.position.set(s.pos.x, 0, s.pos.z);
        G.wanted.stars = 2;
        G.wanted.lastSeenAt = performance.now() + 30000;
        s.readyAt = 1;
        const seen0 = G.wanted.lastSeenAt;
        window.dispatchEvent(new KeyboardEvent('keyup', { code: 'KeyE' }));
        if (G.input && G.input.endFrame) G.input.endFrame();
        for (let i = 0; i < 4 && !offered; i++) {
          window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyE' }));
          main.updateShrines(0.016);
          window.dispatchEvent(new KeyboardEvent('keyup', { code: 'KeyE' }));
          if (G.input && G.input.endFrame) G.input.endFrame();
          offered = (G._malaiOffered || 0) >= 1 && G._malai === false;
        }
        cooled = G.wanted.lastSeenAt < seen0 - 18000;
      }
      return {
        flag: !!(G.gameplay && G.gameplay.btsMalai),
        named: !!(stand && stand.mesh && stand.mesh.name === 'malai-stand'),
        strands, near, paid, offered, cooled,
        vendor: !!(stand && stand.vendor && stand.vendor.btsMalai),
      };
    });
    assert(malai.flag && malai.named && malai.strands >= 4 && malai.near && malai.vendor, `a malai stand waits at Asok (${malai.strands} strands)`);
    assert(malai.paid && malai.offered && malai.cooled, 'E buys a malai and the shrine takes it for extra heat cool');

    console.log('\n[73] Cowboy closing-time stagger');
    const kickout = await page.evaluate(() => {
      const G = window.GAME, main = window.__REALISM_MAIN;
      const origin = G.soiCowboy && G.soiCowboy.origin;
      const bts = G.world && G.world.bts;
      G.time.dayT = 21.5 / 24;
      main.updateSoiCowboy(0.05);
      const nightTouts = (G._cowboyTouts || []).filter(p => p && p.cowboy).length;
      G.time.dayT = 4.4 / 24;
      main.updateSoiCowboy(0.05);
      main.updateCowboyClose(0.05);
      const drunks = (G._cowboyClose || []).filter(p => p && p.cowboyClose && p.mesh);
      const n = drunks.length;
      const nearBar = drunks.filter(p => origin && Math.hypot(p.mesh.position.x - origin.x, p.mesh.position.z - origin.z) < 12).length;
      const p0 = drunks[0];
      const start = p0 && p0.mesh ? { x: p0.mesh.position.x, z: p0.mesh.position.z } : null;
      const dest = { x: bts ? bts.x : -50, z: (bts && bts.z) || 0 };
      const d0 = p0 && start ? Math.hypot(start.x - dest.x, start.z - dest.z) : 0;
      for (let i = 0; i < 40; i++) {
        main.updateCowboyClose(0.25);
        main.updatePeds(0.25);
      }
      const d1 = p0 && p0.mesh ? Math.hypot(p0.mesh.position.x - dest.x, p0.mesh.position.z - dest.z) : d0;
      const moved = !!(p0 && start && Math.hypot(p0.mesh.position.x - start.x, p0.mesh.position.z - start.z) > 0.8);
      const toward = d1 < d0 - 0.5;
      G.time.dayT = 12 / 24;
      main.updateCowboyClose(0.05);
      const gone = !(G._cowboyClose && G._cowboyClose.length);
      return {
        flag: !!(G.gameplay && G.gameplay.cowboyClose),
        nightTouts, n, nearBar, moved, toward, gone,
      };
    });
    assert(kickout.flag && kickout.nightTouts >= 3, 'touts work Cowboy before close');
    assert(kickout.n >= 3 && kickout.nearBar >= 2 && kickout.moved && kickout.toward, 'after 4 AM the crowd walks it off toward the BTS');
    assert(kickout.gone, 'the stagger clears by morning');

    console.log('\n[74] pla kat bags on a soi');
    const betta = await page.evaluate(() => {
      const G = window.GAME, main = window.__REALISM_MAIN;
      const stand = G.plaKat;
      const bags = stand && stand.bags ? stand.bags.filter(b => b && b.name === 'plakat-bag').length : 0;
      const fish = stand && stand.bags ? stand.bags.filter(b => b && b.getObjectByName('plakat-fish')).length : 0;
      const f0 = stand && stand.bags && stand.bags[0] && stand.bags[0].getObjectByName('plakat-fish');
      stand.t = 0;
      main.updatePlaKat(0.05);
      const x0 = f0 ? f0.position.x : 0;
      stand.t = 0.8;
      main.updatePlaKat(0.05);
      const swam = !!(f0 && Math.abs(f0.position.x - x0) > 0.005);
      G.player.inVehicle = null;
      G._eating = null;
      G._barberCut = null;
      G._btsRide = null;
      G.player.group.visible = true;
      if (stand) G.player.group.position.set(stand.x, 0, stand.z);
      G.cash = 100;
      G._plaKat = 0;
      window.dispatchEvent(new KeyboardEvent('keyup', { code: 'KeyE' }));
      if (G.input && G.input.endFrame) G.input.endFrame();
      let paid = false;
      for (let i = 0; i < 8 && !paid; i++) {
        window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyE' }));
        main.updatePlaKat(0.016);
        window.dispatchEvent(new KeyboardEvent('keyup', { code: 'KeyE' }));
        if (G.input && G.input.endFrame) G.input.endFrame();
        paid = G.cash === 60 && G._plaKat >= 1;
      }
      return {
        flag: !!(G.gameplay && G.gameplay.plaKat),
        named: !!(stand && stand.mesh && stand.mesh.name === 'plakat-rack'),
        bags, fish, swam, paid, onSoi: !!(stand && stand.soi),
        vendor: !!(stand && stand.vendor && stand.vendor.plaKat),
      };
    });
    assert(betta.flag && betta.named && betta.bags >= 5 && betta.fish >= 5 && betta.onSoi && betta.vendor, `fighting-fish bags hang on a soi (${betta.bags})`);
    assert(betta.swam && betta.paid, 'the fish swim in the bags and E buys one for ฿40');

    console.log('\n[75] cha yen cart');
    const tea = await page.evaluate(() => {
      const G = window.GAME, main = window.__REALISM_MAIN;
      const list = G.chaYen || [];
      const n = list.filter(c => c && c.mesh && c.mesh.name === 'chayen-cart').length;
      const c0 = list[0];
      const urn = !!(c0 && c0.mesh && c0.mesh.getObjectByName('chayen-urn'));
      const cup = !!(c0 && c0.mesh && c0.mesh.getObjectByName('chayen-cup'));
      if (c0) { c0.t = 0.12; c0.dir = 1; }
      G.player.inVehicle = null;
      G._eating = null;
      if (c0 && c0.mesh) G.player.group.position.set(c0.mesh.position.x + 40, 0, c0.mesh.position.z + 40);
      main.updateChaYen(0.05);
      const start = c0 && c0.mesh ? { x: c0.mesh.position.x, z: c0.mesh.position.z } : null;
      const glow0 = c0 && c0.mesh && c0.mesh.getObjectByName('chayen-urn') ? c0.mesh.getObjectByName('chayen-urn').material.emissiveIntensity : 0;
      for (let i = 0; i < 50; i++) main.updateChaYen(0.3);
      const moved = !!(c0 && start && Math.hypot(c0.mesh.position.x - start.x, c0.mesh.position.z - start.z) > 0.4);
      const urnMat = c0 && c0.mesh && c0.mesh.getObjectByName('chayen-urn');
      const glowed = !!(urnMat && Math.abs((urnMat.material.emissiveIntensity || 0) - glow0) > 0.001);
      if (c0 && c0.mesh) G.player.group.position.copy(c0.mesh.position);
      G.cash = 75;
      G.player.stam = 10;
      window.dispatchEvent(new KeyboardEvent('keyup', { code: 'KeyE' }));
      if (G.input && G.input.endFrame) G.input.endFrame();
      let paid = false;
      for (let i = 0; i < 4 && !paid; i++) {
        window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyE' }));
        main.updateChaYen(0.016);
        window.dispatchEvent(new KeyboardEvent('keyup', { code: 'KeyE' }));
        if (G.input && G.input.endFrame) G.input.endFrame();
        paid = G.cash === 50;
      }
      return {
        flag: !!(G.gameplay && G.gameplay.chaYen),
        n, urn, cup, moved, glowed, paid, stam: G.player.stam,
        onSoi: !!(c0 && c0.soi), vendor: !!(c0 && c0.vendor && c0.vendor.chaYen),
      };
    });
    assert(tea.flag && tea.n >= 1 && tea.onSoi && tea.urn && tea.cup && tea.vendor, `a cha yen cart works a soi (${tea.n})`);
    assert(tea.moved && tea.glowed, 'the cart rolls the soi and the urn stays warm');
    assert(tea.paid && tea.stam > 10, 'E buys cha yen for ฿25 and fills stamina');

    console.log('\n[76] soi barber');
    const fade = await page.evaluate(() => {
      const G = window.GAME, main = window.__REALISM_MAIN;
      const shop = G.soiBarber;
      const chair = !!(shop && shop.chair && shop.chair.name === 'barber-chair');
      const pole = !!(shop && shop.pole && shop.pole.name === 'barber-pole');
      const cape = !!(shop && shop.cape && shop.cape.name === 'barber-cape');
      const clip = !!(shop && shop.clip && shop.clip.name === 'clippers');
      const y0 = shop && shop.pole ? shop.pole.rotation.y : 0;
      const clip0 = shop && shop.clip ? shop.clip.rotation.z : 0;
      for (let i = 0; i < 20; i++) main.updateSoiBarber(0.05);
      const spun = !!(shop && shop.pole && Math.abs(shop.pole.rotation.y - y0) > 0.1);
      const buzzed = !!(shop && shop.clip && Math.abs(shop.clip.rotation.z - clip0) > 0.1);
      G.player.inVehicle = null;
      G._eating = null;
      G._barberCut = null;
      G._haircut = false;
      if (G.player.hair) G.player.hair.scale.set(0.95, 0.58, 0.88);
      if (shop) G.player.group.position.set(shop.x, 0, shop.z);
      G.cash = 100;
      const seen0 = performance.now() + 30000;
      G.wanted.lastSeenAt = seen0;
      window.dispatchEvent(new KeyboardEvent('keyup', { code: 'KeyE' }));
      if (G.input && G.input.endFrame) G.input.endFrame();
      let paid = false;
      for (let i = 0; i < 4 && !paid; i++) {
        window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyE' }));
        main.updateSoiBarber(0.016);
        window.dispatchEvent(new KeyboardEvent('keyup', { code: 'KeyE' }));
        if (G.input && G.input.endFrame) G.input.endFrame();
        paid = G.cash === 20 && !!G._barberCut;
      }
      for (let i = 0; i < 12; i++) main.updateSoiBarber(0.2);
      const hairY = G.player.hair ? G.player.hair.scale.y : 1;
      return {
        flag: !!(G.gameplay && G.gameplay.soiBarber),
        chair, pole, cape, clip, spun, buzzed, paid,
        onSoi: !!(shop && shop.soi),
        vendor: !!(shop && shop.ped && shop.ped.soiBarber),
        cut: !!G._haircut && !G._barberCut,
        hairY,
        cooled: G.wanted.lastSeenAt <= seen0 - 10000,
      };
    });
    assert(fade.flag && fade.chair && fade.pole && fade.cape && fade.clip && fade.onSoi && fade.vendor, 'a plastic-chair barber works a soi');
    assert(fade.spun && fade.buzzed, 'the pole spins and the clippers buzz');
    assert(fade.paid && fade.cut && fade.hairY < 0.4 && fade.cooled, 'E buys a ฿80 fade and cools last-seen');

    console.log('\n[77] BTS ticket gates');
    const tap = await page.evaluate(() => {
      const G = window.GAME, main = window.__REALISM_MAIN;
      const st = G.btsGates;
      const n = st && st.gates ? st.gates.filter(g => g && g.mesh && g.mesh.name === 'bts-gate').length : 0;
      const flaps = st && st.gates ? st.gates.filter(g => g && g.flap && g.flap.name === 'bts-flap').length : 0;
      const machine = !!(st && st.machine && st.machine.name === 'bts-ticket-machine');
      const screen = !!(st && st.machine && st.machine.getObjectByName('bts-ticket-screen'));
      G.player.inVehicle = null;
      G._btsRide = null;
      G._eating = null;
      G._barberCut = null;
      G._btsTicket = false;
      G._btsHopped = 0;
      G._btsTapped = 0;
      G.policeOff = false;
      G.wanted.stars = 0;
      G.wanted.crime = 0;
      if (st && st.machine) G.player.group.position.set(st.machine.position.x, 0, st.machine.position.z);
      G.cash = 100;
      window.dispatchEvent(new KeyboardEvent('keyup', { code: 'KeyE' }));
      if (G.input && G.input.endFrame) G.input.endFrame();
      let paid = false;
      for (let i = 0; i < 4 && !paid; i++) {
        window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyE' }));
        main.updateBtsGates(0.016);
        window.dispatchEvent(new KeyboardEvent('keyup', { code: 'KeyE' }));
        if (G.input && G.input.endFrame) G.input.endFrame();
        paid = G.cash === 50 && !!G._btsTicket;
      }
      G._btsTicket = false;
      st.openT = 0;
      st._pz = st.zGate - 1.2;
      G.player.group.position.set(st.sx, st.py, st.zGate - 1.2);
      main.updateBtsGates(0.016);
      G.player.group.position.set(st.sx, st.py, st.zGate + 0.8);
      main.updateBtsGates(0.016);
      const hopped = (G._btsHopped || 0) >= 1 && G.wanted.stars >= 1;
      const hopStars = G.wanted.stars;
      G.wanted.stars = 0;
      G.wanted.crime = 0;
      G._btsHopped = 0;
      G._btsTicket = true;
      st.openT = 0;
      st._pz = st.zGate - 1.2;
      G.player.group.position.set(st.sx, st.py, st.zGate - 1.2);
      main.updateBtsGates(0.016);
      G.player.group.position.set(st.sx, st.py, st.zGate + 0.8);
      main.updateBtsGates(0.016);
      const flap = st.gates && st.gates[0] && st.gates[0].flap;
      const opened = !!(flap && flap.rotation.y > 0.5);
      const tapped = (G._btsTapped || 0) >= 1 && G.wanted.stars === 0;
      return {
        flag: !!(G.gameplay && G.gameplay.btsGates),
        n, flaps, machine, screen, paid, hopped, hopStars, opened, tapped,
      };
    });
    assert(tap.flag && tap.n >= 3 && tap.flaps >= 3 && tap.machine && tap.screen, `Asok ticket gates (${tap.n})`);
    assert(tap.paid, 'E buys a Rabbit card for ฿50');
    assert(tap.hopped && tap.opened && tap.tapped, 'hopping is a star; a tap opens the flaps');

    console.log('\n[78] tangled soi wires');
    const tangle = await page.evaluate(() => {
      const G = window.GAME, main = window.__REALISM_MAIN;
      const st = G.soiWires;
      const n = st && st.cables ? st.cables.filter(c => c && c.name === 'soi-wire').length : 0;
      const xfmr = !!(st && st.transformer && st.transformer.name === 'soi-transformer');
      const sparks = st && st.sparks ? st.sparks.filter(s => s && s.name === 'soi-spark') : [];
      const spark0 = sparks[0];
      G.time.rainStrength = 0;
      st.t = 0;
      main.updateSoiWires(0.05);
      const dry = !!(spark0 && spark0.material.emissiveIntensity < 0.05 && spark0.visible === false);
      G.time.rainStrength = 0.9;
      st.t = Math.PI / (2 * 22);
      main.updateSoiWires(0.016);
      const wet = !!(spark0 && spark0.material.emissiveIntensity > 0.8 && spark0.visible);
      return {
        flag: !!(G.gameplay && G.gameplay.soiWires),
        n, xfmr, sparks: sparks.length, dry, wet,
        poles: (G.soiPa || []).length,
      };
    });
    assert(tangle.flag && tangle.n >= 4 && tangle.xfmr && tangle.sparks >= 1 && tangle.poles >= 2, `tangled cables on the soi poles (${tangle.n})`);
    assert(tangle.dry && tangle.wet, 'the wires only spark in the rain');

    console.log('\n[79] rain frogs on flooded sois');
    const frogs = await page.evaluate(() => {
      const G = window.GAME, main = window.__REALISM_MAIN;
      const list = G.rainFrogs || [];
      const n = list.filter(f => f && f.mesh && f.mesh.name === 'rain-frog').length;
      const f0 = list[0];
      G.time.rainStrength = 0;
      if (f0) f0.t = 0.12;
      main.updateRainFrogs(0.05);
      const dry = !!(f0 && f0.mesh && f0.mesh.visible === false);
      G.time.rainStrength = 0.8;
      if (f0) { f0.t = 0.12; f0.heading = 0.4; }
      main.updateRainFrogs(0.05);
      const start = f0 && f0.mesh ? { x: f0.mesh.position.x, z: f0.mesh.position.z, y: f0.mesh.position.y } : null;
      for (let i = 0; i < 40; i++) main.updateRainFrogs(0.08);
      const moved = !!(f0 && start && (Math.hypot(f0.mesh.position.x - start.x, f0.mesh.position.z - start.z) > 0.08 || Math.abs(f0.mesh.position.y - start.y) > 0.04));
      const wet = !!(f0 && f0.mesh && f0.mesh.visible);
      const onSoi = !!(f0 && f0.patch && f0.patch.soi);
      return {
        flag: !!(G.gameplay && G.gameplay.rainFrogs),
        n, dry, wet, moved, onSoi,
      };
    });
    assert(frogs.flag && frogs.n >= 5 && frogs.onSoi, `frogs wait on flooded sois (${frogs.n})`);
    assert(frogs.dry && frogs.wet && frogs.moved, 'they only hop while it rains');

    console.log('\n[80] soi CCTV');
    const cams = await page.evaluate(() => {
      const G = window.GAME, main = window.__REALISM_MAIN;
      const list = G.soiCctv || [];
      const n = list.filter(c => c && c.mesh && c.mesh.name === 'soi-cctv').length;
      const leds = list.filter(c => c && c.led && c.led.name === 'soi-cctv-led').length;
      const c0 = list[0];
      G.bullets = [];
      G.player.inVehicle = null;
      G._btsRide = null;
      main.updateSoiCctv(0.05);
      G.nightK = 0;
      main.updateSoiCctv(0.05);
      const dayLed = c0 && c0.led ? c0.led.material.emissiveIntensity : 9;
      G.nightK = 0.8;
      main.updateSoiCctv(0.05);
      const nightLed = c0 && c0.led ? c0.led.material.emissiveIntensity : 0;
      G.policeOff = false;
      G.wanted.stars = 0;
      G.wanted.crime = 0;
      G._cctvPing = 0;
      if (c0) {
        c0._flagged = false;
        G.player.group.position.set(c0.x, 0, c0.z);
      }
      G.bullets = [{ mesh: { position: G.player.group.position } }];
      main.updateSoiCctv(0.016);
      const pinged = (G._cctvPing || 0) >= 1 && G.wanted.stars >= 1;
      G.bullets = [];
      main.updateSoiCctv(0.016);
      return {
        flag: !!(G.gameplay && G.gameplay.soiCctv),
        n, leds, dayLed, nightLed, pinged, onSoi: !!(c0 && c0.soi),
      };
    });
    assert(cams.flag && cams.n >= 3 && cams.leds >= 3 && cams.onSoi, `soi CCTV poles (${cams.n})`);
    assert(cams.dayLed < 0.4 && cams.nightLed > 0.6, 'the red LED wakes up at night');
    assert(cams.pinged, 'a shot in view of a soi camera is a star');

    console.log('\n[81] banana roti cart');
    const fold = await page.evaluate(() => {
      const G = window.GAME, main = window.__REALISM_MAIN;
      const list = G.rotiCart || [];
      const n = list.filter(c => c && c.mesh && c.mesh.name === 'roti-cart').length;
      const c0 = list[0];
      const pan = !!(c0 && c0.mesh && c0.mesh.getObjectByName('roti-pan'));
      const spat = c0 && c0.mesh && c0.mesh.getObjectByName('roti-spatula');
      if (c0) { c0.t = 0.12; c0.dir = 1; }
      G.player.inVehicle = null;
      G._eating = null;
      if (c0 && c0.mesh) G.player.group.position.set(c0.mesh.position.x + 40, 0, c0.mesh.position.z + 40);
      main.updateRotiCart(0.05);
      const start = c0 && c0.mesh ? { x: c0.mesh.position.x, z: c0.mesh.position.z } : null;
      const z0 = spat ? spat.rotation.z : 0;
      if (c0) c0.t = 0.18;
      main.updateRotiCart(0.05);
      const flipped = !!(spat && Math.abs(spat.rotation.z - z0) > 0.05);
      if (c0) { c0.t = 0.12; c0.dir = 1; }
      main.updateRotiCart(0.05);
      const start2 = c0 && c0.mesh ? { x: c0.mesh.position.x, z: c0.mesh.position.z } : start;
      for (let i = 0; i < 50; i++) main.updateRotiCart(0.3);
      const moved = !!(c0 && start2 && Math.hypot(c0.mesh.position.x - start2.x, c0.mesh.position.z - start2.z) > 0.4);
      if (c0 && c0.mesh) G.player.group.position.copy(c0.mesh.position);
      G.cash = 70;
      G.player.hp = 40;
      G.player.stam = 10;
      window.dispatchEvent(new KeyboardEvent('keyup', { code: 'KeyE' }));
      if (G.input && G.input.endFrame) G.input.endFrame();
      let paid = false;
      for (let i = 0; i < 4 && !paid; i++) {
        window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyE' }));
        main.updateRotiCart(0.016);
        window.dispatchEvent(new KeyboardEvent('keyup', { code: 'KeyE' }));
        if (G.input && G.input.endFrame) G.input.endFrame();
        paid = G.cash === 35;
      }
      return {
        flag: !!(G.gameplay && G.gameplay.rotiCart),
        n, pan, moved, flipped, paid, hp: G.player.hp, stam: G.player.stam,
        onSoi: !!(c0 && c0.soi), vendor: !!(c0 && c0.vendor && c0.vendor.roti),
      };
    });
    assert(fold.flag && fold.n >= 1 && fold.onSoi && fold.pan && fold.vendor, `a roti cart works a soi (${fold.n})`);
    assert(fold.moved && fold.flipped, 'the cart rolls the soi and the spatula flips');
    assert(fold.paid && fold.hp > 40 && fold.stam > 10, 'E buys banana roti for ฿35');

    console.log('\n[82] rain ponchos on bikes');
    const cape = await page.evaluate(() => {
      const G = window.GAME, main = window.__REALISM_MAIN;
      let bike = G.vehicles.find(v => v && v.spec && v.spec.kind === 'bike' && !v.dead);
      if (!bike) bike = main.makeVehicle('bike', G.scene);
      bike.dead = false;
      bike.motosaiStand = false;
      bike.driver = 'npc';
      bike.npc = bike.npc || { cruiseSpeed: 8 };
      if (main.syncBikeRider) main.syncBikeRider(bike);
      const poncho = bike.bikeRider && bike.bikeRider.getObjectByName('rain-poncho');
      G.time.rainStrength = 0;
      main.updateRainPoncho(0.05);
      const dry = !!(poncho && poncho.visible === false);
      G.time.rainStrength = 0.85;
      main.updateRainPoncho(0.05);
      const wet = !!(poncho && poncho.visible === true);
      return {
        flag: !!(G.gameplay && G.gameplay.rainPoncho),
        rider: !!(bike.bikeRider && bike.bikeRider.visible),
        named: !!(poncho && poncho.name === 'rain-poncho'),
        dry, wet,
      };
    });
    assert(cape.flag && cape.rider && cape.named, 'bike riders wear a plastic poncho mesh');
    assert(cape.dry && cape.wet, 'the poncho only comes out in the rain');

    console.log('\n[83] 7-Eleven bike seat covers');
    const seat = await page.evaluate(() => {
      const G = window.GAME, main = window.__REALISM_MAIN;
      const list = G.sevenBikes || [];
      const covers = list.filter(b => b && b.mesh && b.mesh.getObjectByName('seat-cover'));
      const b0 = covers[0];
      const cover = b0 && b0.mesh.getObjectByName('seat-cover');
      if (b0) b0.driver = null;
      G.time.rainStrength = 0;
      main.updateBikeSeatCover(0.05);
      const dry = !!(cover && cover.visible === false);
      G.time.rainStrength = 0.85;
      main.updateBikeSeatCover(0.05);
      const wet = !!(cover && cover.visible === true);
      if (b0) b0.driver = 'player';
      main.updateBikeSeatCover(0.05);
      const taken = !!(cover && cover.visible === false);
      if (b0) b0.driver = null;
      return {
        flag: !!(G.gameplay && G.gameplay.bikeSeatCover),
        n: covers.length,
        named: !!(cover && cover.name === 'seat-cover'),
        dry, wet, taken,
      };
    });
    assert(seat.flag && seat.n >= 4 && seat.named, `parked 7-Eleven bikes wear seat covers (${seat.n})`);
    assert(seat.dry && seat.wet && seat.taken, 'covers come out in the rain and come off when you take the bike');

    console.log('\n[84] wat bell');
    const gong = await page.evaluate(() => {
      const G = window.GAME, main = window.__REALISM_MAIN;
      const b = G.watBell;
      const named = !!(b && b.bell && b.bell.name === 'wat-bell');
      const frame = !!(b && b.mesh && b.mesh.name === 'wat-bell-frame');
      const temple = G.world && G.world.poi && G.world.poi.temple;
      const nearWat = !!(b && temple && Math.hypot(b.x - temple.x, b.z - temple.z) < 14);
      G.player.inVehicle = null;
      G._eating = null;
      G._barberCut = null;
      G._bellRung = 0;
      if (b) {
        b.readyAt = 0;
        b.ringT = 0;
        G.player.group.position.set(b.x, 0, b.z);
      }
      const seen0 = performance.now() + 30000;
      G.wanted.lastSeenAt = seen0;
      window.dispatchEvent(new KeyboardEvent('keyup', { code: 'KeyE' }));
      if (G.input && G.input.endFrame) G.input.endFrame();
      let rang = false;
      for (let i = 0; i < 4 && !rang; i++) {
        window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyE' }));
        main.updateWatBell(0.016);
        window.dispatchEvent(new KeyboardEvent('keyup', { code: 'KeyE' }));
        if (G.input && G.input.endFrame) G.input.endFrame();
        rang = (G._bellRung || 0) >= 1 && b.ringT > 0;
      }
      const z0 = b && b.bell ? b.bell.rotation.z : 0;
      for (let i = 0; i < 8; i++) main.updateWatBell(0.08);
      const swung = !!(b && b.bell && Math.abs(b.bell.rotation.z - z0) > 0.02);
      return {
        flag: !!(G.gameplay && G.gameplay.watBell),
        named, frame, nearWat, rang, swung,
        cooled: G.wanted.lastSeenAt <= seen0 - 8000,
      };
    });
    assert(gong.flag && gong.named && gong.frame && gong.nearWat, 'a bronze bell hangs at the wat');
    assert(gong.rang && gong.swung && gong.cooled, 'E rings the bell and cools last-seen');

    console.log('\n[85] stall incense coils');
    const coil = await page.evaluate(() => {
      const G = window.GAME, main = window.__REALISM_MAIN;
      const list = G.stallIncense || [];
      const n = list.filter(c => c && c.mesh && c.mesh.name === 'stall-incense').length;
      const c0 = list[0];
      const named = !!(c0 && c0.coil && c0.coil.name === 'incense-coil' && c0.glow && c0.glow.name === 'incense-ember');
      G.time.dayT = 12 / 24;
      if (c0) c0.t = 0.4;
      main.updateStallIncense(0.05);
      const dayGlow = c0 && c0.glow ? c0.glow.material.emissiveIntensity : 9;
      const daySmoke = !!(c0 && c0.smoke && c0.smoke.visible === false);
      G.time.dayT = 19.2 / 24;
      if (c0) c0.t = Math.PI / 12;
      main.updateStallIncense(0.05);
      const nightGlow = c0 && c0.glow ? c0.glow.material.emissiveIntensity : 0;
      const nightSmoke = !!(c0 && c0.smoke && c0.smoke.visible);
      const atStall = !!(c0 && c0.stall && c0.stall.pos && Math.hypot(c0.mesh.position.x - c0.stall.pos.x, c0.mesh.position.z - c0.stall.pos.z) < 2);
      return {
        flag: !!(G.gameplay && G.gameplay.stallIncense),
        n, named, dayGlow, nightGlow, daySmoke, nightSmoke, atStall,
      };
    });
    assert(coil.flag && coil.n >= 3 && coil.named && coil.atStall, `mosquito coils hang under stall parasols (${coil.n})`);
    assert(coil.dayGlow < 0.3 && coil.nightGlow > 0.4 && coil.daySmoke && coil.nightSmoke, 'the coils glow and smoke after dusk');

    console.log('\n[86] mango sticky rice at Asok');
    const mango = await page.evaluate(() => {
      const G = window.GAME, main = window.__REALISM_MAIN;
      const c = G.mangoSticky;
      const named = !!(c && c.mesh && c.mesh.name === 'mango-cart');
      const rice = !!(c && c.mesh && c.mesh.getObjectByName('sticky-rice'));
      const halves = c && c.mesh ? c.mesh.children.filter(ch => ch && ch.name === 'mango-half').length : 0;
      const cream = c && c.mesh && c.mesh.getObjectByName('coconut-cream');
      const bts = G.world && G.world.bts;
      const nearBts = !!(c && bts && Math.hypot(c.x - bts.x, c.z - (bts.z || 0)) < 28);
      G.time.dayT = 12 / 24;
      if (c) c.t = 0.2;
      main.updateMangoSticky(0.05);
      const dayGlow = cream && cream.material ? cream.material.emissiveIntensity : 9;
      const dayVendor = !!(c && c.vendor && c.vendor.mesh && c.vendor.mesh.visible === false);
      G.time.dayT = 18.4 / 24;
      if (c) c.t = Math.PI / 16;
      main.updateMangoSticky(0.05);
      const duskGlow = cream && cream.material ? cream.material.emissiveIntensity : 0;
      const duskVendor = !!(c && c.vendor && c.vendor.mango && c.vendor.mesh && c.vendor.mesh.visible);
      G.player.inVehicle = null;
      G._eating = null;
      if (c && c.mesh) G.player.group.position.copy(c.mesh.position);
      G.cash = 120;
      G.player.hp = 40;
      G.player.stam = 10;
      G._mangoSticky = 0;
      window.dispatchEvent(new KeyboardEvent('keyup', { code: 'KeyE' }));
      if (G.input && G.input.endFrame) G.input.endFrame();
      let paid = false;
      for (let i = 0; i < 4 && !paid; i++) {
        window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyE' }));
        main.updateMangoSticky(0.016);
        window.dispatchEvent(new KeyboardEvent('keyup', { code: 'KeyE' }));
        if (G.input && G.input.endFrame) G.input.endFrame();
        paid = G.cash === 60 && (G._mangoSticky || 0) >= 1;
      }
      return {
        flag: !!(G.gameplay && G.gameplay.mangoSticky),
        named, rice, halves, nearBts, dayGlow, duskGlow, dayVendor, duskVendor, paid,
        hp: G.player.hp, stam: G.player.stam,
      };
    });
    assert(mango.flag && mango.named && mango.rice && mango.halves >= 3 && mango.nearBts, 'a mango sticky-rice cart waits at Asok');
    assert(mango.dayVendor && mango.duskVendor && mango.dayGlow < mango.duskGlow, 'the vendor works evenings and the cream warms up');
    assert(mango.paid && mango.hp > 40 && mango.stam > 10, 'E buys mango sticky rice for ฿60');

    console.log('\n[87] flying foxes at the wat');
    const fox = await page.evaluate(() => {
      const G = window.GAME, main = window.__REALISM_MAIN;
      const list = G.watBats || [];
      const n = list.filter(b => b && b.mesh && b.mesh.name === 'wat-bat').length;
      const wings = list.filter(b => b && b.mesh && b.mesh.children.filter(ch => ch && ch.name === 'bat-wing').length >= 2).length;
      const b0 = list[0];
      const temple = G.world && G.world.poi && G.world.poi.temple;
      G.time.dayT = 12 / 24;
      main.updateWatBats(0.05);
      const day = !!(b0 && b0.mesh && b0.mesh.visible === false);
      G.time.dayT = 19.6 / 24;
      if (b0) b0.t = 0.4;
      main.updateWatBats(0.05);
      const start = b0 && b0.mesh ? { x: b0.mesh.position.x, z: b0.mesh.position.z, flap: b0.mesh.children.find(ch => ch && ch.name === 'bat-wing') } : null;
      const flap0 = start && start.flap ? start.flap.rotation.z : 0;
      for (let i = 0; i < 20; i++) main.updateWatBats(0.1);
      const night = !!(b0 && b0.mesh && b0.mesh.visible);
      const circled = !!(b0 && start && Math.hypot(b0.mesh.position.x - start.x, b0.mesh.position.z - start.z) > 0.4);
      const flapped = !!(start && start.flap && Math.abs(start.flap.rotation.z - flap0) > 0.05);
      const nearWat = !!(b0 && temple && Math.hypot(b0.cx - temple.x, b0.cz - temple.z) < 4);
      const aloft = !!(b0 && b0.mesh && b0.mesh.position.y > 5);
      return {
        flag: !!(G.gameplay && G.gameplay.watBats),
        n, wings, day, night, circled, flapped, nearWat, aloft,
      };
    });
    assert(fox.flag && fox.n >= 5 && fox.wings >= 5 && fox.nearWat && fox.aloft, `flying foxes roost the wat (${fox.n})`);
    assert(fox.day && fox.night && fox.circled && fox.flapped, 'they hide by day and circle after dusk');

    console.log('\n[88] Yaowarat photo tourists');
    const snap = await page.evaluate(() => {
      const G = window.GAME, main = window.__REALISM_MAIN;
      const poi = G.world && G.world.poi && G.world.poi.yaowarat;
      G.time.dayT = 12 / 24;
      main.updateYaoPhotos(0.05);
      const day = (G._yaoPhotos || []).filter(p => p && p.yaoPhoto).length;
      G.time.dayT = 21.2 / 24;
      main.updateYaoPhotos(0.05);
      const night = (G._yaoPhotos || []).filter(p => p && p.yaoPhoto && p.mesh).length;
      const phones = (G._yaoPhotos || []).filter(p => p && p._yaoPhone && p._yaoPhone.name === 'yao-phone').length;
      const p0 = (G._yaoPhotos || [])[0];
      const near = !!(p0 && poi && p0.mesh && Math.hypot(p0.mesh.position.x - poi.x, p0.mesh.position.z - poi.z) < 40);
      G._yaoPhotoT = 0.1;
      main.updateYaoPhotos(0.05);
      const e0 = p0 && p0._yaoPhone ? p0._yaoPhone.material.emissiveIntensity : 0;
      G._yaoPhotoT = Math.PI / 14;
      main.updateYaoPhotos(0.05);
      const e1 = p0 && p0._yaoPhone ? p0._yaoPhone.material.emissiveIntensity : 0;
      const flashed = Math.abs(e1 - e0) > 0.05;
      G.time.dayT = 12 / 24;
      main.updateYaoPhotos(0.05);
      const gone = (G._yaoPhotos || []).length === 0;
      return {
        flag: !!(G.gameplay && G.gameplay.yaoPhotos),
        day, night, phones, near, flashed, gone,
      };
    });
    assert(snap.flag && snap.day === 0 && snap.night >= 4 && snap.phones >= 4 && snap.near, `tourists snap Yaowarat after dark (${snap.night})`);
    assert(snap.flashed && snap.gone, 'the phones flash and they clear by day');

    console.log('\n[89] kanom krok at 7-Eleven');
    const krok = await page.evaluate(() => {
      const G = window.GAME, main = window.__REALISM_MAIN;
      const c = G.kanomKrok;
      const named = !!(c && c.mesh && c.mesh.name === 'kanomkrok-cart');
      const pan = !!(c && c.mesh && c.mesh.getObjectByName('kanom-pan'));
      const cakes = c && c.mesh ? c.mesh.children.filter(ch => ch && ch.name === 'kanom-cake').length : 0;
      const ladle = c && c.mesh && c.mesh.getObjectByName('kanom-ladle');
      const seven = G.world && (G.world.sevenWalkIn || (G.world.sevenElevens && G.world.sevenElevens[0]));
      const nearSeven = !!(c && seven && seven.pos && Math.hypot(c.x - seven.pos.x, c.z - seven.pos.z) < 12);
      G.time.dayT = 12 / 24;
      if (c) c.t = 0.12;
      main.updateKanomKrok(0.05);
      const dayVendor = !!(c && c.vendor && c.vendor.mesh && c.vendor.mesh.visible === false);
      const z0 = ladle ? ladle.rotation.z : 0;
      if (c) c.t = 0.18;
      main.updateKanomKrok(0.05);
      const scooped = !!(ladle && Math.abs(ladle.rotation.z - z0) > 0.05);
      G.time.dayT = 17.2 / 24;
      main.updateKanomKrok(0.05);
      const eveVendor = !!(c && c.vendor && c.vendor.kanom && c.vendor.mesh && c.vendor.mesh.visible);
      G.player.inVehicle = null;
      G._eating = null;
      if (c && c.mesh) G.player.group.position.copy(c.mesh.position);
      G.cash = 75;
      G.player.hp = 40;
      G.player.stam = 10;
      G._kanomKrok = 0;
      window.dispatchEvent(new KeyboardEvent('keyup', { code: 'KeyE' }));
      if (G.input && G.input.endFrame) G.input.endFrame();
      let paid = false;
      for (let i = 0; i < 4 && !paid; i++) {
        window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyE' }));
        main.updateKanomKrok(0.016);
        window.dispatchEvent(new KeyboardEvent('keyup', { code: 'KeyE' }));
        if (G.input && G.input.endFrame) G.input.endFrame();
        paid = G.cash === 50 && (G._kanomKrok || 0) >= 1;
      }
      return {
        flag: !!(G.gameplay && G.gameplay.kanomKrok),
        named, pan, cakes, nearSeven, dayVendor, eveVendor, scooped, paid,
        hp: G.player.hp, stam: G.player.stam,
      };
    });
    assert(krok.flag && krok.named && krok.pan && krok.cakes >= 6 && krok.nearSeven, 'a kanom krok pan waits outside 7-Eleven');
    assert(krok.dayVendor && krok.eveVendor && krok.scooped, 'the vendor works afternoons and the ladle scoops');
    assert(krok.paid && krok.hp > 40 && krok.stam > 10, 'E buys kanom krok for ฿25');

    console.log('\n[90] grilled squid on Yaowarat');
    const squid = await page.evaluate(() => {
      const G = window.GAME, main = window.__REALISM_MAIN;
      const c = G.squidGrill;
      const named = !!(c && c.mesh && c.mesh.name === 'squid-cart');
      const coals = !!(c && c.mesh && c.mesh.getObjectByName('squid-coals'));
      const sticks = c && c.mesh ? c.mesh.children.filter(ch => ch && ch.name === 'squid-stick').length : 0;
      const poi = G.world && G.world.poi && G.world.poi.yaowarat;
      const nearYao = !!(c && poi && Math.hypot(c.x - poi.x, c.z - poi.z) < 40);
      G.time.dayT = 12 / 24;
      if (c) c.t = 0.2;
      main.updateSquidGrill(0.05);
      const dayGlow = c && c.coalMat ? c.coalMat.emissiveIntensity : 9;
      const dayVendor = !!(c && c.vendor && c.vendor.mesh && c.vendor.mesh.visible === false);
      const smokeDay = !!(c && c.mesh && c.mesh.getObjectByName('squid-smoke') && c.mesh.getObjectByName('squid-smoke').visible === false);
      G.time.dayT = 21.2 / 24;
      if (c) c.t = Math.PI / 18;
      main.updateSquidGrill(0.05);
      const nightGlow = c && c.coalMat ? c.coalMat.emissiveIntensity : 0;
      const nightVendor = !!(c && c.vendor && c.vendor.squid && c.vendor.mesh && c.vendor.mesh.visible);
      const z0 = c && c.mesh && c.mesh.children.find(ch => ch && ch.name === 'squid-stick');
      const r0 = z0 ? z0.rotation.z : 0;
      if (c) c.t = 0.6;
      main.updateSquidGrill(0.05);
      const turned = !!(z0 && Math.abs(z0.rotation.z - r0) > 0.01);
      G.player.inVehicle = null;
      G._eating = null;
      if (c && c.mesh) G.player.group.position.copy(c.mesh.position);
      G.cash = 100;
      G.player.hp = 40;
      G._squidGrill = 0;
      window.dispatchEvent(new KeyboardEvent('keyup', { code: 'KeyE' }));
      if (G.input && G.input.endFrame) G.input.endFrame();
      let paid = false;
      for (let i = 0; i < 4 && !paid; i++) {
        window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyE' }));
        main.updateSquidGrill(0.016);
        window.dispatchEvent(new KeyboardEvent('keyup', { code: 'KeyE' }));
        if (G.input && G.input.endFrame) G.input.endFrame();
        paid = G.cash === 50 && (G._squidGrill || 0) >= 1;
      }
      return {
        flag: !!(G.gameplay && G.gameplay.squidGrill),
        named, coals, sticks, nearYao, dayGlow, nightGlow, dayVendor, nightVendor, smokeDay, turned, paid,
        hp: G.player.hp,
      };
    });
    assert(squid.flag && squid.named && squid.coals && squid.sticks >= 4 && squid.nearYao, 'a squid grill waits on Yaowarat');
    assert(squid.dayVendor && squid.nightVendor && squid.dayGlow < squid.nightGlow && squid.smokeDay && squid.turned, 'coals and vendor only work after dark');
    assert(squid.paid && squid.hp > 40, 'E buys grilled squid for ฿50');

    console.log('\n[91] songthaew riders at Asok');
    const bench = await page.evaluate(() => {
      const G = window.GAME, main = window.__REALISM_MAIN;
      const stand = G.world && G.world.btsSongthaew;
      const v = stand && stand.vehicle;
      const riders = (stand && stand.riders) || [];
      const n = riders.filter(p => p && p.songthaewRide && p.mesh).length;
      const seated = riders.filter(p => p && p.mesh && p.mesh.parent === (v && v.mesh)).length;
      const yao = riders.filter(p => p && p.mesh && p.mesh.position.y > 0.4).length;
      G.player.inVehicle = null;
      if (v) v.driver = null;
      stand._dumped = false;
      main.updateSongthaewRiders(0.05);
      const parked = riders.filter(p => p && p.songthaewRide && p.mesh && p.mesh.parent === v.mesh).length;
      if (v) v.driver = 'player';
      main.updateSongthaewRiders(0.05);
      const dumped = stand._dumped === true;
      const off = riders.filter(p => p && !p.songthaewRide && p.mesh && p.mesh.parent === G.scene).length;
      const grounded = riders.filter(p => p && p.mesh && p.mesh.position.y < 0.2).length;
      if (v) v.driver = null;
      return {
        flag: !!(G.gameplay && G.gameplay.songthaewRiders),
        n, seated, yao, parked, dumped, off, grounded,
        vehicle: !!(v && v.btsSongthaew),
      };
    });
    assert(bench.flag && bench.vehicle && bench.n >= 3 && bench.seated >= 3 && bench.yao >= 3, `passengers sit the BTS songthaew (${bench.n})`);
    assert(bench.parked >= 3 && bench.dumped && bench.off >= 3 && bench.grounded >= 3, 'they hop off onto the pavement when you take the ride');

    console.log('\n[92] wat courtyard sweepers');
    const sweep = await page.evaluate(() => {
      const G = window.GAME, main = window.__REALISM_MAIN;
      const list = G.watSweep || [];
      const n = list.filter(p => p && p.watSweep && p.mesh).length;
      const brooms = list.filter(p => p && p.mesh && p.mesh.getObjectByName('wat-broom')).length;
      const temple = G.world && G.world.poi && G.world.poi.temple;
      const nearWat = list.filter(p => p && p.mesh && temple && Math.hypot((p._sweepX0 + p._sweepX1) * 0.5 - temple.x, (p._sweepZ || 0) - temple.z) < 16).length;
      G.time.dayT = 12 / 24;
      main.updateWatSweep(0.05);
      const day = list.filter(p => p && p.mesh && p.mesh.visible === false).length;
      G.time.dayT = 7.2 / 24;
      const p0 = list[0];
      if (p0) { p0._sweepT = 0.2; p0._sweepDir = 1; }
      main.updateWatSweep(0.05);
      const start = p0 && p0.mesh ? { x: p0.mesh.position.x, z: p0.mesh.position.z } : null;
      const broom = p0 && p0.mesh && p0.mesh.getObjectByName('wat-broom');
      const r0 = broom ? broom.rotation.x : 0;
      if (p0) p0._sweepT = 0.2 + Math.PI / 18;
      main.updateWatSweep(0.05);
      const swung = !!(broom && Math.abs(broom.rotation.x - r0) > 0.05);
      if (p0) { p0._sweepT = 0.2; p0._sweepDir = 1; }
      main.updateWatSweep(0.05);
      const sx = p0 && p0.mesh ? p0.mesh.position.x : 0;
      const sz = p0 && p0.mesh ? p0.mesh.position.z : 0;
      for (let i = 0; i < 20; i++) main.updateWatSweep(0.1);
      const morning = list.filter(p => p && p.watSweep && p.mesh && p.mesh.visible).length;
      const walked = !!(p0 && p0.mesh && Math.hypot(p0.mesh.position.x - sx, p0.mesh.position.z - sz) > 0.4);
      return {
        flag: !!(G.gameplay && G.gameplay.watSweep),
        n, brooms, nearWat, day, morning, walked, swung,
      };
    });
    assert(sweep.flag && sweep.n >= 2 && sweep.brooms >= 2 && sweep.nearWat >= 2, `monks sweep the wat courtyard (${sweep.n})`);
    assert(sweep.day >= 2 && sweep.morning >= 2 && sweep.walked && sweep.swung, 'they hide by day and sweep at dawn');

    console.log('\n[93] Yaowarat gold shop window');
    const gold = await page.evaluate(() => {
      const G = window.GAME, main = window.__REALISM_MAIN;
      const c = G.yaoGold;
      const named = !!(c && c.mesh && c.mesh.name === 'yao-gold');
      const trays = c && c.mesh ? c.mesh.children.filter(ch => ch && ch.name === 'yao-gold-tray').length : 0;
      const sign = !!(c && c.mesh && c.mesh.getObjectByName('yao-gold-sign'));
      const poi = G.world && G.world.poi && G.world.poi.yaowarat;
      const nearYao = !!(c && poi && Math.hypot(c.x - poi.x, c.z - poi.z) < 40);
      G.time.dayT = 12 / 24;
      if (c) c.t = 0.2;
      main.updateYaoGold(0.05);
      const dayGlow = c && c.goldMat ? c.goldMat.emissiveIntensity : 9;
      const dayShop = (c && c.shoppers || []).filter(p => p && p.yaoGold && p.mesh && p.mesh.visible === false).length;
      G.time.dayT = 21.2 / 24;
      if (c) c.t = Math.PI / 6;
      main.updateYaoGold(0.05);
      const nightGlow = c && c.goldMat ? c.goldMat.emissiveIntensity : 0;
      const nightShop = (c && c.shoppers || []).filter(p => p && p.yaoGold && p.mesh && p.mesh.visible).length;
      const e0 = c && c.goldMat ? c.goldMat.emissiveIntensity : 0;
      if (c) c.t = 0.2;
      main.updateYaoGold(0.05);
      const pulsed = !!(c && c.goldMat && Math.abs(c.goldMat.emissiveIntensity - e0) > 0.04);
      return {
        flag: !!(G.gameplay && G.gameplay.yaoGold),
        named, trays, sign, nearYao, dayGlow, nightGlow, dayShop, nightShop, pulsed,
      };
    });
    assert(gold.flag && gold.named && gold.trays >= 5 && gold.sign && gold.nearYao, 'a gold-shop window waits on Yaowarat');
    assert(gold.dayShop >= 3 && gold.nightShop >= 3 && gold.dayGlow < gold.nightGlow && gold.pulsed, 'the gold wakes up after dark and shoppers look in');

    console.log('\n[94] 7-Eleven ATM queue');
    const atmQ = await page.evaluate(() => {
      const G = window.GAME, main = window.__REALISM_MAIN;
      const c = G.sevenAtm;
      const walk = G.world && G.world.sevenWalkIn;
      const n = (c && c.queue || []).filter(p => p && p.sevenAtm && p.mesh).length;
      const card = (c && c.queue || []).some(p => p && p.mesh && p.mesh.getObjectByName('seven-atm-card'));
      const nearAtm = !!(c && walk && walk.atm && Math.hypot(c.ax - walk.atm.x, c.az - walk.atm.z) < 1);
      G.time.dayT = 3 / 24;
      main.updateSevenAtm(0.05);
      const late = (c && c.queue || []).filter(p => p && p.mesh && p.mesh.visible === false).length;
      G.time.dayT = 12 / 24;
      if (c) c.t = 0.2;
      main.updateSevenAtm(0.05);
      const day = (c && c.queue || []).filter(p => p && p.sevenAtm && p.mesh && p.mesh.visible).length;
      const p0 = c && c.queue && c.queue[0];
      const z0 = p0 && p0.mesh ? p0.mesh.position.z : 0;
      if (c) c.t = 0.2 + Math.PI / 2.4;
      main.updateSevenAtm(0.05);
      const shifted = !!(p0 && p0.mesh && Math.abs(p0.mesh.position.z - z0) > 0.04);
      return {
        flag: !!(G.gameplay && G.gameplay.sevenAtm),
        n, card, nearAtm, late, day, shifted,
      };
    });
    assert(atmQ.flag && atmQ.n >= 2 && atmQ.card && atmQ.nearAtm, `a queue waits at the 7-Eleven ATM (${atmQ.n})`);
    assert(atmQ.late >= 2 && atmQ.day >= 2 && atmQ.shifted, 'they hide late and shift weight at the machine');

    console.log('\n[95] BTS busker at Asok');
    const busk = await page.evaluate(() => {
      const G = window.GAME, main = window.__REALISM_MAIN;
      const c = G.btsBusker;
      const ped = c && c.ped;
      const guitar = !!(ped && ped.mesh && ped.mesh.getObjectByName('bts-guitar'));
      const hat = !!(c && c.hat && c.hat.name === 'bts-busker-hat');
      const bts = G.world && G.world.bts;
      const near = !!(c && bts && Math.hypot(c.x - bts.x, c.z - (bts.z || 0)) < 40);
      G.time.dayT = 12 / 24;
      main.updateBtsBusker(0.05);
      const day = !!(ped && ped.mesh && ped.mesh.visible === false);
      G.time.dayT = 17.5 / 24;
      if (c) c.t = 0.2;
      main.updateBtsBusker(0.05);
      const eve = !!(ped && ped.btsBusker && ped.mesh && ped.mesh.visible);
      const g = ped && ped.mesh && ped.mesh.getObjectByName('bts-guitar');
      const r0 = g ? g.rotation.z : 0;
      if (c) c.t = 0.2 + Math.PI / 10;
      main.updateBtsBusker(0.05);
      const strummed = !!(g && Math.abs(g.rotation.z - r0) > 0.04);
      G.player.inVehicle = null;
      G._eating = null;
      if (c) G.player.group.position.set(c.x, 0, c.z);
      G.cash = 100;
      G._btsBusker = 0;
      window.dispatchEvent(new KeyboardEvent('keyup', { code: 'KeyE' }));
      if (G.input && G.input.endFrame) G.input.endFrame();
      let paid = false;
      for (let i = 0; i < 4 && !paid; i++) {
        window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyE' }));
        main.updateBtsBusker(0.016);
        window.dispatchEvent(new KeyboardEvent('keyup', { code: 'KeyE' }));
        if (G.input && G.input.endFrame) G.input.endFrame();
        paid = G.cash === 80 && (G._btsBusker || 0) >= 1;
      }
      return {
        flag: !!(G.gameplay && G.gameplay.btsBusker),
        guitar, hat, near, day, eve, strummed, paid,
      };
    });
    assert(busk.flag && busk.guitar && busk.hat && busk.near, 'a busker waits at Asok BTS');
    assert(busk.day && busk.eve && busk.strummed && busk.paid, 'they play evenings and E tips ฿20');

    console.log('\n[96] saffron robes at the wat');
    const robes = await page.evaluate(() => {
      const G = window.GAME, main = window.__REALISM_MAIN;
      const c = G.watRobes;
      const named = !!(c && c.mesh && c.mesh.name === 'wat-robes');
      const n = c && c.mesh ? c.mesh.children.filter(ch => ch && ch.name === 'saffron-robe').length : 0;
      const temple = G.world && G.world.poi && G.world.poi.temple;
      const nearWat = !!(c && temple && Math.hypot(c.x - temple.x, c.z - temple.z) < 16);
      G.time.weather = 'clear';
      G.time.rainStrength = 0;
      if (c) c.t = 0.2;
      main.updateWatRobes(0.05);
      const dry = !!(c && c.mesh && c.mesh.visible);
      const r0 = c && c.mesh && c.mesh.children.find(ch => ch && ch.name === 'saffron-robe');
      const z0 = r0 ? r0.rotation.z : 0;
      if (c) c.t = 0.2 + Math.PI / 3.4;
      main.updateWatRobes(0.05);
      const fluttered = !!(r0 && Math.abs(r0.rotation.z - z0) > 0.04);
      G.time.rainStrength = 0.85;
      main.updateWatRobes(0.05);
      const packed = !!(c && c.mesh && c.mesh.visible === false);
      G.time.rainStrength = 0;
      main.updateWatRobes(0.05);
      const back = !!(c && c.mesh && c.mesh.visible);
      return {
        flag: !!(G.gameplay && G.gameplay.watRobes),
        named, n, nearWat, dry, fluttered, packed, back,
      };
    });
    assert(robes.flag && robes.named && robes.n >= 6 && robes.nearWat, `saffron robes hang at the wat (${robes.n})`);
    assert(robes.dry && robes.fluttered && robes.packed && robes.back, 'they flutter in the sun and come in when it rains');

    console.log('\n[97] pigeons on the Asok platform');
    const birds = await page.evaluate(() => {
      const G = window.GAME, main = window.__REALISM_MAIN;
      const list = (G.btsPigeons || []).filter(p => p && (p.stop === 'asok' || !p.stop));
      const n = list.filter(p => p && p.mesh && p.mesh.name === 'bts-pigeon').length;
      const wings = list.filter(p => p && p.mesh && p.mesh.children.filter(ch => ch && ch.name === 'pigeon-wing').length >= 2).length;
      const bts = G.world && G.world.bts;
      const near = list.filter(p => p && p.home && bts && Math.hypot(p.home.x - bts.x, p.home.z - (bts.z || 0)) < 30 && p.home.y > 10).length;
      G.time.dayT = 21.2 / 24;
      main.updateBtsPigeons(0.05);
      const night = list.filter(p => p && p.mesh && p.mesh.visible === false).length;
      G.time.dayT = 12 / 24;
      const p0 = list[0];
      if (p0) { p0.t = 0.2; p0.state = 'loaf'; if (p0.home) p0.mesh.position.set(p0.home.x, p0.home.y, p0.home.z); }
      G.player.group.position.set(0, 0, 80);
      main.updateBtsPigeons(0.05);
      const day = list.filter(p => p && p.mesh && p.mesh.visible).length;
      const yHome = p0 && p0.home ? p0.home.y : 0;
      const wing = p0 && p0.mesh && p0.mesh.children.find(ch => ch && ch.name === 'pigeon-wing');
      const f0 = wing ? wing.rotation.z : 0;
      if (p0) p0.t = 0.2 + Math.PI / 6;
      main.updateBtsPigeons(0.05);
      const flapped = !!(wing && Math.abs(wing.rotation.z - f0) > 0.02);
      if (p0 && p0.home) {
        G.player.group.position.set(p0.home.x, p0.home.y, p0.home.z);
        p0.state = 'loaf';
        p0.mesh.position.set(p0.home.x, p0.home.y, p0.home.z);
      }
      for (let i = 0; i < 20; i++) main.updateBtsPigeons(0.08);
      const scattered = !!(p0 && p0.mesh && p0.mesh.position.y > yHome + 0.8);
      return {
        flag: !!(G.gameplay && G.gameplay.btsPigeons),
        n, wings, near, night, day, flapped, scattered,
      };
    });
    assert(birds.flag && birds.n >= 6 && birds.wings >= 6 && birds.near >= 6, `pigeons loaf the Asok platform (${birds.n})`);
    assert(birds.night >= 6 && birds.day >= 6 && birds.flapped && birds.scattered, 'they hide at night and scatter when you walk up');

    console.log('\n[98] lotus stall at the wat');
    const lotus = await page.evaluate(() => {
      const G = window.GAME, main = window.__REALISM_MAIN;
      const c = G.watLotus;
      const named = !!(c && c.mesh && c.mesh.name === 'wat-lotus-stand');
      const blooms = c && c.mesh ? c.mesh.children.filter(ch => ch && ch.name === 'wat-lotus').length : 0;
      const temple = G.world && G.world.poi && G.world.poi.temple;
      const nearWat = !!(c && temple && Math.hypot(c.x - temple.x, c.z - temple.z) < 16);
      G.time.dayT = 21.2 / 24;
      main.updateWatLotus(0.05);
      const night = !!(c && c.vendor && c.vendor.mesh && c.vendor.mesh.visible === false);
      G.time.dayT = 12 / 24;
      if (c) c.t = 0.2;
      main.updateWatLotus(0.05);
      const day = !!(c && c.vendor && c.vendor.watLotus && c.vendor.mesh && c.vendor.mesh.visible);
      const b0 = c && c.mesh && c.mesh.children.find(ch => ch && ch.name === 'wat-lotus');
      const y0 = b0 ? b0.position.y : 0;
      if (c) c.t = 0.2 + Math.PI / 2.2;
      main.updateWatLotus(0.05);
      const bobbed = !!(b0 && Math.abs(b0.position.y - y0) > 0.01);
      G.player.inVehicle = null;
      G._eating = null;
      G._lotus = false;
      G._lotusOffered = 0;
      if (c && c.mesh) G.player.group.position.copy(c.mesh.position);
      G.cash = 80;
      window.dispatchEvent(new KeyboardEvent('keyup', { code: 'KeyE' }));
      if (G.input && G.input.endFrame) G.input.endFrame();
      let paid = false;
      for (let i = 0; i < 4 && !paid; i++) {
        window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyE' }));
        main.updateWatLotus(0.016);
        window.dispatchEvent(new KeyboardEvent('keyup', { code: 'KeyE' }));
        if (G.input && G.input.endFrame) G.input.endFrame();
        paid = G.cash === 50 && G._lotus === true;
      }
      const s = (G.world.shrines || [])[0];
      let offered = false, cooled = false;
      if (s && s.pos) {
        G.player.group.position.set(s.pos.x, 0, s.pos.z);
        G.wanted.stars = 2;
        G.wanted.lastSeenAt = performance.now() + 30000;
        s.readyAt = 1;
        const seen0 = G.wanted.lastSeenAt;
        window.dispatchEvent(new KeyboardEvent('keyup', { code: 'KeyE' }));
        if (G.input && G.input.endFrame) G.input.endFrame();
        for (let i = 0; i < 4 && !offered; i++) {
          window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyE' }));
          main.updateShrines(0.016);
          window.dispatchEvent(new KeyboardEvent('keyup', { code: 'KeyE' }));
          if (G.input && G.input.endFrame) G.input.endFrame();
          offered = (G._lotusOffered || 0) >= 1 && G._lotus === false;
        }
        cooled = G.wanted.lastSeenAt < seen0 - 18000;
      }
      return {
        flag: !!(G.gameplay && G.gameplay.watLotus),
        named, blooms, nearWat, night, day, bobbed, paid, offered, cooled,
      };
    });
    assert(lotus.flag && lotus.named && lotus.blooms >= 5 && lotus.nearWat, `a lotus stall waits at the wat (${lotus.blooms})`);
    assert(lotus.night && lotus.day && lotus.bobbed && lotus.paid && lotus.offered && lotus.cooled, 'E buys a lotus; the shrine takes it for extra heat cool');

    console.log('\n[99] temple cats at the wat');
    const templeCats = await page.evaluate(() => {
      const G = window.GAME, main = window.__REALISM_MAIN;
      const list = G.watCats || [];
      const n = list.filter(c => c && c.mesh && c.mesh.name === 'wat-cat').length;
      const temple = G.world && G.world.poi && G.world.poi.temple;
      const nearWat = list.filter(c => c && c.home && temple && Math.hypot(c.home.x - temple.x, c.home.z - temple.z) < 16).length;
      const c = list[0];
      if (!c || !c.mesh) return { flag: !!(G.gameplay && G.gameplay.watCats), n, nearWat };
      G.player.inVehicle = null;
      G.player.group.position.set(c.mesh.position.x + 1.1, 0, c.mesh.position.z);
      const start = { x: c.mesh.position.x, z: c.mesh.position.z };
      for (let i = 0; i < 20; i++) main.updateWatCats(0.1);
      const moved = Math.hypot(c.mesh.position.x - start.x, c.mesh.position.z - start.z);
      return {
        flag: !!(G.gameplay && G.gameplay.watCats),
        n, nearWat, bolted: c.state === 'bolt' || c.state === 'return', moved,
      };
    });
    assert(templeCats.flag && templeCats.n >= 4 && templeCats.nearWat >= 4, `temple cats loaf the wat (${templeCats.n})`);
    assert(templeCats.bolted && templeCats.moved > 0.8, `they bolt when you get close (${templeCats.moved && templeCats.moved.toFixed(1)}m)`);

    console.log('\n[100] 7-Eleven shoppers');
    const shop = await page.evaluate(() => {
      const G = window.GAME, main = window.__REALISM_MAIN;
      const rec = G.sevenShoppers;
      const list = (rec && rec.shoppers) || [];
      const n = list.filter(p => p && p.sevenShop && p.mesh).length;
      const bags = list.filter(p => p && p.mesh && p.mesh.getObjectByName('seven-bag')).length;
      const seven = G.world && G.world.sevenWalkIn;
      const near = !!(rec && seven && seven.pos && Math.hypot(rec.x - seven.pos.x, rec.z - seven.pos.z) < 8);
      G.time.dayT = 3 / 24;
      main.updateSevenShoppers(0.05);
      const late = list.filter(p => p && p.mesh && p.mesh.visible === false).length;
      G.time.dayT = 12 / 24;
      const p0 = list[0];
      if (p0) { p0._shopT = 0.15; p0._shopDir = 1; }
      main.updateSevenShoppers(0.05);
      const day = list.filter(p => p && p.sevenShop && p.mesh && p.mesh.visible).length;
      const z0 = p0 && p0.mesh ? p0.mesh.position.z : 0;
      if (p0) { p0._shopT = 0.15; p0._shopDir = 1; }
      main.updateSevenShoppers(0.05);
      const sz = p0 && p0.mesh ? p0.mesh.position.z : 0;
      for (let i = 0; i < 20; i++) main.updateSevenShoppers(0.1);
      const walked = !!(p0 && p0.mesh && Math.abs(p0.mesh.position.z - sz) > 0.4);
      if (p0) { p0._shopT = 0.8; p0._shopDir = -1; }
      main.updateSevenShoppers(0.05);
      const bagOut = !!(p0 && p0._sevenBag && p0._sevenBag.visible);
      return {
        flag: !!(G.gameplay && G.gameplay.sevenShoppers),
        n, bags, near, late, day, walked, bagOut,
      };
    });
    assert(shop.flag && shop.n >= 3 && shop.bags >= 3 && shop.near, `shoppers work the 7-Eleven door (${shop.n})`);
    assert(shop.late >= 3 && shop.day >= 3 && shop.walked && shop.bagOut, 'they hide late, walk the door, and leave with a bag');

    console.log('\n[101] turtle pellets at the wat pond');
    const feed = await page.evaluate(() => {
      const G = window.GAME, main = window.__REALISM_MAIN;
      const f = G.watFeed;
      const named = !!(f && f.mesh && f.mesh.name === 'wat-feed');
      const turtles = G.watTurtles || [];
      const n = turtles.filter(t => t && t.mesh && t.mesh.name === 'wat-turtle').length;
      const pond = G.watPond;
      const nearPond = !!(f && pond && Math.hypot(f.x - pond.position.x, f.z - pond.position.z) < 4);
      if (f) f.feedT = 0;
      main.updateWatTurtles(0.05);
      const t0 = turtles[0];
      const d0 = t0 && t0.mesh && f ? Math.hypot(t0.mesh.position.x - f.x, t0.mesh.position.z - f.z) : 99;
      if (f) f.feedT = 5;
      for (let i = 0; i < 12; i++) main.updateWatTurtles(0.1);
      const d1 = t0 && t0.mesh && f ? Math.hypot(t0.mesh.position.x - f.x, t0.mesh.position.z - f.z) : 99;
      const swarmed = d1 < d0 - 0.15;
      G.player.inVehicle = null;
      G._eating = null;
      if (f) G.player.group.position.set(f.x, 0, f.z);
      G.cash = 40;
      G._turtleFeed = 0;
      if (f) f.feedT = 0;
      window.dispatchEvent(new KeyboardEvent('keyup', { code: 'KeyE' }));
      if (G.input && G.input.endFrame) G.input.endFrame();
      let paid = false;
      for (let i = 0; i < 4 && !paid; i++) {
        window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyE' }));
        main.updateWatFeed(0.016);
        window.dispatchEvent(new KeyboardEvent('keyup', { code: 'KeyE' }));
        if (G.input && G.input.endFrame) G.input.endFrame();
        paid = G.cash === 30 && (G._turtleFeed || 0) >= 1 && f && f.feedT > 0;
      }
      return {
        flag: !!(G.gameplay && G.gameplay.watFeed),
        named, n, nearPond, swarmed, paid, d0, d1,
      };
    });
    assert(feed.flag && feed.named && feed.n >= 4 && feed.nearPond, `a pellet tin waits at the wat pond (${feed.n} turtles)`);
    assert(feed.swarmed && feed.paid, 'E feeds the turtles and they swarm the tin');

    console.log('\n[102] newspaper rack at Asok');
    const paper = await page.evaluate(() => {
      const G = window.GAME, main = window.__REALISM_MAIN;
      const c = G.btsPaper;
      const named = !!(c && c.mesh && c.mesh.name === 'bts-paper-rack');
      const n = c && c.mesh ? c.mesh.children.filter(ch => ch && ch.name === 'bts-paper').length : 0;
      const bts = G.world && G.world.bts;
      const near = !!(c && bts && Math.hypot(c.x - bts.x, c.z - (bts.z || 0)) < 40);
      G.time.dayT = 21.2 / 24;
      main.updateBtsPaper(0.05);
      const night = !!(c && c.vendor && c.vendor.mesh && c.vendor.mesh.visible === false);
      G.time.dayT = 8 / 24;
      if (c) c.t = 0.2;
      main.updateBtsPaper(0.05);
      const day = !!(c && c.vendor && c.vendor.btsPaper && c.vendor.mesh && c.vendor.mesh.visible);
      const p0 = c && c.mesh && c.mesh.children.find(ch => ch && ch.name === 'bts-paper');
      const r0 = p0 ? p0.rotation.z : 0;
      if (c) c.t = 0.2 + Math.PI / 2.6;
      main.updateBtsPaper(0.05);
      const fluttered = !!(p0 && Math.abs(p0.rotation.z - r0) > 0.02);
      G.player.inVehicle = null;
      G._eating = null;
      if (c && c.mesh) G.player.group.position.copy(c.mesh.position);
      G.cash = 50;
      G._btsPaper = 0;
      window.dispatchEvent(new KeyboardEvent('keyup', { code: 'KeyE' }));
      if (G.input && G.input.endFrame) G.input.endFrame();
      let paid = false;
      for (let i = 0; i < 4 && !paid; i++) {
        window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyE' }));
        main.updateBtsPaper(0.016);
        window.dispatchEvent(new KeyboardEvent('keyup', { code: 'KeyE' }));
        if (G.input && G.input.endFrame) G.input.endFrame();
        paid = G.cash === 35 && (G._btsPaper || 0) >= 1;
      }
      return {
        flag: !!(G.gameplay && G.gameplay.btsPaper),
        named, n, near, night, day, fluttered, paid,
      };
    });
    assert(paper.flag && paper.named && paper.n >= 6 && paper.near, 'a newspaper rack waits at Asok');
    assert(paper.night && paper.day && paper.fluttered && paper.paid, 'the vendor works mornings and E buys a paper for ฿15');

    console.log('\n[103] Yaowarat roast duck window');
    const duck = await page.evaluate(() => {
      const G = window.GAME, main = window.__REALISM_MAIN;
      const c = G.yaoDuck;
      const named = !!(c && c.mesh && c.mesh.name === 'yao-duck');
      const n = c && c.mesh ? c.mesh.children.filter(ch => ch && ch.name === 'yao-duck-body').length : 0;
      const lamp = !!(c && c.mesh && c.mesh.getObjectByName('yao-duck-lamp'));
      const poi = G.world && G.world.poi && G.world.poi.yaowarat;
      const near = !!(c && poi && Math.hypot(c.x - poi.x, c.z - poi.z) < 40);
      G.time.dayT = 8 / 24;
      main.updateYaoDuck(0.05);
      const day = (c && c.shoppers || []).filter(p => p && p.mesh && p.mesh.visible === false).length;
      G.time.dayT = 21.2 / 24;
      if (c) c.t = 0.2;
      main.updateYaoDuck(0.05);
      const night = (c && c.shoppers || []).filter(p => p && p.yaoDuck && p.mesh && p.mesh.visible).length;
      const d0 = c && c.mesh && c.mesh.children.find(ch => ch && ch.name === 'yao-duck-body');
      const r0 = d0 ? d0.rotation.z : 0;
      if (c) c.t = 0.2 + Math.PI / 2.4;
      main.updateYaoDuck(0.05);
      const swayed = !!(d0 && Math.abs(d0.rotation.z - r0) > 0.04);
      const glow = !!(c && c.lampMat && c.lampMat.emissiveIntensity > 0.4);
      G.player.inVehicle = null;
      G._eating = null;
      if (c && c.mesh) G.player.group.position.copy(c.mesh.position);
      G.cash = 160;
      G._yaoDuck = 0;
      window.dispatchEvent(new KeyboardEvent('keyup', { code: 'KeyE' }));
      if (G.input && G.input.endFrame) G.input.endFrame();
      let paid = false;
      for (let i = 0; i < 4 && !paid; i++) {
        window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyE' }));
        main.updateYaoDuck(0.016);
        window.dispatchEvent(new KeyboardEvent('keyup', { code: 'KeyE' }));
        if (G.input && G.input.endFrame) G.input.endFrame();
        paid = G.cash === 80 && (G._yaoDuck || 0) >= 1;
      }
      return {
        flag: !!(G.gameplay && G.gameplay.yaoDuck),
        named, n, lamp, near, day, night, swayed, glow, paid,
      };
    });
    assert(duck.flag && duck.named && duck.n >= 5 && duck.lamp && duck.near, `a roast-duck window waits on Yaowarat (${duck.n})`);
    assert(duck.day >= 2 && duck.night >= 2 && duck.swayed && duck.glow && duck.paid, 'the ducks sway after dark and E buys a plate for ฿80');

    console.log('\n[104] 7-Eleven slushie machine');
    const slush = await page.evaluate(() => {
      const G = window.GAME, main = window.__REALISM_MAIN;
      const c = G.sevenSlush;
      const named = !!(c && c.mesh && c.mesh.name === 'seven-slush');
      const n = c && c.mesh ? c.mesh.children.filter(ch => ch && ch.name === 'seven-slush-tank').length : 0;
      const cup = !!(c && c.customer && (c.customer._slushCup || (c.customer.mesh && c.customer.mesh.getObjectByName('seven-slush-cup'))));
      const seven = G.world && G.world.sevenWalkIn;
      const near = !!(c && seven && seven.pos && Math.hypot(c.x - seven.pos.x, c.z - seven.pos.z) < 8);
      G.time.dayT = 23 / 24;
      main.updateSevenSlush(0.05);
      const late = !!(c && c.customer && c.customer.mesh && c.customer.mesh.visible === false);
      G.time.dayT = 12 / 24;
      if (c) c.t = 0.2;
      main.updateSevenSlush(0.05);
      const day = !!(c && c.customer && c.customer.sevenSlush && c.customer.mesh && c.customer.mesh.visible);
      const t0 = c && c.mesh && c.mesh.children.find(ch => ch && ch.name === 'seven-slush-tank');
      const r0 = t0 ? t0.rotation.y : 0;
      if (c) c.t = 0.2 + 0.4;
      main.updateSevenSlush(0.05);
      const spun = !!(t0 && Math.abs(t0.rotation.y - r0) > 0.4);
      G.player.inVehicle = null;
      G._eating = null;
      if (c && c.mesh) G.player.group.position.copy(c.mesh.position);
      G.cash = 50;
      G._sevenSlush = 0;
      const stam0 = G.player.stam;
      G.player.stam = Math.max(0, (G.player.stamMax || 100) * 0.2);
      window.dispatchEvent(new KeyboardEvent('keyup', { code: 'KeyE' }));
      if (G.input && G.input.endFrame) G.input.endFrame();
      let paid = false;
      for (let i = 0; i < 4 && !paid; i++) {
        window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyE' }));
        main.updateSevenSlush(0.016);
        window.dispatchEvent(new KeyboardEvent('keyup', { code: 'KeyE' }));
        if (G.input && G.input.endFrame) G.input.endFrame();
        paid = G.cash === 25 && (G._sevenSlush || 0) >= 1 && G.player.stam === G.player.stamMax;
      }
      G.player.stam = stam0;
      return {
        flag: !!(G.gameplay && G.gameplay.sevenSlush),
        named, n, cup, near, late, day, spun, paid,
      };
    });
    assert(slush.flag && slush.named && slush.n >= 2 && slush.cup && slush.near, `a slushie machine waits inside 7-Eleven (${slush.n})`);
    assert(slush.late && slush.day && slush.spun && slush.paid, 'the tanks spin and E buys a slushie for ฿25');

    console.log('\n[105] fruit smoothie at Phrom Phong');
    const smoothie = await page.evaluate(() => {
      const G = window.GAME, main = window.__REALISM_MAIN;
      const c = G.phromFruit;
      const named = !!(c && c.mesh && c.mesh.name === 'phrom-fruit');
      const n = c && c.mesh ? c.mesh.children.filter(ch => ch && ch.name === 'phrom-fruit-piece').length : 0;
      const blender = !!(c && c.mesh && c.mesh.getObjectByName('phrom-blender'));
      const near = !!(c && Math.hypot(c.x - 100, c.z - 0) < 40);
      G.time.dayT = 21.2 / 24;
      main.updatePhromFruit(0.05);
      const night = !!(c && c.vendor && c.vendor.mesh && c.vendor.mesh.visible === false);
      G.time.dayT = 12 / 24;
      if (c) c.t = 0.2;
      main.updatePhromFruit(0.05);
      const day = !!(c && c.vendor && c.vendor.phromFruit && c.vendor.mesh && c.vendor.mesh.visible);
      const b = c && c.mesh && c.mesh.getObjectByName('phrom-blender');
      const r0 = b ? b.rotation.y : 0;
      if (c) c.t = 0.2 + 0.4;
      main.updatePhromFruit(0.05);
      const spun = !!(b && Math.abs(b.rotation.y - r0) > 1);
      G.player.inVehicle = null;
      G._eating = null;
      if (c && c.mesh) G.player.group.position.copy(c.mesh.position);
      G.cash = 80;
      G._phromFruit = 0;
      const stam0 = G.player.stam;
      G.player.stam = Math.max(0, (G.player.stamMax || 100) * 0.2);
      window.dispatchEvent(new KeyboardEvent('keyup', { code: 'KeyE' }));
      if (G.input && G.input.endFrame) G.input.endFrame();
      let paid = false;
      for (let i = 0; i < 4 && !paid; i++) {
        window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyE' }));
        main.updatePhromFruit(0.016);
        window.dispatchEvent(new KeyboardEvent('keyup', { code: 'KeyE' }));
        if (G.input && G.input.endFrame) G.input.endFrame();
        paid = G.cash === 40 && (G._phromFruit || 0) >= 1 && G.player.stam === G.player.stamMax;
      }
      G.player.stam = stam0;
      return {
        flag: !!(G.gameplay && G.gameplay.phromFruit),
        named, n, blender, near, night, day, spun, paid,
      };
    });
    assert(smoothie.flag && smoothie.named && smoothie.n >= 4 && smoothie.blender && smoothie.near, `a fruit smoothie cart waits at Phrom Phong (${smoothie.n})`);
    assert(smoothie.night && smoothie.day && smoothie.spun && smoothie.paid, 'the blender spins by day and E buys a smoothie for ฿40');

    console.log('\n[106] ferry waiters at the pier');
    const ferry = await page.evaluate(() => {
      const G = window.GAME, main = window.__REALISM_MAIN;
      const c = G.pierWait;
      const named = !!(c && c.mesh && c.mesh.name === 'pier-wait');
      const ring = !!(c && c.mesh && c.mesh.getObjectByName('pier-ring'));
      const list = (c && c.waiters) || [];
      const n = list.filter(p => p && p.pierWait && p.mesh).length;
      const bags = list.filter(p => p && (p._pierBag || (p.mesh && p.mesh.getObjectByName('pier-bag')))).length;
      const pier = G.world && G.world.poi && G.world.poi.pier;
      const near = !!(c && pier && Math.hypot(c.x - pier.x, c.z - pier.z) < 12);
      G.time.dayT = 22 / 24;
      main.updatePierWait(0.05);
      const night = list.filter(p => p && p.mesh && p.mesh.visible === false).length;
      G.time.dayT = 12 / 24;
      if (c) c.t = 0.2;
      main.updatePierWait(0.05);
      const day = list.filter(p => p && p.pierWait && p.mesh && p.mesh.visible).length;
      const p0 = list[0];
      const z0 = p0 && p0.mesh ? p0.mesh.position.z : 0;
      if (c) c.t = 0.2 + Math.PI / 2.2;
      main.updatePierWait(0.05);
      const shifted = !!(p0 && p0.mesh && Math.abs(p0.mesh.position.z - z0) > 0.04);
      const r0 = c && c.mesh && c.mesh.getObjectByName('pier-ring');
      const rz0 = r0 ? r0.rotation.z : 0;
      if (c) c.t = 0.2 + Math.PI / 1.8;
      main.updatePierWait(0.05);
      const swayed = !!(r0 && Math.abs(r0.rotation.z - rz0) > 0.04);
      G.player.inVehicle = null;
      G._eating = null;
      if (c && c.mesh) G.player.group.position.copy(c.mesh.position);
      G.cash = 50;
      G._pierWait = 0;
      window.dispatchEvent(new KeyboardEvent('keyup', { code: 'KeyE' }));
      if (G.input && G.input.endFrame) G.input.endFrame();
      let paid = false;
      for (let i = 0; i < 4 && !paid; i++) {
        window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyE' }));
        main.updatePierWait(0.016);
        window.dispatchEvent(new KeyboardEvent('keyup', { code: 'KeyE' }));
        if (G.input && G.input.endFrame) G.input.endFrame();
        paid = G.cash === 35 && (G._pierWait || 0) >= 1;
      }
      return {
        flag: !!(G.gameplay && G.gameplay.pierWait),
        named, ring, n, bags, near, night, day, shifted, swayed, paid,
      };
    });
    assert(ferry.flag && ferry.named && ferry.ring && ferry.n >= 3 && ferry.bags >= 3 && ferry.near, `ferry passengers wait on the pier (${ferry.n})`);
    assert(ferry.night >= 3 && ferry.day >= 3 && ferry.shifted && ferry.swayed && ferry.paid, 'they hide late and E buys a ฿15 express-boat ticket');

    console.log('\n[107] shoe shine at Asok north');
    const shine = await page.evaluate(() => {
      const G = window.GAME, main = window.__REALISM_MAIN;
      const c = G.btsShine;
      const named = !!(c && c.mesh && c.mesh.name === 'bts-shine');
      const box = !!(c && c.mesh && c.mesh.getObjectByName('shine-box'));
      const n = c && c.mesh ? c.mesh.children.filter(ch => ch && ch.name === 'shine-tin').length : 0;
      const cloth = !!(c && c.mesh && c.mesh.getObjectByName('shine-cloth'));
      const bts = G.world && G.world.bts;
      const near = !!(c && bts && Math.hypot(c.x - bts.x, c.z - (bts.z || 0)) < 40 && c.z > 0);
      G.time.dayT = 21.2 / 24;
      main.updateBtsShine(0.05);
      const night = !!(c && c.vendor && c.vendor.mesh && c.vendor.mesh.visible === false);
      G.time.dayT = 12 / 24;
      if (c) c.t = 0.2;
      main.updateBtsShine(0.05);
      const day = !!(c && c.vendor && c.vendor.btsShine && c.vendor.mesh && c.vendor.mesh.visible);
      const rag = c && c.mesh && c.mesh.getObjectByName('shine-cloth');
      const r0 = rag ? rag.rotation.z : 0;
      if (c) c.t = 0.2 + Math.PI / 9;
      main.updateBtsShine(0.05);
      const wiped = !!(rag && Math.abs(rag.rotation.z - r0) > 0.2);
      G.player.inVehicle = null;
      G._eating = null;
      if (c && c.mesh) G.player.group.position.copy(c.mesh.position);
      G.cash = 60;
      G._btsShine = 0;
      window.dispatchEvent(new KeyboardEvent('keyup', { code: 'KeyE' }));
      if (G.input && G.input.endFrame) G.input.endFrame();
      let paid = false;
      for (let i = 0; i < 4 && !paid; i++) {
        window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyE' }));
        main.updateBtsShine(0.016);
        window.dispatchEvent(new KeyboardEvent('keyup', { code: 'KeyE' }));
        if (G.input && G.input.endFrame) G.input.endFrame();
        paid = G.cash === 30 && (G._btsShine || 0) >= 1;
      }
      return {
        flag: !!(G.gameplay && G.gameplay.btsShine),
        named, box, n, cloth, near, night, day, wiped, paid,
      };
    });
    assert(shine.flag && shine.named && shine.box && shine.n >= 2 && shine.cloth && shine.near, 'a shoe-shine box waits north of Asok');
    assert(shine.night && shine.day && shine.wiped && shine.paid, 'the rag wipes by day and E buys a shine for ฿30');

    console.log('\n[108] amulet stall at the wat');
    const amulet = await page.evaluate(() => {
      const G = window.GAME, main = window.__REALISM_MAIN;
      const c = G.watAmulet;
      const named = !!(c && c.mesh && c.mesh.name === 'wat-amulet-board');
      const n = c && c.mesh ? c.mesh.children.filter(ch => ch && ch.name === 'wat-amulet').length : 0;
      const temple = G.world && G.world.poi && G.world.poi.temple;
      const nearWat = !!(c && temple && Math.hypot(c.x - temple.x, c.z - temple.z) < 16);
      G.time.dayT = 21.2 / 24;
      main.updateWatAmulet(0.05);
      const night = !!(c && c.vendor && c.vendor.mesh && c.vendor.mesh.visible === false);
      G.time.dayT = 12 / 24;
      if (c) c.t = 0.2;
      main.updateWatAmulet(0.05);
      const day = !!(c && c.vendor && c.vendor.watAmulet && c.vendor.mesh && c.vendor.mesh.visible);
      const a0 = c && c.mesh && c.mesh.children.find(ch => ch && ch.name === 'wat-amulet');
      const r0 = a0 ? a0.rotation.z : 0;
      if (c) c.t = 0.2 + Math.PI / 2.4;
      main.updateWatAmulet(0.05);
      const swayed = !!(a0 && Math.abs(a0.rotation.z - r0) > 0.08);
      G.player.inVehicle = null;
      G._eating = null;
      G._malai = false;
      G._lotus = false;
      G._amulet = false;
      G._amuletOffered = 0;
      if (c && c.mesh) G.player.group.position.copy(c.mesh.position);
      G.cash = 100;
      window.dispatchEvent(new KeyboardEvent('keyup', { code: 'KeyE' }));
      if (G.input && G.input.endFrame) G.input.endFrame();
      let paid = false;
      for (let i = 0; i < 4 && !paid; i++) {
        window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyE' }));
        main.updateWatAmulet(0.016);
        window.dispatchEvent(new KeyboardEvent('keyup', { code: 'KeyE' }));
        if (G.input && G.input.endFrame) G.input.endFrame();
        paid = G.cash === 50 && G._amulet === true;
      }
      const s = (G.world.shrines || [])[0];
      let offered = false, cooled = false;
      if (s && s.pos) {
        G.player.group.position.set(s.pos.x, 0, s.pos.z);
        G.wanted.stars = 2;
        G.wanted.lastSeenAt = performance.now() + 30000;
        s.readyAt = 1;
        const seen0 = G.wanted.lastSeenAt;
        window.dispatchEvent(new KeyboardEvent('keyup', { code: 'KeyE' }));
        if (G.input && G.input.endFrame) G.input.endFrame();
        for (let i = 0; i < 4 && !offered; i++) {
          window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyE' }));
          main.updateShrines(0.016);
          window.dispatchEvent(new KeyboardEvent('keyup', { code: 'KeyE' }));
          if (G.input && G.input.endFrame) G.input.endFrame();
          offered = (G._amuletOffered || 0) >= 1 && G._amulet === false;
        }
        cooled = G.wanted.lastSeenAt < seen0 - 18000;
      }
      return {
        flag: !!(G.gameplay && G.gameplay.watAmulet),
        named, n, nearWat, night, day, swayed, paid, offered, cooled,
      };
    });
    assert(amulet.flag && amulet.named && amulet.n >= 6 && amulet.nearWat, `an amulet board waits at the wat (${amulet.n})`);
    assert(amulet.night && amulet.day && amulet.swayed && amulet.paid, 'E buys an amulet; the shrine takes it for extra heat cool');
    assert(amulet.offered && amulet.cooled, 'the shrine takes the amulet for extra heat cool');

    console.log('\n[109] Yaowarat fortune teller');
    const fortune = await page.evaluate(() => {
      const G = window.GAME, main = window.__REALISM_MAIN;
      const c = G.yaoFortune;
      const named = !!(c && c.mesh && c.mesh.name === 'yao-fortune');
      const n = c && c.mesh ? c.mesh.children.filter(ch => ch && ch.name === 'yao-card').length : 0;
      const lamp = !!(c && c.mesh && c.mesh.getObjectByName('yao-fortune-lamp'));
      const poi = G.world && G.world.poi && G.world.poi.yaowarat;
      const near = !!(c && poi && Math.hypot(c.x - poi.x, c.z - poi.z) < 40);
      G.time.dayT = 8 / 24;
      main.updateYaoFortune(0.05);
      const day = !!(c && c.vendor && c.vendor.mesh && c.vendor.mesh.visible === false);
      G.time.dayT = 21.2 / 24;
      if (c) { c.t = 0.2; c.readyAt = 0; }
      main.updateYaoFortune(0.05);
      const night = !!(c && c.vendor && c.vendor.yaoFortune && c.vendor.mesh && c.vendor.mesh.visible);
      const glow = !!(c && c.lampMat && c.lampMat.emissiveIntensity > 0.4);
      const card = c && c.mesh && c.mesh.children.find(ch => ch && ch.name === 'yao-card');
      const r0 = card ? card.rotation.z : 0;
      if (c) c.t = 0.2 + Math.PI / 3.6;
      main.updateYaoFortune(0.05);
      const flipped = !!(card && Math.abs(card.rotation.z - r0) > 0.1);
      G.player.inVehicle = null;
      G._eating = null;
      if (c && c.mesh) G.player.group.position.copy(c.mesh.position);
      G.cash = 120;
      G._yaoFortune = 0;
      G.wanted.lastSeenAt = (typeof performance !== 'undefined' && performance.now) ? performance.now() + 20000 : 20000;
      const seen0 = G.wanted.lastSeenAt;
      window.dispatchEvent(new KeyboardEvent('keyup', { code: 'KeyE' }));
      if (G.input && G.input.endFrame) G.input.endFrame();
      let paid = false;
      for (let i = 0; i < 4 && !paid; i++) {
        window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyE' }));
        main.updateYaoFortune(0.016);
        window.dispatchEvent(new KeyboardEvent('keyup', { code: 'KeyE' }));
        if (G.input && G.input.endFrame) G.input.endFrame();
        paid = G.cash === 60 && (G._yaoFortune || 0) >= 1;
      }
      const cooled = G.wanted.lastSeenAt < seen0 - 5000;
      return {
        flag: !!(G.gameplay && G.gameplay.yaoFortune),
        named, n, lamp, near, day, night, glow, flipped, paid, cooled,
      };
    });
    assert(fortune.flag && fortune.named && fortune.n >= 4 && fortune.lamp && fortune.near, `a fortune teller waits on Yaowarat (${fortune.n})`);
    assert(fortune.day && fortune.night && fortune.glow && fortune.flipped && fortune.paid && fortune.cooled, 'the cards turn after dark and E buys a ฿60 reading');

    console.log('\n[110] pigeons on the Phrom Phong platform');
    const phromBirds = await page.evaluate(() => {
      const G = window.GAME, main = window.__REALISM_MAIN;
      const list = (G.btsPigeons || []).filter(p => p && p.stop === 'phrom');
      const n = list.filter(p => p && p.mesh && p.mesh.name === 'bts-pigeon').length;
      const wings = list.filter(p => p && p.mesh && p.mesh.children.filter(ch => ch && ch.name === 'pigeon-wing').length >= 2).length;
      const near = list.filter(p => p && p.home && Math.hypot(p.home.x - 100, p.home.z) < 20 && p.home.y > 10).length;
      G.time.dayT = 21.2 / 24;
      main.updateBtsPigeons(0.05);
      const night = list.filter(p => p && p.mesh && p.mesh.visible === false).length;
      G.time.dayT = 12 / 24;
      const p0 = list[0];
      if (p0) { p0.t = 0.2; p0.state = 'loaf'; if (p0.home) p0.mesh.position.set(p0.home.x, p0.home.y, p0.home.z); }
      G.player.group.position.set(0, 0, 80);
      main.updateBtsPigeons(0.05);
      const day = list.filter(p => p && p.mesh && p.mesh.visible).length;
      const yHome = p0 && p0.home ? p0.home.y : 0;
      if (p0 && p0.home) {
        G.player.group.position.set(p0.home.x, p0.home.y, p0.home.z);
        p0.state = 'loaf';
        p0.mesh.position.set(p0.home.x, p0.home.y, p0.home.z);
      }
      for (let i = 0; i < 20; i++) main.updateBtsPigeons(0.08);
      const scattered = !!(p0 && p0.mesh && p0.mesh.position.y > yHome + 0.8);
      return {
        flag: !!(G.gameplay && G.gameplay.btsPigeons),
        n, wings, near, night, day, scattered,
      };
    });
    assert(phromBirds.flag && phromBirds.n >= 6 && phromBirds.wings >= 6 && phromBirds.near >= 6, `pigeons loaf the Phrom Phong platform (${phromBirds.n})`);
    assert(phromBirds.night >= 6 && phromBirds.day >= 6 && phromBirds.scattered, 'they hide at night and scatter when you walk up');

    console.log('\n[111] temple drum at the wat');
    const drum = await page.evaluate(() => {
      const G = window.GAME, main = window.__REALISM_MAIN;
      const c = G.watDrum;
      const named = !!(c && c.mesh && c.mesh.name === 'wat-drum-frame');
      const barrel = !!(c && c.drum && c.drum.name === 'wat-drum');
      const stick = !!(c && c.beater && c.beater.name === 'wat-drum-beater');
      const temple = G.world && G.world.poi && G.world.poi.temple;
      const nearWat = !!(c && temple && Math.hypot(c.x - temple.x, c.z - temple.z) < 16);
      G.player.inVehicle = null;
      G._eating = null;
      G._barberCut = null;
      G.time.dayT = 12 / 24;
      if (c) { c.beatT = 0; c.t = 0; c.readyAt = 0; }
      main.updateWatDrum(0.05);
      const noon = !!(c && c.monk && c.monk.mesh && c.monk.mesh.visible === false);
      G.time.dayT = 7.2 / 24;
      main.updateWatDrum(0.05);
      const dawn = !!(c && c.monk && c.monk.watDrum && c.monk.mesh && c.monk.mesh.visible);
      G.time.dayT = 12 / 24;
      if (c) {
        c.beatT = 0;
        c.readyAt = 0;
        c.t = 0;
        G.player.group.position.set(c.x, 0, c.z);
      }
      G._watDrum = 0;
      const seen0 = performance.now() + 30000;
      G.wanted.lastSeenAt = seen0;
      window.dispatchEvent(new KeyboardEvent('keyup', { code: 'KeyE' }));
      if (G.input && G.input.endFrame) G.input.endFrame();
      let beat = false;
      for (let i = 0; i < 4 && !beat; i++) {
        window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyE' }));
        main.updateWatDrum(0.016);
        window.dispatchEvent(new KeyboardEvent('keyup', { code: 'KeyE' }));
        if (G.input && G.input.endFrame) G.input.endFrame();
        beat = (G._watDrum || 0) >= 1 && c && c.beatT > 0;
      }
      const z0 = c && c.beater ? c.beater.rotation.z : 0;
      for (let i = 0; i < 8; i++) main.updateWatDrum(0.08);
      const swung = !!(c && c.beater && Math.abs(c.beater.rotation.z - z0) > 0.02);
      return {
        flag: !!(G.gameplay && G.gameplay.watDrum),
        named, barrel, stick, nearWat, noon, dawn, beat, swung,
        cooled: G.wanted.lastSeenAt <= seen0 - 8000,
      };
    });
    assert(drum.flag && drum.named && drum.barrel && drum.stick && drum.nearWat, 'a temple drum hangs at the wat');
    assert(drum.noon && drum.dawn && drum.beat && drum.swung && drum.cooled, 'a monk beats at dawn and E sounds the drum');

    console.log('\n[112] mall guard at Terminal 21');
    const booth21 = await page.evaluate(() => {
      const G = window.GAME, main = window.__REALISM_MAIN;
      const g = G.mallGuard;
      const mall = G.world && G.world.poi && G.world.poi.terminal21;
      main.updatePeds(0.05);
      main.updateMallGuard(0.05);
      const ped = g && g.ped;
      const seated = !!(ped && ped.mallGuard && ped.mesh && ped.mesh.position.y >= 0.3);
      const chair = !!(g && g.chair && g.chair.name === 'mall-chair');
      const near = !!(mall && ped && ped.mesh && Math.hypot(ped.mesh.position.x - mall.x, ped.mesh.position.z - mall.z) < 8);
      const torch = !!(ped && ped.mesh && ped.mesh.getObjectByName('flashlight'));
      G.time.dayT = 12 / 24;
      main.updateMallGuard(0.05);
      const dayOff = !!(g && g.beam && g.beam.visible === false && g.light && g.light.intensity === 0);
      G.time.dayT = 21.5 / 24;
      main.updateMallGuard(0.05);
      const nightOn = !!(g && g.beam && g.beam.visible && g.light && g.light.intensity > 0.4);
      return { flag: !!(G.gameplay && G.gameplay.mallGuard), seated, chair, near, torch, dayOff, nightOn };
    });
    assert(booth21.flag && booth21.seated && booth21.chair && booth21.near, 'a guard sits outside Terminal 21');
    assert(booth21.torch && booth21.dayOff && booth21.nightOn, 'the mall guard torch only comes on at night');

    console.log('\n[113] Phrom Phong escalator sitters');
    const phromSit = await page.evaluate(() => {
      const G = window.GAME, main = window.__REALISM_MAIN;
      main.updatePeds(0.05);
      const list = (G.btsSitters || []).filter(p => p && (p.stop === 'phrom'));
      const n = list.filter(p => p && p.btsSit && p.mesh).length;
      const atPhrom = list.filter(p => p && p.mesh && Math.abs(p.mesh.position.x - 100) < 8).length;
      const onStairs = list.filter(p => p && p.mesh && p.mesh.position.y > 2).length;
      const folded = list.filter(p => {
        const parts = p && p.mesh && p.mesh.userData && p.mesh.userData.parts;
        return !!(parts && parts.legL && parts.legL.rotation.x > 0.8);
      }).length;
      const still = list.filter(p => p && p.speed === 0).length;
      return { flag: !!(G.gameplay && G.gameplay.btsSitters), n, atPhrom, onStairs, folded, still };
    });
    assert(phromSit.flag && phromSit.n >= 3 && phromSit.atPhrom >= 3, `people sit the Phrom Phong escalator (${phromSit.n})`);
    assert(phromSit.onStairs >= 1 && phromSit.folded >= 3 && phromSit.still >= 3, 'at least one is up the stairs, legs folded');

    console.log('\n[114] Phrom Phong motosai rank');
    const phromRank = await page.evaluate(() => {
      const G = window.GAME;
      const list = (G.world && G.world.motosaiStands) || [];
      const atPhrom = list.filter(s => s && s.bts === 'phrom');
      const s0 = atPhrom[0];
      const vest = !!(s0 && s0.rider && (s0.rider.motosaiVest || (s0.rider.mesh && s0.rider.mesh.getObjectByName('motosai-vest'))));
      const helm = !!(s0 && s0.rider && (s0.rider.bikeHelmet || (s0.rider.mesh && s0.rider.mesh.getObjectByName('bike-helmet'))));
      const bike = s0 && s0.bike;
      const near = !!(s0 && Math.hypot(s0.x - 100, s0.z) < 28);
      return {
        flag: !!(G.gameplay && G.gameplay.btsMotosai),
        n: atPhrom.length,
        vest, helm, near,
        stand: !!(bike && bike.motosaiStand && bike.driver !== 'player'),
        waiter: !!(s0 && s0.waiter),
      };
    });
    assert(phromRank.flag && phromRank.n >= 1 && phromRank.near, `a motosai rank waits at Phrom Phong (${phromRank.n})`);
    assert(phromRank.vest && phromRank.helm && phromRank.stand && phromRank.waiter, 'Phrom Phong rank has a helmeted vest rider, bike, and waiter');

    console.log('\n[115] bank guard at Krung Thep Bank');
    const bankBooth = await page.evaluate(() => {
      const G = window.GAME, main = window.__REALISM_MAIN;
      const g = G.bankGuard;
      const bank = G.world && G.world.poi && G.world.poi.bank;
      main.updatePeds(0.05);
      main.updateBankGuard(0.05);
      const ped = g && g.ped;
      const seated = !!(ped && ped.bankGuard && ped.mesh && ped.mesh.position.y >= 0.3);
      const chair = !!(g && g.chair && g.chair.name === 'bank-chair');
      const near = !!(bank && ped && ped.mesh && Math.hypot(ped.mesh.position.x - bank.x, ped.mesh.position.z - bank.z) < 8);
      const torch = !!(ped && ped.mesh && ped.mesh.getObjectByName('flashlight'));
      G.time.dayT = 12 / 24;
      main.updateBankGuard(0.05);
      const dayOff = !!(g && g.beam && g.beam.visible === false && g.light && g.light.intensity === 0);
      G.time.dayT = 21.5 / 24;
      main.updateBankGuard(0.05);
      const nightOn = !!(g && g.beam && g.beam.visible && g.light && g.light.intensity > 0.4);
      return { flag: !!(G.gameplay && G.gameplay.bankGuard), seated, chair, near, torch, dayOff, nightOn };
    });
    assert(bankBooth.flag && bankBooth.seated && bankBooth.chair && bankBooth.near, 'a guard sits outside Krung Thep Bank');
    assert(bankBooth.torch && bankBooth.dayOff && bankBooth.nightOn, 'the bank guard torch only comes on at night');

    console.log('\n[116] mall directory at Terminal 21');
    const dir = await page.evaluate(() => {
      const G = window.GAME, main = window.__REALISM_MAIN;
      const c = G.mallDir;
      const named = !!(c && c.mesh && c.mesh.name === 'mall-directory');
      const screen = !!(c && c.screen && c.screen.name === 'mall-dir-screen');
      const mall = G.world && G.world.mall && G.world.mall.center;
      const near = !!(c && mall && Math.hypot(c.x - mall.x, c.z - mall.z) < 8);
      G.time.dayT = 23 / 24;
      main.updateMallDirectory(0.05);
      const night = !!(c && c.clerk && c.clerk.mesh && c.clerk.mesh.visible === false);
      G.time.dayT = 12 / 24;
      if (c) c.t = 0.2;
      main.updateMallDirectory(0.05);
      const day = !!(c && c.clerk && c.clerk.mallDir && c.clerk.mesh && c.clerk.mesh.visible);
      const glow0 = c && c.screen && c.screen.material ? c.screen.material.emissiveIntensity : 0;
      if (c) c.t = 0.2 + Math.PI / 3.2;
      main.updateMallDirectory(0.05);
      const glowed = !!(c && c.screen && Math.abs(c.screen.material.emissiveIntensity - glow0) > 0.02);
      G.player.inVehicle = null;
      G._eating = null;
      if (c && c.mesh) G.player.group.position.set(c.x, 0, c.z - 1.6);
      G._mallDir = 0;
      G._mallDirShop = null;
      window.dispatchEvent(new KeyboardEvent('keyup', { code: 'KeyE' }));
      if (G.input && G.input.endFrame) G.input.endFrame();
      let asked = false;
      for (let i = 0; i < 4 && !asked; i++) {
        window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyE' }));
        main.updateMallDirectory(0.016);
        window.dispatchEvent(new KeyboardEvent('keyup', { code: 'KeyE' }));
        if (G.input && G.input.endFrame) G.input.endFrame();
        asked = (G._mallDir || 0) >= 1 && !!G._mallDirShop;
      }
      return {
        flag: !!(G.gameplay && G.gameplay.mallDir),
        named, screen, near, night, day, glowed, asked, shop: G._mallDirShop,
      };
    });
    assert(dir.flag && dir.named && dir.screen && dir.near, 'a directory board waits at Terminal 21');
    assert(dir.night && dir.day && dir.glowed && dir.asked, 'the clerk works the desk and E names a shop');

    console.log('\n[117] office smokers at Asok north-west');
    const smokeBreak = await page.evaluate(() => {
      const G = window.GAME, main = window.__REALISM_MAIN;
      const c = G.officeSmoke;
      const list = (c && c.smokers) || [];
      const n = list.filter(p => p && p.officeSmoke && p.mesh).length;
      const cigs = list.filter(p => p && p.mesh && p.mesh.getObjectByName('office-cig')).length;
      const embers = list.filter(p => p && p.mesh && p.mesh.getObjectByName('office-cig-ember')).length;
      const bts = G.world && G.world.bts;
      const sx = bts ? bts.x : -50;
      const near = list.filter(p => p && p.mesh && Math.hypot(p.mesh.position.x - (c ? c.x : sx - 9.2), p.mesh.position.z - (c ? c.z : 12.8)) < 4).length;
      G.time.dayT = 9 / 24;
      main.updateOfficeSmoke(0.05);
      const morning = list.filter(p => p && p.mesh && p.mesh.visible === false).length;
      G.time.dayT = 12.4 / 24;
      if (c) c.t = 0.2;
      main.updateOfficeSmoke(0.05);
      const lunch = list.filter(p => p && p.officeSmoke && p.mesh && p.mesh.visible).length;
      const p0 = list[0];
      const z0 = p0 && p0.mesh ? p0.mesh.position.z : 0;
      const e0 = p0 && p0._ember && p0._ember.material ? p0._ember.material.emissiveIntensity : 0;
      if (c) c.t = 0.2 + Math.PI / 2.2;
      main.updateOfficeSmoke(0.05);
      const shifted = !!(p0 && p0.mesh && Math.abs(p0.mesh.position.z - z0) > 0.02);
      const glowed = !!(p0 && p0._ember && Math.abs(p0._ember.material.emissiveIntensity - e0) > 0.04);
      G.time.dayT = 16 / 24;
      main.updateOfficeSmoke(0.05);
      const afternoon = list.filter(p => p && p.mesh && p.mesh.visible === false).length;
      return {
        flag: !!(G.gameplay && G.gameplay.officeSmoke),
        n, cigs, embers, near, morning, lunch, shifted, glowed, afternoon,
      };
    });
    assert(smokeBreak.flag && smokeBreak.n >= 3 && smokeBreak.cigs >= 3 && smokeBreak.embers >= 3 && smokeBreak.near >= 3, `office smokers wait north-west of Asok (${smokeBreak.n})`);
    assert(smokeBreak.morning >= 3 && smokeBreak.lunch >= 3 && smokeBreak.afternoon >= 3 && smokeBreak.shifted && smokeBreak.glowed, 'they only come out at lunch and the embers glow');

    console.log('\n[118] bank teller queue');
    const tellerQ = await page.evaluate(() => {
      const G = window.GAME, main = window.__REALISM_MAIN;
      const c = G.bankQueue;
      const teller = G.world && G.world.bank && G.world.bank.teller;
      const n = (c && c.queue || []).filter(p => p && p.bankQueue && p.mesh).length;
      const book = (c && c.queue || []).some(p => p && p.mesh && p.mesh.getObjectByName('bank-passbook'));
      const near = !!(c && teller && Math.hypot(c.x - teller.x, c.z - teller.z) < 1);
      G.time.dayT = 18 / 24;
      main.updateBankQueue(0.05);
      const late = (c && c.queue || []).filter(p => p && p.mesh && p.mesh.visible === false).length;
      G.time.dayT = 12 / 24;
      if (c) c.t = 0.2;
      main.updateBankQueue(0.05);
      const day = (c && c.queue || []).filter(p => p && p.bankQueue && p.mesh && p.mesh.visible).length;
      const p0 = c && c.queue && c.queue[0];
      const z0 = p0 && p0.mesh ? p0.mesh.position.z : 0;
      if (c) c.t = 0.2 + Math.PI / 2.4;
      main.updateBankQueue(0.05);
      const shifted = !!(p0 && p0.mesh && Math.abs(p0.mesh.position.z - z0) > 0.04);
      return {
        flag: !!(G.gameplay && G.gameplay.bankQueue),
        n, book, near, late, day, shifted,
      };
    });
    assert(tellerQ.flag && tellerQ.n >= 2 && tellerQ.book && tellerQ.near, `a queue waits at the Krung Thep Bank teller (${tellerQ.n})`);
    assert(tellerQ.late >= 2 && tellerQ.day >= 2 && tellerQ.shifted, 'they hide after hours and shift weight at the counter');

    console.log('\n[119] Pier 21 food-court eaters');
    const court = await page.evaluate(() => {
      const G = window.GAME, main = window.__REALISM_MAIN;
      const c = G.mallFood;
      const table = !!(c && c.table && c.table.name === 'mall-food-table');
      const list = (c && c.eaters) || [];
      const n = list.filter(p => p && p.mallFood && p.mesh).length;
      const tray = list.some(p => p && p.mesh && p.mesh.getObjectByName('mall-food-tray'));
      const shop = G.world && G.world.mall && (G.world.mall.shops || []).find(s => s && s.name === 'Pier 21 Food Court');
      const near = !!(c && shop && shop.pos && Math.hypot(c.x - shop.pos.x, c.z - shop.pos.z) < 4);
      G.time.dayT = 22 / 24;
      main.updateMallFood(0.05);
      const night = list.filter(p => p && p.mesh && p.mesh.visible === false).length;
      G.time.dayT = 12.5 / 24;
      main.updateMallFood(0.05);
      main.updatePeds(0.05);
      const lunch = list.filter(p => p && p.mallFood && p.mesh && p.mesh.visible && p.mesh.position.y >= 0.3).length;
      const folded = list.filter(p => {
        const parts = p && p.mesh && p.mesh.userData && p.mesh.userData.parts;
        return !!(parts && parts.legL && parts.legL.rotation.x > 0.8);
      }).length;
      return {
        flag: !!(G.gameplay && G.gameplay.mallFood),
        table, n, tray, near, night, lunch, folded,
      };
    });
    assert(court.flag && court.table && court.n >= 3 && court.tray && court.near, `eaters sit Pier 21 Food Court (${court.n})`);
    assert(court.night >= 3 && court.lunch >= 3 && court.folded >= 3, 'they hide after 21:00 and sit with trays at lunch');

    console.log('\n[120] Phrom Phong tuk-tuk rank');
    const phromTuk = await page.evaluate(() => {
      const G = window.GAME, main = window.__REALISM_MAIN;
      main.updateVehicles(0.016);
      const rec = G.world && G.world.phromTuktuk;
      const v = rec && rec.vehicle;
      const kind = v && (v.kind || (v.spec && v.spec.kind));
      const dist = (v && v.pos) ? Math.hypot(v.pos.x - 100, v.pos.z) : null;
      const sign = !!(v && (v.hireSign || (v.mesh && v.mesh.getObjectByName('hire-sign'))));
      return {
        flag: !!(G.gameplay && G.gameplay.btsTuktuk),
        rec: !!rec, kind,
        stand: !!(v && v.btsTuktuk && v.driver !== 'player' && v._standHome),
        near: dist != null && dist < 28,
        waiter: !!(rec && rec.waiter && rec.waiter.btsTuktuk && rec.waiter.stop === 'phrom'),
        sign,
      };
    });
    assert(phromTuk.flag && phromTuk.kind === 'tuktuk' && phromTuk.near, 'a tuk-tuk waits at Phrom Phong');
    assert(phromTuk.stand && phromTuk.waiter && phromTuk.sign, 'Phrom Phong tuk-tuk is pinned, hired, and has a driver waiting');

    console.log('\n[121] Phrom Phong songthaew rank');
    const phromSong = await page.evaluate(() => {
      const G = window.GAME, main = window.__REALISM_MAIN;
      main.updateVehicles(0.016);
      const rec = G.world && G.world.phromSongthaew;
      const v = rec && rec.vehicle;
      const kind = v && (v.kind || (v.spec && v.spec.kind));
      const dist = (v && v.pos) ? Math.hypot(v.pos.x - 100, v.pos.z) : null;
      const sign = !!(v && (v.hireSign || (v.mesh && v.mesh.getObjectByName('hire-sign'))));
      const riders = (rec && rec.riders) || [];
      const n = riders.filter(p => p && p.songthaewRide && p.mesh).length;
      const seated = riders.filter(p => p && p.mesh && p.mesh.parent === (v && v.mesh)).length;
      G.player.inVehicle = null;
      if (v) v.driver = null;
      if (rec) rec._dumped = false;
      main.updateSongthaewRiders(0.05);
      const parked = riders.filter(p => p && p.songthaewRide && p.mesh && p.mesh.parent === v.mesh).length;
      if (v) v.driver = 'player';
      main.updateSongthaewRiders(0.05);
      const dumped = rec && rec._dumped === true;
      const off = riders.filter(p => p && !p.songthaewRide && p.mesh && p.mesh.parent === G.scene).length;
      const grounded = riders.filter(p => p && p.mesh && p.mesh.position.y < 0.2).length;
      if (v) v.driver = null;
      return {
        flag: !!(G.gameplay && G.gameplay.btsSongthaew && G.gameplay.songthaewRiders),
        rec: !!rec, kind,
        stand: !!(v && v.btsSongthaew && v.driver !== 'player' && v._standHome),
        near: dist != null && dist < 28,
        waiter: !!(rec && rec.waiter && rec.waiter.btsSongthaew && rec.waiter.stop === 'phrom'),
        sign, n, seated, parked, dumped, off, grounded,
      };
    });
    assert(phromSong.flag && phromSong.kind === 'songthaew' && phromSong.near, 'a songthaew waits at Phrom Phong');
    assert(phromSong.stand && phromSong.waiter && phromSong.sign, 'Phrom Phong songthaew is pinned, hired, and has a hawker waiting');
    assert(phromSong.n >= 3 && phromSong.seated >= 3 && phromSong.parked >= 3, `passengers sit the Phrom Phong songthaew (${phromSong.n})`);
    assert(phromSong.dumped && phromSong.off >= 3 && phromSong.grounded >= 3, 'they hop off onto the pavement when you take the ride');

    console.log('\n[122] Phrom Phong ticket gates');
    const phromTap = await page.evaluate(() => {
      const G = window.GAME, main = window.__REALISM_MAIN;
      const st = G.phromGates;
      const n = st && st.gates ? st.gates.filter(g => g && g.mesh && g.mesh.name === 'bts-gate').length : 0;
      const flaps = st && st.gates ? st.gates.filter(g => g && g.flap && g.flap.name === 'bts-flap').length : 0;
      const machine = !!(st && st.machine && st.machine.name === 'bts-ticket-machine');
      const screen = !!(st && st.machine && st.machine.getObjectByName('bts-ticket-screen'));
      const dist = (st && st.sx != null) ? Math.abs(st.sx - 100) : null;
      G.player.inVehicle = null;
      G._btsRide = null;
      G._eating = null;
      G._barberCut = null;
      G._btsTicket = false;
      G._btsHopped = 0;
      G._btsTapped = 0;
      G.policeOff = false;
      G.wanted.stars = 0;
      G.wanted.crime = 0;
      if (st && st.machine) G.player.group.position.set(st.machine.position.x, 0, st.machine.position.z);
      G.cash = 100;
      window.dispatchEvent(new KeyboardEvent('keyup', { code: 'KeyE' }));
      if (G.input && G.input.endFrame) G.input.endFrame();
      let paid = false;
      for (let i = 0; i < 4 && !paid; i++) {
        window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyE' }));
        main.updateBtsGates(0.016);
        window.dispatchEvent(new KeyboardEvent('keyup', { code: 'KeyE' }));
        if (G.input && G.input.endFrame) G.input.endFrame();
        paid = G.cash === 50 && !!G._btsTicket;
      }
      G._btsTicket = false;
      st.openT = 0;
      st._pz = st.zGate - 1.2;
      G.player.group.position.set(st.sx, st.py, st.zGate - 1.2);
      main.updateBtsGates(0.016);
      G.player.group.position.set(st.sx, st.py, st.zGate + 0.8);
      main.updateBtsGates(0.016);
      const hopped = (G._btsHopped || 0) >= 1 && G.wanted.stars >= 1;
      G.wanted.stars = 0;
      G.wanted.crime = 0;
      G._btsHopped = 0;
      G._btsTicket = true;
      st.openT = 0;
      st._pz = st.zGate - 1.2;
      G.player.group.position.set(st.sx, st.py, st.zGate - 1.2);
      main.updateBtsGates(0.016);
      G.player.group.position.set(st.sx, st.py, st.zGate + 0.8);
      main.updateBtsGates(0.016);
      const flap = st.gates && st.gates[0] && st.gates[0].flap;
      const opened = !!(flap && flap.rotation.y > 0.5);
      const tapped = (G._btsTapped || 0) >= 1 && G.wanted.stars === 0;
      return {
        flag: !!(G.gameplay && G.gameplay.btsGates),
        rec: !!st, stop: st && st.stop, n, flaps, machine, screen,
        near: dist != null && dist < 2,
        paid, hopped, opened, tapped,
      };
    });
    assert(phromTap.flag && phromTap.stop === 'phrom' && phromTap.near && phromTap.n >= 3 && phromTap.flaps >= 3 && phromTap.machine && phromTap.screen, `Phrom Phong ticket gates (${phromTap.n})`);
    assert(phromTap.paid, 'E buys a Rabbit card at Phrom Phong for ฿50');
    assert(phromTap.hopped && phromTap.opened && phromTap.tapped, 'hopping Phrom Phong is a star; a tap opens the flaps');

    console.log('\n[123] newspaper rack at Phrom Phong');
    const phromPaper = await page.evaluate(() => {
      const G = window.GAME, main = window.__REALISM_MAIN;
      const c = G.phromPaper;
      const named = !!(c && c.mesh && c.mesh.name === 'bts-paper-rack');
      const n = c && c.mesh ? c.mesh.children.filter(ch => ch && ch.name === 'bts-paper').length : 0;
      const dist = (c && c.x != null) ? Math.hypot(c.x - 100, c.z) : null;
      G.time.dayT = 21.2 / 24;
      main.updateBtsPaper(0.05);
      const night = !!(c && c.vendor && c.vendor.mesh && c.vendor.mesh.visible === false);
      G.time.dayT = 8 / 24;
      if (c) c.t = 0.2;
      main.updateBtsPaper(0.05);
      const day = !!(c && c.vendor && c.vendor.btsPaper && c.vendor.stop === 'phrom' && c.vendor.mesh && c.vendor.mesh.visible);
      const p0 = c && c.mesh && c.mesh.children.find(ch => ch && ch.name === 'bts-paper');
      const r0 = p0 ? p0.rotation.z : 0;
      if (c) c.t = 0.2 + Math.PI / 2.6;
      main.updateBtsPaper(0.05);
      const fluttered = !!(p0 && Math.abs(p0.rotation.z - r0) > 0.02);
      G.player.inVehicle = null;
      G._eating = null;
      if (c && c.mesh) G.player.group.position.copy(c.mesh.position);
      G.cash = 50;
      G._btsPaper = 0;
      window.dispatchEvent(new KeyboardEvent('keyup', { code: 'KeyE' }));
      if (G.input && G.input.endFrame) G.input.endFrame();
      let paid = false;
      for (let i = 0; i < 4 && !paid; i++) {
        window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyE' }));
        main.updateBtsPaper(0.016);
        window.dispatchEvent(new KeyboardEvent('keyup', { code: 'KeyE' }));
        if (G.input && G.input.endFrame) G.input.endFrame();
        paid = G.cash === 35 && (G._btsPaper || 0) >= 1;
      }
      return {
        flag: !!(G.gameplay && G.gameplay.btsPaper),
        named, n, stop: c && c.stop,
        near: dist != null && dist < 28,
        night, day, fluttered, paid,
      };
    });
    assert(phromPaper.flag && phromPaper.named && phromPaper.stop === 'phrom' && phromPaper.n >= 6 && phromPaper.near, 'a newspaper rack waits at Phrom Phong');
    assert(phromPaper.night && phromPaper.day && phromPaper.fluttered && phromPaper.paid, 'the Phrom Phong vendor works mornings and E buys a paper for ฿15');

    console.log('\n[124] BTS busker at Phrom Phong');
    const phromBusk = await page.evaluate(() => {
      const G = window.GAME, main = window.__REALISM_MAIN;
      const c = G.phromBusker;
      const ped = c && c.ped;
      const guitar = !!(ped && ped.mesh && ped.mesh.getObjectByName('bts-guitar'));
      const hat = !!(c && c.hat && c.hat.name === 'bts-busker-hat');
      const dist = (c && c.x != null) ? Math.hypot(c.x - 100, c.z) : null;
      G.time.dayT = 12 / 24;
      main.updateBtsBusker(0.05);
      const day = !!(ped && ped.mesh && ped.mesh.visible === false);
      G.time.dayT = 17.5 / 24;
      if (c) c.t = 0.2;
      main.updateBtsBusker(0.05);
      const eve = !!(ped && ped.btsBusker && ped.stop === 'phrom' && ped.mesh && ped.mesh.visible);
      const g = ped && ped.mesh && ped.mesh.getObjectByName('bts-guitar');
      const r0 = g ? g.rotation.z : 0;
      if (c) c.t = 0.2 + Math.PI / 10;
      main.updateBtsBusker(0.05);
      const strummed = !!(g && Math.abs(g.rotation.z - r0) > 0.04);
      G.player.inVehicle = null;
      G._eating = null;
      if (c) G.player.group.position.set(c.x, 0, c.z);
      G.cash = 100;
      G._btsBusker = 0;
      window.dispatchEvent(new KeyboardEvent('keyup', { code: 'KeyE' }));
      if (G.input && G.input.endFrame) G.input.endFrame();
      let paid = false;
      for (let i = 0; i < 4 && !paid; i++) {
        window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyE' }));
        main.updateBtsBusker(0.016);
        window.dispatchEvent(new KeyboardEvent('keyup', { code: 'KeyE' }));
        if (G.input && G.input.endFrame) G.input.endFrame();
        paid = G.cash === 80 && (G._btsBusker || 0) >= 1;
      }
      return {
        flag: !!(G.gameplay && G.gameplay.btsBusker),
        guitar, hat, stop: c && c.stop,
        near: dist != null && dist < 28,
        day, eve, strummed, paid,
      };
    });
    assert(phromBusk.flag && phromBusk.guitar && phromBusk.hat && phromBusk.stop === 'phrom' && phromBusk.near, 'a busker waits at Phrom Phong BTS');
    assert(phromBusk.day && phromBusk.eve && phromBusk.strummed && phromBusk.paid, 'they play evenings at Phrom Phong and E tips ฿20');

    console.log('\n[125] Phrom Phong crossing guards');
    const phromGuard = await page.evaluate(() => {
      const G = window.GAME, main = window.__REALISM_MAIN;
      G.time.dayT = 7.4 / 24;
      main.updateCrossingGuards(0.05);
      const list = (G._crossingGuards || []).filter(p => p && p.crossingGuard && p.stop === 'phrom' && !p.dead);
      const n = list.length;
      const g0 = list[0];
      const vest = !!(g0 && g0.mesh && g0.mesh.getObjectByName('guard-vest'));
      const paddle = !!(g0 && g0.mesh && g0.mesh.getObjectByName('stop-paddle'));
      const near = list.filter(p => p && p.mesh && Math.hypot(p.mesh.position.x - 100, p.mesh.position.z) < 18).length;
      G.time.dayT = 12 / 24;
      main.updateCrossingGuards(0.05);
      const goneNoon = !(G._crossingGuards && G._crossingGuards.length);
      G.time.dayT = 15.4 / 24;
      main.updateCrossingGuards(0.05);
      const pm = (G._crossingGuards || []).filter(p => p && p.crossingGuard && p.stop === 'phrom').length;
      G.time.dayT = 18 / 24;
      main.updateCrossingGuards(0.05);
      const goneEve = !(G._crossingGuards && G._crossingGuards.length);
      return { flag: !!(G.gameplay && G.gameplay.crossingGuard), n, vest, paddle, near, goneNoon, pm, goneEve };
    });
    assert(phromGuard.flag && phromGuard.n >= 2 && phromGuard.near >= 2, `crossing guards stand at Phrom Phong (${phromGuard.n})`);
    assert(phromGuard.vest && phromGuard.paddle, 'Phrom Phong yellow vest and stop paddle');
    assert(phromGuard.goneNoon && phromGuard.pm >= 2 && phromGuard.goneEve, 'they leave after morning and return for the afternoon pickup');

    console.log('\n[126] Sukhumvit gun shop clerk');
    const gunClerk = await page.evaluate(() => {
      const G = window.GAME, main = window.__REALISM_MAIN;
      const c = G.gunClerk;
      const ped = c && c.ped;
      const cloth = !!(ped && ped.mesh && ped.mesh.getObjectByName('gun-cloth'));
      const shop = G.world && G.world.gunShop;
      const near = !!(c && shop && Math.hypot(c.x - shop.x, c.z - shop.z) < 4);
      G.time.dayT = 22.4 / 24;
      main.updateGunClerk(0.05);
      const night = !!(ped && ped.mesh && ped.mesh.visible === false);
      G.time.dayT = 12 / 24;
      if (c) c.t = 0.2;
      main.updateGunClerk(0.05);
      const day = !!(ped && ped.gunClerk && ped.mesh && ped.mesh.visible);
      const rag = ped && ped.mesh && ped.mesh.getObjectByName('gun-cloth');
      const r0 = rag ? rag.rotation.z : 0;
      if (c) c.t = 0.2 + Math.PI / 4.2;
      main.updateGunClerk(0.05);
      const wiped = !!(rag && Math.abs(rag.rotation.z - r0) > 0.04);
      return {
        flag: !!(G.gameplay && G.gameplay.gunClerk),
        rec: !!c, cloth, near, night, day, wiped,
      };
    });
    assert(gunClerk.flag && gunClerk.rec && gunClerk.cloth && gunClerk.near, 'a clerk waits behind the Sukhumvit Gun Shop counter');
    assert(gunClerk.night && gunClerk.day && gunClerk.wiped, 'they hide after hours and wipe the counter by day');

    console.log('\n[127] shoe shine at Phrom Phong north');
    const phromShine = await page.evaluate(() => {
      const G = window.GAME, main = window.__REALISM_MAIN;
      const c = G.phromShine;
      const named = !!(c && c.mesh && c.mesh.name === 'bts-shine');
      const box = !!(c && c.mesh && c.mesh.getObjectByName('shine-box'));
      const n = c && c.mesh ? c.mesh.children.filter(ch => ch && ch.name === 'shine-tin').length : 0;
      const cloth = !!(c && c.mesh && c.mesh.getObjectByName('shine-cloth'));
      const dist = (c && c.x != null) ? Math.hypot(c.x - 100, c.z) : null;
      G.time.dayT = 21.2 / 24;
      main.updateBtsShine(0.05);
      const night = !!(c && c.vendor && c.vendor.mesh && c.vendor.mesh.visible === false);
      G.time.dayT = 12 / 24;
      if (c) c.t = 0.2;
      main.updateBtsShine(0.05);
      const day = !!(c && c.vendor && c.vendor.btsShine && c.vendor.stop === 'phrom' && c.vendor.mesh && c.vendor.mesh.visible);
      const rag = c && c.mesh && c.mesh.getObjectByName('shine-cloth');
      const r0 = rag ? rag.rotation.z : 0;
      if (c) c.t = 0.2 + Math.PI / 9;
      main.updateBtsShine(0.05);
      const wiped = !!(rag && Math.abs(rag.rotation.z - r0) > 0.2);
      G.player.inVehicle = null;
      G._eating = null;
      if (c && c.mesh) G.player.group.position.copy(c.mesh.position);
      G.cash = 60;
      G._btsShine = 0;
      window.dispatchEvent(new KeyboardEvent('keyup', { code: 'KeyE' }));
      if (G.input && G.input.endFrame) G.input.endFrame();
      let paid = false;
      for (let i = 0; i < 4 && !paid; i++) {
        window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyE' }));
        main.updateBtsShine(0.016);
        window.dispatchEvent(new KeyboardEvent('keyup', { code: 'KeyE' }));
        if (G.input && G.input.endFrame) G.input.endFrame();
        paid = G.cash === 30 && (G._btsShine || 0) >= 1;
      }
      return {
        flag: !!(G.gameplay && G.gameplay.btsShine),
        named, box, n, cloth, stop: c && c.stop,
        near: dist != null && dist < 28 && c.z > 0,
        night, day, wiped, paid,
      };
    });
    assert(phromShine.flag && phromShine.named && phromShine.box && phromShine.n >= 2 && phromShine.cloth && phromShine.stop === 'phrom' && phromShine.near, 'a shoe-shine box waits north of Phrom Phong');
    assert(phromShine.night && phromShine.day && phromShine.wiped && phromShine.paid, 'the rag wipes by day and E buys a shine for ฿30');

    console.log('\n[128] office smokers at Phrom Phong north-west');
    const phromSmoke = await page.evaluate(() => {
      const G = window.GAME, main = window.__REALISM_MAIN;
      const c = G.phromSmoke;
      const list = (c && c.smokers) || [];
      const n = list.filter(p => p && p.officeSmoke && p.mesh).length;
      const cigs = list.filter(p => p && p.mesh && p.mesh.getObjectByName('office-cig')).length;
      const embers = list.filter(p => p && p.mesh && p.mesh.getObjectByName('office-cig-ember')).length;
      const near = list.filter(p => p && p.mesh && Math.hypot(p.mesh.position.x - 100, p.mesh.position.z) < 18).length;
      G.time.dayT = 9 / 24;
      main.updateOfficeSmoke(0.05);
      const morning = list.filter(p => p && p.mesh && p.mesh.visible === false).length;
      G.time.dayT = 12.4 / 24;
      if (c) c.t = 0.2;
      main.updateOfficeSmoke(0.05);
      const lunch = list.filter(p => p && p.officeSmoke && p.stop === 'phrom' && p.mesh && p.mesh.visible).length;
      const p0 = list[0];
      const z0 = p0 && p0.mesh ? p0.mesh.position.z : 0;
      const e0 = p0 && p0._ember && p0._ember.material ? p0._ember.material.emissiveIntensity : 0;
      if (c) c.t = 0.2 + Math.PI / 2.2;
      main.updateOfficeSmoke(0.05);
      const shifted = !!(p0 && p0.mesh && Math.abs(p0.mesh.position.z - z0) > 0.02);
      const glowed = !!(p0 && p0._ember && Math.abs(p0._ember.material.emissiveIntensity - e0) > 0.04);
      G.time.dayT = 16 / 24;
      main.updateOfficeSmoke(0.05);
      const afternoon = list.filter(p => p && p.mesh && p.mesh.visible === false).length;
      return {
        flag: !!(G.gameplay && G.gameplay.officeSmoke),
        n, cigs, embers, near, morning, lunch, shifted, glowed, afternoon,
        stop: c && c.stop,
      };
    });
    assert(phromSmoke.flag && phromSmoke.stop === 'phrom' && phromSmoke.n >= 3 && phromSmoke.cigs >= 3 && phromSmoke.embers >= 3 && phromSmoke.near >= 3, `office smokers wait north-west of Phrom Phong (${phromSmoke.n})`);
    assert(phromSmoke.morning >= 3 && phromSmoke.lunch >= 3 && phromSmoke.afternoon >= 3 && phromSmoke.shifted && phromSmoke.glowed, 'they only come out at lunch and the embers glow');

    console.log('\n[129] Tokyo Tech window shoppers');
    const tokyo = await page.evaluate(() => {
      const G = window.GAME, main = window.__REALISM_MAIN;
      const c = G.mallTech;
      const list = (c && c.lookers) || [];
      const n = list.filter(p => p && p.mallTech && p.mesh).length;
      const phones = list.filter(p => p && p.mesh && p.mesh.getObjectByName('mall-tech-phone')).length;
      const shop = G.world && G.world.mall && (G.world.mall.shops || []).find(s => s && s.name === 'Tokyo Tech');
      const near = !!(c && shop && shop.pos && Math.hypot(c.x - shop.pos.x, c.z - shop.pos.z) < 3);
      G.time.dayT = 22 / 24;
      main.updateMallTech(0.05);
      const night = list.filter(p => p && p.mesh && p.mesh.visible === false).length;
      G.time.dayT = 12.5 / 24;
      if (c) c.t = 0.2;
      main.updateMallTech(0.05);
      const day = list.filter(p => p && p.mallTech && p.mesh && p.mesh.visible).length;
      const p0 = list[0];
      const z0 = p0 && p0.mesh ? p0.mesh.position.z : 0;
      if (c) c.t = 0.2 + Math.PI / 2.1;
      main.updateMallTech(0.05);
      const shifted = !!(p0 && p0.mesh && Math.abs(p0.mesh.position.z - z0) > 0.02);
      const phone = p0 && p0.mesh && p0.mesh.getObjectByName('mall-tech-phone');
      if (c) c.t = 0.2;
      main.updateMallTech(0.05);
      const e0 = phone && phone.material ? phone.material.emissiveIntensity : 0;
      if (c) c.t = 0.2 + Math.PI / 4.4;
      main.updateMallTech(0.05);
      const glowed = !!(phone && Math.abs(phone.material.emissiveIntensity - e0) > 0.04);
      return {
        flag: !!(G.gameplay && G.gameplay.mallTech),
        n, phones, near, night, day, shifted, glowed,
      };
    });
    assert(tokyo.flag && tokyo.n >= 2 && tokyo.phones >= 2 && tokyo.near, `window shoppers wait at Tokyo Tech (${tokyo.n})`);
    assert(tokyo.night >= 2 && tokyo.day >= 2 && tokyo.shifted && tokyo.glowed, 'they hide after 21:00 and the phones glow');

    console.log('\n[130] Paris Pharmacy counter');
    const pharm = await page.evaluate(() => {
      const G = window.GAME, main = window.__REALISM_MAIN;
      const c = G.mallPharm;
      const clerk = c && c.clerk;
      const customer = c && c.customer;
      const bag = !!(customer && customer.mesh && customer.mesh.getObjectByName('mall-pharm-bag'));
      const shop = G.world && G.world.mall && (G.world.mall.shops || []).find(s => s && s.name === 'Paris Pharmacy');
      const near = !!(c && shop && shop.pos && Math.hypot(c.x - shop.pos.x, c.z - shop.pos.z) < 3);
      G.time.dayT = 22 / 24;
      main.updateMallPharm(0.05);
      const night = [clerk, customer].filter(p => p && p.mesh && p.mesh.visible === false).length;
      G.time.dayT = 12.5 / 24;
      if (c) c.t = 0.2;
      main.updateMallPharm(0.05);
      const day = [clerk, customer].filter(p => p && p.mallPharm && p.mesh && p.mesh.visible).length;
      const z0 = customer && customer.mesh ? customer.mesh.position.z : 0;
      if (c) c.t = 0.2 + Math.PI / 2.2;
      main.updateMallPharm(0.05);
      const shifted = !!(customer && customer.mesh && Math.abs(customer.mesh.position.z - z0) > 0.02);
      const pouch = customer && customer.mesh && customer.mesh.getObjectByName('mall-pharm-bag');
      if (c) c.t = 0.2;
      main.updateMallPharm(0.05);
      const r0 = pouch ? pouch.rotation.z : 0;
      if (c) c.t = 0.2 + Math.PI / 3.6;
      main.updateMallPharm(0.05);
      const swung = !!(pouch && Math.abs(pouch.rotation.z - r0) > 0.04);
      return {
        flag: !!(G.gameplay && G.gameplay.mallPharm),
        clerk: !!(clerk && clerk.mallPharm && clerk.pharmRole === 'clerk'),
        customer: !!(customer && customer.mallPharm && customer.pharmRole === 'customer'),
        bag, near, night, day, shifted, swung,
      };
    });
    assert(pharm.flag && pharm.clerk && pharm.customer && pharm.bag && pharm.near, 'a pharmacist waits at Paris Pharmacy');
    assert(pharm.night >= 2 && pharm.day >= 2 && pharm.shifted && pharm.swung, 'they hide after 21:00 and the bag swings');

    console.log('\n[131] Roma Boutique counter');
    const roma = await page.evaluate(() => {
      const G = window.GAME, main = window.__REALISM_MAIN;
      const c = G.mallRoma;
      const clerk = c && c.clerk;
      const customer = c && c.customer;
      const bag = !!(customer && customer.mesh && customer.mesh.getObjectByName('mall-roma-bag'));
      const shop = G.world && G.world.mall && (G.world.mall.shops || []).find(s => s && s.name === 'Roma Boutique');
      const near = !!(c && shop && shop.pos && Math.hypot(c.x - shop.pos.x, c.z - shop.pos.z) < 3);
      G.time.dayT = 22 / 24;
      main.updateMallRoma(0.05);
      const night = [clerk, customer].filter(p => p && p.mesh && p.mesh.visible === false).length;
      G.time.dayT = 12.5 / 24;
      if (c) c.t = 0.2;
      main.updateMallRoma(0.05);
      const day = [clerk, customer].filter(p => p && p.mallRoma && p.mesh && p.mesh.visible).length;
      const z0 = customer && customer.mesh ? customer.mesh.position.z : 0;
      if (c) c.t = 0.2 + Math.PI / 2.2;
      main.updateMallRoma(0.05);
      const shifted = !!(customer && customer.mesh && Math.abs(customer.mesh.position.z - z0) > 0.02);
      const pouch = customer && customer.mesh && customer.mesh.getObjectByName('mall-roma-bag');
      if (c) c.t = 0.2;
      main.updateMallRoma(0.05);
      const r0 = pouch ? pouch.rotation.z : 0;
      if (c) c.t = 0.2 + Math.PI / 3.6;
      main.updateMallRoma(0.05);
      const swung = !!(pouch && Math.abs(pouch.rotation.z - r0) > 0.04);
      return {
        flag: !!(G.gameplay && G.gameplay.mallRoma),
        clerk: !!(clerk && clerk.mallRoma && clerk.romaRole === 'clerk'),
        customer: !!(customer && customer.mallRoma && customer.romaRole === 'customer'),
        bag, near, night, day, shifted, swung,
      };
    });
    assert(roma.flag && roma.clerk && roma.customer && roma.bag && roma.near, 'a clerk waits at Roma Boutique');
    assert(roma.night >= 2 && roma.day >= 2 && roma.shifted && roma.swung, 'they hide after 21:00 and the bag swings');

    console.log('\n[132] Watch Boutique counter');
    const watch = await page.evaluate(() => {
      const G = window.GAME, main = window.__REALISM_MAIN;
      const c = G.mallWatch;
      const clerk = c && c.clerk;
      const customer = c && c.customer;
      const tray = !!(clerk && clerk.mesh && clerk.mesh.getObjectByName('mall-watch-tray'));
      const shop = G.world && G.world.mall && (G.world.mall.shops || []).find(s => s && s.name === 'Watch Boutique');
      const near = !!(c && shop && shop.pos && Math.hypot(c.x - shop.pos.x, c.z - shop.pos.z) < 3);
      const up = !!(clerk && clerk.mesh && clerk.mesh.position.y >= 8);
      G.time.dayT = 22 / 24;
      main.updateMallWatch(0.05);
      const night = [clerk, customer].filter(p => p && p.mesh && p.mesh.visible === false).length;
      G.time.dayT = 12.5 / 24;
      if (c) c.t = 0.2;
      main.updateMallWatch(0.05);
      const day = [clerk, customer].filter(p => p && p.mallWatch && p.mesh && p.mesh.visible && p.mesh.position.y >= 8).length;
      const z0 = customer && customer.mesh ? customer.mesh.position.z : 0;
      if (c) c.t = 0.2 + Math.PI / 2.2;
      main.updateMallWatch(0.05);
      const shifted = !!(customer && customer.mesh && Math.abs(customer.mesh.position.z - z0) > 0.02);
      const face = clerk && clerk.mesh && clerk.mesh.getObjectByName('mall-watch-face');
      if (c) c.t = 0.2;
      main.updateMallWatch(0.05);
      const r0 = face ? face.rotation.z : 0;
      if (c) c.t = 0.2 + Math.PI / 1.8;
      main.updateMallWatch(0.05);
      const spun = !!(face && Math.abs(face.rotation.z - r0) > 0.04);
      return {
        flag: !!(G.gameplay && G.gameplay.mallWatch),
        clerk: !!(clerk && clerk.mallWatch && clerk.watchRole === 'clerk'),
        customer: !!(customer && customer.mallWatch && customer.watchRole === 'customer'),
        tray, near, up, night, day, shifted, spun,
      };
    });
    assert(watch.flag && watch.clerk && watch.customer && watch.tray && watch.near && watch.up, 'a clerk waits at Watch Boutique');
    assert(watch.night >= 2 && watch.day >= 2 && watch.shifted && watch.spun, 'they hide after 21:00 on floor 2 and the watch face turns');

    console.log('\n[133] Manga Café readers');
    const manga = await page.evaluate(() => {
      const G = window.GAME, main = window.__REALISM_MAIN;
      const c = G.mallManga;
      const list = (c && c.readers) || [];
      const n = list.filter(p => p && p.mallManga && p.mesh).length;
      const books = list.filter(p => p && p.mesh && p.mesh.getObjectByName('mall-manga-book')).length;
      const shop = G.world && G.world.mall && (G.world.mall.shops || []).find(s => s && s.name === 'Manga Café');
      const near = !!(c && shop && shop.pos && Math.hypot(c.x - shop.pos.x, c.z - shop.pos.z) < 3);
      G.time.dayT = 22 / 24;
      main.updateMallManga(0.05);
      const night = list.filter(p => p && p.mesh && p.mesh.visible === false).length;
      G.time.dayT = 12.5 / 24;
      if (c) c.t = 0.2;
      main.updateMallManga(0.05);
      main.updatePeds(0.05);
      const day = list.filter(p => p && p.mallManga && p.mesh && p.mesh.visible && p.mesh.position.y >= 4.8).length;
      const folded = list.filter(p => {
        const parts = p && p.mesh && p.mesh.userData && p.mesh.userData.parts;
        return !!(parts && parts.legL && parts.legL.rotation.x > 0.8);
      }).length;
      const page = list[0] && list[0].mesh && list[0].mesh.getObjectByName('mall-manga-page');
      if (c) c.t = 0.2;
      main.updateMallManga(0.05);
      const r0 = page ? page.rotation.x : 0;
      if (c) c.t = 0.2 + Math.PI / 2.8;
      main.updateMallManga(0.05);
      const flipped = !!(page && Math.abs(page.rotation.x - r0) > 0.04);
      return {
        flag: !!(G.gameplay && G.gameplay.mallManga),
        n, books, near, night, day, folded, flipped,
      };
    });
    assert(manga.flag && manga.n >= 2 && manga.books >= 2 && manga.near, `readers sit Manga Café (${manga.n})`);
    assert(manga.night >= 2 && manga.day >= 2 && manga.folded >= 2 && manga.flipped, 'they hide after 21:00 and turn pages on floor 1');

    console.log('\n[134] Sushi Bar counter');
    const sushi = await page.evaluate(() => {
      const G = window.GAME, main = window.__REALISM_MAIN;
      const c = G.mallSushi;
      const chef = c && c.chef;
      const customer = c && c.customer;
      const plate = !!(chef && chef.mesh && chef.mesh.getObjectByName('mall-sushi-plate'));
      const shop = G.world && G.world.mall && (G.world.mall.shops || []).find(s => s && s.name === 'Sushi Bar');
      const near = !!(c && shop && shop.pos && Math.hypot(c.x - shop.pos.x, c.z - shop.pos.z) < 3);
      const up = !!(chef && chef.mesh && chef.mesh.position.y >= 4.8);
      G.time.dayT = 22 / 24;
      main.updateMallSushi(0.05);
      const night = [chef, customer].filter(p => p && p.mesh && p.mesh.visible === false).length;
      G.time.dayT = 12.5 / 24;
      if (c) c.t = 0.2;
      main.updateMallSushi(0.05);
      const day = [chef, customer].filter(p => p && p.mallSushi && p.mesh && p.mesh.visible && p.mesh.position.y >= 4.8).length;
      const z0 = customer && customer.mesh ? customer.mesh.position.z : 0;
      if (c) c.t = 0.2 + Math.PI / 2.2;
      main.updateMallSushi(0.05);
      const shifted = !!(customer && customer.mesh && Math.abs(customer.mesh.position.z - z0) > 0.02);
      const fish = chef && chef.mesh && chef.mesh.getObjectByName('mall-sushi-fish');
      if (c) c.t = 0.2;
      main.updateMallSushi(0.05);
      const r0 = fish ? fish.rotation.y : 0;
      if (c) c.t = 0.2 + Math.PI / 2.4;
      main.updateMallSushi(0.05);
      const spun = !!(fish && Math.abs(fish.rotation.y - r0) > 0.04);
      return {
        flag: !!(G.gameplay && G.gameplay.mallSushi),
        chef: !!(chef && chef.mallSushi && chef.sushiRole === 'chef'),
        customer: !!(customer && customer.mallSushi && customer.sushiRole === 'customer'),
        plate, near, up, night, day, shifted, spun,
      };
    });
    assert(sushi.flag && sushi.chef && sushi.customer && sushi.plate && sushi.near && sushi.up, 'a chef waits at Sushi Bar');
    assert(sushi.night >= 2 && sushi.day >= 2 && sushi.shifted && sushi.spun, 'they hide after 21:00 on floor 1 and the nigiri turns');

    console.log('\n[135] Le Café counter');
    const cafe = await page.evaluate(() => {
      const G = window.GAME, main = window.__REALISM_MAIN;
      const c = G.mallCafe;
      const clerk = c && c.clerk;
      const customer = c && c.customer;
      const cup = !!(clerk && clerk.mesh && clerk.mesh.getObjectByName('mall-cafe-cup'));
      const shop = G.world && G.world.mall && (G.world.mall.shops || []).find(s => s && s.name === 'Le Café');
      const near = !!(c && shop && shop.pos && Math.hypot(c.x - shop.pos.x, c.z - shop.pos.z) < 3);
      const up = !!(clerk && clerk.mesh && clerk.mesh.position.y >= 8);
      G.time.dayT = 22 / 24;
      main.updateMallCafe(0.05);
      const night = [clerk, customer].filter(p => p && p.mesh && p.mesh.visible === false).length;
      G.time.dayT = 12.5 / 24;
      if (c) c.t = 0.2;
      main.updateMallCafe(0.05);
      const day = [clerk, customer].filter(p => p && p.mallCafe && p.mesh && p.mesh.visible && p.mesh.position.y >= 8).length;
      const z0 = customer && customer.mesh ? customer.mesh.position.z : 0;
      if (c) c.t = 0.2 + Math.PI / 2.2;
      main.updateMallCafe(0.05);
      const shifted = !!(customer && customer.mesh && Math.abs(customer.mesh.position.z - z0) > 0.02);
      const steam = clerk && clerk.mesh && clerk.mesh.getObjectByName('mall-cafe-steam');
      if (c) c.t = 0.2;
      main.updateMallCafe(0.05);
      const s0 = steam ? steam.scale.y : 0;
      if (c) c.t = 0.2 + Math.PI / 3.2;
      main.updateMallCafe(0.05);
      const steamed = !!(steam && Math.abs(steam.scale.y - s0) > 0.04);
      return {
        flag: !!(G.gameplay && G.gameplay.mallCafe),
        clerk: !!(clerk && clerk.mallCafe && clerk.cafeRole === 'clerk'),
        customer: !!(customer && customer.mallCafe && customer.cafeRole === 'customer'),
        cup, near, up, night, day, shifted, steamed,
      };
    });
    assert(cafe.flag && cafe.clerk && cafe.customer && cafe.cup && cafe.near && cafe.up, 'a barista waits at Le Café');
    assert(cafe.night >= 2 && cafe.day >= 2 && cafe.shifted && cafe.steamed, 'they hide after 21:00 on floor 2 and the steam rises');

    console.log('\n[136] London Threads counter');
    const threads = await page.evaluate(() => {
      const G = window.GAME, main = window.__REALISM_MAIN;
      const c = G.mallThreads;
      const clerk = c && c.clerk;
      const customer = c && c.customer;
      const hanger = !!(clerk && clerk.mesh && clerk.mesh.getObjectByName('mall-threads-hanger'));
      const shop = G.world && G.world.mall && (G.world.mall.shops || []).find(s => s && s.name === 'London Threads');
      const near = !!(c && shop && shop.pos && Math.hypot(c.x - shop.pos.x, c.z - shop.pos.z) < 3);
      const up = !!(clerk && clerk.mesh && clerk.mesh.position.y >= 8);
      G.time.dayT = 22 / 24;
      main.updateMallThreads(0.05);
      const night = [clerk, customer].filter(p => p && p.mesh && p.mesh.visible === false).length;
      G.time.dayT = 12.5 / 24;
      if (c) c.t = 0.2;
      main.updateMallThreads(0.05);
      const day = [clerk, customer].filter(p => p && p.mallThreads && p.mesh && p.mesh.visible && p.mesh.position.y >= 8).length;
      const x0 = customer && customer.mesh ? customer.mesh.position.x : 0;
      if (c) c.t = 0.2 + Math.PI / 2.2;
      main.updateMallThreads(0.05);
      const shifted = !!(customer && customer.mesh && Math.abs(customer.mesh.position.x - x0) > 0.02);
      const shirt = clerk && clerk.mesh && clerk.mesh.getObjectByName('mall-threads-shirt');
      if (c) c.t = 0.2;
      main.updateMallThreads(0.05);
      const r0 = shirt ? shirt.rotation.z : 0;
      if (c) c.t = 0.2 + Math.PI / 2.6;
      main.updateMallThreads(0.05);
      const swung = !!(shirt && Math.abs(shirt.rotation.z - r0) > 0.04);
      return {
        flag: !!(G.gameplay && G.gameplay.mallThreads),
        clerk: !!(clerk && clerk.mallThreads && clerk.threadsRole === 'clerk'),
        customer: !!(customer && customer.mallThreads && customer.threadsRole === 'customer'),
        hanger, near, up, night, day, shifted, swung,
      };
    });
    assert(threads.flag && threads.clerk && threads.customer && threads.hanger && threads.near && threads.up, 'a clerk waits at London Threads');
    assert(threads.night >= 2 && threads.day >= 2 && threads.shifted && threads.swung, 'they hide after 21:00 on floor 2 and the shirt swings');

    console.log('\n[137] Terminal 21 7-Eleven counter');
    const mallSeven = await page.evaluate(() => {
      const G = window.GAME, main = window.__REALISM_MAIN;
      const c = G.mallSeven;
      const clerk = c && c.clerk;
      const customer = c && c.customer;
      const scan = !!(clerk && clerk.mesh && clerk.mesh.getObjectByName('mall-seven-scan'));
      const bag = !!(customer && customer.mesh && customer.mesh.getObjectByName('mall-seven-bag'));
      const shop = G.world && G.world.mall && (G.world.mall.shops || []).find(s => s && s.name === '7-Eleven');
      const near = !!(c && shop && shop.pos && Math.hypot(c.x - shop.pos.x, c.z - shop.pos.z) < 3);
      G.time.dayT = 22 / 24;
      main.updateMallSeven(0.05);
      const night = [clerk, customer].filter(p => p && p.mesh && p.mesh.visible === false).length;
      G.time.dayT = 12.5 / 24;
      if (c) c.t = 0.2;
      main.updateMallSeven(0.05);
      const day = [clerk, customer].filter(p => p && p.mallSeven && p.mesh && p.mesh.visible).length;
      const z0 = customer && customer.mesh ? customer.mesh.position.z : 0;
      if (c) c.t = 0.2 + Math.PI / 2.2;
      main.updateMallSeven(0.05);
      const shifted = !!(customer && customer.mesh && Math.abs(customer.mesh.position.z - z0) > 0.02);
      const gun = clerk && clerk.mesh && clerk.mesh.getObjectByName('mall-seven-scan');
      if (c) c.t = 0.2;
      main.updateMallSeven(0.05);
      const e0 = gun && gun.material ? gun.material.emissiveIntensity : 0;
      if (c) c.t = 0.2 + Math.PI / 4.4;
      main.updateMallSeven(0.05);
      const glowed = !!(gun && gun.material && Math.abs(gun.material.emissiveIntensity - e0) > 0.04);
      return {
        flag: !!(G.gameplay && G.gameplay.mallSeven),
        clerk: !!(clerk && clerk.mallSeven && clerk.sevenRole === 'clerk'),
        customer: !!(customer && customer.mallSeven && customer.sevenRole === 'customer'),
        scan, bag, near, night, day, shifted, glowed,
      };
    });
    assert(mallSeven.flag && mallSeven.clerk && mallSeven.customer && mallSeven.scan && mallSeven.bag && mallSeven.near, 'a clerk waits at the Terminal 21 7-Eleven');
    assert(mallSeven.night >= 2 && mallSeven.day >= 2 && mallSeven.shifted && mallSeven.glowed, 'they hide after 21:00 and the scanner glows');

    console.log('\n[138] Akihabara Arcade cabinets');
    const arcade = await page.evaluate(() => {
      const G = window.GAME, main = window.__REALISM_MAIN;
      const c = G.mallArcade;
      const list = (c && c.players) || [];
      const n = list.filter(p => p && p.mallArcade && p.mesh).length;
      const sticks = list.filter(p => p && p.mesh && p.mesh.getObjectByName('mall-arcade-stick')).length;
      const shop = G.world && G.world.mall && (G.world.mall.shops || []).find(s => s && s.name === 'Akihabara Arcade');
      const near = !!(c && shop && shop.pos && Math.hypot(c.x - shop.pos.x, c.z - shop.pos.z) < 3);
      G.time.dayT = 22 / 24;
      main.updateMallArcade(0.05);
      const night = list.filter(p => p && p.mesh && p.mesh.visible === false).length;
      G.time.dayT = 12.5 / 24;
      if (c) c.t = 0.2;
      main.updateMallArcade(0.05);
      const day = list.filter(p => p && p.mallArcade && p.mesh && p.mesh.visible && p.mesh.position.y >= 4.8).length;
      const p0 = list[0];
      const z0 = p0 && p0.mesh ? p0.mesh.position.z : 0;
      if (c) c.t = 0.2 + Math.PI / 2.1;
      main.updateMallArcade(0.05);
      const shifted = !!(p0 && p0.mesh && Math.abs(p0.mesh.position.z - z0) > 0.02);
      const ball = p0 && p0.mesh && p0.mesh.getObjectByName('mall-arcade-ball');
      if (c) c.t = 0.2;
      main.updateMallArcade(0.05);
      const e0 = ball && ball.material ? ball.material.emissiveIntensity : 0;
      if (c) c.t = 0.2 + Math.PI / 4.4;
      main.updateMallArcade(0.05);
      const glowed = !!(ball && ball.material && Math.abs(ball.material.emissiveIntensity - e0) > 0.04);
      return {
        flag: !!(G.gameplay && G.gameplay.mallArcade),
        n, sticks, near, night, day, shifted, glowed,
      };
    });
    assert(arcade.flag && arcade.n >= 2 && arcade.sticks >= 2 && arcade.near, `players work Akihabara Arcade (${arcade.n})`);
    assert(arcade.night >= 2 && arcade.day >= 2 && arcade.shifted && arcade.glowed, 'they hide after 21:00 on floor 1 and the sticks glow');

    console.log('\n[139] Muay Thai gym heavy bag');
    const gym = await page.evaluate(() => {
      const G = window.GAME, main = window.__REALISM_MAIN;
      const c = G.gymBag;
      const fighter = c && c.fighter;
      const trainer = c && c.trainer;
      const bag = !!(c && c.bag && c.bag.name === 'gym-heavy-bag');
      const poi = G.world && G.world.poi && G.world.poi.gym;
      const near = !!(c && poi && Math.hypot(c.x - poi.x, c.z - poi.z) < 4);
      G.time.dayT = 22 / 24;
      main.updateGymBag(0.05);
      const night = [fighter, trainer].filter(p => p && p.mesh && p.mesh.visible === false).length;
      G.time.dayT = 12.5 / 24;
      if (c) c.t = 0.2;
      main.updateGymBag(0.05);
      const day = [fighter, trainer].filter(p => p && p.gymBag && p.mesh && p.mesh.visible).length;
      const z0 = fighter && fighter.mesh ? fighter.mesh.position.z : 0;
      if (c) c.t = 0.2 + Math.PI / 2.2;
      main.updateGymBag(0.05);
      const shifted = !!(fighter && fighter.mesh && Math.abs(fighter.mesh.position.z - z0) > 0.02);
      if (c) c.t = 0.2;
      main.updateGymBag(0.05);
      const r0 = c && c.bag ? c.bag.rotation.z : 0;
      if (c) c.t = 0.2 + Math.PI / 3.4;
      main.updateGymBag(0.05);
      const swung = !!(c && c.bag && Math.abs(c.bag.rotation.z - r0) > 0.04);
      return {
        flag: !!(G.gameplay && G.gameplay.gymBag),
        fighter: !!(fighter && fighter.gymBag && fighter.gymRole === 'pad'),
        trainer: !!(trainer && trainer.gymBag && trainer.gymRole === 'watch'),
        bag, near, night, day, shifted, swung,
      };
    });
    assert(gym.flag && gym.fighter && gym.trainer && gym.bag && gym.near, 'a pad man waits at the Muay Thai gym');
    assert(gym.night >= 2 && gym.day >= 2 && gym.shifted && gym.swung, 'they hide after 21:00 and the bag swings');

    console.log('\n[140] phuang malai at Phrom Phong');
    const phromMalai = await page.evaluate(() => {
      const G = window.GAME, main = window.__REALISM_MAIN;
      const stand = G.phromMalai;
      const strands = stand && stand.mesh ? stand.mesh.children.filter(c => c && c.name === 'malai-strand').length : 0;
      const dist = (stand && stand.x != null) ? Math.hypot(stand.x - 100, stand.z) : null;
      if (stand) stand.t = 0.2;
      main.updateBtsMalai(0.05);
      const s0 = stand && stand.mesh && stand.mesh.children.find(c => c && c.name === 'malai-strand');
      const r0 = s0 ? s0.rotation.z : 0;
      if (stand) stand.t = 0.2 + Math.PI / 2.8;
      main.updateBtsMalai(0.05);
      const swayed = !!(s0 && Math.abs(s0.rotation.z - r0) > 0.02);
      G.player.inVehicle = null;
      G._btsRide = null;
      G._eating = null;
      G.player.group.visible = true;
      G._malai = false;
      G._malaiOffered = 0;
      if (stand) G.player.group.position.set(stand.x, 0, stand.z);
      G.cash = 80;
      window.dispatchEvent(new KeyboardEvent('keyup', { code: 'KeyE' }));
      if (G.input && G.input.endFrame) G.input.endFrame();
      let paid = false;
      for (let i = 0; i < 4 && !paid; i++) {
        window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyE' }));
        main.updateBtsMalai(0.016);
        window.dispatchEvent(new KeyboardEvent('keyup', { code: 'KeyE' }));
        if (G.input && G.input.endFrame) G.input.endFrame();
        paid = G.cash === 60 && G._malai === true;
      }
      const s = (G.world.shrines || [])[0];
      let offered = false, cooled = false;
      if (s && s.pos) {
        G.player.group.position.set(s.pos.x, 0, s.pos.z);
        G.wanted.stars = 2;
        G.wanted.lastSeenAt = performance.now() + 30000;
        s.readyAt = 1;
        const seen0 = G.wanted.lastSeenAt;
        window.dispatchEvent(new KeyboardEvent('keyup', { code: 'KeyE' }));
        if (G.input && G.input.endFrame) G.input.endFrame();
        for (let i = 0; i < 4 && !offered; i++) {
          window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyE' }));
          main.updateShrines(0.016);
          window.dispatchEvent(new KeyboardEvent('keyup', { code: 'KeyE' }));
          if (G.input && G.input.endFrame) G.input.endFrame();
          offered = (G._malaiOffered || 0) >= 1 && G._malai === false;
        }
        cooled = G.wanted.lastSeenAt < seen0 - 18000;
      }
      return {
        flag: !!(G.gameplay && G.gameplay.btsMalai),
        named: !!(stand && stand.mesh && stand.mesh.name === 'malai-stand'),
        stop: stand && stand.stop,
        strands, near: dist != null && dist < 28, paid, offered, cooled, swayed,
        vendor: !!(stand && stand.vendor && stand.vendor.btsMalai && stand.vendor.stop === 'phrom'),
      };
    });
    assert(phromMalai.flag && phromMalai.named && phromMalai.stop === 'phrom' && phromMalai.strands >= 4 && phromMalai.near && phromMalai.vendor, `a malai stand waits at Phrom Phong (${phromMalai.strands} strands)`);
    assert(phromMalai.swayed && phromMalai.paid && phromMalai.offered && phromMalai.cooled, 'E buys a malai at Phrom Phong and the shrine takes it for extra heat cool');

    console.log('\n[141] mango sticky rice at Phrom Phong');
    const phromMango = await page.evaluate(() => {
      const G = window.GAME, main = window.__REALISM_MAIN;
      const c = G.phromMango;
      const named = !!(c && c.mesh && c.mesh.name === 'mango-cart');
      const rice = !!(c && c.mesh && c.mesh.getObjectByName('sticky-rice'));
      const halves = c && c.mesh ? c.mesh.children.filter(ch => ch && ch.name === 'mango-half').length : 0;
      const cream = c && c.mesh && c.mesh.getObjectByName('coconut-cream');
      const dist = (c && c.x != null) ? Math.hypot(c.x - 100, c.z) : null;
      G.time.dayT = 12 / 24;
      if (c) c.t = 0.2;
      main.updateMangoSticky(0.05);
      const dayGlow = cream && cream.material ? cream.material.emissiveIntensity : 9;
      const dayVendor = !!(c && c.vendor && c.vendor.mesh && c.vendor.mesh.visible === false);
      G.time.dayT = 18.4 / 24;
      if (c) c.t = Math.PI / 16;
      main.updateMangoSticky(0.05);
      const duskGlow = cream && cream.material ? cream.material.emissiveIntensity : 0;
      const duskVendor = !!(c && c.vendor && c.vendor.mango && c.vendor.stop === 'phrom' && c.vendor.mesh && c.vendor.mesh.visible);
      G.player.inVehicle = null;
      G._eating = null;
      if (c && c.mesh) G.player.group.position.copy(c.mesh.position);
      G.cash = 120;
      G.player.hp = 40;
      G.player.stam = 10;
      G._mangoSticky = 0;
      window.dispatchEvent(new KeyboardEvent('keyup', { code: 'KeyE' }));
      if (G.input && G.input.endFrame) G.input.endFrame();
      let paid = false;
      for (let i = 0; i < 4 && !paid; i++) {
        window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyE' }));
        main.updateMangoSticky(0.016);
        window.dispatchEvent(new KeyboardEvent('keyup', { code: 'KeyE' }));
        if (G.input && G.input.endFrame) G.input.endFrame();
        paid = G.cash === 60 && (G._mangoSticky || 0) >= 1;
      }
      return {
        flag: !!(G.gameplay && G.gameplay.mangoSticky),
        named, rice, halves, stop: c && c.stop,
        near: dist != null && dist < 28,
        dayGlow, duskGlow, dayVendor, duskVendor, paid,
        hp: G.player.hp, stam: G.player.stam,
      };
    });
    assert(phromMango.flag && phromMango.named && phromMango.stop === 'phrom' && phromMango.rice && phromMango.halves >= 3 && phromMango.near, 'a mango sticky-rice cart waits at Phrom Phong');
    assert(phromMango.dayVendor && phromMango.duskVendor && phromMango.dayGlow < phromMango.duskGlow, 'the Phrom Phong vendor works evenings and the cream warms up');
    assert(phromMango.paid && phromMango.hp > 40 && phromMango.stam > 10, 'E buys mango sticky rice at Phrom Phong for ฿60');

    console.log('\n[142] Hua Lamphong starter gun clerk');
    const starter = await page.evaluate(() => {
      const G = window.GAME, main = window.__REALISM_MAIN;
      const c = G.starterClerk;
      const ped = c && c.ped;
      const cloth = !!(ped && ped.mesh && ped.mesh.getObjectByName('starter-gun-cloth'));
      const shop = (G.world && G.world.gunShops || []).find(s => s && s.id === 'starter');
      const near = !!(c && shop && shop.pos && Math.hypot(c.x - shop.pos.x, c.z - shop.pos.z) < 4);
      G.time.dayT = 22 / 24;
      main.updateStarterClerk(0.05);
      const night = !!(ped && ped.mesh && ped.mesh.visible === false);
      G.time.dayT = 12.5 / 24;
      if (c) c.t = 0.2;
      main.updateStarterClerk(0.05);
      const day = !!(ped && ped.starterClerk && ped.mesh && ped.mesh.visible);
      const rag = ped && ped.mesh && ped.mesh.getObjectByName('starter-gun-cloth');
      if (c) c.t = 0.2;
      main.updateStarterClerk(0.05);
      const r0 = rag ? rag.rotation.z : 0;
      if (c) c.t = 0.2 + Math.PI / 4.2;
      main.updateStarterClerk(0.05);
      const wiped = !!(rag && Math.abs(rag.rotation.z - r0) > 0.04);
      return {
        flag: !!(G.gameplay && G.gameplay.starterClerk),
        rec: !!(c && ped && ped.starterClerk),
        cloth, near, night, day, wiped,
      };
    });
    assert(starter.flag && starter.rec && starter.cloth && starter.near, 'a clerk waits behind the Hua Lamphong starter gun counter');
    assert(starter.night && starter.day && starter.wiped, 'they hide after hours and wipe the counter by day');

    console.log('\n[143] neighbor at the safehouse');
    const auntie = await page.evaluate(() => {
      const G = window.GAME, main = window.__REALISM_MAIN;
      const c = G.homeAuntie;
      const ped = c && c.ped;
      const paper = !!(ped && ped.mesh && ped.mesh.getObjectByName('home-paper'));
      const chair = !!(c && c.chair && c.chair.name === 'home-chair');
      const door = G.world && G.world.poi && G.world.poi.safehouse;
      const near = !!(c && door && Math.hypot(c.x - door.x, c.z - door.z) < 5);
      G.time.dayT = 23 / 24;
      main.updateHomeAuntie(0.05);
      const night = !!(ped && ped.mesh && ped.mesh.visible === false);
      G.time.dayT = 12.5 / 24;
      if (c) c.t = 0.2;
      main.updateHomeAuntie(0.05);
      main.updatePeds(0.05);
      const day = !!(ped && ped.homeAuntie && ped.mesh && ped.mesh.visible && ped.mesh.position.y >= 0.3);
      const parts = ped && ped.mesh && ped.mesh.userData && ped.mesh.userData.parts;
      const folded = !!(parts && parts.legL && parts.legL.rotation.x > 0.8);
      const page = ped && ped.mesh && ped.mesh.getObjectByName('home-paper-page');
      if (c) c.t = 0.2;
      main.updateHomeAuntie(0.05);
      const r0 = page ? page.rotation.x : 0;
      if (c) c.t = 0.2 + Math.PI / 2.8;
      main.updateHomeAuntie(0.05);
      const flipped = !!(page && Math.abs(page.rotation.x - r0) > 0.04);
      return {
        flag: !!(G.gameplay && G.gameplay.homeAuntie),
        rec: !!(ped && ped.homeAuntie),
        paper, chair, near, night, day, folded, flipped,
      };
    });
    assert(auntie.flag && auntie.rec && auntie.paper && auntie.chair && auntie.near, 'a neighbor sits beside the safehouse');
    assert(auntie.night && auntie.day && auntie.folded && auntie.flipped, 'they hide after 22:00 and turn pages on the plastic chair');

    console.log('\n[144] Hua Lamphong station porters');
    const porters = await page.evaluate(() => {
      const G = window.GAME, main = window.__REALISM_MAIN;
      const c = G.stationPorter;
      const list = (c && c.porters) || [];
      const n = list.filter(p => p && p.stationPorter && p.mesh).length;
      const bags = list.filter(p => p && p.mesh && p.mesh.getObjectByName('station-bag')).length;
      const spawn = G.world && G.world.spawns && G.world.spawns.player;
      const near = !!(c && spawn && Math.hypot(c.x - spawn.x, c.z - spawn.z) < 8);
      G.time.dayT = 23 / 24;
      main.updateStationPorter(0.05);
      const night = list.filter(p => p && p.mesh && p.mesh.visible === false).length;
      G.time.dayT = 12.5 / 24;
      if (c) c.t = 0.2;
      main.updateStationPorter(0.05);
      const day = list.filter(p => p && p.stationPorter && p.mesh && p.mesh.visible).length;
      const p0 = list[0];
      const x0 = p0 && p0.mesh ? p0.mesh.position.x : 0;
      if (c) c.t = 0.2 + Math.PI / 2.2;
      main.updateStationPorter(0.05);
      const shifted = !!(p0 && p0.mesh && Math.abs(p0.mesh.position.x - x0) > 0.02);
      const bag = p0 && p0.mesh && p0.mesh.getObjectByName('station-bag');
      if (c) c.t = 0.2;
      main.updateStationPorter(0.05);
      const r0 = bag ? bag.rotation.z : 0;
      if (c) c.t = 0.2 + Math.PI / 3.2;
      main.updateStationPorter(0.05);
      const swung = !!(bag && Math.abs(bag.rotation.z - r0) > 0.04);
      return {
        flag: !!(G.gameplay && G.gameplay.stationPorter),
        n, bags, near, night, day, shifted, swung,
      };
    });
    assert(porters.flag && porters.n >= 2 && porters.bags >= 2 && porters.near, `porters wait under the Hua Lamphong canopy (${porters.n})`);
    assert(porters.night >= 2 && porters.day >= 2 && porters.shifted && porters.swung, 'they hide after 22:00 and the bags swing');

    console.log('\n[145] U-Spray garage mechanic');
    const mech = await page.evaluate(() => {
      const G = window.GAME, main = window.__REALISM_MAIN;
      const c = G.garageMech;
      const ped = c && c.ped;
      const wrench = !!(ped && ped.mesh && ped.mesh.getObjectByName('garage-wrench'));
      const g = G.world && G.world.garages && G.world.garages[0];
      const near = !!(c && g && g.pos && Math.hypot(c.x - g.pos.x, c.z - g.pos.z) < 8);
      G.time.dayT = 21 / 24;
      main.updateGarageMech(0.05);
      const night = !!(ped && ped.mesh && ped.mesh.visible === false);
      G.time.dayT = 12.5 / 24;
      if (c) c.t = 0.2;
      main.updateGarageMech(0.05);
      const day = !!(ped && ped.garageMech && ped.mesh && ped.mesh.visible);
      const z0 = ped && ped.mesh ? ped.mesh.position.z : 0;
      if (c) c.t = 0.2 + Math.PI / 2.2;
      main.updateGarageMech(0.05);
      const shifted = !!(ped && ped.mesh && Math.abs(ped.mesh.position.z - z0) > 0.02);
      const tool = ped && ped.mesh && ped.mesh.getObjectByName('garage-wrench');
      if (c) c.t = 0.2;
      main.updateGarageMech(0.05);
      const r0 = tool ? tool.rotation.z : 0;
      if (c) c.t = 0.2 + Math.PI / 4.2;
      main.updateGarageMech(0.05);
      const swung = !!(tool && Math.abs(tool.rotation.z - r0) > 0.04);
      return {
        flag: !!(G.gameplay && G.gameplay.garageMech),
        rec: !!(ped && ped.garageMech),
        wrench, near, night, day, shifted, swung,
      };
    });
    assert(mech.flag && mech.rec && mech.wrench && mech.near, 'a mechanic waits at the U-Spray bay');
    assert(mech.night && mech.day && mech.shifted && mech.swung, 'they hide after 19:00 and the wrench turns');

    console.log('\n[146] Klong Toey dockhands');
    const dock = await page.evaluate(() => {
      const G = window.GAME, main = window.__REALISM_MAIN;
      const c = G.klongDock;
      const list = (c && c.hands) || [];
      const n = list.filter(p => p && p.klongDock && p.mesh).length;
      const crates = list.filter(p => p && p.mesh && p.mesh.getObjectByName('dock-crate')).length;
      const poi = G.world && G.world.poi && G.world.poi.klongToey;
      const near = !!(c && poi && Math.hypot(c.x - poi.x, c.z - poi.z) < 8);
      G.time.dayT = 21 / 24;
      main.updateKlongDock(0.05);
      const night = list.filter(p => p && p.mesh && p.mesh.visible === false).length;
      G.time.dayT = 12.5 / 24;
      if (c) c.t = 0.2;
      main.updateKlongDock(0.05);
      const day = list.filter(p => p && p.klongDock && p.mesh && p.mesh.visible).length;
      const p0 = list[0];
      const x0 = p0 && p0.mesh ? p0.mesh.position.x : 0;
      if (c) c.t = 0.2 + Math.PI / 2.2;
      main.updateKlongDock(0.05);
      const shifted = !!(p0 && p0.mesh && Math.abs(p0.mesh.position.x - x0) > 0.02);
      const crate = p0 && p0.mesh && p0.mesh.getObjectByName('dock-crate');
      if (c) c.t = 0.2;
      main.updateKlongDock(0.05);
      const r0 = crate ? crate.rotation.z : 0;
      if (c) c.t = 0.2 + Math.PI / 3.4;
      main.updateKlongDock(0.05);
      const swung = !!(crate && Math.abs(crate.rotation.z - r0) > 0.04);
      return {
        flag: !!(G.gameplay && G.gameplay.klongDock),
        n, crates, near, night, day, shifted, swung,
      };
    });
    assert(dock.flag && dock.n >= 2 && dock.crates >= 2 && dock.near, `dockhands wait at the Klong Toey yard (${dock.n})`);
    assert(dock.night >= 2 && dock.day >= 2 && dock.shifted && dock.swung, 'they hide after 19:00 and the crates tilt');

    console.log('\n[147] Uncle Seng gold-shop clerk');
    const seng = await page.evaluate(() => {
      const G = window.GAME, main = window.__REALISM_MAIN;
      const c = G.sengClerk;
      const ped = c && c.ped;
      const tray = !!(ped && ped.mesh && ped.mesh.getObjectByName('seng-tray'));
      const poi = G.world && G.world.poi && G.world.poi.goldShop;
      const near = !!(c && poi && Math.hypot(c.x - poi.x, c.z - poi.z) < 8);
      G.time.dayT = 21 / 24;
      main.updateSengClerk(0.05);
      const night = !!(ped && ped.mesh && ped.mesh.visible === false);
      G.time.dayT = 12.5 / 24;
      if (c) c.t = 0.2;
      main.updateSengClerk(0.05);
      const day = !!(ped && ped.sengClerk && ped.mesh && ped.mesh.visible);
      const z0 = ped && ped.mesh ? ped.mesh.position.z : 0;
      if (c) c.t = 0.2 + Math.PI / 2.2;
      main.updateSengClerk(0.05);
      const shifted = !!(ped && ped.mesh && Math.abs(ped.mesh.position.z - z0) > 0.02);
      const tool = ped && ped.mesh && ped.mesh.getObjectByName('seng-tray');
      if (c) c.t = 0.2;
      main.updateSengClerk(0.05);
      const r0 = tool ? tool.rotation.z : 0;
      if (c) c.t = 0.2 + Math.PI / 4.2;
      main.updateSengClerk(0.05);
      const swung = !!(tool && Math.abs(tool.rotation.z - r0) > 0.04);
      return {
        flag: !!(G.gameplay && G.gameplay.sengClerk),
        rec: !!(ped && ped.sengClerk),
        tray, near, night, day, shifted, swung,
      };
    });
    assert(seng.flag && seng.rec && seng.tray && seng.near, "a clerk waits at Uncle Seng's gold-shop door");
    assert(seng.night && seng.day && seng.shifted && seng.swung, 'they hide after 20:00 and the gold tray turns');

    console.log('\n[148] Suvarnabhumi apron marshallers');
    const crew = await page.evaluate(() => {
      const G = window.GAME, main = window.__REALISM_MAIN;
      const c = G.airportCrew;
      const list = (c && c.hands) || [];
      const n = list.filter(p => p && p.airportCrew && p.mesh).length;
      const paddles = list.filter(p => p && p.mesh && p.mesh.getObjectByName('marshal-paddle')).length;
      const poi = G.world && G.world.poi && G.world.poi.suvarnabhumi;
      const near = !!(c && poi && Math.hypot(c.x - poi.x, c.z - poi.z) < 8);
      G.time.dayT = 22 / 24;
      main.updateAirportCrew(0.05);
      const night = list.filter(p => p && p.mesh && p.mesh.visible === false).length;
      G.time.dayT = 12.5 / 24;
      if (c) c.t = 0.2;
      main.updateAirportCrew(0.05);
      const day = list.filter(p => p && p.airportCrew && p.mesh && p.mesh.visible).length;
      const p0 = list[0];
      const x0 = p0 && p0.mesh ? p0.mesh.position.x : 0;
      if (c) c.t = 0.2 + Math.PI / 2.2;
      main.updateAirportCrew(0.05);
      const shifted = !!(p0 && p0.mesh && Math.abs(p0.mesh.position.x - x0) > 0.02);
      const paddle = p0 && p0.mesh && p0.mesh.getObjectByName('marshal-paddle');
      if (c) c.t = 0.2;
      main.updateAirportCrew(0.05);
      const r0 = paddle ? paddle.rotation.z : 0;
      if (c) c.t = 0.2 + Math.PI / 3.6;
      main.updateAirportCrew(0.05);
      const swung = !!(paddle && Math.abs(paddle.rotation.z - r0) > 0.04);
      return {
        flag: !!(G.gameplay && G.gameplay.airportCrew),
        n, paddles, near, night, day, shifted, swung,
      };
    });
    assert(crew.flag && crew.n >= 2 && crew.paddles >= 2 && crew.near, `marshallers wait on the Suvarnabhumi apron (${crew.n})`);
    assert(crew.night >= 2 && crew.day >= 2 && crew.shifted && crew.swung, 'they hide after 21:00 and the paddles wave');

    console.log('\n[149] Suvarnabhumi cargo shed');
    const cargo = await page.evaluate(() => {
      const G = window.GAME, main = window.__REALISM_MAIN;
      const c = G.airportCargo;
      const list = (c && c.hands) || [];
      const n = list.filter(p => p && p.airportCargo && p.mesh).length;
      const crates = list.filter(p => p && p.mesh && p.mesh.getObjectByName('cargo-crate')).length;
      const near = !!(c && Math.hypot(c.x - 209, c.z + 118) < 8);
      G.time.dayT = 21 / 24;
      main.updateAirportCargo(0.05);
      const night = list.filter(p => p && p.mesh && p.mesh.visible === false).length;
      G.time.dayT = 12.5 / 24;
      if (c) c.t = 0.2;
      main.updateAirportCargo(0.05);
      const day = list.filter(p => p && p.airportCargo && p.mesh && p.mesh.visible).length;
      const p0 = list[0];
      const x0 = p0 && p0.mesh ? p0.mesh.position.x : 0;
      if (c) c.t = 0.2 + Math.PI / 2.2;
      main.updateAirportCargo(0.05);
      const shifted = !!(p0 && p0.mesh && Math.abs(p0.mesh.position.x - x0) > 0.02);
      const crate = p0 && p0.mesh && p0.mesh.getObjectByName('cargo-crate');
      if (c) c.t = 0.2;
      main.updateAirportCargo(0.05);
      const r0 = crate ? crate.rotation.z : 0;
      if (c) c.t = 0.2 + Math.PI / 3.4;
      main.updateAirportCargo(0.05);
      const swung = !!(crate && Math.abs(crate.rotation.z - r0) > 0.04);
      return {
        flag: !!(G.gameplay && G.gameplay.airportCargo),
        n, crates, near, night, day, shifted, swung,
      };
    });
    assert(cargo.flag && cargo.n >= 2 && cargo.crates >= 2 && cargo.near, `cargo hands wait at the south Suvarnabhumi shed (${cargo.n})`);
    assert(cargo.night >= 2 && cargo.day >= 2 && cargo.shifted && cargo.swung, 'they hide after 19:00 and the crates tilt');

    console.log('\n[150] south 7-Eleven security guard');
    const southBooth = await page.evaluate(() => {
      const G = window.GAME, main = window.__REALISM_MAIN;
      const g = G.southSevenGuard;
      const walk = G.world && (G.world.sevenWalkIn || (G.world.sevenElevens && G.world.sevenElevens[0]));
      const south = (G.world.sevenElevens || []).find(s => s && s.pos && Math.abs(s.pos.x) < 8 && s.pos.z < -80);
      main.updatePeds(0.05);
      main.updateSevenGuard(0.05);
      const ped = g && g.ped;
      const seated = !!(ped && ped.sevenGuard && ped.mesh && ped.mesh.position.y >= 0.3);
      const chair = !!(g && g.chair && g.chair.name === 'south-seven-chair');
      const near = !!(south && south.pos && ped && ped.mesh && Math.hypot(ped.mesh.position.x - south.pos.x, ped.mesh.position.z - south.pos.z) < 10);
      const farWalk = !!(walk && walk.pos && ped && ped.mesh && Math.hypot(ped.mesh.position.x - walk.pos.x, ped.mesh.position.z - walk.pos.z) > 80);
      const torch = !!(ped && ped.mesh && ped.mesh.getObjectByName('flashlight'));
      G.time.dayT = 12 / 24;
      main.updateSevenGuard(0.05);
      const dayOff = !!(g && g.beam && g.beam.visible === false && g.light && g.light.intensity === 0);
      G.time.dayT = 21.5 / 24;
      main.updateSevenGuard(0.05);
      const nightOn = !!(g && g.beam && g.beam.visible && g.light && g.light.intensity > 0.4);
      return {
        flag: !!(G.gameplay && G.gameplay.sevenGuard),
        rec: !!(g && ped && ped.sevenGuard),
        seated, chair, near, farWalk, torch, dayOff, nightOn,
      };
    });
    assert(southBooth.flag && southBooth.rec && southBooth.seated && southBooth.chair && southBooth.near && southBooth.farWalk, 'a guard sits outside the south 7-Eleven');
    assert(southBooth.torch && southBooth.dayOff && southBooth.nightOn, 'the south guard torch only comes on at night');

    console.log('\n[151] Suvarnabhumi tower controller');
    const tower = await page.evaluate(() => {
      const G = window.GAME, main = window.__REALISM_MAIN;
      const c = G.towerCtl;
      const ped = c && c.ped;
      const binocs = !!(ped && ped.mesh && ped.mesh.getObjectByName('tower-binocs'));
      const poi = G.world && G.world.poi && G.world.poi.airportTower;
      const near = !!(c && poi && Math.hypot(c.x - poi.x, c.z - poi.z) < 8);
      G.time.dayT = 23 / 24;
      main.updateAirportTower(0.05);
      const night = !!(ped && ped.mesh && ped.mesh.visible === false);
      G.time.dayT = 12.5 / 24;
      if (c) c.t = 0.2;
      main.updateAirportTower(0.05);
      const day = !!(ped && ped.airportTower && ped.mesh && ped.mesh.visible);
      const z0 = ped && ped.mesh ? ped.mesh.position.z : 0;
      if (c) c.t = 0.2 + Math.PI / 2.2;
      main.updateAirportTower(0.05);
      const shifted = !!(ped && ped.mesh && Math.abs(ped.mesh.position.z - z0) > 0.02);
      const tool = ped && ped.mesh && ped.mesh.getObjectByName('tower-binocs');
      if (c) c.t = 0.2;
      main.updateAirportTower(0.05);
      const r0 = tool ? tool.rotation.x : 0;
      if (c) c.t = 0.2 + Math.PI / 3.2;
      main.updateAirportTower(0.05);
      const swung = !!(tool && Math.abs(tool.rotation.x - r0) > 0.04);
      return {
        flag: !!(G.gameplay && G.gameplay.airportTower),
        rec: !!(ped && ped.airportTower),
        binocs, near, night, day, shifted, swung,
      };
    });
    assert(tower.flag && tower.rec && tower.binocs && tower.near, 'a controller waits at the Suvarnabhumi tower');
    assert(tower.night && tower.day && tower.shifted && tower.swung, 'they hide after 22:00 and the binoculars tilt');

    console.log('\n[152] west 7-Eleven security guard');
    const westBooth = await page.evaluate(() => {
      const G = window.GAME, main = window.__REALISM_MAIN;
      const g = G.westSevenGuard;
      const walk = G.world && (G.world.sevenWalkIn || (G.world.sevenElevens && G.world.sevenElevens[0]));
      const west = (G.world.sevenElevens || []).find(s => s && s.pos && s.pos.x < -50 && s.pos.z > 0 && s.pos.z < 60);
      main.updatePeds(0.05);
      main.updateSevenGuard(0.05);
      const ped = g && g.ped;
      const seated = !!(ped && ped.sevenGuard && ped.mesh && ped.mesh.position.y >= 0.3);
      const chair = !!(g && g.chair && g.chair.name === 'west-seven-chair');
      const near = !!(west && west.pos && ped && ped.mesh && Math.hypot(ped.mesh.position.x - west.pos.x, ped.mesh.position.z - west.pos.z) < 10);
      const farWalk = !!(walk && walk.pos && ped && ped.mesh && Math.hypot(ped.mesh.position.x - walk.pos.x, ped.mesh.position.z - walk.pos.z) > 80);
      const torch = !!(ped && ped.mesh && ped.mesh.getObjectByName('flashlight'));
      G.time.dayT = 12 / 24;
      main.updateSevenGuard(0.05);
      const dayOff = !!(g && g.beam && g.beam.visible === false && g.light && g.light.intensity === 0);
      G.time.dayT = 21.5 / 24;
      main.updateSevenGuard(0.05);
      const nightOn = !!(g && g.beam && g.beam.visible && g.light && g.light.intensity > 0.4);
      return {
        flag: !!(G.gameplay && G.gameplay.sevenGuard),
        rec: !!(g && ped && ped.sevenGuard),
        seated, chair, near, farWalk, torch, dayOff, nightOn,
      };
    });
    assert(westBooth.flag && westBooth.rec && westBooth.seated && westBooth.chair && westBooth.near && westBooth.farWalk, 'a guard sits outside the west 7-Eleven');
    assert(westBooth.torch && westBooth.dayOff && westBooth.nightOn, 'the west guard torch only comes on at night');

    console.log('\n[153] east 7-Eleven security guard');
    const eastBooth = await page.evaluate(() => {
      const G = window.GAME, main = window.__REALISM_MAIN;
      const g = G.eastSevenGuard;
      const walk = G.world && (G.world.sevenWalkIn || (G.world.sevenElevens && G.world.sevenElevens[0]));
      const east = (G.world.sevenElevens || []).find(s => s && s.pos && s.pos.x > 100 && s.pos.z < 0 && s.pos.z > -80);
      main.updatePeds(0.05);
      main.updateSevenGuard(0.05);
      const ped = g && g.ped;
      const seated = !!(ped && ped.sevenGuard && ped.mesh && ped.mesh.position.y >= 0.3);
      const chair = !!(g && g.chair && g.chair.name === 'east-seven-chair');
      const near = !!(east && east.pos && ped && ped.mesh && Math.hypot(ped.mesh.position.x - east.pos.x, ped.mesh.position.z - east.pos.z) < 10);
      const farWalk = !!(walk && walk.pos && ped && ped.mesh && Math.hypot(ped.mesh.position.x - walk.pos.x, ped.mesh.position.z - walk.pos.z) > 80);
      const torch = !!(ped && ped.mesh && ped.mesh.getObjectByName('flashlight'));
      G.time.dayT = 12 / 24;
      main.updateSevenGuard(0.05);
      const dayOff = !!(g && g.beam && g.beam.visible === false && g.light && g.light.intensity === 0);
      G.time.dayT = 21.5 / 24;
      main.updateSevenGuard(0.05);
      const nightOn = !!(g && g.beam && g.beam.visible && g.light && g.light.intensity > 0.4);
      return {
        flag: !!(G.gameplay && G.gameplay.sevenGuard),
        rec: !!(g && ped && ped.sevenGuard),
        seated, chair, near, farWalk, torch, dayOff, nightOn,
      };
    });
    assert(eastBooth.flag && eastBooth.rec && eastBooth.seated && eastBooth.chair && eastBooth.near && eastBooth.farWalk, 'a guard sits outside the east 7-Eleven');
    assert(eastBooth.torch && eastBooth.dayOff && eastBooth.nightOn, 'the east guard torch only comes on at night');

    console.log('\n[154] Suvarnabhumi taxi touts');
    const taxi = await page.evaluate(() => {
      const G = window.GAME, main = window.__REALISM_MAIN;
      const c = G.airportTaxi;
      const list = (c && c.touts) || [];
      const n = list.filter(p => p && p.airportTaxi && p.mesh).length;
      const slates = list.filter(p => p && p.mesh && p.mesh.getObjectByName('taxi-slate')).length;
      const near = !!(c && Math.hypot(c.x - 209, c.z - 50) < 8);
      G.time.dayT = 23 / 24;
      main.updateAirportTaxi(0.05);
      const night = list.filter(p => p && p.mesh && p.mesh.visible === false).length;
      G.time.dayT = 12.5 / 24;
      if (c) c.t = 0.2;
      main.updateAirportTaxi(0.05);
      const day = list.filter(p => p && p.airportTaxi && p.mesh && p.mesh.visible).length;
      const p0 = list[0];
      const x0 = p0 && p0.mesh ? p0.mesh.position.x : 0;
      if (c) c.t = 0.2 + Math.PI / 2.2;
      main.updateAirportTaxi(0.05);
      const shifted = !!(p0 && p0.mesh && Math.abs(p0.mesh.position.x - x0) > 0.02);
      const slate = p0 && p0.mesh && p0.mesh.getObjectByName('taxi-slate');
      if (c) c.t = 0.2;
      main.updateAirportTaxi(0.05);
      const r0 = slate ? slate.rotation.z : 0;
      if (c) c.t = 0.2 + Math.PI / 3.4;
      main.updateAirportTaxi(0.05);
      const swung = !!(slate && Math.abs(slate.rotation.z - r0) > 0.04);
      return {
        flag: !!(G.gameplay && G.gameplay.airportTaxi),
        n, slates, near, night, day, shifted, swung,
      };
    });
    assert(taxi.flag && taxi.n >= 2 && taxi.slates >= 2 && taxi.near, `taxi touts wait at the north Suvarnabhumi curb (${taxi.n})`);
    assert(taxi.night >= 2 && taxi.day >= 2 && taxi.shifted && taxi.swung, 'they hide after 22:00 and the slates tilt');

    console.log('\n[155] south 7-Eleven parked bikes');
    const southRack = await page.evaluate(() => {
      const G = window.GAME, main = window.__REALISM_MAIN;
      const walk = G.world && (G.world.sevenWalkIn || (G.world.sevenElevens && G.world.sevenElevens[0]));
      const south = (G.world.sevenElevens || []).find(s => s && s.pos && Math.abs(s.pos.x) < 8 && s.pos.z < -80);
      const list = G.southSevenBikes || [];
      const n = list.filter(v => v && v.spec && v.spec.kind === 'bike' && v.sevenParked).length;
      const pinned = list.filter(v => v && v._standHome && v.driver !== 'player').length;
      let near = 0, farWalk = 0;
      for (const v of list) {
        if (!v || !v.pos) continue;
        if (south && south.pos && Math.hypot(v.pos.x - south.pos.x, v.pos.z - south.pos.z) < 12) near++;
        if (walk && walk.pos && Math.hypot(v.pos.x - walk.pos.x, v.pos.z - walk.pos.z) > 80) farWalk++;
      }
      const open = list.filter(v => v && v.driver == null).length;
      const covers = list.filter(b => b && b.mesh && b.mesh.getObjectByName('seat-cover'));
      const cover = covers[0] && covers[0].mesh.getObjectByName('seat-cover');
      if (covers[0]) covers[0].driver = null;
      G.time.rainStrength = 0;
      main.updateBikeSeatCover(0.05);
      const dry = !!(cover && cover.visible === false);
      G.time.rainStrength = 0.85;
      main.updateBikeSeatCover(0.05);
      const wet = !!(cover && cover.visible === true);
      if (covers[0]) covers[0].driver = 'player';
      main.updateBikeSeatCover(0.05);
      const taken = !!(cover && cover.visible === false);
      if (covers[0]) covers[0].driver = null;
      return {
        flag: !!(G.gameplay && G.gameplay.sevenBikes),
        n, pinned, near, farWalk, open, covers: covers.length, dry, wet, taken,
      };
    });
    assert(southRack.flag && southRack.n >= 4 && southRack.near >= 4 && southRack.farWalk >= 4, `bikes cluster outside the south 7-Eleven (${southRack.n})`);
    assert(southRack.pinned >= 4 && southRack.open >= 4 && southRack.covers >= 4 && southRack.dry && southRack.wet && southRack.taken, 'the south rack is pinned, enterable, and the covers come out in the rain');

    console.log('\n[156] west 7-Eleven parked bikes');
    const westRack = await page.evaluate(() => {
      const G = window.GAME, main = window.__REALISM_MAIN;
      const walk = G.world && (G.world.sevenWalkIn || (G.world.sevenElevens && G.world.sevenElevens[0]));
      const west = (G.world.sevenElevens || []).find(s => s && s.pos && s.pos.x < -50 && s.pos.z > 0 && s.pos.z < 60);
      const list = G.westSevenBikes || [];
      const n = list.filter(v => v && v.spec && v.spec.kind === 'bike' && v.sevenParked).length;
      const pinned = list.filter(v => v && v._standHome && v.driver !== 'player').length;
      let near = 0, farWalk = 0;
      for (const v of list) {
        if (!v || !v.pos) continue;
        if (west && west.pos && Math.hypot(v.pos.x - west.pos.x, v.pos.z - west.pos.z) < 12) near++;
        if (walk && walk.pos && Math.hypot(v.pos.x - walk.pos.x, v.pos.z - walk.pos.z) > 80) farWalk++;
      }
      const open = list.filter(v => v && v.driver == null).length;
      const covers = list.filter(b => b && b.mesh && b.mesh.getObjectByName('seat-cover'));
      const cover = covers[0] && covers[0].mesh.getObjectByName('seat-cover');
      if (covers[0]) covers[0].driver = null;
      G.time.rainStrength = 0;
      main.updateBikeSeatCover(0.05);
      const dry = !!(cover && cover.visible === false);
      G.time.rainStrength = 0.85;
      main.updateBikeSeatCover(0.05);
      const wet = !!(cover && cover.visible === true);
      if (covers[0]) covers[0].driver = 'player';
      main.updateBikeSeatCover(0.05);
      const taken = !!(cover && cover.visible === false);
      if (covers[0]) covers[0].driver = null;
      return {
        flag: !!(G.gameplay && G.gameplay.sevenBikes),
        n, pinned, near, farWalk, open, covers: covers.length, dry, wet, taken,
      };
    });
    assert(westRack.flag && westRack.n >= 4 && westRack.near >= 4 && westRack.farWalk >= 4, `bikes cluster outside the west 7-Eleven (${westRack.n})`);
    assert(westRack.pinned >= 4 && westRack.open >= 4 && westRack.covers >= 4 && westRack.dry && westRack.wet && westRack.taken, 'the west rack is pinned, enterable, and the covers come out in the rain');

    console.log('\n[157] east 7-Eleven parked bikes');
    const eastRack = await page.evaluate(() => {
      const G = window.GAME, main = window.__REALISM_MAIN;
      const walk = G.world && (G.world.sevenWalkIn || (G.world.sevenElevens && G.world.sevenElevens[0]));
      const east = (G.world.sevenElevens || []).find(s => s && s.pos && s.pos.x > 100 && s.pos.z < 0 && s.pos.z > -80);
      const list = G.eastSevenBikes || [];
      const n = list.filter(v => v && v.spec && v.spec.kind === 'bike' && v.sevenParked).length;
      const pinned = list.filter(v => v && v._standHome && v.driver !== 'player').length;
      let near = 0, farWalk = 0;
      for (const v of list) {
        if (!v || !v.pos) continue;
        if (east && east.pos && Math.hypot(v.pos.x - east.pos.x, v.pos.z - east.pos.z) < 12) near++;
        if (walk && walk.pos && Math.hypot(v.pos.x - walk.pos.x, v.pos.z - walk.pos.z) > 80) farWalk++;
      }
      const open = list.filter(v => v && v.driver == null).length;
      const covers = list.filter(b => b && b.mesh && b.mesh.getObjectByName('seat-cover'));
      const cover = covers[0] && covers[0].mesh.getObjectByName('seat-cover');
      if (covers[0]) covers[0].driver = null;
      G.time.rainStrength = 0;
      main.updateBikeSeatCover(0.05);
      const dry = !!(cover && cover.visible === false);
      G.time.rainStrength = 0.85;
      main.updateBikeSeatCover(0.05);
      const wet = !!(cover && cover.visible === true);
      if (covers[0]) covers[0].driver = 'player';
      main.updateBikeSeatCover(0.05);
      const taken = !!(cover && cover.visible === false);
      if (covers[0]) covers[0].driver = null;
      return {
        flag: !!(G.gameplay && G.gameplay.sevenBikes),
        n, pinned, near, farWalk, open, covers: covers.length, dry, wet, taken,
      };
    });
    assert(eastRack.flag && eastRack.n >= 4 && eastRack.near >= 4 && eastRack.farWalk >= 4, `bikes cluster outside the east 7-Eleven (${eastRack.n})`);
    assert(eastRack.pinned >= 4 && eastRack.open >= 4 && eastRack.covers >= 4 && eastRack.dry && eastRack.wet && eastRack.taken, 'the east rack is pinned, enterable, and the covers come out in the rain');

    console.log('\n[158] south Suvarnabhumi taxi touts');
    const southTaxi = await page.evaluate(() => {
      const G = window.GAME, main = window.__REALISM_MAIN;
      const c = G.southAirportTaxi;
      const list = (c && c.touts) || [];
      const n = list.filter(p => p && p.airportTaxi && p.mesh).length;
      const slates = list.filter(p => p && p.mesh && p.mesh.getObjectByName('taxi-slate')).length;
      const near = !!(c && Math.hypot(c.x - 209, c.z + 50) < 8);
      const farNorth = !!(c && Math.hypot(c.x - 209, c.z - 50) > 80);
      G.time.dayT = 23 / 24;
      main.updateAirportTaxi(0.05);
      const night = list.filter(p => p && p.mesh && p.mesh.visible === false).length;
      G.time.dayT = 12.5 / 24;
      if (c) c.t = 0.2;
      main.updateAirportTaxi(0.05);
      const day = list.filter(p => p && p.airportTaxi && p.mesh && p.mesh.visible).length;
      const p0 = list[0];
      const x0 = p0 && p0.mesh ? p0.mesh.position.x : 0;
      if (c) c.t = 0.2 + Math.PI / 2.2;
      main.updateAirportTaxi(0.05);
      const shifted = !!(p0 && p0.mesh && Math.abs(p0.mesh.position.x - x0) > 0.02);
      const slate = p0 && p0.mesh && p0.mesh.getObjectByName('taxi-slate');
      if (c) c.t = 0.2;
      main.updateAirportTaxi(0.05);
      const r0 = slate ? slate.rotation.z : 0;
      if (c) c.t = 0.2 + Math.PI / 3.4;
      main.updateAirportTaxi(0.05);
      const swung = !!(slate && Math.abs(slate.rotation.z - r0) > 0.04);
      return {
        flag: !!(G.gameplay && G.gameplay.airportTaxi),
        n, slates, near, farNorth, night, day, shifted, swung,
      };
    });
    assert(southTaxi.flag && southTaxi.n >= 2 && southTaxi.slates >= 2 && southTaxi.near && southTaxi.farNorth, `taxi touts wait at the south Suvarnabhumi curb (${southTaxi.n})`);
    assert(southTaxi.night >= 2 && southTaxi.day >= 2 && southTaxi.shifted && southTaxi.swung, 'they hide after 22:00 and the slates tilt');

    console.log('\n[159] south 7-Eleven shoppers');
    const southShop = await page.evaluate(() => {
      const G = window.GAME, main = window.__REALISM_MAIN;
      const rec = G.southSevenShoppers;
      const list = (rec && rec.shoppers) || [];
      const n = list.filter(p => p && p.sevenShop && p.mesh).length;
      const bags = list.filter(p => p && p.mesh && p.mesh.getObjectByName('seven-bag')).length;
      const south = (G.world.sevenElevens || []).find(s => s && s.pos && Math.abs(s.pos.x) < 8 && s.pos.z < -80);
      const walk = G.world && G.world.sevenWalkIn;
      const near = !!(rec && south && south.pos && Math.hypot(rec.x - south.pos.x, rec.z - south.pos.z) < 8);
      const farWalk = !!(rec && walk && walk.pos && Math.hypot(rec.x - walk.pos.x, rec.z - walk.pos.z) > 80);
      G.time.dayT = 3 / 24;
      main.updateSevenShoppers(0.05);
      const late = list.filter(p => p && p.mesh && p.mesh.visible === false).length;
      G.time.dayT = 12 / 24;
      const p0 = list[0];
      if (p0) { p0._shopT = 0.15; p0._shopDir = 1; }
      main.updateSevenShoppers(0.05);
      const day = list.filter(p => p && p.sevenShop && p.mesh && p.mesh.visible).length;
      const z0 = p0 && p0.mesh ? p0.mesh.position.z : 0;
      if (p0) { p0._shopT = 0.15; p0._shopDir = 1; }
      main.updateSevenShoppers(0.05);
      const sz = p0 && p0.mesh ? p0.mesh.position.z : 0;
      for (let i = 0; i < 20; i++) main.updateSevenShoppers(0.1);
      const walked = !!(p0 && p0.mesh && Math.abs(p0.mesh.position.z - sz) > 0.4);
      if (p0) { p0._shopT = 0.8; p0._shopDir = -1; }
      main.updateSevenShoppers(0.05);
      const bagOut = !!(p0 && p0._sevenBag && p0._sevenBag.visible);
      return {
        flag: !!(G.gameplay && G.gameplay.sevenShoppers),
        n, bags, near, farWalk, late, day, walked, bagOut,
      };
    });
    assert(southShop.flag && southShop.n >= 3 && southShop.bags >= 3 && southShop.near && southShop.farWalk, `shoppers work the south 7-Eleven door (${southShop.n})`);
    assert(southShop.late >= 3 && southShop.day >= 3 && southShop.walked && southShop.bagOut, 'they hide late, walk the door, and leave with a bag');

    console.log('\n[160] west 7-Eleven shoppers');
    const westShop = await page.evaluate(() => {
      const G = window.GAME, main = window.__REALISM_MAIN;
      const rec = G.westSevenShoppers;
      const list = (rec && rec.shoppers) || [];
      const n = list.filter(p => p && p.sevenShop && p.mesh).length;
      const bags = list.filter(p => p && p.mesh && p.mesh.getObjectByName('seven-bag')).length;
      const west = (G.world.sevenElevens || []).find(s => s && s.pos && s.pos.x < -50 && s.pos.z > 0 && s.pos.z < 60);
      const walk = G.world && G.world.sevenWalkIn;
      const near = !!(rec && west && west.pos && Math.hypot(rec.x - west.pos.x, rec.z - west.pos.z) < 8);
      const farWalk = !!(rec && walk && walk.pos && Math.hypot(rec.x - walk.pos.x, rec.z - walk.pos.z) > 80);
      G.time.dayT = 3 / 24;
      main.updateSevenShoppers(0.05);
      const late = list.filter(p => p && p.mesh && p.mesh.visible === false).length;
      G.time.dayT = 12 / 24;
      const p0 = list[0];
      if (p0) { p0._shopT = 0.15; p0._shopDir = 1; }
      main.updateSevenShoppers(0.05);
      const day = list.filter(p => p && p.sevenShop && p.mesh && p.mesh.visible).length;
      const z0 = p0 && p0.mesh ? p0.mesh.position.z : 0;
      if (p0) { p0._shopT = 0.15; p0._shopDir = 1; }
      main.updateSevenShoppers(0.05);
      const sz = p0 && p0.mesh ? p0.mesh.position.z : 0;
      for (let i = 0; i < 20; i++) main.updateSevenShoppers(0.1);
      const walked = !!(p0 && p0.mesh && Math.abs(p0.mesh.position.z - sz) > 0.4);
      if (p0) { p0._shopT = 0.8; p0._shopDir = -1; }
      main.updateSevenShoppers(0.05);
      const bagOut = !!(p0 && p0._sevenBag && p0._sevenBag.visible);
      return {
        flag: !!(G.gameplay && G.gameplay.sevenShoppers),
        n, bags, near, farWalk, late, day, walked, bagOut,
      };
    });
    assert(westShop.flag && westShop.n >= 3 && westShop.bags >= 3 && westShop.near && westShop.farWalk, `shoppers work the west 7-Eleven door (${westShop.n})`);
    assert(westShop.late >= 3 && westShop.day >= 3 && westShop.walked && westShop.bagOut, 'they hide late, walk the door, and leave with a bag');

    console.log('\n[161] east 7-Eleven shoppers');
    const eastShop = await page.evaluate(() => {
      const G = window.GAME, main = window.__REALISM_MAIN;
      const rec = G.eastSevenShoppers;
      const list = (rec && rec.shoppers) || [];
      const n = list.filter(p => p && p.sevenShop && p.mesh).length;
      const bags = list.filter(p => p && p.mesh && p.mesh.getObjectByName('seven-bag')).length;
      const east = (G.world.sevenElevens || []).find(s => s && s.pos && s.pos.x > 100 && s.pos.z < 0 && s.pos.z > -80);
      const walk = G.world && G.world.sevenWalkIn;
      const near = !!(rec && east && east.pos && Math.hypot(rec.x - east.pos.x, rec.z - east.pos.z) < 8);
      const farWalk = !!(rec && walk && walk.pos && Math.hypot(rec.x - walk.pos.x, rec.z - walk.pos.z) > 80);
      G.time.dayT = 3 / 24;
      main.updateSevenShoppers(0.05);
      const late = list.filter(p => p && p.mesh && p.mesh.visible === false).length;
      G.time.dayT = 12 / 24;
      const p0 = list[0];
      if (p0) { p0._shopT = 0.15; p0._shopDir = 1; }
      main.updateSevenShoppers(0.05);
      const day = list.filter(p => p && p.sevenShop && p.mesh && p.mesh.visible).length;
      const z0 = p0 && p0.mesh ? p0.mesh.position.z : 0;
      if (p0) { p0._shopT = 0.15; p0._shopDir = 1; }
      main.updateSevenShoppers(0.05);
      const sz = p0 && p0.mesh ? p0.mesh.position.z : 0;
      for (let i = 0; i < 20; i++) main.updateSevenShoppers(0.1);
      const walked = !!(p0 && p0.mesh && Math.abs(p0.mesh.position.z - sz) > 0.4);
      if (p0) { p0._shopT = 0.8; p0._shopDir = -1; }
      main.updateSevenShoppers(0.05);
      const bagOut = !!(p0 && p0._sevenBag && p0._sevenBag.visible);
      return {
        flag: !!(G.gameplay && G.gameplay.sevenShoppers),
        n, bags, near, farWalk, late, day, walked, bagOut,
      };
    });
    assert(eastShop.flag && eastShop.n >= 3 && eastShop.bags >= 3 && eastShop.near && eastShop.farWalk, `shoppers work the east 7-Eleven door (${eastShop.n})`);
    assert(eastShop.late >= 3 && eastShop.day >= 3 && eastShop.walked && eastShop.bagOut, 'they hide late, walk the door, and leave with a bag');

    console.log('\n[162] lottery seller at the south 7-Eleven');
    const southLotto = await page.evaluate(() => {
      const G = window.GAME, main = window.__REALISM_MAIN;
      const L = G.southLottery;
      const south = (G.world.sevenElevens || []).find(s => s && s.pos && Math.abs(s.pos.x) < 8 && s.pos.z < -80);
      const walk = G.world && G.world.sevenWalkIn;
      const near = !!(L && L.pos && south && south.pos && Math.hypot(L.pos.x - south.pos.x, L.pos.z - south.pos.z) < 12);
      const farWalk = !!(L && L.pos && walk && walk.pos && Math.hypot(L.pos.x - walk.pos.x, L.pos.z - walk.pos.z) > 80);
      const board = !!(L && L.board && L.board.name === 'lottery-board');
      const seller = !!(L && L.ped && L.ped.lottery);
      G.player.inVehicle = null;
      G._eating = null;
      G._btsRide = null;
      G.player.group.visible = true;
      G.cash = 200;
      G._lotteryForce = 1200;
      G._lotteryLast = null;
      if (L && L.pos) G.player.group.position.copy(L.pos);
      if (L) L.readyAt = 0;
      window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyE' }));
      main.updateLottery(0.016);
      window.dispatchEvent(new KeyboardEvent('keyup', { code: 'KeyE' }));
      if (G.input && G.input.endFrame) G.input.endFrame();
      return {
        flag: !!(G.gameplay && G.gameplay.lottery),
        near, farWalk, board, seller,
        last: G._lotteryLast,
        cash: G.cash,
      };
    });
    assert(southLotto.flag && southLotto.seller && southLotto.board && southLotto.near && southLotto.farWalk, 'a lottery board waits outside the south 7-Eleven');
    assert(southLotto.last && southLotto.last.spent === 80 && southLotto.last.win === 1200 && southLotto.cash === 1320, 'E buys a ticket at the south board (฿80) and can pay out');

    console.log('\n[163] lottery seller at the west 7-Eleven');
    const westLotto = await page.evaluate(() => {
      const G = window.GAME, main = window.__REALISM_MAIN;
      const L = G.westLottery;
      const west = (G.world.sevenElevens || []).find(s => s && s.pos && s.pos.x < -50 && s.pos.z > 0 && s.pos.z < 60);
      const walk = G.world && G.world.sevenWalkIn;
      const near = !!(L && L.pos && west && west.pos && Math.hypot(L.pos.x - west.pos.x, L.pos.z - west.pos.z) < 12);
      const farWalk = !!(L && L.pos && walk && walk.pos && Math.hypot(L.pos.x - walk.pos.x, L.pos.z - walk.pos.z) > 80);
      const board = !!(L && L.board && L.board.name === 'lottery-board');
      const seller = !!(L && L.ped && L.ped.lottery);
      G.player.inVehicle = null;
      G._eating = null;
      G._btsRide = null;
      G.player.group.visible = true;
      G.cash = 200;
      G._lotteryForce = 1200;
      G._lotteryLast = null;
      if (L && L.pos) G.player.group.position.copy(L.pos);
      if (L) L.readyAt = 0;
      window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyE' }));
      main.updateLottery(0.016);
      window.dispatchEvent(new KeyboardEvent('keyup', { code: 'KeyE' }));
      if (G.input && G.input.endFrame) G.input.endFrame();
      return {
        flag: !!(G.gameplay && G.gameplay.lottery),
        near, farWalk, board, seller,
        last: G._lotteryLast,
        cash: G.cash,
      };
    });
    assert(westLotto.flag && westLotto.seller && westLotto.board && westLotto.near && westLotto.farWalk, 'a lottery board waits outside the west 7-Eleven');
    assert(westLotto.last && westLotto.last.spent === 80 && westLotto.last.win === 1200 && westLotto.cash === 1320, 'E buys a ticket at the west board (฿80) and can pay out');

    console.log('\n[164] lottery seller at the east 7-Eleven');
    const eastLotto = await page.evaluate(() => {
      const G = window.GAME, main = window.__REALISM_MAIN;
      const L = G.eastLottery;
      const east = (G.world.sevenElevens || []).find(s => s && s.pos && s.pos.x > 100 && s.pos.z < 0 && s.pos.z > -80);
      const walk = G.world && G.world.sevenWalkIn;
      const near = !!(L && L.pos && east && east.pos && Math.hypot(L.pos.x - east.pos.x, L.pos.z - east.pos.z) < 12);
      const farWalk = !!(L && L.pos && walk && walk.pos && Math.hypot(L.pos.x - walk.pos.x, L.pos.z - walk.pos.z) > 80);
      const board = !!(L && L.board && L.board.name === 'lottery-board');
      const seller = !!(L && L.ped && L.ped.lottery);
      G.player.inVehicle = null;
      G._eating = null;
      G._btsRide = null;
      G.player.group.visible = true;
      G.cash = 200;
      G._lotteryForce = 1200;
      G._lotteryLast = null;
      if (L && L.pos) G.player.group.position.copy(L.pos);
      if (L) L.readyAt = 0;
      window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyE' }));
      main.updateLottery(0.016);
      window.dispatchEvent(new KeyboardEvent('keyup', { code: 'KeyE' }));
      if (G.input && G.input.endFrame) G.input.endFrame();
      return {
        flag: !!(G.gameplay && G.gameplay.lottery),
        near, farWalk, board, seller,
        last: G._lotteryLast,
        cash: G.cash,
      };
    });
    assert(eastLotto.flag && eastLotto.seller && eastLotto.board && eastLotto.near && eastLotto.farWalk, 'a lottery board waits outside the east 7-Eleven');
    assert(eastLotto.last && eastLotto.last.spent === 80 && eastLotto.last.win === 1200 && eastLotto.cash === 1320, 'E buys a ticket at the east board (฿80) and can pay out');

    console.log('\n[165] kanom krok at the south 7-Eleven');
    const southKrok = await page.evaluate(() => {
      const G = window.GAME, main = window.__REALISM_MAIN;
      const c = G.southKanomKrok;
      const named = !!(c && c.mesh && c.mesh.name === 'kanomkrok-cart');
      const pan = !!(c && c.mesh && c.mesh.getObjectByName('kanom-pan'));
      const cakes = c && c.mesh ? c.mesh.children.filter(ch => ch && ch.name === 'kanom-cake').length : 0;
      const ladle = c && c.mesh && c.mesh.getObjectByName('kanom-ladle');
      const south = (G.world.sevenElevens || []).find(s => s && s.pos && Math.abs(s.pos.x) < 8 && s.pos.z < -80);
      const walk = G.world && G.world.sevenWalkIn;
      const near = !!(c && south && south.pos && Math.hypot(c.x - south.pos.x, c.z - south.pos.z) < 12);
      const farWalk = !!(c && walk && walk.pos && Math.hypot(c.x - walk.pos.x, c.z - walk.pos.z) > 80);
      G.time.dayT = 12 / 24;
      if (c) c.t = 0.12;
      main.updateKanomKrok(0.05);
      const dayVendor = !!(c && c.vendor && c.vendor.mesh && c.vendor.mesh.visible === false);
      const z0 = ladle ? ladle.rotation.z : 0;
      if (c) c.t = 0.18;
      main.updateKanomKrok(0.05);
      const scooped = !!(ladle && Math.abs(ladle.rotation.z - z0) > 0.05);
      G.time.dayT = 17.2 / 24;
      main.updateKanomKrok(0.05);
      const eveVendor = !!(c && c.vendor && c.vendor.kanom && c.vendor.mesh && c.vendor.mesh.visible);
      G.player.inVehicle = null;
      G._eating = null;
      if (c && c.mesh) G.player.group.position.copy(c.mesh.position);
      G.cash = 75;
      G.player.hp = 40;
      G.player.stam = 10;
      G._kanomKrok = 0;
      window.dispatchEvent(new KeyboardEvent('keyup', { code: 'KeyE' }));
      if (G.input && G.input.endFrame) G.input.endFrame();
      let paid = false;
      for (let i = 0; i < 4 && !paid; i++) {
        window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyE' }));
        main.updateKanomKrok(0.016);
        window.dispatchEvent(new KeyboardEvent('keyup', { code: 'KeyE' }));
        if (G.input && G.input.endFrame) G.input.endFrame();
        paid = G.cash === 50 && (G._kanomKrok || 0) >= 1;
      }
      return {
        flag: !!(G.gameplay && G.gameplay.kanomKrok),
        named, pan, cakes, near, farWalk, dayVendor, eveVendor, scooped, paid,
        hp: G.player.hp, stam: G.player.stam,
      };
    });
    assert(southKrok.flag && southKrok.named && southKrok.pan && southKrok.cakes >= 6 && southKrok.near && southKrok.farWalk, 'a kanom krok pan waits outside the south 7-Eleven');
    assert(southKrok.dayVendor && southKrok.eveVendor && southKrok.scooped, 'the south vendor works afternoons and the ladle scoops');
    assert(southKrok.paid && southKrok.hp > 40 && southKrok.stam > 10, 'E buys kanom krok at the south pan for ฿25');

    console.log('\n[166] kanom krok at the west 7-Eleven');
    const westKrok = await page.evaluate(() => {
      const G = window.GAME, main = window.__REALISM_MAIN;
      const c = G.westKanomKrok;
      const named = !!(c && c.mesh && c.mesh.name === 'kanomkrok-cart');
      const pan = !!(c && c.mesh && c.mesh.getObjectByName('kanom-pan'));
      const cakes = c && c.mesh ? c.mesh.children.filter(ch => ch && ch.name === 'kanom-cake').length : 0;
      const ladle = c && c.mesh && c.mesh.getObjectByName('kanom-ladle');
      const west = (G.world.sevenElevens || []).find(s => s && s.pos && s.pos.x < -50 && s.pos.z > 0 && s.pos.z < 60);
      const walk = G.world && G.world.sevenWalkIn;
      const near = !!(c && west && west.pos && Math.hypot(c.x - west.pos.x, c.z - west.pos.z) < 12);
      const farWalk = !!(c && walk && walk.pos && Math.hypot(c.x - walk.pos.x, c.z - walk.pos.z) > 80);
      G.time.dayT = 12 / 24;
      if (c) c.t = 0.12;
      main.updateKanomKrok(0.05);
      const dayVendor = !!(c && c.vendor && c.vendor.mesh && c.vendor.mesh.visible === false);
      const z0 = ladle ? ladle.rotation.z : 0;
      if (c) c.t = 0.18;
      main.updateKanomKrok(0.05);
      const scooped = !!(ladle && Math.abs(ladle.rotation.z - z0) > 0.05);
      G.time.dayT = 17.2 / 24;
      main.updateKanomKrok(0.05);
      const eveVendor = !!(c && c.vendor && c.vendor.kanom && c.vendor.mesh && c.vendor.mesh.visible);
      G.player.inVehicle = null;
      G._eating = null;
      if (c && c.mesh) G.player.group.position.copy(c.mesh.position);
      G.cash = 75;
      G.player.hp = 40;
      G.player.stam = 10;
      G._kanomKrok = 0;
      window.dispatchEvent(new KeyboardEvent('keyup', { code: 'KeyE' }));
      if (G.input && G.input.endFrame) G.input.endFrame();
      let paid = false;
      for (let i = 0; i < 4 && !paid; i++) {
        window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyE' }));
        main.updateKanomKrok(0.016);
        window.dispatchEvent(new KeyboardEvent('keyup', { code: 'KeyE' }));
        if (G.input && G.input.endFrame) G.input.endFrame();
        paid = G.cash === 50 && (G._kanomKrok || 0) >= 1;
      }
      return {
        flag: !!(G.gameplay && G.gameplay.kanomKrok),
        named, pan, cakes, near, farWalk, dayVendor, eveVendor, scooped, paid,
        hp: G.player.hp, stam: G.player.stam,
      };
    });
    assert(westKrok.flag && westKrok.named && westKrok.pan && westKrok.cakes >= 6 && westKrok.near && westKrok.farWalk, 'a kanom krok pan waits outside the west 7-Eleven');
    assert(westKrok.dayVendor && westKrok.eveVendor && westKrok.scooped, 'the west vendor works afternoons and the ladle scoops');
    assert(westKrok.paid && westKrok.hp > 40 && westKrok.stam > 10, 'E buys kanom krok at the west pan for ฿25');

    console.log('\n[167] kanom krok at the east 7-Eleven');
    const eastKrok = await page.evaluate(() => {
      const G = window.GAME, main = window.__REALISM_MAIN;
      const c = G.eastKanomKrok;
      const named = !!(c && c.mesh && c.mesh.name === 'kanomkrok-cart');
      const pan = !!(c && c.mesh && c.mesh.getObjectByName('kanom-pan'));
      const cakes = c && c.mesh ? c.mesh.children.filter(ch => ch && ch.name === 'kanom-cake').length : 0;
      const ladle = c && c.mesh && c.mesh.getObjectByName('kanom-ladle');
      const east = (G.world.sevenElevens || []).find(s => s && s.pos && s.pos.x > 100 && s.pos.z < 0 && s.pos.z > -80);
      const walk = G.world && G.world.sevenWalkIn;
      const near = !!(c && east && east.pos && Math.hypot(c.x - east.pos.x, c.z - east.pos.z) < 12);
      const farWalk = !!(c && walk && walk.pos && Math.hypot(c.x - walk.pos.x, c.z - walk.pos.z) > 80);
      G.time.dayT = 12 / 24;
      if (c) c.t = 0.12;
      main.updateKanomKrok(0.05);
      const dayVendor = !!(c && c.vendor && c.vendor.mesh && c.vendor.mesh.visible === false);
      const z0 = ladle ? ladle.rotation.z : 0;
      if (c) c.t = 0.18;
      main.updateKanomKrok(0.05);
      const scooped = !!(ladle && Math.abs(ladle.rotation.z - z0) > 0.05);
      G.time.dayT = 17.2 / 24;
      main.updateKanomKrok(0.05);
      const eveVendor = !!(c && c.vendor && c.vendor.kanom && c.vendor.mesh && c.vendor.mesh.visible);
      G.player.inVehicle = null;
      G._eating = null;
      if (c && c.mesh) G.player.group.position.copy(c.mesh.position);
      G.cash = 75;
      G.player.hp = 40;
      G.player.stam = 10;
      G._kanomKrok = 0;
      window.dispatchEvent(new KeyboardEvent('keyup', { code: 'KeyE' }));
      if (G.input && G.input.endFrame) G.input.endFrame();
      let paid = false;
      for (let i = 0; i < 4 && !paid; i++) {
        window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyE' }));
        main.updateKanomKrok(0.016);
        window.dispatchEvent(new KeyboardEvent('keyup', { code: 'KeyE' }));
        if (G.input && G.input.endFrame) G.input.endFrame();
        paid = G.cash === 50 && (G._kanomKrok || 0) >= 1;
      }
      return {
        flag: !!(G.gameplay && G.gameplay.kanomKrok),
        named, pan, cakes, near, farWalk, dayVendor, eveVendor, scooped, paid,
        hp: G.player.hp, stam: G.player.stam,
      };
    });
    assert(eastKrok.flag && eastKrok.named && eastKrok.pan && eastKrok.cakes >= 6 && eastKrok.near && eastKrok.farWalk, 'a kanom krok pan waits outside the east 7-Eleven');
    assert(eastKrok.dayVendor && eastKrok.eveVendor && eastKrok.scooped, 'the east vendor works afternoons and the ladle scoops');
    assert(eastKrok.paid && eastKrok.hp > 40 && eastKrok.stam > 10, 'E buys kanom krok at the east pan for ฿25');

    console.log('\n[168] Suvarnabhumi windsock');
    const sock = await page.evaluate(() => {
      const G = window.GAME, main = window.__REALISM_MAIN;
      const c = G.windsock;
      const named = !!(c && c.sock && c.sock.name === 'windsock' && c.pole && c.pole.name === 'windsock-pole');
      const near = !!(c && Math.hypot((c.x || 0) - 230, (c.z || 0) + 170) < 4);
      G.time.weather = 'clear';
      G.time.rainStrength = 0;
      if (c) c.t = 0.2;
      main.updateWindsock(0.05);
      const y0 = c && c.sock ? c.sock.rotation.y : 0;
      if (c) c.t = 0.2 + Math.PI / 2.4;
      main.updateWindsock(0.05);
      const fluttered = !!(c && c.sock && Math.abs(c.sock.rotation.y - y0) > 0.04);
      const dryAmp = c && c.sock ? Math.abs(c.sock.rotation.y) : 0;
      G.time.rainStrength = 0.85;
      if (c) c.t = 0.2 + Math.PI / 2.4;
      main.updateWindsock(0.05);
      const wetAmp = c && c.sock ? Math.abs(c.sock.rotation.y) : 0;
      return {
        flag: !!(G.gameplay && G.gameplay.airport),
        named, near, fluttered, stronger: wetAmp > dryAmp + 0.02,
      };
    });
    assert(sock.flag && sock.named && sock.near, 'a windsock stands on the south Suvarnabhumi apron');
    assert(sock.fluttered && sock.stronger, 'it fills with the breeze and leans harder in the rain');

    console.log('\n[169] Suvarnabhumi runway edge lights');
    const edges = await page.evaluate(() => {
      const G = window.GAME, main = window.__REALISM_MAIN;
      const c = G.runwayLights;
      const list = (c && c.lights) || [];
      const n = list.filter(m => m && m.name === 'runway-edge').length;
      const near = list.filter(m => m && Math.abs(m.position.x - 237) < 12 && Math.abs(m.position.z) <= 45).length;
      G.time.dayT = 12 / 24;
      if (c) c.t = 0.2;
      main.updateRunwayLights(0.05);
      const day = c && c.mat ? c.mat.emissiveIntensity : 1;
      G.time.dayT = 21 / 24;
      if (c) c.t = 0.2;
      main.updateRunwayLights(0.05);
      const night0 = c && c.mat ? c.mat.emissiveIntensity : 0;
      if (c) c.t = 0.2 + Math.PI / 6.2;
      main.updateRunwayLights(0.05);
      const night1 = c && c.mat ? c.mat.emissiveIntensity : 0;
      return {
        flag: !!(G.gameplay && G.gameplay.airport),
        n, near, day, night0, pulsed: Math.abs(night1 - night0) > 0.04, brighter: night0 > day + 0.3,
      };
    });
    assert(edges.flag && edges.n >= 8 && edges.near >= 8, `runway edge lights line the Suvarnabhumi strip (${edges.n})`);
    assert(edges.brighter && edges.pulsed, 'they glow after dark and pulse');

    console.log('\n[170] Suvarnabhumi tower beacon');
    const beacon = await page.evaluate(() => {
      const G = window.GAME, main = window.__REALISM_MAIN;
      const c = G.towerBeacon;
      const named = !!(c && c.mesh && c.mesh.name === 'tower-beacon');
      const tower = G.world && G.world.poi && G.world.poi.airportTower;
      const near = !!(c && tower && Math.hypot(c.x - tower.x, c.z - tower.z) < 4);
      const high = !!(c && c.mesh && c.mesh.position.y > 30);
      G.time.dayT = 12 / 24;
      if (c) c.t = 0.2;
      main.updateTowerBeacon(0.05);
      const day = c && c.mesh && c.mesh.material ? c.mesh.material.emissiveIntensity : 1;
      const y0 = c && c.mesh ? c.mesh.rotation.y : 0;
      if (c) c.t = 0.2 + Math.PI / 1.8;
      main.updateTowerBeacon(0.05);
      const spun = !!(c && c.mesh && Math.abs(c.mesh.rotation.y - y0) > 0.04);
      G.time.dayT = 21 / 24;
      if (c) c.t = 0.2;
      main.updateTowerBeacon(0.05);
      const night0 = c && c.mesh && c.mesh.material ? c.mesh.material.emissiveIntensity : 0;
      if (c) c.t = 0.2 + Math.PI / 8.4;
      main.updateTowerBeacon(0.05);
      const night1 = c && c.mesh && c.mesh.material ? c.mesh.material.emissiveIntensity : 0;
      return {
        flag: !!(G.gameplay && G.gameplay.airport),
        named, near, high, spun, day, night0,
        pulsed: Math.abs(night1 - night0) > 0.04,
        brighter: night0 > day + 0.3,
      };
    });
    assert(beacon.flag && beacon.named && beacon.near && beacon.high, 'a red beacon sits on the Suvarnabhumi tower');
    assert(beacon.spun && beacon.brighter && beacon.pulsed, 'it turns and glows after dark');

    console.log('\n[171] ATM queue at the south 7-Eleven');
    const southAtm = await page.evaluate(() => {
      const G = window.GAME, main = window.__REALISM_MAIN;
      const c = G.southSevenAtm;
      const south = (G.world.sevenElevens || []).find(s => s && s.pos && Math.abs(s.pos.x) < 8 && s.pos.z < -80);
      const walk = G.world && G.world.sevenWalkIn;
      const n = (c && c.queue || []).filter(p => p && p.sevenAtm && p.mesh).length;
      const card = (c && c.queue || []).some(p => p && p.mesh && p.mesh.getObjectByName('seven-atm-card'));
      const named = !!(c && c.machine && c.machine.name === 'south-seven-atm');
      const near = !!(c && south && south.pos && Math.hypot(c.ax - south.pos.x, c.az - south.pos.z) < 12);
      const farWalk = !!(c && walk && walk.pos && Math.hypot(c.ax - walk.pos.x, c.az - walk.pos.z) > 80);
      G.time.dayT = 3 / 24;
      main.updateSevenAtm(0.05);
      const late = (c && c.queue || []).filter(p => p && p.mesh && p.mesh.visible === false).length;
      G.time.dayT = 12 / 24;
      if (c) c.t = 0.2;
      main.updateSevenAtm(0.05);
      const day = (c && c.queue || []).filter(p => p && p.sevenAtm && p.mesh && p.mesh.visible).length;
      const p0 = c && c.queue && c.queue[0];
      const z0 = p0 && p0.mesh ? p0.mesh.position.z : 0;
      if (c) c.t = 0.2 + Math.PI / 2.4;
      main.updateSevenAtm(0.05);
      const shifted = !!(p0 && p0.mesh && Math.abs(p0.mesh.position.z - z0) > 0.04);
      return {
        flag: !!(G.gameplay && G.gameplay.sevenAtm),
        n, card, named, near, farWalk, late, day, shifted,
      };
    });
    assert(southAtm.flag && southAtm.n >= 2 && southAtm.card && southAtm.named && southAtm.near && southAtm.farWalk, `a queue waits at the south 7-Eleven ATM (${southAtm.n})`);
    assert(southAtm.late >= 2 && southAtm.day >= 2 && southAtm.shifted, 'they hide late and shift weight at the south machine');

    console.log('\n[172] ATM queue at the west 7-Eleven');
    const westAtm = await page.evaluate(() => {
      const G = window.GAME, main = window.__REALISM_MAIN;
      const c = G.westSevenAtm;
      const west = (G.world.sevenElevens || []).find(s => s && s.pos && s.pos.x < -50 && s.pos.z > 0 && s.pos.z < 60);
      const walk = G.world && G.world.sevenWalkIn;
      const n = (c && c.queue || []).filter(p => p && p.sevenAtm && p.mesh).length;
      const card = (c && c.queue || []).some(p => p && p.mesh && p.mesh.getObjectByName('seven-atm-card'));
      const named = !!(c && c.machine && c.machine.name === 'west-seven-atm');
      const near = !!(c && west && west.pos && Math.hypot(c.ax - west.pos.x, c.az - west.pos.z) < 12);
      const farWalk = !!(c && walk && walk.pos && Math.hypot(c.ax - walk.pos.x, c.az - walk.pos.z) > 80);
      G.time.dayT = 3 / 24;
      main.updateSevenAtm(0.05);
      const late = (c && c.queue || []).filter(p => p && p.mesh && p.mesh.visible === false).length;
      G.time.dayT = 12 / 24;
      if (c) c.t = 0.2;
      main.updateSevenAtm(0.05);
      const day = (c && c.queue || []).filter(p => p && p.sevenAtm && p.mesh && p.mesh.visible).length;
      const p0 = c && c.queue && c.queue[0];
      const z0 = p0 && p0.mesh ? p0.mesh.position.z : 0;
      if (c) c.t = 0.2 + Math.PI / 2.4;
      main.updateSevenAtm(0.05);
      const shifted = !!(p0 && p0.mesh && Math.abs(p0.mesh.position.z - z0) > 0.04);
      return {
        flag: !!(G.gameplay && G.gameplay.sevenAtm),
        n, card, named, near, farWalk, late, day, shifted,
      };
    });
    assert(westAtm.flag && westAtm.n >= 2 && westAtm.card && westAtm.named && westAtm.near && westAtm.farWalk, `a queue waits at the west 7-Eleven ATM (${westAtm.n})`);
    assert(westAtm.late >= 2 && westAtm.day >= 2 && westAtm.shifted, 'they hide late and shift weight at the west machine');

    console.log('\n[173] ATM queue at the east 7-Eleven');
    const eastAtm = await page.evaluate(() => {
      const G = window.GAME, main = window.__REALISM_MAIN;
      const c = G.eastSevenAtm;
      const east = (G.world.sevenElevens || []).find(s => s && s.pos && s.pos.x > 100 && s.pos.z < 0 && s.pos.z > -80);
      const walk = G.world && G.world.sevenWalkIn;
      const n = (c && c.queue || []).filter(p => p && p.sevenAtm && p.mesh).length;
      const card = (c && c.queue || []).some(p => p && p.mesh && p.mesh.getObjectByName('seven-atm-card'));
      const named = !!(c && c.machine && c.machine.name === 'east-seven-atm');
      const near = !!(c && east && east.pos && Math.hypot(c.ax - east.pos.x, c.az - east.pos.z) < 12);
      const farWalk = !!(c && walk && walk.pos && Math.hypot(c.ax - walk.pos.x, c.az - walk.pos.z) > 80);
      G.time.dayT = 3 / 24;
      main.updateSevenAtm(0.05);
      const late = (c && c.queue || []).filter(p => p && p.mesh && p.mesh.visible === false).length;
      G.time.dayT = 12 / 24;
      if (c) c.t = 0.2;
      main.updateSevenAtm(0.05);
      const day = (c && c.queue || []).filter(p => p && p.sevenAtm && p.mesh && p.mesh.visible).length;
      const p0 = c && c.queue && c.queue[0];
      const z0 = p0 && p0.mesh ? p0.mesh.position.z : 0;
      if (c) c.t = 0.2 + Math.PI / 2.4;
      main.updateSevenAtm(0.05);
      const shifted = !!(p0 && p0.mesh && Math.abs(p0.mesh.position.z - z0) > 0.04);
      return {
        flag: !!(G.gameplay && G.gameplay.sevenAtm),
        n, card, named, near, farWalk, late, day, shifted,
      };
    });
    assert(eastAtm.flag && eastAtm.n >= 2 && eastAtm.card && eastAtm.named && eastAtm.near && eastAtm.farWalk, `a queue waits at the east 7-Eleven ATM (${eastAtm.n})`);
    assert(eastAtm.late >= 2 && eastAtm.day >= 2 && eastAtm.shifted, 'they hide late and shift weight at the east machine');

    console.log('\n[174] fruit smoothie at Asok');
    const asokSmoothie = await page.evaluate(() => {
      const G = window.GAME, main = window.__REALISM_MAIN;
      const c = G.asokFruit;
      const named = !!(c && c.mesh && c.mesh.name === 'phrom-fruit');
      const n = c && c.mesh ? c.mesh.children.filter(ch => ch && ch.name === 'phrom-fruit-piece').length : 0;
      const blender = !!(c && c.mesh && c.mesh.getObjectByName('phrom-blender'));
      const bts = G.world && G.world.bts;
      const near = !!(c && bts && Math.hypot(c.x - bts.x, c.z - (bts.z || 0)) < 40);
      const farPhrom = !!(c && Math.hypot(c.x - 100, c.z) > 80);
      G.time.dayT = 21.2 / 24;
      main.updatePhromFruit(0.05);
      const night = !!(c && c.vendor && c.vendor.mesh && c.vendor.mesh.visible === false);
      G.time.dayT = 12 / 24;
      if (c) c.t = 0.2;
      main.updatePhromFruit(0.05);
      const day = !!(c && c.vendor && c.vendor.phromFruit && c.vendor.mesh && c.vendor.mesh.visible);
      const b = c && c.mesh && c.mesh.getObjectByName('phrom-blender');
      const r0 = b ? b.rotation.y : 0;
      if (c) c.t = 0.2 + 0.4;
      main.updatePhromFruit(0.05);
      const spun = !!(b && Math.abs(b.rotation.y - r0) > 1);
      G.player.inVehicle = null;
      G._eating = null;
      if (c && c.mesh) G.player.group.position.copy(c.mesh.position);
      G.cash = 80;
      G._phromFruit = 0;
      const stam0 = G.player.stam;
      G.player.stam = Math.max(0, (G.player.stamMax || 100) * 0.2);
      window.dispatchEvent(new KeyboardEvent('keyup', { code: 'KeyE' }));
      if (G.input && G.input.endFrame) G.input.endFrame();
      let paid = false;
      for (let i = 0; i < 4 && !paid; i++) {
        window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyE' }));
        main.updatePhromFruit(0.016);
        window.dispatchEvent(new KeyboardEvent('keyup', { code: 'KeyE' }));
        if (G.input && G.input.endFrame) G.input.endFrame();
        paid = G.cash === 40 && (G._phromFruit || 0) >= 1 && G.player.stam === G.player.stamMax;
      }
      G.player.stam = stam0;
      return {
        flag: !!(G.gameplay && G.gameplay.phromFruit),
        named, n, blender, near, farPhrom, night, day, spun, paid,
      };
    });
    assert(asokSmoothie.flag && asokSmoothie.named && asokSmoothie.n >= 4 && asokSmoothie.blender && asokSmoothie.near && asokSmoothie.farPhrom, `a fruit smoothie cart waits at Asok (${asokSmoothie.n})`);
    assert(asokSmoothie.night && asokSmoothie.day && asokSmoothie.spun && asokSmoothie.paid, 'the Asok blender spins by day and E buys a smoothie for ฿40');

    console.log('\n[175] ATM queue at Krung Thep Bank');
    const bankAtm = await page.evaluate(() => {
      const G = window.GAME, main = window.__REALISM_MAIN;
      const c = G.bankAtm;
      const door = G.world && G.world.poi && G.world.poi.bank;
      const n = (c && c.queue || []).filter(p => p && p.bankQueue && p.mesh).length;
      const card = (c && c.queue || []).some(p => p && p.mesh && p.mesh.getObjectByName('bank-atm-card'));
      const named = !!(c && c.machine && c.machine.name === 'bank-atm');
      const near = !!(c && door && Math.hypot(c.x - door.x, c.z - door.z) < 12);
      G.time.dayT = 3 / 24;
      main.updateBankQueue(0.05);
      const late = (c && c.queue || []).filter(p => p && p.mesh && p.mesh.visible === false).length;
      G.time.dayT = 12 / 24;
      if (c) c.t = 0.2;
      main.updateBankQueue(0.05);
      const day = (c && c.queue || []).filter(p => p && p.bankQueue && p.mesh && p.mesh.visible).length;
      const p0 = c && c.queue && c.queue[0];
      const z0 = p0 && p0.mesh ? p0.mesh.position.z : 0;
      if (c) c.t = 0.2 + Math.PI / 2.4;
      main.updateBankQueue(0.05);
      const shifted = !!(p0 && p0.mesh && Math.abs(p0.mesh.position.z - z0) > 0.04);
      return {
        flag: !!(G.gameplay && G.gameplay.bankQueue),
        n, card, named, near, late, day, shifted,
      };
    });
    assert(bankAtm.flag && bankAtm.n >= 2 && bankAtm.card && bankAtm.named && bankAtm.near, `a queue waits at the Krung Thep Bank ATM (${bankAtm.n})`);
    assert(bankAtm.late >= 2 && bankAtm.day >= 2 && bankAtm.shifted, 'they hide late and shift weight at the bank machine');

    console.log('\n[176] Hua Lamphong platform sitters');
    const stationSit = await page.evaluate(() => {
      const G = window.GAME, main = window.__REALISM_MAIN;
      const c = G.stationSit;
      const list = (c && c.sitters) || [];
      const n = list.filter(p => p && p.stationSit && p.stationPorter && p.mesh).length;
      const phones = list.filter(p => p && p.mesh && p.mesh.getObjectByName('station-phone')).length;
      const spawn = G.world && G.world.spawns && G.world.spawns.player;
      const near = !!(c && spawn && Math.hypot(c.x - spawn.x, c.z - spawn.z) < 8);
      G.time.dayT = 3 / 24;
      main.updateStationPorter(0.05);
      const late = list.filter(p => p && p.mesh && p.mesh.visible === false).length;
      G.time.dayT = 12 / 24;
      if (c) c.t = 0.2;
      main.updatePeds(0.05);
      main.updateStationPorter(0.05);
      const day = list.filter(p => p && p.stationSit && p.mesh && p.mesh.visible).length;
      const seated = list.filter(p => p && p.mesh && p.mesh.position.y >= 0.3).length;
      const p0 = list[0];
      const parts = p0 && p0.mesh && p0.mesh.userData && p0.mesh.userData.parts;
      const folded = !!(parts && parts.legL && parts.legL.rotation.x > 0.8);
      const phone = p0 && p0.mesh && p0.mesh.getObjectByName('station-phone');
      const e0 = phone && phone.material ? phone.material.emissiveIntensity : 0;
      if (c) c.t = 0.2 + Math.PI / 3.4;
      main.updateStationPorter(0.05);
      const glowed = !!(phone && phone.material && Math.abs(phone.material.emissiveIntensity - e0) > 0.04);
      return {
        flag: !!(G.gameplay && G.gameplay.stationPorter),
        n, phones, near, late, day, seated, folded, glowed,
      };
    });
    assert(stationSit.flag && stationSit.n >= 2 && stationSit.phones >= 2 && stationSit.near, `passengers sit the Hua Lamphong platform (${stationSit.n})`);
    assert(stationSit.late >= 2 && stationSit.day >= 2 && stationSit.seated >= 2 && stationSit.folded && stationSit.glowed, 'they hide late, sit with phones, and the screens glow');

    console.log('\n[177] Uncle Seng gold-shop window shopper');
    const sengShop = await page.evaluate(() => {
      const G = window.GAME, main = window.__REALISM_MAIN;
      const c = G.sengShopper;
      const ped = c && c.ped;
      const chain = !!(ped && ped.mesh && ped.mesh.getObjectByName('seng-chain'));
      const clerk = G.sengClerk;
      const near = !!(c && clerk && Math.hypot(c.x - clerk.x, c.z - clerk.z) < 4);
      G.time.dayT = 21 / 24;
      main.updateSengClerk(0.05);
      const night = !!(ped && ped.mesh && ped.mesh.visible === false);
      G.time.dayT = 12.5 / 24;
      if (c) c.t = 0.2;
      main.updateSengClerk(0.05);
      const day = !!(ped && ped.sengClerk && ped.sengShop && ped.mesh && ped.mesh.visible);
      const z0 = ped && ped.mesh ? ped.mesh.position.z : 0;
      if (c) c.t = 0.2 + Math.PI / 2.2;
      main.updateSengClerk(0.05);
      const shifted = !!(ped && ped.mesh && Math.abs(ped.mesh.position.z - z0) > 0.02);
      const tool = ped && ped.mesh && ped.mesh.getObjectByName('seng-chain');
      if (c) c.t = 0.2;
      main.updateSengClerk(0.05);
      const r0 = tool ? tool.rotation.z : 0;
      if (c) c.t = 0.2 + Math.PI / 4.2;
      main.updateSengClerk(0.05);
      const swung = !!(tool && Math.abs(tool.rotation.z - r0) > 0.04);
      return {
        flag: !!(G.gameplay && G.gameplay.sengClerk),
        rec: !!(ped && ped.sengClerk && ped.sengShop),
        chain, near, night, day, shifted, swung,
      };
    });
    assert(sengShop.flag && sengShop.rec && sengShop.chain && sengShop.near, "a window shopper waits at Uncle Seng's gold-shop door");
    assert(sengShop.night && sengShop.day && sengShop.shifted && sengShop.swung, 'they hide after 20:00 and the gold chain turns');

    console.log('\n[178] U-Spray garage waiting customer');
    const garageWait = await page.evaluate(() => {
      const G = window.GAME, main = window.__REALISM_MAIN;
      const c = G.garageWait;
      const ped = c && c.ped;
      const helm = !!(ped && ped.mesh && ped.mesh.getObjectByName('garage-helmet'));
      const mech = G.garageMech;
      const near = !!(c && mech && Math.hypot(c.x - mech.x, c.z - mech.z) < 8);
      G.time.dayT = 21 / 24;
      main.updateGarageMech(0.05);
      const night = !!(ped && ped.mesh && ped.mesh.visible === false);
      G.time.dayT = 12.5 / 24;
      if (c) c.t = 0.2;
      main.updateGarageMech(0.05);
      const day = !!(ped && ped.garageMech && ped.garageWait && ped.mesh && ped.mesh.visible);
      const z0 = ped && ped.mesh ? ped.mesh.position.z : 0;
      if (c) c.t = 0.2 + Math.PI / 2.2;
      main.updateGarageMech(0.05);
      const shifted = !!(ped && ped.mesh && Math.abs(ped.mesh.position.z - z0) > 0.02);
      const tool = ped && ped.mesh && ped.mesh.getObjectByName('garage-helmet');
      if (c) c.t = 0.2;
      main.updateGarageMech(0.05);
      const r0 = tool ? tool.rotation.z : 0;
      if (c) c.t = 0.2 + Math.PI / 4.2;
      main.updateGarageMech(0.05);
      const swung = !!(tool && Math.abs(tool.rotation.z - r0) > 0.04);
      return {
        flag: !!(G.gameplay && G.gameplay.garageMech),
        rec: !!(ped && ped.garageMech && ped.garageWait),
        helm, near, night, day, shifted, swung,
      };
    });
    assert(garageWait.flag && garageWait.rec && garageWait.helm && garageWait.near, 'a customer waits at the U-Spray bay');
    assert(garageWait.night && garageWait.day && garageWait.shifted && garageWait.swung, 'they hide after 19:00 and the helmet turns');

    console.log('\n[179] Suvarnabhumi baggage handlers');
    const airportBags = await page.evaluate(() => {
      const G = window.GAME, main = window.__REALISM_MAIN;
      const c = G.airportBags;
      const list = (c && c.hands) || [];
      const n = list.filter(p => p && p.airportBags && p.airportTaxi && p.mesh).length;
      const cases = list.filter(p => p && p.mesh && p.mesh.getObjectByName('bag-case')).length;
      const near = !!(c && Math.hypot(c.x - 209, c.z) < 8);
      G.time.dayT = 23 / 24;
      main.updateAirportTaxi(0.05);
      const night = list.filter(p => p && p.mesh && p.mesh.visible === false).length;
      G.time.dayT = 12.5 / 24;
      if (c) c.t = 0.2;
      main.updateAirportTaxi(0.05);
      const day = list.filter(p => p && p.airportBags && p.mesh && p.mesh.visible).length;
      const p0 = list[0];
      const x0 = p0 && p0.mesh ? p0.mesh.position.x : 0;
      if (c) c.t = 0.2 + Math.PI / 2.2;
      main.updateAirportTaxi(0.05);
      const shifted = !!(p0 && p0.mesh && Math.abs(p0.mesh.position.x - x0) > 0.02);
      const cse = p0 && p0.mesh && p0.mesh.getObjectByName('bag-case');
      if (c) c.t = 0.2;
      main.updateAirportTaxi(0.05);
      const r0 = cse ? cse.rotation.z : 0;
      if (c) c.t = 0.2 + Math.PI / 3.4;
      main.updateAirportTaxi(0.05);
      const swung = !!(cse && Math.abs(cse.rotation.z - r0) > 0.04);
      return {
        flag: !!(G.gameplay && G.gameplay.airportTaxi),
        n, cases, near, night, day, shifted, swung,
      };
    });
    assert(airportBags.flag && airportBags.n >= 2 && airportBags.cases >= 2 && airportBags.near, `baggage handlers wait at the Suvarnabhumi terminal (${airportBags.n})`);
    assert(airportBags.night >= 2 && airportBags.day >= 2 && airportBags.shifted && airportBags.swung, 'they hide after 22:00 and the cases tilt');

    console.log('\n[180] Sukhumvit gun shop customer');
    const gunShopper = await page.evaluate(() => {
      const G = window.GAME, main = window.__REALISM_MAIN;
      const c = G.gunShopper;
      const ped = c && c.ped;
      const cse = !!(ped && ped.mesh && ped.mesh.getObjectByName('gun-case'));
      const clerk = G.gunClerk;
      const near = !!(c && clerk && Math.hypot(c.x - clerk.x, c.z - clerk.z) < 4);
      G.time.dayT = 22.4 / 24;
      main.updateGunClerk(0.05);
      const night = !!(ped && ped.mesh && ped.mesh.visible === false);
      G.time.dayT = 12 / 24;
      if (c) c.t = 0.2;
      main.updateGunClerk(0.05);
      const day = !!(ped && ped.gunClerk && ped.gunShop && ped.mesh && ped.mesh.visible);
      const z0 = ped && ped.mesh ? ped.mesh.position.z : 0;
      if (c) c.t = 0.2 + Math.PI / 2.2;
      main.updateGunClerk(0.05);
      const shifted = !!(ped && ped.mesh && Math.abs(ped.mesh.position.z - z0) > 0.02);
      const tool = ped && ped.mesh && ped.mesh.getObjectByName('gun-case');
      if (c) c.t = 0.2;
      main.updateGunClerk(0.05);
      const r0 = tool ? tool.rotation.z : 0;
      if (c) c.t = 0.2 + Math.PI / 4.2;
      main.updateGunClerk(0.05);
      const swung = !!(tool && Math.abs(tool.rotation.z - r0) > 0.04);
      return {
        flag: !!(G.gameplay && G.gameplay.gunClerk),
        rec: !!(ped && ped.gunClerk && ped.gunShop),
        cse, near, night, day, shifted, swung,
      };
    });
    assert(gunShopper.flag && gunShopper.rec && gunShopper.cse && gunShopper.near, 'a customer waits at the Sukhumvit Gun Shop counter');
    assert(gunShopper.night && gunShopper.day && gunShopper.shifted && gunShopper.swung, 'they hide after hours and the gun case turns');

    console.log('\n[181] Hua Lamphong starter gun customer');
    const starterShopper = await page.evaluate(() => {
      const G = window.GAME, main = window.__REALISM_MAIN;
      const c = G.starterShopper;
      const ped = c && c.ped;
      const cse = !!(ped && ped.mesh && ped.mesh.getObjectByName('starter-case'));
      const clerk = G.starterClerk;
      const near = !!(c && clerk && Math.hypot(c.x - clerk.x, c.z - clerk.z) < 4);
      G.time.dayT = 22 / 24;
      main.updateStarterClerk(0.05);
      const night = !!(ped && ped.mesh && ped.mesh.visible === false);
      G.time.dayT = 12.5 / 24;
      if (c) c.t = 0.2;
      main.updateStarterClerk(0.05);
      const day = !!(ped && ped.starterClerk && ped.starterShop && ped.mesh && ped.mesh.visible);
      const z0 = ped && ped.mesh ? ped.mesh.position.z : 0;
      if (c) c.t = 0.2 + Math.PI / 2.2;
      main.updateStarterClerk(0.05);
      const shifted = !!(ped && ped.mesh && Math.abs(ped.mesh.position.z - z0) > 0.02);
      const tool = ped && ped.mesh && ped.mesh.getObjectByName('starter-case');
      if (c) c.t = 0.2;
      main.updateStarterClerk(0.05);
      const r0 = tool ? tool.rotation.z : 0;
      if (c) c.t = 0.2 + Math.PI / 4.2;
      main.updateStarterClerk(0.05);
      const swung = !!(tool && Math.abs(tool.rotation.z - r0) > 0.04);
      return {
        flag: !!(G.gameplay && G.gameplay.starterClerk),
        rec: !!(ped && ped.starterClerk && ped.starterShop),
        cse, near, night, day, shifted, swung,
      };
    });
    assert(starterShopper.flag && starterShopper.rec && starterShopper.cse && starterShopper.near, 'a customer waits at the Hua Lamphong starter gun counter');
    assert(starterShopper.night && starterShopper.day && starterShopper.shifted && starterShopper.swung, 'they hide after hours and the gun case turns');

    console.log('\n[182] Klong Toey yard checker');
    const klongCheck = await page.evaluate(() => {
      const G = window.GAME, main = window.__REALISM_MAIN;
      const c = G.klongCheck;
      const ped = c && c.ped;
      const clip = !!(ped && ped.mesh && ped.mesh.getObjectByName('klong-clip'));
      const dock = G.klongDock;
      const near = !!(c && dock && Math.hypot(c.x - dock.x, c.z - dock.z) < 8);
      G.time.dayT = 21 / 24;
      main.updateKlongDock(0.05);
      const night = !!(ped && ped.mesh && ped.mesh.visible === false);
      G.time.dayT = 12.5 / 24;
      if (c) c.t = 0.2;
      main.updateKlongDock(0.05);
      const day = !!(ped && ped.klongDock && ped.klongCheck && ped.mesh && ped.mesh.visible);
      const z0 = ped && ped.mesh ? ped.mesh.position.z : 0;
      if (c) c.t = 0.2 + Math.PI / 2.2;
      main.updateKlongDock(0.05);
      const shifted = !!(ped && ped.mesh && Math.abs(ped.mesh.position.z - z0) > 0.02);
      const tool = ped && ped.mesh && ped.mesh.getObjectByName('klong-clip');
      if (c) c.t = 0.2;
      main.updateKlongDock(0.05);
      const r0 = tool ? tool.rotation.z : 0;
      if (c) c.t = 0.2 + Math.PI / 4.2;
      main.updateKlongDock(0.05);
      const swung = !!(tool && Math.abs(tool.rotation.z - r0) > 0.04);
      return {
        flag: !!(G.gameplay && G.gameplay.klongDock),
        rec: !!(ped && ped.klongDock && ped.klongCheck),
        clip, near, night, day, shifted, swung,
      };
    });
    assert(klongCheck.flag && klongCheck.rec && klongCheck.clip && klongCheck.near, 'a checker waits at the Klong Toey yard');
    assert(klongCheck.night && klongCheck.day && klongCheck.shifted && klongCheck.swung, 'they hide after 19:00 and the clipboard turns');

    console.log('\n[183] pier ticket clerk');
    const pierClerk = await page.evaluate(() => {
      const G = window.GAME, main = window.__REALISM_MAIN;
      const c = G.pierClerk;
      const ped = c && c.ped;
      const ticket = !!(ped && ped.mesh && ped.mesh.getObjectByName('pier-ticket'));
      const wait = G.pierWait;
      const near = !!(c && wait && Math.hypot(c.x - wait.x, c.z - wait.z) < 6);
      G.time.dayT = 22 / 24;
      main.updatePierWait(0.05);
      const night = !!(ped && ped.mesh && ped.mesh.visible === false);
      G.time.dayT = 12 / 24;
      if (c) c.t = 0.2;
      main.updatePierWait(0.05);
      const day = !!(ped && ped.pierWait && ped.pierClerk && ped.mesh && ped.mesh.visible);
      const z0 = ped && ped.mesh ? ped.mesh.position.z : 0;
      if (c) c.t = 0.2 + Math.PI / 2.2;
      main.updatePierWait(0.05);
      const shifted = !!(ped && ped.mesh && Math.abs(ped.mesh.position.z - z0) > 0.02);
      const tool = ped && ped.mesh && ped.mesh.getObjectByName('pier-ticket');
      if (c) c.t = 0.2;
      main.updatePierWait(0.05);
      const r0 = tool ? tool.rotation.z : 0;
      if (c) c.t = 0.2 + Math.PI / 4.2;
      main.updatePierWait(0.05);
      const swung = !!(tool && Math.abs(tool.rotation.z - r0) > 0.04);
      return {
        flag: !!(G.gameplay && G.gameplay.pierWait),
        rec: !!(ped && ped.pierWait && ped.pierClerk),
        ticket, near, night, day, shifted, swung,
      };
    });
    assert(pierClerk.flag && pierClerk.rec && pierClerk.ticket && pierClerk.near, 'a ticket clerk waits at the pier');
    assert(pierClerk.night && pierClerk.day && pierClerk.shifted && pierClerk.swung, 'they hide after 21:00 and the ticket pad turns');

    console.log('\n[184] Muay Thai gym waiting fighter');
    const gymWait = await page.evaluate(() => {
      const G = window.GAME, main = window.__REALISM_MAIN;
      const c = G.gymWait;
      const ped = c && c.ped;
      const wrap = !!(ped && ped.mesh && ped.mesh.getObjectByName('gym-wrap'));
      const gym = G.gymBag;
      const near = !!(c && gym && Math.hypot(c.x - gym.x, c.z - gym.z) < 4);
      G.time.dayT = 22 / 24;
      main.updateGymBag(0.05);
      const night = !!(ped && ped.mesh && ped.mesh.visible === false);
      G.time.dayT = 12.5 / 24;
      if (c) c.t = 0.2;
      main.updateGymBag(0.05);
      const day = !!(ped && ped.gymBag && ped.gymWait && ped.mesh && ped.mesh.visible);
      const z0 = ped && ped.mesh ? ped.mesh.position.z : 0;
      if (c) c.t = 0.2 + Math.PI / 2.2;
      main.updateGymBag(0.05);
      const shifted = !!(ped && ped.mesh && Math.abs(ped.mesh.position.z - z0) > 0.02);
      const tool = ped && ped.mesh && ped.mesh.getObjectByName('gym-wrap');
      if (c) c.t = 0.2;
      main.updateGymBag(0.05);
      const r0 = tool ? tool.rotation.z : 0;
      if (c) c.t = 0.2 + Math.PI / 4.2;
      main.updateGymBag(0.05);
      const swung = !!(tool && Math.abs(tool.rotation.z - r0) > 0.04);
      return {
        flag: !!(G.gameplay && G.gameplay.gymBag),
        rec: !!(ped && ped.gymBag && ped.gymWait),
        wrap, near, night, day, shifted, swung,
      };
    });
    assert(gymWait.flag && gymWait.rec && gymWait.wrap && gymWait.near, 'a fighter waits at the Muay Thai gym');
    assert(gymWait.night && gymWait.day && gymWait.shifted && gymWait.swung, 'they hide after 21:00 and the hand wrap turns');

    console.log('\n[185] wat merit-box attendant');
    const watMerit = await page.evaluate(() => {
      const G = window.GAME, main = window.__REALISM_MAIN;
      const c = G.watMerit;
      const ped = c && c.ped;
      const tray = !!(ped && ped.mesh && ped.mesh.getObjectByName('wat-merit-tray'));
      const box = !!(c && c.box && c.box.name === 'wat-merit-box');
      const temple = G.world && G.world.poi && G.world.poi.temple;
      const near = !!(c && temple && Math.hypot(c.x - temple.x, c.z - temple.z) < 16);
      G.time.dayT = 19 / 24;
      main.updateWatLotus(0.05);
      const night = !!(ped && ped.mesh && ped.mesh.visible === false);
      G.time.dayT = 12 / 24;
      if (c) c.t = 0.2;
      main.updateWatLotus(0.05);
      const day = !!(ped && ped.watLotus && ped.watMerit && ped.mesh && ped.mesh.visible);
      const z0 = ped && ped.mesh ? ped.mesh.position.z : 0;
      if (c) c.t = 0.2 + Math.PI / 2.2;
      main.updateWatLotus(0.05);
      const shifted = !!(ped && ped.mesh && Math.abs(ped.mesh.position.z - z0) > 0.02);
      const tool = ped && ped.mesh && ped.mesh.getObjectByName('wat-merit-tray');
      if (c) c.t = 0.2;
      main.updateWatLotus(0.05);
      const r0 = tool ? tool.rotation.z : 0;
      if (c) c.t = 0.2 + Math.PI / 4.2;
      main.updateWatLotus(0.05);
      const swung = !!(tool && Math.abs(tool.rotation.z - r0) > 0.04);
      return {
        flag: !!(G.gameplay && G.gameplay.watLotus),
        rec: !!(ped && ped.watLotus && ped.watMerit),
        tray, box, near, night, day, shifted, swung,
      };
    });
    assert(watMerit.flag && watMerit.rec && watMerit.tray && watMerit.box && watMerit.near, 'a merit-box attendant waits at the wat gate');
    assert(watMerit.night && watMerit.day && watMerit.shifted && watMerit.swung, 'they hide after 18:00 and the gold tray turns');

    console.log('\n[186] pier bank fisherman');
    const pierFish = await page.evaluate(() => {
      const G = window.GAME, main = window.__REALISM_MAIN;
      const c = G.pierFish;
      const ped = c && c.ped;
      const rod = !!(ped && ped.mesh && ped.mesh.getObjectByName('pier-rod'));
      const wait = G.pierWait;
      const near = !!(c && wait && Math.hypot(c.x - wait.x, c.z - wait.z) < 12);
      G.time.dayT = 22 / 24;
      main.updatePierWait(0.05);
      const night = !!(ped && ped.mesh && ped.mesh.visible === false);
      G.time.dayT = 12 / 24;
      if (c) c.t = 0.2;
      main.updatePierWait(0.05);
      const day = !!(ped && ped.pierWait && ped.pierFish && ped.mesh && ped.mesh.visible);
      const z0 = ped && ped.mesh ? ped.mesh.position.z : 0;
      if (c) c.t = 0.2 + Math.PI / 2.2;
      main.updatePierWait(0.05);
      const shifted = !!(ped && ped.mesh && Math.abs(ped.mesh.position.z - z0) > 0.02);
      const tool = ped && ped.mesh && ped.mesh.getObjectByName('pier-rod');
      if (c) c.t = 0.2;
      main.updatePierWait(0.05);
      const r0 = tool ? tool.rotation.z : 0;
      if (c) c.t = 0.2 + Math.PI / 3.4;
      main.updatePierWait(0.05);
      const swung = !!(tool && Math.abs(tool.rotation.z - r0) > 0.04);
      return {
        flag: !!(G.gameplay && G.gameplay.pierWait),
        rec: !!(ped && ped.pierWait && ped.pierFish),
        rod, near, night, day, shifted, swung,
      };
    });
    assert(pierFish.flag && pierFish.rec && pierFish.rod && pierFish.near, 'a fisherman waits on the pier bank');
    assert(pierFish.night && pierFish.day && pierFish.shifted && pierFish.swung, 'they hide after 21:00 and the rod dips');

    console.log('\n[187] spirit-house keeper');
    const shrineKeep = await page.evaluate(() => {
      const G = window.GAME, main = window.__REALISM_MAIN;
      const c = G.spiritKeep;
      const ped = c && c.ped;
      const malai = !!(ped && ped.mesh && ped.mesh.getObjectByName('shrine-malai'));
      const s = (G.world.shrines || [])[0];
      const near = !!(c && s && s.pos && Math.hypot(c.x - s.pos.x, c.z - s.pos.z) < 4);
      G.time.dayT = 21 / 24;
      main.updateShrines(0.05);
      const night = !!(ped && ped.mesh && ped.mesh.visible === false);
      G.time.dayT = 12 / 24;
      if (c) c.t = 0.2;
      main.updateShrines(0.05);
      const day = !!(ped && ped.spiritKeep && ped.mesh && ped.mesh.visible);
      const z0 = ped && ped.mesh ? ped.mesh.position.z : 0;
      if (c) c.t = 0.2 + Math.PI / 2.2;
      main.updateShrines(0.05);
      const shifted = !!(ped && ped.mesh && Math.abs(ped.mesh.position.z - z0) > 0.02);
      const tool = ped && ped.mesh && ped.mesh.getObjectByName('shrine-malai');
      if (c) c.t = 0.2;
      main.updateShrines(0.05);
      const r0 = tool ? tool.rotation.z : 0;
      if (c) c.t = 0.2 + Math.PI / 4.2;
      main.updateShrines(0.05);
      const swung = !!(tool && Math.abs(tool.rotation.z - r0) > 0.04);
      return {
        flag: !!(G.gameplay && G.gameplay.spiritWai),
        rec: !!(ped && ped.spiritKeep),
        malai, near, night, day, shifted, swung,
      };
    });
    assert(shrineKeep.flag && shrineKeep.rec && shrineKeep.malai && shrineKeep.near, 'a keeper tends a spirit house');
    assert(shrineKeep.night && shrineKeep.day && shrineKeep.shifted && shrineKeep.swung, 'they hide after 20:00 and the malai turns');

    console.log('\n[188] second spirit-house keeper');
    const shrineKeepB = await page.evaluate(() => {
      const G = window.GAME, main = window.__REALISM_MAIN;
      const c = G.spiritKeepB;
      const ped = c && c.ped;
      const malai = !!(ped && ped.mesh && ped.mesh.getObjectByName('shrine-malai'));
      const s = (G.world.shrines || [])[1];
      const first = G.spiritKeep;
      const near = !!(c && s && s.pos && Math.hypot(c.x - s.pos.x, c.z - s.pos.z) < 4);
      const other = !!(c && first && Math.hypot(c.x - first.x, c.z - first.z) > 2);
      G.time.dayT = 21 / 24;
      main.updateShrines(0.05);
      const night = !!(ped && ped.mesh && ped.mesh.visible === false);
      G.time.dayT = 12 / 24;
      if (c) c.t = 0.2;
      main.updateShrines(0.05);
      const day = !!(ped && ped.spiritKeep && ped.mesh && ped.mesh.visible);
      const z0 = ped && ped.mesh ? ped.mesh.position.z : 0;
      if (c) c.t = 0.2 + Math.PI / 2.2;
      main.updateShrines(0.05);
      const shifted = !!(ped && ped.mesh && Math.abs(ped.mesh.position.z - z0) > 0.02);
      const tool = ped && ped.mesh && ped.mesh.getObjectByName('shrine-malai');
      if (c) c.t = 0.2;
      main.updateShrines(0.05);
      const r0 = tool ? tool.rotation.z : 0;
      if (c) c.t = 0.2 + Math.PI / 4.2;
      main.updateShrines(0.05);
      const swung = !!(tool && Math.abs(tool.rotation.z - r0) > 0.04);
      return {
        flag: !!(G.gameplay && G.gameplay.spiritWai),
        rec: !!(ped && ped.spiritKeep),
        malai, near, other, night, day, shifted, swung,
      };
    });
    assert(shrineKeepB.flag && shrineKeepB.rec && shrineKeepB.malai && shrineKeepB.near && shrineKeepB.other, 'a second keeper tends another spirit house');
    assert(shrineKeepB.night && shrineKeepB.day && shrineKeepB.shifted && shrineKeepB.swung, 'they hide after 20:00 and the malai turns');

    console.log('\n[189] third spirit-house keeper');
    const shrineKeepC = await page.evaluate(() => {
      const G = window.GAME, main = window.__REALISM_MAIN;
      const c = G.spiritKeepC;
      const ped = c && c.ped;
      const malai = !!(ped && ped.mesh && ped.mesh.getObjectByName('shrine-malai'));
      const s = (G.world.shrines || [])[2];
      const first = G.spiritKeep;
      const second = G.spiritKeepB;
      const near = !!(c && s && s.pos && Math.hypot(c.x - s.pos.x, c.z - s.pos.z) < 4);
      const other = !!(c && first && second && Math.hypot(c.x - first.x, c.z - first.z) > 2 && Math.hypot(c.x - second.x, c.z - second.z) > 2);
      G.time.dayT = 21 / 24;
      main.updateShrines(0.05);
      const night = !!(ped && ped.mesh && ped.mesh.visible === false);
      G.time.dayT = 12 / 24;
      if (c) c.t = 0.2;
      main.updateShrines(0.05);
      const day = !!(ped && ped.spiritKeep && ped.mesh && ped.mesh.visible);
      const z0 = ped && ped.mesh ? ped.mesh.position.z : 0;
      if (c) c.t = 0.2 + Math.PI / 2.2;
      main.updateShrines(0.05);
      const shifted = !!(ped && ped.mesh && Math.abs(ped.mesh.position.z - z0) > 0.02);
      const tool = ped && ped.mesh && ped.mesh.getObjectByName('shrine-malai');
      if (c) c.t = 0.2;
      main.updateShrines(0.05);
      const r0 = tool ? tool.rotation.z : 0;
      if (c) c.t = 0.2 + Math.PI / 4.2;
      main.updateShrines(0.05);
      const swung = !!(tool && Math.abs(tool.rotation.z - r0) > 0.04);
      return {
        flag: !!(G.gameplay && G.gameplay.spiritWai),
        rec: !!(ped && ped.spiritKeep),
        malai, near, other, night, day, shifted, swung,
      };
    });
    assert(shrineKeepC.flag && shrineKeepC.rec && shrineKeepC.malai && shrineKeepC.near && shrineKeepC.other, 'a third keeper tends another spirit house');
    assert(shrineKeepC.night && shrineKeepC.day && shrineKeepC.shifted && shrineKeepC.swung, 'they hide after 20:00 and the malai turns');

    console.log('\n[190] fourth spirit-house keeper');
    const shrineKeepD = await page.evaluate(() => {
      const G = window.GAME, main = window.__REALISM_MAIN;
      const c = G.spiritKeepD;
      const ped = c && c.ped;
      const malai = !!(ped && ped.mesh && ped.mesh.getObjectByName('shrine-malai'));
      const s = (G.world.shrines || [])[3];
      const others = [G.spiritKeep, G.spiritKeepB, G.spiritKeepC];
      const near = !!(c && s && s.pos && Math.hypot(c.x - s.pos.x, c.z - s.pos.z) < 4);
      const other = !!(c && others.every(o => o && Math.hypot(c.x - o.x, c.z - o.z) > 2));
      G.time.dayT = 21 / 24;
      main.updateShrines(0.05);
      const night = !!(ped && ped.mesh && ped.mesh.visible === false);
      G.time.dayT = 12 / 24;
      if (c) c.t = 0.2;
      main.updateShrines(0.05);
      const day = !!(ped && ped.spiritKeep && ped.mesh && ped.mesh.visible);
      const z0 = ped && ped.mesh ? ped.mesh.position.z : 0;
      if (c) c.t = 0.2 + Math.PI / 2.2;
      main.updateShrines(0.05);
      const shifted = !!(ped && ped.mesh && Math.abs(ped.mesh.position.z - z0) > 0.02);
      const tool = ped && ped.mesh && ped.mesh.getObjectByName('shrine-malai');
      if (c) c.t = 0.2;
      main.updateShrines(0.05);
      const r0 = tool ? tool.rotation.z : 0;
      if (c) c.t = 0.2 + Math.PI / 4.2;
      main.updateShrines(0.05);
      const swung = !!(tool && Math.abs(tool.rotation.z - r0) > 0.04);
      return {
        flag: !!(G.gameplay && G.gameplay.spiritWai),
        rec: !!(ped && ped.spiritKeep),
        malai, near, other, night, day, shifted, swung,
      };
    });
    assert(shrineKeepD.flag && shrineKeepD.rec && shrineKeepD.malai && shrineKeepD.near && shrineKeepD.other, 'a fourth keeper tends another spirit house');
    assert(shrineKeepD.night && shrineKeepD.day && shrineKeepD.shifted && shrineKeepD.swung, 'they hide after 20:00 and the malai turns');

    console.log('\n[191] fifth spirit-house keeper');
    const shrineKeepE = await page.evaluate(() => {
      const G = window.GAME, main = window.__REALISM_MAIN;
      const c = G.spiritKeepE;
      const ped = c && c.ped;
      const malai = !!(ped && ped.mesh && ped.mesh.getObjectByName('shrine-malai'));
      const s = (G.world.shrines || [])[4];
      const others = [G.spiritKeep, G.spiritKeepB, G.spiritKeepC, G.spiritKeepD];
      const near = !!(c && s && s.pos && Math.hypot(c.x - s.pos.x, c.z - s.pos.z) < 4);
      const other = !!(c && others.every(o => o && Math.hypot(c.x - o.x, c.z - o.z) > 2));
      G.time.dayT = 21 / 24;
      main.updateShrines(0.05);
      const night = !!(ped && ped.mesh && ped.mesh.visible === false);
      G.time.dayT = 12 / 24;
      if (c) c.t = 0.2;
      main.updateShrines(0.05);
      const day = !!(ped && ped.spiritKeep && ped.mesh && ped.mesh.visible);
      const z0 = ped && ped.mesh ? ped.mesh.position.z : 0;
      if (c) c.t = 0.2 + Math.PI / 2.2;
      main.updateShrines(0.05);
      const shifted = !!(ped && ped.mesh && Math.abs(ped.mesh.position.z - z0) > 0.02);
      const tool = ped && ped.mesh && ped.mesh.getObjectByName('shrine-malai');
      if (c) c.t = 0.2;
      main.updateShrines(0.05);
      const r0 = tool ? tool.rotation.z : 0;
      if (c) c.t = 0.2 + Math.PI / 4.2;
      main.updateShrines(0.05);
      const swung = !!(tool && Math.abs(tool.rotation.z - r0) > 0.04);
      return {
        flag: !!(G.gameplay && G.gameplay.spiritWai),
        rec: !!(ped && ped.spiritKeep),
        malai, near, other, night, day, shifted, swung,
      };
    });
    assert(shrineKeepE.flag && shrineKeepE.rec && shrineKeepE.malai && shrineKeepE.near && shrineKeepE.other, 'a fifth keeper tends another spirit house');
    assert(shrineKeepE.night && shrineKeepE.day && shrineKeepE.shifted && shrineKeepE.swung, 'they hide after 20:00 and the malai turns');

    console.log('\n[192] sixth spirit-house keeper');
    const shrineKeepF = await page.evaluate(() => {
      const G = window.GAME, main = window.__REALISM_MAIN;
      const c = G.spiritKeepF;
      const ped = c && c.ped;
      const malai = !!(ped && ped.mesh && ped.mesh.getObjectByName('shrine-malai'));
      const s = (G.world.shrines || [])[5];
      const others = [G.spiritKeep, G.spiritKeepB, G.spiritKeepC, G.spiritKeepD, G.spiritKeepE];
      const near = !!(c && s && s.pos && Math.hypot(c.x - s.pos.x, c.z - s.pos.z) < 4);
      const other = !!(c && others.every(o => o && Math.hypot(c.x - o.x, c.z - o.z) > 2));
      G.time.dayT = 21 / 24;
      main.updateShrines(0.05);
      const night = !!(ped && ped.mesh && ped.mesh.visible === false);
      G.time.dayT = 12 / 24;
      if (c) c.t = 0.2;
      main.updateShrines(0.05);
      const day = !!(ped && ped.spiritKeep && ped.mesh && ped.mesh.visible);
      const z0 = ped && ped.mesh ? ped.mesh.position.z : 0;
      if (c) c.t = 0.2 + Math.PI / 2.2;
      main.updateShrines(0.05);
      const shifted = !!(ped && ped.mesh && Math.abs(ped.mesh.position.z - z0) > 0.02);
      const tool = ped && ped.mesh && ped.mesh.getObjectByName('shrine-malai');
      if (c) c.t = 0.2;
      main.updateShrines(0.05);
      const r0 = tool ? tool.rotation.z : 0;
      if (c) c.t = 0.2 + Math.PI / 4.2;
      main.updateShrines(0.05);
      const swung = !!(tool && Math.abs(tool.rotation.z - r0) > 0.04);
      return {
        flag: !!(G.gameplay && G.gameplay.spiritWai),
        rec: !!(ped && ped.spiritKeep),
        malai, near, other, night, day, shifted, swung,
      };
    });
    assert(shrineKeepF.flag && shrineKeepF.rec && shrineKeepF.malai && shrineKeepF.near && shrineKeepF.other, 'a sixth keeper tends another spirit house');
    assert(shrineKeepF.night && shrineKeepF.day && shrineKeepF.shifted && shrineKeepF.swung, 'they hide after 20:00 and the malai turns');

    console.log('\n[193] bank teller behind the counter');
    const bankTeller = await page.evaluate(() => {
      const G = window.GAME, main = window.__REALISM_MAIN;
      const c = G.bankTeller;
      const ped = c && c.ped;
      const stamp = !!(ped && ped.mesh && ped.mesh.getObjectByName('bank-stamp'));
      const teller = G.world && G.world.bank && G.world.bank.teller;
      const near = !!(c && teller && Math.hypot(c.x - teller.x, c.z - teller.z) < 6);
      const queue = G.bankQueue;
      const other = !!(c && queue && Math.hypot(c.x - queue.x, c.z - queue.z) > 2);
      G.time.dayT = 18 / 24;
      main.updateBankQueue(0.05);
      const night = !!(ped && ped.mesh && ped.mesh.visible === false);
      G.time.dayT = 12 / 24;
      if (c) c.t = 0.2;
      main.updateBankQueue(0.05);
      const day = !!(ped && ped.bankTeller && ped.mesh && ped.mesh.visible);
      const z0 = ped && ped.mesh ? ped.mesh.position.z : 0;
      if (c) c.t = 0.2 + Math.PI / 2.2;
      main.updateBankQueue(0.05);
      const shifted = !!(ped && ped.mesh && Math.abs(ped.mesh.position.z - z0) > 0.02);
      const tool = ped && ped.mesh && ped.mesh.getObjectByName('bank-stamp');
      if (c) c.t = 0.2;
      main.updateBankQueue(0.05);
      const r0 = tool ? tool.rotation.z : 0;
      if (c) c.t = 0.2 + Math.PI / 4.2;
      main.updateBankQueue(0.05);
      const swung = !!(tool && Math.abs(tool.rotation.z - r0) > 0.04);
      return {
        flag: !!(G.gameplay && G.gameplay.bankQueue),
        rec: !!(ped && ped.bankTeller),
        stamp, near, other, night, day, shifted, swung,
      };
    });
    assert(bankTeller.flag && bankTeller.rec && bankTeller.stamp && bankTeller.near && bankTeller.other, 'a teller works behind the Krung Thep Bank counter');
    assert(bankTeller.night && bankTeller.day && bankTeller.shifted && bankTeller.swung, 'they hide after hours and the stamp turns');

    console.log('\n[194] wat bell monk');
    const bellMonk = await page.evaluate(() => {
      const G = window.GAME, main = window.__REALISM_MAIN;
      const c = G.watBellMonk;
      const ped = c && c.ped;
      const mallet = !!(ped && ped.mesh && ped.mesh.getObjectByName('wat-bell-mallet'));
      const bell = G.watBell;
      const near = !!(c && bell && Math.hypot(c.x - bell.x, c.z - bell.z) < 4);
      const drum = G.watDrum && G.watDrum.monk;
      const other = !!(c && drum && drum.mesh && Math.hypot(c.x - drum.mesh.position.x, c.z - drum.mesh.position.z) > 2);
      G.time.dayT = 12 / 24;
      main.updateWatBell(0.05);
      const noon = !!(ped && ped.mesh && ped.mesh.visible === false);
      G.time.dayT = 7.2 / 24;
      if (c) c.t = 0.2;
      main.updateWatBell(0.05);
      const dawn = !!(ped && ped.watBell && ped.mesh && ped.mesh.visible);
      const z0 = ped && ped.mesh ? ped.mesh.position.z : 0;
      if (c) c.t = 0.2 + Math.PI / 2.2;
      main.updateWatBell(0.05);
      const shifted = !!(ped && ped.mesh && Math.abs(ped.mesh.position.z - z0) > 0.02);
      const tool = ped && ped.mesh && ped.mesh.getObjectByName('wat-bell-mallet');
      if (c) c.t = 0.2;
      main.updateWatBell(0.05);
      const r0 = tool ? tool.rotation.z : 0;
      if (c) c.t = 0.2 + Math.PI / 4.2;
      main.updateWatBell(0.05);
      const swung = !!(tool && Math.abs(tool.rotation.z - r0) > 0.04);
      return {
        flag: !!(G.gameplay && G.gameplay.watBell),
        rec: !!(ped && ped.watBell),
        mallet, near, other, noon, dawn, shifted, swung,
      };
    });
    assert(bellMonk.flag && bellMonk.rec && bellMonk.mallet && bellMonk.near && bellMonk.other, 'a monk tends the wat bell');
    assert(bellMonk.noon && bellMonk.dawn && bellMonk.shifted && bellMonk.swung, 'they hide at noon and the mallet turns');

    console.log('\n[195] south pier bank fisherman');
    const pierFishB = await page.evaluate(() => {
      const G = window.GAME, main = window.__REALISM_MAIN;
      const c = G.pierFishB;
      const ped = c && c.ped;
      const rod = !!(ped && ped.mesh && ped.mesh.getObjectByName('pier-rod'));
      const wait = G.pierWait;
      const first = G.pierFish;
      const near = !!(c && wait && Math.hypot(c.x - wait.x, c.z - wait.z) < 12);
      const other = !!(c && first && Math.hypot(c.x - first.x, c.z - first.z) > 2);
      G.time.dayT = 22 / 24;
      main.updatePierWait(0.05);
      const night = !!(ped && ped.mesh && ped.mesh.visible === false);
      G.time.dayT = 12 / 24;
      if (c) c.t = 0.2;
      main.updatePierWait(0.05);
      const day = !!(ped && ped.pierWait && ped.pierFish && ped.mesh && ped.mesh.visible);
      const z0 = ped && ped.mesh ? ped.mesh.position.z : 0;
      if (c) c.t = 0.2 + Math.PI / 2.2;
      main.updatePierWait(0.05);
      const shifted = !!(ped && ped.mesh && Math.abs(ped.mesh.position.z - z0) > 0.02);
      const tool = ped && ped.mesh && ped.mesh.getObjectByName('pier-rod');
      if (c) c.t = 0.2;
      main.updatePierWait(0.05);
      const r0 = tool ? tool.rotation.z : 0;
      if (c) c.t = 0.2 + Math.PI / 3.4;
      main.updatePierWait(0.05);
      const swung = !!(tool && Math.abs(tool.rotation.z - r0) > 0.04);
      return {
        flag: !!(G.gameplay && G.gameplay.pierWait),
        rec: !!(ped && ped.pierWait && ped.pierFish),
        rod, near, other, night, day, shifted, swung,
      };
    });
    assert(pierFishB.flag && pierFishB.rec && pierFishB.rod && pierFishB.near && pierFishB.other, 'a second fisherman waits on the south pier bank');
    assert(pierFishB.night && pierFishB.day && pierFishB.shifted && pierFishB.swung, 'they hide after 21:00 and the rod dips');

    console.log('\n[196] second bank teller behind the counter');
    const bankTellerB = await page.evaluate(() => {
      const G = window.GAME, main = window.__REALISM_MAIN;
      const c = G.bankTellerB;
      const ped = c && c.ped;
      const stamp = !!(ped && ped.mesh && ped.mesh.getObjectByName('bank-stamp'));
      const teller = G.world && G.world.bank && G.world.bank.teller;
      const first = G.bankTeller;
      const near = !!(c && teller && Math.hypot(c.x - teller.x, c.z - teller.z) < 8);
      const other = !!(c && first && Math.hypot(c.x - first.x, c.z - first.z) > 2);
      G.time.dayT = 18 / 24;
      main.updateBankQueue(0.05);
      const night = !!(ped && ped.mesh && ped.mesh.visible === false);
      G.time.dayT = 12 / 24;
      if (c) c.t = 0.2;
      main.updateBankQueue(0.05);
      const day = !!(ped && ped.bankTeller && ped.mesh && ped.mesh.visible);
      const z0 = ped && ped.mesh ? ped.mesh.position.z : 0;
      if (c) c.t = 0.2 + Math.PI / 2.2;
      main.updateBankQueue(0.05);
      const shifted = !!(ped && ped.mesh && Math.abs(ped.mesh.position.z - z0) > 0.02);
      const tool = ped && ped.mesh && ped.mesh.getObjectByName('bank-stamp');
      if (c) c.t = 0.2;
      main.updateBankQueue(0.05);
      const r0 = tool ? tool.rotation.z : 0;
      if (c) c.t = 0.2 + Math.PI / 4.2;
      main.updateBankQueue(0.05);
      const swung = !!(tool && Math.abs(tool.rotation.z - r0) > 0.04);
      return {
        flag: !!(G.gameplay && G.gameplay.bankQueue),
        rec: !!(ped && ped.bankTeller),
        stamp, near, other, night, day, shifted, swung,
      };
    });
    assert(bankTellerB.flag && bankTellerB.rec && bankTellerB.stamp && bankTellerB.near && bankTellerB.other, 'a second teller works behind the Krung Thep Bank counter');
    assert(bankTellerB.night && bankTellerB.day && bankTellerB.shifted && bankTellerB.swung, 'they hide after hours and the stamp turns');

    console.log('\n[197] second U-Spray garage mechanic');
    const mechB = await page.evaluate(() => {
      const G = window.GAME, main = window.__REALISM_MAIN;
      const c = G.garageMechB;
      const ped = c && c.ped;
      const wrench = !!(ped && ped.mesh && ped.mesh.getObjectByName('garage-wrench'));
      const g = G.world && G.world.garages && G.world.garages[0];
      const first = G.garageMech;
      const near = !!(c && g && g.pos && Math.hypot(c.x - g.pos.x, c.z - g.pos.z) < 8);
      const other = !!(c && first && Math.hypot(c.x - first.x, c.z - first.z) > 2);
      G.time.dayT = 21 / 24;
      main.updateGarageMech(0.05);
      const night = !!(ped && ped.mesh && ped.mesh.visible === false);
      G.time.dayT = 12.5 / 24;
      if (c) c.t = 0.2;
      main.updateGarageMech(0.05);
      const day = !!(ped && ped.garageMech && ped.mesh && ped.mesh.visible);
      const z0 = ped && ped.mesh ? ped.mesh.position.z : 0;
      if (c) c.t = 0.2 + Math.PI / 2.2;
      main.updateGarageMech(0.05);
      const shifted = !!(ped && ped.mesh && Math.abs(ped.mesh.position.z - z0) > 0.02);
      const tool = ped && ped.mesh && ped.mesh.getObjectByName('garage-wrench');
      if (c) c.t = 0.2;
      main.updateGarageMech(0.05);
      const r0 = tool ? tool.rotation.z : 0;
      if (c) c.t = 0.2 + Math.PI / 4.2;
      main.updateGarageMech(0.05);
      const swung = !!(tool && Math.abs(tool.rotation.z - r0) > 0.04);
      return {
        flag: !!(G.gameplay && G.gameplay.garageMech),
        rec: !!(ped && ped.garageMech),
        wrench, near, other, night, day, shifted, swung,
      };
    });
    assert(mechB.flag && mechB.rec && mechB.wrench && mechB.near && mechB.other, 'a second mechanic waits at the U-Spray bay');
    assert(mechB.night && mechB.day && mechB.shifted && mechB.swung, 'they hide after 19:00 and the wrench turns');

    console.log('\n[198] second Suvarnabhumi tower controller');
    const towerB = await page.evaluate(() => {
      const G = window.GAME, main = window.__REALISM_MAIN;
      const c = G.towerCtlB;
      const ped = c && c.ped;
      const binocs = !!(ped && ped.mesh && ped.mesh.getObjectByName('tower-binocs'));
      const poi = G.world && G.world.poi && G.world.poi.airportTower;
      const first = G.towerCtl;
      const near = !!(c && poi && Math.hypot(c.x - poi.x, c.z - poi.z) < 8);
      const other = !!(c && first && Math.hypot(c.x - first.x, c.z - first.z) > 2);
      G.time.dayT = 23 / 24;
      main.updateAirportTower(0.05);
      const night = !!(ped && ped.mesh && ped.mesh.visible === false);
      G.time.dayT = 12.5 / 24;
      if (c) c.t = 0.2;
      main.updateAirportTower(0.05);
      const day = !!(ped && ped.airportTower && ped.mesh && ped.mesh.visible);
      const z0 = ped && ped.mesh ? ped.mesh.position.z : 0;
      if (c) c.t = 0.2 + Math.PI / 2.2;
      main.updateAirportTower(0.05);
      const shifted = !!(ped && ped.mesh && Math.abs(ped.mesh.position.z - z0) > 0.02);
      const tool = ped && ped.mesh && ped.mesh.getObjectByName('tower-binocs');
      if (c) c.t = 0.2;
      main.updateAirportTower(0.05);
      const r0 = tool ? tool.rotation.x : 0;
      if (c) c.t = 0.2 + Math.PI / 3.2;
      main.updateAirportTower(0.05);
      const swung = !!(tool && Math.abs(tool.rotation.x - r0) > 0.04);
      return {
        flag: !!(G.gameplay && G.gameplay.airportTower),
        rec: !!(ped && ped.airportTower),
        binocs, near, other, night, day, shifted, swung,
      };
    });
    assert(towerB.flag && towerB.rec && towerB.binocs && towerB.near && towerB.other, 'a second controller waits at the Suvarnabhumi tower');
    assert(towerB.night && towerB.day && towerB.shifted && towerB.swung, 'they hide after 22:00 and the binoculars tilt');

    console.log('\n[199] east mall guard at Terminal 21');
    const booth21B = await page.evaluate(() => {
      const G = window.GAME, main = window.__REALISM_MAIN;
      const g = G.mallGuardB;
      const first = G.mallGuard;
      const mall = G.world && G.world.poi && G.world.poi.terminal21;
      main.updatePeds(0.05);
      main.updateMallGuard(0.05);
      const ped = g && g.ped;
      const seated = !!(ped && ped.mallGuard && ped.mesh && ped.mesh.position.y >= 0.3);
      const chair = !!(g && g.chair && g.chair.name === 'east-mall-chair');
      const near = !!(mall && ped && ped.mesh && Math.hypot(ped.mesh.position.x - mall.x, ped.mesh.position.z - mall.z) < 8);
      const other = !!(g && first && Math.hypot(g.x - first.x, g.z - first.z) > 2);
      const torch = !!(ped && ped.mesh && ped.mesh.getObjectByName('flashlight'));
      G.time.dayT = 12 / 24;
      main.updateMallGuard(0.05);
      const dayOff = !!(g && g.beam && g.beam.visible === false && g.light && g.light.intensity === 0);
      G.time.dayT = 21.5 / 24;
      main.updateMallGuard(0.05);
      const nightOn = !!(g && g.beam && g.beam.visible && g.light && g.light.intensity > 0.4);
      return { flag: !!(G.gameplay && G.gameplay.mallGuard), seated, chair, near, other, torch, dayOff, nightOn };
    });
    assert(booth21B.flag && booth21B.seated && booth21B.chair && booth21B.near && booth21B.other, 'a second guard sits outside Terminal 21');
    assert(booth21B.torch && booth21B.dayOff && booth21B.nightOn, 'the east mall guard torch only comes on at night');

    console.log('\n[200] east bank guard at Krung Thep Bank');
    const bankBoothB = await page.evaluate(() => {
      const G = window.GAME, main = window.__REALISM_MAIN;
      const g = G.bankGuardB;
      const first = G.bankGuard;
      const bank = G.world && G.world.poi && G.world.poi.bank;
      main.updatePeds(0.05);
      main.updateBankGuard(0.05);
      const ped = g && g.ped;
      const seated = !!(ped && ped.bankGuard && ped.mesh && ped.mesh.position.y >= 0.3);
      const chair = !!(g && g.chair && g.chair.name === 'east-bank-chair');
      const near = !!(bank && ped && ped.mesh && Math.hypot(ped.mesh.position.x - bank.x, ped.mesh.position.z - bank.z) < 8);
      const other = !!(g && first && Math.hypot(g.x - first.x, g.z - first.z) > 2);
      const torch = !!(ped && ped.mesh && ped.mesh.getObjectByName('flashlight'));
      G.time.dayT = 12 / 24;
      main.updateBankGuard(0.05);
      const dayOff = !!(g && g.beam && g.beam.visible === false && g.light && g.light.intensity === 0);
      G.time.dayT = 21.5 / 24;
      main.updateBankGuard(0.05);
      const nightOn = !!(g && g.beam && g.beam.visible && g.light && g.light.intensity > 0.4);
      return { flag: !!(G.gameplay && G.gameplay.bankGuard), seated, chair, near, other, torch, dayOff, nightOn };
    });
    assert(bankBoothB.flag && bankBoothB.seated && bankBoothB.chair && bankBoothB.near && bankBoothB.other, 'a second guard sits outside Krung Thep Bank');
    assert(bankBoothB.torch && bankBoothB.dayOff && bankBoothB.nightOn, 'the east bank guard torch only comes on at night');

    console.log('\n[201] south Suvarnabhumi baggage handlers');
    const southBags = await page.evaluate(() => {
      const G = window.GAME, main = window.__REALISM_MAIN;
      const c = G.southAirportBags;
      const list = (c && c.hands) || [];
      const n = list.filter(p => p && p.airportBags && p.airportTaxi && p.mesh).length;
      const cases = list.filter(p => p && p.mesh && p.mesh.getObjectByName('bag-case')).length;
      const first = G.airportBags;
      const near = !!(c && Math.hypot(c.x - 209, c.z + 50) < 8);
      const other = !!(c && first && Math.hypot(c.x - first.x, c.z - first.z) > 2);
      G.time.dayT = 23 / 24;
      main.updateAirportTaxi(0.05);
      const night = list.filter(p => p && p.mesh && p.mesh.visible === false).length;
      G.time.dayT = 12.5 / 24;
      if (c) c.t = 0.2;
      main.updateAirportTaxi(0.05);
      const day = list.filter(p => p && p.airportBags && p.mesh && p.mesh.visible).length;
      const p0 = list[0];
      const x0 = p0 && p0.mesh ? p0.mesh.position.x : 0;
      if (c) c.t = 0.2 + Math.PI / 2.2;
      main.updateAirportTaxi(0.05);
      const shifted = !!(p0 && p0.mesh && Math.abs(p0.mesh.position.x - x0) > 0.02);
      const cse = p0 && p0.mesh && p0.mesh.getObjectByName('bag-case');
      if (c) c.t = 0.2;
      main.updateAirportTaxi(0.05);
      const r0 = cse ? cse.rotation.z : 0;
      if (c) c.t = 0.2 + Math.PI / 3.4;
      main.updateAirportTaxi(0.05);
      const swung = !!(cse && Math.abs(cse.rotation.z - r0) > 0.04);
      return {
        flag: !!(G.gameplay && G.gameplay.airportTaxi),
        n, cases, near, other, night, day, shifted, swung,
      };
    });
    assert(southBags.flag && southBags.n >= 2 && southBags.cases >= 2 && southBags.near && southBags.other, `baggage handlers wait at the south Suvarnabhumi terminal (${southBags.n})`);
    assert(southBags.night >= 2 && southBags.day >= 2 && southBags.shifted && southBags.swung, 'they hide after 22:00 and the cases tilt');

    console.log('\n[202] second Muay Thai gym waiting fighter');
    const gymWaitB = await page.evaluate(() => {
      const G = window.GAME, main = window.__REALISM_MAIN;
      const c = G.gymWaitB;
      const ped = c && c.ped;
      const wrap = !!(ped && ped.mesh && ped.mesh.getObjectByName('gym-wrap'));
      const gym = G.gymBag;
      const first = G.gymWait;
      const near = !!(c && gym && Math.hypot(c.x - gym.x, c.z - gym.z) < 4);
      const other = !!(c && first && Math.hypot(c.x - first.x, c.z - first.z) > 2);
      G.time.dayT = 22 / 24;
      main.updateGymBag(0.05);
      const night = !!(ped && ped.mesh && ped.mesh.visible === false);
      G.time.dayT = 12.5 / 24;
      if (c) c.t = 0.2;
      main.updateGymBag(0.05);
      const day = !!(ped && ped.gymBag && ped.gymWait && ped.mesh && ped.mesh.visible);
      const z0 = ped && ped.mesh ? ped.mesh.position.z : 0;
      if (c) c.t = 0.2 + Math.PI / 2.2;
      main.updateGymBag(0.05);
      const shifted = !!(ped && ped.mesh && Math.abs(ped.mesh.position.z - z0) > 0.02);
      const tool = ped && ped.mesh && ped.mesh.getObjectByName('gym-wrap');
      if (c) c.t = 0.2;
      main.updateGymBag(0.05);
      const r0 = tool ? tool.rotation.z : 0;
      if (c) c.t = 0.2 + Math.PI / 4.2;
      main.updateGymBag(0.05);
      const swung = !!(tool && Math.abs(tool.rotation.z - r0) > 0.04);
      return {
        flag: !!(G.gameplay && G.gameplay.gymBag),
        rec: !!(ped && ped.gymBag && ped.gymWait),
        wrap, near, other, night, day, shifted, swung,
      };
    });
    assert(gymWaitB.flag && gymWaitB.rec && gymWaitB.wrap && gymWaitB.near && gymWaitB.other, 'a second fighter waits at the Muay Thai gym');
    assert(gymWaitB.night && gymWaitB.day && gymWaitB.shifted && gymWaitB.swung, 'they hide after 21:00 and the hand wrap turns');

    console.log('\n[203] north Suvarnabhumi baggage handlers');
    const northBags = await page.evaluate(() => {
      const G = window.GAME, main = window.__REALISM_MAIN;
      const c = G.northAirportBags;
      const list = (c && c.hands) || [];
      const n = list.filter(p => p && p.airportBags && p.airportTaxi && p.mesh).length;
      const cases = list.filter(p => p && p.mesh && p.mesh.getObjectByName('bag-case')).length;
      const first = G.airportBags;
      const south = G.southAirportBags;
      const near = !!(c && Math.hypot(c.x - 209, c.z - 50) < 8);
      const other = !!(c && first && Math.hypot(c.x - first.x, c.z - first.z) > 2);
      const southOther = !!(c && south && Math.hypot(c.x - south.x, c.z - south.z) > 2);
      G.time.dayT = 23 / 24;
      main.updateAirportTaxi(0.05);
      const night = list.filter(p => p && p.mesh && p.mesh.visible === false).length;
      G.time.dayT = 12.5 / 24;
      if (c) c.t = 0.2;
      main.updateAirportTaxi(0.05);
      const day = list.filter(p => p && p.airportBags && p.mesh && p.mesh.visible).length;
      const p0 = list[0];
      const x0 = p0 && p0.mesh ? p0.mesh.position.x : 0;
      if (c) c.t = 0.2 + Math.PI / 2.2;
      main.updateAirportTaxi(0.05);
      const shifted = !!(p0 && p0.mesh && Math.abs(p0.mesh.position.x - x0) > 0.02);
      const cse = p0 && p0.mesh && p0.mesh.getObjectByName('bag-case');
      if (c) c.t = 0.2;
      main.updateAirportTaxi(0.05);
      const r0 = cse ? cse.rotation.z : 0;
      if (c) c.t = 0.2 + Math.PI / 3.4;
      main.updateAirportTaxi(0.05);
      const swung = !!(cse && Math.abs(cse.rotation.z - r0) > 0.04);
      return {
        flag: !!(G.gameplay && G.gameplay.airportTaxi),
        n, cases, near, other, southOther, night, day, shifted, swung,
      };
    });
    assert(northBags.flag && northBags.n >= 2 && northBags.cases >= 2 && northBags.near && northBags.other && northBags.southOther, `baggage handlers wait at the north Suvarnabhumi terminal (${northBags.n})`);
    assert(northBags.night >= 2 && northBags.day >= 2 && northBags.shifted && northBags.swung, 'they hide after 22:00 and the cases tilt');

    console.log('\n[204] second U-Spray garage waiting customer');
    const garageWaitB = await page.evaluate(() => {
      const G = window.GAME, main = window.__REALISM_MAIN;
      const c = G.garageWaitB;
      const ped = c && c.ped;
      const helm = !!(ped && ped.mesh && ped.mesh.getObjectByName('garage-helmet'));
      const mech = G.garageMechB;
      const first = G.garageWait;
      const near = !!(c && mech && Math.hypot(c.x - mech.x, c.z - mech.z) < 8);
      const other = !!(c && first && Math.hypot(c.x - first.x, c.z - first.z) > 2);
      G.time.dayT = 21 / 24;
      main.updateGarageMech(0.05);
      const night = !!(ped && ped.mesh && ped.mesh.visible === false);
      G.time.dayT = 12.5 / 24;
      if (c) c.t = 0.2;
      main.updateGarageMech(0.05);
      const day = !!(ped && ped.garageMech && ped.garageWait && ped.mesh && ped.mesh.visible);
      const z0 = ped && ped.mesh ? ped.mesh.position.z : 0;
      if (c) c.t = 0.2 + Math.PI / 2.2;
      main.updateGarageMech(0.05);
      const shifted = !!(ped && ped.mesh && Math.abs(ped.mesh.position.z - z0) > 0.02);
      const tool = ped && ped.mesh && ped.mesh.getObjectByName('garage-helmet');
      if (c) c.t = 0.2;
      main.updateGarageMech(0.05);
      const r0 = tool ? tool.rotation.z : 0;
      if (c) c.t = 0.2 + Math.PI / 4.2;
      main.updateGarageMech(0.05);
      const swung = !!(tool && Math.abs(tool.rotation.z - r0) > 0.04);
      return {
        flag: !!(G.gameplay && G.gameplay.garageMech),
        rec: !!(ped && ped.garageMech && ped.garageWait),
        helm, near, other, night, day, shifted, swung,
      };
    });
    assert(garageWaitB.flag && garageWaitB.rec && garageWaitB.helm && garageWaitB.near && garageWaitB.other, 'a second customer waits at the U-Spray bay');
    assert(garageWaitB.night && garageWaitB.day && garageWaitB.shifted && garageWaitB.swung, 'they hide after 19:00 and the helmet turns');

    console.log('\n[205] east wat merit-box attendant');
    const watMeritB = await page.evaluate(() => {
      const G = window.GAME, main = window.__REALISM_MAIN;
      const c = G.watMeritB;
      const ped = c && c.ped;
      const tray = !!(ped && ped.mesh && ped.mesh.getObjectByName('wat-merit-tray'));
      const box = !!(c && c.box && c.box.name === 'east-wat-merit-box');
      const first = G.watMerit;
      const temple = G.world && G.world.poi && G.world.poi.temple;
      const near = !!(c && temple && Math.hypot(c.x - temple.x, c.z - temple.z) < 16);
      const other = !!(c && first && Math.hypot(c.x - first.x, c.z - first.z) > 2);
      G.time.dayT = 19 / 24;
      main.updateWatLotus(0.05);
      const night = !!(ped && ped.mesh && ped.mesh.visible === false);
      G.time.dayT = 12 / 24;
      if (c) c.t = 0.2;
      main.updateWatLotus(0.05);
      const day = !!(ped && ped.watLotus && ped.watMerit && ped.mesh && ped.mesh.visible);
      const z0 = ped && ped.mesh ? ped.mesh.position.z : 0;
      if (c) c.t = 0.2 + Math.PI / 2.2;
      main.updateWatLotus(0.05);
      const shifted = !!(ped && ped.mesh && Math.abs(ped.mesh.position.z - z0) > 0.02);
      const tool = ped && ped.mesh && ped.mesh.getObjectByName('wat-merit-tray');
      if (c) c.t = 0.2;
      main.updateWatLotus(0.05);
      const r0 = tool ? tool.rotation.z : 0;
      if (c) c.t = 0.2 + Math.PI / 4.2;
      main.updateWatLotus(0.05);
      const swung = !!(tool && Math.abs(tool.rotation.z - r0) > 0.04);
      return {
        flag: !!(G.gameplay && G.gameplay.watLotus),
        rec: !!(ped && ped.watLotus && ped.watMerit),
        tray, box, near, other, night, day, shifted, swung,
      };
    });
    assert(watMeritB.flag && watMeritB.rec && watMeritB.tray && watMeritB.box && watMeritB.near && watMeritB.other, 'a second merit-box attendant waits at the wat east gate');
    assert(watMeritB.night && watMeritB.day && watMeritB.shifted && watMeritB.swung, 'they hide after 18:00 and the gold tray turns');

    console.log('\n[206] second Klong Toey yard checker');
    const klongCheckB = await page.evaluate(() => {
      const G = window.GAME, main = window.__REALISM_MAIN;
      const c = G.klongCheckB;
      const ped = c && c.ped;
      const clip = !!(ped && ped.mesh && ped.mesh.getObjectByName('klong-clip'));
      const dock = G.klongDock;
      const first = G.klongCheck;
      const near = !!(c && dock && Math.hypot(c.x - dock.x, c.z - dock.z) < 8);
      const other = !!(c && first && Math.hypot(c.x - first.x, c.z - first.z) > 2);
      G.time.dayT = 21 / 24;
      main.updateKlongDock(0.05);
      const night = !!(ped && ped.mesh && ped.mesh.visible === false);
      G.time.dayT = 12.5 / 24;
      if (c) c.t = 0.2;
      main.updateKlongDock(0.05);
      const day = !!(ped && ped.klongDock && ped.klongCheck && ped.mesh && ped.mesh.visible);
      const z0 = ped && ped.mesh ? ped.mesh.position.z : 0;
      if (c) c.t = 0.2 + Math.PI / 2.2;
      main.updateKlongDock(0.05);
      const shifted = !!(ped && ped.mesh && Math.abs(ped.mesh.position.z - z0) > 0.02);
      const tool = ped && ped.mesh && ped.mesh.getObjectByName('klong-clip');
      if (c) c.t = 0.2;
      main.updateKlongDock(0.05);
      const r0 = tool ? tool.rotation.z : 0;
      if (c) c.t = 0.2 + Math.PI / 4.2;
      main.updateKlongDock(0.05);
      const swung = !!(tool && Math.abs(tool.rotation.z - r0) > 0.04);
      return {
        flag: !!(G.gameplay && G.gameplay.klongDock),
        rec: !!(ped && ped.klongDock && ped.klongCheck),
        clip, near, other, night, day, shifted, swung,
      };
    });
    assert(klongCheckB.flag && klongCheckB.rec && klongCheckB.clip && klongCheckB.near && klongCheckB.other, 'a second checker waits at the Klong Toey yard');
    assert(klongCheckB.night && klongCheckB.day && klongCheckB.shifted && klongCheckB.swung, 'they hide after 19:00 and the clipboard turns');

    console.log('\n[207] second Uncle Seng gold-shop window shopper');
    const sengShopB = await page.evaluate(() => {
      const G = window.GAME, main = window.__REALISM_MAIN;
      const c = G.sengShopperB;
      const ped = c && c.ped;
      const chain = !!(ped && ped.mesh && ped.mesh.getObjectByName('seng-chain'));
      const clerk = G.sengClerk;
      const first = G.sengShopper;
      const near = !!(c && clerk && Math.hypot(c.x - clerk.x, c.z - clerk.z) < 4);
      const other = !!(c && first && Math.hypot(c.x - first.x, c.z - first.z) > 2);
      G.time.dayT = 21 / 24;
      main.updateSengClerk(0.05);
      const night = !!(ped && ped.mesh && ped.mesh.visible === false);
      G.time.dayT = 12.5 / 24;
      if (c) c.t = 0.2;
      main.updateSengClerk(0.05);
      const day = !!(ped && ped.sengClerk && ped.sengShop && ped.mesh && ped.mesh.visible);
      const z0 = ped && ped.mesh ? ped.mesh.position.z : 0;
      if (c) c.t = 0.2 + Math.PI / 2.2;
      main.updateSengClerk(0.05);
      const shifted = !!(ped && ped.mesh && Math.abs(ped.mesh.position.z - z0) > 0.02);
      const tool = ped && ped.mesh && ped.mesh.getObjectByName('seng-chain');
      if (c) c.t = 0.2;
      main.updateSengClerk(0.05);
      const r0 = tool ? tool.rotation.z : 0;
      if (c) c.t = 0.2 + Math.PI / 4.2;
      main.updateSengClerk(0.05);
      const swung = !!(tool && Math.abs(tool.rotation.z - r0) > 0.04);
      return {
        flag: !!(G.gameplay && G.gameplay.sengClerk),
        rec: !!(ped && ped.sengClerk && ped.sengShop),
        chain, near, other, night, day, shifted, swung,
      };
    });
    assert(sengShopB.flag && sengShopB.rec && sengShopB.chain && sengShopB.near && sengShopB.other, "a second window shopper waits at Uncle Seng's gold-shop door");
    assert(sengShopB.night && sengShopB.day && sengShopB.shifted && sengShopB.swung, 'they hide after 20:00 and the gold chain turns');

    console.log('\n[208] second pier ticket clerk');
    const pierClerkB = await page.evaluate(() => {
      const G = window.GAME, main = window.__REALISM_MAIN;
      const c = G.pierClerkB;
      const ped = c && c.ped;
      const ticket = !!(ped && ped.mesh && ped.mesh.getObjectByName('pier-ticket'));
      const wait = G.pierWait;
      const first = G.pierClerk;
      const near = !!(c && wait && Math.hypot(c.x - wait.x, c.z - wait.z) < 6);
      const other = !!(c && first && Math.hypot(c.x - first.x, c.z - first.z) > 2);
      G.time.dayT = 22 / 24;
      main.updatePierWait(0.05);
      const night = !!(ped && ped.mesh && ped.mesh.visible === false);
      G.time.dayT = 12 / 24;
      if (c) c.t = 0.2;
      main.updatePierWait(0.05);
      const day = !!(ped && ped.pierWait && ped.pierClerk && ped.mesh && ped.mesh.visible);
      const z0 = ped && ped.mesh ? ped.mesh.position.z : 0;
      if (c) c.t = 0.2 + Math.PI / 2.2;
      main.updatePierWait(0.05);
      const shifted = !!(ped && ped.mesh && Math.abs(ped.mesh.position.z - z0) > 0.02);
      const tool = ped && ped.mesh && ped.mesh.getObjectByName('pier-ticket');
      if (c) c.t = 0.2;
      main.updatePierWait(0.05);
      const r0 = tool ? tool.rotation.z : 0;
      if (c) c.t = 0.2 + Math.PI / 4.2;
      main.updatePierWait(0.05);
      const swung = !!(tool && Math.abs(tool.rotation.z - r0) > 0.04);
      return {
        flag: !!(G.gameplay && G.gameplay.pierWait),
        rec: !!(ped && ped.pierWait && ped.pierClerk),
        ticket, near, other, night, day, shifted, swung,
      };
    });
    assert(pierClerkB.flag && pierClerkB.rec && pierClerkB.ticket && pierClerkB.near && pierClerkB.other, 'a second ticket clerk waits at the pier');
    assert(pierClerkB.night && pierClerkB.day && pierClerkB.shifted && pierClerkB.swung, 'they hide after 21:00 and the ticket pad turns');

    console.log('\n[209] west Suvarnabhumi cargo shed');
    const westCargo = await page.evaluate(() => {
      const G = window.GAME, main = window.__REALISM_MAIN;
      const c = G.westAirportCargo;
      const list = (c && c.hands) || [];
      const n = list.filter(p => p && p.airportCargo && p.mesh).length;
      const crates = list.filter(p => p && p.mesh && p.mesh.getObjectByName('cargo-crate')).length;
      const first = G.airportCargo;
      const near = !!(c && Math.hypot(c.x - 209, c.z + 118) < 8);
      const other = !!(c && first && Math.abs((c.hx || 0) - (first.hx || 0)) > 2);
      G.time.dayT = 21 / 24;
      main.updateAirportCargo(0.05);
      const night = list.filter(p => p && p.mesh && p.mesh.visible === false).length;
      G.time.dayT = 12.5 / 24;
      if (c) c.t = 0.2;
      main.updateAirportCargo(0.05);
      const day = list.filter(p => p && p.airportCargo && p.mesh && p.mesh.visible).length;
      const p0 = list[0];
      const x0 = p0 && p0.mesh ? p0.mesh.position.x : 0;
      if (c) c.t = 0.2 + Math.PI / 2.2;
      main.updateAirportCargo(0.05);
      const shifted = !!(p0 && p0.mesh && Math.abs(p0.mesh.position.x - x0) > 0.02);
      const crate = p0 && p0.mesh && p0.mesh.getObjectByName('cargo-crate');
      if (c) c.t = 0.2;
      main.updateAirportCargo(0.05);
      const r0 = crate ? crate.rotation.z : 0;
      if (c) c.t = 0.2 + Math.PI / 3.4;
      main.updateAirportCargo(0.05);
      const swung = !!(crate && Math.abs(crate.rotation.z - r0) > 0.04);
      return {
        flag: !!(G.gameplay && G.gameplay.airportCargo),
        n, crates, near, other, night, day, shifted, swung,
      };
    });
    assert(westCargo.flag && westCargo.n >= 2 && westCargo.crates >= 2 && westCargo.near && westCargo.other, `cargo hands wait at the west Suvarnabhumi shed (${westCargo.n})`);
    assert(westCargo.night >= 2 && westCargo.day >= 2 && westCargo.shifted && westCargo.swung, 'they hide after 19:00 and the crates tilt');

    console.log('\n[210] east Suvarnabhumi apron marshallers');
    const eastCrew = await page.evaluate(() => {
      const G = window.GAME, main = window.__REALISM_MAIN;
      const c = G.eastAirportCrew;
      const list = (c && c.hands) || [];
      const n = list.filter(p => p && p.airportCrew && p.mesh).length;
      const paddles = list.filter(p => p && p.mesh && p.mesh.getObjectByName('marshal-paddle')).length;
      const first = G.airportCrew;
      const poi = G.world && G.world.poi && G.world.poi.suvarnabhumi;
      const near = !!(c && poi && Math.hypot(c.x - poi.x, c.z - poi.z) < 8);
      const other = !!(c && first && Math.abs((c.hx || 0) - (first.hx || 0)) > 2);
      G.time.dayT = 22 / 24;
      main.updateAirportCrew(0.05);
      const night = list.filter(p => p && p.mesh && p.mesh.visible === false).length;
      G.time.dayT = 12.5 / 24;
      if (c) c.t = 0.2;
      main.updateAirportCrew(0.05);
      const day = list.filter(p => p && p.airportCrew && p.mesh && p.mesh.visible).length;
      const p0 = list[0];
      const x0 = p0 && p0.mesh ? p0.mesh.position.x : 0;
      if (c) c.t = 0.2 + Math.PI / 2.2;
      main.updateAirportCrew(0.05);
      const shifted = !!(p0 && p0.mesh && Math.abs(p0.mesh.position.x - x0) > 0.02);
      const paddle = p0 && p0.mesh && p0.mesh.getObjectByName('marshal-paddle');
      if (c) c.t = 0.2;
      main.updateAirportCrew(0.05);
      const r0 = paddle ? paddle.rotation.z : 0;
      if (c) c.t = 0.2 + Math.PI / 3.6;
      main.updateAirportCrew(0.05);
      const swung = !!(paddle && Math.abs(paddle.rotation.z - r0) > 0.04);
      return {
        flag: !!(G.gameplay && G.gameplay.airportCrew),
        n, paddles, near, other, night, day, shifted, swung,
      };
    });
    assert(eastCrew.flag && eastCrew.n >= 2 && eastCrew.paddles >= 2 && eastCrew.near && eastCrew.other, `marshallers wait on the east Suvarnabhumi apron (${eastCrew.n})`);
    assert(eastCrew.night >= 2 && eastCrew.day >= 2 && eastCrew.shifted && eastCrew.swung, 'they hide after 21:00 and the paddles wave');

    console.log('\n[211] north Hua Lamphong station porters');
    const northPorters = await page.evaluate(() => {
      const G = window.GAME, main = window.__REALISM_MAIN;
      const c = G.northStationPorter;
      const list = (c && c.porters) || [];
      const n = list.filter(p => p && p.stationPorter && p.mesh).length;
      const bags = list.filter(p => p && p.mesh && p.mesh.getObjectByName('station-bag')).length;
      const first = G.stationPorter;
      const spawn = G.world && G.world.spawns && G.world.spawns.player;
      const near = !!(c && spawn && Math.hypot(c.x - spawn.x, c.z - spawn.z) < 8);
      const s0 = list[0] && list[0].anchor && list[0].anchor.slot;
      const f0 = first && first.porters && first.porters[0] && first.porters[0].anchor && first.porters[0].anchor.slot;
      const other = !!(s0 && f0 && Math.hypot(s0.x - f0.x, s0.z - f0.z) > 2);
      G.time.dayT = 23 / 24;
      main.updateStationPorter(0.05);
      const night = list.filter(p => p && p.mesh && p.mesh.visible === false).length;
      G.time.dayT = 12.5 / 24;
      if (c) c.t = 0.2;
      main.updateStationPorter(0.05);
      const day = list.filter(p => p && p.stationPorter && p.mesh && p.mesh.visible).length;
      const p0 = list[0];
      const x0 = p0 && p0.mesh ? p0.mesh.position.x : 0;
      if (c) c.t = 0.2 + Math.PI / 2.2;
      main.updateStationPorter(0.05);
      const shifted = !!(p0 && p0.mesh && Math.abs(p0.mesh.position.x - x0) > 0.02);
      const bag = p0 && p0.mesh && p0.mesh.getObjectByName('station-bag');
      if (c) c.t = 0.2;
      main.updateStationPorter(0.05);
      const r0 = bag ? bag.rotation.z : 0;
      if (c) c.t = 0.2 + Math.PI / 3.2;
      main.updateStationPorter(0.05);
      const swung = !!(bag && Math.abs(bag.rotation.z - r0) > 0.04);
      return {
        flag: !!(G.gameplay && G.gameplay.stationPorter),
        n, bags, near, other, night, day, shifted, swung,
      };
    });
    assert(northPorters.flag && northPorters.n >= 2 && northPorters.bags >= 2 && northPorters.near && northPorters.other, `porters wait north of the Hua Lamphong canopy (${northPorters.n})`);
    assert(northPorters.night >= 2 && northPorters.day >= 2 && northPorters.shifted && northPorters.swung, 'they hide after 22:00 and the bags swing');

    console.log('\n[212] west Klong Toey dockhands');
    const westDock = await page.evaluate(() => {
      const G = window.GAME, main = window.__REALISM_MAIN;
      const c = G.klongDockB;
      const list = (c && c.hands) || [];
      const n = list.filter(p => p && p.klongDock && p.mesh).length;
      const crates = list.filter(p => p && p.mesh && p.mesh.getObjectByName('dock-crate')).length;
      const first = G.klongDock;
      const poi = G.world && G.world.poi && G.world.poi.klongToey;
      const near = !!(c && poi && Math.hypot(c.x - poi.x, c.z - poi.z) < 8);
      const s0 = list[0] && list[0].anchor && list[0].anchor.slot;
      const f0 = first && first.hands && first.hands[0] && first.hands[0].anchor && first.hands[0].anchor.slot;
      const other = !!(s0 && f0 && Math.hypot(s0.x - f0.x, s0.z - f0.z) > 2);
      G.time.dayT = 21 / 24;
      main.updateKlongDock(0.05);
      const night = list.filter(p => p && p.mesh && p.mesh.visible === false).length;
      G.time.dayT = 12.5 / 24;
      if (c) c.t = 0.2;
      main.updateKlongDock(0.05);
      const day = list.filter(p => p && p.klongDock && p.mesh && p.mesh.visible).length;
      const p0 = list[0];
      const x0 = p0 && p0.mesh ? p0.mesh.position.x : 0;
      if (c) c.t = 0.2 + Math.PI / 2.2;
      main.updateKlongDock(0.05);
      const shifted = !!(p0 && p0.mesh && Math.abs(p0.mesh.position.x - x0) > 0.02);
      const crate = p0 && p0.mesh && p0.mesh.getObjectByName('dock-crate');
      if (c) c.t = 0.2;
      main.updateKlongDock(0.05);
      const r0 = crate ? crate.rotation.z : 0;
      if (c) c.t = 0.2 + Math.PI / 3.4;
      main.updateKlongDock(0.05);
      const swung = !!(crate && Math.abs(crate.rotation.z - r0) > 0.04);
      return {
        flag: !!(G.gameplay && G.gameplay.klongDock),
        n, crates, near, other, night, day, shifted, swung,
      };
    });
    assert(westDock.flag && westDock.n >= 2 && westDock.crates >= 2 && westDock.near && westDock.other, `dockhands wait west of the Klong Toey yard (${westDock.n})`);
    assert(westDock.night >= 2 && westDock.day >= 2 && westDock.shifted && westDock.swung, 'they hide after 19:00 and the crates tilt');

    console.log('\n[213] second neighbor at the safehouse');
    const auntieB = await page.evaluate(() => {
      const G = window.GAME, main = window.__REALISM_MAIN;
      const c = G.homeAuntieB;
      const ped = c && c.ped;
      const paper = !!(ped && ped.mesh && ped.mesh.getObjectByName('home-paper'));
      const chair = !!(c && c.chair && c.chair.name === 'east-home-chair');
      const first = G.homeAuntie;
      const door = G.world && G.world.poi && G.world.poi.safehouse;
      const near = !!(c && door && Math.hypot(c.x - door.x, c.z - door.z) < 5);
      const other = !!(c && first && Math.hypot(c.x - first.x, c.z - first.z) > 2);
      G.time.dayT = 23 / 24;
      main.updateHomeAuntie(0.05);
      const night = !!(ped && ped.mesh && ped.mesh.visible === false);
      G.time.dayT = 12.5 / 24;
      if (c) c.t = 0.2;
      main.updateHomeAuntie(0.05);
      main.updatePeds(0.05);
      const day = !!(ped && ped.homeAuntie && ped.mesh && ped.mesh.visible && ped.mesh.position.y >= 0.3);
      const parts = ped && ped.mesh && ped.mesh.userData && ped.mesh.userData.parts;
      const folded = !!(parts && parts.legL && parts.legL.rotation.x > 0.8);
      const page = ped && ped.mesh && ped.mesh.getObjectByName('home-paper-page');
      if (c) c.t = 0.2;
      main.updateHomeAuntie(0.05);
      const r0 = page ? page.rotation.x : 0;
      if (c) c.t = 0.2 + Math.PI / 2.8;
      main.updateHomeAuntie(0.05);
      const flipped = !!(page && Math.abs(page.rotation.x - r0) > 0.04);
      return {
        flag: !!(G.gameplay && G.gameplay.homeAuntie),
        rec: !!(ped && ped.homeAuntie),
        paper, chair, near, other, night, day, folded, flipped,
      };
    });
    assert(auntieB.flag && auntieB.rec && auntieB.paper && auntieB.chair && auntieB.near && auntieB.other, 'a second neighbor sits beside the safehouse');
    assert(auntieB.night && auntieB.day && auntieB.folded && auntieB.flipped, 'they hide after 22:00 and turn pages on the plastic chair');

    console.log('\n[214] south Hua Lamphong platform sitters');
    const southSit = await page.evaluate(() => {
      const G = window.GAME, main = window.__REALISM_MAIN;
      const c = G.southStationSit;
      const list = (c && c.sitters) || [];
      const n = list.filter(p => p && p.stationSit && p.stationPorter && p.mesh).length;
      const phones = list.filter(p => p && p.mesh && p.mesh.getObjectByName('station-phone')).length;
      const first = G.stationSit;
      const spawn = G.world && G.world.spawns && G.world.spawns.player;
      const near = !!(c && spawn && Math.hypot(c.x - spawn.x, c.z - spawn.z) < 8);
      const s0 = list[0] && list[0].anchor && list[0].anchor.slot;
      const f0 = first && first.sitters && first.sitters[0] && first.sitters[0].anchor && first.sitters[0].anchor.slot;
      const other = !!(s0 && f0 && Math.hypot(s0.x - f0.x, s0.z - f0.z) > 2);
      G.time.dayT = 3 / 24;
      main.updateStationPorter(0.05);
      const late = list.filter(p => p && p.mesh && p.mesh.visible === false).length;
      G.time.dayT = 12 / 24;
      if (c) c.t = 0.2;
      main.updatePeds(0.05);
      main.updateStationPorter(0.05);
      const day = list.filter(p => p && p.stationSit && p.mesh && p.mesh.visible).length;
      const seated = list.filter(p => p && p.mesh && p.mesh.position.y >= 0.3).length;
      const p0 = list[0];
      const parts = p0 && p0.mesh && p0.mesh.userData && p0.mesh.userData.parts;
      const folded = !!(parts && parts.legL && parts.legL.rotation.x > 0.8);
      const phone = p0 && p0.mesh && p0.mesh.getObjectByName('station-phone');
      const e0 = phone && phone.material ? phone.material.emissiveIntensity : 0;
      if (c) c.t = 0.2 + Math.PI / 3.4;
      main.updateStationPorter(0.05);
      const glowed = !!(phone && phone.material && Math.abs(phone.material.emissiveIntensity - e0) > 0.04);
      return {
        flag: !!(G.gameplay && G.gameplay.stationPorter),
        n, phones, near, other, late, day, seated, folded, glowed,
      };
    });
    assert(southSit.flag && southSit.n >= 2 && southSit.phones >= 2 && southSit.near && southSit.other, `passengers sit south of the Hua Lamphong platform (${southSit.n})`);
    assert(southSit.late >= 2 && southSit.day >= 2 && southSit.seated >= 2 && southSit.folded && southSit.glowed, 'they hide late, sit with phones, and the screens glow');

    console.log('\n[215] second Sukhumvit gun shop customer');
    const gunShopperB = await page.evaluate(() => {
      const G = window.GAME, main = window.__REALISM_MAIN;
      const c = G.gunShopperB;
      const ped = c && c.ped;
      const cse = !!(ped && ped.mesh && ped.mesh.getObjectByName('gun-case'));
      const clerk = G.gunClerk;
      const first = G.gunShopper;
      const near = !!(c && clerk && Math.hypot(c.x - clerk.x, c.z - clerk.z) < 4);
      const other = !!(c && first && Math.hypot(c.x - first.x, c.z - first.z) > 2);
      G.time.dayT = 22.4 / 24;
      main.updateGunClerk(0.05);
      const night = !!(ped && ped.mesh && ped.mesh.visible === false);
      G.time.dayT = 12 / 24;
      if (c) c.t = 0.2;
      main.updateGunClerk(0.05);
      const day = !!(ped && ped.gunClerk && ped.gunShop && ped.mesh && ped.mesh.visible);
      const z0 = ped && ped.mesh ? ped.mesh.position.z : 0;
      if (c) c.t = 0.2 + Math.PI / 2.2;
      main.updateGunClerk(0.05);
      const shifted = !!(ped && ped.mesh && Math.abs(ped.mesh.position.z - z0) > 0.02);
      const tool = ped && ped.mesh && ped.mesh.getObjectByName('gun-case');
      if (c) c.t = 0.2;
      main.updateGunClerk(0.05);
      const r0 = tool ? tool.rotation.z : 0;
      if (c) c.t = 0.2 + Math.PI / 4.2;
      main.updateGunClerk(0.05);
      const swung = !!(tool && Math.abs(tool.rotation.z - r0) > 0.04);
      return {
        flag: !!(G.gameplay && G.gameplay.gunClerk),
        rec: !!(ped && ped.gunClerk && ped.gunShop),
        cse, near, other, night, day, shifted, swung,
      };
    });
    assert(gunShopperB.flag && gunShopperB.rec && gunShopperB.cse && gunShopperB.near && gunShopperB.other, 'a second customer waits at the Sukhumvit Gun Shop counter');
    assert(gunShopperB.night && gunShopperB.day && gunShopperB.shifted && gunShopperB.swung, 'they hide after hours and the gun case turns');

    console.log('\n[216] second Hua Lamphong starter gun customer');
    const starterShopperB = await page.evaluate(() => {
      const G = window.GAME, main = window.__REALISM_MAIN;
      const c = G.starterShopperB;
      const ped = c && c.ped;
      const cse = !!(ped && ped.mesh && ped.mesh.getObjectByName('starter-case'));
      const clerk = G.starterClerk;
      const first = G.starterShopper;
      const near = !!(c && clerk && Math.hypot(c.x - clerk.x, c.z - clerk.z) < 4);
      const other = !!(c && first && Math.hypot(c.x - first.x, c.z - first.z) > 2);
      G.time.dayT = 22 / 24;
      main.updateStarterClerk(0.05);
      const night = !!(ped && ped.mesh && ped.mesh.visible === false);
      G.time.dayT = 12.5 / 24;
      if (c) c.t = 0.2;
      main.updateStarterClerk(0.05);
      const day = !!(ped && ped.starterClerk && ped.starterShop && ped.mesh && ped.mesh.visible);
      const z0 = ped && ped.mesh ? ped.mesh.position.z : 0;
      if (c) c.t = 0.2 + Math.PI / 2.2;
      main.updateStarterClerk(0.05);
      const shifted = !!(ped && ped.mesh && Math.abs(ped.mesh.position.z - z0) > 0.02);
      const tool = ped && ped.mesh && ped.mesh.getObjectByName('starter-case');
      if (c) c.t = 0.2;
      main.updateStarterClerk(0.05);
      const r0 = tool ? tool.rotation.z : 0;
      if (c) c.t = 0.2 + Math.PI / 4.2;
      main.updateStarterClerk(0.05);
      const swung = !!(tool && Math.abs(tool.rotation.z - r0) > 0.04);
      return {
        flag: !!(G.gameplay && G.gameplay.starterClerk),
        rec: !!(ped && ped.starterClerk && ped.starterShop),
        cse, near, other, night, day, shifted, swung,
      };
    });
    assert(starterShopperB.flag && starterShopperB.rec && starterShopperB.cse && starterShopperB.near && starterShopperB.other, 'a second customer waits at the Hua Lamphong starter gun counter');
    assert(starterShopperB.night && starterShopperB.day && starterShopperB.shifted && starterShopperB.swung, 'they hide after hours and the gun case turns');

    console.log('\n[217] north Terminal 21 directory');
    const northDir = await page.evaluate(() => {
      const G = window.GAME, main = window.__REALISM_MAIN;
      const c = G.mallDirB;
      const first = G.mallDir;
      const named = !!(c && c.mesh && c.mesh.name === 'north-mall-directory');
      const screen = !!(c && c.screen && c.screen.name === 'north-mall-dir-screen');
      const mall = G.world && G.world.mall && G.world.mall.center;
      const near = !!(c && mall && Math.hypot(c.x - mall.x, c.z - mall.z) < 8);
      const other = !!(c && first && Math.hypot(c.x - first.x, c.z - first.z) > 6);
      G.time.dayT = 23 / 24;
      main.updateMallDirectory(0.05);
      const night = !!(c && c.clerk && c.clerk.mesh && c.clerk.mesh.visible === false);
      G.time.dayT = 12 / 24;
      if (c) c.t = 0.2;
      main.updateMallDirectory(0.05);
      const day = !!(c && c.clerk && c.clerk.mallDir && c.clerk.mesh && c.clerk.mesh.visible);
      const glow0 = c && c.screen && c.screen.material ? c.screen.material.emissiveIntensity : 0;
      if (c) c.t = 0.2 + Math.PI / 3.2;
      main.updateMallDirectory(0.05);
      const glowed = !!(c && c.screen && Math.abs(c.screen.material.emissiveIntensity - glow0) > 0.02);
      G.player.inVehicle = null;
      G._eating = null;
      if (c && c.mesh) G.player.group.position.set(c.x, 0, c.z + 1.6);
      G._mallDir = 0;
      G._mallDirShop = null;
      window.dispatchEvent(new KeyboardEvent('keyup', { code: 'KeyE' }));
      if (G.input && G.input.endFrame) G.input.endFrame();
      let asked = false;
      for (let i = 0; i < 4 && !asked; i++) {
        window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyE' }));
        main.updateMallDirectory(0.016);
        window.dispatchEvent(new KeyboardEvent('keyup', { code: 'KeyE' }));
        if (G.input && G.input.endFrame) G.input.endFrame();
        asked = (G._mallDir || 0) >= 1 && !!G._mallDirShop;
      }
      return {
        flag: !!(G.gameplay && G.gameplay.mallDir),
        named, screen, near, other, night, day, glowed, asked, shop: G._mallDirShop,
      };
    });
    assert(northDir.flag && northDir.named && northDir.screen && northDir.near && northDir.other, 'a second directory board waits north in Terminal 21');
    assert(northDir.night && northDir.day && northDir.glowed && northDir.asked, 'the north clerk works the desk and E names a shop');

    console.log('\n[218] slushie machine at the south 7-Eleven');
    const southSlush = await page.evaluate(() => {
      const G = window.GAME, main = window.__REALISM_MAIN;
      const c = G.southSevenSlush;
      const first = G.sevenSlush;
      const named = !!(c && c.mesh && c.mesh.name === 'south-seven-slush');
      const n = c && c.mesh ? c.mesh.children.filter(ch => ch && ch.name === 'seven-slush-tank').length : 0;
      const cup = !!(c && c.customer && (c.customer._slushCup || (c.customer.mesh && c.customer.mesh.getObjectByName('seven-slush-cup'))));
      const south = (G.world.sevenElevens || []).find(s => s && s.pos && Math.abs(s.pos.x) < 8 && s.pos.z < -80);
      const near = !!(c && south && south.pos && Math.hypot(c.x - south.pos.x, c.z - south.pos.z) < 8);
      const other = !!(c && first && Math.hypot(c.x - first.x, c.z - first.z) > 40);
      G.time.dayT = 23 / 24;
      main.updateSevenSlush(0.05);
      const late = !!(c && c.customer && c.customer.mesh && c.customer.mesh.visible === false);
      G.time.dayT = 12 / 24;
      if (c) c.t = 0.2;
      main.updateSevenSlush(0.05);
      const day = !!(c && c.customer && c.customer.sevenSlush && c.customer.mesh && c.customer.mesh.visible);
      const t0 = c && c.mesh && c.mesh.children.find(ch => ch && ch.name === 'seven-slush-tank');
      const r0 = t0 ? t0.rotation.y : 0;
      if (c) c.t = 0.2 + 0.4;
      main.updateSevenSlush(0.05);
      const spun = !!(t0 && Math.abs(t0.rotation.y - r0) > 0.4);
      G.player.inVehicle = null;
      G._eating = null;
      if (c && c.mesh) G.player.group.position.copy(c.mesh.position);
      G.cash = 50;
      G._sevenSlush = 0;
      const stam0 = G.player.stam;
      G.player.stam = Math.max(0, (G.player.stamMax || 100) * 0.2);
      window.dispatchEvent(new KeyboardEvent('keyup', { code: 'KeyE' }));
      if (G.input && G.input.endFrame) G.input.endFrame();
      let paid = false;
      for (let i = 0; i < 4 && !paid; i++) {
        window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyE' }));
        main.updateSevenSlush(0.016);
        window.dispatchEvent(new KeyboardEvent('keyup', { code: 'KeyE' }));
        if (G.input && G.input.endFrame) G.input.endFrame();
        paid = G.cash === 25 && (G._sevenSlush || 0) >= 1 && G.player.stam === G.player.stamMax;
      }
      G.player.stam = stam0;
      return {
        flag: !!(G.gameplay && G.gameplay.sevenSlush),
        named, n, cup, near, other, late, day, spun, paid,
      };
    });
    assert(southSlush.flag && southSlush.named && southSlush.n >= 2 && southSlush.cup && southSlush.near && southSlush.other, `a slushie machine waits inside the south 7-Eleven (${southSlush.n})`);
    assert(southSlush.late && southSlush.day && southSlush.spun && southSlush.paid, 'the south tanks spin and E buys a slushie for ฿25');

    console.log('\n[219] slushie machine at the west 7-Eleven');
    const westSlush = await page.evaluate(() => {
      const G = window.GAME, main = window.__REALISM_MAIN;
      const c = G.westSevenSlush;
      const first = G.sevenSlush;
      const named = !!(c && c.mesh && c.mesh.name === 'west-seven-slush');
      const n = c && c.mesh ? c.mesh.children.filter(ch => ch && ch.name === 'seven-slush-tank').length : 0;
      const cup = !!(c && c.customer && (c.customer._slushCup || (c.customer.mesh && c.customer.mesh.getObjectByName('seven-slush-cup'))));
      const west = (G.world.sevenElevens || []).find(s => s && s.pos && s.pos.x < -50 && s.pos.z > 0 && s.pos.z < 60);
      const near = !!(c && west && west.pos && Math.hypot(c.x - west.pos.x, c.z - west.pos.z) < 8);
      const other = !!(c && first && Math.hypot(c.x - first.x, c.z - first.z) > 40);
      G.time.dayT = 23 / 24;
      main.updateSevenSlush(0.05);
      const late = !!(c && c.customer && c.customer.mesh && c.customer.mesh.visible === false);
      G.time.dayT = 12 / 24;
      if (c) c.t = 0.2;
      main.updateSevenSlush(0.05);
      const day = !!(c && c.customer && c.customer.sevenSlush && c.customer.mesh && c.customer.mesh.visible);
      const t0 = c && c.mesh && c.mesh.children.find(ch => ch && ch.name === 'seven-slush-tank');
      const r0 = t0 ? t0.rotation.y : 0;
      if (c) c.t = 0.2 + 0.4;
      main.updateSevenSlush(0.05);
      const spun = !!(t0 && Math.abs(t0.rotation.y - r0) > 0.4);
      G.player.inVehicle = null;
      G._eating = null;
      if (c && c.mesh) G.player.group.position.copy(c.mesh.position);
      G.cash = 50;
      G._sevenSlush = 0;
      const stam0 = G.player.stam;
      G.player.stam = Math.max(0, (G.player.stamMax || 100) * 0.2);
      window.dispatchEvent(new KeyboardEvent('keyup', { code: 'KeyE' }));
      if (G.input && G.input.endFrame) G.input.endFrame();
      let paid = false;
      for (let i = 0; i < 4 && !paid; i++) {
        window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyE' }));
        main.updateSevenSlush(0.016);
        window.dispatchEvent(new KeyboardEvent('keyup', { code: 'KeyE' }));
        if (G.input && G.input.endFrame) G.input.endFrame();
        paid = G.cash === 25 && (G._sevenSlush || 0) >= 1 && G.player.stam === G.player.stamMax;
      }
      G.player.stam = stam0;
      return {
        flag: !!(G.gameplay && G.gameplay.sevenSlush),
        named, n, cup, near, other, late, day, spun, paid,
      };
    });
    assert(westSlush.flag && westSlush.named && westSlush.n >= 2 && westSlush.cup && westSlush.near && westSlush.other, `a slushie machine waits inside the west 7-Eleven (${westSlush.n})`);
    assert(westSlush.late && westSlush.day && westSlush.spun && westSlush.paid, 'the west tanks spin and E buys a slushie for ฿25');

    console.log('\n[220] slushie machine at the east 7-Eleven');
    const eastSlush = await page.evaluate(() => {
      const G = window.GAME, main = window.__REALISM_MAIN;
      const c = G.eastSevenSlush;
      const first = G.sevenSlush;
      const named = !!(c && c.mesh && c.mesh.name === 'east-seven-slush');
      const n = c && c.mesh ? c.mesh.children.filter(ch => ch && ch.name === 'seven-slush-tank').length : 0;
      const cup = !!(c && c.customer && (c.customer._slushCup || (c.customer.mesh && c.customer.mesh.getObjectByName('seven-slush-cup'))));
      const east = (G.world.sevenElevens || []).find(s => s && s.pos && s.pos.x > 100 && s.pos.z < 0 && s.pos.z > -80);
      const near = !!(c && east && east.pos && Math.hypot(c.x - east.pos.x, c.z - east.pos.z) < 8);
      const other = !!(c && first && Math.hypot(c.x - first.x, c.z - first.z) > 40);
      G.time.dayT = 23 / 24;
      main.updateSevenSlush(0.05);
      const late = !!(c && c.customer && c.customer.mesh && c.customer.mesh.visible === false);
      G.time.dayT = 12 / 24;
      if (c) c.t = 0.2;
      main.updateSevenSlush(0.05);
      const day = !!(c && c.customer && c.customer.sevenSlush && c.customer.mesh && c.customer.mesh.visible);
      const t0 = c && c.mesh && c.mesh.children.find(ch => ch && ch.name === 'seven-slush-tank');
      const r0 = t0 ? t0.rotation.y : 0;
      if (c) c.t = 0.2 + 0.4;
      main.updateSevenSlush(0.05);
      const spun = !!(t0 && Math.abs(t0.rotation.y - r0) > 0.4);
      G.player.inVehicle = null;
      G._eating = null;
      if (c && c.mesh) G.player.group.position.copy(c.mesh.position);
      G.cash = 50;
      G._sevenSlush = 0;
      const stam0 = G.player.stam;
      G.player.stam = Math.max(0, (G.player.stamMax || 100) * 0.2);
      window.dispatchEvent(new KeyboardEvent('keyup', { code: 'KeyE' }));
      if (G.input && G.input.endFrame) G.input.endFrame();
      let paid = false;
      for (let i = 0; i < 4 && !paid; i++) {
        window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyE' }));
        main.updateSevenSlush(0.016);
        window.dispatchEvent(new KeyboardEvent('keyup', { code: 'KeyE' }));
        if (G.input && G.input.endFrame) G.input.endFrame();
        paid = G.cash === 25 && (G._sevenSlush || 0) >= 1 && G.player.stam === G.player.stamMax;
      }
      G.player.stam = stam0;
      return {
        flag: !!(G.gameplay && G.gameplay.sevenSlush),
        named, n, cup, near, other, late, day, spun, paid,
      };
    });
    assert(eastSlush.flag && eastSlush.named && eastSlush.n >= 2 && eastSlush.cup && eastSlush.near && eastSlush.other, `a slushie machine waits inside the east 7-Eleven (${eastSlush.n})`);
    assert(eastSlush.late && eastSlush.day && eastSlush.spun && eastSlush.paid, 'the east tanks spin and E buys a slushie for ฿25');

    console.log('\n[221] third customer in the Krung Thep Bank teller queue');
    const bankQueueB = await page.evaluate(() => {
      const G = window.GAME, main = window.__REALISM_MAIN;
      const c = G.bankQueueB;
      const first = G.bankQueue;
      const teller = G.world && G.world.bank && G.world.bank.teller;
      const n = (c && c.queue || []).filter(p => p && p.bankQueue && p.mesh).length;
      const phone = (c && c.queue || []).some(p => p && p.mesh && p.mesh.getObjectByName('bank-queue-phone'));
      const near = !!(c && teller && Math.hypot(c.x - teller.x, c.z - teller.z) < 4);
      const other = !!(c && first && Math.hypot(c.x - first.x, c.z - first.z) > 1.2);
      G.time.dayT = 18 / 24;
      main.updateBankQueue(0.05);
      const late = (c && c.queue || []).filter(p => p && p.mesh && p.mesh.visible === false).length;
      G.time.dayT = 12 / 24;
      if (c) c.t = 0.2;
      main.updateBankQueue(0.05);
      const day = (c && c.queue || []).filter(p => p && p.bankQueue && p.mesh && p.mesh.visible).length;
      const p0 = c && c.queue && c.queue[0];
      const z0 = p0 && p0.mesh ? p0.mesh.position.z : 0;
      const tool = p0 && p0.mesh && p0.mesh.getObjectByName('bank-queue-phone');
      const e0 = tool && tool.material ? tool.material.emissiveIntensity : 0;
      if (c) c.t = 0.2 + Math.PI / 2.4;
      main.updateBankQueue(0.05);
      const shifted = !!(p0 && p0.mesh && Math.abs(p0.mesh.position.z - z0) > 0.04);
      const glowed = !!(tool && tool.material && Math.abs(tool.material.emissiveIntensity - e0) > 0.04);
      return {
        flag: !!(G.gameplay && G.gameplay.bankQueue),
        n, phone, near, other, late, day, shifted, glowed,
      };
    });
    assert(bankQueueB.flag && bankQueueB.n >= 1 && bankQueueB.phone && bankQueueB.near && bankQueueB.other, `a third customer waits in the Krung Thep Bank teller queue (${bankQueueB.n})`);
    assert(bankQueueB.late >= 1 && bankQueueB.day >= 1 && bankQueueB.shifted && bankQueueB.glowed, 'they hide after hours and the phone glows');

    console.log('\n[222] visitor at the Terminal 21 directory');
    const dirAsk = await page.evaluate(() => {
      const G = window.GAME, main = window.__REALISM_MAIN;
      const c = G.mallDirAsk;
      const ped = c && c.ped;
      const map = !!(ped && ped.mesh && ped.mesh.getObjectByName('mall-dir-map'));
      const desk = G.mallDir;
      const near = !!(c && desk && Math.hypot(c.x - desk.x, c.z - desk.z) < 4);
      const clerk = desk && desk.clerk && desk.clerk.anchor && desk.clerk.anchor.slot;
      const other = !!(c && clerk && Math.hypot(c.x - clerk.x, c.z - clerk.z) > 2);
      G.time.dayT = 23 / 24;
      main.updateMallDirectory(0.05);
      const night = !!(ped && ped.mesh && ped.mesh.visible === false);
      G.time.dayT = 12 / 24;
      if (c) c.t = 0.2;
      main.updateMallDirectory(0.05);
      const day = !!(ped && ped.mallDir && ped.mallDirAsk && ped.mesh && ped.mesh.visible);
      const z0 = ped && ped.mesh ? ped.mesh.position.z : 0;
      if (c) c.t = 0.2 + Math.PI / 2.2;
      main.updateMallDirectory(0.05);
      const shifted = !!(ped && ped.mesh && Math.abs(ped.mesh.position.z - z0) > 0.02);
      const tool = ped && ped.mesh && ped.mesh.getObjectByName('mall-dir-map');
      if (c) c.t = 0.2;
      main.updateMallDirectory(0.05);
      const r0 = tool ? tool.rotation.z : 0;
      if (c) c.t = 0.2 + Math.PI / 4.2;
      main.updateMallDirectory(0.05);
      const swung = !!(tool && Math.abs(tool.rotation.z - r0) > 0.04);
      return {
        flag: !!(G.gameplay && G.gameplay.mallDir),
        rec: !!(ped && ped.mallDir && ped.mallDirAsk),
        map, near, other, night, day, shifted, swung,
      };
    });
    assert(dirAsk.flag && dirAsk.rec && dirAsk.map && dirAsk.near && dirAsk.other, 'a visitor asks at the Terminal 21 directory');
    assert(dirAsk.night && dirAsk.day && dirAsk.shifted && dirAsk.swung, 'they hide after 22:00 and the floor map turns');
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

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
      const car = G.player.inVehicle;
      const spec = car.spec;
      const reset = v => {
        car.pos.set(0, 0, -140); car.heading = 0; car.vel = v;
        car.yawRate = 0; car.steerAngle = 0; car.steerInput = 0;
        car.throttle = 0; car.brakeInput = 0; car.latVel = 0; car._aLong = 0;
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

    console.log('\n[7] P0 gameplay flags default on');
    const flags = await page.evaluate(() => {
      const g = window.GAME.gameplay || {};
      return g;
    });
    for (const k of ['pedWalkways','pedBuildingCollision','pedCrosswalks','monkHeat','dogRoadLife','trafficDensity','trafficDestinations','bikeFilterWide','vehicleKindFeel','fakeRpm','vehicleLimp','kerbScrub','sois','yaowaratCarHostility','floodPatches','heatHaze','spatialSiren','districtBeds','watHeatSink','honestAmmo','speedo','gamepad','tach','bikeLowside','coverVehicles','gltf','cover','clinch','btsHijack','fireAtTen','allRed','airport','btsRide','talkChase','yaowaratNight','boatHijack','sevenInterior','motosai','motosaiStands','burningHaze','schoolKids','seekShade','stallSit','spiritWai','soiCats','btsPlatform','bikeHelmets','officeCommute','afternoonStorm']) {
      assert(flags[k] === true, `GAMEPLAY.${k} defaults on`);
    }
    assert(flags.rapier === false, 'GAMEPLAY.rapier stays off until arcade bands are matched');

    console.log('\n[8] P1 pedestrians vs buildings + walkways');
    const peds = await page.evaluate(() => {
      const G = window.GAME, main = window.__REALISM_MAIN;
      const ways = (G.world.walkways || []).length;
      const wanderer = G.peds.find(p => !p.dead && !p.anchor && !p.gang && !p.isMugger && !p.isTarget && !p.pillion && !p.motosaiRider && !p.motosaiWait && !p.school && !p.btsWait && !p.commute);
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
      G.player.group.position.set(0, 0, -50);
      G.player.group.visible = true;
      let cop = G.cops.find(c => c && !c.dead);
      if (!cop) cop = main.spawnCop(G.scene, new G.THREE.Vector3(0, 0, -72));
      cop.mesh.position.set(0, 0, -72);
      cop.dead = false;
      cop.state = 'seeking';
      G.wanted.stars = 1;
      G.time.weather = 'clear';
      G.time.rainStrength = 0;
      G._weatherUntil = 1e9;
      main.updateDayNight(0.05);
      G.wanted.lastSeenAt = 0;
      cop._losT = 0;
      main.updateWanted(0.25);
      const clearSeen = G.wanted.lastSeenAt > 0;
      G.time.weather = 'haze';
      main.updateDayNight(0.05);
      G.wanted.lastSeenAt = 0;
      cop._losT = 0;
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
      return { flag: !!(G.gameplay && G.gameplay.schoolKids), n, toward, white, gone, bts: !!(bts) };
    });
    assert(kids.flag && kids.bts, 'schoolKids flag on and BTS exists');
    assert(kids.n >= 4 && kids.toward >= 3 && kids.white, `morning uniforms walk toward the BTS (${kids.n} kids)`);
    assert(kids.gone, 'schoolkids disperse after morning');

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
      G.player.group.visible = true;
      G.player.group.position.copy(f.pos);
      G._eating = null;
      G.cash = 120;
      G.player.hp = 40;
      f.visited = false;
      f.readyAt = 0;
      window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyE' }));
      main.updateFoodStalls(0.016);
      window.dispatchEvent(new KeyboardEvent('keyup', { code: 'KeyE' }));
      if (G.input && G.input.endFrame) G.input.endFrame();
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
      return {
        flag: !!(G.gameplay && G.gameplay.spiritWai),
        n: (G.world.shrines || []).length,
        paid: G.cash === 40,
        cooled: G.wanted.lastSeenAt < seen0 - 1000,
        count: G._waiCount,
      };
    });
    assert(wai.flag && wai.n >= 4, `spirit houses exist (${wai.n})`);
    assert(wai.paid && wai.cooled && wai.count >= 1, 'wai costs ฿10 and cools wanted contact');

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

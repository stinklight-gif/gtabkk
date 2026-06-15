// =============================================================================
// PLAYER — extracted from main.js (see numbered sections). No logic change.
// =============================================================================
import * as THREE from 'three';
import {
  makeStaticBaker, PI, TAU, clamp, lerp, rand, irand, pick, sign, dist2, COLORS, G, PRICE, PAINT_COLORS, ROAD_WIDTH, PED_TARGET, GAMEPLAY, _camTarget, _camOffset, _fireDir, _ray, _bbox, _vBox, _blackColor, disposeObject, BLOCK, GRID, HALF, lerpAngle
} from './core.js';
import { tip, resolvePlayerVsBuildings, resolvePlayerVsVehicles, saveGame, updateAmmoHud, updateCombat, updatePlayerInVehicle } from './main.js';

export function updatePlayer(dt) {
  const p = G.player;
  if (p.inVehicle) { updatePlayerInVehicle(dt); return; }

  // mouse look
  const [dx, dy] = G.input.consumeMouseDelta();
  const sens = 0.0024 * (G.settings ? G.settings.sensitivity : 1);
  G.camRig.yaw   -= dx * sens;
  G.camRig.pitch -= dy * sens;
  G.camRig.pitch = clamp(G.camRig.pitch, -1.1, 0.6);

  // movement input
  const forward = (G.input.down('KeyW')?1:0) - (G.input.down('KeyS')?1:0);
  const strafe  = (G.input.down('KeyD')?1:0) - (G.input.down('KeyA')?1:0);
  const sprint  = G.input.down('ShiftLeft') && p.stam > 4;
  const moving = forward !== 0 || strafe !== 0;
  let speed = 3.4;
  if (sprint && moving) { speed = 6.4; p.stam = Math.max(0, p.stam - 22*dt); }
  else { p.stam = Math.min(p.stamMax, p.stam + 18*dt); }

  // calculate desired velocity in world space relative to camera yaw
  const fx = -Math.sin(G.camRig.yaw), fz = -Math.cos(G.camRig.yaw);
  const rx =  Math.cos(G.camRig.yaw), rz = -Math.sin(G.camRig.yaw);
  let vx = fx * forward + rx * strafe;
  let vz = fz * forward + rz * strafe;
  const len = Math.hypot(vx, vz);
  if (len > 0.001) { vx = vx / len * speed; vz = vz / len * speed; }
  p.velocity.x = lerp(p.velocity.x, vx, 0.25);
  p.velocity.z = lerp(p.velocity.z, vz, 0.25);
  // gravity / jump
  if (G.input.pressed('Space') && p.grounded && !G.input.down('ControlLeft')) {
    p.velocity.y = 5.0; p.grounded = false;
  }
  if (!p.grounded) {
    p.velocity.y -= 18 * dt;
  }
  p.group.position.addScaledVector(p.velocity, dt);
  if (p.group.position.y <= 0) { p.group.position.y = 0; p.velocity.y = 0; p.grounded = true; }

  resolvePlayerVsBuildings(p);
  resolvePlayerVsVehicles(p);

  // body face direction of movement (or aim if firing)
  if (p.activeWeapon === 'pistol' && G.input.rightDown) {
    p.yaw = G.camRig.yaw + PI;
  } else if (moving) {
    const desired = Math.atan2(vx, vz);
    p.yaw = lerpAngle(p.yaw, desired, 0.25);
  }
  p.group.rotation.y = p.yaw;

  // animations: leg bob, arm swing
  const tnow = performance.now() * 0.005;
  if (moving) {
    p.legs.rotation.x = Math.sin(tnow * speed * 0.5) * 0.5;
    p.torso.rotation.x = Math.sin(tnow * speed * 0.5) * 0.05;
    p.armL.rotation.x = -Math.sin(tnow * speed * 0.5) * 0.6;
    p.armR.rotation.x =  Math.sin(tnow * speed * 0.5) * 0.6;
    // footstep audio
    p._stepPhase = (p._stepPhase||0) + dt * speed;
    if (p._stepPhase > 0.6) { p._stepPhase = 0; G.audio.step(G.time.rainStrength > 0.3); }
  } else {
    p.legs.rotation.x *= 0.85;
    p.torso.rotation.x *= 0.85;
    p.armL.rotation.x *= 0.85;
    p.armR.rotation.x *= 0.85;
  }

  // Combat
  updateCombat(dt);

  // 7-Eleven proximity — snacks restore HP, a vest tops up armor
  for (const e of G.world.sevenElevens) {
    if (dist2(p.group.position, e.pos) < 7*7) {
      if (Date.now() - e.chimed > 4000) {
        G.audio.chime(); e.chimed = Date.now();
        const healed = p.hp < p.hpMax;
        const vested = GAMEPLAY.armor && p.armor < 50;
        if (healed) p.hp = p.hpMax;
        if (vested) p.armor = 50;
        if (healed || vested) {
          G.hud.showNotif('7-Eleven — ' + (healed && vested ? 'HP & armor restored' : healed ? 'HP restored' : 'armor restored'));
        }
      }
    }
  }
}

// Show a banner when the player crosses into a named district.
export function updateDistrict() {
  const p = G.player.group.position;
  const poi = G.world.poi;
  let zone;
  if (p.x < -185) zone = { en: 'Riverside', th: 'ริมแม่น้ำ' };
  else if (poi.yaowarat && dist2(p, poi.yaowarat) < 62*62) zone = { en: 'Yaowarat', th: 'เยาวราช' };
  else if (poi.temple && dist2(p, poi.temple) < 46*46) zone = { en: 'The Wat', th: 'วัด' };
  else if (poi.terminal21 && dist2(p, poi.terminal21) < 55*55) zone = { en: 'Asok', th: 'อโศก' };
  else zone = { en: 'Sukhumvit', th: 'สุขุมวิท' };
  if (zone.en !== G._districtName) {
    const first = G._districtName === undefined;   // don't banner the spawn district
    G._districtName = zone.en;
    if (!first) G.hud.showSubtitle(zone.en, zone.th, 2.2);
  }
}

// Slide the Skytrain back and forth along the elevated track.
export function updateBTS(dt) {
  const b = G.bts;
  if (!b) return;
  b.mesh.position.x += b.dir * b.speed * dt;
  if (b.mesh.position.x > b.max) b.dir = -1;
  else if (b.mesh.position.x < b.min) b.dir = 1;
  // rumble as the train passes over a player near the track (z≈0)
  const dx = b.mesh.position.x - G.player.group.position.x;
  if ((b._dxPrev || 0) * dx < 0 && Math.abs(G.player.group.position.z) < 45 && G.audio.rumble) G.audio.rumble();
  b._dxPrev = dx;
}

// Spin/bob the hidden amulets and collect them on touch.
export function updateCollectibles(dt) {
  const cs = G.world.collectibles;
  if (!cs) return;
  const pp = G.player.group.position;
  const tnow = performance.now() * 0.003;
  for (const a of cs) {
    if (a.taken) continue;
    a.mesh.rotation.y += dt * 2;
    a.mesh.position.y = 1.3 + Math.sin(tnow + a.mesh.position.x) * 0.15;
    if (dist2(a.mesh.position, pp) < 2.6 * 2.6) {
      a.taken = true;
      G.scene.remove(a.mesh);
      G.collected = (G.collected || 0) + 1;
      G.cash += 100;
      G.hud.setCash(G.cash);
      G.audio.blip({ freq: 880, dur: 0.1, gain: 0.12 });
      if (G.collected >= cs.length) {
        G.cash += 3000; G.hud.setCash(G.cash);
        G.hud.showNotif(`All ${cs.length} amulets found! +฿2,000`);
      } else {
        G.hud.showNotif(`Amulet ${G.collected}/${cs.length} (+฿100)`);
      }
    }
  }
}

// → ./vehicles.js
// → ./npcs.js
// → ./combat.js
// → ./wanted.js
// 17. INTERACTION — get in/out of vehicle
// =============================================================================

export function updateInteraction(dt) {
  const p = G.player;
  if (p.inVehicle) return;

  // Inside the garage shed, let updateGarageOwnership own the E key (rent/retrieve)
  // so the enter-vehicle prompt doesn't fight it. The garage door sits just
  // outside this radius, so a car parked/retrieved there is still enterable.
  const gg = G.world.garages && G.world.garages[0];
  if (gg && dist2(p.group.position, gg.pos) < gg.r * gg.r) return;

  // find nearest vehicle within reach that isn't a cop unit or a burning wreck
  let near = null, nd = Infinity;
  for (const v of G.vehicles) {
    if (v.driver || v.dead) continue; // occupied/cop/player, or a wreck about to despawn
    const d2 = dist2(v.pos, p.group.position);
    if (d2 < 8 && d2 < nd) { nd = d2; near = v; }
  }
  if (near) {
    G.hud.showPrompt('Press <b>E</b> to enter ' + vehicleName(near.kind), 0.5);
    if (G.input.pressed('KeyE')) {
      p.inVehicle = near;
      near.driver = 'player';
      near.npc = null;   // take over from the traffic AI if it was a moving car
      G.audio.blip({freq:300, dur:0.05, gain:0.08});
    }
  } else {
    updateGunShop(dt);   // E does shop business only when no vehicle is in reach
    update7Eleven(dt);
    updateSafehouse(dt);
    updateMall(dt);
  }
}

// Enter a 7-Eleven (on foot) to open the store overlay.
export function update7Eleven(dt) {
  const p = G.player;
  for (const e of G.world.sevenElevens) {
    if (dist2(p.group.position, e.pos) < 5 * 5) {
      G.hud.showPrompt('Press <b>E</b> to enter <b>7-Eleven</b>', 0.4);
      if (G.input.pressed('KeyE')) openStore('7-Eleven');
      return;
    }
  }
}

// Shared store-overlay opener: shows #store with a per-shop title (the convenience
// stock is shared for now). Used by the 7-Eleven and every Terminal 21 shop front.
export function openStore(title) {
  const h = document.querySelector('#store h3');
  if (h) h.textContent = title.toUpperCase();
  G.state = 'store';
  document.getElementById('store').classList.add('show');
  document.exitPointerLock();
}

// Terminal 21 — walk in (no door key), then E at a shop front to browse it.
export function updateMall(dt) {
  const p = G.player, mall = G.world.mall;
  if (!mall) return;
  const inside = Math.abs(p.group.position.x - mall.center.x) < mall.hw
              && Math.abs(p.group.position.z - mall.center.z) < mall.hd;
  if (inside && !G._inMall) { G._inMall = true; G.hud.showSubtitle('Terminal 21', 'เทอร์มินอล 21', 2.2); tip('mall', 'Terminal 21 — each floor is a world city. Walk up to a shop and press E to browse.', 'เทอร์มินอล 21'); }
  else if (!inside && G._inMall) G._inMall = false;
  if (!inside) return;
  for (const s of mall.shops) {
    if (dist2(p.group.position, s.pos) < 3.2 * 3.2) {
      G.hud.showPrompt(`Press <b>E</b> to browse <b>${s.name}</b>`, 0.4);
      if (G.input.pressed('KeyE')) openStore(s.name);
      return;
    }
  }
}
// Safehouse (on foot at the door): buy it once, then rest to heal + save. Owning
// it makes it your respawn point instead of the police station.
export function updateSafehouse(dt) {
  const p = G.player;
  const door = G.world.poi && G.world.poi.safehouse;
  if (!door || dist2(p.group.position, door) > 6 * 6) return;
  const sh = G.econ.safehouse;
  if (!sh.owned) {
    tip('home', 'A safehouse — buy it (E) and you respawn here instead of the police station.', 'บ้านปลอดภัย');
    G.hud.showPrompt(`Safehouse for sale — <b>E</b>: buy (฿${PRICE.safehouse.toLocaleString()})`, 0.4);
    if (G.input.pressed('KeyE')) {
      if (G.cash < PRICE.safehouse) { G.hud.showNotif('Not enough cash for the safehouse'); return; }
      G.cash -= PRICE.safehouse; G.hud.setCash(G.cash);
      sh.owned = true;
      markSafehouseOwned();
      G.hud.showNotif('Safehouse bought — you respawn here now');
      G.audio.chime();
      saveGame();
    }
  } else {
    G.hud.showPrompt('Home — <b>E</b>: rest (heal + save)', 0.4);
    if (G.input.pressed('KeyE')) {
      p.hp = p.hpMax; if (typeof p.stam === 'number') p.stam = p.stamMax;
      G.hud.showNotif('Rested at home — healed & saved');
      G.audio.chime();
      saveGame();
    }
  }
}
export function markSafehouseOwned() {
  const m = G.world.safehouseSign;
  if (m) { m.color.setHex(0x39ff7a); m.emissive.setHex(0x39ff7a); }   // FOR SALE → HOME
}

export function storeBuy(item) {
  const p = G.player;
  let ok = false;
  if (item === 'snack' && G.cash >= 20) { G.cash -= 20; p.hp = Math.min(p.hpMax, p.hp + 40); ok = true; }
  else if (item === 'drink' && G.cash >= 30) { G.cash -= 30; p.stam = p.stamMax; ok = true; }
  else if (item === 'vest' && G.cash >= 200) { G.cash -= 200; p.armor = p.armorMax; ok = true; }
  if (ok) { G.hud.setCash(G.cash); G.audio.chime(); }
  else G.hud.showNotif('Not enough cash');
}

// Gun shop: on foot in the shop zone, E buys the next thing you need (then ammo).
export function updateGunShop(dt) {
  const p = G.player;
  const shop = G.world.gunShop;
  if (!shop || dist2(p.group.position, shop) > 7 * 7) return;
  let label, cost, action;
  if (!p.weapons.pistol)    { label = 'Buy 9mm Pistol'; cost = 800;  action = 'pistol'; }
  else if (!p.weapons.shotgun) { label = 'Buy Shotgun'; cost = 2500; action = 'shotgun'; }
  else if (!p.weapons.smg)  { label = 'Buy SMG';        cost = 4000; action = 'smg'; }
  else                      { label = 'Buy ammo';       cost = 300;  action = 'ammo'; }
  G.hud.showPrompt(`Gun shop — <b>E</b>: ${label} (฿${cost})`, 0.4);
  if (G.input.pressed('KeyE')) {
    if (G.cash < cost) { G.hud.showNotif('Not enough cash'); return; }
    G.cash -= cost; G.hud.setCash(G.cash);
    if (action === 'pistol')   { p.weapons.pistol = true; p.pistolAmmo = p.pistolMag; p.pistolReserve = p.pistolMag * 3; }
    else if (action === 'smg') { p.weapons.smg = true; p.smgAmmo = p.smgMag; p.smgReserve = p.smgMag * 3; }
    else if (action === 'shotgun') { p.weapons.shotgun = true; p.shotgunAmmo = p.shotgunMag; p.shotgunReserve = p.shotgunMag * 3; }
    else { p.pistolReserve += p.pistolMag * 3; if (p.weapons.smg) p.smgReserve += p.smgMag * 3; if (p.weapons.shotgun) p.shotgunReserve += p.shotgunMag * 3; }
    updateAmmoHud();
    G.hud.showNotif(label + ' ✓');
    G.audio.blip({ freq: 600, dur: 0.1, gain: 0.12 });
  }
}

export function vehicleName(k) {
  return { bike: 'motorbike', tuktuk: 'tuk-tuk', hilux: 'pickup', camry: 'car', sedan: 'sedan', cop: 'cop pickup', fortuner: 'unmarked SUV', swat: 'SWAT van', songthaew: 'songthaew', boat: 'longtail boat', bus: 'bus', luxsedan: 'luxury sedan', supercar: 'supercar' }[k] || k;
}

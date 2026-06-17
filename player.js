// =============================================================================
// PLAYER — extracted from main.js (see numbered sections). No logic change.
// =============================================================================
import * as THREE from 'three';
import {
  makeStaticBaker, PI, TAU, clamp, lerp, rand, irand, pick, sign, dist2, COLORS, G, PRICE, PAINT_COLORS, BUSINESSES, ROAD_WIDTH, PED_TARGET, GAMEPLAY, _camTarget, _camOffset, _fireDir, _ray, _bbox, _vBox, _blackColor, disposeObject, BLOCK, GRID, HALF, lerpAngle
} from './core.js';
import { tip, resolvePlayerVsBuildings, resolvePlayerVsVehicles, resolvePlayerVsPlatforms, worldSupportY, saveGame, startArcade, applyUpgrades, updateAmmoHud, updateCombat, updatePlayerInVehicle } from './main.js';

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

  resolvePlayerVsBuildings(p);
  resolvePlayerVsVehicles(p);
  resolvePlayerVsPlatforms(p);
  // Vertical support: city ground (y=0) or a walkable floor / escalator (mall, BTS
  // platform) under the player's feet. Walk off an edge → support drops → you fall.
  const gy = worldSupportY(p.group.position.x, p.group.position.z, p.group.position.y);
  if (p.group.position.y <= gy + 0.02) { p.group.position.y = gy; p.velocity.y = 0; p.grounded = true; }
  else p.grounded = false;

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
      applyUpgrades(near);   // your garage tuning rides with you
      G.audio.blip({freq:300, dur:0.05, gain:0.08});
    }
  } else {
    updateGunShop(dt);   // E does shop business only when no vehicle is in reach
    update7Eleven(dt);
    updateSafehouse(dt);
    updateMall(dt);
    updateBusinesses(dt);
  }
}

// Buyable businesses: walk up and E to buy; while owned they accrue passive
// income (capped) that you return to collect. Persisted in the save.
export function updateBusinesses(dt) {
  const p = G.player, st = G.econ.businesses || (G.econ.businesses = {});
  for (const b of BUSINESSES) {
    const s = st[b.id] || (st[b.id] = { owned: false, pending: 0 });
    if (s.owned) s.pending = Math.min(b.cap, (s.pending || 0) + b.rate * dt);
    if (!b.pos) continue;
    if (dist2(p.group.position, b.pos) < 4.5 * 4.5 && Math.abs(p.group.position.y - b.pos.y) < 2.5) {
      if (!s.owned) {
        tip('biz', 'Businesses earn passive income — buy one and come back to collect the takings.', 'ซื้อกิจการ');
        G.hud.showPrompt(`${b.name} for sale — <b>E</b>: buy (฿${b.price.toLocaleString()})`, 0.4);
        if (G.input.pressed('KeyE')) {
          if (G.cash < b.price) G.hud.showNotif('Not enough cash');
          else {
            G.cash -= b.price; s.owned = true; G.hud.setCash(G.cash);
            G.hud.showNotif(`Bought ${b.name} — earns ฿${b.rate}/s`);
            if (G.audio && G.audio.chime) G.audio.chime();
            saveGame();
          }
        }
      } else {
        const amt = Math.floor(s.pending || 0);
        G.hud.showPrompt(`${b.name} — <b>E</b>: collect ฿${amt.toLocaleString()}`, 0.4);
        if (G.input.pressed('KeyE') && amt > 0) {
          G.cash += amt; s.pending -= amt; G.hud.setCash(G.cash);
          G.hud.showNotif(`Collected ฿${amt.toLocaleString()}`);
          if (G.audio && G.audio.chime) G.audio.chime();
        }
      }
      return;
    }
  }
}

// Enter a 7-Eleven (on foot) to open the store overlay.
export function update7Eleven(dt) {
  const p = G.player;
  for (const e of G.world.sevenElevens) {
    if (dist2(p.group.position, e.pos) < 5 * 5) {
      G.hud.showPrompt('Press <b>E</b> to shop at <b>7-Eleven</b>', 0.4);
      if (G.input.pressed('KeyE')) openStore('7-Eleven');
      return;
    }
  }
}

// Shared store overlay. Each shop has its own themed inventory (the convenience
// stock is the default, used by every 7-Eleven). Buttons are generated per shop.
export function shopItems(name) {
  const p = G.player;
  const heal = n => () => { p.hp = Math.min(p.hpMax, p.hp + n); };
  const fullStam = () => { p.stam = p.stamMax; };
  const fullArmor = () => { p.armor = p.armorMax; };
  const cos = (key, cost) => ({ label: COSMETICS[key].label, cost, own: key, effect: COSMETICS[key].apply });
  const CAT = {
    'Pier 21 Food Court': 'food', 'Sushi Bar': 'food', 'Manga Café': 'food', 'Le Café': 'food',
    'Tokyo Tech': 'gear', 'Akihabara Arcade': 'gear',
    'Paris Pharmacy': 'meds',
    'Roma Boutique': 'clothes', 'London Threads': 'clothes2', 'Watch Boutique': 'clothes2',
  };
  switch (CAT[name] || 'convenience') {
    case 'food': return [
      { label: 'Pad Thai · +60 HP',       cost: 40,  effect: heal(60) },
      { label: 'Som Tam · +35 HP',        cost: 25,  effect: heal(35) },
      { label: 'Thai Iced Tea · stamina', cost: 20,  effect: fullStam },
    ];
    case 'gear': return [
      { label: 'Body Armor · full',       cost: 200, effect: fullArmor },
      { label: 'Pistol Ammo · +30',       cost: 150, need: () => p.weapons && p.weapons.pistol, effect: () => { p.pistolReserve += 30; updateAmmoHud(); } },
      { label: 'Energy Drink · stamina',  cost: 30,  effect: fullStam },
    ];
    case 'meds': return [
      { label: 'First-Aid Kit · full HP', cost: 120, effect: () => { p.hp = p.hpMax; } },
      { label: 'Painkillers · +45 HP',    cost: 40,  effect: heal(45) },
      { label: 'Vitamins · stamina',      cost: 25,  effect: fullStam },
    ];
    case 'clothes': return [
      cos('shirt:crimson', 150), cos('shirt:azure', 150), cos('shirt:emerald', 180),
      cos('hat:cap', 120), cos('jacket:teal', 350),
    ];
    case 'clothes2': return [
      cos('shirt:purple', 200), cos('shirt:ivory', 160), cos('shirt:gold', 220),
      cos('hat:bucket', 130), cos('hat:helmet', 160), cos('jacket:crimson', 380), cos('jacket:noir', 420),
    ];
    default: return [                                  // 7-Eleven / convenience
      { label: 'Snack · +40 HP',          cost: 20,  effect: heal(40) },
      { label: 'Energy Drink · stamina',  cost: 30,  effect: fullStam },
      { label: 'Body Armor · full',       cost: 200, effect: fullArmor },
    ];
  }
}

// ---- Player cosmetics: shirt colour, hats, jackets (3 outfit slots) ----
export function setShirt(hex) {                 // torso + arms share one material
  G._shirtColor = hex;
  const t = G.player && G.player.torso;
  if (t && t.material && t.material.color) t.material.color.setHex(hex);
}
export function setHat(id) {
  G._hat = id || 'none';
  const p = G.player; if (!p || !p.head) return;
  if (p._hat) { p.head.remove(p._hat); disposeObject(p._hat); p._hat = null; }
  if (G._hat === 'none') return;
  const g = new THREE.Group();
  if (id === 'cap') {
    const dome = new THREE.Mesh(new THREE.SphereGeometry(0.235, 10, 6, 0, TAU, 0, PI / 2), new THREE.MeshStandardMaterial({ color: 0xb03030, roughness: 0.7 }));
    const brim = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.04, 0.26), new THREE.MeshStandardMaterial({ color: 0x8a2020 }));
    brim.position.set(0, 0, 0.2); g.add(dome, brim);
  } else if (id === 'bucket') {
    const crown = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.24, 0.18, 12), new THREE.MeshStandardMaterial({ color: 0xd9c27a, roughness: 0.9 }));
    crown.position.y = 0.09;
    const brim = new THREE.Mesh(new THREE.CylinderGeometry(0.34, 0.34, 0.04, 12), new THREE.MeshStandardMaterial({ color: 0xc9b26a, roughness: 0.9 }));
    g.add(crown, brim);
  } else if (id === 'helmet') {
    const shell = new THREE.Mesh(new THREE.SphereGeometry(0.25, 10, 8, 0, TAU, 0, PI / 1.9), new THREE.MeshStandardMaterial({ color: 0xffcf2a, roughness: 0.5, metalness: 0.2 }));
    g.add(shell);
  }
  g.position.set(0, 0.16, 0); p.head.add(g); p._hat = g;
}
export function setJacket(hex) {
  G._jacketColor = hex || null;
  const p = G.player; if (!p || !p.torso) return;
  if (!p._jacket) {
    p._jacket = new THREE.Mesh(new THREE.CapsuleGeometry(0.39, 0.58, 4, 8), new THREE.MeshStandardMaterial({ color: 0x2a2e34, roughness: 0.7 }));
    p._jacket.position.copy(p.torso.position); p._jacket.castShadow = true; p.group.add(p._jacket);
  }
  if (hex) { p._jacket.visible = true; p._jacket.material.color.setHex(hex); }
  else p._jacket.visible = false;
}
export function applyCosmetics(c) {
  if (!c) return;
  if (typeof c.shirt === 'number') setShirt(c.shirt);
  setHat(c.hat || 'none');
  setJacket(typeof c.jacket === 'number' ? c.jacket : null);
}

// Cosmetic catalogue: each key maps to a label + how to wear it. Shops sell them
// (recording ownership); the safehouse wardrobe re-equips owned ones for free.
export const COSMETICS = {
  'shirt:crimson': { label: '👕 Crimson Tee',   apply: () => setShirt(0xb02a2a) },
  'shirt:azure':   { label: '👕 Azure Shirt',   apply: () => setShirt(0x2a5aad) },
  'shirt:emerald': { label: '👕 Emerald Polo',  apply: () => setShirt(0x1e9a5e) },
  'shirt:gold':    { label: '👕 Gold Tee',      apply: () => setShirt(0xe0b020) },
  'shirt:noir':    { label: '👕 Noir Black',    apply: () => setShirt(0x161616) },
  'shirt:purple':  { label: '👕 Royal Purple',  apply: () => setShirt(0x7a3aad) },
  'shirt:ivory':   { label: '👕 Ivory White',   apply: () => setShirt(0xeae0d0) },
  'hat:cap':       { label: '🧢 Red Cap',       apply: () => setHat('cap') },
  'hat:bucket':    { label: '👒 Bucket Hat',    apply: () => setHat('bucket') },
  'hat:helmet':    { label: '⛑️ Site Helmet',   apply: () => setHat('helmet') },
  'jacket:teal':   { label: '🧥 Teal Bomber',   apply: () => setJacket(0x1f9aa0) },
  'jacket:crimson':{ label: '🧥 Crimson Coat',  apply: () => setJacket(0x8a2330) },
  'jacket:noir':   { label: '🧥 Black Leather', apply: () => setJacket(0x1a1a1e) },
  'hat:none':      { label: '🚫 Remove Hat',    apply: () => setHat('none') },
  'jacket:none':   { label: '🚫 Remove Jacket', apply: () => setJacket(null) },
};

// Safehouse wardrobe: re-equip anything you've bought (free), plus removers.
export function openWardrobe() {
  const h = document.querySelector('#store h3'); if (h) h.textContent = 'WARDROBE';
  const box = document.getElementById('store-items');
  if (box) {
    box.innerHTML = '';
    const keys = ['hat:none', 'jacket:none', ...(G._owned || [])];
    for (const key of keys) {
      const c = COSMETICS[key]; if (!c) continue;
      const btn = document.createElement('button');
      btn.textContent = c.label;
      btn.addEventListener('click', () => { c.apply(); if (G.audio && G.audio.chime) G.audio.chime(); });
      box.appendChild(btn);
    }
    if (!(G._owned || []).length) {
      const note = document.createElement('button'); note.textContent = 'Buy outfits at Terminal 21'; note.disabled = true; box.appendChild(note);
    }
  }
  G.state = 'store';
  document.getElementById('store').classList.add('show');
  document.exitPointerLock();
}

export function openStore(title) {
  const h = document.querySelector('#store h3');
  if (h) h.textContent = title.toUpperCase();
  const box = document.getElementById('store-items');
  if (box) {
    box.innerHTML = '';
    for (const it of shopItems(title)) {
      if (it.need && !it.need()) continue;
      const btn = document.createElement('button');
      btn.textContent = `${it.label} — ฿${it.cost.toLocaleString()}`;
      btn.addEventListener('click', () => buyItem(it));
      box.appendChild(btn);
    }
  }
  G.state = 'store';
  document.getElementById('store').classList.add('show');
  document.exitPointerLock();
}

export function buyItem(it) {
  const p = G.player;
  if (G.cash < it.cost) { G.hud.showNotif('Not enough cash'); return; }
  G.cash -= it.cost; G.hud.setCash(G.cash);
  it.effect();
  if (it.own) { G._owned = G._owned || []; if (!G._owned.includes(it.own)) G._owned.push(it.own); }   // unlock for the wardrobe
  G.hud.setBars(p.hp, p.armor, p.stam);
  if (G.audio && G.audio.chime) G.audio.chime();
}

// Terminal 21 — walk in (no door key), then E at a shop front to browse it.
export function updateMall(dt) {
  const p = G.player, mall = G.world.mall;
  if (!mall) return;
  const inside = Math.abs(p.group.position.x - mall.center.x) < mall.hw
              && Math.abs(p.group.position.z - mall.center.z) < mall.hd;
  if (inside && !G._inMall) { G._inMall = true; G.hud.showSubtitle('Terminal 21', 'เทอร์มินอล 21', 2.2); tip('mall', 'Terminal 21 — 3 floors, each a world city. Ride the escalators; press E at a shop to browse.', 'เทอร์มินอล 21'); }
  else if (!inside && G._inMall) G._inMall = false;
  if (!inside) return;
  // Elevator: a quick lift between floors (escalators are the scenic route).
  if (mall.elevator && Math.abs(p.group.position.x - mall.elevator.x) < 2.4 && Math.abs(p.group.position.z - mall.elevator.z) < 2.4) {
    const floors = mall.floors;
    let cur = 0;
    for (let i = 1; i < floors.length; i++) if (Math.abs(p.group.position.y - floors[i]) < Math.abs(p.group.position.y - floors[cur])) cur = i;
    const next = (cur + 1) % floors.length;
    G.hud.showPrompt(`Lift — <b>E</b>: go to floor ${next === 0 ? 'G' : next}`, 0.4);
    if (G.input.pressed('KeyE')) {
      p.group.position.y = floors[next] + 0.05; p.velocity.set(0, 0, 0); p.grounded = false;
      G.hud.showNotif(`Floor ${next === 0 ? 'G · Asok' : next === 1 ? '1 · Tokyo' : '2 · Europe'}`);
      if (G.audio && G.audio.blip) G.audio.blip({ freq: 660, dur: 0.08, gain: 0.12 });
    }
    return;
  }
  for (const s of mall.shops) {
    // floor-aware: a shop only triggers on its own level, not from the floor below
    if (dist2(p.group.position, s.pos) < 3.2 * 3.2 && Math.abs(p.group.position.y - s.pos.y) < 2.5) {
      const arcade = s.name === 'Akihabara Arcade';
      G.hud.showPrompt(`Press <b>E</b> to ${arcade ? 'play <b>Tuk-Tuk Dash</b>' : `browse <b>${s.name}</b>`}`, 0.4);
      if (G.input.pressed('KeyE')) { if (arcade) startArcade(); else openStore(s.name); }
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
    G.hud.showPrompt('Home — <b>E</b>: rest (heal + save) · <b>F</b>: wardrobe', 0.4);
    if (G.input.pressed('KeyE')) {
      p.hp = p.hpMax; if (typeof p.stam === 'number') p.stam = p.stamMax;
      G.hud.showNotif('Rested at home — healed & saved');
      G.audio.chime();
      saveGame();
    }
    if (G.input.pressed('KeyF')) openWardrobe();
  }
}
export function markSafehouseOwned() {
  const m = G.world.safehouseSign;
  if (m) { m.color.setHex(0x39ff7a); m.emissive.setHex(0x39ff7a); }   // FOR SALE → HOME
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

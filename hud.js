// =============================================================================
// HUD — extracted from main.js (see numbered sections). No logic change.
// =============================================================================
import * as THREE from 'three';
import {
  makeStaticBaker, PI, TAU, clamp, lerp, rand, irand, pick, sign, dist2, COLORS, G, PRICE, PAINT_COLORS, BUSINESSES, TURFS, missionMilestones, ROAD_WIDTH, PED_TARGET, GAMEPLAY, _camTarget, _camOffset, _fireDir, _ray, _bbox, _vBox, _blackColor, disposeObject, BLOCK, GRID, HALF, lerpAngle
} from './core.js';

// -----------------------------------------------------------------------------
// Shared map glyphs + colors, used by BOTH the always-on minimap (drawMinimap
// below) and the TAB full map (main.js drawFullMap). Each is a 2D-canvas draw
// centered at (x,y) in the *current* transform; `s` is the glyph half-size and
// `filled` means owned/rented (solid) vs. for-sale/for-rent (hollow outline).
// -----------------------------------------------------------------------------
export const HOME_COLOR = '#4fe3c0';     // Home / Safehouse (teal)
export const GARAGE_COLOR = '#5b9cff';   // Garage / U-Spray (blue)
export const MALL_COLOR = '#c98bff';     // Terminal 21 mall (purple)
export const BIZ_COLOR = '#39ff7a';      // Buyable businesses (green); filled = owned
export const BTS_COLOR = '#3fd0ff';      // BTS Skytrain station (cyan)
export const SEVEN_COLOR = '#ff7a2a';    // 7-Eleven (orange)
export const BOAT_COLOR = '#7fd0a0';     // Riverside pier / boats (sea green)
export const BANK_COLOR = '#e0b020';     // Krung Thep Bank (gold)
export const TURF_COLOR = '#ff5a8a';     // Gang turf (pink); filled flag = yours

export function drawTurfGlyph(ctx, x, y, s, color, owned) {
  ctx.strokeStyle = color; ctx.lineWidth = Math.max(1, s * 0.22);
  ctx.beginPath(); ctx.moveTo(x - s * 0.5, y + s); ctx.lineTo(x - s * 0.5, y - s); ctx.stroke();   // pole
  ctx.beginPath();                       // pennant
  ctx.moveTo(x - s * 0.5, y - s); ctx.lineTo(x + s, y - s * 0.45); ctx.lineTo(x - s * 0.5, y + s * 0.1);
  ctx.closePath();
  if (owned) { ctx.fillStyle = color; ctx.fill(); } else ctx.stroke();
}

export function drawBankGlyph(ctx, x, y, s, color) {
  ctx.fillStyle = color;                 // a classical bank: pediment roof + columns
  ctx.beginPath();
  ctx.moveTo(x - s, y - s * 0.2); ctx.lineTo(x, y - s); ctx.lineTo(x + s, y - s * 0.2);
  ctx.closePath(); ctx.fill();
  ctx.fillRect(x - s, y - s * 0.1, s * 2, s * 0.25);
  for (let i = -1; i <= 1; i++) ctx.fillRect(x + i * s * 0.6 - s * 0.12, y + s * 0.2, s * 0.24, s * 0.7);
  ctx.fillRect(x - s, y + s * 0.9, s * 2, s * 0.2);
}

export function drawBoatGlyph(ctx, x, y, s, color) {
  ctx.fillStyle = color;                 // a little boat hull + mast
  ctx.beginPath();
  ctx.moveTo(x - s, y - s * 0.25); ctx.lineTo(x + s, y - s * 0.25);
  ctx.lineTo(x + s * 0.5, y + s * 0.6); ctx.lineTo(x - s * 0.5, y + s * 0.6);
  ctx.closePath(); ctx.fill();
  ctx.fillRect(x - s * 0.09, y - s, s * 0.18, s * 0.75);
}

export function drawBizGlyph(ctx, x, y, s, color, filled) {
  ctx.beginPath();                       // a diamond ("฿" stand-in); hollow = for sale
  ctx.moveTo(x, y - s); ctx.lineTo(x + s, y); ctx.lineTo(x, y + s); ctx.lineTo(x - s, y); ctx.closePath();
  if (filled) { ctx.fillStyle = color; ctx.fill(); }
  ctx.strokeStyle = color; ctx.lineWidth = Math.max(1, s * 0.3); ctx.stroke();
}

export function drawBtsGlyph(ctx, x, y, s, color) {
  ctx.fillStyle = color;                 // a little train car with two windows
  ctx.beginPath();
  if (ctx.roundRect) ctx.roundRect(x - s, y - s * 0.7, s * 2, s * 1.4, s * 0.4); else ctx.rect(x - s, y - s * 0.7, s * 2, s * 1.4);
  ctx.fill();
  ctx.fillStyle = 'rgba(8,12,20,0.85)';
  ctx.fillRect(x - s * 0.62, y - s * 0.28, s * 0.5, s * 0.55);
  ctx.fillRect(x + s * 0.12, y - s * 0.28, s * 0.5, s * 0.55);
}

export function drawHouseGlyph(ctx, x, y, s, color, filled) {
  ctx.beginPath();                       // a little house silhouette (body + roof)
  ctx.moveTo(x - s, y + s);
  ctx.lineTo(x - s, y - s * 0.15);
  ctx.lineTo(x, y - s);                  // roof apex
  ctx.lineTo(x + s, y - s * 0.15);
  ctx.lineTo(x + s, y + s);
  ctx.closePath();
  if (filled) { ctx.fillStyle = color; ctx.fill(); }
  ctx.strokeStyle = color; ctx.lineWidth = Math.max(1, s * 0.3); ctx.stroke();
}

export function drawGarageGlyph(ctx, x, y, s, color, filled) {
  ctx.beginPath();                       // a box with roller-door slats
  ctx.rect(x - s, y - s, s * 2, s * 2);
  if (filled) { ctx.fillStyle = color; ctx.fill(); }
  ctx.strokeStyle = color; ctx.lineWidth = Math.max(1, s * 0.26); ctx.stroke();
  ctx.strokeStyle = filled ? 'rgba(8,12,20,0.7)' : color;
  ctx.lineWidth = Math.max(0.6, s * 0.16);
  ctx.beginPath();
  for (let i = -1; i <= 1; i++) { ctx.moveTo(x - s * 0.6, y + i * s * 0.5); ctx.lineTo(x + s * 0.6, y + i * s * 0.5); }
  ctx.stroke();
}

export function drawMallGlyph(ctx, x, y, s, color, filled = true) {
  ctx.beginPath();                       // a storefront box with an awning bar on top
  ctx.rect(x - s, y - s, s * 2, s * 2);
  if (filled) { ctx.fillStyle = color; ctx.fill(); }
  ctx.strokeStyle = color; ctx.lineWidth = Math.max(1, s * 0.26); ctx.stroke();
  ctx.fillStyle = filled ? 'rgba(8,12,20,0.75)' : color;
  ctx.fillRect(x - s, y - s, s * 2, s * 0.5);
}

// pooled scratch for the on-screen waypoint projection (module-private — it
// never leaks onto window.GAME, per the goal's guardrails).
const _wp = new THREE.Vector3();

// 9. HUD BINDINGS
// =============================================================================

export function bindHud() {
  const minimap = document.getElementById('minimap');
  const mctx = minimap.getContext('2d');
  const subtitle = document.getElementById('subtitle');
  const subEn = document.getElementById('sub-en');
  const subTh = document.getElementById('sub-th');
  const promptEl = document.getElementById('prompt');
  const notif = document.getElementById('notif');
  const phone = document.getElementById('phone');
  const crosshair = document.getElementById('crosshair');
  const waypoint = document.getElementById('waypoint');
  const wpArrow = document.getElementById('wp-arrow');
  const wpLabel = document.getElementById('wp-label');
  const wpDist = document.getElementById('wp-dist');
  const radioChip = document.getElementById('radio-chip');
  let subT = 0, promptT = 0, notifT = 0;

  function setStars(n) {
    const stars = document.getElementById('stars');
    stars.innerHTML = '★★★★★'.split('').map((s, i) => `<span class="${i < n ? 'on' : ''}">${s}</span>`).join('');
  }
  function flashWanted() {
    const el = document.getElementById('stars');
    if (!el) return;
    el.classList.remove('flash');
    void el.offsetWidth;   // reflow so the animation restarts on repeat escalations
    el.classList.add('flash');
  }
  function setCash(c) {
    document.getElementById('cash').textContent = Math.floor(c).toLocaleString();
    document.getElementById('ph-cash').textContent = Math.floor(c).toLocaleString();
  }
  function setBars(hp, ar, st) {
    document.getElementById('hp-fill').style.width = Math.max(0, hp) + '%';
    document.getElementById('ar-fill').style.width = Math.max(0, ar) + '%';
    document.getElementById('st-fill').style.width = Math.max(0, st) + '%';
  }
  function setAmmo(line, sub) {
    document.getElementById('ammo-line').textContent = line;
    document.getElementById('ammo-sub').textContent = sub;
  }
  function showSubtitle(en, th, dur=4) {
    subEn.textContent = en; subTh.textContent = th || '';
    subtitle.classList.add('show');
    subT = dur;
  }
  function showPrompt(html, dur=1.5) {
    promptEl.innerHTML = html;
    promptEl.classList.add('show');
    promptT = dur;
  }
  function showNotif(text, dur=2.5) {
    notif.textContent = text;
    notif.classList.add('show');
    notifT = dur;
  }
  function setMissionText(t) { document.getElementById('ph-mission').textContent = t; }
  function setPhoneStats() {
    const total = (G.world && G.world.collectibles) ? G.world.collectibles.length : 0;
    document.getElementById('ph-amulets').textContent = `${G.collected || 0} / ${total}`;
    document.getElementById('ph-fares').textContent = (G.taxi && G.taxi.fares) || 0;
    document.getElementById('ph-cops').textContent = G.copsKilled || 0;
    const mm = missionMilestones();
    const pct = Math.round((G.collected || 0) / Math.max(1, total) * 70 + mm.done / mm.total * 30);
    document.getElementById('ph-complete').textContent = pct + '%';
    document.getElementById('ph-food').textContent = `${G.foodVisited || 0} / ${(G.world.foodStalls || []).length}`;
    const bizEl = document.getElementById('ph-biz');
    if (bizEl) {
      let owned = 0, rate = 0, pending = 0;
      for (const b of BUSINESSES) { const s = G.econ.businesses[b.id]; if (s && s.owned) { owned++; rate += b.rate; pending += Math.floor(s.pending || 0); } }
      bizEl.textContent = `${owned} / ${BUSINESSES.length} · ฿${rate}/s` + (pending > 0 ? ` · ฿${pending.toLocaleString()} ready` : '');
    }
  }
  function setVehicle(hp, show) {
    const row = document.getElementById('veh-row');
    if (!row) return;
    row.style.display = show ? '' : 'none';
    if (show) document.getElementById('veh-fill').style.width = clamp(hp, 0, 100) + '%';
  }
  function setClock(s) { document.getElementById('clock').textContent = s; document.getElementById('ph-time').textContent = s; }
  function setWeather(t) { document.getElementById('weather-tag').textContent = t; }
  function setCrosshair(show) { crosshair.classList.toggle('show', !!show); }
  function togglePhone(open) {
    if (open == null) phone.classList.toggle('open');
    else phone.classList.toggle('open', open);
  }
  function update(dt) {
    if (subT > 0) { subT -= dt; if (subT <= 0) subtitle.classList.remove('show'); }
    if (promptT > 0) { promptT -= dt; if (promptT <= 0) promptEl.classList.remove('show'); }
    if (notifT > 0) { notifT -= dt; if (notifT <= 0) notif.classList.remove('show'); }
  }
  function drawMinimap(player) {
    // draw base
    mctx.clearRect(0,0,256,256);
    // center the world on the player by translating
    const SCALE = 256 / (HALF * 2);                 // world metres → minimap px
    const ppx = (player.group.position.x + HALF) * SCALE;
    const ppy = (player.group.position.z + HALF) * SCALE;
    const mm = p => [(p.x + HALF) * SCALE - ppx, (p.z + HALF) * SCALE - ppy];
    mctx.save();
    mctx.translate(128, 128);
    // rotate by camera yaw so up = forward
    mctx.rotate(-G.camRig.yaw);
    mctx.scale(G.minimapZoom || 1, G.minimapZoom || 1);   // N cycles zoom levels
    mctx.drawImage(G.world.minimap, -ppx, -ppy);

    // mission marker on minimap
    if (G.mission && G.mission.active && G.mission.active.markerPos) {
      const mx = (G.mission.active.markerPos.x + HALF) * (256 / (HALF*2));
      const my = (G.mission.active.markerPos.z + HALF) * (256 / (HALF*2));
      mctx.fillStyle = '#ffcf4a';
      mctx.beginPath();
      mctx.arc(mx - ppx, my - ppy, 5, 0, TAU);
      mctx.fill();
    }
    // taxi fare marker
    if (G.taxi && G.taxi.markerPos) {
      const tx = (G.taxi.markerPos.x + HALF) * (256 / (HALF*2));
      const ty = (G.taxi.markerPos.z + HALF) * (256 / (HALF*2));
      mctx.fillStyle = G.taxi.stage === 'toDropoff' ? '#39ff7a' : '#ffcf4a';
      mctx.beginPath(); mctx.arc(tx - ppx, ty - ppy, 4, 0, TAU); mctx.fill();
    }
    // bank-heist marker (vault / loot drop)
    if (G.heist && G.heist.active && G.heist.markerPos) {
      const hx = (G.heist.markerPos.x + HALF) * (256 / (HALF*2));
      const hy = (G.heist.markerPos.z + HALF) * (256 / (HALF*2));
      mctx.fillStyle = G.heist.stage === 2 ? '#39ff7a' : '#ffcf4a';
      mctx.beginPath(); mctx.arc(hx - ppx, hy - ppy, 5, 0, TAU); mctx.fill();
    }
    // uncollected amulets (small gold dots)
    if (G.world.collectibles) {
      mctx.fillStyle = '#ffd24a';
      for (const a of G.world.collectibles) if (!a.taken) {
        const x = (a.mesh.position.x + HALF) * (256 / (HALF*2));
        const y = (a.mesh.position.z + HALF) * (256 / (HALF*2));
        mctx.beginPath(); mctx.arc(x - ppx, y - ppy, 1.8, 0, TAU); mctx.fill();
      }
    }
    // active bag-snatcher (orange)
    if (G.mugging && G.mugging.ped && !G.mugging.ped.dead) {
      const sp = G.mugging.ped.mesh.position;
      const x = (sp.x + HALF) * (256 / (HALF*2)), y = (sp.z + HALF) * (256 / (HALF*2));
      mctx.fillStyle = '#ff7a2a';
      mctx.beginPath(); mctx.arc(x - ppx, y - ppy, 3, 0, TAU); mctx.fill();
    }
    // cops as red dots
    mctx.fillStyle = '#ff3333';
    for (const v of G.vehicles) if (v.isCop && v.driver) {
      const x = (v.pos.x + HALF) * (256 / (HALF*2));
      const y = (v.pos.z + HALF) * (256 / (HALF*2));
      mctx.beginPath(); mctx.arc(x - ppx, y - ppy, 2.5, 0, TAU); mctx.fill();
    }
    // Home + Garage icons — inside the transform so they translate + rotate with
    // the map exactly like the dots above. State-coded: filled once owned/rented.
    const shPos = G.world.poi && G.world.poi.safehouse;
    if (shPos) { const [hx, hy] = mm(shPos); drawHouseGlyph(mctx, hx, hy, 5, HOME_COLOR, !!(G.econ.safehouse && G.econ.safehouse.owned)); }
    const ga0 = G.world.garages && G.world.garages[0];
    if (ga0 && ga0.pos) { const [gx, gy] = mm(ga0.pos); drawGarageGlyph(mctx, gx, gy, 4.5, GARAGE_COLOR, !!(G.econ.garage && G.econ.garage.rented)); }
    const t21 = G.world.poi && G.world.poi.terminal21;
    if (t21) { const [tx2, ty2] = mm(t21); drawMallGlyph(mctx, tx2, ty2, 5, MALL_COLOR); }
    // 7-Elevens (small orange squares)
    if (G.world.sevenElevens) { mctx.fillStyle = SEVEN_COLOR; for (const e of G.world.sevenElevens) { const [x, y] = mm(e.pos); mctx.fillRect(x - 2, y - 2, 4, 4); } }
    // BTS station
    if (G.world.bts) { const [x, y] = mm({ x: G.world.bts.x, z: G.world.bts.z || 0 }); drawBtsGlyph(mctx, x, y, 4, BTS_COLOR); }
    // riverside pier (boats)
    if (G.world.poi && G.world.poi.pier) { const [x, y] = mm(G.world.poi.pier); drawBoatGlyph(mctx, x, y, 4, BOAT_COLOR); }
    // Krung Thep Bank
    if (G.world.poi && G.world.poi.bank) { const [x, y] = mm(G.world.poi.bank); drawBankGlyph(mctx, x, y, 4.5, BANK_COLOR); }
    // gang turf (flag; filled once it's yours)
    for (const t of TURFS) { const [x, y] = mm(t.center); drawTurfGlyph(mctx, x, y, 4.5, TURF_COLOR, !!(G.turfs && G.turfs[t.id] && G.turfs[t.id].owned)); }
    // buyable businesses (diamonds; filled once owned)
    for (const b of BUSINESSES) { if (!b.pos) continue; const [x, y] = mm(b.pos); drawBizGlyph(mctx, x, y, 4, BIZ_COLOR, !!(G.econ.businesses[b.id] && G.econ.businesses[b.id].owned)); }
    mctx.restore();
    // player blip (always center, facing up)
    mctx.fillStyle = '#21f0ff';
    mctx.beginPath();
    mctx.moveTo(128, 122);
    mctx.lineTo(124, 134);
    mctx.lineTo(132, 134);
    mctx.closePath();
    mctx.fill();
    // compass
    const dirs = ['N','NE','E','SE','S','SW','W','NW'];
    const yawDeg = (G.camRig.yaw * 180 / PI + 360) % 360;
    const idx = Math.round(yawDeg / 45) % 8;
    document.getElementById('compass').textContent = dirs[idx];
  }

  // On-screen objective waypoint: a pill at the projected marker with a live
  // distance, or an edge-clamped arrow that points to it when it's off-screen.
  // Complements the 3D pillar-of-light beam; only shown while actually playing.
  function drawWaypoint() {
    if (!waypoint) return;
    if (G.state !== 'playing') { waypoint.classList.remove('show'); return; }
    // Target priority: an active bank heist, then the mission marker, then a taxi fare.
    let target = null, color = '#ff2a86', label = 'Objective';
    const m = G.mission && G.mission.active;
    if (G.heist && G.heist.active && G.heist.markerPos) {
      target = G.heist.markerPos; color = G.heist.stage === 2 ? '#39ff7a' : '#ffcf4a'; label = G.heist.stage === 2 ? 'Loot drop' : 'Vault';
    } else if (m && m.markerPos) { target = m.markerPos; color = '#ff2a86'; label = m.name || 'Objective'; }
    else if (G.taxi && G.taxi.stage && G.taxi.stage !== 'idle' && G.taxi.markerPos) {
      target = G.taxi.markerPos; color = '#39ff7a'; label = G.taxi.stage === 'toDropoff' ? 'Drop-off' : 'Pick-up';
    }
    if (!target) { waypoint.classList.remove('show'); return; }

    const cam = G.camera;
    const W = window.innerWidth, H = window.innerHeight, margin = 46;
    const ty = (target.y || 0) + 2;                  // aim ~2 m up, like the beam
    // project() returns flipped/garbage NDC for points behind the camera, so test
    // for that first (dot of camera→target with the camera forward direction).
    cam.getWorldDirection(_wp);                      // borrow _wp as the forward vec
    const behind = ((target.x - cam.position.x) * _wp.x + (ty - cam.position.y) * _wp.y + (target.z - cam.position.z) * _wp.z) < 0;
    _wp.set(target.x, ty, target.z).project(cam);    // → NDC (x,y,z in [-1,1])
    const sx = (_wp.x * 0.5 + 0.5) * W;
    const sy = (-_wp.y * 0.5 + 0.5) * H;

    const pp = (G.player.inVehicle && G.player.inVehicle.pos) || G.player.group.position;
    const distM = Math.round(Math.hypot(target.x - pp.x, target.z - pp.z));

    const onScreen = !behind && sx >= margin && sx <= W - margin && sy >= margin && sy <= H - margin;
    if (onScreen) {
      wpArrow.style.display = 'none';
      waypoint.style.left = sx + 'px';
      waypoint.style.top = sy + 'px';
    } else {
      // off-screen: project the screen-space direction (flip NDC if behind) and
      // clamp the pill to the screen-edge rectangle, arrow rotated toward target.
      let ndx = _wp.x, ndy = _wp.y;
      if (behind) { ndx = -ndx; ndy = -ndy; }
      let dirX = ndx, dirY = -ndy;                   // NDC → screen (y axis flips)
      const len = Math.hypot(dirX, dirY) || 1; dirX /= len; dirY /= len;
      const reach = Math.min((W / 2 - margin) / (Math.abs(dirX) || 1e-6), (H / 2 - margin) / (Math.abs(dirY) || 1e-6));
      waypoint.style.left = (W / 2 + dirX * reach) + 'px';
      waypoint.style.top = (H / 2 + dirY * reach) + 'px';
      wpArrow.style.display = 'inline-block';
      wpArrow.style.transform = 'rotate(' + (Math.atan2(dirX, -dirY) * 180 / PI) + 'deg)';
    }
    wpLabel.textContent = label;
    wpDist.textContent = distM + ' m';
    waypoint.style.borderColor = color;
    wpArrow.style.color = color;
    waypoint.classList.add('show');
  }

  // Persistent radio chip near the minimap: shown while driving with a station
  // tuned in; hidden on foot or at RADIO OFF. Called from main.js updateRadio.
  function setRadioChip(text) {
    if (!radioChip) return;
    if (text) { radioChip.textContent = text; radioChip.classList.add('show'); }
    else radioChip.classList.remove('show');
  }

  return {
    setStars, flashWanted, setCash, setBars, setAmmo, setMissionText, setClock, setWeather, setCrosshair, setPhoneStats, setVehicle,
    showSubtitle, showPrompt, showNotif, togglePhone, update, drawMinimap, drawWaypoint, setRadioChip
  };
}

// =============================================================================

// =============================================================================
// HUD — extracted from main.js (see numbered sections). No logic change.
// =============================================================================
import * as THREE from 'three';
import {
  makeStaticBaker, PI, TAU, clamp, lerp, rand, irand, pick, sign, dist2, COLORS, G, PRICE, PAINT_COLORS, BUSINESSES, bizRate, WEALTH_TIERS, netWorth, TURFS, missionMilestones, ROAD_WIDTH, PED_TARGET, GAMEPLAY, _camTarget, _camOffset, _fireDir, _ray, _bbox, _vBox, _blackColor, disposeObject, BLOCK, GRID, HALF, lerpAngle
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
  let _cashPopN = 0;
  function cashPop(delta) {                 // floating +฿/-฿ over the cash readout (discrete rewards/buys)
    const d = Math.round(delta); if (!d) return;
    const box = document.getElementById('cash-pops'); if (!box) return;
    const el = document.createElement('div');
    el.className = 'cash-pop ' + (d > 0 ? 'pos' : 'neg');
    el.textContent = (d > 0 ? '+฿' : '-฿') + Math.abs(d).toLocaleString();
    el.style.top = (-(_cashPopN++ % 3) * 6) + 'px';     // stagger if several land at once
    box.appendChild(el);
    setTimeout(() => el.remove(), 3000);
  }
  function flashScreen(color) {             // brief full-screen colour wash (alarm, big claim)
    const el = document.getElementById('screen-flash'); if (!el) return;
    el.style.background = color;
    el.classList.remove('on'); void el.offsetWidth; el.classList.add('on');
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
  function phoneActivities() {                 // a directory of what to do, with live status + distance
    const p = G.player.group.position;
    const d = loc => loc ? Math.round(Math.hypot(loc.x - p.x, loc.z - p.z)) : null;
    const poi = (G.world && G.world.poi) || {};
    const out = [];
    const m = G.mission && G.mission.active;
    const nextJob = !G._welcomeDone ? 'welcome' : !G._soiRunWon ? 'soiRun' : !G._hitDone ? 'hit' : !G._deliveryDone ? 'delivery' : !G._mallJobDone ? 'mallJob' : !G._getawayDone ? 'getaway' : !G._repoRunDone ? 'repoRun' : !G._courierDone ? 'courier' : !G._holdYardDone ? 'holdYard' : !G._boutDone ? 'bout' : 'monsoon';
    out.push({ name: 'Jobs · Uncle Seng', status: (m && m.markerPos) ? `active: ${m.name}` : 'available', dist: d(poi.goldShop), job: nextJob });
    const soi0 = (G.world && G.world.sois && G.world.sois[0]) || null;
    const soiMid = soi0 ? { x: (soi0.x0 + soi0.x1) * 0.5, z: (soi0.z0 + soi0.z1) * 0.5 } : { x: -150, z: -150 };
    const soiRunStart = (G.mission && G.mission.missions && G.mission.missions.soiRun && G.mission.missions.soiRun.startLine) || soiMid;
    const nearestVeh = pred => {
      let best = null, bd = 1e9;
      for (const v of G.vehicles || []) {
        if (!v || v.dead || !v.pos || v.driver === 'player') continue;
        if (!pred(v)) continue;
        const dd = Math.hypot(v.pos.x - p.x, v.pos.z - p.z);
        if (dd < bd) { bd = dd; best = v.pos; }
      }
      return best;
    };
    let bizLoc = null, bizD = 1e9;
    for (const b of BUSINESSES) {
      if (!b.pos) continue;
      const dd = Math.hypot(b.pos.x - p.x, b.pos.z - p.z);
      if (dd < bizD) { bizD = dd; bizLoc = b.pos; }
    }
    if (G._welcomeDone) out.push({ name: 'Soi Run', status: G._soiRunWon ? 'done · replay' : 'available', job: 'soiRun', dist: GAMEPLAY.phonePlaces ? d(soiRunStart) : null });
    if (G._holdYardDone) out.push({ name: 'Lumpinee Bout', status: G._boutDone ? 'done · replay' : 'available', job: 'bout', dist: d(poi.temple) });
    if (G._boutDone) out.push({ name: 'Monsoon', status: G._monsoonDone ? 'done · replay' : 'available', job: 'monsoon', dist: d(poi.pier) });
    if (G._monsoonDone) out.push({ name: 'Customs Issue', status: G._customsDone ? 'done · replay' : 'available', job: 'customs', dist: d(poi.klongToey) });
    out.push({ name: '2 AM Soi Race', status: G._nightSoiDone ? 'done · replay' : 'bikes · night', job: 'nightSoi', dist: GAMEPLAY.phonePlaces ? d(soiMid) : null });
    if (G.checkpoint) {
      const hh = ((G.time.dayT % 1) + 1) % 1 * 24;
      const nightCp = hh >= 21 || hh < 5.2;
      const lateCp = GAMEPLAY.twoAmCheckpoint && hh >= 1.5 && hh < 3.8;
      out.push({
        name: '2 AM checkpoint',
        status: lateCp ? 'spike strip · slow' : nightCp ? 'cones out' : 'day shift',
        dist: d(G.checkpoint),
      });
    }
    if (poi.gym) out.push({ name: 'Muay Thai gym', status: `melee ${((G.econ.upgrades && G.econ.upgrades.melee) || 0)}/3`, dist: d(poi.gym) });
    if (poi.suvarnabhumi) out.push({ name: 'Suvarnabhumi', status: 'taxi an airliner', dist: d(poi.suvarnabhumi) });
    if (G.world && G.world.bts) out.push({ name: 'BTS Asok', status: 'ride the skytrain', dist: d({ x: G.world.bts.x, z: G.world.bts.z || 0 }) });
    if (G.btsMalai && G.btsMalai.mesh) {
      out.push({ name: 'Malai at Asok', status: G._malai ? 'garland in hand' : 'พวงมาลัย · ฿20', dist: d(G.btsMalai.mesh.position) });
    }
    if (poi.yaowarat) out.push({ name: 'Yaowarat', status: 'night market', dist: d(poi.yaowarat) });
    if (poi.cowboy || (G.soiCowboy && G.soiCowboy.origin)) {
      const loc = poi.cowboy || G.soiCowboy.origin;
      const hh = ((G.time.dayT % 1) + 1) % 1 * 24;
      const open = hh >= 20 || hh < 4;
      out.push({ name: 'Soi Cowboy', status: open ? 'neon · open' : 'closed till 20:00', dist: d(loc) });
    }
    if (G.world && G.world.bank) {
      const h = G.heist;
      const st = (h && h.active) ? 'in progress' : (h && performance.now() < h.cooldownUntil) ? `cooldown ${Math.ceil((h.cooldownUntil - performance.now()) / 1000)}s` : 'ready';
      out.push({ name: 'Bank Heist', status: st, dist: d(G.world.bank.vault) });
      out.push({ name: 'Bank account', status: `฿${Math.floor(G.econ.bank.balance).toLocaleString()}`, dist: d(G.world.bank.teller) });
    }
    let owned = 0, rate = 0;
    for (const b of BUSINESSES) { const s = G.econ.businesses[b.id]; if (s && s.owned) { owned++; rate += bizRate(b, s); } }
    out.push({ name: 'Properties', status: `${owned}/${BUSINESSES.length} · ฿${rate}/s`, dist: GAMEPLAY.phonePlaces ? d(bizLoc) : null });
    let held = 0; for (const t of TURFS) if (G.turfs && G.turfs[t.id] && G.turfs[t.id].owned) held++;
    const nt = TURFS.map(t => d(t.center)).filter(x => x != null).sort((a, b) => a - b)[0];
    out.push({ name: 'Gang turf', status: `${held}/${TURFS.length} held`, dist: nt == null ? null : nt });
    out.push({ name: 'Arcade · Tuk-Tuk Dash', status: 'mall floor 1', dist: d(poi.terminal) });
    out.push({ name: 'Riverside boats', status: 'longtails', dist: d(poi.pier) });
    if (G.boatNoodle && G.boatNoodle.mesh) {
      out.push({ name: 'Boat noodles', status: 'ก๋วยเตี๋ยวเรือ · ฿50', dist: d(G.boatNoodle.mesh.position) });
    }
    if (G.somTam && G.somTam[0] && G.somTam[0].mesh) {
      out.push({ name: 'Som tam cart', status: 'ส้มตำ · ฿45', dist: d(G.somTam[0].mesh.position) });
    }
    out.push({ name: 'Taxi · press J', status: (G.taxi && G.taxi.stage && G.taxi.stage !== 'idle') ? 'fare active' : 'available', dist: GAMEPLAY.phonePlaces ? d(nearestVeh(v => v.kind === 'songthaew')) : null });
    const stand = G.world && G.world.motosaiStands && G.world.motosaiStands.find(s => s.bike && !s.bike.driver);
    out.push({ name: 'Motosai · press J', status: (G.motosai && G.motosai.stage && G.motosai.stage !== 'idle') ? 'fare active' : 'bike · sois', dist: stand && stand.bike ? d(stand.bike.pos) : null });
    const qd = G.quickDrop;
    const qdStatus = qd && qd.stage !== 'idle'
      ? (qd.stage === 'toPickup' ? 'pickup' : `drop-off · streak ${qd.streak || 0}`)
      : 'bike/tuk delivery';
    out.push({ name: 'Moto Drop · Y/J', status: qdStatus, dist: GAMEPLAY.phonePlaces ? d(nearestVeh(v => v.kind === 'bike' || v.kind === 'tuktuk')) : null });
    out.sort((a, b) => (a.dist == null ? 1e9 : a.dist) - (b.dist == null ? 1e9 : b.dist));
    return out;
  }
  function setPhoneStats() {
    const actEl = document.getElementById('ph-activities');
    if (actEl) {
      actEl.innerHTML = phoneActivities().map(a =>
        `<div class="act${a.job ? ' job' : ''}" ${a.job ? `data-job="${a.job}"` : ''}><span class="a-name">${a.name}</span><span class="a-meta">${a.status}${a.dist != null ? ` · ${a.dist}m` : ''}</span></div>`).join('');
      actEl.onclick = e => {
        const row = e.target.closest('[data-job]');
        if (!row || !G.mission || !G.mission.start) return;
        const job = row.getAttribute('data-job');
        if (!job) return;
        G.mission.start(job);
        phone.classList.remove('open');
        G.state = 'playing';
        if (G.input && G.input.requestLock) G.input.requestLock();
      };
    }
    const total = (G.world && G.world.collectibles) ? G.world.collectibles.length : 0;
    document.getElementById('ph-amulets').textContent = `${G.collected || 0} / ${total}`;
    document.getElementById('ph-fares').textContent = (G.taxi && G.taxi.fares) || 0;
    document.getElementById('ph-cops').textContent = G.copsKilled || 0;
    const mm = missionMilestones();
    const pct = Math.round((G.collected || 0) / Math.max(1, total) * 70 + mm.done / mm.total * 30);
    document.getElementById('ph-complete').textContent = pct + '%';
    document.getElementById('ph-food').textContent = `${G.foodVisited || 0} / ${(G.world.foodStalls || []).length}`;
    const bankEl = document.getElementById('ph-bank');
    if (bankEl) bankEl.textContent = Math.floor((G.econ.bank && G.econ.bank.balance) || 0).toLocaleString();
    const rankEl = document.getElementById('ph-rank');
    if (rankEl) rankEl.textContent = `${WEALTH_TIERS[G._wealthRank || 0].name} · ฿${netWorth().toLocaleString()} net worth`;
    const bizEl = document.getElementById('ph-biz');
    if (bizEl) {
      let owned = 0, rate = 0, pending = 0; const lines = [];
      for (const b of BUSINESSES) {
        const s = G.econ.businesses[b.id];
        if (s && s.owned) {
          owned++; const r = bizRate(b, s); rate += r; pending += Math.floor(s.pending || 0);
          const ev = s.event ? (s.event.type === 'boom' ? ' <span style="color:#4dff9a">BOOM</span>' : ' <span style="color:#ff7a6a">⚠ TROUBLE</span>') : '';
          lines.push(`• ${b.name} <span style="opacity:.55">T${s.tier || 1}</span> ฿${r}/s` + (s.manager ? ' <span style="color:#7fd0a0;opacity:.85">mgr</span>' : '') + ev);
        }
      }
      bizEl.textContent = `${owned} / ${BUSINESSES.length} · ฿${rate}/s` + (pending > 0 ? ` · ฿${pending.toLocaleString()} ready` : '');
      const list = document.getElementById('ph-biz-list');
      if (list) list.innerHTML = lines.join('<br>');
    }
  }
  function setVehicle(hp, show) {
    const row = document.getElementById('veh-row');
    if (!row) return;
    row.style.display = show ? '' : 'none';
    if (show) document.getElementById('veh-fill').style.width = clamp(hp, 0, 100) + '%';
  }
  function setSpeed(vel, show, rpm01) {
    const el = document.getElementById('speedo');
    if (!el) return;
    const on = !!(show && GAMEPLAY.speedo);
    el.style.display = on ? '' : 'none';
    if (on) el.textContent = Math.round(Math.abs(vel || 0) * 3.6) + ' km/h';
    const tach = document.getElementById('tach-fill');
    const tachRow = document.getElementById('tach-row');
    if (tachRow) tachRow.style.display = (on && GAMEPLAY.tach) ? '' : 'none';
    if (tach && on && GAMEPLAY.tach) tach.style.width = (clamp(rpm01 != null ? rpm01 : 0, 0, 1) * 100) + '%';
  }
  function setClock(s) { document.getElementById('clock').textContent = s; document.getElementById('ph-time').textContent = s; }
  function setWeather(t) { document.getElementById('weather-tag').textContent = t; }
  function setCrosshair(show) { crosshair.classList.toggle('show', !!show); }
  // Hitmarker — a brief red pop on the crosshair when a shot connects.
  let hitMarkT = 0;
  function hitMarker() { crosshair.classList.add('hit'); hitMarkT = 0.18; }
  function togglePhone(open) {
    if (open == null) phone.classList.toggle('open');
    else phone.classList.toggle('open', open);
  }
  function update(dt) {
    if (subT > 0) { subT -= dt; if (subT <= 0) subtitle.classList.remove('show'); }
    if (promptT > 0) { promptT -= dt; if (promptT <= 0) promptEl.classList.remove('show'); }
    if (notifT > 0) { notifT -= dt; if (notifT <= 0) notif.classList.remove('show'); }
    if (hitMarkT > 0) { hitMarkT -= dt; if (hitMarkT <= 0) crosshair.classList.remove('hit'); }
  }
  function drawMinimap(player) {
    // draw base
    mctx.clearRect(0,0,256,256);
    // center the world on the player by translating
    const SCALE = 256 / (HALF * 2);                 // world metres → minimap px
    const mapPos = (player.inVehicle && player.inVehicle.pos) || player.group.position;
    const zoom = G.minimapZoom || 2.4;
    const ppx = (mapPos.x + HALF) * SCALE;
    const ppy = (mapPos.z + HALF) * SCALE;
    const mm = p => [(p.x + HALF) * SCALE - ppx, (p.z + HALF) * SCALE - ppy];
    const projectMini = p => {
      const [lx, ly] = mm(p);
      const sx = lx * zoom, sy = ly * zoom;
      const c = Math.cos(G.camRig.yaw), s = Math.sin(G.camRig.yaw);
      return [128 + sx * c + sy * s, 128 - sx * s + sy * c];
    };
    const inRadar = (x, y, pad = 0) => Math.hypot(x - 128, y - 128) <= 122 - pad;
    const drawMiniBadge = (pos, label, color) => {
      if (!pos) return;
      const [x, y] = projectMini(pos);
      if (!inRadar(x, y, 18)) return;
      mctx.save();
      mctx.fillStyle = 'rgba(3,6,10,0.88)';
      mctx.beginPath(); mctx.arc(x, y, 8, 0, TAU); mctx.fill();
      mctx.fillStyle = color;
      mctx.beginPath(); mctx.arc(x, y, 5, 0, TAU); mctx.fill();
      mctx.font = 'bold 9px system-ui, sans-serif';
      mctx.textAlign = 'center';
      const tw = Math.ceil(mctx.measureText(label).width) + 8;
      const lx = clamp(x - tw / 2, 5, 251 - tw), ly = clamp(y - 24, 5, 232);
      mctx.fillStyle = 'rgba(3,6,10,0.82)';
      mctx.fillRect(lx, ly, tw, 14);
      mctx.strokeStyle = color; mctx.lineWidth = 1;
      mctx.strokeRect(lx + 0.5, ly + 0.5, tw - 1, 13);
      mctx.fillStyle = '#f2fff9';
      mctx.fillText(label, lx + tw / 2, ly + 10);
      mctx.restore();
    };
    mctx.save();
    mctx.translate(128, 128);
    // rotate by camera yaw so up = forward
    mctx.rotate(-G.camRig.yaw);
    mctx.scale(zoom, zoom);   // N cycles zoom levels
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
    if (G.motosai && G.motosai.stage !== 'idle' && G.motosai.markerPos) {
      const mx = (G.motosai.markerPos.x + HALF) * (256 / (HALF*2));
      const my = (G.motosai.markerPos.z + HALF) * (256 / (HALF*2));
      mctx.fillStyle = G.motosai.stage === 'toDropoff' ? '#39ff7a' : '#ff7a1a';
      mctx.beginPath(); mctx.arc(mx - ppx, my - ppy, 4, 0, TAU); mctx.fill();
    }
    if (G.quickDrop && G.quickDrop.stage !== 'idle' && G.quickDrop.markerPos) {
      const qx = (G.quickDrop.markerPos.x + HALF) * (256 / (HALF*2));
      const qy = (G.quickDrop.markerPos.z + HALF) * (256 / (HALF*2));
      mctx.fillStyle = G.quickDrop.stage === 'toPickup' ? '#ffcf4a' : '#21f0ff';
      mctx.beginPath(); mctx.arc(qx - ppx, qy - ppy, 4.5, 0, TAU); mctx.fill();
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

    // Upright badges for important markers. These sit above the rotating map so
    // the radar can explain what the colored symbols mean at a glance.
    let target = null, targetLabel = 'OBJ', targetColor = '#ff2a86';
    if (G.heist && G.heist.active && G.heist.markerPos) {
      target = G.heist.markerPos; targetLabel = G.heist.stage === 2 ? 'DROP' : 'VAULT'; targetColor = G.heist.stage === 2 ? '#39ff7a' : '#ffcf4a';
    } else if (G.vigilante && G.vigilante.active && G.vigilante.markerPos) {
      target = G.vigilante.markerPos; targetLabel = 'TARGET'; targetColor = '#ff3333';
    } else if (G.quickDrop && G.quickDrop.stage !== 'idle' && G.quickDrop.markerPos) {
      target = G.quickDrop.markerPos; targetLabel = G.quickDrop.stage === 'toPickup' ? 'PICK' : 'DROP'; targetColor = G.quickDrop.stage === 'toPickup' ? '#ffcf4a' : '#21f0ff';
    } else if (G.motosai && G.motosai.stage && G.motosai.stage !== 'idle' && G.motosai.markerPos) {
      target = G.motosai.markerPos; targetLabel = G.motosai.stage === 'toDropoff' ? 'DROP' : 'SAI'; targetColor = G.motosai.stage === 'toDropoff' ? '#39ff7a' : '#ff7a1a';
    } else if (G.taxi && G.taxi.stage && G.taxi.stage !== 'idle' && G.taxi.markerPos) {
      target = G.taxi.markerPos; targetLabel = G.taxi.stage === 'toDropoff' ? 'DROP' : 'TAXI'; targetColor = G.taxi.stage === 'toDropoff' ? '#39ff7a' : '#ffcf4a';
    } else if (G.mission && G.mission.active && G.mission.active.markerPos) {
      target = G.mission.active.markerPos; targetLabel = 'OBJ'; targetColor = '#ff2a86';
    }
    drawMiniBadge(target, targetLabel, targetColor);
    if (shPos) drawMiniBadge(shPos, 'HOME', HOME_COLOR);
    if (ga0 && ga0.pos) drawMiniBadge(ga0.pos, 'GAR', GARAGE_COLOR);
    if (t21) drawMiniBadge(t21, 'MALL', MALL_COLOR);
    for (const e of (G.world.sevenElevens || [])) drawMiniBadge(e.pos, '7-11', SEVEN_COLOR);
    for (const shop of ((G.world.gunShops && G.world.gunShops.length) ? G.world.gunShops : (G.world.gunShop ? [{ pos: G.world.gunShop }] : []))) drawMiniBadge(shop.pos || shop, 'GUN', '#ff3344');
    if (G.world.poi && G.world.poi.bank) drawMiniBadge(G.world.poi.bank, 'BANK', BANK_COLOR);
    if (G.world.bts) drawMiniBadge({ x: G.world.bts.x, z: G.world.bts.z || 0 }, 'BTS', BTS_COLOR);
    if (G.world.poi && G.world.poi.suvarnabhumi) drawMiniBadge(G.world.poi.suvarnabhumi, 'BKK', '#c9a020');

    // player blip (always center, facing up)
    mctx.save();
    mctx.strokeStyle = 'rgba(3,6,10,0.9)';
    mctx.lineWidth = 7;
    mctx.beginPath(); mctx.arc(128, 128, 14, 0, TAU); mctx.stroke();
    mctx.strokeStyle = '#ffffff';
    mctx.lineWidth = 2;
    mctx.beginPath(); mctx.arc(128, 128, 14, 0, TAU); mctx.stroke();
    mctx.fillStyle = '#21f0ff';
    mctx.beginPath();
    mctx.moveTo(128, 114);
    mctx.lineTo(119, 137);
    mctx.lineTo(128, 132);
    mctx.lineTo(137, 137);
    mctx.closePath();
    mctx.fill();
    mctx.strokeStyle = '#061014'; mctx.lineWidth = 2; mctx.stroke();
    mctx.restore();
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
    // Target priority: active timed side jobs override the long-running story marker.
    let target = null, color = '#ff2a86', label = 'Objective';
    const m = G.mission && G.mission.active;
    if (G.heist && G.heist.active && G.heist.markerPos) {
      target = G.heist.markerPos; color = G.heist.stage === 2 ? '#39ff7a' : '#ffcf4a'; label = G.heist.stage === 2 ? 'Loot drop' : 'Vault';
    } else if (G.vigilante && G.vigilante.active && G.vigilante.markerPos) {
      target = G.vigilante.markerPos; color = '#ff3333'; label = `Vigilante target · ${Math.ceil(G.vigilante.timeLeft || 0)}s`;
    } else if (G.quickDrop && G.quickDrop.stage !== 'idle' && G.quickDrop.markerPos) {
      target = G.quickDrop.markerPos; color = G.quickDrop.stage === 'toPickup' ? '#ffcf4a' : '#21f0ff'; label = G.quickDrop.stage === 'toDropoff' ? 'Moto drop' : 'Moto pickup';
    } else if (G.motosai && G.motosai.stage && G.motosai.stage !== 'idle' && G.motosai.markerPos) {
      target = G.motosai.markerPos; color = G.motosai.stage === 'toDropoff' ? '#39ff7a' : '#ff7a1a'; label = G.motosai.stage === 'toDropoff' ? 'Motosai drop' : 'Motosai pick-up';
    } else if (G.taxi && G.taxi.stage && G.taxi.stage !== 'idle' && G.taxi.markerPos) {
      target = G.taxi.markerPos; color = '#39ff7a'; label = G.taxi.stage === 'toDropoff' ? 'Drop-off' : 'Pick-up';
    } else if (m && m.markerPos) { target = m.markerPos; color = '#ff2a86'; label = m.name || 'Objective'; }
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
    setStars, flashWanted, setCash, cashPop, flashScreen, setBars, setAmmo, setMissionText, setClock, setWeather, setCrosshair, hitMarker, setPhoneStats, setVehicle, setSpeed,
    showSubtitle, showPrompt, showNotif, togglePhone, update, drawMinimap, drawWaypoint, setRadioChip
  };
}

// =============================================================================

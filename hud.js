// =============================================================================
// HUD — extracted from main.js (see numbered sections). No logic change.
// =============================================================================
import * as THREE from 'three';
import {
  makeStaticBaker, PI, TAU, clamp, lerp, rand, irand, pick, sign, dist2, COLORS, G, PRICE, PAINT_COLORS, ROAD_WIDTH, PED_TARGET, GAMEPLAY, _camTarget, _camOffset, _fireDir, _ray, _bbox, _vBox, _blackColor, disposeObject, BLOCK, GRID, HALF, lerpAngle
} from './core.js';

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
    document.getElementById('ph-cops').textContent = _copsKilled || 0;
    const milestones = (G._welcomeDone ? 1 : 0) + (G._soiRunWon ? 1 : 0) + (G._hitDone ? 1 : 0);
    const pct = Math.round((G.collected || 0) / Math.max(1, total) * 70 + milestones / 3 * 30);
    document.getElementById('ph-complete').textContent = pct + '%';
    document.getElementById('ph-food').textContent = `${G.foodVisited || 0} / ${(G.world.foodStalls || []).length}`;
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
    const ppx = (player.group.position.x + HALF) * (256 / (HALF*2));
    const ppy = (player.group.position.z + HALF) * (256 / (HALF*2));
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

  return {
    setStars, flashWanted, setCash, setBars, setAmmo, setMissionText, setClock, setWeather, setCrosshair, setPhoneStats, setVehicle,
    showSubtitle, showPrompt, showNotif, togglePhone, update, drawMinimap
  };
}

// =============================================================================

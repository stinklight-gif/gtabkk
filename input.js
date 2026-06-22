// =============================================================================
// INPUT — keyboard set, pointer-lock mouse deltas, edge-detected `pressed`,
// plus on-screen TOUCH controls (virtual stick + look drag + buttons) so the
// game is playable from a phone. All gameplay polls down()/pressed(), so the
// touch UI just feeds a parallel set of "virtual keys" + the same look delta.
// =============================================================================
import { G } from './core.js';

export function makeInput() {
  const keys = new Set();
  const vkeys = new Set();              // virtual keys driven by the touch UI
  let mouseX = 0, mouseY = 0;
  let mouseDX = 0, mouseDY = 0;
  let mouseDown = false, rightDown = false;
  let pointerLocked = false;
  let prevKeys = new Set();
  let prevVkeys = new Set();
  const isTouch = (('ontouchstart' in window) || (navigator.maxTouchPoints || 0) > 0);

  window.addEventListener('keydown', e => {
    keys.add(e.code);
    if (['Tab','Space','KeyT','KeyB'].includes(e.code)) e.preventDefault();
  });
  window.addEventListener('keyup',   e => keys.delete(e.code));
  window.addEventListener('blur',    ()=> keys.clear());
  window.addEventListener('mousemove', e => {
    if (pointerLocked) { mouseDX += e.movementX; mouseDY += e.movementY; }
    mouseX = e.clientX; mouseY = e.clientY;
  });
  window.addEventListener('mousedown', e => { if (e.button===0) mouseDown=true; if (e.button===2) rightDown=true; });
  window.addEventListener('mouseup',   e => { if (e.button===0) mouseDown=false; if (e.button===2) rightDown=false; });
  window.addEventListener('contextmenu', e => e.preventDefault());
  document.addEventListener('pointerlockchange', () => {
    pointerLocked = document.pointerLockElement != null;
    // losing the lock while playing (Esc / alt-tab) pauses the game — but never on
    // touch, where we never lock and look comes from drag instead.
    if (!pointerLocked && G.state === 'playing' && !isTouch) {
      G.state = 'paused';
      const pe = document.getElementById('pause');
      if (pe) pe.classList.add('show');
    }
  });

  const vk = (code, on) => { if (on) vkeys.add(code); else vkeys.delete(code); };

  // ---- touch controls ----------------------------------------------------
  function setupTouch() {
    const root = document.getElementById('touch');
    if (!root) return;
    document.body.classList.add('is-touch');     // CSS reveals the on-screen controls
    const opt = { passive: false };

    // Hold-to-press buttons: data-key holds a virtual key down while touched.
    root.querySelectorAll('button[data-key]').forEach(btn => {
      const code = btn.getAttribute('data-key');
      const press = e => { vkeys.add(code); btn.classList.add('on'); if (e.cancelable) e.preventDefault(); e.stopPropagation(); };
      const release = e => { vkeys.delete(code); btn.classList.remove('on'); e.stopPropagation(); };
      btn.addEventListener('touchstart', press, opt);
      btn.addEventListener('touchend', release, opt);
      btn.addEventListener('touchcancel', release, opt);
      btn.addEventListener('mousedown', press);   // also usable with a mouse (desktop testing)
      btn.addEventListener('mouseup', release);
      btn.addEventListener('mouseleave', release);
    });

    // Virtual stick (bottom-left): synthesizes WASD from the thumb vector.
    const base = document.getElementById('stick-base'), knob = document.getElementById('stick-knob');
    if (base && knob) {
      const R = 52; let id = null, cx = 0, cy = 0;
      const apply = (dx, dy) => {
        const mag = Math.hypot(dx, dy) || 1, cl = Math.min(1, mag / R);
        const nx = dx / mag * cl, ny = dy / mag * cl;
        knob.style.transform = `translate(${(nx * R).toFixed(1)}px, ${(ny * R).toFixed(1)}px)`;
        vk('KeyW', ny < -0.35); vk('KeyS', ny > 0.35); vk('KeyA', nx < -0.35); vk('KeyD', nx > 0.35);
      };
      const reset = () => { id = null; knob.style.transform = 'translate(0,0)'; vk('KeyW', false); vk('KeyS', false); vk('KeyA', false); vk('KeyD', false); };
      base.addEventListener('touchstart', e => {
        const t = e.changedTouches[0]; id = t.identifier;
        const r = base.getBoundingClientRect(); cx = r.left + r.width / 2; cy = r.top + r.height / 2;
        apply(t.clientX - cx, t.clientY - cy); e.preventDefault(); e.stopPropagation();
      }, opt);
      base.addEventListener('touchmove', e => { for (const t of e.changedTouches) if (t.identifier === id) { apply(t.clientX - cx, t.clientY - cy); e.preventDefault(); } }, opt);
      const end = e => { for (const t of e.changedTouches) if (t.identifier === id) reset(); };
      base.addEventListener('touchend', end, opt); base.addEventListener('touchcancel', end, opt);
    }

    // Look layer (fills the screen behind the buttons): drag to turn the camera.
    const look = document.getElementById('touch-look');
    if (look) {
      const ids = new Map();   // touch id -> last {x, y}
      look.addEventListener('touchstart', e => { for (const t of e.changedTouches) ids.set(t.identifier, { x: t.clientX, y: t.clientY }); e.preventDefault(); }, opt);
      look.addEventListener('touchmove', e => {
        for (const t of e.changedTouches) {
          const p = ids.get(t.identifier); if (!p) continue;
          if (G.state === 'playing') { mouseDX += (t.clientX - p.x) * 1.5; mouseDY += (t.clientY - p.y) * 1.5; }
          p.x = t.clientX; p.y = t.clientY;
        }
        e.preventDefault();
      }, opt);
      const end = e => { for (const t of e.changedTouches) ids.delete(t.identifier); };
      look.addEventListener('touchend', end, opt); look.addEventListener('touchcancel', end, opt);
    }

    // Pause button: no pointer-lock on touch, so toggle the overlay directly.
    const pauseBtn = document.getElementById('touch-pause');
    if (pauseBtn) pauseBtn.addEventListener('click', e => {
      e.stopPropagation();
      const pe = document.getElementById('pause');
      if (G.state === 'playing') { G.state = 'paused'; if (pe) pe.classList.add('show'); }
      else if (G.state === 'paused') { G.state = 'playing'; if (pe) pe.classList.remove('show'); }
    });
  }
  if (isTouch) setupTouch();

  return {
    isTouch,
    down: c => keys.has(c) || vkeys.has(c),
    pressed: c => (keys.has(c) || vkeys.has(c)) && !(prevKeys.has(c) || prevVkeys.has(c)),
    get mouseDown(){ return mouseDown; },
    get rightDown(){ return rightDown; },
    get pointerLocked(){ return pointerLocked; },
    consumeMouseDelta() { const dx=mouseDX, dy=mouseDY; mouseDX=0; mouseDY=0; return [dx,dy]; },
    requestLock() {
      if (isTouch) return;                         // no pointer lock on touch — look is drag-driven
      const el = G.renderer.domElement;
      if (document.pointerLockElement !== el) el.requestPointerLock();
    },
    endFrame() { prevKeys = new Set(keys); prevVkeys = new Set(vkeys); },
  };
}

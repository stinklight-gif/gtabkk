// =============================================================================
// INPUT — keyboard set, pointer-lock mouse deltas, edge-detected `pressed`.
// =============================================================================
import { G } from './core.js';

export function makeInput() {
  const keys = new Set();
  let mouseX = 0, mouseY = 0;
  let mouseDX = 0, mouseDY = 0;
  let mouseDown = false, rightDown = false;
  let pointerLocked = false;
  let prevKeys = new Set();

  window.addEventListener('keydown', e => {
    keys.add(e.code);
    // prevent some defaults
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
    // losing the lock while playing (Esc / alt-tab) pauses the game
    if (!pointerLocked && G.state === 'playing') {
      G.state = 'paused';
      const pe = document.getElementById('pause');
      if (pe) pe.classList.add('show');
    }
  });

  return {
    down: c => keys.has(c),
    pressed: c => keys.has(c) && !prevKeys.has(c),
    get mouseDown(){ return mouseDown; },
    get rightDown(){ return rightDown; },
    get pointerLocked(){ return pointerLocked; },
    consumeMouseDelta() { const dx=mouseDX, dy=mouseDY; mouseDX=0; mouseDY=0; return [dx,dy]; },
    requestLock() {
      const el = G.renderer.domElement;
      if (document.pointerLockElement !== el) el.requestPointerLock();
    },
    endFrame() { prevKeys = new Set(keys); },
  };
}

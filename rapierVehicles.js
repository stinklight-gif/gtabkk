// Rapier player-vehicle experiment. GAMEPLAY.rapier stays OFF until the arcade
// bands in realism_pass_test [4]/[5]/[10] can be matched. No WASM is loaded
// while the flag is false, so CI/offline keep the arcade solver.
import { GAMEPLAY, G } from './core.js';

let _world = null;
let _body = null;

export async function initRapier() {
  if (!GAMEPLAY.rapier) return false;
  try {
    const RAPIER = await import('./vendor/rapier/rapier.es.js');
    const rapier = await RAPIER.init();
    _world = new rapier.World({ x: 0, y: -9.81, z: 0 });
    G.rapier = { world: _world, RAPIER: rapier };
    return true;
  } catch (e) {
    GAMEPLAY.rapier = false;
    return false;
  }
}

export function attachPlayerVehicle(v) {
  if (!GAMEPLAY.rapier || !_world || !v) { _body = null; return; }
  _body = v;
}

export function syncPlayerVehicle(v, dt) {
  if (!GAMEPLAY.rapier || !_world || !v || v !== _body) return false;
  // Placeholder: we never step a body while the flag is off / WASM is missing.
  // Returning false means vehicles.js should run the arcade integrator.
  return false;
}

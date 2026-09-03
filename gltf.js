// Hero GLTF attach — Wave bike near-LOD. Procedural boxes stay as far LOD.
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { GAMEPLAY, G } from './core.js';

let _loader = null;
let _wave = null;
let _failed = false;

export function attachHeroBike(group) {
  if (!GAMEPLAY.gltf || !group || group.userData.kind !== 'bike' || _failed) return Promise.resolve(false);
  if (!_loader) _loader = new GLTFLoader();
  const apply = (scene) => {
    const root = scene.clone(true);
    root.name = 'gltf-hero';
    root.userData.gltfHero = true;
    const lod = group.userData.lod;
    if (lod && lod.high) {
      for (const c of lod.high) {
        if (c.name === 'lod-low' || (c.userData && c.userData.keep)) continue;
        c.visible = false;
        c.userData.propHidden = true;
      }
      lod.high.push(root);
    }
    group.add(root);
    return true;
  };
  if (_wave) return Promise.resolve(apply(_wave));
  return _loader.loadAsync('./models/wave.gltf').then(gltf => {
    _wave = gltf.scene;
    _wave.name = 'gltf-hero';
    return apply(_wave);
  }).catch(() => {
    _failed = true;
    GAMEPLAY.gltf = false;
    if (G.gameplay) G.gameplay.gltf = false;
    return false;
  });
}

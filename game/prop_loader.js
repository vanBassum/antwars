import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

const loader = new GLTFLoader();
const cache  = {};

export const PropLoader = {
  preload(paths) {
    return Promise.all(paths.map(path =>
      new Promise(resolve =>
        loader.load(path, gltf => { cache[path] = gltf.scene; resolve(); })
      )
    ));
  },

  // Returns a fresh clone of a cached prop ready to attach
  clone(path) {
    const src = cache[path];
    if (!src) { console.warn('Prop not preloaded:', path); return null; }
    const c = src.clone(true);
    c.traverse(n => { if (n.isMesh) { n.castShadow = true; } });
    return c;
  },
};

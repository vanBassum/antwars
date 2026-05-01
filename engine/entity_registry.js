import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { EntityDef } from './entity_def.js';
import { GameObject } from './gameobject.js';

const _loader = new GLTFLoader();
const _cache  = new Map(); // url → THREE.Group

async function _load(url) {
  if (_cache.has(url)) return;
  const gltf = await _loader.loadAsync(url);
  _cache.set(url, gltf.scene);
}

function _clone(url) {
  const clone = _cache.get(url).clone(true);
  clone.traverse(obj => {
    if (obj.isMesh) { obj.castShadow = true; obj.receiveShadow = true; }
  });
  return clone;
}

export const ENTITY_DEFS = [
  new EntityDef({
    id: 'watchtower', name: 'Watchtower', icon: '🗼', yOffset: 0,
    modelUrl: 'assets/models/WatchTower.glb',
    createObject() {
      const go = new GameObject('Watchtower');
      go.object3D.add(_clone(this.modelUrl));
      return go;
    },
  }),
];

export async function preloadEntityModels() {
  await Promise.all(ENTITY_DEFS.filter(d => d.modelUrl).map(d => _load(d.modelUrl)));
}

import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

// Generic GLTF loader + clone cache. Game-agnostic.
const _loader = new GLTFLoader();
const _cache  = new Map(); // url → THREE.Group

// Load and cache a model. Idempotent — repeated calls return immediately.
export async function loadModel(url) {
  if (_cache.has(url)) return;
  const gltf = await _loader.loadAsync(url);
  _cache.set(url, gltf.scene);
}

// Returns a fresh clone of a previously loaded model with shadows enabled.
export function cloneModel(url) {
  const cached = _cache.get(url);
  if (!cached) throw new Error(`cloneModel: "${url}" not loaded — call loadModel first`);
  const clone = cached.clone(true);
  clone.traverse(obj => {
    if (obj.isMesh) { obj.castShadow = true; obj.receiveShadow = true; }
  });
  return clone;
}

// Max horizontal extent (max of bbox.x, bbox.z) of a preloaded model.
export function measureModelFootprint(url) {
  const scene = _cache.get(url);
  if (!scene) return 0;
  const size = new THREE.Vector3();
  new THREE.Box3().setFromObject(scene).getSize(size);
  return Math.max(size.x, size.z);
}

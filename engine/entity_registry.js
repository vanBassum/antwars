import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { EntityDef } from './entity_def.js';
import { GameObject } from './gameobject.js';
import { ResourceNode } from './components/resource_node.js';
import { Mover } from './components/mover.js';
import { Worker } from './components/worker.js';
import { GOAPAgent } from './ai/goap/goap_agent.js';

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
    id: 'watchtower', name: 'Watchtower', icon: '🗼', yOffset: 0, occupiesHex: true,
    modelUrl: 'assets/models/WatchTower.glb',
    createObject() {
      const go = new GameObject('Watchtower');
      go.object3D.add(_clone(this.modelUrl));
      return go;
    },
  }),
  new EntityDef({
    id: 'anthill', name: 'Ant Hill', icon: '🐜', yOffset: 0, occupiesHex: true,
    entrance: [0, 1], // south neighbor — ants enter/leave through the bottom
    modelUrl: 'assets/models/AntHill.glb',
    createObject() {
      const go = new GameObject('Ant Hill');
      go.object3D.add(_clone(this.modelUrl));
      return go;
    },
  }),
  new EntityDef({
    id: 'sugar_node', name: 'Sugar Node', icon: '🍬', yOffset: 0, occupiesHex: true,
    modelUrl: 'assets/models/SugarNode.glb',
    createObject() {
      const go = new GameObject('Sugar Node');
      go.object3D.add(_clone(this.modelUrl));
      go.addComponent(new ResourceNode({ type: 'sugar', amount: 25 }));
      return go;
    },
  }),
  new EntityDef({
    id: 'bush', name: 'Bush', icon: '🌿', yOffset: 0, occupiesHex: true,
    modelUrl: 'assets/models/Bush.glb',
    createObject() {
      const go = new GameObject('Bush');
      go.object3D.add(_clone(this.modelUrl));
      go.addComponent(new ResourceNode({ type: 'wood', amount: 25 }));
      return go;
    },
  }),
  new EntityDef({
    id: 'ant', name: 'Ant', icon: '🐜', yOffset: 0,
    modelUrl: 'assets/models/Ant.glb',
    createObject() {
      const go = new GameObject('Ant');
      const model = _clone(this.modelUrl);
      model.scale.setScalar(0.25);
      go.object3D.add(model);
      go.addComponent(new Mover(1.5));
      go.addComponent(new GOAPAgent());
      go.addComponent(new Worker());
      return go;
    },
  }),
];

export async function preloadEntityModels() {
  await Promise.all(ENTITY_DEFS.filter(d => d.modelUrl).map(d => _load(d.modelUrl)));
}

// Load and cache a model by URL (for assets not registered as entities).
export function loadModel(url)  { return _load(url); }
export function cloneModel(url) { return _clone(url); }

// Returns the max horizontal extent (max of bbox.x, bbox.z) of a preloaded model.
export function measureModelFootprint(url) {
  const scene = _cache.get(url);
  if (!scene) return 0;
  const size = new THREE.Vector3();
  new THREE.Box3().setFromObject(scene).getSize(size);
  return Math.max(size.x, size.z);
}

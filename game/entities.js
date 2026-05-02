import { EntityDef } from '../engine/entity_def.js';
import { GameObject } from '../engine/gameobject.js';
import { loadModel, cloneModel } from '../engine/model_cache.js';
import { Mover } from '../engine/components/mover.js';
import { GOAPAgent } from '../engine/ai/goap/goap_agent.js';
import { ResourceNode } from './components/resource_node.js';
import { Worker } from './components/worker.js';

export const ENTITY_DEFS = [
  new EntityDef({
    id: 'watchtower', name: 'Watchtower', icon: '🗼', yOffset: 0, occupiesHex: true,
    modelUrl: 'assets/models/WatchTower.glb',
    createObject() {
      const go = new GameObject('Watchtower');
      go.object3D.add(cloneModel(this.modelUrl));
      return go;
    },
  }),
  new EntityDef({
    id: 'anthill', name: 'Ant Hill', icon: '🐜', yOffset: 0, occupiesHex: true,
    entrance: [0, 1], // south neighbor — ants enter/leave through the bottom
    modelUrl: 'assets/models/AntHill.glb',
    createObject() {
      const go = new GameObject('Ant Hill');
      go.object3D.add(cloneModel(this.modelUrl));
      return go;
    },
  }),
  new EntityDef({
    id: 'sugar_node', name: 'Sugar Node', icon: '🍬', yOffset: 0, occupiesHex: true,
    modelUrl: 'assets/models/SugarNode.glb',
    createObject() {
      const go = new GameObject('Sugar Node');
      go.object3D.add(cloneModel(this.modelUrl));
      go.addComponent(new ResourceNode({ type: 'sugar', amount: 25 }));
      return go;
    },
  }),
  new EntityDef({
    id: 'bush', name: 'Bush', icon: '🌿', yOffset: 0, occupiesHex: true,
    modelUrl: 'assets/models/Bush.glb',
    createObject() {
      const go = new GameObject('Bush');
      go.object3D.add(cloneModel(this.modelUrl));
      go.addComponent(new ResourceNode({ type: 'wood', amount: 25 }));
      return go;
    },
  }),
  new EntityDef({
    id: 'ant', name: 'Ant', icon: '🐜', yOffset: 0,
    modelUrl: 'assets/models/Ant.glb',
    createObject() {
      const go = new GameObject('Ant');
      const model = cloneModel(this.modelUrl);
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
  await Promise.all(ENTITY_DEFS.filter(d => d.modelUrl).map(d => loadModel(d.modelUrl)));
}

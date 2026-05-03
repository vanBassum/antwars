import { EntityDef } from '../engine/entity_def.js';
import { GameObject } from '../engine/gameobject.js';
import { loadModel, cloneModel } from '../engine/model_cache.js';
import { Mover } from '../engine/components/mover.js';
import { GOAPAgent } from '../engine/ai/goap/goap_agent.js';
import { ResourceNode } from './components/resource_node.js';
import { Worker } from './components/worker.js';
import { FarmPlot } from './components/farm_plot.js';
import { Queen } from './components/queen.js';
import { EggPickup } from './components/egg_pickup.js';
import { TrainingHut } from './components/training_hut.js';
import { Building } from './components/building.js';

export const ENTITY_DEFS = [
  new EntityDef({
    id: 'watchtower', name: 'Watchtower', icon: '🗼', iconUrl: 'assets/icons/WatchTower.png', yOffset: 0, occupiesHex: true,
    modelUrl: 'assets/models/WatchTower.glb',
    createObject() {
      const go = new GameObject('Watchtower');
      go.object3D.add(cloneModel(this.modelUrl));
      return go;
    },
  }),
  new EntityDef({
    id: 'anthill', name: 'Ant Hill', icon: '🐜', iconUrl: 'assets/icons/AntHill.png', yOffset: 0, occupiesHex: true,
    entrance: [0, 1], // south neighbor — ants enter/leave through the bottom
    modelUrl: 'assets/models/AntHill.glb',
    createObject() {
      const go = new GameObject('Ant Hill');
      go.object3D.add(cloneModel(this.modelUrl));
      return go;
    },
  }),
  new EntityDef({
    id: 'sugar_node', name: 'Sugar Node', icon: '🍬', iconUrl: 'assets/icons/SugarNode.png', yOffset: 0, occupiesHex: true,
    modelUrl: 'assets/models/SugarNode.glb',
    createObject() {
      const go = new GameObject('Sugar Node');
      go.object3D.add(cloneModel(this.modelUrl));
      go.addComponent(new ResourceNode({ type: 'sugar', amount: 25 }));
      return go;
    },
  }),
  new EntityDef({
    id: 'bush', name: 'Bush', icon: '🌿', iconUrl: 'assets/icons/Bush.png', yOffset: 0, occupiesHex: true,
    modelUrl: 'assets/models/Bush.glb',
    createObject() {
      const go = new GameObject('Bush');
      go.object3D.add(cloneModel(this.modelUrl));
      go.addComponent(new ResourceNode({ type: 'wood', amount: 25 }));
      return go;
    },
  }),
  new EntityDef({
    id: 'farm_plot', name: 'Farm Plot', icon: '🌱', iconUrl: 'assets/icons/FarmPlot.png', yOffset: 0, occupiesHex: true,
    modelUrl: 'assets/models/FarmPlot.glb',
    createObject() {
      const go = new GameObject('Farm Plot');
      go.object3D.add(cloneModel(this.modelUrl));
      go.addComponent(new FarmPlot());
      go.addComponent(new Building(this));
      return go;
    },
  }),
  new EntityDef({
    id: 'ant', name: 'Ant', icon: '🐜', iconUrl: 'assets/icons/Ant.png', yOffset: 0,
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
  new EntityDef({
    id: 'queen', name: 'Queen', icon: '👑', iconUrl: 'assets/icons/Queen.png',
    modelUrl: 'assets/models/Queen.glb',
    createObject() {
      const go = new GameObject('Queen');
      const model = cloneModel(this.modelUrl);
      model.scale.setScalar(0.4);
      go.object3D.add(model);
      go.addComponent(new Mover(1.0));
      go.addComponent(new Queen());
      return go;
    },
  }),
  new EntityDef({
    id: 'egg', name: 'Egg', icon: '🥚',
    modelUrl: 'assets/models/Egg.glb',
    createObject() {
      const go = new GameObject('Egg');
      const model = cloneModel(this.modelUrl);
      model.scale.setScalar(0.25);
      go.object3D.add(model);
      go.addComponent(new EggPickup());
      return go;
    },
  }),
  new EntityDef({
    id: 'training_hut', name: 'Training Hut', icon: '🏠', iconUrl: 'assets/icons/TrainingHut.png', yOffset: 0, occupiesHex: true,
    entrance: [0, 1], // south neighbor — ants enter/leave through the front door
    modelUrl: 'assets/models/TrainingHut.glb',
    createObject() {
      const go = new GameObject('Training Hut');
      go.object3D.add(cloneModel(this.modelUrl));
      go.addComponent(new TrainingHut());
      go.addComponent(new Building(this));
      return go;
    },
  }),
];

export async function preloadEntityModels() {
  await Promise.all(ENTITY_DEFS.filter(d => d.modelUrl).map(d => loadModel(d.modelUrl)));
}

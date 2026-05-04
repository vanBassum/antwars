import { EntityDef } from '../engine/entity_def.js';
import { GameObject } from '../engine/gameobject.js';
import { loadModel, cloneModel } from '../engine/model_cache.js';
import { Mover } from '../engine/components/mover.js';
import { InstancedRenderer } from '../engine/components/instanced_renderer.js';
import { GOAPAgent } from '../engine/ai/goap/goap_agent.js';
import { ResourceNode } from './components/resource_node.js';
import { Worker } from './components/worker.js';
import { FarmPlot } from './components/farm_plot.js';
import { Queen } from './components/queen.js';
import { EggPickup } from './components/egg_pickup.js';
import { TrainingHut } from './components/training_hut.js';
import { FeedingTray } from './components/feeding_tray.js';
import { Building } from './components/building.js';
import { ConstructionSite } from './components/construction_site.js';
import { InstancedBuilding } from './components/instanced_building.js';

// Helper for player-placed buildings: spawn in CONSTRUCTING state with a
// translucent ghost overlay, deferring the gameplay component until workers
// have delivered the construction cost. `addGameplay(go)` is called by the
// ConstructionSite once complete.
function attachConstruction(go, def, addGameplay) {
  go.addComponent(new ConstructionSite({
    remaining: def.constructionCost,
    def,
    modelUrl: def.modelUrl,
    onComplete: () => {
      const c = addGameplay(go);
      // Components added late don't get start() automatically — game.add only
      // calls start once at scene insertion time. Trigger it ourselves so the
      // gameplay component initialises (visuals, state, registrations).
      c?.start?.();
    },
  }));
}

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
      go.addComponent(new InstancedBuilding(this.modelUrl));
      go.addComponent(new ResourceNode({ type: 'sugar', amount: 25 }));
      return go;
    },
  }),
  new EntityDef({
    id: 'bush', name: 'Bush', icon: '🌿', iconUrl: 'assets/icons/Bush.png', yOffset: 0, occupiesHex: true,
    modelUrl: 'assets/models/Bush.glb',
    createObject() {
      const go = new GameObject('Bush');
      go.addComponent(new InstancedBuilding(this.modelUrl));
      go.addComponent(new ResourceNode({ type: 'wood', amount: 25 }));
      return go;
    },
  }),
  new EntityDef({
    id: 'farm_plot', name: 'Farm Plot', icon: '🌱', iconUrl: 'assets/icons/FarmPlot.png', yOffset: 0, occupiesHex: true,
    modelUrl: 'assets/models/FarmPlot.glb',
    constructionCost: { wood: 5 },
    createObject() {
      const go = new GameObject('Farm Plot');
      // Mesh is only here so PlacementController.applyGhost has something to
      // ghost during the hover preview. ConstructionSite.start strips it once
      // committed and switches to the shared GhostInstanceManager pool.
      go.object3D.add(cloneModel(this.modelUrl));
      const modelUrl = this.modelUrl;
      attachConstruction(go, this, (g) => {
        const ib = g.addComponent(new InstancedBuilding(modelUrl));
        ib.start();
        const fp = g.addComponent(new FarmPlot());
        return fp;
      });
      go.addComponent(new Building(this));
      return go;
    },
  }),
  new EntityDef({
    id: 'ant', name: 'Ant', icon: '🐜', iconUrl: 'assets/icons/Ant.png', yOffset: 0,
    modelUrl: 'assets/models/Ant.glb',
    createObject(game) {
      const go = new GameObject('Ant');
      go.addComponent(new Mover(1.5));
      go.addComponent(new GOAPAgent());
      go.addComponent(new Worker());
      if (game?.antInstances) go.addComponent(new InstancedRenderer(game.antInstances));
      return go;
    },
  }),
  new EntityDef({
    id: 'queen', name: 'Queen', icon: '👑', iconUrl: 'assets/icons/Queen.png',
    modelUrl: 'assets/models/Queen.glb',
    createObject(game) {
      const go = new GameObject('Queen');
      go.addComponent(new Mover(1.0));
      go.addComponent(new Queen());
      if (game?.queenInstances) go.addComponent(new InstancedRenderer(game.queenInstances));
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
    constructionCost: { wood: 10 },
    createObject() {
      const go = new GameObject('Training Hut');
      // Initial mesh is for the placement-preview ghost; ConstructionSite.start
      // strips it. Training huts aren't instanced post-construction (one-of-a-kind
      // building), so we re-attach a clone in onComplete.
      go.object3D.add(cloneModel(this.modelUrl));
      const modelUrl = this.modelUrl;
      attachConstruction(go, this, (g) => {
        g.object3D.add(cloneModel(modelUrl));
        return g.addComponent(new TrainingHut());
      });
      go.addComponent(new Building(this));
      return go;
    },
  }),
  new EntityDef({
    id: 'feeding_tray', name: 'Feeding Tray', icon: '🍯', iconUrl: 'assets/icons/FeedingTray.png', yOffset: 0, occupiesHex: true,
    modelUrl: 'assets/models/FeedingTray.glb',
    constructionCost: { wood: 5 },
    createObject() {
      const go = new GameObject('Feeding Tray');
      // Mesh is for the placement-preview ghost only; ConstructionSite.start
      // strips it. Post-construction is instanced via BuildingInstanceManager.
      go.object3D.add(cloneModel(this.modelUrl));
      const modelUrl = this.modelUrl;
      attachConstruction(go, this, (g) => {
        const ib = g.addComponent(new InstancedBuilding(modelUrl));
        ib.start();
        const ft = g.addComponent(new FeedingTray());
        return ft;
      });
      go.addComponent(new Building(this));
      return go;
    },
  }),
];

export async function preloadEntityModels() {
  await Promise.all(ENTITY_DEFS.filter(d => d.modelUrl).map(d => loadModel(d.modelUrl)));
}

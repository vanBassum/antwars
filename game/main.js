import { Game } from '../engine/game.js';
import { GameObject } from '../engine/gameobject.js';
import { CameraRig } from '../engine/components/camera_rig.js';
import { DirectionalLight } from '../engine/components/directional_light.js';
import { WorldLoader } from '../engine/world_loader.js';
import { ENTITY_DEFS, preloadEntityModels, measureModelFootprint, loadModel } from '../engine/entity_registry.js';
import { HexGrid } from '../engine/hex/hex_grid.js';
import { HexGridRenderer } from '../engine/components/hex_grid_renderer.js';
import { Resources } from '../engine/resources.js';
import { ResourceBar } from './resource_bar.js';
import { ActionBar } from './action_bar.js';

const game = new Game();
game.resources = new Resources();
game.resources.set('sugar', 10);
game.resources.set('wood',  10);
new ResourceBar(game.resources, [
  { key: 'sugar', icon: '🍬', label: 'Sugar' },
  { key: 'wood',  icon: '🪵', label: 'Wood' },
]);

const camera = new GameObject('Camera');
camera.addComponent(new CameraRig());
game.add(camera);

const sun = new GameObject('Sun');
sun.position.set(15, 20, 8);
sun.addComponent(new DirectionalLight({ color: 0xfff4cc, intensity: 1.4 }));
game.add(sun);

await Promise.all([
  preloadEntityModels(),
  loadModel('assets/models/SugarBlob.glb'),
]);

// Hex size = anthill footprint inscribed exactly (flat-to-flat = sqrt(3) * size)
const anthillFootprint = measureModelFootprint('assets/models/AntHill.glb');
const hexSize = (anthillFootprint || 2) / Math.sqrt(3);
const hexGrid = new HexGrid({ size: hexSize, radius: 16 });
game.hexGrid  = hexGrid;

const hexGridGO = new GameObject('HexGrid');
hexGridGO.addComponent(new HexGridRenderer(hexGrid));
game.add(hexGridGO);

const res  = await fetch('assets/world/flat.json');
const data = await res.json();
new WorldLoader(ENTITY_DEFS, hexGrid).load(game, data);

function spawnWorkerAnt() {
  const def  = ENTITY_DEFS.find(d => d.id === 'ant');
  const hive = game.gameObjects.find(g => g.name === 'Ant Hill');
  if (!def || !hive) return false;

  // Spawn inside the hive — A* will route the first path out through the
  // entrance neighbor, so the ant visibly walks out the door.
  const go = def.createObject();
  go.object3D.position.copy(hive.object3D.position);
  game.add(go);
  return true;
}

new ActionBar(game.resources, [
  {
    icon:      '🐜',
    label:     'Worker Ant',
    costLabel: '5 🍬',
    cost:      { sugar: 5 },
    onActivate: spawnWorkerAnt,
  },
]);

game.start();

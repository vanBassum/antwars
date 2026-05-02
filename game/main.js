import { Game } from '../engine/game.js';
import { GameObject } from '../engine/gameobject.js';
import { CameraRig } from '../engine/components/camera_rig.js';
import { DirectionalLight } from '../engine/components/directional_light.js';
import { WorldLoader } from '../engine/world_loader.js';
import { ENTITY_DEFS, preloadEntityModels } from './entities.js';
import { loadModel, measureModelFootprint } from '../engine/model_cache.js';
import { HexGrid } from '../engine/hex/hex_grid.js';
import { HexGridRenderer } from '../engine/components/hex_grid_renderer.js';
import { Resources } from '../engine/resources.js';
import { ResourceBar } from './resource_bar.js';
import { ActionBar } from './action_bar.js';
import { PlacementController } from './placement_controller.js';
import { ContextMenu } from './context_menu.js';
import { WorkManager } from './work_manager.js';
import { DebugMode } from './debug.js';
import { DebugOverlay } from './debug_overlay.js';

const game = new Game();
game.resources = new Resources();
game.resources.set('sugar', 10);
game.resources.set('wood',  10);
game.debug     = new DebugMode();
new ResourceBar(game.resources, [
  { key: 'sugar', icon: '🍬', iconUrl: 'assets/icons/SugarNode.png', label: 'Sugar' },
  { key: 'wood',  icon: '🪵', iconUrl: 'assets/icons/Branch.png',    label: 'Wood' },
], { debug: game.debug });

// Debug toggle button (top-left). Click or F3 toggles.
const debugBtn = document.createElement('button');
debugBtn.className   = 'debug-toggle';
debugBtn.textContent = '🐞';
debugBtn.title       = 'Toggle debug mode (F3)';
debugBtn.addEventListener('click', () => game.debug.toggle());
document.body.append(debugBtn);
game.debug.onChange(on => debugBtn.classList.toggle('active', on));
window.addEventListener('keydown', (e) => {
  if (e.code === 'F3') { e.preventDefault(); game.debug.toggle(); }
});

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
  loadModel('assets/models/WaterDroplet.glb'),
  loadModel('assets/models/Branch.glb'),
  loadModel('assets/models/Seed.glb'),
  // Crop visuals spawned by FarmPlot when growing.
  loadModel('assets/models/BerryBush.glb'),
  loadModel('assets/models/Egg.glb'),
]);

// Hex size = anthill footprint inscribed exactly (flat-to-flat = sqrt(3) * size)
const anthillFootprint = measureModelFootprint('assets/models/AntHill.glb');
const hexSize = (anthillFootprint || 2) / Math.sqrt(3);
const hexGrid = new HexGrid({ size: hexSize, radius: 16 });
game.hexGrid  = hexGrid;

const hexGridGO = new GameObject('HexGrid');
hexGridGO.addComponent(new HexGridRenderer(hexGrid));
game.add(hexGridGO);

// Central work dispatcher — must exist before any Worker components start.
game.workManager = new WorkManager(game);

const res  = await fetch('assets/world/flat.json');
const data = await res.json();
new WorldLoader(ENTITY_DEFS, hexGrid).load(game, data);

const placement = new PlacementController(game);
new ContextMenu(game, { isBlocked: () => placement.active });

// Per-frame debug labels above any gameObject exposing getDebugInfo().
const debugOverlay = new DebugOverlay(game, game.debug);
game.onTick = () => debugOverlay.tick();

function spawnWorkerAnt(commit) {
  const def  = ENTITY_DEFS.find(d => d.id === 'ant');
  const hive = game.gameObjects.find(g => g.name === 'Ant Hill');
  if (!def || !hive) return;

  // Spawn inside the hive — A* will route the first path out through the
  // entrance neighbor, so the ant visibly walks out the door.
  const go = def.createObject();
  go.object3D.position.copy(hive.object3D.position);
  game.add(go);
  commit();
}

function startFarmPlacement(commit) {
  const def = ENTITY_DEFS.find(d => d.id === 'farm_plot');
  if (!def) return;
  placement.start(def, commit);
}

new ActionBar(game.resources, [
  {
    icon:      '🐜',
    iconUrl:   'assets/icons/Ant.png',
    label:     'Worker Ant',
    costLabel: '5 🍬',
    cost:      { sugar: 5 },
    onActivate: spawnWorkerAnt,
  },
  {
    icon:      '🌱',
    iconUrl:   'assets/icons/FarmPlot.png',
    label:     'Farm Plot',
    costLabel: '10 🪵',
    cost:      { wood: 10 },
    onActivate: startFarmPlacement,
  },
]);

game.start();

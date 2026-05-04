import { Game } from '../engine/game.js';
import { GameObject } from '../engine/gameobject.js';
import { CameraRig } from '../engine/components/camera_rig.js';
import { DirectionalLight } from '../engine/components/directional_light.js';
import { WorldLoader } from '../engine/world_loader.js';
import { ENTITY_DEFS, preloadEntityModels } from './entities.js';
import { loadModel, measureModelFootprint } from '../engine/model_cache.js';
import { InstancedMeshGroup } from '../engine/instanced_mesh_group.js';
import { HexGrid } from '../engine/hex/hex_grid.js';
import { HexGridRenderer } from '../engine/components/hex_grid_renderer.js';
import { Resources } from '../engine/resources.js';
import { ResourceBar } from './resource_bar.js';
import { ActionBar } from './action_bar.js';
import { PlacementController } from './placement_controller.js';
import { ContextMenu } from './context_menu.js';
import { WorkManager } from './work_manager.js';
import { initCropInstances } from './crop_instance_registry.js';
import { DebugMode } from './debug.js';
import { DebugOverlay } from './debug_overlay.js';
import { PerfOverlay } from './perf_overlay.js';
import { SpeedControls } from './speed_controls.js';
import { SelectionManager } from './selection_manager.js';
import { BuildingInstanceManager } from './building_instance_manager.js';
import { GhostInstanceManager } from './ghost_instance_manager.js';

const game = new Game();
game.resources = new Resources();
game.resources.set('sugar', 10);
game.resources.set('wood',  15);
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
  // F4: toggle the entire shadow pass. Big A/B for pinning whether render
  // time is dominated by shadow rendering. Triggers shader recompile so
  // the first toggle costs ~50ms; steady-state delta is the real signal.
  if (e.code === 'F4') {
    e.preventDefault();
    game.renderer.shadowMap.enabled = !game.renderer.shadowMap.enabled;
    game.scene.traverse(o => { if (o.material) o.material.needsUpdate = true; });
    console.log('shadows:', game.renderer.shadowMap.enabled ? 'ON' : 'OFF');
  }
  // F5: toggle ant-instance shadow casting only. The 600-instance ant pool
  // is the largest single contributor to the shadow pass.
  if (e.code === 'F5') {
    e.preventDefault();
    if (game.antInstances) {
      game.antInstances.object3D.traverse(o => { if (o.isInstancedMesh) o.castShadow = !o.castShadow; });
      const on = game.antInstances.object3D.children[0]?.castShadow;
      console.log('ant shadows:', on ? 'ON' : 'OFF');
    }
  }
  // F6: toggle the per-ant debug DOM labels (separate from the perf HUD).
  // 600 DOM elements with per-frame innerHTML/style writes can drive enough
  // browser layout work to dwarf the WebGL render time.
  if (e.code === 'F6') {
    e.preventDefault();
    debugOverlay.setEnabled(!debugOverlay.isEnabled());
    console.log('debug labels:', debugOverlay.isEnabled() ? 'ON' : 'OFF');
  }
});

new SpeedControls(game);

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
  loadModel('assets/models/FeedingTray.glb'),
  loadModel('assets/models/HoneyBlob.glb'),
]);

// Instanced pools for ants and queen — shared across all entities of each type.
const antInstances        = new InstancedMeshGroup('assets/models/Ant.glb',        { capacity: 1024, scale: 0.25 });
const queenInstances      = new InstancedMeshGroup('assets/models/Queen.glb',      { capacity: 4,    scale: 0.4  });
const soldierAntInstances = new InstancedMeshGroup('assets/models/SoldierAnt.glb', { capacity: 512,  scale: 0.3  });
game.scene.add(antInstances.object3D);
game.scene.add(queenInstances.object3D);
game.scene.add(soldierAntInstances.object3D);
game.antInstances        = antInstances;
game.queenInstances      = queenInstances;
game.soldierAntInstances = soldierAntInstances;

// Crop instance pools (FarmPlot grows-into-instance flow).
initCropInstances(game.scene, [
  'assets/models/BerryBush.glb',
  'assets/models/Bush.glb',
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

// Batches draw calls for multi-instance building types (farm plots, feeding
// trays, bushes, sugar nodes) via InstancedMesh.
game.buildingInstances = new BuildingInstanceManager(game.scene);
// Same idea but for in-flight construction-site ghost overlays — keeps the
// 50-farm stress scene from spending ~100 transparent draw calls.
game.ghostInstances    = new GhostInstanceManager(game.scene);

// World file is normally `flat.json`; `?world=<name>` lets perf benchmarks
// load alternate scenes (e.g. `?world=stress.flat.json`) without rebuilding.
const worldFile = new URLSearchParams(location.search).get('world') || 'flat.json';
const res  = await fetch(`assets/world/${worldFile}`);
const data = await res.json();
if (data.resources) {
  for (const [key, value] of Object.entries(data.resources)) game.resources.set(key, value);
}
new WorldLoader(ENTITY_DEFS, hexGrid).load(game, data);

game.selectionManager = new SelectionManager(game);

const placement = new PlacementController(game);
game.placement   = placement;
new ContextMenu(game, { isBlocked: () => placement.active });

// Per-frame debug labels above any gameObject exposing getDebugInfo().
const debugOverlay = new DebugOverlay(game, game.debug);
const perfOverlay  = new PerfOverlay(game, game.debug);
game.onTick = () => { debugOverlay.tick(); perfOverlay.tick(); };

function startPlacement(defId, commit) {
  const def = ENTITY_DEFS.find(d => d.id === defId);
  if (!def) return;
  actionBar.showCancel(() => placement.cancel());
  placement.start(def, commit, () => actionBar.hideCancel());
}

// Worker ants are no longer spawned directly from the ActionBar — they come
// from the Queen → egg → Training Hut loop. The "Train Worker" button on the
// Training Hut's context menu queues the request.
// Construction model: `cost` gates placement (button is disabled when the
// stockpile can't cover it) but is NOT deducted on commit — workers pull one
// unit at a time from the stockpile until the ConstructionSite is full.
const noDeductCommit = () => {};
const actionBar = new ActionBar(game.resources, [
  {
    icon:      '🌱',
    iconUrl:   'assets/icons/FarmPlot.png',
    label:     'Farm Plot',
    costLabel: '5 🪵',
    cost:      { wood: 5 },
    onActivate: () => startPlacement('farm_plot', noDeductCommit),
  },
  {
    icon:      '🏠',
    iconUrl:   'assets/icons/TrainingHut.png',
    label:     'Training Hut',
    costLabel: '10 🪵',
    cost:      { wood: 10 },
    onActivate: () => startPlacement('training_hut', noDeductCommit),
  },
  {
    icon:      '🍯',
    iconUrl:   'assets/icons/FeedingTray.png',
    label:     'Feeding Tray',
    costLabel: '5 🪵',
    cost:      { wood: 5 },
    onActivate: () => startPlacement('feeding_tray', noDeductCommit),
  },
]);

game.triggerGameOver = () => {
  game.timeScale = 0;
  const overlay = document.createElement('div');
  overlay.style.cssText = [
    'position:fixed', 'inset:0', 'background:rgba(0,0,0,0.75)',
    'display:flex', 'flex-direction:column', 'align-items:center', 'justify-content:center',
    'z-index:1000', 'color:#fff', 'font-family:sans-serif', 'gap:1rem',
  ].join(';');
  const title = document.createElement('div');
  title.textContent = 'GAME OVER';
  title.style.cssText = 'font-size:4rem;font-weight:bold;letter-spacing:0.1em;text-shadow:0 0 20px #f00';
  const sub = document.createElement('div');
  sub.textContent = 'The queen has been slain.';
  sub.style.cssText = 'font-size:1.5rem;opacity:0.8';
  const btn = document.createElement('button');
  btn.textContent = 'Restart';
  btn.style.cssText = 'margin-top:1rem;padding:0.6rem 2rem;font-size:1.2rem;cursor:pointer;border:none;border-radius:6px';
  btn.addEventListener('click', () => location.reload());
  overlay.append(title, sub, btn);
  document.body.appendChild(overlay);
};

game.start();

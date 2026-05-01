import * as THREE from 'three';
import { Game } from '../engine/game.js';
import { GameObject } from '../engine/gameobject.js';
import { CameraRig } from '../engine/components/camera_rig.js';
import { DirectionalLight } from '../engine/components/directional_light.js';
import { MeshRenderer } from '../engine/components/mesh_renderer.js';
import { Toolbar } from './toolbar.js';
import { TerrainTool } from './tools/terrain_tool.js';
import { PlaceTool } from './tools/place_tool.js';
import { ExportTool } from './tools/export_tool.js';
import { ENTITY_DEFS, preloadEntityModels } from './entity_registry.js';
import { Selection } from './selection.js';
import { SceneTree } from './scene_tree.js';
import { Inspector } from './inspector.js';

const viewport = document.getElementById('viewport');
const game = new Game({ container: viewport });

const camera = new GameObject('Camera');
camera.addComponent(new CameraRig());
game.add(camera);

const sun = new GameObject('Sun');
sun.position.set(15, 30, 10);
sun.addComponent(new DirectionalLight({ color: 0xfff4cc, intensity: 1.4 }));
game.add(sun);

// Fallback floor so placement works even without generated terrain
const floor = new GameObject('Floor');
floor.addComponent(new MeshRenderer(
  new THREE.PlaneGeometry(400, 400).rotateX(-Math.PI / 2),
  new THREE.MeshStandardMaterial({ color: 0x444440, roughness: 0.9 })
));
game.add(floor);

const toolbar = new Toolbar(
  document.getElementById('toolbar'),
  document.getElementById('tool-panel-content')
);

const terrainTool = new TerrainTool(game);
toolbar.register(terrainTool);

await preloadEntityModels();
const placeTool = new PlaceTool(game, Selection);
toolbar.register(placeTool);
toolbar.register(new ExportTool(terrainTool, placeTool));

new SceneTree(game, document.getElementById('hierarchy'), Selection);
new Inspector(document.getElementById('inspector'), Selection);

try {
  const data = await fetch('assets/world/world.json').then(r => r.json());
  terrainTool.loadSettings(data.terrain ?? null);
  placeTool.loadEntities(data.entities ?? [], ENTITY_DEFS);
} catch { /* no world file yet */ }

game.start();

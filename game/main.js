import { Game } from '../engine/game.js';
import { GameObject } from '../engine/gameobject.js';
import { CameraRig } from '../engine/components/camera_rig.js';
import { DirectionalLight } from '../engine/components/directional_light.js';
import { WorldLoader } from '../engine/world_loader.js';
import { ENTITY_DEFS, preloadEntityModels } from '../engine/entity_registry.js';

const game = new Game();

const camera = new GameObject('Camera');
camera.addComponent(new CameraRig());
game.add(camera);

const sun = new GameObject('Sun');
sun.position.set(15, 30, 10);
sun.addComponent(new DirectionalLight({ color: 0xfff4cc, intensity: 1.4 }));
game.add(sun);

await preloadEntityModels();

try {
  const res  = await fetch('assets/world/world.json');
  const data = await res.json();
  new WorldLoader(ENTITY_DEFS).load(game, data);
} catch {
  // No world.json yet — fall back to default terrain
  const { TerrainMap }      = await import('../engine/terrain_map.js');
  const { TerrainRenderer } = await import('../engine/components/terrain_renderer.js');
  const map     = new TerrainMap({ width: 128, depth: 128, seed: 42 });
  const terrain = new GameObject('Terrain');
  terrain.addComponent(new TerrainRenderer(map, { heightScale: 5 }));
  game.add(terrain);
}

game.start();

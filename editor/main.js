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
  const data = await fetch('assets/world/world.json').then(r => r.json());
  new WorldLoader(ENTITY_DEFS).load(game, data);
} catch {
  console.warn('editor: no world.json found at assets/world/world.json');
}

game.start();

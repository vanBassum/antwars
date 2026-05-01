import { Game } from '../engine/game.js';
import { GameObject } from '../engine/gameobject.js';
import { CameraRig } from '../engine/components/camera_rig.js';
import { DirectionalLight } from '../engine/components/directional_light.js';
import { TerrainMap } from '../engine/terrain_map.js';
import { TerrainRenderer } from '../engine/components/terrain_renderer.js';
import { BaseZoneGizmo } from '../engine/components/base_zone_gizmo.js';

const game = new Game();

const camera = new GameObject('Camera');
camera.addComponent(new CameraRig());
game.add(camera);

const sun = new GameObject('Sun');
sun.position.set(15, 30, 10);
sun.addComponent(new DirectionalLight({ color: 0xfff4cc, intensity: 1.4 }));
game.add(sun);

const map = new TerrainMap({
  width: 128,
  depth: 128,
  seed:  42,
  bases: [{ teamIndex: 0 }, { teamIndex: 1 }],
});

const terrain = new GameObject('Terrain');
terrain.addComponent(new TerrainRenderer(map, { heightScale: 5 }));
game.add(terrain);

const gizmos = new GameObject('Gizmos');
gizmos.addComponent(new BaseZoneGizmo(map, { heightScale: 5 }));
game.add(gizmos);

game.start();

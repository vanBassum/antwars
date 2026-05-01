import * as THREE from 'three';
import { Game }               from '../engine/game.js';
import { GameObject }         from '../engine/gameobject.js';
import { CameraRig }          from '../engine/components/camera_rig.js';
import { DirectionalLight }   from '../engine/components/directional_light.js';
import { preloadEntityModels } from '../engine/entity_registry.js';
import { Selection }          from './selection.js';
import { Terrain }            from './terrain.js';
import { Hierarchy }          from './hierarchy.js';
import { Inspector }          from './inspector.js';
import { Prefabs }            from './prefabs.js';

const game = new Game();

const camera = new GameObject('Camera');
camera.addComponent(new CameraRig());
game.add(camera);

const sun = new GameObject('Sun');
sun.addComponent(new DirectionalLight({ color: 0xfff4cc, intensity: 1.4 }));
game.add(sun);

const terrain = new Terrain(game);

await preloadEntityModels();

// BoxHelper follows the selected object
let selHelper = null;
Selection.onChange(go => {
  if (selHelper) { game.scene.remove(selHelper); selHelper = null; }
  if (go) { selHelper = new THREE.BoxHelper(go.object3D, 0xffff00); game.scene.add(selHelper); }
});
game.onTick = () => selHelper?.update();

function saveWorld() {
  const data = {
    v:        1,
    terrain:  terrain.getSettings() ?? undefined,
    entities: prefabs.getEntityData(),
  };
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const a    = Object.assign(document.createElement('a'), { href: URL.createObjectURL(blob), download: 'world.json' });
  a.click();
  URL.revokeObjectURL(a.href);
}

new Hierarchy(
  document.getElementById('panel-hierarchy'), game, Selection, { onSave: saveWorld });
new Inspector(
  document.getElementById('panel-inspector'), Selection, { terrain });
const prefabs = new Prefabs(
  document.getElementById('panel-prefabs'), game, Selection);

try {
  const data = await fetch('assets/world/world.json').then(r => r.json());
  terrain.loadSettings(data.terrain ?? null);
  prefabs.loadEntities(data.entities ?? []);
} catch {
  console.warn('editor: no world.json found at assets/world/world.json');
}

game.start();

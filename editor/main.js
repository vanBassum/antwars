import * as THREE from 'three';
import { Game } from '../engine/game.js';
import { GameObject } from '../engine/gameobject.js';
import { CameraRig } from '../engine/components/camera_rig.js';
import { DirectionalLight } from '../engine/components/directional_light.js';
import { Toolbar } from './toolbar.js';
import { TerrainTool } from './tools/terrain_tool.js';

const viewport = document.getElementById('viewport');
const game = new Game({ container: viewport });

const camera = new GameObject('Camera');
camera.addComponent(new CameraRig());
game.add(camera);

const sun = new GameObject('Sun');
sun.position.set(15, 30, 10);
sun.addComponent(new DirectionalLight({ color: 0xfff4cc, intensity: 1.4 }));
game.add(sun);

const toolbar = new Toolbar(
  document.getElementById('toolbar'),
  document.getElementById('tool-panel-content')
);

toolbar.register(new TerrainTool(game));

game.start();

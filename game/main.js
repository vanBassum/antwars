import * as THREE from 'three';
import { Game } from '../engine/game.js';
import { GameObject } from '../engine/gameobject.js';
import { CameraRig } from '../engine/components/camera_rig.js';
import { DirectionalLight } from '../engine/components/directional_light.js';
import { MeshRenderer } from '../engine/components/mesh_renderer.js';

const game = new Game();

// ── Camera ───────────────────────────────────────────────────────────────────
const camera = new GameObject('Camera');
camera.addComponent(new CameraRig());
game.add(camera);

// ── Sun ──────────────────────────────────────────────────────────────────────
const sun = new GameObject('Sun');
sun.position.set(15, 30, 10);
sun.addComponent(new DirectionalLight({ color: 0xfff4cc, intensity: 1.4 }));
game.add(sun);

// ── Floor ────────────────────────────────────────────────────────────────────
const floor = new GameObject('Floor');
floor.addComponent(new MeshRenderer(
  new THREE.PlaneGeometry(100, 100).rotateX(-Math.PI / 2),
  new THREE.MeshStandardMaterial({ color: 0x7a7a6a, roughness: 0.9 })
));
game.add(floor);

// ── Box ──────────────────────────────────────────────────────────────────────
const box = new GameObject('Box');
box.position.set(0, 0.5, 0);
box.addComponent(new MeshRenderer(
  new THREE.BoxGeometry(1, 1, 1),
  new THREE.MeshStandardMaterial({ color: 0x4488ff })
));
game.add(box);

game.start();

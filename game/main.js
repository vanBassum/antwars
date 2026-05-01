import * as THREE from 'three';
import { Game } from '../engine/game.js';

const game = new Game();

const floor = new THREE.Mesh(
  new THREE.PlaneGeometry(100, 100),
  new THREE.MeshStandardMaterial({ color: 0x888888, roughness: 0.9 })
);
floor.rotation.x = -Math.PI / 2;
floor.receiveShadow = true;
game.scene.add(floor);

game.start();

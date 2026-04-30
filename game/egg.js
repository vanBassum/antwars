import * as THREE from 'three';
import { Component } from '../engine/gameobject.js';

export class Egg extends Component {
  static available = new Set(); // unclaimed eggs sitting in the world

  constructor() {
    super();
    this._geo  = null;
    this._mat  = null;
  }

  start() {
    this._geo  = new THREE.SphereGeometry(0.22, 8, 6);
    this._mat  = new THREE.MeshLambertMaterial({ color: 0xf5edd8 });
    const mesh = new THREE.Mesh(this._geo, this._mat);
    mesh.scale.set(0.9, 1.35, 0.9);
    mesh.castShadow = true;
    this.gameObject.object3D.add(mesh);

    Egg.available.add(this);
  }

  // Called by a nurse worker to reserve this egg before walking to it.
  claim() {
    Egg.available.delete(this);
  }

  destroy() {
    Egg.available.delete(this);
    this._geo?.dispose();
    this._mat?.dispose();
  }
}

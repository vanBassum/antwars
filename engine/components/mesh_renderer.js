import * as THREE from 'three';
import { Component } from '../gameobject.js';

export class MeshRenderer extends Component {
  constructor(geometry, material) {
    super();
    this.geometry = geometry;
    this.material = material;
    this.mesh = null;
  }

  start() {
    this.mesh = new THREE.Mesh(this.geometry, this.material);
    this.mesh.castShadow = true;
    this.mesh.receiveShadow = true;
    this.gameObject.object3D.add(this.mesh);
  }

  destroy() {
    if (this.mesh) {
      this.gameObject.object3D.remove(this.mesh);
      this.geometry.dispose();
      this.material.dispose();
      this.mesh = null;
    }
  }
}

import * as THREE from 'three';
import { Component } from '../../engine/gameobject.js';

const _mat4 = new THREE.Matrix4();

// Registers the owning GameObject with the BuildingInstanceManager so its base
// mesh is rendered via InstancedMesh (batched draw calls). The GameObject's
// object3D still exists in the scene as a transform node (for children like
// crops or honey blobs) but has no mesh of its own.
export class InstancedBuilding extends Component {
  constructor(modelUrl) {
    super();
    this._url = modelUrl;
    this._reg = null;
  }

  start() {
    const mgr = this.gameObject.game?.buildingInstances;
    if (!mgr) return;
    this._syncMatrix();
    this._reg = mgr.register(this._url, _mat4);
  }

  destroy() {
    const mgr = this.gameObject.game?.buildingInstances;
    if (mgr) mgr.unregister(this._reg);
    this._reg = null;
  }

  // Call when the object3D's world matrix has changed (e.g. scale pulse).
  syncTransform() {
    if (!this._reg) return;
    this._syncMatrix();
    const mgr = this.gameObject.game?.buildingInstances;
    if (mgr) mgr.setMatrix(this._reg, _mat4);
  }

  // Tint the instanced mesh (e.g. FarmPlot water-level darkening).
  setColor(color) {
    if (!this._reg) return;
    const mgr = this.gameObject.game?.buildingInstances;
    if (mgr) mgr.setColor(this._reg, color);
  }

  _syncMatrix() {
    const o = this.gameObject.object3D;
    o.updateMatrixWorld(true);
    _mat4.copy(o.matrixWorld);
  }
}

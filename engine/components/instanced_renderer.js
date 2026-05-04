import * as THREE from 'three';
import { Component } from '../gameobject.js';
import { composeYawMatrix } from '../instanced_mesh_group.js';

/**
 * Bridges a GameObject's transform into an InstancedMeshGroup.
 * Each frame it reads position + yaw from the GO and pushes a matrix update
 * to the shared instanced pool — no per-entity scene-graph subtree needed.
 */
export class InstancedRenderer extends Component {
  /**
   * @param {import('../instanced_mesh_group.js').InstancedMeshGroup} group
   */
  constructor(group) {
    super();
    this._group = group;
    this._id    = -1;
    this._mat   = new THREE.Matrix4();
  }

  start() {
    // Allocate a slot using current transform
    this._updateMatrix();
    this._id = this._group.addInstance(this._mat);
  }

  update(_dt) {
    if (this._id < 0) return;
    this._updateMatrix();
    this._group.setMatrixAt(this._id, this._mat);
  }

  destroy() {
    if (this._id >= 0) {
      this._group.removeInstance(this._id);
      this._id = -1;
    }
  }

  _updateMatrix() {
    const go    = this.gameObject;
    const pos   = go.position;
    const yaw   = go.object3D.rotation.y;
    const scale = go.animScale   ?? 1;
    const ox    = go.animOffsetX ?? 0;
    const oz    = go.animOffsetZ ?? 0;
    composeYawMatrix(this._mat, pos.x + ox, pos.y, pos.z + oz, yaw, scale);
  }
}

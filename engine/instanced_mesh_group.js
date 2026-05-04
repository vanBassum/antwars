import * as THREE from 'three';
import { cloneModel } from './model_cache.js';

// Generic helper for rendering N copies of a preloaded GLB via
// THREE.InstancedMesh. One InstancedMesh per leaf mesh in the source GLB,
// so multi-part models (ant body + legs + antennae) still share a single
// per-instance transform/color on the consumer side.
//
// Usage:
//   await loadModel('assets/models/Ant.glb');
//   const ants = new InstancedMeshGroup('assets/models/Ant.glb', { capacity: 256 });
//   game.scene.add(ants.object3D);
//   const id = ants.addInstance(matrix);
//   ants.setMatrixAt(id, newMatrix);     // hot-path per frame
//   ants.setColorAt(id, '#ff8844');      // optional tint
//   ants.removeInstance(id);
//
// Capacity is fixed at construction — exceeding it throws. Pick a number
// that comfortably bounds the consumer's entity count.

const _tmpMatrix = new THREE.Matrix4();
const _tmpColor  = new THREE.Color();

export class InstancedMeshGroup {
  constructor(modelUrl, { capacity = 256, scale = 1, materialOverride = null } = {}) {
    this.url      = modelUrl;
    this.capacity = capacity;
    this._slotInUse = new Uint8Array(capacity);
    this._free      = [];
    this._highWater = 0; // highest assigned slot + 1, drives InstancedMesh.count

    this.object3D = new THREE.Object3D();
    this.object3D.name = `InstancedMeshGroup(${modelUrl})`;

    // Pull geometries + materials + per-mesh local transforms out of a
    // throwaway clone of the GLB. We keep the geometries (shared refs are
    // fine — InstancedMesh just reads them) and discard the wrapping nodes.
    const source = cloneModel(modelUrl);
    if (scale !== 1) source.scale.setScalar(scale);
    source.updateMatrixWorld(true);

    this._meshes = []; // [{ inst, baseMatrix }]
    source.traverse(node => {
      if (!node.isMesh) return;
      // materialOverride lets construction-site ghost pools share one
      // translucent material across all sub-meshes instead of using each
      // GLB's PBR materials.
      const mat = materialOverride ?? node.material;
      const inst = new THREE.InstancedMesh(node.geometry, mat, capacity);
      inst.castShadow    = true;
      inst.receiveShadow = true;
      inst.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      // Hide all slots up front by zero-scaling them. Otherwise unused slots
      // render at the origin until count==0 hides them, but consumers might
      // raise count via addInstance and leave gaps in the middle.
      _tmpMatrix.makeScale(0, 0, 0);
      for (let i = 0; i < capacity; i++) inst.setMatrixAt(i, _tmpMatrix);
      inst.count = 0;
      this.object3D.add(inst);
      this._meshes.push({ inst, baseMatrix: node.matrixWorld.clone() });
    });
  }

  addInstance(matrix, color) {
    let id;
    if (this._free.length) {
      id = this._free.pop();
    } else {
      if (this._highWater >= this.capacity) {
        throw new Error(`InstancedMeshGroup(${this.url}): capacity ${this.capacity} exceeded`);
      }
      id = this._highWater++;
    }
    this._slotInUse[id] = 1;
    this.setMatrixAt(id, matrix);
    if (color !== undefined) this.setColorAt(id, color);
    this._refreshCount();
    return id;
  }

  removeInstance(id) {
    if (!this._slotInUse[id]) return;
    this._slotInUse[id] = 0;
    _tmpMatrix.makeScale(0, 0, 0);
    for (const { inst } of this._meshes) {
      inst.setMatrixAt(id, _tmpMatrix);
      inst.instanceMatrix.needsUpdate = true;
    }
    this._free.push(id);
    this._refreshCount();
  }

  setMatrixAt(id, matrix) {
    for (const { inst, baseMatrix } of this._meshes) {
      _tmpMatrix.multiplyMatrices(matrix, baseMatrix);
      inst.setMatrixAt(id, _tmpMatrix);
      inst.instanceMatrix.needsUpdate = true;
    }
  }

  setColorAt(id, color) {
    _tmpColor.set(color);
    for (const { inst } of this._meshes) {
      inst.setColorAt(id, _tmpColor);
      if (inst.instanceColor) inst.instanceColor.needsUpdate = true;
    }
  }

  _refreshCount() {
    let high = this._highWater;
    while (high > 0 && !this._slotInUse[high - 1]) high--;
    this._highWater = high;
    for (const { inst } of this._meshes) inst.count = high;
  }

  dispose() {
    for (const { inst } of this._meshes) {
      inst.dispose?.();
      this.object3D.remove(inst);
    }
    this._meshes = [];
  }
}

// Convenience: build a world matrix for the common "translate + yaw + uniform
// scale" case most ants/crops/buildings use. Caller passes a reusable Matrix4
// so we don't allocate per frame.
const _composePos   = new THREE.Vector3();
const _composeQuat  = new THREE.Quaternion();
const _composeEuler = new THREE.Euler();
const _composeScale = new THREE.Vector3();
export function composeYawMatrix(out, x, y, z, yaw = 0, scale = 1) {
  _composeEuler.set(0, yaw, 0);
  _composeQuat.setFromEuler(_composeEuler);
  _composeScale.set(scale, scale, scale);
  return out.compose(_composePos.set(x, y, z), _composeQuat, _composeScale);
}

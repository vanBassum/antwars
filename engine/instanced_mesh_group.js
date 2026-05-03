import * as THREE from 'three';

/**
 * Renders N copies of a pre-loaded GLB model efficiently using THREE.InstancedMesh.
 * Each sub-mesh in the source model gets its own InstancedMesh; all share a capacity
 * and free-list so instances can be added/removed without full rebuilds.
 */
export class InstancedMeshGroup {
  /**
   * @param {THREE.Object3D} sourceScene - the loaded model scene (from model_cache)
   * @param {object} opts
   * @param {number} opts.capacity - pre-allocated instance slots (grows on demand)
   * @param {number} opts.scale - uniform scale baked into the base matrix per part
   */
  constructor(sourceScene, { capacity = 256, scale = 1 } = {}) {
    this.object3D  = new THREE.Group();
    this._capacity = capacity;
    this._scale    = scale;
    this._count    = 0;          // active instance count
    this._freeList = [];         // recycled slot indices
    this._meshes   = [];         // { instMesh, baseMatrix }[]
    this._alive    = new Set();  // active slot indices

    // Zero-scale matrix used to hide inactive slots
    this._zeroMatrix = new THREE.Matrix4().makeScale(0, 0, 0);

    this._buildFromScene(sourceScene);
  }

  /** Number of active instances */
  get count() { return this._count; }

  /**
   * Add a new instance. Returns an integer ID used for future updates/removal.
   * @param {THREE.Matrix4} matrix - world transform for this instance
   * @param {THREE.Color} [color] - optional per-instance tint
   */
  addInstance(matrix, color) {
    let id;
    if (this._freeList.length > 0) {
      id = this._freeList.pop();
    } else {
      id = this._count + this._freeList.length; // next fresh slot
      if (id >= this._capacity) this._grow();
    }
    this._alive.add(id);
    this._count++;
    this.setMatrixAt(id, matrix);
    if (color) this.setColorAt(id, color);
    return id;
  }

  /**
   * Remove an instance by ID. The slot is recycled.
   */
  removeInstance(id) {
    if (!this._alive.has(id)) return;
    this._alive.delete(id);
    this._count--;
    // Hide the slot
    for (const { instMesh } of this._meshes) {
      instMesh.setMatrixAt(id, this._zeroMatrix);
      instMesh.instanceMatrix.needsUpdate = true;
    }
    this._freeList.push(id);
  }

  /**
   * Update the world-space transform for an instance.
   */
  setMatrixAt(id, matrix) {
    for (const { instMesh, baseMatrix } of this._meshes) {
      _composed.multiplyMatrices(matrix, baseMatrix);
      instMesh.setMatrixAt(id, _composed);
      instMesh.instanceMatrix.needsUpdate = true;
    }
  }

  /**
   * Update per-instance color tint.
   */
  setColorAt(id, color) {
    for (const { instMesh } of this._meshes) {
      instMesh.setColorAt(id, color);
      if (instMesh.instanceColor) instMesh.instanceColor.needsUpdate = true;
    }
  }

  dispose() {
    for (const { instMesh } of this._meshes) {
      instMesh.dispose();
    }
    this._meshes = [];
    this.object3D.clear();
  }

  // ── Internal ──────────────────────────────────────────────────────────────

  _buildFromScene(sourceScene) {
    sourceScene.updateWorldMatrix(true, true);
    const meshes = [];
    sourceScene.traverse(obj => {
      if (obj.isMesh) meshes.push(obj);
    });

    for (const mesh of meshes) {
      const geom = mesh.geometry;
      const mat  = mesh.material.clone();
      const instMesh = new THREE.InstancedMesh(geom, mat, this._capacity);
      instMesh.castShadow    = true;
      instMesh.receiveShadow = true;
      instMesh.frustumCulled = false; // managed manually
      instMesh.count = this._capacity; // always render full capacity (hidden via zero-scale)

      // Bake the mesh's local transform + the desired uniform scale into a
      // base matrix that's composed with each instance's world matrix.
      const baseMatrix = new THREE.Matrix4();
      mesh.updateWorldMatrix(true, false);
      baseMatrix.copy(mesh.matrixWorld);
      baseMatrix.scale(new THREE.Vector3(this._scale, this._scale, this._scale));

      // Initialize all slots to zero-scale (hidden)
      for (let i = 0; i < this._capacity; i++) {
        instMesh.setMatrixAt(i, this._zeroMatrix);
      }
      instMesh.instanceMatrix.needsUpdate = true;

      this.object3D.add(instMesh);
      this._meshes.push({ instMesh, baseMatrix });
    }
  }

  _grow() {
    const newCap = this._capacity * 2;
    for (const entry of this._meshes) {
      const old = entry.instMesh;
      const inst = new THREE.InstancedMesh(old.geometry, old.material, newCap);
      inst.castShadow    = true;
      inst.receiveShadow = true;
      inst.frustumCulled = false;
      inst.count = newCap;

      // Copy existing matrices
      for (let i = 0; i < this._capacity; i++) {
        old.getMatrixAt(i, _composed);
        inst.setMatrixAt(i, _composed);
      }
      // Zero-init new slots
      for (let i = this._capacity; i < newCap; i++) {
        inst.setMatrixAt(i, this._zeroMatrix);
      }
      inst.instanceMatrix.needsUpdate = true;

      // Copy instance colors if present
      if (old.instanceColor) {
        const col = new THREE.Color();
        for (let i = 0; i < this._capacity; i++) {
          old.getColorAt(i, col);
          inst.setColorAt(i, col);
        }
        if (inst.instanceColor) inst.instanceColor.needsUpdate = true;
      }

      this.object3D.remove(old);
      old.dispose();
      this.object3D.add(inst);
      entry.instMesh = inst;
    }
    this._capacity = newCap;
  }
}

// Shared temp matrix to avoid per-call allocations
const _composed = new THREE.Matrix4();

/**
 * Helper: build a world matrix from position + yaw + uniform scale.
 * Writes into the provided Matrix4 `out` and returns it.
 */
export function composeYawMatrix(out, x, y, z, yaw = 0, scale = 1) {
  const c = Math.cos(yaw), s = Math.sin(yaw);
  // Column-major: rotation around Y, then scale, then translate
  out.set(
    c * scale,  0, -s * scale, 0,
    0,          scale, 0,      0,
    s * scale,  0,  c * scale, 0,
    x,          y,  z,         1,
  );
  return out;
}

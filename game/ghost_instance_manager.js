import { InstancedMeshGroup } from '../engine/instanced_mesh_group.js';
import { ghostMat } from '../engine/ghost_material.js';

// Scene-level manager that lazily creates one InstancedMeshGroup per model
// URL — same shape as BuildingInstanceManager, but every group's sub-meshes
// share the translucent ghost material instead of the GLB's own materials.
// Used by ConstructionSite so 50+ in-flight construction overlays don't each
// turn into their own draw calls.
export class GhostInstanceManager {
  constructor(scene) {
    this._scene    = scene;
    this._groups   = new Map(); // modelUrl → InstancedMeshGroup
    this._goLookup = new Map(); // `${modelUrl}#${instanceId}` → gameObject
  }

  register(modelUrl, matrix, go = null) {
    let group = this._groups.get(modelUrl);
    if (!group) {
      // Sized for the stress scene: 50 farms in flight + a handful of trays
      // / huts simultaneously. Cheap to oversize the cap; rare to hit it.
      group = new InstancedMeshGroup(modelUrl, { capacity: 256, materialOverride: ghostMat });
      for (const mesh of group.getMeshObjects()) mesh.userData._ghostModelUrl = modelUrl;
      this._groups.set(modelUrl, group);
      this._scene.add(group.object3D);
    }
    const instanceId = group.addInstance(matrix);
    if (go) this._goLookup.set(`${modelUrl}#${instanceId}`, go);
    return { groupKey: modelUrl, instanceId };
  }

  unregister(reg) {
    if (!reg) return;
    this._goLookup.delete(`${reg.groupKey}#${reg.instanceId}`);
    this._groups.get(reg.groupKey)?.removeInstance(reg.instanceId);
  }

  getInstancedMeshObjects() {
    const out = [];
    for (const group of this._groups.values()) out.push(...group.getMeshObjects());
    return out;
  }

  getGameObjectForInstance(modelUrl, instanceId) {
    return this._goLookup.get(`${modelUrl}#${instanceId}`) ?? null;
  }

  setMatrix(reg, matrix) {
    if (!reg) return;
    this._groups.get(reg.groupKey)?.setMatrixAt(reg.instanceId, matrix);
  }

  dispose() {
    for (const group of this._groups.values()) {
      this._scene.remove(group.object3D);
      group.dispose();
    }
    this._groups.clear();
  }
}

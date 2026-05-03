import { InstancedMeshGroup } from '../engine/instanced_mesh_group.js';

// Scene-level manager that lazily creates one InstancedMeshGroup per model URL.
// Buildings register on completion (or immediately for non-constructable types)
// and unregister on destroy — batching draw calls for multi-instance types.
export class BuildingInstanceManager {
  constructor(scene) {
    this._groups = new Map(); // modelUrl → InstancedMeshGroup
    this._scene = scene;
  }

  register(modelUrl, matrix) {
    let group = this._groups.get(modelUrl);
    if (!group) {
      // Sized for the stress scene's biggest single-type count (50 farm plots).
      group = new InstancedMeshGroup(modelUrl, { capacity: 256 });
      this._groups.set(modelUrl, group);
      this._scene.add(group.object3D);
    }
    const instanceId = group.addInstance(matrix);
    return { groupKey: modelUrl, instanceId };
  }

  unregister(reg) {
    if (!reg) return;
    const group = this._groups.get(reg.groupKey);
    if (group) group.removeInstance(reg.instanceId);
  }

  setMatrix(reg, matrix) {
    if (!reg) return;
    const group = this._groups.get(reg.groupKey);
    if (group) group.setMatrixAt(reg.instanceId, matrix);
  }

  setColor(reg, color) {
    if (!reg) return;
    const group = this._groups.get(reg.groupKey);
    if (group) group.setColorAt(reg.instanceId, color);
  }

  dispose() {
    for (const group of this._groups.values()) {
      this._scene.remove(group.object3D);
      group.dispose();
    }
    this._groups.clear();
  }
}

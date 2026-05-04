import { InstancedMeshGroup } from '../engine/instanced_mesh_group.js';

// Scene-level registry that owns one InstancedMeshGroup per crop model URL.
// FarmPlots request/release instance slots through this singleton instead of
// cloning individual crop meshes.

let _instance = null;

export function initCropInstances(scene, cropUrls) {
  _instance = new CropInstanceRegistry(scene);
  for (const url of cropUrls) _instance.ensure(url);
}

export function getCropInstances() { return _instance; }

export class CropInstanceRegistry {
  constructor(scene) {
    this._scene  = scene;
    this._groups = new Map(); // modelUrl → InstancedMeshGroup
  }

  ensure(url) {
    if (this._groups.has(url)) return;
    // 5 crop instances per farm; sized for the stress scene (50 farms × 5 = 250).
    const group = new InstancedMeshGroup(url, { capacity: 512 });
    this._scene.add(group.object3D);
    this._groups.set(url, group);
  }

  add(url, worldMatrix, color) {
    const group = this._groups.get(url);
    if (!group) return null;
    return group.addInstance(worldMatrix, color);
  }

  update(url, slotId, worldMatrix, color) {
    const group = this._groups.get(url);
    if (!group) return;
    group.setMatrixAt(slotId, worldMatrix);
    if (color) group.setColorAt(slotId, color);
  }

  remove(url, slotId) {
    const group = this._groups.get(url);
    if (!group) return;
    group.removeInstance(slotId);
  }

  dispose() {
    for (const group of this._groups.values()) group.dispose();
    this._groups.clear();
  }
}

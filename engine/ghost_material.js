import { MeshBasicMaterial } from 'three';

// Shared translucent material used for construction-site ghosts and placement
// previews. One instance is reused across all ghost overlays — no per-mesh
// material cloning needed. Exported so the construction-site ghost-instance
// pool can pass it as InstancedMeshGroup's materialOverride.
export const ghostMat = new MeshBasicMaterial({
  transparent: true,
  opacity: 0.45,
  depthWrite: false,
  color: 0xaaccff,
});

// WeakMap<Object3D handle, Map<Mesh, Material|Material[]>>
const _savedMaterials = new WeakMap();

/**
 * Swap all mesh materials under `object3D` to the shared ghost material.
 * Returns a handle object used by restoreFromGhost / setGhostTint.
 */
export function applyGhost(object3D) {
  const saved = new Map();
  object3D.traverse(obj => {
    if (!obj.isMesh) return;
    saved.set(obj, obj.material);
    obj.material = ghostMat;
  });
  const handle = { root: object3D, saved, _tintMat: null };
  _savedMaterials.set(handle, saved);
  return handle;
}

/**
 * Restore original materials previously saved by applyGhost.
 */
export function restoreFromGhost(handle) {
  if (!handle) return;
  const saved = handle.saved;
  if (!saved) return;
  for (const [mesh, mat] of saved) {
    mesh.material = mat;
  }
  if (handle._tintMat) {
    handle._tintMat.dispose();
    handle._tintMat = null;
  }
  handle.saved = null;
}

/**
 * Tint the ghost overlay for the given handle (e.g. valid=white, invalid=red).
 * At most one placement ghost is active at a time, so we clone the ghost
 * material once for tinting and reuse it across calls.
 */
export function setGhostTint(handle, hexColor) {
  if (!handle || !handle.saved) return;
  if (!handle._tintMat) {
    handle._tintMat = ghostMat.clone();
    // Apply the tint material to all meshes in this handle
    for (const [mesh] of handle.saved) {
      mesh.material = handle._tintMat;
    }
  }
  handle._tintMat.color.setHex(hexColor);
}

/**
 * Dispose placement-specific tint material (call on cancel/commit).
 */
export function disposeGhostTint(handle) {
  if (!handle) return;
  if (handle._tintMat) {
    handle._tintMat.dispose();
    handle._tintMat = null;
  }
}

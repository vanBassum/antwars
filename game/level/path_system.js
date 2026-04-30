import { PropLoader } from '../prop_loader.js';
import { resolvePosition } from './zone_system.js';

// Darkens terrain vertex colors along each path, then places trail decals.
export function buildPaths(layout, terrainGeo, heightAt, scene) {
  const pos  = terrainGeo.attributes.position;
  const cols = terrainGeo.attributes.color;

  for (const path of layout.paths) {
    const from = resolvePosition(layout, path.from);
    const to   = resolvePosition(layout, path.to);
    if (!from || !to) { console.warn('[level] Unresolved path endpoint', path); continue; }

    _stainSegment(pos, cols, from, to, 1.6, 0.6);
    _placeDecals(scene, heightAt, from, to);
  }

  cols.needsUpdate = true;
}

// Shifts the path weight (B channel) upward along the segment corridor.
// The shader normalises all four weights, so this pulls the path texture in.
function _stainSegment(pos, cols, from, to, radius, strength) {
  const dx   = to.x - from.x;
  const dz   = to.z - from.z;
  const len2 = dx * dx + dz * dz;
  if (len2 < 0.001) return;

  for (let i = 0; i < pos.count; i++) {
    const vx = pos.getX(i);
    const vz = pos.getZ(i);

    const t  = Math.max(0, Math.min(1, ((vx - from.x) * dx + (vz - from.z) * dz) / len2));
    const cx = from.x + t * dx;
    const cz = from.z + t * dz;
    const d  = Math.sqrt((vx - cx) ** 2 + (vz - cz) ** 2);
    if (d >= radius) continue;

    // Smooth falloff from path centre.
    const w = (1 - d / radius) ** 1.8 * strength;
    const c = i * 3;
    // Pull grass and mud weights down, push path weight up.
    cols.array[c]     = Math.max(0, cols.array[c]     - w * 0.7);
    cols.array[c + 1] = Math.max(0, cols.array[c + 1] - w * 0.4);
    cols.array[c + 2] = Math.min(1, cols.array[c + 2] + w * 0.9);
  }
}

// Places ground_path_patch decals at regular intervals along the path.
function _placeDecals(scene, heightAt, from, to) {
  const dx   = to.x - from.x;
  const dz   = to.z - from.z;
  const len  = Math.sqrt(dx * dx + dz * dz);
  const step = 2.2;
  const baseAngle = Math.atan2(dx, dz);

  for (let t = step; t < len - step; t += step) {
    const f  = t / len;
    const x  = from.x + dx * f;
    const z  = from.z + dz * f;
    const h  = heightAt(x, z);

    const patch = PropLoader.clone('assets/models/ground_path_patch.glb');
    if (!patch) continue;

    patch.position.set(x, h + 0.005, z);
    patch.scale.setScalar(0.75 + Math.sin(t * 6.1) * 0.12);
    patch.rotation.y = baseAngle + Math.sin(t * 2.7) * 0.25;
    patch.userData.debugInfo = {
      source: 'path', model: 'ground_path_patch',
      pathFrom: `${from.x}, ${from.z}`, pathTo: `${to.x}, ${to.z}`,
    };
    scene.add(patch);
  }
}

import * as THREE from 'three';

// Average distance between adjacent samples along the smoothed curve.
// Smaller = smoother but more waypoints. ~0.25 m looks good at hex sizes ~1.5–2 m.
const DEFAULT_SAMPLE_SPACING = 0.25;

// Build a Catmull-Rom-smoothed waypoint list along a hex path.
//
//   grid       — HexGrid (used for hex → world)
//   fromPos    — { x, z }: usually the unit's current world position
//   hexPath    — array of { q, r } from a HexGrid.findPath() call
//   finalEdge  — optional { x, z } to override the last waypoint
//                (used when approaching a building so the unit stops at
//                the shared edge instead of the building hex's center)
//   spacing    — sample spacing in world units (default 0.25)
//
// Returns an array of { x, z } waypoints suitable for Mover.moveAlong.
// If the smoothing would produce fewer than 3 control points, returns
// the raw waypoints (line segments) without invoking the curve.
export function smoothPath(grid, fromPos, hexPath, finalEdge = null, spacing = DEFAULT_SAMPLE_SPACING) {
  const waypoints = hexPath.slice(1).map(h => grid.hexToWorld(h.q, h.r));
  if (finalEdge) {
    if (waypoints.length === 0) waypoints.push(finalEdge);
    else                         waypoints[waypoints.length - 1] = finalEdge;
  }
  const ctrl = [
    new THREE.Vector3(fromPos.x, 0, fromPos.z),
    ...waypoints.map(w => new THREE.Vector3(w.x, 0, w.z)),
  ];
  if (ctrl.length < 3) return waypoints;
  const curve   = new THREE.CatmullRomCurve3(ctrl, false, 'catmullrom', 0.5);
  const samples = Math.max(2, Math.round(curve.getLength() / spacing));
  return curve.getSpacedPoints(samples).slice(1).map(p => ({ x: p.x, z: p.z }));
}

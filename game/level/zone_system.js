// Zone containment tests and position resolution for the layout JSON.

export function isInZone(zone, x, z) {
  const dx = x - zone.center.x;
  const dz = z - zone.center.z;
  if (zone.shape === 'circle') {
    return dx * dx + dz * dz <= zone.radius * zone.radius;
  }
  if (zone.shape === 'ellipse') {
    return (dx / zone.radius.x) ** 2 + (dz / zone.radius.z) ** 2 <= 1;
  }
  return false;
}

// Returns the first zone that contains (x, z), or null.
export function getZoneAtPosition(zones, x, z) {
  for (const zone of zones) {
    if (isInZone(zone, x, z)) return zone;
  }
  return null;
}

// Resolves a path endpoint id ("anthill" or a zone id) to {x, z}.
export function resolvePosition(layout, id) {
  if (id === 'anthill') return { x: layout.anthill.x, z: layout.anthill.z };
  const zone = layout.zones.find(z => z.id === id);
  return zone ? { x: zone.center.x, z: zone.center.z } : null;
}

// Returns the bounding radii {rx, rz} of a zone.
export function zoneExtents(zone) {
  if (zone.shape === 'circle') return { rx: zone.radius, rz: zone.radius };
  return { rx: zone.radius.x, rz: zone.radius.z };
}

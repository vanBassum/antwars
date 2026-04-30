import * as THREE from 'three';
import { createTerrainMaterial } from './terrain_material.js';

// Seeded 2-D Perlin noise — no external dependency needed
function makePNoise(seed = 42) {
  const p = new Uint8Array(512);
  for (let i = 0; i < 256; i++) p[i] = i;
  let s = seed | 0;
  for (let i = 255; i > 0; i--) {
    s = Math.imul(s, 1664525) + 1013904223 | 0;
    const j = (s >>> 0) % (i + 1);
    [p[i], p[j]] = [p[j], p[i]];
  }
  for (let i = 0; i < 256; i++) p[i + 256] = p[i];

  const fade = t => t * t * t * (t * (t * 6 - 15) + 10);
  const lerp = (a, b, t) => a + t * (b - a);
  const grad = (h, x, y) => ((h & 1) ? -x : x) + ((h & 2) ? -y : y);

  return (x, y) => {
    const xi = Math.floor(x) & 255, yi = Math.floor(y) & 255;
    const xf = x - Math.floor(x), yf = y - Math.floor(y);
    const u = fade(xf), v = fade(yf);
    return lerp(
      lerp(grad(p[p[xi]     + yi],     xf,     yf    ),
           grad(p[p[xi + 1] + yi],     xf - 1, yf    ), u),
      lerp(grad(p[p[xi]     + yi + 1], xf,     yf - 1),
           grad(p[p[xi + 1] + yi + 1], xf - 1, yf - 1), u),
      v
    );
  };
}

export const WATER_Y = -0.28;

let _globalHeightAt = null;
export function setGlobalTerrain(fn) { _globalHeightAt = fn; }
export function getGroundY(x, z)    { return _globalHeightAt ? _globalHeightAt(x, z) : 0; }

// Fixed sugar node positions — must stay in sync with world_builder.js placements.
const RESOURCE_ZONES = [
  { x:  10, z: -7 },
  { x: -10, z: -8 },
  { x:   8, z: 10 },
  { x: -11, z:  9 },
  { x:  14, z:  2 },
];

export async function createTerrain(size = 80, res = 80) {
  const noise    = makePNoise(1337);
  const wetNoise = makePNoise(5791);

  function heightAt(x, z) {
    let h = noise(x * 0.040, z * 0.040)
          + noise(x * 0.100, z * 0.100) * 0.45
          + noise(x * 0.220, z * 0.220) * 0.18;
    h *= 0.75;

    const d = Math.sqrt(x * x + z * z);
    if (d < 12) {
      const t = Math.max(0, (d - 5) / 7);
      h *= t * t * (3 - 2 * t);
    }
    return h;
  }

  const geo = new THREE.PlaneGeometry(size, size, res, res);
  geo.rotateX(-Math.PI / 2);

  const pos     = geo.attributes.position;
  const weights = new Float32Array(pos.count * 3); // R=grass  G=mud  B=path

  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), z = pos.getZ(i);
    const h = heightAt(x, z);
    pos.setY(i, h);

    // ── Base weights from elevation ──────────────────────────────────
    // Grass grows at higher ground; mud dominates low and wet areas.
    let wGrass, wMud;
    if (h <= WATER_Y) {
      wGrass = 0.0; wMud = 1.0;
    } else {
      const elevated = Math.max(0.0, (h - 0.08) / 0.42);
      wGrass = Math.min(1.0, elevated * elevated * 0.9);
      wMud   = 1.0 - wGrass * 0.55;
    }

    // ── Moisture pockets — damp areas lose grass ─────────────────────
    const moisture = Math.max(0, wetNoise(x * 0.12, z * 0.12) * 0.5 + 0.1);
    wGrass = Math.max(0, wGrass - moisture * 0.35);

    // ── Anthill trampled zone — strip grass, pure mud ────────────────
    const dist = Math.sqrt(x * x + z * z);
    if (dist < 12) {
      const trample = Math.pow(Math.max(0, 1 - dist / 12), 1.5);
      wGrass *= 1.0 - trample * 0.95;
      wMud    = Math.max(wMud, trample * 0.9);
    }

    // ── Resource zone disturbance — less grass near sugar nodes ──────
    for (const rz of RESOURCE_ZONES) {
      const rd = Math.sqrt((x - rz.x) ** 2 + (z - rz.z) ** 2);
      if (rd < 5) {
        const disturb = Math.pow(1 - rd / 5, 2) * 0.55;
        wGrass *= 1.0 - disturb * 0.7;
      }
    }

    const c = i * 3;
    weights[c]   = Math.max(0, Math.min(1, wGrass));
    weights[c+1] = Math.max(0, Math.min(1, wMud));
    weights[c+2] = 0.0; // path weight — written later by path_system.js
  }

  geo.setAttribute('color', new THREE.BufferAttribute(weights, 3));
  geo.computeVertexNormals();

  const material    = await createTerrainMaterial(WATER_Y);
  const terrainMesh = new THREE.Mesh(geo, material);

  const waterGeo  = new THREE.PlaneGeometry(size, size);
  waterGeo.rotateX(-Math.PI / 2);
  const waterMesh = new THREE.Mesh(
    waterGeo,
    new THREE.MeshLambertMaterial({ color: 0x3d6e8a, transparent: true, opacity: 0.55 })
  );
  waterMesh.position.y = WATER_Y + 0.01;

  return { terrainMesh, waterMesh, heightAt, terrainGeo: geo };
}

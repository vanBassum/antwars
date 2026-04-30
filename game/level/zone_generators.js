import { PropLoader } from '../prop_loader.js';
import { isInZone, zoneExtents } from './zone_system.js';
import { WATER_Y } from '../../engine/terrain.js';

// Seeded xorshift32 — deterministic per zone id.
function makeRng(seed) {
  let s = (seed >>> 0) | 1;
  return () => {
    s ^= s << 13; s ^= s >> 17; s ^= s << 5;
    return (s >>> 0) / 0x100000000;
  };
}

function hashId(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h = Math.imul(h ^ str.charCodeAt(i), 16777619);
  }
  return h >>> 0;
}

function pick(rng, arr) {
  return arr[Math.floor(rng() * arr.length)];
}

const MODELS = {
  grass: {
    clusters: ['grass_var_0', 'grass_var_1', 'grass_var_2', 'grass_var_3', 'grass_var_4'],
    flowers:  ['flower_var_0', 'flower_var_1', 'flower_var_2'],
    toys:     ['env_tiny_paperclip_v1'],
  },
  sugar: {
    crumbs:   ['sugar_cube', 'glucose_blob'],
    wrappers: ['env_crumpled_paper_scrap_v1'],
  },
  water: {
    reeds:  ['shore_reeds_v1'],
    lilies: ['lily_pad_platform_v1'],
  },
};

function spawnProp(scene, model, x, y, z, scale, rotY, zone) {
  const obj = PropLoader.clone(`assets/models/${model}.glb`);
  if (!obj) return;
  obj.position.set(x, y, z);
  obj.scale.setScalar(scale);
  obj.rotation.y = rotY;
  obj.userData.debugInfo = { source: 'zone', model, zone: zone.id, zoneType: zone.type };
  scene.add(obj);
}

// Samples cluster centers inside the zone using a jittered grid + density threshold.
function sampleClusters(zone, density, rng, step) {
  const { cx, cz } = { cx: zone.center.x, cz: zone.center.z };
  const { rx, rz } = zoneExtents(zone);
  const centers = [];

  for (let x = cx - rx; x <= cx + rx; x += step) {
    for (let z = cz - rz; z <= cz + rz; z += step) {
      if (!isInZone(zone, x, z)) continue;
      if (rng() > density) continue;
      const jx = x + (rng() - 0.5) * step * 0.9;
      const jz = z + (rng() - 0.5) * step * 0.9;
      if (isInZone(zone, jx, jz)) centers.push({ x: jx, z: jz });
    }
  }
  return centers;
}

function generateGrass(scene, zone, rules, global, heightAt, rng) {
  const [minC, maxC] = rules.clusterSize;
  const placed = [];

  for (const c of sampleClusters(zone, rules.density, rng, 3.0)) {
    // Keep clear of the anthill base.
    if (c.x * c.x + c.z * c.z < 36) continue;

    const count = minC + Math.floor(rng() * (maxC - minC + 1));
    for (let i = 0; i < count; i++) {
      const angle = rng() * Math.PI * 2;
      const dist  = rng() * 1.8;
      const px = c.x + Math.cos(angle) * dist;
      const pz = c.z + Math.sin(angle) * dist;
      const h  = heightAt(px, pz);
      if (h < WATER_Y) continue;

      if (global.avoidOverlap && placed.some(p => (p.x - px) ** 2 + (p.z - pz) ** 2 < 0.49)) continue;

      spawnProp(scene, pick(rng, MODELS.grass.clusters), px, h, pz, 0.55 + rng() * 0.45, rng() * Math.PI * 2, zone);
      placed.push({ x: px, z: pz });
    }

    const h = heightAt(c.x, c.z);
    if (rng() < rules.flowerChance) {
      spawnProp(scene, pick(rng, MODELS.grass.flowers), c.x, h, c.z, 0.5 + rng() * 0.4, rng() * Math.PI * 2, zone);
    }
    if (rng() < rules.toyChance) {
      spawnProp(scene, pick(rng, MODELS.grass.toys), c.x, h, c.z, 0.7 + rng() * 0.3, rng() * Math.PI * 2, zone);
    }
  }
}

function generateSugar(scene, zone, rules, global, heightAt, rng) {
  const placed = [];

  for (const c of sampleClusters(zone, rules.crumbDensity, rng, 2.0)) {
    const count = 2 + Math.floor(rng() * 4);
    for (let i = 0; i < count; i++) {
      const angle = rng() * Math.PI * 2;
      const dist  = rng() * 1.0;
      const px = c.x + Math.cos(angle) * dist;
      const pz = c.z + Math.sin(angle) * dist;
      const h  = heightAt(px, pz);
      if (h < WATER_Y) continue;

      if (global.avoidOverlap && placed.some(p => (p.x - px) ** 2 + (p.z - pz) ** 2 < 0.25)) continue;

      spawnProp(scene, pick(rng, MODELS.sugar.crumbs), px, h, pz, 0.25 + rng() * 0.35, rng() * Math.PI * 2, zone);
      placed.push({ x: px, z: pz });
    }

    if (rng() < rules.wrapperChance) {
      const h = heightAt(c.x, c.z);
      spawnProp(scene, pick(rng, MODELS.sugar.wrappers), c.x, h, c.z, 0.7 + rng() * 0.5, rng() * Math.PI * 2, zone);
    }
  }
}

function generateWater(scene, zone, rules, global, heightAt, rng) {
  for (const c of sampleClusters(zone, 0.45, rng, 2.5)) {
    const h = heightAt(c.x, c.z);

    if (rng() < rules.reedsChance) {
      const y = Math.max(h, WATER_Y - 0.1);
      spawnProp(scene, pick(rng, MODELS.water.reeds), c.x, y, c.z, 0.5 + rng() * 0.7, rng() * Math.PI * 2, zone);
    }

    if (rng() < rules.lilyPadChance && h < WATER_Y) {
      spawnProp(scene, pick(rng, MODELS.water.lilies), c.x, WATER_Y + 0.01, c.z, 0.35 + rng() * 0.35, rng() * Math.PI * 2, zone);
    }
  }
}

export function generateZone(scene, zone, rules, heightAt) {
  const rng    = makeRng(hashId(zone.id));
  const zRules = rules[zone.type];
  const gRules = rules.global;

  if (!zRules) { console.warn('[level] No rules for zone type:', zone.type); return; }

  if (zone.type === 'grass') generateGrass(scene, zone, zRules, gRules, heightAt, rng);
  if (zone.type === 'sugar') generateSugar(scene, zone, zRules, gRules, heightAt, rng);
  if (zone.type === 'water') generateWater(scene, zone, zRules, gRules, heightAt, rng);
}

// All model paths this module needs preloaded.
export const LEVEL_PROP_MODELS = [
  'assets/models/grass_var_0.glb',
  'assets/models/grass_var_1.glb',
  'assets/models/grass_var_2.glb',
  'assets/models/grass_var_3.glb',
  'assets/models/grass_var_4.glb',
  'assets/models/flower_var_0.glb',
  'assets/models/flower_var_1.glb',
  'assets/models/flower_var_2.glb',
  'assets/models/env_tiny_paperclip_v1.glb',
  'assets/models/sugar_cube.glb',
  'assets/models/glucose_blob.glb',
  'assets/models/env_crumpled_paper_scrap_v1.glb',
  'assets/models/shore_reeds_v1.glb',
  'assets/models/lily_pad_platform_v1.glb',
  'assets/models/ground_path_patch.glb',
];

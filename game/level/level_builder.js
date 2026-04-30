import { generateZone } from './zone_generators.js';
import { buildPaths }   from './path_system.js';

// Drives the full level generation pass:
//   1. Stains path corridors into terrain vertex colors.
//   2. Spawns zone content (grass clusters, sugar crumbs, water reeds, etc.).
//
// Call after createTerrain() so terrainGeo is available, and after PropLoader.preload()
// so all level prop models are cached and cloneable.
export function buildLevel(game, layout, rules, terrainGeo, heightAt) {
  buildPaths(layout, terrainGeo, heightAt, game.scene);

  for (const zone of layout.zones) {
    generateZone(game.scene, zone, rules, heightAt);
  }
}

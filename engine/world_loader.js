import { TerrainMap } from './terrain_map.js';
import { TerrainRenderer } from './components/terrain_renderer.js';
import { GameObject } from './gameobject.js';

export class WorldLoader {
  constructor(entityDefs) {
    this._defs = new Map(entityDefs.map(d => [d.id, d]));
  }

  load(game, data) {
    if (data.terrain) {
      const { seed, width, depth, heightScale } = data.terrain;
      const map     = new TerrainMap({ width, depth, seed });
      const terrain = new GameObject('Terrain');
      terrain.addComponent(new TerrainRenderer(map, { heightScale }));
      game.add(terrain);
    }

    for (const e of (data.entities ?? [])) {
      const def = this._defs.get(e.id);
      if (!def) { console.warn(`WorldLoader: unknown entity "${e.id}"`); continue; }
      const go = def.createObject();
      go.object3D.position.fromArray(e.p);
      game.add(go);
    }
  }
}

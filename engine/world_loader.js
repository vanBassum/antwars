import { TerrainMap } from './terrain_map.js';
import { TerrainRenderer } from './components/terrain_renderer.js';
import { GameObject } from './gameobject.js';

export class WorldLoader {
  constructor(entityDefs, hexGrid = null) {
    this._defs    = new Map(entityDefs.map(d => [d.id, d]));
    this._hexGrid = hexGrid;
  }

  load(game, data) {
    if (data.terrain) {
      const { seed, width, depth, heightScale, flat = false, water = true } = data.terrain;
      const map     = new TerrainMap({ width, depth, seed, flat });
      const terrain = new GameObject('Terrain');
      terrain.addComponent(new TerrainRenderer(map, { heightScale, water }));
      game.add(terrain);
    }

    for (const e of (data.entities ?? [])) {
      const def = this._defs.get(e.id);
      if (!def) { console.warn(`WorldLoader: unknown entity "${e.id}"`); continue; }
      const go = def.createObject(game);

      if (this._hexGrid && def.occupiesHex) {
        // Snap buildings to the nearest hex center and reserve the hex
        const hex = this._hexGrid.worldToHex(e.p[0], e.p[2]);
        const wp  = this._hexGrid.hexToWorld(hex.q, hex.r);
        go.object3D.position.set(wp.x, e.p[1], wp.z);
        this._hexGrid.occupy(hex.q, hex.r);
        if (def.entrance) {
          this._hexGrid.setEntrance(hex.q, hex.r, def.entrance[0], def.entrance[1]);
        }
      } else {
        go.object3D.position.fromArray(e.p);
      }

      game.add(go);
    }
  }
}

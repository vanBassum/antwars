import { TerrainMap } from '../engine/terrain_map.js';
import { TerrainRenderer } from '../engine/components/terrain_renderer.js';
import { GameObject } from '../engine/gameobject.js';

export class Terrain {
  constructor(game) {
    this._game         = game;
    this._terrain      = null;
    this._lastSettings = null;
  }

  get go() { return this._terrain; }
  getSettings() { return this._lastSettings; }

  loadSettings(settings) {
    this.clear();
    if (!settings) return;
    const { seed, width, depth, heightScale } = settings;
    this._lastSettings = { seed, width, depth, heightScale };
    const map = new TerrainMap({ width, depth, seed });
    const go  = new GameObject('Terrain');
    go.addComponent(new TerrainRenderer(map, { heightScale }));
    this._game.add(go);
    this._terrain = go;
  }

  clear() {
    if (this._terrain) { this._game.remove(this._terrain); this._terrain = null; }
  }
}

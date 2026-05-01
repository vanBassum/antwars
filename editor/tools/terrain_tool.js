import { TerrainMap } from '../../engine/terrain_map.js';
import { TerrainRenderer } from '../../engine/components/terrain_renderer.js';
import { GameObject } from '../../engine/gameobject.js';

export class TerrainTool {
  constructor(game) {
    this._game         = game;
    this._terrain      = null;
    this._lastSettings = null;
    this.icon          = '⛰';
    this.label         = 'Terrain Generator';
  }

  getSettings() { return this._lastSettings; }

  loadSettings(settings) {
    this._clear();
    if (!settings) return;
    const { seed, width, depth, heightScale } = settings;
    this._lastSettings = settings;
    const map     = new TerrainMap({ width, depth, seed });
    const terrain = new GameObject('Terrain');
    terrain.addComponent(new TerrainRenderer(map, { heightScale }));
    this._game.add(terrain);
    this._terrain = terrain;
  }

  buildPanel(container) {
    container.innerHTML = `
      <div class="panel-title">Terrain Generator</div>

      <div class="field-row">
        <label>Seed</label>
        <input type="number" id="tf-seed" value="42" step="1">
      </div>
      <div class="field-row">
        <label>Width (cells)</label>
        <input type="number" id="tf-width" value="128" min="16" max="512" step="8">
      </div>
      <div class="field-row">
        <label>Depth (cells)</label>
        <input type="number" id="tf-depth" value="128" min="16" max="512" step="8">
      </div>
      <div class="field-row">
        <label>Height Scale</label>
        <input type="number" id="tf-height" value="5" min="1" max="30" step="0.5">
      </div>

      <hr class="panel-separator">

      <button class="panel-btn" id="tf-generate">Generate</button>
      <button class="panel-btn danger" id="tf-clear" style="margin-top:6px">Clear</button>
    `;

    container.querySelector('#tf-generate').addEventListener('click', () => this._generate(container));
    container.querySelector('#tf-clear').addEventListener('click', () => this._clear());
  }

  _generate(container) {
    const seed   = parseInt(container.querySelector('#tf-seed').value)   || 42;
    const width  = parseInt(container.querySelector('#tf-width').value)  || 128;
    const depth  = parseInt(container.querySelector('#tf-depth').value)  || 128;
    const hScale = parseFloat(container.querySelector('#tf-height').value) || 5;

    this._clear();

    this._lastSettings = { seed, width, depth, heightScale: hScale };
    const map     = new TerrainMap({ width, depth, seed });
    const terrain = new GameObject('Terrain');
    terrain.addComponent(new TerrainRenderer(map, { heightScale: hScale }));
    this._game.add(terrain);
    this._terrain = terrain;
  }

  _clear() {
    if (this._terrain) {
      this._game.remove(this._terrain);
      this._terrain = null;
    }
  }
}

import { ENTITY_DEFS } from '../engine/entity_registry.js';

function iconFor(go) {
  const n = go.name.toLowerCase();
  if (n.includes('camera'))     return '📷';
  if (n.includes('sun') || n.includes('light')) return '☀️';
  if (n.includes('terrain'))    return '⛰';
  if (n.includes('floor'))      return '▭';
  if (n.includes('watchtower')) return '🗼';
  return '◦';
}

export class SceneTree {
  constructor(game, el, selection, { placeTool, terrainTool, onSave } = {}) {
    this._game        = game;
    this._el          = el;
    this._selection   = selection;
    this._placeTool   = placeTool;
    this._terrainTool = terrainTool;
    this._onSave      = onSave;

    selection.onChange(() => this._render());
    game.onSceneChange = () => this._render();
    this._render();
  }

  _render() {
    const gos        = this._game.gameObjects;
    const sel        = this._selection.current;
    const hasTerrain = !!this._terrainTool?.getSettings();

    const rows = gos.map((go, i) => `
      <div class="tree-node${go === sel ? ' selected' : ''}" data-idx="${i}">
        <span class="tree-icon">${iconFor(go)}</span>${go.name}
      </div>`).join('');

    const cards = ENTITY_DEFS.map(def => `
      <div class="entity-card" data-id="${def.id}">
        <span class="entity-icon">${def.icon}</span>
        <span class="entity-name">${def.name}</span>
      </div>`).join('');

    this._el.innerHTML = `
      <div class="panel-header">
        Scene
        <button class="tree-header-btn" id="st-save" title="Save World">💾</button>
      </div>
      <div class="tree-list">
        ${rows || '<div class="panel-empty">Empty scene</div>'}
      </div>
      <div class="tree-section">
        <div class="tree-section-header">Add</div>
        <div class="entity-grid" id="st-cards">${cards}</div>
        <button class="tree-action-btn${hasTerrain ? ' danger' : ''}" id="st-terrain">
          ${hasTerrain ? '✕ Clear Terrain' : '⛰ Generate Terrain'}
        </button>
      </div>`;

    // Scene node clicks
    this._el.querySelectorAll('.tree-node').forEach(node => {
      node.addEventListener('click', () => this._selection.set(gos[+node.dataset.idx]));
    });

    // Entity card drag-spawn
    if (this._placeTool) {
      this._el.querySelectorAll('.entity-card').forEach(card => {
        card.addEventListener('mousedown', (e) => {
          if (e.button !== 0) return;
          const def = ENTITY_DEFS.find(d => d.id === card.dataset.id);
          if (def) this._placeTool.startSpawn(def);
          e.preventDefault();
        });
      });
    }

    // Terrain button
    this._el.querySelector('#st-terrain').addEventListener('click', () => {
      if (hasTerrain) {
        if (this._selection.current === this._terrainTool._terrain) this._selection.clear();
        this._terrainTool.clear();
      } else {
        const s = this._terrainTool.getSettings() ?? { seed: 42, width: 128, depth: 128, heightScale: 5 };
        this._terrainTool.loadSettings(s);
        this._selection.set(this._terrainTool._terrain);
      }
    });

    // Save button
    this._el.querySelector('#st-save').addEventListener('click', () => this._onSave?.());
  }
}

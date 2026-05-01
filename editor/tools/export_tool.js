import { ENTITY_DEFS } from '../../engine/entity_registry.js';

export class ExportTool {
  constructor(terrainTool, placeTool) {
    this._terrainTool = terrainTool;
    this._placeTool   = placeTool;
    this.icon  = '💾';
    this.label = 'World File';
  }

  buildPanel(container) {
    this._render(container);
  }

  _render(container) {
    const terrain  = this._terrainTool.getSettings();
    const entities = this._placeTool.getPlaced();
    container.innerHTML = `
      <div class="panel-title">World File</div>
      <div class="field-row">
        <label>Terrain</label>
        <span style="color:#aaa;font-size:12px">${terrain ? `${terrain.width}×${terrain.depth} seed ${terrain.seed}` : 'none'}</span>
      </div>
      <div class="field-row">
        <label>Entities</label>
        <span style="color:#aaa;font-size:12px">${entities.length} placed</span>
      </div>
      <hr class="panel-separator">
      <button class="panel-btn" id="exp-load">Load world.json</button>
      <button class="panel-btn" id="exp-dl" style="margin-top:6px">Download world.json</button>
      <button class="panel-btn danger" id="exp-clear" style="margin-top:6px">Clear All</button>`;

    container.querySelector('#exp-load').addEventListener('click',  () => this._load(container));
    container.querySelector('#exp-dl').addEventListener('click',   () => this._download());
    container.querySelector('#exp-clear').addEventListener('click', () => {
      this._terrainTool.loadSettings(null);
      this._placeTool.loadEntities([], ENTITY_DEFS);
      this._render(container);
    });
  }

  _load(container) {
    const input  = Object.assign(document.createElement('input'), { type: 'file', accept: '.json' });
    input.onchange = async () => {
      const text = await input.files[0]?.text();
      if (!text) return;
      try {
        const data = JSON.parse(text);
        this._terrainTool.loadSettings(data.terrain ?? null);
        this._placeTool.loadEntities(data.entities ?? [], ENTITY_DEFS);
        this._render(container);
      } catch (err) {
        console.error('Failed to load world file:', err);
      }
    };
    input.click();
  }

  _download() {
    const terrain  = this._terrainTool.getSettings();
    const entities = this._placeTool.getPlaced();
    const data = {
      v: 1,
      terrain: terrain ?? null,
      entities: entities.map(({ def, go, heightDelta }) => ({
        id: def.id,
        p:  go.object3D.position.toArray().map(v => +v.toFixed(4)),
        hd: +heightDelta.toFixed(4),
      })),
    };
    const blob = new Blob([JSON.stringify(data)], { type: 'application/json' });
    const a    = Object.assign(document.createElement('a'), {
      href: URL.createObjectURL(blob), download: 'world.json',
    });
    a.click();
    URL.revokeObjectURL(a.href);
  }
}

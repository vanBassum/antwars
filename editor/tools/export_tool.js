export class ExportTool {
  constructor(terrainTool, placeTool) {
    this._terrainTool = terrainTool;
    this._placeTool   = placeTool;
    this.icon  = '💾';
    this.label = 'Export World';
  }

  buildPanel(container) {
    const refresh = () => {
      const terrain  = this._terrainTool.getSettings();
      const entities = this._placeTool.getPlaced();
      container.innerHTML = `
        <div class="panel-title">Export World</div>
        <div class="field-row">
          <label>Terrain</label>
          <span style="color:#aaa;font-size:12px">${terrain ? `${terrain.width}×${terrain.depth} seed ${terrain.seed}` : 'none'}</span>
        </div>
        <div class="field-row">
          <label>Entities</label>
          <span style="color:#aaa;font-size:12px">${entities.length} placed</span>
        </div>
        <hr class="panel-separator">
        <button class="panel-btn" id="exp-dl">Download world.json</button>`;
      container.querySelector('#exp-dl').addEventListener('click', () => this._download());
    };

    refresh();
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
      href:     URL.createObjectURL(blob),
      download: 'world.json',
    });
    a.click();
    URL.revokeObjectURL(a.href);
  }
}

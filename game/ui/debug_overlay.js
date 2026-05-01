export class DebugOverlay {
  constructor(game) {
    this.game    = game;
    this.visible = false;
    this._list   = null;
    this._build();

    window.addEventListener('keydown', (e) => {
      if (e.code === 'Backquote') this.toggle();
    });
  }

  toggle() {
    this.visible = !this.visible;
    document.getElementById('debug-overlay').style.display = this.visible ? 'block' : 'none';
  }

  update() {
    if (!this.visible) return;

    const rows = [];
    for (const go of this.game.gameObjects) {
      // Find any component that looks like a GOAPAgent (duck-type)
      const agent = go.components.find(c => typeof c.currentActionName === 'string');
      if (!agent) continue;

      const action = agent.currentActionName || 'idle';
      rows.push(`
        <div class="debug-row">
          <span class="debug-name">${go.name}</span>
          <span class="debug-action">${action}</span>
        </div>`);
    }

    this._list.innerHTML = rows.length
      ? rows.join('')
      : '<div class="debug-empty">No AI units in scene</div>';
  }

  _build() {
    const panel = document.createElement('div');
    panel.id = 'debug-overlay';
    panel.style.display = 'none';
    panel.innerHTML = `
      <div class="debug-header">
        UNITS
        <span class="debug-hint">[ \` ] close</span>
      </div>
      <div class="debug-list"></div>
    `;
    document.body.appendChild(panel);
    this._list = panel.querySelector('.debug-list');
  }
}

function iconFor(go) {
  const n = go.name.toLowerCase();
  if (n.includes('camera'))                    return '📷';
  if (n.includes('sun') || n.includes('light')) return '☀️';
  if (n.includes('terrain'))                    return '⛰';
  if (n.includes('floor'))                      return '▭';
  if (n.includes('watchtower'))                 return '🗼';
  return '◦';
}

export class Hierarchy {
  constructor(el, game, selection, { onSave } = {}) {
    this._el        = el;
    this._game      = game;
    this._selection = selection;
    this._onSave    = onSave;

    selection.onChange(() => this._render());
    game.onSceneChange = () => this._render();
    this._render();
  }

  _render() {
    const gos = this._game.gameObjects;
    const sel = this._selection.current;

    const items = gos.map((go, i) => `
      <div class="tree-item${go === sel ? ' selected' : ''}" data-idx="${i}">
        <span class="tree-icon">${iconFor(go)}</span>${go.name}
      </div>`).join('');

    this._el.innerHTML = `
      <div class="panel-header">
        Hierarchy
        <button class="ph-btn" id="h-save" title="Save World">💾</button>
      </div>
      <div class="tree-scroll">
        <div class="tree-root">▼ Scene</div>
        ${items || '<div class="insp-empty">Empty scene</div>'}
      </div>`;

    this._el.querySelectorAll('.tree-item').forEach(node => {
      node.addEventListener('click', () => this._selection.set(gos[+node.dataset.idx]));
    });
    this._el.querySelector('#h-save')?.addEventListener('click', () => this._onSave?.());
  }
}

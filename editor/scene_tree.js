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
  constructor(game, el, selection) {
    this._game      = game;
    this._el        = el;
    this._selection = selection;

    selection.onChange(() => this._render());
    game.onSceneChange = () => this._render();
    this._render();
  }

  _render() {
    const gos = this._game.gameObjects;
    const sel = this._selection.current;

    const rows = gos.map((go, i) => `
      <div class="tree-node${go === sel ? ' selected' : ''}" data-idx="${i}">
        <span class="tree-icon">${iconFor(go)}</span>${go.name}
      </div>`).join('');

    this._el.innerHTML = `
      <div class="panel-header">Hierarchy</div>
      ${rows || '<div class="panel-empty">Empty scene</div>'}`;

    this._el.querySelectorAll('.tree-node').forEach(node => {
      node.addEventListener('click', () => {
        this._selection.set(gos[parseInt(node.dataset.idx)]);
      });
    });
  }
}

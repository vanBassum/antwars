// Bottom-of-screen hotbar of square buttons. Each action takes:
//   { icon, label, costLabel, cost: { resourceKey: amount }, onActivate }
// onActivate may return false to abort and refund the cost.
export class ActionBar {
  constructor(resources, actions, parent = document.body) {
    this._resources = resources;
    this._items     = [];

    const root = document.createElement('div');
    root.className = 'action-bar';

    for (const action of actions) {
      const btn = document.createElement('button');
      btn.className = 'action-btn';
      btn.title = action.label;

      const icon = document.createElement('span');
      icon.className   = 'action-icon';
      icon.textContent = action.icon;

      const cost = document.createElement('span');
      cost.className   = 'action-cost';
      cost.textContent = action.costLabel ?? '';

      btn.append(icon, cost);
      btn.addEventListener('click', () => this._tryActivate(action));
      root.append(btn);
      this._items.push({ btn, action });
    }

    parent.append(root);
    resources.onChange(v => this._refreshStates(v));
  }

  _tryActivate(action) {
    if (!this._canAfford(action.cost)) return;
    const ok = action.onActivate?.();
    if (ok === false) return;
    for (const [k, v] of Object.entries(action.cost ?? {})) {
      this._resources.add(k, -v);
    }
  }

  _canAfford(cost) {
    const v = this._resources.values();
    for (const [k, n] of Object.entries(cost ?? {})) {
      if ((v[k] ?? 0) < n) return false;
    }
    return true;
  }

  _refreshStates(values) {
    for (const { btn, action } of this._items) {
      let affordable = true;
      for (const [k, n] of Object.entries(action.cost ?? {})) {
        if ((values[k] ?? 0) < n) { affordable = false; break; }
      }
      btn.disabled = !affordable;
    }
  }
}

// Bottom-of-screen hotbar of square buttons. Each action takes:
//   { icon, iconUrl?, label, costLabel, cost: { resourceKey: amount }, onActivate }
// onActivate is called as `onActivate(commit)` — the action invokes
// `commit()` when it actually wants the cost deducted. This lets async
// flows (e.g. enter placement mode, wait for click) commit on success
// and skip on cancel.
import { makeIcon } from './icon_helper.js';

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

      const icon = makeIcon(action.icon, action.iconUrl ?? null, 'action-icon');

      const cost = document.createElement('span');
      cost.className   = 'action-cost';
      cost.textContent = action.costLabel ?? '';

      btn.append(icon, cost);
      btn.addEventListener('click', () => this._tryActivate(action));
      root.append(btn);
      this._items.push({ btn, action });
    }

    this._root      = root;
    this._cancelBtn = null;

    parent.append(root);
    resources.onChange(v => this._refreshStates(v));
  }

  setPlacing(active) {
    if (active) {
      for (const { btn } of this._items) btn.disabled = true;
    } else {
      this._refreshStates(this._resources.values());
    }
  }

  _tryActivate(action) {
    if (!this._canAfford(action.cost)) return;
    let committed = false;
    const commit = () => {
      if (committed) return;
      committed = true;
      for (const [k, v] of Object.entries(action.cost ?? {})) {
        this._resources.add(k, -v);
      }
    };
    action.onActivate?.(commit);
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

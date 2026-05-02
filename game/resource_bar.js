// Top-of-screen resource HUD. Built from a list of { key, icon, iconUrl?, label }
// entries and bound to a Resources instance.
import { makeIcon } from './icon_helper.js';

export class ResourceBar {
  constructor(resources, types, parent = document.body) {
    this._items = new Map();

    const root = document.createElement('div');
    root.className = 'resource-bar';

    for (const t of types) {
      const item = document.createElement('div');
      item.className = 'resource-item';
      item.title = t.label;

      const icon = makeIcon(t.icon, t.iconUrl ?? null, 'resource-icon');

      const count = document.createElement('span');
      count.className   = 'resource-count';
      count.textContent = '0';

      item.append(icon, count);
      root.append(item);
      this._items.set(t.key, count);
    }

    parent.append(root);
    resources.onChange(v => this._update(v));
  }

  _update(values) {
    for (const [key, span] of this._items) {
      span.textContent = String(values[key] ?? 0);
    }
  }
}

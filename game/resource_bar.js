// Top-of-screen resource HUD. Built from a list of { key, icon, iconUrl?, label }
// entries and bound to a Resources instance.
//
// Optional: pass { debug } in opts (a DebugMode instance). When debug is on,
// each resource pill becomes clickable — left-click adds +10 of that
// resource. Off → plain labels (matches issue #19).
import { makeIcon } from './icon_helper.js';

const DEBUG_ADD_PER_CLICK = 10;

export class ResourceBar {
  constructor(resources, types, opts = {}, parent = opts.parent ?? document.body) {
    this._resources = resources;
    this._items     = new Map();

    const root = document.createElement('div');
    root.className = 'resource-bar';
    this._root = root;

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

      // Debug-mode click handler. The handler always exists; it no-ops when
      // debug is off, so toggling debug never has to bind/unbind listeners.
      item.addEventListener('click', () => {
        if (!opts.debug?.enabled) return;
        resources.add(t.key, DEBUG_ADD_PER_CLICK);
      });
    }

    parent.append(root);
    resources.onChange(v => this._update(v));

    if (opts.debug) {
      opts.debug.onChange(on => root.classList.toggle('debug', on));
    }
  }

  _update(values) {
    for (const [key, span] of this._items) {
      span.textContent = String(values[key] ?? 0);
    }
  }
}

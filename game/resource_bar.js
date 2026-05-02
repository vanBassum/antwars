// Top-of-screen resource HUD. Built from a list of { key, icon, iconUrl?, label }
// entries and bound to a Resources instance.
import { makeIcon } from './icon_helper.js';
import { onDebugChange } from './debug.js';

const DEBUG_AMOUNT = 10;

export class ResourceBar {
  constructor(resources, types, parent = document.body) {
    this._resources = resources;
    this._items     = new Map(); // key -> { item, count, handler }

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
      this._items.set(t.key, { item, count, handler: null });
    }

    parent.append(root);
    resources.onChange(v => this._update(v));
    onDebugChange(on => this._setDebug(on));
  }

  _update(values) {
    for (const [key, { count }] of this._items) {
      count.textContent = String(values[key] ?? 0);
    }
  }

  _setDebug(on) {
    if (on) {
      this._root.classList.add('resource-bar--debug');
      // pointer-events must be enabled on the container so clicks reach items
      this._root.style.pointerEvents = 'auto';
      for (const [key, entry] of this._items) {
        const handler = () => this._cheat(key, entry.item);
        entry.item.addEventListener('click', handler);
        entry.handler = handler;
      }
    } else {
      this._root.classList.remove('resource-bar--debug');
      this._root.style.pointerEvents = '';
      for (const [, entry] of this._items) {
        if (entry.handler) {
          entry.item.removeEventListener('click', entry.handler);
          entry.handler = null;
        }
      }
    }
  }

  _cheat(key, itemEl) {
    this._resources.add(key, DEBUG_AMOUNT);
    this._showPopup(itemEl, `+${DEBUG_AMOUNT}`);
  }

  _showPopup(anchor, text) {
    const popup = document.createElement('span');
    popup.className   = 'resource-cheat-popup';
    popup.textContent = text;
    anchor.appendChild(popup);
    // Remove after animation ends
    popup.addEventListener('animationend', () => popup.remove());
  }
}

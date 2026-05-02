import * as THREE from 'three';
import { makeIcon } from './icon_helper.js';

const UPDATE_MS = 200;

// Generic click-to-open context menu. Any Component implementing
//   getContextMenu() → { title?, state?, progress?, actions? }
// becomes clickable. Multiple components on a gameObject: the first one
// with the method wins.
//
// Shape of the returned descriptor:
//   {
//     title:    string,
//     state:    string,                                       // optional
//     progress: { label, value (0..1), text } | [{...}],      // optional, single or array
//     picker:   { options: [{ icon, label, selected, onClick }] }, // optional — compact icon-only toggle row
//     actions:  [{ icon, label, selected?, onClick }],        // optional — full-width buttons
//   }
//
// While the menu is open it polls getContextMenu every UPDATE_MS so live
// state (resource left, growth %) stays current. The menu auto-closes if
// its target gameObject is removed from the scene.
export class ContextMenu {
  constructor(game, { isBlocked = () => false } = {}) {
    this._game        = game;
    this._isBlocked   = isBlocked; // skip click while another system owns input (e.g. placement)
    this._raycaster   = new THREE.Raycaster();
    this._target      = null;
    this._menu        = null;
    this._updateTimer = null;

    this._onMouseDown    = this._onMouseDown.bind(this);
    this._onDocClick     = this._onDocClick.bind(this);
    this._onKeyDown      = this._onKeyDown.bind(this);

    game.renderer.domElement.addEventListener('mousedown', this._onMouseDown);
    document.addEventListener('mousedown', this._onDocClick);
    window.addEventListener('keydown', this._onKeyDown);
  }

  // ── Input ─────────────────────────────────────────────────────────────────
  _onMouseDown(e) {
    if (e.button !== 0) return;
    if (this._isBlocked()) return;

    const target = this._raycastTarget(e);
    if (target) {
      e.stopPropagation();
      this._open(target, e.clientX, e.clientY);
    } else if (this._menu) {
      this._close();
    }
  }

  _onDocClick(e) {
    if (!this._menu) return;
    if (this._menu.contains(e.target)) return;                       // click inside menu
    if (this._game.renderer.domElement.contains(e.target)) return;   // canvas — handled by _onMouseDown
    this._close();
  }

  _onKeyDown(e) {
    if (e.code === 'Escape' && this._menu) this._close();
  }

  // ── Targeting ─────────────────────────────────────────────────────────────
  _raycastTarget(e) {
    const canvas = this._game.renderer.domElement;
    const rect = canvas.getBoundingClientRect();
    const ndc = new THREE.Vector2(
      ((e.clientX - rect.left) / rect.width)  *  2 - 1,
      ((e.clientY - rect.top)  / rect.height) * -2 + 1,
    );
    if (!this._game.camera) return null;
    this._raycaster.setFromCamera(ndc, this._game.camera);

    const meshes = [];
    for (const go of this._game.gameObjects) {
      const provider = go.components.find(c => typeof c.getContextMenu === 'function');
      if (!provider) continue;
      go.object3D.traverse(o => {
        if (o.isMesh) {
          o.userData._ctxGO       = go;
          o.userData._ctxProvider = provider;
          meshes.push(o);
        }
      });
    }

    const hit = this._raycaster.intersectObjects(meshes, false)[0];
    if (!hit) return null;

    let obj = hit.object;
    while (obj && !obj.userData?._ctxGO) obj = obj.parent;
    if (!obj) return null;
    return { go: obj.userData._ctxGO, provider: obj.userData._ctxProvider };
  }

  // ── Lifecycle ─────────────────────────────────────────────────────────────
  _open(target, x, y) {
    this._close();
    this._target = target;
    this._menu = document.createElement('div');
    this._menu.className = 'context-menu';
    this._menu.style.left = `${x + 12}px`;
    this._menu.style.top  = `${y + 12}px`;
    document.body.append(this._menu);
    this._render();
    this._updateTimer = setInterval(() => this._update(), UPDATE_MS);
  }

  _close() {
    if (this._updateTimer) { clearInterval(this._updateTimer); this._updateTimer = null; }
    if (this._menu) { this._menu.remove(); this._menu = null; }
    this._target = null;
  }

  _update() {
    if (!this._target || !this._menu) return;
    // If the gameObject got removed (e.g. depleted resource), close.
    if (!this._game.gameObjects.includes(this._target.go)) { this._close(); return; }
    this._render();
  }

  _render() {
    if (!this._target || !this._menu) return;
    const data = this._target.provider.getContextMenu();
    if (!data) { this._close(); return; }

    this._menu.innerHTML = '';
    if (data.title) {
      const el = document.createElement('div');
      el.className   = 'context-menu-title';
      el.textContent = data.title;
      this._menu.append(el);
    }
    if (data.state) {
      const el = document.createElement('div');
      el.className   = 'context-menu-state';
      el.textContent = data.state;
      this._menu.append(el);
    }
    if (data.progress) {
      const items = Array.isArray(data.progress) ? data.progress : [data.progress];
      for (const p of items) {
        const row   = document.createElement('div'); row.className   = 'context-menu-progress';
        const label = document.createElement('span'); label.className = 'progress-label'; label.textContent = p.label;
        const bar   = document.createElement('div');  bar.className   = 'progress-bar';
        const fill  = document.createElement('div');  fill.className  = 'progress-fill';
        fill.style.width = `${Math.max(0, Math.min(1, p.value)) * 100}%`;
        bar.append(fill);
        const text = document.createElement('span'); text.className = 'progress-text';
        text.textContent = p.text ?? `${Math.round(p.value * 100)}%`;
        row.append(label, bar, text);
        this._menu.append(row);
      }
    }
    if (data.picker?.options?.length) {
      const row = document.createElement('div');
      row.className = 'context-menu-picker';
      for (const opt of data.picker.options) {
        const btn = document.createElement('button');
        btn.className   = 'picker-btn' + (opt.selected ? ' selected' : '');
        btn.title       = opt.label;
        btn.append(makeIcon(opt.icon, opt.iconUrl ?? null, 'picker-icon'));
        btn.addEventListener('click', (ev) => {
          ev.stopPropagation();
          opt.onClick?.();
          this._render();
        });
        row.append(btn);
      }
      this._menu.append(row);
    }
    if (data.actions?.length) {
      for (const action of data.actions) {
        const btn = document.createElement('button');
        btn.className = 'context-menu-btn' + (action.selected ? ' selected' : '');
        btn.title     = action.label;
        btn.append(makeIcon(action.icon, action.iconUrl ?? null, 'btn-icon'));
        const lbl = document.createElement('span');
        lbl.className   = 'btn-label';
        lbl.textContent = action.label;
        btn.append(lbl);
        btn.addEventListener('click', (ev) => {
          ev.stopPropagation();
          action.onClick?.();
          this._render();
        });
        this._menu.append(btn);
      }
    }
  }
}

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
    this._game         = game;
    this._isBlocked    = isBlocked; // skip click while another system owns input (e.g. placement)
    this._raycaster    = new THREE.Raycaster();
    this._target       = null;
    this._anchor       = null;          // world-space anchor (THREE.Vector3)
    this._projectedVec = new THREE.Vector3(); // reused each frame to avoid allocations
    this._menu         = null;
    this._updateTimer  = null;
    this._rafId        = null;          // requestAnimationFrame id for per-frame reposition

    this._onMouseDown    = this._onMouseDown.bind(this);
    this._onDocClick     = this._onDocClick.bind(this);
    this._onKeyDown      = this._onKeyDown.bind(this);
    this._onRaf          = this._onRaf.bind(this); // bound once so the same reference is passed to RAF (required for cancellation)

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
      const hasMenu = go.components.some(c => typeof c.getContextMenu === 'function');
      if (!hasMenu) continue;
      go.object3D.traverse(o => {
        if (o.isMesh) {
          o.userData._ctxGO = go;
          meshes.push(o);
        }
      });
    }

    const hit = this._raycaster.intersectObjects(meshes, false)[0];
    if (!hit) return null;

    let obj = hit.object;
    while (obj && !obj.userData?._ctxGO) obj = obj.parent;
    if (!obj) return null;
    return { go: obj.userData._ctxGO };
  }

  // ── Lifecycle ─────────────────────────────────────────────────────────────
  _open(target, x, y) {
    this._close();
    this._target = target;
    this._anchor = new THREE.Vector3();
    target.go.object3D.getWorldPosition(this._anchor);

    this._menu = document.createElement('div');
    this._menu.className = 'context-menu';
    // Place at click position initially so there is no flash before the first reposition.
    this._menu.style.left = `${x + 12}px`;
    this._menu.style.top  = `${y + 12}px`;
    document.body.append(this._menu);
    this._render();
    this._reposition(); // apply world-space projection and clamp immediately
    this._updateTimer = setInterval(() => this._update(), UPDATE_MS);
    this._scheduleReposition();
  }

  _close() {
    if (this._updateTimer) { clearInterval(this._updateTimer); this._updateTimer = null; }
    if (this._rafId) { cancelAnimationFrame(this._rafId); this._rafId = null; }
    if (this._menu) { this._menu.remove(); this._menu = null; }
    this._target  = null;
    this._anchor  = null;   // from #27 (world-space anchor)
    this._lastSig = null;   // from #29 (differential-render fingerprint)
  }

  _update() {
    if (!this._target || !this._menu) return;
    // If the gameObject got removed (e.g. depleted resource), close.
    if (!this._game.gameObjects.includes(this._target.go)) { this._close(); return; }
    const data = this._collectMenuData(this._target.go);
    if (!data) { this._close(); return; }

    // Only do a full DOM rebuild when the menu structure changes (rows
    // appearing/disappearing, selection toggling). Value-only changes
    // (progress fill, state text) are patched in-place so the hover state
    // and any in-flight click are not disrupted by DOM teardown.
    const sig = this._sig(data);
    if (sig !== this._lastSig) {
      this._renderData(data);
      return;
    }
    this._patch(data);
  }

  // Structural fingerprint — changes only when rows appear/disappear or a
  // picker/action selection toggles. Does NOT encode live progress values.
  _sig(data) {
    return JSON.stringify([
      data.title ?? '',
      Array.isArray(data.progress) ? data.progress.length : (data.progress ? 1 : 0),
      data.picker?.options?.map(o => `${o.label}:${o.selected ? '1' : '0'}`).join(',') ?? '',
      data.actions?.map(a => `${a.label}:${a.selected ? '1' : '0'}`).join(',') ?? '',
    ]);
  }

  // Fast in-place update for values that change on every poll tick.
  _patch(data) {
    if (data.state) {
      const el = this._menu.querySelector('.context-menu-state');
      if (el) el.textContent = data.state;
    }
    if (data.progress) {
      const items = Array.isArray(data.progress) ? data.progress : [data.progress];
      const fills = this._menu.querySelectorAll('.progress-fill');
      const texts = this._menu.querySelectorAll('.progress-text');
      items.forEach((p, i) => {
        if (fills[i]) fills[i].style.width = `${Math.max(0, Math.min(1, p.value)) * 100}%`;
        if (texts[i]) texts[i].textContent = p.text ?? `${Math.round(p.value * 100)}%`;
      });
    }
  }

  // Schedule a per-frame reposition via requestAnimationFrame so the menu
  // tracks its world-space anchor as the camera moves.
  _scheduleReposition() {
    this._rafId = requestAnimationFrame(this._onRaf);
  }

  _onRaf() {
    this._rafId = null;
    if (!this._menu || !this._target) return;
    this._reposition();
    this._scheduleReposition();
  }

  // Project the world-space anchor through the camera and move the menu.
  // Closes the menu if the anchor is behind the camera or off the canvas.
  _reposition() {
    if (!this._target || !this._menu) return;
    const camera = this._game.camera;
    if (!camera) return;

    // Update anchor from entity's current world position (handles moving ants, etc.).
    this._target.go.object3D.getWorldPosition(this._anchor);

    // Project world position → NDC (reuse _projectedVec to avoid per-frame allocation).
    this._projectedVec.copy(this._anchor).project(camera);
    const { x: nx, y: ny, z: nz } = this._projectedVec;

    // Outside the view frustum → close.
    if (nz > 1 || nz < -1) { this._close(); return; }

    // Convert NDC to CSS pixel coords relative to the viewport.
    const canvas = this._game.renderer.domElement;
    const rect   = canvas.getBoundingClientRect();
    const sx = (nx *  0.5 + 0.5) * rect.width  + rect.left;
    const sy = (ny * -0.5 + 0.5) * rect.height + rect.top;

    // If the anchor is outside the visible canvas, close the menu.
    if (sx < rect.left || sx > rect.right || sy < rect.top || sy > rect.bottom) {
      this._close(); return;
    }

    // Offset the menu slightly from the anchor point.
    let mx = sx + 12;
    let my = sy + 12;

    // Clamp to the canvas boundaries so the menu is never partially clipped (issue #18).
    const mw = this._menu.offsetWidth;
    const mh = this._menu.offsetHeight;
    mx = Math.max(rect.left + 4, Math.min(rect.right  - mw - 4, mx));
    my = Math.max(rect.top  + 4, Math.min(rect.bottom - mh - 4, my));

    this._menu.style.left = `${mx}px`;
    this._menu.style.top  = `${my}px`;
  }

  // Merge getContextMenu() descriptors from all components on the gameObject.
  // First non-null title/state/picker wins; progress and actions are concatenated.
  _collectMenuData(go) {
    const providers = go.components.filter(c => typeof c.getContextMenu === 'function');
    const merged = {};
    const allProgress = [];
    const allActions  = [];
    for (const p of providers) {
      const d = p.getContextMenu();
      if (!d) continue;
      if (d.title  && !merged.title)  merged.title  = d.title;
      if (d.state  && !merged.state)  merged.state  = d.state;
      if (d.picker && !merged.picker) merged.picker = d.picker;
      if (d.progress) {
        const items = Array.isArray(d.progress) ? d.progress : [d.progress];
        allProgress.push(...items);
      }
      if (d.actions) allActions.push(...d.actions);
    }
    if (!merged.title) return null;
    if (allProgress.length) merged.progress = allProgress;
    if (allActions.length)  merged.actions  = allActions;
    return merged;
  }

  _render() {
    if (!this._target || !this._menu) return;
    const data = this._collectMenuData(this._target.go);
    if (!data) { this._close(); return; }
    this._renderData(data);
  }

  _renderData(data) {
    this._lastSig = this._sig(data);
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

import * as THREE from 'three';

const _v     = new THREE.Vector3();
const _ndc   = new THREE.Vector2();
const _ray   = new THREE.Raycaster();
const _plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
const _hit   = new THREE.Vector3();

const DRAG_MIN     = 6;   // px before drag mode activates
const SLOT_SPACING = 2.2; // world units between formation slots

export class SelectionManager {
  constructor(game) {
    this._game     = game;
    this._selected = new Set();
    this._all      = new Set();
    this._drag     = null; // { x, y, moved }

    // Drag selection box overlay
    const box = document.createElement('div');
    box.style.cssText = 'position:fixed;pointer-events:none;display:none;z-index:200;'
      + 'border:1px solid #44ff44;background:rgba(68,255,68,0.06);';
    document.body.appendChild(box);
    this._box = box;

    const canvas = game.renderer.domElement;
    canvas.addEventListener('mousedown',   this._onDown.bind(this));
    window .addEventListener('mousemove',  this._onMove.bind(this));
    window .addEventListener('mouseup',    this._onUp.bind(this));
    // Suppress browser context menu when units are selected so right-click
    // issues a move command without a menu popping up.
    canvas.addEventListener('contextmenu', e => {
      if (this._selected.size > 0) e.preventDefault();
    });
  }

  register(sel)   { this._all.add(sel); }
  unregister(sel) { this._all.delete(sel); this._selected.delete(sel); }
  get selected()  { return this._selected; }

  // ── Input ──────────────────────────────────────────────────────────────────

  _onDown(e) {
    if (e.button === 0) {
      this._drag = { x: e.clientX, y: e.clientY, moved: false };
    }
    if (e.button === 2 && this._selected.size > 0) {
      e.stopPropagation();
      this._moveSelected(e);
    }
  }

  _onMove(e) {
    if (!this._drag) return;
    const dx = e.clientX - this._drag.x;
    const dy = e.clientY - this._drag.y;
    if (!this._drag.moved && Math.sqrt(dx * dx + dy * dy) > DRAG_MIN) {
      this._drag.moved = true;
    }
    if (!this._drag.moved) return;
    const x = Math.min(e.clientX, this._drag.x);
    const y = Math.min(e.clientY, this._drag.y);
    Object.assign(this._box.style, {
      display: 'block',
      left:    x  + 'px',
      top:     y  + 'px',
      width:   Math.abs(dx) + 'px',
      height:  Math.abs(dy) + 'px',
    });
  }

  _onUp(e) {
    if (e.button !== 0 || !this._drag) return;
    this._box.style.display = 'none';
    const { x, y, moved } = this._drag;
    this._drag = null;

    if (moved) {
      const x0 = Math.min(e.clientX, x), x1 = Math.max(e.clientX, x);
      const y0 = Math.min(e.clientY, y), y1 = Math.max(e.clientY, y);
      this._selectInRect(x0, y0, x1, y1);
    } else {
      this._deselectAll();
    }
  }

  // ── Selection ──────────────────────────────────────────────────────────────

  _selectInRect(x0, y0, x1, y1) {
    const cam    = this._game.camera;
    const canvas = this._game.renderer.domElement;
    const cw = canvas.clientWidth, ch = canvas.clientHeight;

    this._deselectAll();
    for (const sel of this._all) {
      const p = sel.gameObject.position;
      _v.set(p.x, p.y, p.z).project(cam);
      const sx = (_v.x  + 1) / 2 * cw;
      const sy = (-_v.y + 1) / 2 * ch;
      if (sx >= x0 && sx <= x1 && sy >= y0 && sy <= y1) {
        sel.select();
        this._selected.add(sel);
      }
    }
  }

  _deselectAll() {
    for (const sel of this._selected) sel.deselect();
    this._selected.clear();
  }

  // ── Move command ───────────────────────────────────────────────────────────

  _moveSelected(e) {
    const canvas = this._game.renderer.domElement;
    const rect   = canvas.getBoundingClientRect();
    _ndc.set(
      ((e.clientX - rect.left) / rect.width)  *  2 - 1,
      ((e.clientY - rect.top)  / rect.height) * -2 + 1,
    );
    _ray.setFromCamera(_ndc, this._game.camera);
    if (!_ray.ray.intersectPlane(_plane, _hit)) return;

    const units = [...this._selected];
    const slots = _gridSlots(_hit, units.length, SLOT_SPACING);
    units.forEach((sel, i) => sel.commandMove(slots[i]));
  }
}

// Arrange `count` units in a centred grid around `center`.
function _gridSlots(center, count, spacing) {
  const cols = Math.ceil(Math.sqrt(count));
  const rows = Math.ceil(count / cols);
  return Array.from({ length: count }, (_, i) => ({
    x: center.x + (i % cols - (cols - 1) / 2) * spacing,
    z: center.z + (Math.floor(i / cols) - (rows - 1) / 2) * spacing,
  }));
}

import * as THREE from 'three';
import { Worker } from './components/worker.js';
import { applyGhost, restoreFromGhost, setGhostTint, disposeGhostTint } from '../engine/ghost_material.js';

// Reusable click-to-place mode. Call start(def, onCommit) to enter placement
// for a given EntityDef; the controller renders a ghost preview that snaps to
// the hex under the cursor, places the real entity on click of a walkable
// hex, and calls onCommit() so the caller can deduct cost. Esc cancels.
export class PlacementController {
  constructor(game) {
    this._game       = game;
    this._active     = false;
    this._def        = null;
    this._onCommit   = null;
    this._ghost      = null;
    this._ghostHandle = null;
    this._raycaster  = new THREE.Raycaster();
    this._groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);

    this._onMouseMove = this._onMouseMove.bind(this);
    this._onMouseDown = this._onMouseDown.bind(this);
    this._onKeyDown   = this._onKeyDown.bind(this);

    const canvas = game.renderer.domElement;
    canvas.addEventListener('mousemove', this._onMouseMove);
    canvas.addEventListener('mousedown', this._onMouseDown);
    window.addEventListener('keydown', this._onKeyDown);
  }

  get active() { return this._active; }

  start(def, onCommit, onCancel) {
    if (this._active) this._cancel();
    this._active   = true;
    this._def      = def;
    this._onCommit = onCommit;
    this._onCancel = onCancel ?? null;
    this._buildGhost(def);
    document.body.style.cursor = 'crosshair';
  }

  cancel() { this._cancel(); }

  _buildGhost(def) {
    const go = def.createObject(this._game);
    go.game = this._game;
    // Flag so ConstructionSite.start() doesn't strip the mesh / register a
    // ghost-instance for this preview-only gameObject (it isn't in
    // game.gameObjects; it's a hover preview).
    go._previewOnly = true;
    go.start();
    this._ghostHandle = applyGhost(go.object3D);
    go.object3D.visible = false;
    this._game.scene.add(go.object3D);
    this._ghost = go;
  }

  _canPlaceAt(hex) {
    if (!this._game.hexGrid.isWalkable(hex.q, hex.r)) return false;
    const grid = this._game.hexGrid;
    for (const go of this._game.gameObjects) {
      if (!go.getComponent(Worker)) continue;
      const h = grid.worldToHex(go.position.x, go.position.z);
      if (h.q === hex.q && h.r === hex.r) return false;
    }
    return true;
  }

  _setGhostTint(valid) {
    const color = valid ? 0xaaccff : 0xff6666;
    setGhostTint(this._ghostHandle, color);
  }

  _onMouseMove(e) {
    if (!this._active) return;
    const hex = this._raycastToHex(e);
    if (!hex) {
      this._ghost.object3D.visible = false;
      return;
    }
    const wp    = this._game.hexGrid.hexToWorld(hex.q, hex.r);
    const valid = this._canPlaceAt(hex);
    this._ghost.object3D.position.set(wp.x, 0, wp.z);
    this._ghost.object3D.visible = true;
    this._setGhostTint(valid);
  }

  _onMouseDown(e) {
    if (!this._active || e.button !== 0) return;
    const hex = this._raycastToHex(e);
    if (!hex) return;
    const grid = this._game.hexGrid;
    if (!this._canPlaceAt(hex)) return;

    // stopImmediate so other listeners on the canvas (e.g. ContextMenu) don't
    // also act on this same click.
    e.stopImmediatePropagation();

    const wp = grid.hexToWorld(hex.q, hex.r);
    const go = this._def.createObject(this._game);
    go.object3D.position.set(wp.x, 0, wp.z);
    this._game.add(go);
    grid.occupy(hex.q, hex.r);
    if (this._def.entrance) grid.setEntrance(hex.q, hex.r, this._def.entrance[0], this._def.entrance[1]);

    this._onCommit?.();
    this._onCancel = null; // successful placement — don't restore
    this._cancel();
  }

  _onKeyDown(e) {
    if (this._active && e.code === 'Escape') this._cancel();
  }

  _cancel() {
    const cb = this._onCancel;
    if (this._ghost) {
      disposeGhostTint(this._ghostHandle);
      this._ghostHandle = null;
      this._game.scene.remove(this._ghost.object3D);
      this._ghost.destroy();
      this._ghost = null;
    }
    this._active   = false;
    this._def      = null;
    this._onCommit = null;
    this._onCancel = null;
    document.body.style.cursor = '';
    cb?.();
  }

  _raycastToHex(e) {
    const canvas = this._game.renderer.domElement;
    const rect   = canvas.getBoundingClientRect();
    const ndc = new THREE.Vector2(
      ((e.clientX - rect.left) / rect.width)  *  2 - 1,
      ((e.clientY - rect.top)  / rect.height) * -2 + 1,
    );
    if (!this._game.camera) return null;
    this._raycaster.setFromCamera(ndc, this._game.camera);

    const point = new THREE.Vector3();
    if (!this._raycaster.ray.intersectPlane(this._groundPlane, point)) return null;

    const hex = this._game.hexGrid.worldToHex(point.x, point.z);
    if (!this._game.hexGrid.inBounds(hex.q, hex.r)) return null;
    return hex;
  }
}

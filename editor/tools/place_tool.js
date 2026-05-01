import * as THREE from 'three';
import { ENTITY_DEFS } from '../entity_registry.js';

export class PlaceTool {
  constructor(game) {
    this._game      = game;
    this._activeDef = ENTITY_DEFS[0];
    this._placed    = [];
    this._selected  = null;
    this._helper    = null;
    this._dragging  = false;
    this._raycaster = new THREE.Raycaster();
    this._prevTick  = null;

    this.icon  = '📦';
    this.label = 'Place Objects';

    this._onMouseDown = this._onMouseDown.bind(this);
    this._onMouseMove = this._onMouseMove.bind(this);
    this._onMouseUp   = this._onMouseUp.bind(this);
    this._onKeyDown   = this._onKeyDown.bind(this);
  }

  buildPanel(container) {
    const cards = ENTITY_DEFS.map(def => `
      <div class="entity-card${def === this._activeDef ? ' active' : ''}" data-id="${def.id}">
        <span class="entity-icon">${def.icon}</span>
        <span class="entity-name">${def.name}</span>
      </div>`).join('');

    container.innerHTML = `
      <div class="panel-title">Place Objects</div>
      <div class="entity-grid">${cards}</div>
      <hr class="panel-separator">
      <div class="hint">Click terrain to place<br>Drag to reposition<br>Delete to remove</div>`;

    container.querySelectorAll('.entity-card').forEach(card => {
      card.addEventListener('click', () => {
        this._activeDef = ENTITY_DEFS.find(d => d.id === card.dataset.id);
        container.querySelectorAll('.entity-card').forEach(c => c.classList.remove('active'));
        card.classList.add('active');
      });
    });

    const canvas = this._game.renderer.domElement;
    canvas.addEventListener('mousedown', this._onMouseDown);
    window.addEventListener('mousemove', this._onMouseMove);
    window.addEventListener('mouseup',   this._onMouseUp);
    window.addEventListener('keydown',   this._onKeyDown);

    this._prevTick    = this._game.onTick;
    this._game.onTick = (dt) => { this._prevTick?.(dt); this._helper?.update(); };
  }

  deactivate() {
    const canvas = this._game.renderer.domElement;
    canvas.removeEventListener('mousedown', this._onMouseDown);
    window.removeEventListener('mousemove', this._onMouseMove);
    window.removeEventListener('mouseup',   this._onMouseUp);
    window.removeEventListener('keydown',   this._onKeyDown);
    this._game.onTick = this._prevTick;
    this._deselect();
  }

  // ── Raycasting helpers ────────────────────────────────────────────────────

  _ndc(e) {
    const rect = this._game.renderer.domElement.getBoundingClientRect();
    return new THREE.Vector2(
      ((e.clientX - rect.left) / rect.width)  *  2 - 1,
      ((e.clientY - rect.top)  / rect.height) * -2 + 1,
    );
  }

  _cast(ndc, meshes) {
    if (!meshes.length || !this._game.camera) return null;
    this._raycaster.setFromCamera(ndc, this._game.camera);
    const hits = this._raycaster.intersectObjects(meshes, false);
    return hits[0] ?? null;
  }

  _terrainMeshes() {
    const skip = new Set(this._placed.map(go => go.object3D));
    const out  = [];
    this._game.scene.traverse(obj => {
      if (!obj.isMesh) return;
      let root = obj;
      while (root.parent && root.parent !== this._game.scene) root = root.parent;
      if (!skip.has(root)) out.push(obj);
    });
    return out;
  }

  _placedMeshes() {
    const out = [];
    for (const go of this._placed) go.object3D.traverse(o => { if (o.isMesh) out.push(o); });
    return out;
  }

  _goFromMesh(mesh) {
    return this._placed.find(go => {
      let hit = false;
      go.object3D.traverse(o => { if (o === mesh) hit = true; });
      return hit;
    }) ?? null;
  }

  // ── Input handlers ────────────────────────────────────────────────────────

  _onMouseDown(e) {
    if (e.button !== 0) return;
    const ndc = this._ndc(e);

    // Did we click a placed entity? → select + start drag
    const entityHit = this._cast(ndc, this._placedMeshes());
    if (entityHit) {
      const go = this._goFromMesh(entityHit.object);
      if (go) { this._select(go); this._dragging = true; return; }
    }

    // Did we click terrain/floor? → place new entity
    const terrainHit = this._cast(ndc, this._terrainMeshes());
    if (terrainHit) {
      this._place(terrainHit.point);
    } else {
      this._deselect();
    }
  }

  _onMouseMove(e) {
    if (!this._dragging || !this._selected) return;
    const hit = this._cast(this._ndc(e), this._terrainMeshes());
    if (hit) this._selected.object3D.position.copy(hit.point);
  }

  _onMouseUp(e) {
    if (e.button === 0) this._dragging = false;
  }

  _onKeyDown(e) {
    if (e.code === 'Escape') { this._deselect(); return; }
    if ((e.code === 'Delete' || e.code === 'Backspace') && this._selected) this._removeSelected();
  }

  // ── Actions ───────────────────────────────────────────────────────────────

  _place(point) {
    const go = this._activeDef.createObject();
    go.object3D.position.set(point.x, point.y + this._activeDef.yOffset, point.z);
    this._game.add(go);
    this._placed.push(go);
    this._select(go);
  }

  _select(go) {
    this._deselect();
    this._selected = go;
    this._helper   = new THREE.BoxHelper(go.object3D, 0xffff00);
    this._game.scene.add(this._helper);
  }

  _deselect() {
    if (this._helper) { this._game.scene.remove(this._helper); this._helper = null; }
    this._selected = null;
    this._dragging = false;
  }

  _removeSelected() {
    const go = this._selected;
    this._deselect();
    this._placed = this._placed.filter(g => g !== go);
    this._game.remove(go);
  }
}

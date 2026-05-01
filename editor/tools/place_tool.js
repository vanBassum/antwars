import * as THREE from 'three';
import { ENTITY_DEFS } from '../entity_registry.js';

export class PlaceTool {
  constructor(game) {
    this._game             = game;
    this._placed           = []; // [{ go, def, heightDelta }]
    this._selected         = null; // ref into _placed
    this._helper           = null;
    this._dragging         = false;
    this._repoLastTerrainY = null;
    this._spawn            = null; // { def, ghost, hit, heightDelta }
    this._raycaster        = new THREE.Raycaster();
    this._prevTick         = null;

    this.icon  = '📦';
    this.label = 'Place Objects';

    this._onMouseDown = this._onMouseDown.bind(this);
    this._onMouseMove = this._onMouseMove.bind(this);
    this._onMouseUp   = this._onMouseUp.bind(this);
    this._onKeyDown   = this._onKeyDown.bind(this);
    this._onWheel     = this._onWheel.bind(this);
  }

  buildPanel(container) {
    const cards = ENTITY_DEFS.map(def => `
      <div class="entity-card" data-id="${def.id}">
        <span class="entity-icon">${def.icon}</span>
        <span class="entity-name">${def.name}</span>
      </div>`).join('');

    container.innerHTML = `
      <div class="panel-title">Place Objects</div>
      <div class="hint" style="margin-bottom:10px">Drag a type into the viewport</div>
      <div class="entity-grid">${cards}</div>
      <hr class="panel-separator">
      <div class="hint">Click to select · Drag to move<br>Scroll to adjust height · Delete to remove</div>`;

    container.querySelectorAll('.entity-card').forEach(card => {
      card.addEventListener('mousedown', (e) => {
        if (e.button !== 0) return;
        const def = ENTITY_DEFS.find(d => d.id === card.dataset.id);
        if (def) this._startSpawn(def);
        e.preventDefault();
      });
    });

    const canvas = this._game.renderer.domElement;
    canvas.addEventListener('mousedown', this._onMouseDown);
    canvas.addEventListener('wheel', this._onWheel, { capture: true });
    window.addEventListener('mousemove', this._onMouseMove);
    window.addEventListener('mouseup',   this._onMouseUp);
    window.addEventListener('keydown',   this._onKeyDown);

    this._prevTick    = this._game.onTick;
    this._game.onTick = (dt) => { this._prevTick?.(dt); this._helper?.update(); };
  }

  deactivate() {
    this._cancelSpawn();
    const canvas = this._game.renderer.domElement;
    canvas.removeEventListener('mousedown', this._onMouseDown);
    canvas.removeEventListener('wheel', this._onWheel, { capture: true });
    window.removeEventListener('mousemove', this._onMouseMove);
    window.removeEventListener('mouseup',   this._onMouseUp);
    window.removeEventListener('keydown',   this._onKeyDown);
    this._game.onTick = this._prevTick;
    this._deselect();
  }

  // ── Raycasting ────────────────────────────────────────────────────────────

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
    return this._raycaster.intersectObjects(meshes, false)[0] ?? null;
  }

  _terrainMeshes() {
    const skip = new Set([
      ...this._placed.map(p => p.go.object3D),
      this._spawn?.ghost?.object3D,
    ].filter(Boolean));
    const out = [];
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
    for (const { go } of this._placed) go.object3D.traverse(o => { if (o.isMesh) out.push(o); });
    return out;
  }

  _entryFromMesh(mesh) {
    return this._placed.find(({ go }) => {
      let found = false;
      go.object3D.traverse(o => { if (o === mesh) found = true; });
      return found;
    }) ?? null;
  }

  // ── Spawn drag (panel → viewport) ────────────────────────────────────────

  _startSpawn(def) {
    this._cancelSpawn();
    this._deselect();
    this._spawn = { def, ghost: null, hit: null, heightDelta: 0 };
    document.body.style.cursor = 'grabbing';
  }

  _makeGhost(def) {
    const go = def.createObject();
    go.game = this._game;
    go.start();
    go.object3D.traverse(obj => {
      if (!obj.isMesh) return;
      obj.material = new THREE.MeshStandardMaterial({
        color: 0xaaccff, transparent: true, opacity: 0.45, depthWrite: false,
      });
    });
    go.object3D.visible = false;
    this._game.scene.add(go.object3D);
    return go;
  }

  _disposeGhost(ghost) {
    ghost.object3D.traverse(obj => {
      if (obj.isMesh) { obj.geometry.dispose(); obj.material.dispose(); }
    });
    this._game.scene.remove(ghost.object3D);
  }

  _cancelSpawn() {
    if (!this._spawn) return;
    if (this._spawn.ghost) this._disposeGhost(this._spawn.ghost);
    this._spawn = null;
    document.body.style.cursor = '';
  }

  _commitSpawn() {
    const { def, ghost, hit, heightDelta } = this._spawn;
    if (ghost) this._disposeGhost(ghost);
    this._spawn = null;
    document.body.style.cursor = '';
    if (hit) this._place(def, hit, heightDelta);
  }

  // ── Input handlers ────────────────────────────────────────────────────────

  _onMouseDown(e) {
    if (e.button !== 0) return;
    const ndc = this._ndc(e);

    const entityHit = this._cast(ndc, this._placedMeshes());
    if (entityHit) {
      const entry = this._entryFromMesh(entityHit.object);
      if (entry) { this._select(entry); this._dragging = true; return; }
    }

    this._deselect();
  }

  _onMouseMove(e) {
    if (this._dragging && this._selected) {
      const hit = this._cast(this._ndc(e), this._terrainMeshes());
      if (hit) {
        this._repoLastTerrainY = hit.point.y;
        this._selected.go.object3D.position.set(
          hit.point.x,
          hit.point.y + this._selected.def.yOffset + this._selected.heightDelta,
          hit.point.z,
        );
      }
      return;
    }

    if (this._spawn) {
      const hit = this._cast(this._ndc(e), this._terrainMeshes());
      if (hit) {
        if (!this._spawn.ghost) this._spawn.ghost = this._makeGhost(this._spawn.def);
        this._spawn.ghost.object3D.visible = true;
        this._spawn.ghost.object3D.position.set(
          hit.point.x,
          hit.point.y + this._spawn.def.yOffset + this._spawn.heightDelta,
          hit.point.z,
        );
        this._spawn.hit = hit.point.clone();
      } else {
        if (this._spawn.ghost) this._spawn.ghost.object3D.visible = false;
        this._spawn.hit = null;
      }
    }
  }

  _onMouseUp(e) {
    if (e.button !== 0) return;
    if (this._dragging) { this._dragging = false; return; }
    if (this._spawn)    { this._commitSpawn(); }
  }

  _onKeyDown(e) {
    if (e.code === 'Escape') { this._cancelSpawn(); this._deselect(); return; }
    if ((e.code === 'Delete' || e.code === 'Backspace') && this._selected) this._removeSelected();
  }

  _onWheel(e) {
    const step = e.deltaY * (e.ctrlKey ? 0.0002 : 0.005);

    if (this._spawn) {
      e.stopPropagation(); // prevent camera zoom
      this._spawn.heightDelta += step;
      if (this._spawn.ghost?.object3D.visible && this._spawn.hit) {
        this._spawn.ghost.object3D.position.y =
          this._spawn.hit.y + this._spawn.def.yOffset + this._spawn.heightDelta;
      }
      return;
    }

    if (this._selected) {
      e.stopPropagation();
      this._selected.heightDelta += step;
      if (this._repoLastTerrainY !== null) {
        this._selected.go.object3D.position.y =
          this._repoLastTerrainY + this._selected.def.yOffset + this._selected.heightDelta;
      }
    }
  }

  // ── Actions ───────────────────────────────────────────────────────────────

  _place(def, point, heightDelta = 0) {
    const go = def.createObject();
    go.object3D.position.set(point.x, point.y + def.yOffset + heightDelta, point.z);
    this._game.add(go);
    const entry = { go, def, heightDelta };
    this._placed.push(entry);
    this._select(entry);
  }

  _select(entry) {
    this._deselect();
    this._selected         = entry;
    this._repoLastTerrainY = entry.go.object3D.position.y - entry.def.yOffset - entry.heightDelta;
    this._helper           = new THREE.BoxHelper(entry.go.object3D, 0xffff00);
    this._game.scene.add(this._helper);
  }

  _deselect() {
    if (this._helper) { this._game.scene.remove(this._helper); this._helper = null; }
    this._selected         = null;
    this._dragging         = false;
    this._repoLastTerrainY = null;
  }

  _removeSelected() {
    const entry = this._selected;
    this._deselect();
    this._placed = this._placed.filter(p => p !== entry);
    this._game.remove(entry.go);
  }
}

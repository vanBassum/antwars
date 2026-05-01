import * as THREE from 'three';
import { ENTITY_DEFS } from '../engine/entity_registry.js';

export class Prefabs {
  constructor(el, game, selection) {
    this._el        = el;
    this._game      = game;
    this._sel       = selection;
    this._spawn     = null; // { def, ghost, hit, heightDelta }
    this._drag      = null; // { go, terrainY }
    this._raycaster = new THREE.Raycaster();

    this._onCanvasDown = this._onCanvasDown.bind(this);
    this._onMouseMove  = this._onMouseMove.bind(this);
    this._onMouseUp    = this._onMouseUp.bind(this);
    this._onKeyDown    = this._onKeyDown.bind(this);
    this._onWheel      = this._onWheel.bind(this);

    game.renderer.domElement.addEventListener('mousedown', this._onCanvasDown);
    game.renderer.domElement.addEventListener('wheel', this._onWheel, { capture: true });
    window.addEventListener('mousemove', this._onMouseMove);
    window.addEventListener('mouseup',   this._onMouseUp);
    window.addEventListener('keydown',   this._onKeyDown);

    this._render();
  }

  // ── Public API ────────────────────────────────────────────────────────────

  loadEntities(entities) {
    for (const go of this._game.gameObjects.filter(g => g._entityDef)) this._game.remove(go);
    const defMap = new Map(ENTITY_DEFS.map(d => [d.id, d]));
    for (const e of entities) {
      const def = defMap.get(e.id);
      if (!def) { console.warn(`Prefabs: unknown entity "${e.id}"`); continue; }
      const go = def.createObject();
      go._entityDef   = def;
      go._heightDelta = e.hd ?? 0;
      go._player      = e.player ?? 1;
      go.object3D.position.fromArray(e.p);
      this._game.add(go);
    }
  }

  getEntityData() {
    return this._game.gameObjects
      .filter(go => go._entityDef)
      .map(go => ({
        id:     go._entityDef.id,
        p:      go.object3D.position.toArray().map(v => +v.toFixed(4)),
        hd:     +(go._heightDelta ?? 0).toFixed(4),
        player: go._player ?? 1,
      }));
  }

  // ── Panel ─────────────────────────────────────────────────────────────────

  _render() {
    const cards = ENTITY_DEFS.map(def => `
      <div class="prefab-card" data-id="${def.id}">
        <span class="prefab-icon">${def.icon}</span>
        <span class="prefab-name">${def.name}</span>
      </div>`).join('');

    this._el.innerHTML = `
      <div class="panel-header">Prefabs</div>
      <div class="prefabs-row">${cards}</div>`;

    this._el.querySelectorAll('.prefab-card').forEach(card => {
      card.addEventListener('mousedown', (e) => {
        if (e.button !== 0) return;
        const def = ENTITY_DEFS.find(d => d.id === card.dataset.id);
        if (def) this._startSpawn(def);
        e.preventDefault();
      });
    });
  }

  // ── Raycasting ────────────────────────────────────────────────────────────

  _ndc(e) {
    const rect = this._game.renderer.domElement.getBoundingClientRect();
    return new THREE.Vector2(
      ((e.clientX - rect.left) / rect.width)  *  2 - 1,
      ((e.clientY - rect.top)  / rect.height) * -2 + 1,
    );
  }

  _cast(ndc, objects) {
    if (!objects.length || !this._game.camera) return null;
    this._raycaster.setFromCamera(ndc, this._game.camera);
    return this._raycaster.intersectObjects(objects, false)[0] ?? null;
  }

  _entityMeshes() {
    const out = [];
    for (const go of this._game.gameObjects.filter(g => g._entityDef))
      go.object3D.traverse(o => { if (o.isMesh) out.push(o); });
    return out;
  }

  _terrainMeshes() {
    const skip = new Set([
      ...this._game.gameObjects.filter(g => g._entityDef).map(g => g.object3D),
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

  _goFromMesh(mesh) {
    return this._game.gameObjects.find(go => {
      let hit = false;
      go.object3D.traverse(o => { if (o === mesh) hit = true; });
      return hit;
    }) ?? null;
  }

  // ── Spawn (drag from prefabs panel) ──────────────────────────────────────

  _startSpawn(def) {
    if (this._spawn?.ghost) this._disposeGhost(this._spawn.ghost);
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
    ghost.object3D.traverse(obj => { if (obj.isMesh) obj.material.dispose(); });
    this._game.scene.remove(ghost.object3D);
  }

  // ── Input ─────────────────────────────────────────────────────────────────

  _onCanvasDown(e) {
    if (e.button !== 0 || this._spawn) return;
    const ndc = this._ndc(e);

    const eHit = this._cast(ndc, this._entityMeshes());
    if (eHit) {
      const go = this._goFromMesh(eHit.object);
      if (go) {
        if (e.shiftKey) {
          const dupe = go._entityDef.createObject();
          dupe._entityDef   = go._entityDef;
          dupe._heightDelta = go._heightDelta;
          dupe._player      = go._player ?? 1;
          dupe.object3D.position.copy(go.object3D.position);
          this._game.add(dupe);
          this._sel.set(dupe);
          this._drag = { go: dupe, terrainY: go.object3D.position.y - go._entityDef.yOffset - (go._heightDelta ?? 0) };
        } else {
          this._sel.set(go);
          this._drag = { go, terrainY: go.object3D.position.y - go._entityDef.yOffset - (go._heightDelta ?? 0) };
        }
        return;
      }
    }

    const tHit = this._cast(ndc, this._terrainMeshes());
    tHit ? this._sel.set(this._goFromMesh(tHit.object)) : this._sel.clear();
  }

  _onMouseMove(e) {
    if (this._drag) {
      const hit = this._cast(this._ndc(e), this._terrainMeshes());
      if (hit) {
        this._drag.terrainY = hit.point.y;
        const { go } = this._drag;
        go.object3D.position.set(
          hit.point.x,
          hit.point.y + go._entityDef.yOffset + (go._heightDelta ?? 0),
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
    if (this._drag)  { this._drag = null; return; }
    if (this._spawn) {
      const { def, ghost, hit, heightDelta } = this._spawn;
      if (ghost) this._disposeGhost(ghost);
      this._spawn = null;
      document.body.style.cursor = '';
      if (hit) {
        const go = def.createObject();
        go._entityDef   = def;
        go._heightDelta = heightDelta;
        go._player      = 1;
        go.object3D.position.set(hit.x, hit.y + def.yOffset + heightDelta, hit.z);
        this._game.add(go);
        this._sel.set(go);
      }
    }
  }

  _onKeyDown(e) {
    if (e.code === 'Escape') {
      if (this._spawn) {
        if (this._spawn.ghost) this._disposeGhost(this._spawn.ghost);
        this._spawn = null;
        document.body.style.cursor = '';
      }
      return;
    }
    if ((e.code === 'Delete' || e.code === 'Backspace') && this._sel.current?._entityDef) {
      const go = this._sel.current;
      this._sel.clear();
      this._game.remove(go);
    }
  }

  _onWheel(e) {
    const step = -e.deltaY * (e.shiftKey ? 0.0002 : 0.005);
    if (this._spawn) {
      e.stopPropagation();
      e.preventDefault();
      this._spawn.heightDelta += step;
      if (this._spawn.ghost?.object3D.visible && this._spawn.hit) {
        this._spawn.ghost.object3D.position.y =
          this._spawn.hit.y + this._spawn.def.yOffset + this._spawn.heightDelta;
      }
      return;
    }
    const go = this._sel.current;
    if (go?._entityDef) {
      e.stopPropagation();
      e.preventDefault();
      go._heightDelta = (go._heightDelta ?? 0) + step;
      go.object3D.position.y += step;
      if (this._drag) this._drag.terrainY += step;
    }
  }
}

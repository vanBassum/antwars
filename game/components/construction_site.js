import * as THREE from 'three';
import { Component } from '../../engine/gameobject.js';

const _mat4 = new THREE.Matrix4();

// A building under construction. Tracks per-resource remaining cost and
// renders itself as a translucent ghost via the GhostInstanceManager
// (one instanced draw per model URL across all sites) until the last unit
// lands. On completion it unregisters from the ghost pool and calls
// onComplete (which adds the gameplay component for this building, and for
// non-instanced buildings re-attaches a clone of the model).
//
// Designed for multi-resource costs (e.g. { wood: 5, sugar: 3 }) even
// though v1 only ships wood.
export class ConstructionSite extends Component {
  constructor({ remaining, def, modelUrl, onComplete }) {
    super();
    this.remaining = { ...remaining }; // { wood: 5 }
    this.delivered = {};
    for (const k of Object.keys(this.remaining)) this.delivered[k] = 0;
    this._def        = def;
    this._modelUrl   = modelUrl ?? def?.modelUrl ?? null;
    this._onComplete = onComplete;
    this._completed  = false;
    this._ghostReg   = null;
  }

  start() {
    // PlacementController hover-preview gameObjects also run start() but
    // aren't real construction sites — leave them alone (their mesh is
    // needed for applyGhost; no ghost-pool registration wanted).
    if (this.gameObject._previewOnly) return;

    // Strip any meshes inherited from the placement-preview path (placement
    // adds a cloneModel for the hover ghost; we render via the instanced
    // ghost pool from here on, so the per-site mesh is redundant).
    const meshes = [];
    this.gameObject.object3D.traverse(obj => { if (obj.isMesh) meshes.push(obj); });
    for (const m of meshes) m.parent?.remove(m);

    // Register with the shared ghost-instance pool — one instanced draw call
    // per model URL across every concurrent construction site.
    const mgr = this.gameObject.game?.ghostInstances;
    if (mgr && this._modelUrl) {
      this._syncMatrix();
      this._ghostReg = mgr.register(this._modelUrl, _mat4, this.gameObject);
    }

    // Wake any worker mid-cycle so they re-evaluate immediately instead of
    // waiting for cycle boundary. The WorkManager rebuilds its caches each
    // request() now, so the new site is visible right away.
    this.gameObject.game?.workManager?.preemptWorkers?.();
  }

  needsMaterial(type) {
    return !this._completed && (this.remaining[type] ?? 0) > 0;
  }

  // Types this site still wants. Used by WorkManager to pick a deliverable type
  // that the player actually has in stockpile.
  *neededTypes() {
    if (this._completed) return;
    for (const [k, v] of Object.entries(this.remaining)) {
      if (v > 0) yield k;
    }
  }

  isComplete() { return this._completed; }

  receiveMaterial(type) {
    if (this._completed) return false;
    if ((this.remaining[type] ?? 0) <= 0) return false;
    this.remaining[type]--;
    this.delivered[type] = (this.delivered[type] ?? 0) + 1;
    if (this._totalRemaining() === 0) this._complete();
    return true;
  }

  _totalRemaining() {
    let n = 0;
    for (const v of Object.values(this.remaining)) n += v;
    return n;
  }

  _complete() {
    this._completed = true;
    const mgr = this.gameObject.game?.ghostInstances;
    if (mgr) mgr.unregister(this._ghostReg);
    this._ghostReg = null;
    this._onComplete?.(this.gameObject);
  }

  destroy() {
    // Clean up if the site is removed before completion (e.g. cancel).
    if (this._ghostReg) {
      const mgr = this.gameObject.game?.ghostInstances;
      if (mgr) mgr.unregister(this._ghostReg);
      this._ghostReg = null;
    }
  }

  getContextMenu() {
    if (this._completed) return null;
    const progress = Object.entries(this.delivered).map(([k, v]) => ({
      label: k,
      value: v / (v + this.remaining[k]),
      text:  `${v} / ${v + this.remaining[k]}`,
    }));
    return {
      title:    `${this._def.name} (building)`,
      progress,
    };
  }

  _syncMatrix() {
    const o = this.gameObject.object3D;
    o.updateMatrixWorld(true);
    _mat4.copy(o.matrixWorld);
  }
}

import { Component } from '../../engine/gameobject.js';

// A building under construction. Tracks per-resource remaining cost and
// applies a translucent ghost overlay to the building's meshes until the
// last unit lands. On completion it restores opaque materials and calls
// onComplete (which adds the gameplay component for this building).
//
// Designed for multi-resource costs (e.g. { wood: 5, sugar: 3 }) even
// though v1 only ships wood.
export class ConstructionSite extends Component {
  constructor({ remaining, def, onComplete }) {
    super();
    this.remaining = { ...remaining }; // { wood: 5 }
    this.delivered = {};
    for (const k of Object.keys(this.remaining)) this.delivered[k] = 0;
    this._def        = def;
    this._onComplete = onComplete;
    this._completed  = false;
    this._ghostMats  = [];
  }

  start() {
    this.gameObject.object3D.traverse(obj => {
      if (!obj.isMesh) return;
      obj.material = obj.material.clone();
      obj.material.transparent = true;
      obj.material.opacity     = 0.45;
      obj.material.depthWrite  = false;
      this._ghostMats.push(obj.material);
    });
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
    for (const m of this._ghostMats) {
      m.transparent = false;
      m.opacity     = 1.0;
      m.depthWrite  = true;
    }
    this._ghostMats.length = 0;
    this._onComplete?.(this.gameObject);
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
}

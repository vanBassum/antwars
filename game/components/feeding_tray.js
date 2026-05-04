import { Component } from '../../engine/gameobject.js';
import { cloneModel } from '../../engine/model_cache.js';

const BOINK_DURATION = 0.35;
const BOINK_OVERSHOOT = 1.45;

export class FeedingTray extends Component {
  constructor() {
    super();
    this.level    = 0;
    this.capacity = 5;
    this._honey   = null;
    this._scaleCurrent = 0;
    this._scaleTarget  = 0;
    this._boinkT       = 0;
  }

  start() {
    this._honey = cloneModel('assets/models/HoneyBlob.glb');
    this._honey.position.y = 0.1; // sit inside the bowl
    this.gameObject.object3D.add(this._honey);
    this._scaleTarget = this._targetScaleFor(this.level);
    this._scaleCurrent = this._scaleTarget;
    this._applyScale();
  }

  needsSugar() { return this.level < this.capacity; }

  receiveSugar() {
    if (this.level >= this.capacity) return false;
    this.level++;
    this._kickBoink();
    return true;
  }

  drink() {
    if (this.level <= 0) return false;
    this.level--;
    this._kickBoink();
    return true;
  }

  update(dt) {
    if (!this._honey) return;
    if (this._boinkT <= 0 && this._scaleCurrent === this._scaleTarget) return;

    if (this._boinkT > 0) {
      this._boinkT = Math.max(0, this._boinkT - dt);
      // Map remaining time → 0..1 progress through the boink.
      const p = 1 - (this._boinkT / BOINK_DURATION);
      // Ease-out overshoot then settle: sin(π·p) gives a 0→1→0 hump,
      // mixed in addition to a linear blend toward the target.
      const blend = Math.min(1, p * 1.6);
      const settle = this._scaleTarget * blend + this._scaleCurrent * (1 - blend);
      const hump   = (this._scaleTarget * BOINK_OVERSHOOT - this._scaleTarget) * Math.sin(Math.PI * p);
      this._honey.scale.setScalar(Math.max(0.001, settle + hump));
      if (this._boinkT === 0) {
        this._scaleCurrent = this._scaleTarget;
        this._applyScale();
      }
    }
  }

  _kickBoink() {
    this._scaleTarget = this._targetScaleFor(this.level);
    this._boinkT      = BOINK_DURATION;
    if (this._honey) this._honey.visible = this.level > 0 || this._scaleCurrent > 0;
  }

  _targetScaleFor(level) {
    if (level <= 0) return 0;
    return 0.6 * (level / this.capacity);
  }

  _applyScale() {
    if (!this._honey) return;
    if (this._scaleCurrent <= 0) { this._honey.visible = false; return; }
    this._honey.visible = true;
    this._honey.scale.setScalar(this._scaleCurrent);
  }

  getContextMenu() {
    return {
      title: 'Feeding Tray',
      state: `Sugar: ${this.level} / ${this.capacity}`,
    };
  }
}

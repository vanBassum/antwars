import { Component } from '../gameobject.js';

const HIT_DURATION    = 0.25;
const ATTACK_DURATION = 0.18;
const HIT_PEAK_SCALE  = 1.35;
const LUNGE_DIST      = 0.4;

export class CombatAnimator extends Component {
  start() {
    this._hitAnim    = null; // { t }
    this._attackAnim = null; // { t, dx, dz }
    // First child of object3D is the visual mesh for non-instanced entities
    this._visual = this.gameObject.object3D.children[0] ?? null;
    this.gameObject.animScale   = 1;
    this.gameObject.animOffsetX = 0;
    this.gameObject.animOffsetZ = 0;
  }

  playHit() {
    this._hitAnim = { t: 0 };
  }

  // dx, dz: normalised direction toward target
  playAttack(dx, dz) {
    this._attackAnim = { t: 0, dx, dz };
  }

  update(dt) {
    let scale = 1;
    let ox = 0, oz = 0;

    if (this._hitAnim) {
      this._hitAnim.t += dt;
      const p = Math.min(this._hitAnim.t / HIT_DURATION, 1);
      // Fast rise (0–20 %), slow fall back to 1
      scale = p < 0.2
        ? 1 + (p / 0.2) * (HIT_PEAK_SCALE - 1)
        : HIT_PEAK_SCALE - ((p - 0.2) / 0.8) * (HIT_PEAK_SCALE - 1);
      if (p >= 1) this._hitAnim = null;
    }

    if (this._attackAnim) {
      this._attackAnim.t += dt;
      const p = Math.min(this._attackAnim.t / ATTACK_DURATION, 1);
      // Quick lunge forward (0–35 %), spring back
      const mag = p < 0.35
        ? (p / 0.35) * LUNGE_DIST
        : LUNGE_DIST * (1 - (p - 0.35) / 0.65);
      ox = this._attackAnim.dx * mag;
      oz = this._attackAnim.dz * mag;
      if (p >= 1) this._attackAnim = null;
    }

    // Write to GO properties — InstancedRenderer reads these
    this.gameObject.animScale   = scale;
    this.gameObject.animOffsetX = ox;
    this.gameObject.animOffsetZ = oz;

    // Non-instanced entities: apply directly to scene-graph nodes
    this.gameObject.object3D.scale.setScalar(scale);
    if (this._visual) {
      this._visual.position.x = ox;
      this._visual.position.z = oz;
    }
  }
}

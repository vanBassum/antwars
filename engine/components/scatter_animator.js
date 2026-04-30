import * as THREE from 'three';
import { Component } from '../gameobject.js';

// Slowly shifts an object's mesh colors over time — makes the world feel alive.
// Each prop gets an independent phase and speed so they don't all change together.
export class ScatterAnimator extends Component {
  constructor({ swayAmplitude = 0.04, colorShift = 0.06, seed = Math.random() } = {}) {
    super();
    this._sway  = swayAmplitude;
    this._cShift = colorShift;
    this._phase = seed * Math.PI * 7; // unique starting phase per object
    this._speed = 0.18 + seed * 0.14; // 0.18–0.32 rad/s — very slow
    this._time  = this._phase;
    this._mats  = null;
    this._baseColors = null;
    this._baseY = 0;
  }

  start() {
    this._baseY = this.gameObject.position.y;
    // Collect all mesh materials once on first tick (model may not be loaded yet)
  }

  _collectMaterials() {
    if (this._mats) return;
    const mats = [];
    this.gameObject.object3D.traverse(child => {
      if (child.isMesh && child.material) {
        const m = Array.isArray(child.material) ? child.material : [child.material];
        for (const mat of m) {
          if (mat.color) {
            const clone = mat.clone();
            child.material = Array.isArray(child.material)
              ? child.material.map(x => x === mat ? clone : x)
              : clone;
            mats.push({ mat: clone, base: clone.color.clone() });
          }
        }
      }
    });
    if (mats.length === 0) return; // model not loaded yet
    this._mats = mats;
  }

  destroy() {
    if (this._mats) {
      for (const { mat } of this._mats) mat.dispose();
      this._mats = null;
    }
  }

  update(dt) {
    this._collectMaterials();
    if (!this._mats) return;

    this._time += dt * this._speed;
    const s = Math.sin(this._time);

    // Subtle vertical sway (wind)
    this.gameObject.position.y = this._baseY + s * this._sway;
    this.gameObject.object3D.rotation.z = s * this._sway * 0.6;

    // Slow color breathing — warm/cool shift on hue
    const shift = s * this._cShift;
    for (const { mat, base } of this._mats) {
      mat.color.setRGB(
        Math.min(1, base.r + shift * 0.5),
        Math.min(1, base.g + shift * 0.3),
        Math.max(0, base.b - shift * 0.2)
      );
    }
  }
}

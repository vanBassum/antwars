import { Component } from '../engine/gameobject.js';

const HATCH_TIME = 12; // seconds per egg

export class Nursery extends Component {
  static instance = null; // singleton — nurse workers use this to deposit

  constructor({ onHatch } = {}) {
    super();
    this._onHatch  = onHatch;
    this._incubating = []; // [{ timer }]
  }

  start() {
    Nursery.instance = this;
  }

  // Called by a nurse worker on arrival.
  acceptEgg() {
    this._incubating.push({ timer: HATCH_TIME });
  }

  update(dt) {
    for (let i = this._incubating.length - 1; i >= 0; i--) {
      this._incubating[i].timer -= dt;
      if (this._incubating[i].timer <= 0) {
        this._incubating.splice(i, 1);
        this._onHatch?.();
      }
    }
  }

  destroy() {
    Nursery.instance = null;
  }
}

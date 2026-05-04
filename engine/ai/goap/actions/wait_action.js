import { Action } from '../action.js';

// Generic timed action — waits `duration` seconds then completes.
// `onDone` fires once on completion (good for crediting resources,
// flipping flags, etc.).
export class WaitAction extends Action {
  constructor(name, duration, preconditions, effects, onDone) {
    super(name);
    this._duration     = duration;
    this.preconditions = preconditions;
    this.effects       = effects;
    this._onDone       = onDone;
  }

  enter(_agent) { this._t = 0; }

  perform(_agent, dt) {
    this._t += dt;
    if (this._t >= this._duration) {
      this._onDone?.();
      return true;
    }
    return false;
  }
}

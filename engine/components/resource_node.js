import { Component } from '../gameobject.js';

const WOBBLE_DURATION = 0.5;

// A finite harvestable node of a given resource type (e.g. 'sugar', 'wood').
// Each `take()` shrinks the model and triggers a damped jello wobble; once
// remaining drops below 10% of original the gameObject removes itself and
// frees its hex.
export class ResourceNode extends Component {
  constructor({ type, amount = 25 } = {}) {
    super();
    this.type       = type;
    this._initial   = amount;
    this._remaining = amount;
    this._wobbleT   = WOBBLE_DURATION;
  }

  get remaining() { return this._remaining; }
  get isEmpty()   { return this._remaining <= 0; }

  take(n = 1) {
    if (this._remaining <= 0) return 0;
    const taken = Math.min(n, this._remaining);
    this._remaining -= taken;

    // Disappear once we'd shrink below the visual floor (10% of original).
    if (this._remaining / this._initial < 0.1) {
      this._removeSelf();
      return taken;
    }
    this._wobbleT = 0; // kick off a fresh wobble
    return taken;
  }

  update(dt) {
    const base = this._remaining / this._initial;

    if (this._wobbleT >= WOBBLE_DURATION) {
      this.gameObject.object3D.scale.setScalar(base);
      return;
    }
    this._wobbleT += dt;
    const p     = Math.min(1, this._wobbleT / WOBBLE_DURATION);
    const decay = Math.exp(-p * 4);
    const wave  = Math.sin(p * Math.PI * 2 * 4);
    const amp   = 0.25 * decay;
    this.gameObject.object3D.scale.set(
      base * (1 - amp * wave * 0.5),
      base * (1 + amp * wave),
      base * (1 - amp * wave * 0.5),
    );
  }

  _removeSelf() {
    const game = this.gameObject.game;
    const grid = game?.hexGrid;
    if (grid) {
      const pos = this.gameObject.position;
      const hex = grid.worldToHex(pos.x, pos.z);
      grid.free(hex.q, hex.r);
    }
    game?.remove(this.gameObject);
  }
}

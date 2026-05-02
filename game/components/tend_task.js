import { FarmPlot } from './farm_plot.js';

// What an ant is currently trying to tend (water). Single source of truth
// for the picked farm plot, shared across the ant's tend cycle actions.
//
// Lifecycle: pick() → water() (when the ant arrives) → clear() (cycle ends).
export class TendTask {
  constructor(ownerGameObject) {
    this._owner = ownerGameObject;
    this.target = null; // FarmPlot-bearing gameObject
  }

  hasTarget() { return !!this.target; }

  // Pick the closest farm that has a crop and isn't fully grown.
  pick() {
    const game = this._owner.game;
    const farms = [];
    for (const g of game.gameObjects) {
      const fp = g.getComponent(FarmPlot);
      if (fp && fp.needsAttention()) farms.push(g);
    }
    if (farms.length === 0) { this.target = null; return null; }

    let best = null, bestD = Infinity;
    for (const f of farms) {
      const dx = f.position.x - this._owner.position.x;
      const dz = f.position.z - this._owner.position.z;
      const d  = dx * dx + dz * dz;
      if (d < bestD) { best = f; bestD = d; }
    }
    this.target = best;
    return best;
  }

  // Apply one watering to the picked farm. Returns true on success.
  water() {
    return this.target?.getComponent(FarmPlot)?.water() ?? false;
  }

  clear() { this.target = null; }
}

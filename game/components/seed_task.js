import { FarmPlot } from './farm_plot.js';

// What an ant is currently delivering a seed to. Pure data holder; the
// WorkManager assigns the target.
export class SeedTask {
  constructor() {
    this.target = null; // FarmPlot-bearing gameObject
  }

  hasTarget() { return !!this.target; }

  // Is the assigned farm still awaiting a seed?
  isStillValid() {
    if (!this.target) return false;
    if (!this.target.game?.gameObjects.includes(this.target)) return false;
    const fp = this.target.getComponent(FarmPlot);
    return !!fp && fp.needsSeed();
  }

  // Hand the seed to the farm — transitions it from AWAITING_SEED to
  // GROWING. Returns true on success.
  deliver() {
    return this.target?.getComponent(FarmPlot)?.deliverSeed() ?? false;
  }

  clear() { this.target = null; }
}

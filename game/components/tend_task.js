import { FarmPlot } from './farm_plot.js';

// What an ant is currently tending (watering). Pure data holder; the
// WorkManager assigns the target.
export class TendTask {
  constructor() {
    this.target = null; // FarmPlot-bearing gameObject
  }

  hasTarget() { return !!this.target; }

  // Apply one watering to the picked farm. Returns true on success.
  water() { return this.target?.getComponent(FarmPlot)?.water() ?? false; }

  clear() { this.target = null; }
}

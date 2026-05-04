import { ResourceNode } from './resource_node.js';
import { FarmPlot } from './farm_plot.js';

// What an ant is currently harvesting. Pure data holder; the WorkManager
// assigns target/type, and the GOAP actions read them.
//
// Targets can be either a ResourceNode-bearing entity (sugar/wood node) or
// a fully-grown FarmPlot. The cycle is identical from the ant's side —
// take() and isStillValid() polymorph based on which component the target
// has.
export class HarvestTask {
  constructor() {
    this.target = null; // ResourceNode- or FarmPlot-bearing gameObject
    this.type   = null; // 'sugar' | 'wood' | …
  }

  hasTarget() { return !!this.target; }

  // Is the assigned target still a valid harvest source?
  isStillValid() {
    if (!this.target) return false;
    if (!this.target.game?.gameObjects.includes(this.target)) return false;
    const rn = this.target.getComponent(ResourceNode);
    if (rn) return !rn.isEmpty;
    const fp = this.target.getComponent(FarmPlot);
    if (fp) return fp.isReadyToHarvest();
    return false;
  }

  // Decrement one unit. Returns the amount actually taken (0 if the source
  // is gone or already empty).
  take() {
    if (!this.target) return 0;
    const rn = this.target.getComponent(ResourceNode);
    if (rn) return rn.take(1);
    const fp = this.target.getComponent(FarmPlot);
    if (fp) return fp.harvestOne();
    return 0;
  }

  clear() { this.target = this.type = null; }
}

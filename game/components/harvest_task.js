import { ResourceNode } from './resource_node.js';

// What an ant is currently harvesting. Pure data holder; the WorkManager
// assigns target/type, and the GOAP actions read them.
export class HarvestTask {
  constructor() {
    this.target = null; // ResourceNode-bearing gameObject
    this.type   = null; // 'sugar' | 'wood' | …
  }

  hasTarget() { return !!this.target; }

  // Is the assigned target still a valid harvest source?
  isStillValid() {
    if (!this.target) return false;
    if (!this.target.game?.gameObjects.includes(this.target)) return false;
    const rn = this.target.getComponent(ResourceNode);
    return !!rn && !rn.isEmpty;
  }

  // Decrement one unit from the chosen node. Returns the amount actually
  // taken (0 if the node is gone or already empty).
  take() {
    return this.target?.getComponent(ResourceNode)?.take(1) ?? 0;
  }

  clear() { this.target = this.type = null; }
}

import { ResourceNode } from './resource_node.js';

// What an ant is currently trying to harvest. Single source of truth for the
// picked target + resource type, shared across the ant's harvest cycle actions.
//
// Lifecycle: pick() → take() (per Collect tick) → clear() (after deposit).
export class HarvestTask {
  constructor(ownerGameObject) {
    this._owner = ownerGameObject;
    this.target = null; // ResourceNode-bearing gameObject
    this.type   = null; // 'sugar' | 'wood' | …
  }

  hasTarget() { return !!this.target; }

  // Pick a random resource *type* present in the world, then the closest node
  // of that type relative to the owner. Mutates target/type and returns the
  // chosen gameObject (or null if no resources exist).
  pick() {
    const game  = this._owner.game;
    const nodes = game.gameObjects.filter(g => g.getComponent(ResourceNode));
    if (nodes.length === 0) {
      this.target = this.type = null;
      return null;
    }

    const byType = new Map();
    for (const n of nodes) {
      const r = n.getComponent(ResourceNode);
      if (!byType.has(r.type)) byType.set(r.type, []);
      byType.get(r.type).push(n);
    }

    const types = [...byType.keys()];
    const type  = types[Math.floor(Math.random() * types.length)];
    const cands = byType.get(type);

    let best = null, bestD = Infinity;
    for (const n of cands) {
      const dx = n.position.x - this._owner.position.x;
      const dz = n.position.z - this._owner.position.z;
      const d  = dx * dx + dz * dz;
      if (d < bestD) { best = n; bestD = d; }
    }

    this.target = best;
    this.type   = type;
    return best;
  }

  // Decrement one unit from the chosen node. Returns the amount actually taken
  // (0 if the node is gone or already empty).
  take() {
    return this.target?.getComponent(ResourceNode)?.take(1) ?? 0;
  }

  clear() {
    this.target = null;
    this.type   = null;
  }
}

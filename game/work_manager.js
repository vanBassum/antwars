import { ResourceNode } from './components/resource_node.js';
import { FarmPlot } from './components/farm_plot.js';

// Per-target concurrent-worker caps. Resource nodes get 2 (multiple ants
// share a sugar pile reasonably); farms get 1 per work kind (one watering
// or one seed delivery at a time is enough).
const MAX_CLAIMS = { harvest: 2, tend: 1, seed: 1 };

// Central authority that hands out work. Tasks are derived from current
// game state on demand (no separate task queue), so they can never go stale.
//
// Caching: the manager keeps two lists — gameObjects with ResourceNode and
// gameObjects with FarmPlot — invalidated only when entities are added or
// removed (via Game.addSceneListener). Per-frame availability checks then
// scan those small filtered lists instead of every gameObject in the scene.
//
// API:
//   request(ant) → { kind, target, type? } | null
//     Releases any prior claim by this ant, finds the nearest unclaimed
//     valid task whose target hasn't hit its concurrent-worker cap, and
//     reserves it for this ant.
//   release(ant)
//     Frees this ant's claim (call on cycle complete or failure).
//   isValid(ant) → bool
//     True if the ant's current claim still wants the work.
//   claimOf(ant) → claim | null
//     Read the current claim without changing it.
//   resourceAvailable() → bool
//     True if any ResourceNode still has units.
//   farmAvailable() → bool
//     True if any FarmPlot currently needs watering.
//   seedAvailable() → bool
//     True if any FarmPlot is awaiting a seed.
export class WorkManager {
  constructor(game) {
    this._game     = game;
    this._claims   = new Map(); // ant gameObject → claim

    // Index caches — rebuilt only on add/remove, not every frame.
    this._dirty         = true;
    this._resourceNodes = []; // gameObjects with a ResourceNode component
    this._farmPlots     = []; // gameObjects with a FarmPlot component

    game.addSceneListener(() => { this._dirty = true; });
  }

  request(ant) {
    this.release(ant);
    this._refreshCaches();

    const counts = new Map();
    for (const c of this._claims.values()) {
      counts.set(c.target, (counts.get(c.target) ?? 0) + 1);
    }

    let best = null, bestD = Infinity;

    for (const go of this._resourceNodes) {
      const rn = go.getComponent(ResourceNode);
      if (!rn || rn.isEmpty) continue;
      if ((counts.get(go) ?? 0) >= MAX_CLAIMS.harvest) continue;
      const d = this._dist2(ant, go);
      if (d < bestD) { best = { kind: 'harvest', target: go, type: rn.type }; bestD = d; }
    }

    for (const go of this._farmPlots) {
      const fp = go.getComponent(FarmPlot);
      if (!fp) continue;
      const used = counts.get(go) ?? 0;
      if (fp.needsSeed() && used < MAX_CLAIMS.seed) {
        const d = this._dist2(ant, go);
        if (d < bestD) { best = { kind: 'seed', target: go }; bestD = d; }
      } else if (fp.needsAttention() && used < MAX_CLAIMS.tend) {
        const d = this._dist2(ant, go);
        if (d < bestD) { best = { kind: 'tend', target: go }; bestD = d; }
      } else if (fp.isReadyToHarvest() && used < MAX_CLAIMS.harvest) {
        const d = this._dist2(ant, go);
        if (d < bestD) { best = { kind: 'harvest', target: go, type: fp.yieldType() }; bestD = d; }
      }
    }

    if (best) this._claims.set(ant, best);
    return best;
  }

  release(ant) { this._claims.delete(ant); }

  claimOf(ant) { return this._claims.get(ant) ?? null; }

  isValid(ant) {
    const c = this._claims.get(ant);
    if (!c) return false;
    if (!this._game.gameObjects.includes(c.target)) return false;
    if (c.kind === 'harvest') {
      const rn = c.target.getComponent(ResourceNode);
      if (rn) return !rn.isEmpty;
      const fp = c.target.getComponent(FarmPlot);
      if (fp) return fp.isReadyToHarvest();
      return false;
    }
    if (c.kind === 'tend') {
      const fp = c.target.getComponent(FarmPlot);
      return !!fp && fp.needsAttention();
    }
    if (c.kind === 'seed') {
      const fp = c.target.getComponent(FarmPlot);
      return !!fp && fp.needsSeed();
    }
    return false;
  }

  // ── Cheap availability queries (used by Worker per-frame) ─────────────
  resourceAvailable() {
    this._refreshCaches();
    for (const go of this._resourceNodes) {
      const rn = go.getComponent(ResourceNode);
      if (rn && !rn.isEmpty) return true;
    }
    return false;
  }
  farmAvailable() {
    this._refreshCaches();
    for (const go of this._farmPlots) {
      const fp = go.getComponent(FarmPlot);
      if (fp && fp.needsAttention()) return true;
    }
    return false;
  }
  seedAvailable() {
    this._refreshCaches();
    for (const go of this._farmPlots) {
      const fp = go.getComponent(FarmPlot);
      if (fp && fp.needsSeed()) return true;
    }
    return false;
  }

  _refreshCaches() {
    if (!this._dirty) return;
    this._resourceNodes = [];
    this._farmPlots     = [];
    for (const go of this._game.gameObjects) {
      if (go.getComponent(ResourceNode)) this._resourceNodes.push(go);
      if (go.getComponent(FarmPlot))     this._farmPlots.push(go);
    }
    this._dirty = false;
  }

  _dist2(ant, target) {
    const dx = target.position.x - ant.position.x;
    const dz = target.position.z - ant.position.z;
    return dx * dx + dz * dz;
  }
}

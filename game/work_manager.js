import { ResourceNode } from './components/resource_node.js';
import { FarmPlot } from './components/farm_plot.js';

// Per-target concurrent-worker caps. Resource nodes get 2 (multiple ants
// share a sugar pile reasonably); farms get 1 per work kind (one watering
// or one seed delivery at a time is enough).
const MAX_CLAIMS = { harvest: 2, tend: 1, seed: 1 };

// Fairness weight: how quickly wait-time overtakes distance advantage.
// Score = distance² / (1 + waitSeconds * FAIRNESS_K).  Higher K means older
// tasks get prioritised more aggressively over nearer ones.
const FAIRNESS_K = 0.3;

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

    // Fairness: track when each (target, kind) first became eligible.
    // Key format: gameObject instance → Map<kind, timestampSeconds>.
    this._eligibleSince = new Map();

    game.addSceneListener(() => { this._dirty = true; });
  }

  request(ant) {
    this.release(ant);
    this._refreshCaches();
    this._updateEligibility();

    const now = this._game.elapsed ?? 0;
    const counts = new Map();
    for (const c of this._claims.values()) {
      counts.set(c.target, (counts.get(c.target) ?? 0) + 1);
    }

    let best = null, bestScore = Infinity;

    for (const go of this._resourceNodes) {
      const rn = go.getComponent(ResourceNode);
      if (!rn || rn.isEmpty) continue;
      if ((counts.get(go) ?? 0) >= MAX_CLAIMS.harvest) continue;
      const score = this._fairScore(ant, go, 'harvest', now);
      if (score < bestScore) { best = { kind: 'harvest', target: go, type: rn.type }; bestScore = score; }
    }

    for (const go of this._farmPlots) {
      const fp = go.getComponent(FarmPlot);
      if (!fp) continue;
      const used = counts.get(go) ?? 0;
      if (fp.needsSeed() && used < MAX_CLAIMS.seed) {
        const score = this._fairScore(ant, go, 'seed', now);
        if (score < bestScore) { best = { kind: 'seed', target: go }; bestScore = score; }
      } else if (fp.needsAttention() && used < MAX_CLAIMS.tend) {
        const score = this._fairScore(ant, go, 'tend', now);
        if (score < bestScore) { best = { kind: 'tend', target: go }; bestScore = score; }
      } else if (fp.isReadyToHarvest() && used < MAX_CLAIMS.harvest) {
        const score = this._fairScore(ant, go, 'harvest', now);
        if (score < bestScore) { best = { kind: 'harvest', target: go, type: fp.yieldType() }; bestScore = score; }
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

  // Weighted score: distance² discounted by how long the task has been waiting.
  _fairScore(ant, target, kind, now) {
    const d2 = this._dist2(ant, target);
    const kinds = this._eligibleSince.get(target);
    const since = kinds?.get(kind) ?? now;
    const age = now - since;
    return d2 / (1 + age * FAIRNESS_K);
  }

  // Update the eligibility timestamps: record when targets first become valid,
  // and clear entries for targets that are no longer valid.
  _updateEligibility() {
    const now = this._game.elapsed ?? 0;

    // Helper: mark (target, kind) as eligible starting now if not already tracked.
    const mark = (target, kind) => {
      let kinds = this._eligibleSince.get(target);
      if (!kinds) { kinds = new Map(); this._eligibleSince.set(target, kinds); }
      if (!kinds.has(kind)) kinds.set(kind, now);
    };
    // Helper: clear (target, kind) eligibility.
    const clear = (target, kind) => {
      const kinds = this._eligibleSince.get(target);
      if (kinds) kinds.delete(kind);
    };

    for (const go of this._resourceNodes) {
      const rn = go.getComponent(ResourceNode);
      if (rn && !rn.isEmpty) mark(go, 'harvest');
      else clear(go, 'harvest');
    }

    for (const go of this._farmPlots) {
      const fp = go.getComponent(FarmPlot);
      if (!fp) continue;
      if (fp.needsSeed()) mark(go, 'seed'); else clear(go, 'seed');
      if (fp.needsAttention()) mark(go, 'tend'); else clear(go, 'tend');
      if (fp.isReadyToHarvest()) mark(go, 'harvest'); else clear(go, 'harvest');
    }

    // Prune entries for removed gameObjects.
    for (const go of this._eligibleSince.keys()) {
      if (!this._game.gameObjects.includes(go)) this._eligibleSince.delete(go);
    }
  }

  _dist2(ant, target) {
    const dx = target.position.x - ant.position.x;
    const dz = target.position.z - ant.position.z;
    return dx * dx + dz * dz;
  }
}

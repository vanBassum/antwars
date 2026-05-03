import { ResourceNode } from './components/resource_node.js';
import { FarmPlot } from './components/farm_plot.js';
import { EggPickup } from './components/egg_pickup.js';
import { TrainingHut } from './components/training_hut.js';
import { FeedingTray } from './components/feeding_tray.js';

// Per-target concurrent-worker caps. Resource nodes get 2 (multiple ants
// share a sugar pile reasonably); farms get 1 per work kind (one watering
// or one seed delivery at a time is enough).
const MAX_CLAIMS = { harvest: 2, tend: 1, seed: 1, egg: 1, restock: 1 };

// Global egg cap: fieldEggs + inTransitEggs.
const EGG_CAP = 10;

// Fairness weight: how quickly wait-time overtakes distance advantage.
// Score = distance² / (1 + waitSeconds * FAIRNESS_K).  Higher K means older
// tasks get prioritised more aggressively over nearer ones.
const FAIRNESS_K = 0.3;

// Player-requested tasks (egg delivery, future construction) get a score
// divisor so they reliably beat ambient work (harvest/tend) at cycle boundaries.
const PLAYER_TASK_BOOST = 10;

// Central authority that hands out work. Tasks are derived from current
// game state on demand (no separate task queue), so they can never go stale.
//
// Caching: the manager keeps lists of gameObjects by component type,
// invalidated only when entities are added or removed (via
// Game.addSceneListener). Per-frame availability checks then scan those
// small filtered lists instead of every gameObject in the scene.
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
    this._looseEggs     = []; // gameObjects with an EggPickup component
    this._trainingHuts  = []; // gameObjects with a TrainingHut component
    this._feedingTrays  = []; // gameObjects with a FeedingTray component

    // Registered workers — workers add/remove themselves so we can preempt
    // them without importing the Worker class (avoids circular deps).
    this._workers = new Set();

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

    // Egg delivery: only dispatch when a training hut has pending requests
    // AND we don't already have enough eggs in transit to satisfy them.
    // Without this cap, multiple preempted workers each grab an egg for the
    // same single queue slot — only one gets delivered, the rest are wasted.
    const hutWithRequest = this._nearestTrainingHut(ant);
    if (hutWithRequest) {
      let totalRequests = 0;
      for (const go of this._trainingHuts) {
        const th = go.getComponent(TrainingHut);
        if (th) totalRequests += th.queueLength;
      }
      let inFlightEggs = 0;
      for (const c of this._claims.values()) {
        if (c.kind === 'egg') inFlightEggs++;
      }
      if (inFlightEggs < totalRequests) {
        for (const go of this._looseEggs) {
          if ((counts.get(go) ?? 0) >= MAX_CLAIMS.egg) continue;
          const score = this._fairScore(ant, go, 'egg', now);
          if (score < bestScore) { best = { kind: 'egg', target: go, trainingHut: hutWithRequest }; bestScore = score; }
        }
      }
    }

    // Restock: feeding trays that need sugar. Try to find a nearby sugar
    // ResourceNode first; fall back to the Anthill stockpile.
    for (const go of this._feedingTrays) {
      const ft = go.getComponent(FeedingTray);
      if (!ft || !ft.needsSugar()) continue;
      if ((counts.get(go) ?? 0) >= MAX_CLAIMS.restock) continue;

      // Find nearest reachable sugar ResourceNode.
      let sugarSource = null, bestSourceD = Infinity;
      for (const rn of this._resourceNodes) {
        const rnc = rn.getComponent(ResourceNode);
        if (!rnc || rnc.isEmpty || rnc.type !== 'sugar') continue;
        const d = this._dist2(ant, rn);
        if (d < bestSourceD) { sugarSource = rn; bestSourceD = d; }
      }

      // Stockpile fallback: need at least 1 sugar in reserves.
      const hasStockpile = !sugarSource && (this._game.resources?.get('sugar') ?? 0) > 0;
      if (!sugarSource && !hasStockpile) continue;

      const score = this._fairScore(ant, go, 'restock', now);
      if (score < bestScore) {
        best = { kind: 'restock', target: go, source: sugarSource ?? null };
        bestScore = score;
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
    if (c.kind === 'egg') {
      return !!c.target.getComponent(EggPickup);
    }
    if (c.kind === 'restock') {
      const ft = c.target.getComponent(FeedingTray);
      return !!ft && ft.needsSugar();
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
    for (const go of this._farmPlots) {
      const fp = go.getComponent(FarmPlot);
      if (fp && fp.isReadyToHarvest()) return true;
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
  restockAvailable() {
    this._refreshCaches();
    for (const go of this._feedingTrays) {
      const ft = go.getComponent(FeedingTray);
      if (ft && ft.needsSugar()) return true;
    }
    return false;
  }
  eggAvailable() {
    this._refreshCaches();
    if (this._looseEggs.length === 0) return false;
    for (const go of this._trainingHuts) {
      const th = go.getComponent(TrainingHut);
      if (th && th.hasPendingRequest()) return true;
    }
    return false;
  }

  // Number of loose eggs not yet claimed for delivery.
  availableEggs() {
    this._refreshCaches();
    const claimed = new Set();
    for (const c of this._claims.values()) {
      if (c.kind === 'egg') claimed.add(c.target);
    }
    let count = 0;
    for (const go of this._looseEggs) {
      if (!claimed.has(go)) count++;
    }
    return count;
  }

  // Total eggs across all states (field + in-transit).
  // Queen reads this before laying to enforce the global cap.
  totalEggs() {
    this._refreshCaches();
    const fieldEggs = this._looseEggs.length;
    let inTransit = 0;
    for (const c of this._claims.values()) {
      if (c.kind === 'egg') inTransit++;
    }
    return fieldEggs + inTransit;
  }
  eggCapReached() { return this.totalEggs() >= EGG_CAP; }

  // Workers self-register so we can preempt them without circular imports.
  registerWorker(worker)   { this._workers.add(worker); }
  unregisterWorker(worker) { this._workers.delete(worker); }

  // Signal all workers to re-evaluate. Called when a player-driven task is
  // queued (e.g. training request) so workers don't have to finish their
  // current ambient cycle before noticing the new high-priority work.
  preemptWorkers() {
    for (const w of this._workers) w.preempt();
  }

  _refreshCaches() {
    if (!this._dirty) return;
    this._resourceNodes = [];
    this._farmPlots     = [];
    this._looseEggs     = [];
    this._trainingHuts  = [];
    this._feedingTrays  = [];
    for (const go of this._game.gameObjects) {
      if (go.getComponent(ResourceNode)) this._resourceNodes.push(go);
      if (go.getComponent(FarmPlot))     this._farmPlots.push(go);
      if (go.getComponent(EggPickup))    this._looseEggs.push(go);
      if (go.getComponent(TrainingHut))  this._trainingHuts.push(go);
      if (go.getComponent(FeedingTray))  this._feedingTrays.push(go);
    }
    this._dirty = false;
  }

  // Weighted score: distance² discounted by how long the task has been waiting.
  // Player-requested kinds (egg) get an extra divisor so they reliably win.
  _fairScore(ant, target, kind, now) {
    const d2 = this._dist2(ant, target);
    const kinds = this._eligibleSince.get(target);
    const since = kinds?.get(kind) ?? now;
    const age = now - since;
    let score = d2 / (1 + age * FAIRNESS_K);
    if (kind === 'egg') score /= PLAYER_TASK_BOOST;
    return score;
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

    for (const go of this._looseEggs) {
      mark(go, 'egg');
    }

    for (const go of this._feedingTrays) {
      const ft = go.getComponent(FeedingTray);
      if (ft && ft.needsSugar()) mark(go, 'restock');
      else clear(go, 'restock');
    }

    // Prune entries for removed gameObjects.
    for (const go of this._eligibleSince.keys()) {
      if (!this._game.gameObjects.includes(go)) this._eligibleSince.delete(go);
    }
  }

  _nearestTrainingHut(from) {
    let best = null, bestD = Infinity;
    for (const go of this._trainingHuts) {
      const th = go.getComponent(TrainingHut);
      if (!th || !th.hasPendingRequest()) continue;
      const d = this._dist2(from, go);
      if (d < bestD) { best = go; bestD = d; }
    }
    return best;
  }

  _dist2(ant, target) {
    const dx = target.position.x - ant.position.x;
    const dz = target.position.z - ant.position.z;
    return dx * dx + dz * dz;
  }
}

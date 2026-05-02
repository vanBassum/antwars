import { Component } from '../../engine/gameobject.js';
import { GOAPAgent } from '../../engine/ai/goap/goap_agent.js';
import { Mover } from '../../engine/components/mover.js';
import { GoToAction } from '../../engine/ai/goap/actions/go_to_action.js';
import { smoothPath } from '../../engine/hex/smooth_path.js';
import { cloneModel } from '../../engine/model_cache.js';

import { ResourceNode } from './resource_node.js';
import { HarvestTask } from './harvest_task.js';
import { FarmPlot } from './farm_plot.js';
import { TendTask } from './tend_task.js';
import { SeedTask } from './seed_task.js';

import { buildHarvestActions, HARVEST_GOAL } from '../cycles/harvest_cycle.js';
import { buildTendActions,    TEND_GOAL    } from '../cycles/tend_cycle.js';
import { buildSeedActions,    SEED_GOAL    } from '../cycles/seed_cycle.js';

const WANDER_RADIUS = 3;

// Models the ant can visibly carry. Each entry:
//   url      — model to clone
//   baseX    — X rotation applied first (used to lay the branch flat)
//   tiltMax  — max ± tilt around Z (radians); a small per-pickup random
//   heading  — Y-rotation range (radians); 2π = pointing any horizontal way
//   offsetZ  — local-Z shift applied to the model; negative = toward the back
const CARRY_CONFIGS = {
  sugar: { url: 'assets/models/SugarBlob.glb',    baseX: 0,           tiltMax: 0.3, heading: Math.PI * 2, offsetZ:  0    },
  wood:  { url: 'assets/models/Branch.glb',       baseX: Math.PI / 2, tiltMax: 0.4, heading: Math.PI * 2, offsetZ: -0.35 },
  water: { url: 'assets/models/WaterDroplet.glb', baseX: 0,           tiltMax: 0.2, heading: Math.PI * 2, offsetZ:  0    },
  seed:  { url: 'assets/models/Seed.glb',         baseX: Math.PI / 2, tiltMax: 0.2, heading: 0,           offsetZ: -0.35 },
};

// Worker composes three GOAP cycles (harvest / tend / seed) plus a shared
// "GoToHive" travel action. The cycle modules own their action shapes;
// this component owns dispatch, claim management, idle wander, and
// per-pickup carry visuals.
//
//   Harvest: GoToHarvest → Collect → GoToHive (shared) → Deposit
//   Tend:    GoToHive (shared) → TakeWater → GoToFarmForWater → Water
//   Seed:    GoToHive (shared) → TakeSeed  → GoToFarmForSeed  → DropSeed
export class Worker extends Component {
  start() {
    const game       = this.gameObject.game;
    const findByName = (name) => game.gameObjects.find(g => g.name === name);
    const hiveGO     = () => findByName('Ant Hill');

    this._wm      = game.workManager;
    this._harvest = new HarvestTask();
    this._tend    = new TendTask();
    this._seed    = new SeedTask();
    this._blob    = null;
    this._wanderTimer = null;

    const setCarrying = (type) => this._setCarrying(type);
    // Any failure mid-cycle: clear everything cleanly and re-pick. This is
    // what prevents stuck ants — without it the planner would re-plan the
    // same dead target on the next tick.
    const onCycleFail = () => this._abandonCycle();
    const creditDeposit = (type, amount) => game.resources?.add(type, amount);

    // Shared travel: GoToHive — open precondition so all three cycles can
    // pull it into their plan whenever they need atHive=true.
    const goToHive = new GoToAction('GoToHive', hiveGO,
      { atHive: false },
      { atHive: true, atResource: false, atFarm: false },
      onCycleFail);

    const actions = [
      goToHive,
      ...buildHarvestActions({ task: this._harvest, setCarrying, onCycleFail, creditDeposit }),
      ...buildTendActions   ({ task: this._tend,    setCarrying, onCycleFail }),
      ...buildSeedActions   ({ task: this._seed,    setCarrying, onCycleFail }),
    ];

    const agent = this.gameObject.getComponent(GOAPAgent);
    agent.actions    = actions;
    agent.worldState = {
      hasResource: false, hasWater: false, hasSeed: false,
      atResource: false, atHive: false, atFarm: false,
      delivered: false, tended: false, seeded: false,
      resourceAvailable: false, farmAvailable: false, seedAvailable: false,
    };
    agent.onGoalReached = () => {
      agent.worldState.delivered = false;
      agent.worldState.tended    = false;
      agent.worldState.seeded    = false;
      this._releaseClaim();
      this._pickNextCycle();
    };
    agent.onPlanFailed = () => {
      this._releaseClaim();
      this._pickNextCycle();
    };

    this._refreshAvailability();
    this._pickNextCycle();
  }

  // ── Cycle dispatch ──────────────────────────────────────────────────────
  _pickNextCycle() {
    const agent = this.gameObject.getComponent(GOAPAgent);
    if (!agent) return;

    // Already carrying a gathered resource → finish the delivery; no new
    // claim needed (and the harvest task still holds the type).
    if (agent.worldState.hasResource) {
      agent.goal = HARVEST_GOAL;
      return;
    }

    const claim = this._wm?.request(this.gameObject) ?? null;
    if (!claim) {
      this._harvest.clear();
      this._tend.clear();
      this._seed.clear();
      agent.goal = HARVEST_GOAL; // unreachable without resources — wander takes over
      return;
    }

    if (claim.kind === 'harvest') {
      this._harvest.target = claim.target;
      this._harvest.type   = claim.type;
      this._tend.clear();
      this._seed.clear();
      agent.goal = HARVEST_GOAL;
    } else if (claim.kind === 'tend') {
      this._tend.target = claim.target;
      this._harvest.clear();
      this._seed.clear();
      agent.goal = TEND_GOAL;
    } else { // seed
      this._seed.target = claim.target;
      this._harvest.clear();
      this._tend.clear();
      agent.goal = SEED_GOAL;
    }
  }

  _releaseClaim() {
    if (this._wm) this._wm.release(this.gameObject);
  }

  // Walk away from the current task cleanly. If we're carrying a gathered
  // resource (sugar/wood), don't waste it — the carry-shortcut in
  // _pickNextCycle will route us to the hive to deposit before anything
  // else. Logistical cargo (water/seed) is dropped: it's free to refetch.
  _abandonCycle() {
    const agent = this.gameObject.getComponent(GOAPAgent);
    if (!agent) return;
    this._releaseClaim();
    // The harvest source is gone, but if we already have its product the
    // Deposit step still needs harvest.type to credit the right resource.
    this._harvest.target = null;
    if (!agent.worldState.hasResource) this._harvest.type = null;
    this._tend.clear();
    this._seed.clear();
    if (!agent.worldState.hasResource) {
      agent.worldState.hasWater = false;
      agent.worldState.hasSeed  = false;
      this._setCarrying(null);
    }
    agent.invalidate();
    this._pickNextCycle();
  }

  // ── Per-frame ──────────────────────────────────────────────────────────
  _refreshAvailability() {
    const agent = this.gameObject.getComponent(GOAPAgent);
    if (!agent) return;
    const game = this.gameObject.game;

    agent.worldState.resourceAvailable = game.gameObjects.some(g => g.getComponent(ResourceNode));
    agent.worldState.farmAvailable     = game.gameObjects.some(g => {
      const fp = g.getComponent(FarmPlot);
      return fp && fp.needsAttention();
    });
    agent.worldState.seedAvailable     = game.gameObjects.some(g => {
      const fp = g.getComponent(FarmPlot);
      return fp && fp.needsSeed();
    });
  }

  update(dt) {
    this._refreshAvailability();

    const agent = this.gameObject.getComponent(GOAPAgent);
    if (!agent) return;

    // Per-task validity sweep. If our active task target became unworkable
    // (resource depleted by another ant, farm watered/seeded already, target
    // entity removed), abandon the cycle. _abandonCycle honors the carry
    // state — if we're holding a gathered resource, we'll still go deposit
    // it before going idle.
    if ((this._harvest.hasTarget() && !this._harvest.isStillValid()) ||
        (this._tend.hasTarget()    && !this._tend.isStillValid())    ||
        (this._seed.hasTarget()    && !this._seed.isStillValid())) {
      this._abandonCycle();
    }

    // Idle wander when GOAP has nothing to execute.
    if (agent._currentAction) { this._wanderTimer = null; return; }
    const mover = this.gameObject.getComponent(Mover);
    if (!mover.arrived) return;
    if (this._wanderTimer === null) this._wanderTimer = 1.5 + Math.random() * 1.5;
    this._wanderTimer -= dt;
    if (this._wanderTimer <= 0) {
      this._pickWanderTarget();
      this._wanderTimer = null;
    }
  }

  destroy() {
    this._releaseClaim();
  }

  // ── Hooks for other systems ────────────────────────────────────────────
  // Consumed by DebugOverlay when debug mode is on.
  getDebugInfo() {
    const agent = this.gameObject.getComponent(GOAPAgent);
    const ws    = agent?.worldState ?? {};
    const task  = agent?.currentActionName ?? 'idle';

    let target = '—';
    if (this._harvest.target)      target = this._harvest.target.name ?? 'resource';
    else if (this._tend.target)    target = this._tend.target.name    ?? 'farm';
    else if (this._seed.target)    target = this._seed.target.name    ?? 'farm';

    let carrying = 'empty';
    if (ws.hasResource && this._harvest.type) carrying = this._harvest.type;
    else if (ws.hasWater)                     carrying = 'water';
    else if (ws.hasSeed)                      carrying = 'seed';

    return { task, target, carrying };
  }

  // ── Internals ──────────────────────────────────────────────────────────
  _pickWanderTarget() {
    const game = this.gameObject.game;
    const grid = game.hexGrid;
    if (!grid) return;
    const hive = game.gameObjects.find(g => g.name === 'Ant Hill');
    if (!hive) return;

    const hiveHex = grid.worldToHex(hive.position.x, hive.position.z);
    const candidates = [];
    for (let q = hiveHex.q - WANDER_RADIUS; q <= hiveHex.q + WANDER_RADIUS; q++) {
      for (let r = hiveHex.r - WANDER_RADIUS; r <= hiveHex.r + WANDER_RADIUS; r++) {
        if (grid.hexDistance(q, r, hiveHex.q, hiveHex.r) > WANDER_RADIUS) continue;
        if (!grid.isWalkable(q, r)) continue;
        candidates.push({ q, r });
      }
    }
    if (candidates.length === 0) return;

    const target = candidates[Math.floor(Math.random() * candidates.length)];
    const ant    = this.gameObject;
    const from   = grid.worldToHex(ant.position.x, ant.position.z);
    const path   = grid.findPath(from.q, from.r, target.q, target.r);
    if (!path || path.length < 2) return;

    ant.getComponent(Mover).moveAlong(smoothPath(grid, ant.position, path));
  }

  _setCarrying(type) {
    if (this._blob) {
      this.gameObject.object3D.remove(this._blob);
      this._blob = null;
    }
    if (!type) return;
    const cfg = CARRY_CONFIGS[type];
    if (!cfg) return;
    let blob;
    try { blob = cloneModel(cfg.url); } catch { return; } // model not loaded — silently skip
    blob.scale.setScalar(0.25);
    blob.position.set(0, 0.3, cfg.offsetZ ?? 0);
    blob.rotation.set(
      cfg.baseX,
      Math.random() * cfg.heading,
      (Math.random() - 0.5) * 2 * cfg.tiltMax,
    );
    this.gameObject.object3D.add(blob);
    this._blob = blob;
  }
}

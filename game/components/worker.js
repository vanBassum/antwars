import { Component } from '../../engine/gameobject.js';
import { GOAPAgent } from '../../engine/ai/goap/goap_agent.js';
import { Mover } from '../../engine/components/mover.js';
import { GoToAction } from '../../engine/ai/goap/actions/go_to_action.js';
import { smoothPath } from '../../engine/hex/smooth_path.js';
import { cloneModel } from '../../engine/model_cache.js';

import { HarvestTask } from './harvest_task.js';
import { TendTask } from './tend_task.js';
import { SeedTask } from './seed_task.js';
import { DeliverEggTask } from './deliver_egg_task.js';
import { DeliverSugarTask } from './deliver_sugar_task.js';
import { DeliverMaterialTask } from './deliver_material_task.js';

import { buildHarvestActions, HARVEST_GOAL } from '../cycles/harvest_cycle.js';
import { buildTendActions,    TEND_GOAL    } from '../cycles/tend_cycle.js';
import { buildSeedActions,    SEED_GOAL    } from '../cycles/seed_cycle.js';
import { buildDeliverEggActions, DELIVER_EGG_GOAL } from '../cycles/deliver_egg_cycle.js';
import { buildRestockActions, RESTOCK_GOAL } from '../cycles/restock_cycle.js';
import { buildConstructActions, CONSTRUCT_GOAL } from '../cycles/deliver_material_cycle.js';

const WANDER_RADIUS = 3;

// No action can produce this effect, so the planner always fails when this is
// the goal. That triggers onPlanFailed → 5-second retry timer, which keeps
// idle ants off the enter-fail busy-loop and lets the wander logic run.
const IDLE_GOAL = Object.freeze({ __idle: true });

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
  egg:   { url: 'assets/models/Egg.glb',          baseX: 0,           tiltMax: 0.2, heading: Math.PI * 2, offsetZ:  0    },
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
    this._egg       = new DeliverEggTask();
    this._restock   = new DeliverSugarTask();
    this._construct = new DeliverMaterialTask();
    this._blob      = null;
    this._wanderTimer = null;

    // Per-ant lateral path offset — picked once, in a small ring around
    // the path centerline. Two ants on the same path won't overlap
    // visually because each follows its own offset track.
    const mover = this.gameObject.getComponent(Mover);
    if (mover) {
      const ang = Math.random() * Math.PI * 2;
      const r   = 0.10 + Math.random() * 0.10;
      mover.pathOffsetX = Math.cos(ang) * r;
      mover.pathOffsetZ = Math.sin(ang) * r;
    }

    const setCarrying = (type) => this._setCarrying(type);
    // Any failure mid-cycle: clear everything cleanly and re-pick. This is
    // what prevents stuck ants — without it the planner would re-plan the
    // same dead target on the next tick.
    const onCycleFail = () => this._abandonCycle();
    const creditDeposit = (type, amount) => game.resources?.add(type, amount);

    // Shared travel: GoToHive — open precondition so any cycle can pull it
    // into the plan whenever location:'hive' is needed. Single-field location
    // means "I'm at the hive" automatically excludes "I'm at the farm" etc.,
    // so we never lose track and the planner can't be tricked by a stale
    // co-existing flag.
    const goToHive = new GoToAction('GoToHive', hiveGO,
      {},
      { location: 'hive' },
      onCycleFail);

    const actions = [
      goToHive,
      ...buildHarvestActions({ task: this._harvest, setCarrying, onCycleFail, creditDeposit }),
      ...buildTendActions   ({ task: this._tend,    setCarrying, onCycleFail }),
      ...buildSeedActions   ({ task: this._seed,    setCarrying, onCycleFail }),
      ...buildDeliverEggActions({ task: this._egg,  setCarrying, onCycleFail }),
      ...buildRestockActions({ task: this._restock, game, hiveGO, setCarrying, onCycleFail }),
      ...buildConstructActions({ task: this._construct, game, setCarrying, onCycleFail }),
    ];

    const agent = this.gameObject.getComponent(GOAPAgent);
    agent.actions    = actions;
    agent.worldState = {
      // Single carry slot — null or one of:
      //   'resource'      — harvested sugar/wood (visual type lives on _harvest.type)
      //   'water'         — fetched from hive for tend cycle
      //   'seed'          — fetched from hive for seed cycle
      //   'egg'           — picked up off the ground for delivery to a training hut
      //   'restock-sugar' — sugar bound for a feeding tray (distinct from harvest sugar)
      //   'material'      — wood from stockpile bound for a construction site
      // Mutually exclusive by construction.
      carrying: null,
      // Where the worker is — single enum, mutually exclusive by construction.
      // null until a GoToX completes.
      location: null,
      // Per-cycle goal markers, reset in onGoalReached.
      delivered: false, tended: false, seeded: false, eggDelivered: false, sugarDelivered: false, materialDelivered: false,
      // Availability flags refreshed each frame from WorkManager.
      resourceAvailable: false, farmAvailable: false, seedAvailable: false, eggAvailable: false,
      restockAvailable: false, constructAvailable: false,
    };
    agent.onGoalReached = () => {
      agent.worldState.delivered    = false;
      agent.worldState.tended       = false;
      agent.worldState.seeded       = false;
      agent.worldState.eggDelivered     = false;
      agent.worldState.sugarDelivered   = false;
      agent.worldState.materialDelivered = false;
      this._releaseClaim();
      this._pickNextCycle();
    };
    agent.onPlanFailed = () => {
      this._releaseClaim();
      this._pickNextCycle();
    };

    this._wm.registerWorker(this);
    this._refreshAvailability();
    this._pickNextCycle();
  }

  // ── Cycle dispatch ──────────────────────────────────────────────────────
  _pickNextCycle() {
    const agent = this.gameObject.getComponent(GOAPAgent);
    if (!agent) return;

    // Refresh availability flags before picking + planning so the worldState
    // the planner sees on its next tick reflects what just changed (e.g. a
    // ConstructionSite that was placed this very tick must show up in
    // constructAvailable, otherwise the first plan attempt fails because
    // TakeMaterial's precondition isn't met and we eat a 2s retry timer).
    this._refreshAvailability();

    // Already carrying a gathered resource → finish the delivery; no new
    // claim needed (and the harvest task still holds the type).
    if (agent.worldState.carrying === 'resource') {
      agent.goal = HARVEST_GOAL;
      return;
    }

    const claim = this._wm?.request(this.gameObject) ?? null;
    if (!claim) {
      this._harvest.clear();
      this._tend.clear();
      this._seed.clear();
      this._egg.clear();
      this._restock.clear();
      this._construct.clear();
      agent.goal = IDLE_GOAL;
      return;
    }

    if (claim.kind === 'harvest') {
      this._harvest.target = claim.target;
      this._harvest.type   = claim.type;
      this._tend.clear();
      this._seed.clear();
      this._egg.clear();
      this._restock.clear();
      this._construct.clear();
      agent.goal = HARVEST_GOAL;
    } else if (claim.kind === 'tend') {
      this._tend.target = claim.target;
      this._harvest.clear();
      this._seed.clear();
      this._egg.clear();
      this._restock.clear();
      this._construct.clear();
      agent.goal = TEND_GOAL;
    } else if (claim.kind === 'egg') {
      this._egg.egg         = claim.target;
      this._egg.trainingHut = claim.trainingHut;
      this._harvest.clear();
      this._tend.clear();
      this._seed.clear();
      this._restock.clear();
      this._construct.clear();
      agent.goal = DELIVER_EGG_GOAL;
    } else if (claim.kind === 'restock') {
      this._restock.tray   = claim.target;
      this._restock.source = claim.source;
      this._restock._useStockpile = !claim.source;
      this._harvest.clear();
      this._tend.clear();
      this._seed.clear();
      this._egg.clear();
      this._construct.clear();
      agent.goal = RESTOCK_GOAL;
    } else if (claim.kind === 'construct') {
      this._construct.site         = claim.target;
      this._construct.materialType = claim.materialType;
      this._harvest.clear();
      this._tend.clear();
      this._seed.clear();
      this._egg.clear();
      this._restock.clear();
      agent.goal = CONSTRUCT_GOAL;
    } else { // seed
      this._seed.target = claim.target;
      this._harvest.clear();
      this._tend.clear();
      this._egg.clear();
      this._restock.clear();
      this._construct.clear();
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
    const carryingResource = agent.worldState.carrying === 'resource';
    if (!carryingResource) this._harvest.type = null;
    this._tend.clear();
    this._seed.clear();
    this._egg.clear();
    this._restock.clear();
    this._construct.clear();
    if (!carryingResource) {
      agent.worldState.carrying = null;
      this._setCarrying(null);
    }
    // Interrupting mid-GoTo means we walked away from the last labeled
    // location — null it so the next plan re-walks via a real GoTo instead
    // of letting (e.g.) TakeMaterial fire wherever we happen to stand.
    agent.worldState.location = null;
    agent.invalidate();
    this._pickNextCycle();
  }

  // ── Per-frame ──────────────────────────────────────────────────────────
  // Refresh the GOAP availability flags. We let WorkManager do the
  // heavy lifting — its cached by-component lists are dirty only when
  // entities are added/removed, so the per-frame cost is "filter a small
  // pre-built list" instead of "walk every gameObject in the scene".
  _refreshAvailability() {
    const agent = this.gameObject.getComponent(GOAPAgent);
    if (!agent || !this._wm) return;

    agent.worldState.resourceAvailable = this._wm.resourceAvailable();
    agent.worldState.farmAvailable     = this._wm.farmAvailable();
    agent.worldState.seedAvailable     = this._wm.seedAvailable();
    agent.worldState.eggAvailable      = this._wm.eggAvailable();
    agent.worldState.restockAvailable  = this._wm.restockAvailable();
    agent.worldState.constructAvailable = this._wm.constructAvailable();
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
    if ((this._harvest.hasTarget()   && !this._harvest.isStillValid())   ||
        (this._tend.hasTarget()      && !this._tend.isStillValid())      ||
        (this._seed.hasTarget()      && !this._seed.isStillValid())      ||
        (this._egg.hasTarget()       && !this._egg.isStillValid())       ||
        (this._restock.hasTarget()   && !this._restock.isStillValid())   ||
        (this._construct.hasTarget() && !this._construct.isStillValid())) {
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

  // Called by WorkManager when a player-driven task is queued. If this
  // worker isn't carrying anything finite, abandon the current ambient
  // cycle and re-request so the priority task can win.
  preempt() {
    const agent = this.gameObject.getComponent(GOAPAgent);
    if (!agent) return;
    // Don't drop carries that came from a finite source — abandoning
    // would lose the unit (gathered resources, sugar pulled from stockpile
    // for restock, wood pulled from stockpile for construction). Let the
    // current trip finish; the worker will re-evaluate at the cycle boundary.
    const c = agent.worldState.carrying;
    if (c === 'resource' || c === 'restock-sugar' || c === 'material') return;
    // Don't interrupt if already on an egg delivery.
    if (this._egg.hasTarget()) return;
    this._abandonCycle();
  }

  destroy() {
    this._releaseClaim();
    this._wm?.unregisterWorker(this);
  }

  // ── Hooks for other systems ────────────────────────────────────────────
  // Consumed by DebugOverlay when debug mode is on.
  getDebugInfo() {
    const agent = this.gameObject.getComponent(GOAPAgent);
    const ws    = agent?.worldState ?? {};
    const task  = agent?.currentActionName ?? 'idle';

    let target = '—';
    if (this._harvest.target)        target = this._harvest.target.name ?? 'resource';
    else if (this._tend.target)      target = this._tend.target.name    ?? 'farm';
    else if (this._seed.target)      target = this._seed.target.name    ?? 'farm';
    else if (this._egg.egg)          target = 'egg → training hut';
    else if (this._restock.tray)     target = 'sugar → feeding tray';
    else if (this._construct.site)   target = `${this._construct.materialType ?? 'material'} → ${this._construct.site.name ?? 'site'}`;

    let carrying = 'empty';
    switch (ws.carrying) {
      case 'resource':      carrying = this._harvest.type ?? 'resource'; break;
      case 'water':         carrying = 'water'; break;
      case 'seed':          carrying = 'seed'; break;
      case 'egg':           carrying = 'egg'; break;
      case 'restock-sugar': carrying = 'sugar (restock)'; break;
      case 'material':      carrying = `${this._construct.materialType ?? 'material'} (build)`; break;
    }

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
    // Wander bypasses GOAP, so any cached location in worldState is now
    // stale — null it so the next plan re-walks via a real GoTo action
    // instead of assuming we're still where we last successfully arrived.
    const agent = this.gameObject.getComponent(GOAPAgent);
    if (agent) agent.worldState.location = null;
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

import * as THREE from 'three';
import { Component } from '../../engine/gameobject.js';
import { GOAPAgent } from '../../engine/ai/goap/goap_agent.js';
import { Action } from '../../engine/ai/goap/action.js';
import { Mover } from '../../engine/components/mover.js';
import { cloneModel } from '../../engine/model_cache.js';
import { ResourceNode } from './resource_node.js';
import { HarvestTask } from './harvest_task.js';
import { FarmPlot } from './farm_plot.js';
import { TendTask } from './tend_task.js';

const SAMPLE_SPACING = 0.25;
const WANDER_RADIUS  = 3;

// Models the ant can visibly carry. Each entry:
//   url      — model to clone
//   baseX    — X rotation applied first (used to lay the branch flat)
//   tiltMax  — max ± tilt around Z (radians); a small per-pickup random
//   heading  — Y-rotation range (radians); 2π = pointing any horizontal way
const CARRY_CONFIGS = {
  sugar: { url: 'assets/models/SugarBlob.glb',    baseX: 0,           tiltMax: 0.3, heading: Math.PI * 2 },
  wood:  { url: 'assets/models/Branch.glb',       baseX: Math.PI / 2, tiltMax: 0.4, heading: Math.PI * 2 },
  water: { url: 'assets/models/WaterDroplet.glb', baseX: 0,           tiltMax: 0.2, heading: Math.PI * 2 },
};

// Build a Catmull-Rom-smoothed waypoint list along a hex path.
function smoothPath(grid, fromPos, hexPath, finalEdge = null) {
  const waypoints = hexPath.slice(1).map(h => grid.hexToWorld(h.q, h.r));
  if (finalEdge) {
    if (waypoints.length === 0) waypoints.push(finalEdge);
    else                         waypoints[waypoints.length - 1] = finalEdge;
  }
  const ctrl = [
    new THREE.Vector3(fromPos.x, 0, fromPos.z),
    ...waypoints.map(w => new THREE.Vector3(w.x, 0, w.z)),
  ];
  if (ctrl.length < 3) return waypoints;
  const curve   = new THREE.CatmullRomCurve3(ctrl, false, 'catmullrom', 0.5);
  const samples = Math.max(2, Math.round(curve.getLength() / SAMPLE_SPACING));
  return curve.getSpacedPoints(samples).slice(1).map(p => ({ x: p.x, z: p.z }));
}

class GoToAction extends Action {
  constructor(name, getTargetGO, preconditions, effects) {
    super(name);
    this._getTarget    = getTargetGO;
    this.preconditions = preconditions;
    this.effects       = effects;
  }
  enter(agent) {
    const target = this._getTarget();
    const mover  = agent.gameObject.getComponent(Mover);
    if (!target) { mover.arrived = true; return; }

    const grid = agent.gameObject.game.hexGrid;
    if (!grid) { mover.moveTo(target.object3D.position); return; }

    const ant  = agent.gameObject;
    const from = grid.worldToHex(ant.position.x, ant.position.z);
    const to   = grid.worldToHex(target.object3D.position.x, target.object3D.position.z);

    let goal, edgeOverride = null;
    if (grid.getEntrance(to.q, to.r)) {
      goal = to;
    } else {
      const approach = grid.findApproachHex(to.q, to.r, from.q, from.r);
      if (!approach) { mover.arrived = true; return; }
      goal = approach;
      const tWP = grid.hexToWorld(to.q, to.r);
      const aWP = grid.hexToWorld(approach.q, approach.r);
      edgeOverride = { x: (aWP.x + tWP.x) / 2, z: (aWP.z + tWP.z) / 2 };
    }

    const path = grid.findPath(from.q, from.r, goal.q, goal.r);
    if (!path) { mover.arrived = true; return; }
    mover.moveAlong(smoothPath(grid, ant.position, path, edgeOverride));
  }
  perform(agent, _dt) {
    return agent.gameObject.getComponent(Mover).arrived;
  }
}

class WaitAction extends Action {
  constructor(name, duration, preconditions, effects, onDone) {
    super(name);
    this._duration     = duration;
    this.preconditions = preconditions;
    this.effects       = effects;
    this._onDone       = onDone;
  }
  enter(_agent) { this._t = 0; }
  perform(_agent, dt) {
    this._t += dt;
    if (this._t >= this._duration) {
      this._onDone?.();
      return true;
    }
    return false;
  }
}

// Wobble + harvestTask.take(). Calls onFailure (and invalidates) if the
// node is gone or empty.
class CollectResourceAction extends Action {
  constructor(task, onSuccess, onFailure, preconditions, effects) {
    super('Collect');
    this._task         = task;
    this._onSuccess    = onSuccess;
    this._onFailure    = onFailure;
    this._duration     = 0.6;
    this.preconditions = preconditions;
    this.effects       = effects;
  }
  enter(_agent) { this._t = 0; }
  perform(agent, dt) {
    this._t += dt;
    const p = Math.min(1, this._t / this._duration);

    const decay = Math.exp(-p * 4);
    const wave  = Math.sin(p * Math.PI * 2 * 4);
    const amp   = 0.3 * decay;
    agent.gameObject.object3D.scale.set(
      1 - amp * wave * 0.5,
      1 + amp * wave,
      1 - amp * wave * 0.5,
    );

    if (this._t >= this._duration) {
      if (this._task.take() === 0) {
        this._onFailure?.();
        agent.invalidate();
        return false;
      }
      this._onSuccess?.();
      return true;
    }
    return false;
  }
  exit(agent) {
    agent.gameObject.object3D.scale.set(1, 1, 1);
  }
}

// Apply water to the picked farm. Calls onFailure (and invalidates) if the
// farm no longer needs attention.
class WaterFarmAction extends Action {
  constructor(task, onSuccess, onFailure, preconditions, effects) {
    super('Water');
    this._task         = task;
    this._onSuccess    = onSuccess;
    this._onFailure    = onFailure;
    this._duration     = 0.4;
    this.preconditions = preconditions;
    this.effects       = effects;
  }
  enter(_agent) { this._t = 0; }
  perform(agent, dt) {
    this._t += dt;
    if (this._t >= this._duration) {
      if (!this._task.water()) {
        this._onFailure?.();
        agent.worldState.atFarm = false;
        agent.invalidate();
        return false;
      }
      this._onSuccess?.();
      return true;
    }
    return false;
  }
}

// Cycles between two kinds of work. Tasks are dispatched by the central
// WorkManager (game.workManager): on each cycle boundary the worker
// requests a fresh claim and routes it to either the harvest or tend
// data slot, then GOAP plans toward the matching goal.
//   Harvest:  GoToHarvest → Collect → GoToHive → Deposit
//   Tend:     GoToHive → TakeWater → GoToFarm → Water
export class Worker extends Component {
  start() {
    const game       = this.gameObject.game;
    const findByName = (name) => game.gameObjects.find(g => g.name === name);
    const hiveGO     = () => findByName('Ant Hill');

    this._wm      = game.workManager;
    this._harvest = new HarvestTask();
    this._tend    = new TendTask();
    this._blob    = null;
    this._wanderTimer = null;

    const setCarrying = (type) => this._setCarrying(type);
    const onCycleFail = () => this._releaseClaim();

    const actions = [
      // Harvest cycle
      new GoToAction('GoToHarvest', () => this._harvest.target,
        { hasResource: false, atResource: false, resourceAvailable: true },
        { atResource: true,   atHive: false, atFarm: false }),
      new CollectResourceAction(this._harvest,
        () => setCarrying(this._harvest.type),
        onCycleFail,
        { atResource: true, hasResource: false, resourceAvailable: true },
        { hasResource: true }),
      // Shared travel: GoToHive — open precondition so both cycles can use it
      new GoToAction('GoToHive', hiveGO,
        { atHive: false },
        { atHive: true, atResource: false, atFarm: false }),
      new WaitAction('Deposit', 0.3,
        { atHive: true, hasResource: true },
        { hasResource: false, delivered: true },
        () => {
          if (this._harvest.type) game.resources?.add(this._harvest.type, 1);
          setCarrying(null);
          this._harvest.clear();
        }),
      // Tend cycle
      new WaitAction('TakeWater', 0.2,
        { atHive: true, hasWater: false },
        { hasWater: true },
        () => setCarrying('water')),
      new GoToAction('GoToFarm', () => this._tend.target,
        { atFarm: false, hasWater: true, farmAvailable: true },
        { atFarm: true, atResource: false, atHive: false }),
      new WaterFarmAction(this._tend,
        () => { setCarrying(null); this._tend.clear(); },
        onCycleFail,
        { atFarm: true, hasWater: true, farmAvailable: true },
        { hasWater: false, tended: true }),
    ];

    const agent = this.gameObject.getComponent(GOAPAgent);
    agent.actions    = actions;
    agent.worldState = {
      hasResource: false, hasWater: false,
      atResource: false, atHive: false, atFarm: false,
      delivered: false, tended: false,
      resourceAvailable: false, farmAvailable: false,
    };
    agent.onGoalReached = () => {
      agent.worldState.delivered = false;
      agent.worldState.tended    = false;
      this._releaseClaim();   // cycle complete — free the slot for someone else
      this._pickNextCycle();
    };
    agent.onPlanFailed = () => {
      this._releaseClaim();
      this._pickNextCycle();
    };

    this._refreshAvailability();
    this._pickNextCycle();
  }

  // Pick a goal for the next cycle. Carry state biases first; otherwise we
  // ask the WorkManager for a claim and route it.
  _pickNextCycle() {
    const agent = this.gameObject.getComponent(GOAPAgent);
    if (!agent) return;

    // Already carrying a resource → finish that delivery, no new claim needed.
    if (agent.worldState.hasResource) {
      agent.goal = { delivered: true };
      return;
    }

    // Ask the WorkManager for the best available task.
    const claim = this._wm?.request(this.gameObject) ?? null;

    if (!claim) {
      // No work available. If we have leftover water and a farm exists,
      // we'd still want to use it — but lack of claim means no farm needs
      // attention. Fall through to unreachable goal so wander takes over.
      this._harvest.clear();
      this._tend.clear();
      agent.goal = { delivered: true };
      return;
    }

    if (claim.kind === 'harvest') {
      this._harvest.target = claim.target;
      this._harvest.type   = claim.type;
      this._tend.clear();
      agent.goal = { delivered: true };
    } else {
      this._tend.target = claim.target;
      this._harvest.clear();
      agent.goal = { tended: true };
    }
  }

  _releaseClaim() {
    if (this._wm) this._wm.release(this.gameObject);
  }

  _refreshAvailability() {
    const agent = this.gameObject.getComponent(GOAPAgent);
    if (!agent) return;
    const game = this.gameObject.game;

    const r = game.gameObjects.some(g => g.getComponent(ResourceNode));
    if (agent.worldState.resourceAvailable !== r) {
      agent.worldState.resourceAvailable = r;
      if (!r) agent.worldState.atResource = false;
    }
    const f = game.gameObjects.some(g => {
      const fp = g.getComponent(FarmPlot);
      return fp && fp.needsAttention();
    });
    if (agent.worldState.farmAvailable !== f) {
      agent.worldState.farmAvailable = f;
      if (!f) agent.worldState.atFarm = false;
    }
  }

  update(dt) {
    this._refreshAvailability();

    const agent = this.gameObject.getComponent(GOAPAgent);
    if (!agent) return;

    // If our claim was silently invalidated (e.g. another ant finished the
    // last unit, or the farm got watered before we arrived), drop it and
    // force a fresh pick so we don't loop.
    if (this._wm && this._wm.claimOf(this.gameObject) && !this._wm.isValid(this.gameObject)) {
      this._releaseClaim();
      this._harvest.clear();
      this._tend.clear();
      agent.invalidate();
      this._pickNextCycle();
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
    blob.position.y = 0.3;
    blob.rotation.set(
      cfg.baseX,
      Math.random() * cfg.heading,
      (Math.random() - 0.5) * 2 * cfg.tiltMax,
    );
    this.gameObject.object3D.add(blob);
    this._blob = blob;
  }
}

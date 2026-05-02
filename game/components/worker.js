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

// Models the ant can visibly carry. Missing entries → no visual (logical
// state still tracked).
const CARRY_MODELS = {
  sugar: 'assets/models/SugarBlob.glb',
  wood:  'assets/models/Branch.glb',
  water: 'assets/models/WaterDroplet.glb',
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
  constructor(name, getTargetGO, preconditions, effects, onEnter = null) {
    super(name);
    this._getTarget    = getTargetGO;
    this._onEnter      = onEnter;
    this.preconditions = preconditions;
    this.effects       = effects;
  }
  enter(agent) {
    this._onEnter?.(agent);
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

// Wobble + harvestTask.take(). Invalidates if take returns 0.
class CollectResourceAction extends Action {
  constructor(task, onSuccess, preconditions, effects) {
    super('Collect');
    this._task         = task;
    this._onSuccess    = onSuccess;
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
      if (this._task.take() === 0) { agent.invalidate(); return false; }
      this._onSuccess?.();
      return true;
    }
    return false;
  }
  exit(agent) {
    agent.gameObject.object3D.scale.set(1, 1, 1);
  }
}

// Apply water to the picked farm. If the farm no longer needs attention
// (gone or fully grown), invalidate the plan.
class WaterFarmAction extends Action {
  constructor(task, onSuccess, preconditions, effects) {
    super('Water');
    this._task         = task;
    this._onSuccess    = onSuccess;
    this._duration     = 0.4;
    this.preconditions = preconditions;
    this.effects       = effects;
  }
  enter(agent) {
    this._t = 0;
    // If we somehow lost our target between actions, re-pick on the spot.
    if (!this._task.hasTarget()) this._task.pick();
  }
  perform(agent, dt) {
    this._t += dt;
    if (this._t >= this._duration) {
      if (!this._task.water()) {
        this._task.clear();
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

// Cycles between two kinds of work, picking each cycle:
//   Harvest:  GoToHarvest → Collect → GoToHive → Deposit
//   Tend:     GoToHive → TakeWater → GoToFarm → Water
// Picking honors carry state — if the ant already has a resource it
// finishes delivery; if it has water and a farm needs it, it tends.
export class Worker extends Component {
  start() {
    const game       = this.gameObject.game;
    const findByName = (name) => game.gameObjects.find(g => g.name === name);
    const hiveGO     = () => findByName('Ant Hill');

    const harvest = new HarvestTask(this.gameObject);
    const tend    = new TendTask(this.gameObject);
    this._harvest = harvest;
    this._tend    = tend;
    this._blob    = null;
    this._wanderTimer = null;

    const setCarrying = (type) => this._setCarrying(type);

    const actions = [
      // Harvest cycle
      new GoToAction('GoToHarvest', () => harvest.target,
        { hasResource: false, atResource: false, resourceAvailable: true },
        { atResource: true,   atHive: false, atFarm: false },
        () => harvest.pick()),
      new CollectResourceAction(harvest, () => setCarrying(harvest.type),
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
          if (harvest.type) game.resources?.add(harvest.type, 1);
          setCarrying(null);
          harvest.clear();
        }),
      // Tend cycle
      new WaitAction('TakeWater', 0.2,
        { atHive: true, hasWater: false },
        { hasWater: true },
        () => setCarrying('water')),
      new GoToAction('GoToFarm', () => tend.target,
        { atFarm: false, hasWater: true, farmAvailable: true },
        { atFarm: true, atResource: false, atHive: false },
        () => tend.pick()),
      new WaterFarmAction(tend, () => { setCarrying(null); tend.clear(); },
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
      this._pickNextCycle();
    };
    agent.onPlanFailed = () => this._pickNextCycle();

    // Initial state + cycle so the first plan can succeed without a 2s wait.
    this._refreshAvailability();
    this._pickNextCycle();
  }

  // Sets agent.goal based on what's actually doable, biased by what the ant
  // is already carrying.
  _pickNextCycle() {
    const agent = this.gameObject.getComponent(GOAPAgent);
    if (!agent) return;

    // Carrying a resource → finish that delivery first.
    if (agent.worldState.hasResource) {
      agent.goal = { delivered: true };
      return;
    }

    const game = this.gameObject.game;
    const harvestable = game.gameObjects.some(g => g.getComponent(ResourceNode));
    const tendable    = game.gameObjects.some(g => {
      const fp = g.getComponent(FarmPlot);
      return fp && fp.needsAttention();
    });

    // Carrying water + a farm needs it → use it.
    if (agent.worldState.hasWater && tendable) {
      agent.goal = { tended: true };
      return;
    }

    const choices = [];
    if (harvestable) choices.push('harvest');
    if (tendable)    choices.push('tend');
    if (choices.length === 0) {
      // Nothing to do — set a goal we won't satisfy so onPlanFailed fires
      // and wander takes over.
      agent.goal = { delivered: true };
      return;
    }
    const choice = choices[Math.floor(Math.random() * choices.length)];
    agent.goal = choice === 'harvest' ? { delivered: true } : { tended: true };
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
    const url = CARRY_MODELS[type];
    if (!url) return;
    let blob;
    try { blob = cloneModel(url); } catch { return; } // model not loaded — silently skip
    blob.scale.setScalar(0.25);
    blob.position.y = 0.3;
    this.gameObject.object3D.add(blob);
    this._blob = blob;
  }
}

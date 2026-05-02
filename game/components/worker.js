import * as THREE from 'three';
import { Component } from '../../engine/gameobject.js';
import { GOAPAgent } from '../../engine/ai/goap/goap_agent.js';
import { Action } from '../../engine/ai/goap/action.js';
import { Mover } from '../../engine/components/mover.js';
import { cloneModel } from '../../engine/model_cache.js';
import { ResourceNode } from './resource_node.js';
import { HarvestTask } from './harvest_task.js';

// Average distance between adjacent samples along the smoothed curve.
// Smaller = smoother but more waypoints. ~0.25 m looks good at hex sizes ~1.5-2m.
const SAMPLE_SPACING = 0.25;
const SUGAR_BLOB_URL = 'assets/models/SugarBlob.glb';

// How far the ant will wander from the hive when idle (in hex tiles).
const WANDER_RADIUS = 3;

// Build a Catmull-Rom-smoothed waypoint list along a hex path. `fromPos` is
// the start (typically the ant's current world position). `finalEdge` optionally
// replaces the last waypoint — used when approaching a building so the ant
// stops at the shared edge instead of the hex center.
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

    // If the target has an entrance, the ant walks all the way inside (the
    // building's hex is the goal). Otherwise it stops on the approach hex
    // with an offset toward the building.
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

// Wobble + task.take(). If the task's node is gone or empty, invalidates the
// plan so no phantom resource is credited.
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

// Cycles forever (while at least one ResourceNode exists): pick a random
// resource type, walk to the closest node of that type, harvest, walk to
// the hive, deposit. Different ants pick different types each cycle, so they
// naturally split between sources.
export class Worker extends Component {
  start() {
    const game       = this.gameObject.game;
    const findByName = (name) => game.gameObjects.find(g => g.name === name);
    const hiveGO     = () => findByName('Ant Hill');

    const task = new HarvestTask(this.gameObject);
    this._blob        = null;
    this._wanderTimer = null;

    const actions = [
      new GoToAction('GoToHarvest', () => task.target,
        { hasResource: false, atResource: false, resourceAvailable: true },
        { atResource: true,   atHive: false },
        () => task.pick()),
      new CollectResourceAction(task, () => this._setCarrying(task.type),
        { atResource: true, hasResource: false, resourceAvailable: true },
        { hasResource: true }),
      new GoToAction('GoToHive', hiveGO,
        { hasResource: true, atHive: false },
        { atHive: true,      atResource: false }),
      new WaitAction('Deposit', 0.3,
        { atHive: true, hasResource: true },
        { hasResource: false, delivered: true },
        () => {
          if (task.type) game.resources?.add(task.type, 1);
          this._setCarrying(null);
          task.clear();
        }),
    ];

    const agent = this.gameObject.getComponent(GOAPAgent);
    agent.actions    = actions;
    agent.worldState = {
      hasResource: false, atResource: false, atHive: false, delivered: false,
      resourceAvailable: true,
    };
    agent.goal = { delivered: true };
    agent.onGoalReached = () => {
      agent.worldState.delivered = false;
      agent.invalidate();
    };
  }

  update(dt) {
    const agent = this.gameObject.getComponent(GOAPAgent);
    if (!agent) return;

    // Refresh resourceAvailable so the planner naturally idles when every
    // resource source is gone instead of cycling on phantom gathers.
    const exists = this.gameObject.game.gameObjects.some(g => g.getComponent(ResourceNode));
    if (agent.worldState.resourceAvailable !== exists) {
      agent.worldState.resourceAvailable = exists;
      if (!exists) agent.worldState.atResource = false;
    }

    // Idle wander: when GOAP has nothing to do, drift to random hexes near
    // the hive. Real GOAP work overrides automatically since it calls Mover.
    if (agent._currentAction) {
      this._wanderTimer = null;
      return;
    }
    const mover = this.gameObject.getComponent(Mover);
    if (!mover.arrived) return;
    if (this._wanderTimer === null) {
      this._wanderTimer = 1.5 + Math.random() * 1.5;
    }
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
    if (type === 'sugar') {
      const blob = cloneModel(SUGAR_BLOB_URL);
      blob.scale.setScalar(0.25);
      blob.position.y = 0.3;
      this.gameObject.object3D.add(blob);
      this._blob = blob;
    }
    // wood: no carry visual yet — would add a small log mesh later.
  }
}

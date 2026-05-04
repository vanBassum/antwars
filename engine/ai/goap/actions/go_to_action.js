import { Action } from '../action.js';
import { Component } from '../../../gameobject.js';
import { Mover } from '../../../components/mover.js';
import { smoothPath } from '../../../hex/smooth_path.js';

function bump(name, ms) {
  if (!Component.profileEnabled) return;
  let e = Component._profile.get(name);
  if (!e) Component._profile.set(name, e = { ms: 0, count: 0 });
  e.ms += ms; e.count += 1;
}

// Watchdog: if the ant hasn't moved meaningfully for this many seconds while
// the action is still "in progress", fail the trip so the planner re-picks.
// Catches failure modes where the trip looks set-up but no movement happens —
// path-smoother oddities, waypoints inside obstacles, mover stalls, etc.
const STUCK_THRESHOLD_SECONDS = 3.0;
const STUCK_DIST              = 0.1;
const STUCK_DIST2             = STUCK_DIST * STUCK_DIST;

// Generic "walk to a target gameObject" action.
//
// Constructor:
//   getTargetGO   — () → gameObject | null
//   preconditions — GOAP preconditions
//   effects       — GOAP effects (typically sets some `atX` flag)
//   onFailure?    — called when the trip can't be set up (no target / no
//                   walkable approach / no path) or when the watchdog fires.
//                   The action also flags itself failed so perform() never
//                   returns true on the trip — preventing GOAP from applying
//                   effects on a trip that didn't actually happen.
//
// If the target's hex has an `entrance` registered on the grid, the ant
// walks all the way to the target's hex center (e.g. into the hive).
// Otherwise it stops at the midpoint of the shared edge between the
// approach hex and the target hex.
export class GoToAction extends Action {
  constructor(name, getTargetGO, preconditions, effects, onFailure = null) {
    super(name);
    this._getTarget    = getTargetGO;
    this._onFailure    = onFailure;
    this.preconditions = preconditions;
    this.effects       = effects;
  }

  enter(agent) {
    this._failed = false;
    this._stuckT = 0;
    this._lastX  = agent.gameObject.position.x;
    this._lastZ  = agent.gameObject.position.z;
    this._unsubOccupancy = null;
    this._hexPathKeys    = null;
    let t0 = performance.now();
    const target = this._getTarget();
    bump('GOAP·enter·getTarget', performance.now() - t0);
    const mover  = agent.gameObject.getComponent(Mover);
    if (!target) { this._fail(agent, mover); return; }

    const grid = agent.gameObject.game.hexGrid;
    if (!grid) { mover.moveTo(target.object3D.position); return; }

    const ant  = agent.gameObject;
    const from = grid.worldToHex(ant.position.x, ant.position.z);
    const to   = grid.worldToHex(target.object3D.position.x, target.object3D.position.z);

    let goal, edgeOverride = null;
    if (grid.getEntrance(to.q, to.r)) {
      goal = to;
    } else {
      let t0 = performance.now();
      const approach = grid.findApproachHex(to.q, to.r, from.q, from.r);
      bump('GOAP·enter·approach', performance.now() - t0);
      if (!approach) { this._fail(agent, mover); return; }
      goal = approach;
      const tWP = grid.hexToWorld(to.q, to.r);
      const aWP = grid.hexToWorld(approach.q, approach.r);
      edgeOverride = { x: (aWP.x + tWP.x) / 2, z: (aWP.z + tWP.z) / 2 };
    }

    t0 = performance.now();
    const path = grid.findPath(from.q, from.r, goal.q, goal.r);
    bump('GOAP·enter·findPath', performance.now() - t0);
    if (!path) { this._fail(agent, mover); return; }

    t0 = performance.now();
    const waypoints = smoothPath(grid, ant.position, path, edgeOverride);
    bump('GOAP·enter·smooth', performance.now() - t0);

    // Already at the goal hex — happens when wander or a previous trip left
    // the ant in the destination cell while worldState still says she's
    // elsewhere. Succeed immediately so the effect (location update) gets
    // applied and the planner moves on, instead of looping on a no-op trip.
    if (!waypoints || waypoints.length === 0) {
      mover.arrived = true;
      return;
    }
    t0 = performance.now();
    mover.moveAlong(waypoints);
    bump('GOAP·enter·moveAlong', performance.now() - t0);

    // Track hex cells along this path so we can invalidate if one becomes blocked.
    t0 = performance.now();
    this._hexPathKeys = new Set(path.map(h => `${h.q},${h.r}`));
    this._unsubOccupancy = grid.onOccupancyChanged((q, r) => {
      if (this._hexPathKeys.has(`${q},${r}`)) {
        this._fail(agent, mover);
      }
    });
    bump('GOAP·enter·subscribe', performance.now() - t0);
  }

  perform(agent, dt) {
    if (this._failed) return false; // never let a failed action complete
    const mover = agent.gameObject.getComponent(Mover);
    if (mover.arrived) return true;

    // Watchdog: if no meaningful movement for STUCK_THRESHOLD_SECONDS, fail.
    const pos = agent.gameObject.position;
    const dx  = pos.x - this._lastX;
    const dz  = pos.z - this._lastZ;
    if (dx * dx + dz * dz > STUCK_DIST2) {
      this._lastX  = pos.x;
      this._lastZ  = pos.z;
      this._stuckT = 0;
    } else {
      this._stuckT += dt;
      if (this._stuckT > STUCK_THRESHOLD_SECONDS) {
        this._fail(agent, mover);
        return false;
      }
    }
    return false;
  }

  exit(_agent) {
    this._unsubOccupancy?.();
    this._unsubOccupancy = null;
    this._hexPathKeys    = null;
  }

  _fail(agent, mover) {
    this._failed = true;
    this._unsubOccupancy?.();
    this._unsubOccupancy = null;
    mover.arrived = true;
    const t0 = performance.now();
    this._onFailure?.();
    bump('GOAP·onFailure', performance.now() - t0);
    agent.invalidate();
  }
}

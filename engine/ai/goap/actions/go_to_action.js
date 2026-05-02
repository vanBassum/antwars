import { Action } from '../action.js';
import { Mover } from '../../../components/mover.js';
import { smoothPath } from '../../../hex/smooth_path.js';

// Generic "walk to a target gameObject" action.
//
// Constructor:
//   getTargetGO   — () → gameObject | null
//   preconditions — GOAP preconditions
//   effects       — GOAP effects (typically sets some `atX` flag)
//   onFailure?    — called when the trip can't be set up (no target / no
//                   walkable approach / no path). The action also flags
//                   itself failed so perform() never returns true on the
//                   trip — preventing GOAP from applying effects on a
//                   trip that didn't actually happen.
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
    const target = this._getTarget();
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
      const approach = grid.findApproachHex(to.q, to.r, from.q, from.r);
      if (!approach) { this._fail(agent, mover); return; }
      goal = approach;
      const tWP = grid.hexToWorld(to.q, to.r);
      const aWP = grid.hexToWorld(approach.q, approach.r);
      edgeOverride = { x: (aWP.x + tWP.x) / 2, z: (aWP.z + tWP.z) / 2 };
    }

    const path = grid.findPath(from.q, from.r, goal.q, goal.r);
    if (!path) { this._fail(agent, mover); return; }
    mover.moveAlong(smoothPath(grid, ant.position, path, edgeOverride));
  }

  perform(agent, _dt) {
    if (this._failed) return false; // never let a failed action complete
    return agent.gameObject.getComponent(Mover).arrived;
  }

  _fail(agent, mover) {
    this._failed = true;
    mover.arrived = true;
    this._onFailure?.();
    agent.invalidate();
  }
}

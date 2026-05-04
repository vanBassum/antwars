import { Action } from '../../engine/ai/goap/action.js';
import { GoToAction } from '../../engine/ai/goap/actions/go_to_action.js';

export const CONSTRUCT_GOAL = { materialDelivered: true };

const TAKE_DURATION = 0.3;
const DROP_DURATION = 0.3;

// Pull 1 unit of material from the player stockpile (worker is at the hive).
class TakeMaterialAction extends Action {
  constructor(task, game, onSuccess, onFailure) {
    super('TakeMaterial');
    this._task      = task;
    this._game      = game;
    this._onSuccess = onSuccess;
    this._onFailure = onFailure;
    this._duration  = TAKE_DURATION;
    this.preconditions = { location: 'hive', carrying: null, constructAvailable: true };
    this.effects       = { carrying: 'material' };
  }
  enter() { this._t = 0; }
  perform(agent, dt) {
    this._t += dt;
    if (this._t >= this._duration) {
      if (!this._task.takeMaterial(this._game)) {
        this._task.clear();
        this._onFailure?.();
        agent.invalidate();
        return false;
      }
      this._onSuccess?.();
      return true;
    }
    return false;
  }
}

// Drop 1 unit at the construction site.
class DepositMaterialAction extends Action {
  constructor(task, onSuccess, onFailure) {
    super('DepositMaterial');
    this._task      = task;
    this._onSuccess = onSuccess;
    this._onFailure = onFailure;
    this._duration  = DROP_DURATION;
    this.preconditions = { location: 'site', carrying: 'material' };
    this.effects       = { carrying: null, materialDelivered: true };
  }
  enter() { this._t = 0; }
  perform(agent, dt) {
    this._t += dt;
    if (this._t >= this._duration) {
      if (!this._task.dropOff()) {
        this._task.clear();
        this._onFailure?.();
        agent.worldState.location = null;
        agent.invalidate();
        return false;
      }
      this._onSuccess?.();
      return true;
    }
    return false;
  }
}

// Build the construction-delivery cycle. The shared GoToHive action (registered
// directly on the worker) satisfies the location:'hive' precondition.
//
//   GoToHive (shared) → TakeMaterial → GoToSite → DepositMaterial
export function buildConstructActions({ task, game, setCarrying, onCycleFail }) {
  return [
    new TakeMaterialAction(task, game,
      () => setCarrying(task.materialType ?? 'wood'),
      onCycleFail),
    new GoToAction('GoToSite', () => task.site,
      { carrying: 'material' },
      { location: 'site' },
      onCycleFail),
    new DepositMaterialAction(task,
      () => { setCarrying(null); task.clear(); },
      onCycleFail),
  ];
}

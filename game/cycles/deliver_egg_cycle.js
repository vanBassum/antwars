import { Action } from '../../engine/ai/goap/action.js';
import { GoToAction } from '../../engine/ai/goap/actions/go_to_action.js';
import { WaitAction } from '../../engine/ai/goap/actions/wait_action.js';

export const DELIVER_EGG_GOAL = { eggDelivered: true };

const PICKUP_DURATION = 0.4;
const DROP_DURATION   = 0.3;

// Pick up the egg from the ground — removes it from the world.
class PickupEggAction extends Action {
  constructor(task, onSuccess, onFailure) {
    super('PickupEgg');
    this._task      = task;
    this._onSuccess = onSuccess;
    this._onFailure = onFailure;
    this._duration  = PICKUP_DURATION;
    this.preconditions = { location: 'egg', hasEgg: false, eggAvailable: true };
    this.effects       = { hasEgg: true };
  }
  enter() { this._t = 0; }
  perform(agent, dt) {
    this._t += dt;
    if (this._t >= this._duration) {
      if (!this._task.pickUp()) {
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

// Deposit the egg at the training hut.
class DepositEggAction extends Action {
  constructor(task, onSuccess, onFailure) {
    super('DepositEgg');
    this._task      = task;
    this._onSuccess = onSuccess;
    this._onFailure = onFailure;
    this._duration  = DROP_DURATION;
    this.preconditions = { location: 'trainingHut', hasEgg: true };
    this.effects       = { hasEgg: false, eggDelivered: true };
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

// Build the egg-delivery cycle: GoToEgg → PickupEgg → GoToTrainingHut → DepositEgg.
export function buildDeliverEggActions({ task, setCarrying, onCycleFail }) {
  return [
    new GoToAction('GoToEgg', () => task.egg,
      { hasEgg: false, eggAvailable: true },
      { location: 'egg' },
      onCycleFail),
    new PickupEggAction(task,
      () => setCarrying('egg'),
      onCycleFail),
    new GoToAction('GoToTrainingHut', () => task.trainingHut,
      { hasEgg: true },
      { location: 'trainingHut' },
      onCycleFail),
    new DepositEggAction(task,
      () => { setCarrying(null); task.clear(); },
      onCycleFail),
  ];
}

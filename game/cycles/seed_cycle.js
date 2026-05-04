import { Action } from '../../engine/ai/goap/action.js';
import { GoToAction } from '../../engine/ai/goap/actions/go_to_action.js';
import { WaitAction } from '../../engine/ai/goap/actions/wait_action.js';

export const SEED_GOAL = { seeded: true };

const DROP_DURATION = 0.4;

// Hand a seed to the picked farm — flips it from AWAITING_SEED to GROWING.
// On failure (state changed), invalidate so we don't loop.
class DropSeedAction extends Action {
  constructor(task, onSuccess, onFailure) {
    super('DropSeed');
    this._task         = task;
    this._onSuccess    = onSuccess;
    this._onFailure    = onFailure;
    this._duration     = DROP_DURATION;
    this.preconditions = { location: 'farm', carrying: 'seed', seedAvailable: true };
    this.effects       = { carrying: null, seeded: true };
  }
  enter(_agent) { this._t = 0; }
  perform(agent, dt) {
    this._t += dt;
    if (this._t >= this._duration) {
      if (!this._task.deliver()) {
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

// Build the seed-delivery cycle: TakeSeed → GoToFarmForSeed → DropSeed.
// (GoToHive comes from the shared travel action.)
export function buildSeedActions({ task, setCarrying, onCycleFail }) {
  return [
    new WaitAction('TakeSeed', 0.2,
      { location: 'hive', carrying: null },
      { carrying: 'seed' },
      () => setCarrying('seed')),
    new GoToAction('GoToFarmForSeed', () => task.target,
      { carrying: 'seed', seedAvailable: true },
      { location: 'farm' },
      onCycleFail),
    new DropSeedAction(task,
      () => { setCarrying(null); task.clear(); },
      onCycleFail),
  ];
}

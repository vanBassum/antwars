import { Action } from '../../engine/ai/goap/action.js';
import { GoToAction } from '../../engine/ai/goap/actions/go_to_action.js';
import { WaitAction } from '../../engine/ai/goap/actions/wait_action.js';

export const TEND_GOAL = { tended: true };

const WATER_DURATION = 0.4;

// Apply water to the picked farm. On failure (gone or already watered),
// invalidate so we don't loop.
class WaterFarmAction extends Action {
  constructor(task, onSuccess, onFailure) {
    super('Water');
    this._task         = task;
    this._onSuccess    = onSuccess;
    this._onFailure    = onFailure;
    this._duration     = WATER_DURATION;
    this.preconditions = { location: 'farm', carrying: 'water', farmAvailable: true };
    this.effects       = { carrying: null, tended: true };
  }
  enter(_agent) { this._t = 0; }
  perform(agent, dt) {
    this._t += dt;
    if (this._t >= this._duration) {
      if (!this._task.water()) {
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

// Build the tend cycle: TakeWater (free, at hive) → GoToFarmForWater → Water.
// (GoToHive is the shared travel action; tend's TakeWater pre {location:'hive'}
// will pull GoToHive into the plan automatically when needed.)
export function buildTendActions({ task, setCarrying, onCycleFail }) {
  return [
    new WaitAction('TakeWater', 0.2,
      { location: 'hive', carrying: null },
      { carrying: 'water' },
      () => setCarrying('water')),
    new GoToAction('GoToFarmForWater', () => task.target,
      { carrying: 'water', farmAvailable: true },
      { location: 'farm' },
      onCycleFail),
    new WaterFarmAction(task,
      () => { setCarrying(null); task.clear(); },
      onCycleFail),
  ];
}

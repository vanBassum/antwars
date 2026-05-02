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
    this.preconditions = { atFarm: true, hasWater: true, farmAvailable: true };
    this.effects       = { hasWater: false, tended: true };
  }
  enter(_agent) { this._t = 0; }
  perform(agent, dt) {
    this._t += dt;
    if (this._t >= this._duration) {
      if (!this._task.water()) {
        this._task.clear();
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

// Build the tend cycle: TakeWater (free, at hive) → GoToFarmForWater → Water.
// (GoToHive is the shared travel action; tend's TakeWater pre {atHive: true}
// will pull GoToHive into the plan automatically when needed.)
export function buildTendActions({ task, setCarrying, onCycleFail }) {
  return [
    new WaitAction('TakeWater', 0.2,
      { atHive: true, hasWater: false },
      { hasWater: true },
      () => setCarrying('water')),
    new GoToAction('GoToFarmForWater', () => task.target,
      { atFarm: false, hasWater: true, farmAvailable: true },
      { atFarm: true, atResource: false, atHive: false },
      onCycleFail),
    new WaterFarmAction(task,
      () => { setCarrying(null); task.clear(); },
      onCycleFail),
  ];
}

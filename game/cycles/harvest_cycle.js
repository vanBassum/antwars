import { Action } from '../../engine/ai/goap/action.js';
import { GoToAction } from '../../engine/ai/goap/actions/go_to_action.js';
import { WaitAction } from '../../engine/ai/goap/actions/wait_action.js';

export const HARVEST_GOAL = { delivered: true };

const COLLECT_DURATION = 0.6;

// Wobble + harvestTask.take(). On take=0 calls onFailure (and invalidates)
// so the planner doesn't loop on a dead source.
class CollectResourceAction extends Action {
  constructor(task, onSuccess, onFailure) {
    super('Collect');
    this._task         = task;
    this._onSuccess    = onSuccess;
    this._onFailure    = onFailure;
    this._duration     = COLLECT_DURATION;
    this.preconditions = { location: 'resource', hasResource: false, resourceAvailable: true };
    this.effects       = { hasResource: true };
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
  exit(agent) {
    agent.gameObject.object3D.scale.set(1, 1, 1);
  }
}

// Build the harvest cycle's actions: GoToHarvest → Collect → Deposit.
// (GoToHive comes from the shared travel action — both delivery and tend
// cycles need it, so the worker registers one shared instance.)
//
// deps:
//   task         — HarvestTask instance
//   setCarrying  — (type | null) → void
//   onCycleFail  — () → void  (releases claim + re-pick)
//   creditDeposit — (type, amount) → void  (credits the player's resources)
export function buildHarvestActions({ task, setCarrying, onCycleFail, creditDeposit }) {
  return [
    new GoToAction('GoToHarvest', () => task.target,
      { hasResource: false, resourceAvailable: true },
      { location: 'resource' },
      onCycleFail),
    new CollectResourceAction(task,
      () => setCarrying(task.type),
      onCycleFail),
    new WaitAction('Deposit', 0.3,
      { location: 'hive', hasResource: true },
      { hasResource: false, delivered: true },
      () => {
        if (task.type) creditDeposit(task.type, 1);
        setCarrying(null);
        task.clear();
      }),
  ];
}

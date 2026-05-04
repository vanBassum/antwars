import { Action } from '../../engine/ai/goap/action.js';
import { GoToAction } from '../../engine/ai/goap/actions/go_to_action.js';

export const RESTOCK_GOAL = { sugarDelivered: true };

const TAKE_DURATION = 0.4;
const DROP_DURATION = 0.3;

// Take 1 sugar from the source node (or stockpile).
class TakeSugarAction extends Action {
  constructor(task, game, onSuccess, onFailure) {
    super('TakeSugar');
    this._task      = task;
    this._game      = game;
    this._onSuccess = onSuccess;
    this._onFailure = onFailure;
    this._duration  = TAKE_DURATION;
    this.preconditions = { location: 'sugarSource', carrying: null, restockAvailable: true };
    this.effects       = { carrying: 'restock-sugar' };
  }
  enter() { this._t = 0; }
  perform(agent, dt) {
    this._t += dt;
    if (this._t >= this._duration) {
      if (!this._task.takeSugar(this._game)) {
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

// Deposit 1 sugar at the feeding tray.
class DepositSugarAction extends Action {
  constructor(task, onSuccess, onFailure) {
    super('DepositSugar');
    this._task      = task;
    this._onSuccess = onSuccess;
    this._onFailure = onFailure;
    this._duration  = DROP_DURATION;
    this.preconditions = { location: 'tray', carrying: 'restock-sugar' };
    this.effects       = { carrying: null, sugarDelivered: true };
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

// Build the restock cycle:
//   GoToSugarSource → TakeSugar → GoToTray → DepositSugar
//
// The GoTo target is dynamic: if task.source is set (a SugarNode), go there;
// otherwise go to the hive (stockpile fallback).
export function buildRestockActions({ task, game, hiveGO, setCarrying, onCycleFail }) {
  const sugarTarget = () => task.source ?? hiveGO();

  return [
    new GoToAction('GoToSugarSource', sugarTarget,
      { carrying: null, restockAvailable: true },
      { location: 'sugarSource' },
      onCycleFail),
    new TakeSugarAction(task, game,
      () => setCarrying('sugar'),
      onCycleFail),
    new GoToAction('GoToTray', () => task.tray,
      { carrying: 'restock-sugar' },
      { location: 'tray' },
      onCycleFail),
    new DepositSugarAction(task,
      () => { setCarrying(null); task.clear(); },
      onCycleFail),
  ];
}

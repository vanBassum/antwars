import { Component } from '../../gameobject.js';
import { Planner } from './planner.js';

const planner = new Planner();

export class GOAPAgent extends Component {
  constructor() {
    super();
    this.worldState = {};  // current known state of the world
    this.goal = {};        // desired world state
    this.actions = [];     // available Action instances

    this._plan = [];
    this._currentAction = null;
    this._retryTimer = 0;
    this._inUpdate = false;
  }

  _goalMet() {
    return Object.entries(this.goal).every(([k, v]) => this.worldState[k] === v);
  }

  update(dt) {
    if (this._inUpdate) return; // guard re-entrancy
    this._inUpdate = true;
    try {
      this._tick(dt);
    } finally {
      this._inUpdate = false;
    }
  }

  _tick(dt) {
    if (this._retryTimer > 0) {
      this._retryTimer -= dt;
      return;
    }

    // Need a new action — pull the next from the queued plan, or replan if
    // empty. Re-planning every action transition would be wasteful: a 4-action
    // harvest cycle would plan 4 times when one plan covers all of it. The
    // queued steps stay valid by construction (planner walks the precondition
    // chain), and `invalidate()` clears _plan on real-world failures.
    if (!this._currentAction) {
      if (this._plan.length === 0) {
        this._plan = planner.plan(this.actions, this.worldState, this.goal) ?? [];
      }

      if (this._plan.length === 0) {
        if (this._goalMet()) {
          this.onGoalReached?.();
        } else {
          this.onPlanFailed?.();
          this._retryTimer = 2; // wait 2s before trying again
        }
        return;
      }

      this._currentAction = this._plan.shift();
      this._currentAction.enter(this);
    }

    // Execute current action
    const done = this._currentAction.perform(this, dt);
    if (done) {
      this.worldState = this._currentAction.applyEffects(this.worldState);
      this._currentAction.exit(this);
      this._currentAction = null;
    }
  }

  // Force a replan (e.g. world changed unexpectedly)
  invalidate() {
    if (this._inUpdate) {
      // defer exit until after current tick
      Promise.resolve().then(() => this._doInvalidate());
    } else {
      this._doInvalidate();
    }
  }

  _doInvalidate() {
    this._currentAction?.exit(this);
    this._currentAction = null;
    this._plan = [];
    this._retryTimer = 0;
  }

  get currentActionName() {
    return this._currentAction?.name ?? 'idle';
  }
}

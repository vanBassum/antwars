import { Component } from '../../gameobject.js';
import { Planner } from './planner.js';

const planner = new Planner();

// Lazily allocate / accumulate into a Component._profile bucket. Used for
// the GOAP·plan / GOAP·perform sub-bucket measurements.
function bumpBucket(profile, name, ms) {
  let entry = profile.get(name);
  if (!entry) profile.set(name, entry = { ms: 0, count: 0 });
  entry.ms += ms;
  entry.count += 1;
}

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
    // Sub-bucket profiling: split GOAPAgent's per-tick cost into its big
    // pieces — `GOAP·plan` (planner.plan calls), `GOAP·plan-fail` (subset
    // that returned no plan), and `GOAP·perform` (per-frame action.perform
    // calls) — so we can tell whether the bottleneck is replanning churn or
    // per-frame action execution. These show up alphabetically in PerfOverlay
    // alongside GOAPAgent (which remains the total). Gated on profileEnabled
    // because the extra performance.now() pairs aren't free at 600 agents.
    const profile = Component.profileEnabled ? Component._profile : null;

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
        if (profile) {
          const t0 = performance.now();
          this._plan = planner.plan(this.actions, this.worldState, this.goal) ?? [];
          bumpBucket(profile, 'GOAP·plan', performance.now() - t0);
          if (this._plan.length === 0) bumpBucket(profile, 'GOAP·plan-fail', 0);
        } else {
          this._plan = planner.plan(this.actions, this.worldState, this.goal) ?? [];
        }
      }

      if (this._plan.length === 0) {
        if (this._goalMet()) {
          this.onGoalReached?.();
        } else {
          this.onPlanFailed?.();
          // Wait before re-attempting a plan that just failed. 5s is long
          // enough to keep failing-plan churn off the per-frame budget when
          // many agents share the same unreachable goal (stress scene), and
          // short enough that ants visibly resume work once new claims open
          // up. invalidate() clears this timer for event-driven wakeups
          // (player-queued tasks, preemption).
          this._retryTimer = 5;
        }
        return;
      }

      this._currentAction = this._plan.shift();
      this._currentAction.enter(this);
    }

    // Execute current action
    let done;
    if (profile) {
      const t0 = performance.now();
      done = this._currentAction.perform(this, dt);
      bumpBucket(profile, 'GOAP·perform', performance.now() - t0);
    } else {
      done = this._currentAction.perform(this, dt);
    }
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

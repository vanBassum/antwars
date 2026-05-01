export class Action {
  constructor(name) {
    this.name = name;
    this.cost = 1;
    this.preconditions = {}; // { key: value } — required world state
    this.effects = {};       // { key: value } — world state after completion
  }

  checkPreconditions(state) {
    for (const [k, v] of Object.entries(this.preconditions)) {
      if (state[k] !== v) return false;
    }
    return true;
  }

  applyEffects(state) {
    return { ...state, ...this.effects };
  }

  // Called once when the action becomes active
  enter(_agent) {}

  // Called every frame while active. Return true when done.
  perform(_agent, _dt) { return true; }

  // Called once when the action finishes or is interrupted
  exit(_agent) {}
}

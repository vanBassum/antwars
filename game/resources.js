import { Component } from '../engine/gameobject.js';

// Singleton that tracks resource counts per team
export const ResourceManager = {
  _resources: {},

  get(team, type) {
    return this._resources[team]?.[type] ?? 0;
  },

  add(team, type, amount) {
    if (!this._resources[team]) this._resources[team] = {};
    this._resources[team][type] = (this._resources[team][type] ?? 0) + amount;
  },

  spend(team, type, amount) {
    const have = this.get(team, type);
    if (have < amount) return false;
    this._resources[team][type] = have - amount;
    return true;
  },
};

// Component: marks a GameObject as a resource node that workers can harvest
export class ResourceNode extends Component {
  constructor(type = 'gold', amount = 500) {
    super();
    this.type = type;
    this.amount = amount;
    this.depleted = false;
    this._initialAmount = amount;
  }

  start() {
    this._initialAmount = this.amount;
  }

  update() {
    const fraction = Math.max(0.2, this.amount / this._initialAmount);
    this.gameObject.object3D.scale.setScalar(fraction);
  }

  harvest(amount) {
    if (this.depleted) return 0;
    const taken = Math.min(amount, this.amount);
    this.amount -= taken;
    if (this.amount <= 0) this.depleted = true;
    return taken;
  }
}

// Component: marks a GameObject as a drop-off point for a team (e.g. base)
export class DropOff extends Component {
  constructor(team = 'green') {
    super();
    this.team = team;
  }
}

import { Component } from '../gameobject.js';

export class Health extends Component {
  constructor({ hp = 1, onDeath, onHit } = {}) {
    super();
    this.maxHp    = hp;
    this.hp       = hp;
    this._onDeath = onDeath ?? null;
    this._onHit   = onHit   ?? null;
  }

  // attacker: the GameObject that dealt damage (may be null)
  takeDamage(amount = 1, attacker = null) {
    if (this.hp <= 0) return;
    this.hp = Math.max(0, this.hp - amount);
    this._onHit?.(attacker, this.gameObject);
    if (this.hp <= 0) this._onDeath?.(this.gameObject);
  }

  get isDead() { return this.hp <= 0; }
}

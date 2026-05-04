import { Component } from '../../engine/gameobject.js';
import { Mover } from '../../engine/components/mover.js';
import { Health } from '../../engine/components/health.js';
import { CombatAnimator } from '../../engine/components/combat_animator.js';
const REPATH_INTERVAL = 2.5;
const ATTACK_RANGE    = 2.2;
const ATTACK_INTERVAL = 1.5;
const NEARBY_AGGRO    = 2.8;
const SLOT_DIST       = ATTACK_RANGE * 0.8;

export class Ladybug extends Component {
  start() {
    this._repathTimer = 0;
    this._attackTimer = 0;
    this._lastTarget  = null;
    // Per-unit angle jitter so attackers approach from slightly different directions.
    this._angleJitter = (Math.random() - 0.5) * 0.6;
  }

  update(dt) {
    const game  = this.gameObject.game;
    const mover = this.gameObject.getComponent(Mover);
    if (!mover) return;

    const target = this._pickTarget(game);
    if (!target) return;

    const pos  = this.gameObject.position;
    const dx   = target.position.x - pos.x;
    const dz   = target.position.z - pos.z;
    const dist = Math.sqrt(dx * dx + dz * dz);

    if (dist < ATTACK_RANGE) {
      this.gameObject.object3D.rotation.y = Math.atan2(dx, dz);
      this._attackTimer -= dt;
      if (this._attackTimer <= 0) {
        this._attackTimer = ATTACK_INTERVAL;
        target.getComponent(Health)?.takeDamage(1, this.gameObject);
        this.gameObject.getComponent(CombatAnimator)?.playAttack(dx / dist, dz / dist);
      }
    }

    const targetChanged = target !== this._lastTarget;
    this._lastTarget = target;

    this._repathTimer -= dt;
    if (dist >= ATTACK_RANGE && (targetChanged || this._repathTimer <= 0 || mover.arrived)) {
      this._repathTimer = REPATH_INTERVAL;
      this._pathTo(target, mover);
    }
  }

  _pickTarget(game) {
    const pos = this.gameObject.position;
    let bestGo = null, bestDist = NEARBY_AGGRO;

    for (const go of game.gameObjects) {
      if (go.faction === 'enemy') continue;
      if (go.name === 'Queen') continue;
      if (!go.getComponent(Health)) continue;

      const dx = go.position.x - pos.x;
      const dz = go.position.z - pos.z;
      const d  = Math.sqrt(dx * dx + dz * dz);
      if (d < bestDist) { bestDist = d; bestGo = go; }
    }

    return bestGo ?? game.gameObjects.find(g => g.name === 'Queen') ?? null;
  }

  _pathTo(target, mover) {
    const pos  = this.gameObject.position;
    const tpos = target.position;
    const dx   = pos.x - tpos.x;
    const dz   = pos.z - tpos.z;
    const dist = Math.sqrt(dx * dx + dz * dz);

    // Approach from the unit's current direction plus a small per-unit angle
    // jitter so multiple attackers land at different spots around the target.
    const angle = (dist > 0.5 ? Math.atan2(dx, dz) : Math.random() * Math.PI * 2)
                + this._angleJitter;

    mover.moveTo({
      x: tpos.x + Math.sin(angle) * SLOT_DIST,
      z: tpos.z + Math.cos(angle) * SLOT_DIST,
    });
  }

  getDebugInfo() {
    const t = this._lastTarget;
    return { task: t ? `→ ${t.name}` : 'idle', repathIn: this._repathTimer?.toFixed(1) };
  }
}

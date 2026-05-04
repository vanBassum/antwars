import { Component } from '../../engine/gameobject.js';
import { Mover } from '../../engine/components/mover.js';
import { Health } from '../../engine/components/health.js';
import { CombatAnimator } from '../../engine/components/combat_animator.js';
const AGGRO_RANGE     = 10;
const ATTACK_RANGE    = 2.2;
const SLOT_DIST       = ATTACK_RANGE * 0.8;
const ATTACK_INTERVAL = 1.0;
const REPATH_INTERVAL = 2.0;

export class SoldierAnt extends Component {
  start() {
    const game = this.gameObject.game;
    const pos  = this.gameObject.position;
    const grid = game.hexGrid;
    this._postHex     = grid ? grid.worldToHex(pos.x, pos.z) : null;
    this._target      = null;
    this._attackTimer = 0;
    this._repathTimer = 0;
    this._angleJitter = (Math.random() - 0.5) * 0.6;
    this._commandPos  = null;

    // Claim a formation slot and head straight there — avoids soldiers stacking
    // at the barracks entrance when multiple are spawned in quick succession.
    const formation = game.soldierFormation;
    if (formation) {
      formation.register(this.gameObject);
      const slot = formation.getSlot(this.gameObject);
      if (slot) this.commandMove(slot);
    }
  }

  destroy() {
    this.gameObject.game?.soldierFormation?.unregister(this.gameObject);
  }

  commandMove(pos) {
    this._commandPos = { x: pos.x, z: pos.z };
    this.gameObject.getComponent(Mover)?.moveTo(this._commandPos);
  }

  update(dt) {
    const game  = this.gameObject.game;
    const mover = this.gameObject.getComponent(Mover);
    if (!mover) return;

    // Drop dead targets; pick up new ones within aggro range
    if (this._target && !game.gameObjects.includes(this._target)) {
      this._target = null;
    }
    if (!this._target) {
      const n = this._nearestEnemy(game);
      if (n && n.dist < AGGRO_RANGE) this._target = n.go;
    }

    // Manual move command: suspend AI until arrived, but combat overrides it.
    if (this._commandPos) {
      if (this._target) {
        this._commandPos = null; // enemy nearby — fight first
      } else if (mover.arrived) {
        const pos = this.gameObject.position;
        if (game.hexGrid) this._postHex = game.hexGrid.worldToHex(pos.x, pos.z);
        this._commandPos = null;
      } else {
        return;
      }
    }

    if (this._target) {
      this._updateCombat(dt, mover, game);
    } else {
      this._updateIdle(dt, mover, game);
    }
  }

  _updateCombat(dt, mover, game) {
    const pos  = this.gameObject.position;
    const tpos = this._target.position;
    const dx   = tpos.x - pos.x;
    const dz   = tpos.z - pos.z;
    const dist = Math.sqrt(dx * dx + dz * dz);

    if (dist < ATTACK_RANGE) {
      this.gameObject.object3D.rotation.y = Math.atan2(dx, dz);
      this._attackTimer -= dt;
      if (this._attackTimer <= 0) {
        this._attackTimer = ATTACK_INTERVAL;
        this._target.getComponent(Health)?.takeDamage(1, this.gameObject);
        this.gameObject.getComponent(CombatAnimator)?.playAttack(dx / dist, dz / dist);
      }
    }

    this._repathTimer -= dt;
    if (dist >= ATTACK_RANGE && (this._repathTimer <= 0 || mover.arrived)) {
      this._repathTimer = REPATH_INTERVAL;
      this._pathTo(this._target, mover);
    }
  }

  _updateIdle(_dt, mover, game) {
    const slot = game.soldierFormation?.getSlot(this.gameObject);
    if (!slot) return;
    const pos = this.gameObject.position;
    const dx  = slot.x - pos.x, dz = slot.z - pos.z;
    // Re-navigate to slot if the soldier drifted (e.g. after combat) and is idle.
    if (dx * dx + dz * dz > 0.5 && mover.arrived) mover.moveTo(slot);
  }


  _pathTo(target, mover) {
    const pos  = this.gameObject.position;
    const tpos = target.position;
    const dx   = pos.x - tpos.x;
    const dz   = pos.z - tpos.z;
    const dist = Math.sqrt(dx * dx + dz * dz);
    const angle = (dist > 0.5 ? Math.atan2(dx, dz) : Math.random() * Math.PI * 2)
                + this._angleJitter;
    mover.moveTo({
      x: tpos.x + Math.sin(angle) * SLOT_DIST,
      z: tpos.z + Math.cos(angle) * SLOT_DIST,
    });
  }

  _nearestEnemy(game) {
    const pos = this.gameObject.position;
    let bestGo = null, bestDist = Infinity;
    for (const go of game.gameObjects) {
      if (go.faction !== 'enemy') continue;
      const dx = go.position.x - pos.x;
      const dz = go.position.z - pos.z;
      const d  = Math.sqrt(dx * dx + dz * dz);
      if (d < bestDist) { bestDist = d; bestGo = go; }
    }
    return bestGo ? { go: bestGo, dist: bestDist } : null;
  }

  getDebugInfo() {
    return {
      task:     this._target ? `fighting ${this._target.name}` : 'patrolling',
      attackIn: this._attackTimer?.toFixed(1),
    };
  }
}

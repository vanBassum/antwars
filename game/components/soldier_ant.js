import { Component } from '../../engine/gameobject.js';
import { Mover } from '../../engine/components/mover.js';
import { Health } from '../../engine/components/health.js';
import { CombatAnimator } from '../../engine/components/combat_animator.js';
import { smoothPath } from '../../engine/hex/smooth_path.js'; // used by _patrol

const AGGRO_RANGE      = 10;
const ATTACK_RANGE     = 2.2;
const SLOT_DIST        = ATTACK_RANGE * 0.8;
const ATTACK_INTERVAL  = 1.0; // seconds between hits
const REPATH_INTERVAL  = 2.0; // seconds between path updates in combat
const PATROL_RADIUS    = 3;   // hex radius for idle patrol around post

export class SoldierAnt extends Component {
  start() {
    const pos  = this.gameObject.position;
    const grid = this.gameObject.game.hexGrid;
    this._postHex     = grid ? grid.worldToHex(pos.x, pos.z) : null;
    this._target      = null;
    this._attackTimer = 0;
    this._repathTimer = 0;
    this._wanderTimer = Math.random() * 2;
    this._angleJitter = (Math.random() - 0.5) * 0.6;
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

  _updateIdle(dt, mover, game) {
    if (!mover.arrived) return;
    this._wanderTimer -= dt;
    if (this._wanderTimer > 0) return;
    this._wanderTimer = 3 + Math.random() * 3;
    this._patrol(mover, game);
  }

  _patrol(mover, game) {
    const grid = game.hexGrid;
    if (!grid || !this._postHex) return;

    const ph = this._postHex;
    const candidates = [];
    for (let q = ph.q - PATROL_RADIUS; q <= ph.q + PATROL_RADIUS; q++) {
      for (let r = ph.r - PATROL_RADIUS; r <= ph.r + PATROL_RADIUS; r++) {
        if (grid.hexDistance(q, r, ph.q, ph.r) > PATROL_RADIUS) continue;
        if (!grid.isWalkable(q, r)) continue;
        candidates.push({ q, r });
      }
    }
    if (candidates.length === 0) return;

    const target = candidates[Math.floor(Math.random() * candidates.length)];
    const pos    = this.gameObject.position;
    const from   = grid.worldToHex(pos.x, pos.z);
    const path   = grid.findPath(from.q, from.r, target.q, target.r);
    if (!path || path.length < 2) return;
    mover.moveAlong(smoothPath(grid, pos, path));
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

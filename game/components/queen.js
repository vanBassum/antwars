import { Component } from '../../engine/gameobject.js';
import { GameObject } from '../../engine/gameobject.js';
import { Mover } from '../../engine/components/mover.js';
import { smoothPath } from '../../engine/hex/smooth_path.js';
import { ENTITY_DEFS } from '../entities.js';
import { FeedingTray } from './feeding_tray.js';

const WANDER_RADIUS  = 5;
const EGG_MIN        = 15;
const EGG_MAX        = 25;
const SUGAR_COST_PER_EGG = 5;
const DRINK_DURATION = 2;   // seconds paused at tray
const FLEE_RADIUS    = 12;  // enemy closer than this → flee
const SAFE_RADIUS    = 15;  // enemy farther than this → resume normal life

function randRange(min, max) { return min + Math.random() * (max - min); }

export class Queen extends Component {
  start() {
    const game = this.gameObject.game;
    const grid = game.hexGrid;
    const hive = game.gameObjects.find(g => g.name === 'Ant Hill');

    this._hiveHex     = hive && grid ? grid.worldToHex(hive.position.x, hive.position.z) : null;
    this._wanderTimer = 1.5 + Math.random() * 1.5;
    this._eggTimer    = randRange(EGG_MIN, EGG_MAX);
    this.internalSugar = 0;

    this._drinking    = false;
    this._drinkTimer  = 0;
    this._drinkTarget = null;

    this._fleeing     = false;
  }

  update(dt) {
    const mover = this.gameObject.getComponent(Mover);
    if (!mover) return;

    // ── Enemy proximity check ───────────────────────────────────────────
    const enemyDist = this._nearestEnemyDist();

    if (!this._fleeing && enemyDist < FLEE_RADIUS) {
      this._fleeing     = true;
      this._drinking    = false;
      this._drinkTarget = null;
      this._fleeToHive(mover);
    } else if (this._fleeing && enemyDist > SAFE_RADIUS) {
      this._fleeing = false;
    }

    if (this._fleeing) {
      if (mover.arrived) this._fleeToHive(mover);
      return; // skip wander, drinking, and egg laying while fleeing
    }

    // ── Drinking ────────────────────────────────────────────────────────
    if (this._drinking) {
      this._drinkTimer -= dt;
      if (this._drinkTimer <= 0) this._finishDrinking();
      return;
    }

    // ── Wander / seek tray ──────────────────────────────────────────────
    if (mover.arrived) {
      if (this._drinkTarget && this._isAtTray()) {
        this._startDrinking();
        return;
      }

      this._wanderTimer -= dt;
      if (this._wanderTimer <= 0) {
        if (this.internalSugar < SUGAR_COST_PER_EGG && this._seekTray()) {
          this._wanderTimer = 1.5 + Math.random() * 1.5;
        } else {
          this._drinkTarget = null;
          this._pickWanderTarget();
          this._wanderTimer = 1.5 + Math.random() * 1.5;
        }
      }
    }

    // ── Lay egg ─────────────────────────────────────────────────────────
    this._eggTimer -= dt;
    if (this._eggTimer <= 0) {
      const wm = this.gameObject.game.workManager;
      if (!wm || !wm.eggCapReached()) {
        if (this.internalSugar >= SUGAR_COST_PER_EGG) {
          this._layEgg();
          this.internalSugar -= SUGAR_COST_PER_EGG;
        }
      }
      this._eggTimer = randRange(EGG_MIN, EGG_MAX);
    }
  }

  // ── Enemy detection ──────────────────────────────────────────────────
  _nearestEnemyDist() {
    const pos = this.gameObject.position;
    let best = Infinity;
    for (const go of this.gameObject.game.gameObjects) {
      if (go.faction !== 'enemy') continue;
      const dx = go.position.x - pos.x;
      const dz = go.position.z - pos.z;
      const d  = Math.sqrt(dx * dx + dz * dz);
      if (d < best) best = d;
    }
    return best;
  }

  // ── Flee ─────────────────────────────────────────────────────────────
  _fleeToHive(mover) {
    const game = this.gameObject.game;
    const grid = game.hexGrid;
    if (!grid || !this._hiveHex) return;

    const pos      = this.gameObject.position;
    const from     = grid.worldToHex(pos.x, pos.z);
    const approach = grid.findApproachHex(this._hiveHex.q, this._hiveHex.r, from.q, from.r);
    if (!approach) return;

    const path = grid.findPath(from.q, from.r, approach.q, approach.r);
    if (!path || path.length < 2) return; // already at hive
    mover.moveAlong(smoothPath(grid, pos, path));
  }

  // ── Tray seeking ─────────────────────────────────────────────────────
  _seekTray() {
    const game = this.gameObject.game;
    const grid = game.hexGrid;
    if (!grid) return false;

    let bestGO = null, bestDist = Infinity;
    for (const go of game.gameObjects) {
      const ft = go.getComponent(FeedingTray);
      if (!ft || ft.level <= 0) continue;
      const dx = go.position.x - this.gameObject.position.x;
      const dz = go.position.z - this.gameObject.position.z;
      const d  = dx * dx + dz * dz;
      if (d < bestDist) { bestDist = d; bestGO = go; }
    }
    if (!bestGO) return false;

    const pos      = this.gameObject.position;
    const from     = grid.worldToHex(pos.x, pos.z);
    const tHex     = grid.worldToHex(bestGO.position.x, bestGO.position.z);
    const approach = grid.findApproachHex(tHex.q, tHex.r, from.q, from.r);
    if (!approach) return false;

    const path = grid.findPath(from.q, from.r, approach.q, approach.r);
    if (!path || path.length < 2) return false;

    this._drinkTarget = bestGO;
    this.gameObject.getComponent(Mover).moveAlong(smoothPath(grid, pos, path));
    return true;
  }

  _isAtTray() { return !!this._drinkTarget; }

  _startDrinking() {
    this._drinking   = true;
    this._drinkTimer = DRINK_DURATION;
  }

  _finishDrinking() {
    this._drinking = false;
    if (this._drinkTarget) {
      const ft = this._drinkTarget.getComponent(FeedingTray);
      if (ft && ft.drink()) this.internalSugar++;
    }
    this._drinkTarget = null;
  }

  // ── Wander ───────────────────────────────────────────────────────────
  _pickWanderTarget() {
    const game = this.gameObject.game;
    const grid = game.hexGrid;
    if (!grid || !this._hiveHex) return;

    const hiveHex    = this._hiveHex;
    const candidates = [];
    for (let q = hiveHex.q - WANDER_RADIUS; q <= hiveHex.q + WANDER_RADIUS; q++) {
      for (let r = hiveHex.r - WANDER_RADIUS; r <= hiveHex.r + WANDER_RADIUS; r++) {
        if (grid.hexDistance(q, r, hiveHex.q, hiveHex.r) > WANDER_RADIUS) continue;
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

    this.gameObject.getComponent(Mover).moveAlong(smoothPath(grid, pos, path));
  }

  // ── Egg laying ───────────────────────────────────────────────────────
  _layEgg() {
    const game = this.gameObject.game;
    const def  = ENTITY_DEFS.find(d => d.id === 'egg');
    if (!def) return;

    const go = def.createObject(game);
    go.object3D.position.copy(this.gameObject.object3D.position);
    game.add(go);
  }

  getDebugInfo() {
    const mover = this.gameObject.getComponent(Mover);
    let task = 'idle';
    if (this._fleeing)       task = 'FLEEING';
    else if (this._drinking) task = 'drinking';
    else if (this._drinkTarget) task = 'seeking tray';
    else if (mover && !mover.arrived) task = 'wander';
    return {
      task,
      nextEgg:       this._eggTimer?.toFixed(1) ?? '?',
      internalSugar: this.internalSugar,
    };
  }
}

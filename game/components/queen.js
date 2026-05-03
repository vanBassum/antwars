import { Component } from '../../engine/gameobject.js';
import { GameObject } from '../../engine/gameobject.js';
import { Mover } from '../../engine/components/mover.js';
import { smoothPath } from '../../engine/hex/smooth_path.js';
import { ENTITY_DEFS } from '../entities.js';
import { FeedingTray } from './feeding_tray.js';

const WANDER_RADIUS = 5;
const EGG_MIN = 15;
const EGG_MAX = 25;
const SUGAR_COST_PER_EGG = 5;
const DRINK_DURATION = 2; // seconds the Queen pauses at a tray

function randRange(min, max) { return min + Math.random() * (max - min); }

export class Queen extends Component {
  start() {
    const game = this.gameObject.game;
    const grid = game.hexGrid;
    const hive = game.gameObjects.find(g => g.name === 'Ant Hill');

    this._hiveHex = hive && grid ? grid.worldToHex(hive.position.x, hive.position.z) : null;
    this._wanderTimer = 1.5 + Math.random() * 1.5;
    this._eggTimer = randRange(EGG_MIN, EGG_MAX);
    this.internalSugar = 0;

    // Drinking state
    this._drinking      = false;   // true while paused at a tray
    this._drinkTimer    = 0;
    this._drinkTarget   = null;    // FeedingTray-bearing gameObject
  }

  update(dt) {
    const mover = this.gameObject.getComponent(Mover);
    if (!mover) return;

    // ── Drinking ────��───────────────────────────────────────────────────
    if (this._drinking) {
      this._drinkTimer -= dt;
      if (this._drinkTimer <= 0) {
        this._finishDrinking();
      }
      // Don't wander or lay while drinking.
      return;
    }

    // ── Wander / seek tray ──────────���───────────────────────────────────
    if (mover.arrived) {
      // If we just arrived at a tray target, start drinking.
      if (this._drinkTarget && this._isAtTray()) {
        this._startDrinking();
        return;
      }

      this._wanderTimer -= dt;
      if (this._wanderTimer <= 0) {
        // Override wander target with nearest tray if hungry.
        if (this.internalSugar < SUGAR_COST_PER_EGG && this._seekTray()) {
          this._wanderTimer = 1.5 + Math.random() * 1.5;
        } else {
          this._drinkTarget = null;
          this._pickWanderTarget();
          this._wanderTimer = 1.5 + Math.random() * 1.5;
        }
      }
    }

    // ── Lay egg ──────���────────────────────────────────────────��─────────
    this._eggTimer -= dt;
    if (this._eggTimer <= 0) {
      const wm = this.gameObject.game.workManager;
      if (!wm || !wm.eggCapReached()) {
        if (this.internalSugar >= SUGAR_COST_PER_EGG) {
          this._layEgg();
          this.internalSugar -= SUGAR_COST_PER_EGG;
        }
        // If not enough sugar, timer simply re-arms without laying.
      }
      this._eggTimer = randRange(EGG_MIN, EGG_MAX);
    }
  }

  // ── Tray seeking ───────────────��────────────────────────────────────────
  _seekTray() {
    const game = this.gameObject.game;
    const grid = game.hexGrid;
    if (!grid) return false;

    // Find nearest tray with level > 0.
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

    // Path to the tray's approach hex.
    const pos  = this.gameObject.position;
    const from = grid.worldToHex(pos.x, pos.z);
    const tHex = grid.worldToHex(bestGO.position.x, bestGO.position.z);
    const approach = grid.findApproachHex(tHex.q, tHex.r, from.q, from.r);
    if (!approach) return false;

    const path = grid.findPath(from.q, from.r, approach.q, approach.r);
    if (!path || path.length < 2) return false;

    this._drinkTarget = bestGO;
    this.gameObject.getComponent(Mover).moveAlong(smoothPath(grid, pos, path));
    return true;
  }

  _isAtTray() {
    if (!this._drinkTarget) return false;
    const dx = this._drinkTarget.position.x - this.gameObject.position.x;
    const dz = this._drinkTarget.position.z - this.gameObject.position.z;
    return (dx * dx + dz * dz) < 2.0; // close enough to adjacent hex
  }

  _startDrinking() {
    this._drinking   = true;
    this._drinkTimer = DRINK_DURATION;
  }

  _finishDrinking() {
    this._drinking = false;
    if (this._drinkTarget) {
      const ft = this._drinkTarget.getComponent(FeedingTray);
      if (ft && ft.drink()) {
        this.internalSugar++;
      }
    }
    this._drinkTarget = null;
  }

  // ── Wander ────────────��───────────────────────��─────────────────────────
  _pickWanderTarget() {
    const game = this.gameObject.game;
    const grid = game.hexGrid;
    if (!grid || !this._hiveHex) return;

    const hiveHex = this._hiveHex;
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
    const pos  = this.gameObject.position;
    const from = grid.worldToHex(pos.x, pos.z);
    const path = grid.findPath(from.q, from.r, target.q, target.r);
    if (!path || path.length < 2) return;

    this.gameObject.getComponent(Mover).moveAlong(smoothPath(grid, pos, path));
  }

  // ── Egg laying ──────────────────────��───────────────────────────────────
  _layEgg() {
    const game = this.gameObject.game;
    const def  = ENTITY_DEFS.find(d => d.id === 'egg');
    if (!def) return;

    const go = def.createObject();
    go.object3D.position.copy(this.gameObject.object3D.position);
    game.add(go);
  }

  getDebugInfo() {
    const mover = this.gameObject.getComponent(Mover);
    let task = 'idle';
    if (this._drinking) task = 'drinking';
    else if (this._drinkTarget) task = 'seeking tray';
    else if (mover && !mover.arrived) task = 'wander';
    return {
      task,
      nextEgg: this._eggTimer?.toFixed(1) ?? '?',
      internalSugar: this.internalSugar,
    };
  }
}

import { Component } from '../../engine/gameobject.js';
import { GameObject } from '../../engine/gameobject.js';
import { Mover } from '../../engine/components/mover.js';
import { smoothPath } from '../../engine/hex/smooth_path.js';
import { ENTITY_DEFS } from '../entities.js';

const WANDER_RADIUS = 5;
const EGG_MIN = 15;
const EGG_MAX = 25;

function randRange(min, max) { return min + Math.random() * (max - min); }

export class Queen extends Component {
  start() {
    const game = this.gameObject.game;
    const grid = game.hexGrid;
    const hive = game.gameObjects.find(g => g.name === 'Ant Hill');

    this._hiveHex = hive && grid ? grid.worldToHex(hive.position.x, hive.position.z) : null;
    this._wanderTimer = 1.5 + Math.random() * 1.5;
    this._eggTimer = randRange(EGG_MIN, EGG_MAX);
  }

  update(dt) {
    const mover = this.gameObject.getComponent(Mover);
    if (!mover) return;

    // ── Wander ──────────────────────────────────────────────────────────
    if (mover.arrived) {
      this._wanderTimer -= dt;
      if (this._wanderTimer <= 0) {
        this._pickWanderTarget();
        this._wanderTimer = 1.5 + Math.random() * 1.5;
      }
    }

    // ── Lay egg ─────────────────────────────────────────────────────────
    this._eggTimer -= dt;
    if (this._eggTimer <= 0) {
      this._layEgg();
      this._eggTimer = randRange(EGG_MIN, EGG_MAX);
    }
  }

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
    const task  = mover && !mover.arrived ? 'wander' : 'idle';
    return { task, nextEgg: this._eggTimer?.toFixed(1) ?? '?' };
  }
}

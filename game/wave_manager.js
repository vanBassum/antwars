import { ENTITY_DEFS } from './entities.js';

const FIRST_WAVE_DELAY = 30;   // seconds before the first wave arrives
const WAVE_INTERVAL    = 60;   // seconds between subsequent waves
const BASE_COUNT       = 3;    // ladybugs in wave 1
const COUNT_PER_WAVE   = 2;    // extra ladybugs added each successive wave

// Spawns escalating waves of ladybug enemies from the hex-grid boundary.
// Called every frame via game.onTick(dt).
export class WaveManager {
  constructor(game) {
    this._game  = game;
    this._timer = FIRST_WAVE_DELAY;
    this._wave  = 0;
    this._hud   = this._buildHud();
  }

  update(dt) {
    this._timer -= dt;
    this._refreshHud();
    if (this._timer <= 0) {
      this._wave++;
      this._timer = WAVE_INTERVAL;
      this._spawnWave(BASE_COUNT + (this._wave - 1) * COUNT_PER_WAVE);
    }
  }

  _spawnWave(count) {
    const def  = ENTITY_DEFS.find(d => d.id === 'ladybug');
    const grid = this._game.hexGrid;
    if (!def || !grid) return;

    for (const { x, z } of this._edgePositions(count)) {
      const go = def.createObject(this._game);
      go.object3D.position.set(x, 0, z);
      this._game.add(go);
    }
  }

  // Pick `count` random world positions from the outermost hex ring.
  _edgePositions(count) {
    const grid = this._game.hexGrid;
    const R    = grid.radius;

    // Walk the outer ring: start at (R, 0), 6 sides of length R each.
    // Verified directions for flat-top axial coords (q, r):
    const WALK = [[-1,1],[-1,0],[0,-1],[1,-1],[1,0],[0,1]];
    const candidates = [];
    let q = R, r = 0;
    for (const [dq, dr] of WALK) {
      for (let step = 0; step < R; step++) {
        candidates.push(grid.hexToWorld(q, r));
        q += dq; r += dr;
      }
    }

    // Fisher-Yates shuffle then slice.
    for (let i = candidates.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [candidates[i], candidates[j]] = [candidates[j], candidates[i]];
    }
    return candidates.slice(0, count);
  }

  _buildHud() {
    const el = document.createElement('div');
    el.style.cssText = [
      'position:fixed', 'top:14px', 'right:14px',
      'background:rgba(0,0,0,0.55)', 'color:#fff',
      'font-family:sans-serif', 'font-size:0.8rem',
      'padding:4px 10px', 'border-radius:6px',
      'pointer-events:none', 'z-index:100',
    ].join(';');
    document.body.append(el);
    return el;
  }

  _refreshHud() {
    const sec  = Math.max(0, Math.ceil(this._timer));
    const next = BASE_COUNT + this._wave * COUNT_PER_WAVE;
    this._hud.textContent = this._wave === 0
      ? `⚔️ Wave 1 in ${sec}s  (${next} enemies)`
      : `⚔️ Wave ${this._wave + 1} in ${sec}s  (${next})`;
  }
}

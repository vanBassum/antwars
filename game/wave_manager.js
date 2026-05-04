import { ENTITY_DEFS } from './entities.js';

const FIRST_WAVE_DELAY = 60;   // seconds before the first wave arrives
const WAVE_INTERVAL    = 120;  // seconds between subsequent waves
const BASE_COUNT       = 1;    // ladybugs in wave 1
const COUNT_PER_WAVE   = 1;    // extra ladybugs added each successive wave

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

  // Pick `count` world positions from one random side of the hex ring,
  // clustered around the midpoint of that side so all enemies arrive together.
  _edgePositions(count) {
    const grid   = this._game.hexGrid;
    const R      = grid.radius;
    const STARTS = [[R,0],[0,R],[-R,R],[-R,0],[0,-R],[R,-R]];
    const WALK   = [[-1,1],[-1,0],[0,-1],[1,-1],[1,0],[0,1]];

    const side      = Math.floor(Math.random() * 6);
    const [dq, dr]  = WALK[side];
    let   [q,  r]   = STARTS[side];
    const hexes     = [];
    for (let i = 0; i < R; i++) {
      hexes.push(grid.hexToWorld(q, r));
      q += dq; r += dr;
    }

    const n     = Math.min(count, hexes.length);
    const mid   = Math.floor(hexes.length / 2);
    const start = Math.max(0, Math.min(hexes.length - n, mid - Math.floor(n / 2)));
    return hexes.slice(start, start + n);
  }

  _buildHud() {
    const el = document.createElement('div');
    el.style.cssText = [
      'position:fixed', 'top:12px', 'left:12px',
      'background:rgba(0,0,0,0.55)', 'color:#fff',
      'font-family:sans-serif', 'font-size:0.8rem',
      'padding:4px 12px', 'border-radius:6px',
      'pointer-events:none', 'z-index:100', 'white-space:nowrap',
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

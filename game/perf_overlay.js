// Toggleable performance HUD overlay.
// Shows FPS, frame timings, entity counts, and Three.js renderer stats.

const HISTORY_SIZE = 120; // frames of history for the graph

export class PerfOverlay {
  constructor(game, { toggleKey = 'Backquote' } = {}) {
    this._game = game;
    this._visible = false;
    this._history = new Float32Array(HISTORY_SIZE);
    this._histIdx = 0;
    this._fpsAccum = 0;
    this._fpsFrames = 0;
    this._fps = 0;
    this._lastFpsUpdate = 0;

    this._el = document.createElement('div');
    this._el.className = 'perf-overlay';
    this._el.style.display = 'none';
    document.body.appendChild(this._el);

    this._canvas = document.createElement('canvas');
    this._canvas.width = HISTORY_SIZE;
    this._canvas.height = 40;
    this._canvas.className = 'perf-graph';
    this._el.appendChild(this._canvas);
    this._ctx = this._canvas.getContext('2d');

    this._stats = document.createElement('pre');
    this._stats.className = 'perf-stats';
    this._el.appendChild(this._stats);

    this._injectStyles();

    window.addEventListener('keydown', (e) => {
      if (e.code === toggleKey) { e.preventDefault(); this.toggle(); }
    });
  }

  toggle() {
    this._visible = !this._visible;
    this._el.style.display = this._visible ? '' : 'none';
  }

  tick() {
    if (!this._visible) return;

    const game = this._game;
    const timing = game.frameTiming;
    if (!timing) return;

    // FPS (rolling average updated ~2x/sec)
    this._fpsAccum += timing.total;
    this._fpsFrames++;
    const now = performance.now();
    if (now - this._lastFpsUpdate > 500) {
      this._fps = Math.round(1000 / (this._fpsAccum / this._fpsFrames));
      this._fpsAccum = 0;
      this._fpsFrames = 0;
      this._lastFpsUpdate = now;
    }

    // Frame time history
    this._history[this._histIdx % HISTORY_SIZE] = timing.total;
    this._histIdx++;

    // Entity counts
    const total = game.gameObjects.length;
    let ants = 0, farms = 0, resources = 0;
    for (const go of game.gameObjects) {
      const id = go.name?.toLowerCase() || '';
      if (id.includes('worker') || id.includes('queen')) ants++;
      else if (id.includes('farm')) farms++;
      else if (id.includes('sugar') || id.includes('wood') || id.includes('branch')) resources++;
    }

    // Three.js renderer info
    const info = game.renderer.info;

    this._stats.textContent =
      `FPS: ${this._fps}  frame: ${timing.total.toFixed(1)} ms\n` +
      `  update: ${timing.update.toFixed(1)}  logic: ${timing.logic.toFixed(1)}  render: ${timing.render.toFixed(1)}\n` +
      `Entities: ${total}  ants: ${ants}  farms: ${farms}  resources: ${resources}\n` +
      `Draw calls: ${info.render.calls}  tris: ${info.render.triangles}  ` +
      `geom: ${info.memory.geometries}  tex: ${info.memory.textures}`;

    this._drawGraph();
  }

  _drawGraph() {
    const ctx = this._ctx;
    const w = this._canvas.width;
    const h = this._canvas.height;
    ctx.clearRect(0, 0, w, h);

    // 16.67ms line (60fps target)
    const targetY = h - (16.67 / 33.33) * h;
    ctx.strokeStyle = 'rgba(0,255,0,0.4)';
    ctx.beginPath();
    ctx.moveTo(0, targetY);
    ctx.lineTo(w, targetY);
    ctx.stroke();

    // Frame time bars
    ctx.fillStyle = '#0f0';
    for (let i = 0; i < HISTORY_SIZE; i++) {
      const idx = (this._histIdx + i) % HISTORY_SIZE;
      const ms = this._history[idx];
      if (!ms) continue;
      const barH = Math.min((ms / 33.33) * h, h);
      const color = ms > 16.67 ? (ms > 33.33 ? '#f00' : '#ff0') : '#0f0';
      ctx.fillStyle = color;
      ctx.fillRect(i, h - barH, 1, barH);
    }
  }

  _injectStyles() {
    const style = document.createElement('style');
    style.textContent = `
      .perf-overlay {
        position: fixed;
        top: 8px;
        right: 8px;
        z-index: 10000;
        pointer-events: none;
        font-family: monospace;
        font-size: 11px;
        color: #0f0;
        background: rgba(0,0,0,0.75);
        border-radius: 4px;
        padding: 6px 8px;
        line-height: 1.4;
      }
      .perf-graph {
        display: block;
        margin-bottom: 4px;
        image-rendering: pixelated;
      }
      .perf-stats {
        margin: 0;
        white-space: pre;
      }
    `;
    document.head.appendChild(style);
  }
}

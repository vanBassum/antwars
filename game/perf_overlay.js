// Performance HUD overlay. Visibility is driven by game.debug — same toggle
// (the top-left 🐞 button or F3) that shows per-ant debug labels also shows
// this panel, so there's one mental model for "debug stuff on/off".

import { Component } from '../engine/gameobject.js';

const HISTORY_SIZE = 120; // frames of history for the graph
const TARGET_MS    = 1000 / 60; // 60fps budget — matches the green line on the graph
const STATS_WINDOW = 60;        // frames over which per-component avg/max are computed (~1s at 60fps)

// Ring buffer of samples used for the per-component avg/max columns. The
// breakdown jitters frame to frame (a frame with one extra plan() call
// can multiply ms 5×), and the eye can't read instantaneous values that
// flicker — averaging over a second smooths it.
class StatsRing {
  constructor(size) {
    this.size = size;
    this.buf  = new Float32Array(size);
    this.idx  = 0;
    this.count = 0;
    this.lastInstanceCount = 0; // most recent x-count (instances ticking this comp)
  }
  push(v, instanceCount = 0) {
    this.buf[this.idx % this.size] = v;
    this.idx++;
    if (this.count < this.size) this.count++;
    this.lastInstanceCount = instanceCount;
  }
  avg() {
    if (this.count === 0) return 0;
    let sum = 0;
    for (let i = 0; i < this.count; i++) sum += this.buf[i];
    return sum / this.count;
  }
  max() {
    if (this.count === 0) return 0;
    let m = this.buf[0];
    for (let i = 1; i < this.count; i++) if (this.buf[i] > m) m = this.buf[i];
    return m;
  }
}

export class PerfOverlay {
  constructor(game, debug) {
    this._game  = game;
    this._debug = debug;
    this._history = new Float32Array(HISTORY_SIZE);
    this._histIdx = 0;
    this._fpsAccum = 0;
    this._fpsFrames = 0;
    this._fps = 0;
    this._lastFpsUpdate = 0;
    // Per-component-name rolling stats for the breakdown rows.
    this._compStats = new Map();
    // Top-line rolling stats — instantaneous values jitter too much to read.
    this._frameStats  = new StatsRing(STATS_WINDOW);
    this._updateStats = new StatsRing(STATS_WINDOW);
    this._logicStats  = new StatsRing(STATS_WINDOW);
    this._renderStats = new StatsRing(STATS_WINDOW);

    // Component-level profiling is gated to when the overlay is visible —
    // the per-update performance.now() pair has measurable cost on hot loops
    // and we don't want to pay it in production / when the HUD is hidden.
    Component.profileEnabled = !!debug?.enabled;

    this._el = document.createElement('div');
    this._el.className = 'perf-overlay';
    this._el.style.display = debug?.enabled ? '' : 'none';
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

    debug?.onChange(on => {
      this._el.style.display = on ? '' : 'none';
      Component.profileEnabled = on;
    });
  }

  tick() {
    if (!this._debug?.enabled) return;

    const game = this._game;
    const timing = game.frameTiming;
    if (!timing) return;

    // FPS (rolling average updated ~2x/sec) — uses actual wall-clock interval
    // between frames, not the work-time inside _tick. With a 60fps cap the
    // interval is ~16.67ms and FPS reads ~60.
    this._fpsAccum += timing.frameInterval ?? timing.total;
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

    // Push current samples and read smoothed values for display. Single-frame
    // numbers spike too much to read (e.g. a frame with one extra plan() call
    // doubles GOAPAgent ms).
    this._frameStats.push(timing.total);
    this._updateStats.push(timing.update);
    this._logicStats.push(timing.logic);
    this._renderStats.push(timing.render);

    const frameAvg  = this._frameStats.avg();
    const frameMax  = this._frameStats.max();
    const updateAvg = this._updateStats.avg();
    const updateMax = this._updateStats.max();
    const logicAvg  = this._logicStats.avg();
    const logicMax  = this._logicStats.max();
    const renderAvg = this._renderStats.avg();
    const renderMax = this._renderStats.max();

    // Main-thread load: how much of the 60fps budget the game loop ate, on
    // average. The remainder is idle headroom inside _tick — note this
    // excludes browser compositor / GC time between rAF callbacks.
    const load = Math.min(100, (frameAvg / TARGET_MS) * 100);
    const idle = Math.max(0, 100 - load);

    // Scene composition counters — useful for interpreting render time.
    // Walked once per second instead of per frame; the scene graph
    // doesn't change often enough to need real-time accuracy.
    if (!this._lastSceneCount || now - this._lastSceneCount > 500) {
      let shadowCasters = 0, transparents = 0, visibleMeshes = 0, instancedCount = 0;
      game.scene.traverse(o => {
        if (!o.visible) return;
        if (o.isMesh || o.isInstancedMesh) {
          visibleMeshes++;
          if (o.castShadow) shadowCasters++;
          const mats = Array.isArray(o.material) ? o.material : (o.material ? [o.material] : []);
          for (const m of mats) if (m.transparent) { transparents++; break; }
          if (o.isInstancedMesh) instancedCount += o.count;
        }
      });
      this._sceneCounts = { shadowCasters, transparents, visibleMeshes, instancedCount };
      this._lastSceneCount = now;
    }
    const sc = this._sceneCounts ?? { shadowCasters: 0, transparents: 0, visibleMeshes: 0, instancedCount: 0 };
    const shadowsOn = game.renderer.shadowMap.enabled;

    let text =
      `FPS: ${this._fps}  frame avg/max: ${frameAvg.toFixed(1)} / ${frameMax.toFixed(1)} ms\n` +
      `  load: ${load.toFixed(0)}%  idle: ${idle.toFixed(0)}%\n` +
      `  update: ${updateAvg.toFixed(1)} / ${updateMax.toFixed(1)}  ` +
      `logic: ${logicAvg.toFixed(1)} / ${logicMax.toFixed(1)}  ` +
      `render: ${renderAvg.toFixed(1)} / ${renderMax.toFixed(1)}\n` +
      `Entities: ${total}  ants: ${ants}  farms: ${farms}  resources: ${resources}\n` +
      `Draw calls: ${info.render.calls}  tris: ${info.render.triangles}  ` +
      `geom: ${info.memory.geometries}  tex: ${info.memory.textures}\n` +
      `Scene: meshes ${sc.visibleMeshes}  shadow-casters ${sc.shadowCasters}  ` +
      `transparent ${sc.transparents}  instances ${sc.instancedCount}\n` +
      `Shadows: ${shadowsOn ? 'ON ' : 'OFF'} (F4 toggle, F5 ant-shadows toggle)`;

    // Per-component update costs, alphabetical for stable row order.
    // Columns: avg / max ms over the last STATS_WINDOW frames, then current
    // count. Smoothing over a window stops the rows from flickering when
    // costs spike on individual frames. We render every component we've
    // ever seen — entries that briefly stop ticking still display (with
    // their max decaying toward 0 as zero samples push through the ring).
    const comps = timing.components;
    if (comps) {
      const seen = new Set();
      for (const c of comps) {
        let stats = this._compStats.get(c.name);
        if (!stats) { stats = new StatsRing(STATS_WINDOW); this._compStats.set(c.name, stats); }
        stats.push(c.ms, c.count);
        seen.add(c.name);
      }
      for (const [name, stats] of this._compStats) {
        if (!seen.has(name)) stats.push(0, 0);
      }
    }

    if (this._compStats.size > 0) {
      text += '\nUpdate breakdown (avg/max ms · count):';
      const names = [...this._compStats.keys()].sort((a, b) => a.localeCompare(b));
      for (const name of names) {
        const stats = this._compStats.get(name);
        const avg = stats.avg();
        const max = stats.max();
        text += `\n  ${name.padEnd(16)} ${avg.toFixed(2).padStart(5)} / ${max.toFixed(2).padStart(5)}  x${stats.lastInstanceCount}`;
      }
    }

    this._stats.textContent = text;

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
        /* Sits to the right of the 🐞 debug button (left:12 + width:36 + gap:8). */
        top: 12px;
        left: 56px;
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

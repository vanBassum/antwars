import * as THREE from 'three';

// Per-frame DOM overlay that renders a label above any gameObject whose
// component list includes one with `getDebugInfo()`. Active only while
// game.debug is enabled; teardown removes every label so there's zero
// cost in release mode.
//
// Each label is positioned by projecting the gameObject's world position
// to screen space.
export class DebugOverlay {
  constructor(game, debug) {
    this._game     = game;
    this._debug    = debug;
    this._labels   = new Map();   // gameObject → { el, lastContent, hidden }
    this._proj     = new THREE.Vector3();
    this._enabled  = true;        // separately toggleable from game.debug; see F6 in main.js
  }

  setEnabled(on) {
    this._enabled = on;
    if (!on) this._teardown();
  }
  isEnabled() { return this._enabled; }

  // Drive me from the game tick (game.onTick).
  tick() {
    if (!this._debug.enabled || !this._enabled) {
      if (this._labels.size > 0) this._teardown();
      return;
    }
    const camera = this._game.camera;
    if (!camera) return;
    const canvas = this._game.renderer.domElement;
    const rect   = canvas.getBoundingClientRect();
    const w      = rect.width;
    const h      = rect.height;

    const seen = new Set();
    for (const go of this._game.gameObjects) {
      const provider = go.components.find(c => typeof c.getDebugInfo === 'function');
      if (!provider) continue;
      seen.add(go);

      let entry = this._labels.get(go);
      if (!entry) {
        const el = document.createElement('div');
        el.className = 'debug-overlay';
        document.body.append(el);
        entry = { el, lastContent: '', hidden: false };
        this._labels.set(go, entry);
      }

      this._proj.copy(go.position);
      this._proj.y += 0.5; // float a touch above the entity
      this._proj.project(camera);

      // Hide if behind camera or off-screen — saves the innerHTML/style work
      // entirely. With 600 ants this is the largest per-frame win.
      const offscreen = this._proj.z > 1
        || this._proj.x < -1.05 || this._proj.x > 1.05
        || this._proj.y < -1.05 || this._proj.y > 1.05;
      if (offscreen) {
        if (!entry.hidden) {
          entry.el.style.display = 'none';
          entry.hidden = true;
        }
        continue;
      }
      if (entry.hidden) {
        entry.el.style.display = '';
        entry.hidden = false;
      }

      // Only rewrite innerHTML when the content actually changed. The
      // task/target/carrying triple updates every few seconds per ant, not
      // every frame, so most calls hit the cache.
      const info = provider.getDebugInfo() ?? {};
      const content =
        `<span class="dbg-task">${info.task ?? '?'}</span>` +
        `<span class="dbg-meta">→ ${info.target ?? '—'} · ${info.carrying ?? 'empty'}</span>`;
      if (content !== entry.lastContent) {
        entry.el.innerHTML = content;
        entry.lastContent = content;
      }

      const x = (this._proj.x *  0.5 + 0.5) * w + rect.left;
      const y = (this._proj.y * -0.5 + 0.5) * h + rect.top;
      entry.el.style.left = `${x}px`;
      entry.el.style.top  = `${y}px`;
    }

    // Drop labels for entities that have left the scene.
    for (const [go, entry] of this._labels) {
      if (!seen.has(go)) { entry.el.remove(); this._labels.delete(go); }
    }
  }

  _teardown() {
    for (const entry of this._labels.values()) entry.el.remove();
    this._labels.clear();
  }
}

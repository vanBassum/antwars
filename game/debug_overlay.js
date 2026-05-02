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
    this._game   = game;
    this._debug  = debug;
    this._labels = new Map();         // gameObject → DOM element
    this._proj   = new THREE.Vector3();
  }

  // Drive me from the game tick (game.onTick).
  tick() {
    if (!this._debug.enabled) {
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

      let label = this._labels.get(go);
      if (!label) {
        label = document.createElement('div');
        label.className = 'debug-overlay';
        document.body.append(label);
        this._labels.set(go, label);
      }

      const info = provider.getDebugInfo() ?? {};
      label.innerHTML =
        `<span class="dbg-task">${info.task ?? '?'}</span>` +
        `<span class="dbg-meta">→ ${info.target ?? '—'} · ${info.carrying ?? 'empty'}</span>`;

      this._proj.copy(go.position);
      this._proj.y += 0.5; // float a touch above the entity
      this._proj.project(camera);

      // Hide if behind camera.
      if (this._proj.z > 1) {
        label.style.display = 'none';
        continue;
      }
      const x = (this._proj.x *  0.5 + 0.5) * w + rect.left;
      const y = (this._proj.y * -0.5 + 0.5) * h + rect.top;
      label.style.display = '';
      label.style.left = `${x}px`;
      label.style.top  = `${y}px`;
    }

    // Drop labels for entities that have left the scene.
    for (const [go, el] of this._labels) {
      if (!seen.has(go)) { el.remove(); this._labels.delete(go); }
    }
  }

  _teardown() {
    for (const el of this._labels.values()) el.remove();
    this._labels.clear();
  }
}

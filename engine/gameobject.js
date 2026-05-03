import * as THREE from 'three';

export class Component {
  constructor() {
    this.gameObject = null;
    this.enabled = true;
  }
  start() {}
  update(_dt) {}
  destroy() {}
}

// Per-frame profiling of component update() costs, keyed by class name.
// Off by default — turned on by PerfOverlay while the debug HUD is visible.
// Reset each tick from engine/game.js before the update loop runs.
Component.profileEnabled = false;
Component._profile = new Map(); // className -> { ms, count }

Component.resetProfile = function () {
  for (const entry of Component._profile.values()) {
    entry.ms = 0;
    entry.count = 0;
  }
};

Component.snapshotProfile = function () {
  const out = [];
  for (const [name, entry] of Component._profile) {
    if (entry.count === 0) continue;
    out.push({ name, ms: entry.ms, count: entry.count });
  }
  out.sort((a, b) => b.ms - a.ms);
  return out;
};

export class GameObject {
  constructor(name = 'GameObject') {
    this.name = name;
    this.components = [];
    this.object3D = new THREE.Object3D();
    this.object3D.name = name;
    this.object3D.userData.gameObject = this;
  }

  // Shortcuts into Three.js transform
  get position() { return this.object3D.position; }
  get rotation() { return this.object3D.rotation; }
  get scale()    { return this.object3D.scale; }

  addComponent(comp) {
    comp.gameObject = this;
    this.components.push(comp);
    return comp;
  }

  getComponent(type) {
    return this.components.find(c => c instanceof type) ?? null;
  }

  start() {
    for (const c of this.components) c.start();
  }

  update(dt) {
    if (Component.profileEnabled) {
      const profile = Component._profile;
      for (const c of this.components) {
        if (!c.enabled) continue;
        const name = c.constructor.name;
        let entry = profile.get(name);
        if (!entry) {
          entry = { ms: 0, count: 0 };
          profile.set(name, entry);
        }
        const t0 = performance.now();
        c.update(dt);
        entry.ms += performance.now() - t0;
        entry.count++;
      }
    } else {
      for (const c of this.components) {
        if (c.enabled) c.update(dt);
      }
    }
  }

  destroy() {
    for (const c of this.components) c.destroy();
    this.components = [];
  }
}

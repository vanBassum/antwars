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
    for (const c of this.components) {
      if (c.enabled) c.update(dt);
    }
  }

  destroy() {
    for (const c of this.components) c.destroy();
    this.components = [];
  }
}

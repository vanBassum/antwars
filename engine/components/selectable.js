import { Component } from '../gameobject.js';

const HIGHLIGHT_COLOR = { r: 0, g: 0.6, b: 0.1 };

export class Selectable extends Component {
  static all = new Set();

  constructor() {
    super();
    this.selected = false;
  }

  start() {
    Selectable.all.add(this);
  }

  select() {
    if (this.selected) return;
    this.selected = true;
    this._setEmissive(HIGHLIGHT_COLOR.r, HIGHLIGHT_COLOR.g, HIGHLIGHT_COLOR.b);
  }

  deselect() {
    if (!this.selected) return;
    this.selected = false;
    this._setEmissive(0, 0, 0);
  }

  // Returns the GOAPAgent action name for HUD display, if present
  get actionLabel() {
    const agent = this.gameObject.components.find(c => typeof c.currentActionName === 'string');
    return agent?.currentActionName ?? 'idle';
  }

  _setEmissive(r, g, b) {
    this.gameObject.object3D.traverse(node => {
      if (!node.isMesh) return;
      const mats = Array.isArray(node.material) ? node.material : [node.material];
      for (const mat of mats) {
        if (mat.emissive) mat.emissive.setRGB(r, g, b);
      }
    });
  }

  destroy() {
    Selectable.all.delete(this);
  }
}

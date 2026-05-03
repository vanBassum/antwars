import { Component } from '../../engine/gameobject.js';
import { cloneModel } from '../../engine/model_cache.js';

export class FeedingTray extends Component {
  constructor() {
    super();
    this.level    = 0;
    this.capacity = 5;
    this._honey   = null;
  }

  start() {
    this._honey = cloneModel('assets/models/HoneyBlob.glb');
    this._honey.position.y = 0.1; // sit inside the bowl
    this.gameObject.object3D.add(this._honey);
    this._refreshVisual();
  }

  needsSugar() { return this.level < this.capacity; }

  receiveSugar() {
    if (this.level >= this.capacity) return false;
    this.level++;
    this._refreshVisual();
    return true;
  }

  drink() {
    if (this.level <= 0) return false;
    this.level--;
    this._refreshVisual();
    return true;
  }

  _refreshVisual() {
    if (!this._honey) return;
    if (this.level <= 0) { this._honey.visible = false; return; }
    this._honey.visible = true;
    const f = this.level / this.capacity;
    this._honey.scale.setScalar(0.6 * f);
  }

  getContextMenu() {
    return {
      title: 'Feeding Tray',
      state: `Sugar: ${this.level} / ${this.capacity}`,
    };
  }
}

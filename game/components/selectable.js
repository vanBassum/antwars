import * as THREE from 'three';
import { Component } from '../../engine/gameobject.js';

const _geo = new THREE.SphereGeometry(0.18, 8, 6);
const _mat = new THREE.MeshBasicMaterial({ color: 0x44ff44 });

export class Selectable extends Component {
  start() {
    this._selected  = false;
    this._indicator = new THREE.Mesh(_geo, _mat);
    this._indicator.position.y = 1.4;
    this._indicator.visible    = false;
    this.gameObject.object3D.add(this._indicator);

    this.gameObject.game.selectionManager?.register(this);
  }

  destroy() {
    this.gameObject.game.selectionManager?.unregister(this);
  }

  select()          { this._selected = true;  this._indicator.visible = true;  }
  deselect()        { this._selected = false; this._indicator.visible = false; }
  get isSelected()  { return this._selected; }

  commandMove(pos) {
    for (const c of this.gameObject.components) {
      if (typeof c.commandMove === 'function') { c.commandMove(pos); return; }
    }
  }
}

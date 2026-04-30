import * as THREE from 'three';
import { Selectable } from '../engine/components/selectable.js';

export class SelectionManager {
  constructor(game, onSelectionChange) {
    this._game     = game;
    this._onChange = onSelectionChange;
    this._selected = null;
    this._ray      = new THREE.Raycaster();
    this._mouse    = new THREE.Vector2();

    game.renderer.domElement.addEventListener('click', (e) => this._onClick(e));
  }

  _onClick(e) {
    // Ignore if middle button was recently dragged (orbit gesture)
    const rect = this._game.renderer.domElement.getBoundingClientRect();
    this._mouse.set(
      ((e.clientX - rect.left) / rect.width)  * 2 - 1,
      -((e.clientY - rect.top)  / rect.height) * 2 + 1
    );

    this._ray.setFromCamera(this._mouse, this._game.camera);

    // Collect all objects3D from Selectable GOs
    const targets = [];
    for (const sel of Selectable.all) {
      sel.gameObject.object3D.traverse(child => {
        if (child.isMesh) targets.push(child);
      });
    }

    const hits = this._ray.intersectObjects(targets, false);
    if (hits.length === 0) {
      this._deselect();
      return;
    }

    // Walk up the hit object's parent chain to find a registered Selectable
    let obj = hits[0].object;
    while (obj) {
      for (const sel of Selectable.all) {
        if (sel.gameObject.object3D === obj || sel.gameObject.object3D.getObjectById(obj.id)) {
          this._select(sel);
          return;
        }
      }
      obj = obj.parent;
    }
    this._deselect();
  }

  _select(sel) {
    if (this._selected === sel) return;
    this._selected?.deselect();
    this._selected = sel;
    sel.select();
    this._onChange?.(sel.gameObject);
  }

  _deselect() {
    this._selected?.deselect();
    this._selected = null;
    this._onChange?.(null);
  }
}

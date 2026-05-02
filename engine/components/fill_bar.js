import * as THREE from 'three';
import { Component } from '../gameobject.js';

// A billboarded bar floating above the gameObject. Shows _fill in [0..1].
// offsetY: null = auto-place just above the model's bounding box.
export class FillBar extends Component {
  constructor({
    width   = 1.2,
    height  = 0.16,
    offsetY = null,
    color   = 0xffcc44,
    bgColor = 0x222222,
    fill    = 1.0,
  } = {}) {
    super();
    this._width   = width;
    this._height  = height;
    this._offsetY = offsetY;
    this._color   = color;
    this._bgColor = bgColor;
    this._fill    = fill;
  }

  set fill(v) {
    this._fill = Math.max(0, Math.min(1, v));
    if (this._fg) this._fg.scale.x = this._width * this._fill;
  }
  get fill() { return this._fill; }

  start() {
    const bgMat = new THREE.MeshBasicMaterial({
      color: this._bgColor, transparent: true, opacity: 0.75, depthTest: false,
    });
    const bg = new THREE.Mesh(new THREE.PlaneGeometry(this._width, this._height), bgMat);
    bg.renderOrder = 999;

    // Anchor foreground's pivot to its left edge so scale.x grows from the left
    const fgGeo = new THREE.PlaneGeometry(1, 1).translate(0.5, 0, 0);
    const fgMat = new THREE.MeshBasicMaterial({ color: this._color, depthTest: false });
    const fg = new THREE.Mesh(fgGeo, fgMat);
    fg.position.x = -this._width / 2;
    fg.scale.set(this._width * this._fill, this._height, 1);
    fg.renderOrder = 1000;
    this._fg = fg;

    let y = this._offsetY;
    if (y == null) {
      const obj = this.gameObject.object3D;
      obj.updateMatrixWorld(true);
      const box = new THREE.Box3().setFromObject(obj);
      y = isFinite(box.max.y) ? (box.max.y - obj.position.y + 0.3) : 1.5;
    }

    const group = new THREE.Group();
    group.add(bg);
    group.add(fg);
    group.position.y = y;
    this.gameObject.object3D.add(group);
    this._group = group;
  }

  update() {
    const cam = this.gameObject.game?.camera;
    if (cam && this._group) this._group.quaternion.copy(cam.quaternion);
  }
}

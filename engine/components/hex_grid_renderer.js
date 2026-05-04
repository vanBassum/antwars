import * as THREE from 'three';
import { Component } from '../gameobject.js';

// Draws hex tile outlines on the ground (one merged LineSegments mesh).
export class HexGridRenderer extends Component {
  constructor(grid, { color = 0xffeecc, opacity = 0.35, y = 0.02 } = {}) {
    super();
    this._grid    = grid;
    this._color   = color;
    this._opacity = opacity;
    this._y       = y;
  }

  start() {
    const positions = [];
    for (const { q, r } of this._grid.allHexes()) {
      const corners = this._grid.hexCorners(q, r);
      for (let i = 0; i < 6; i++) {
        const a = corners[i], b = corners[(i + 1) % 6];
        positions.push(a.x, this._y, a.z, b.x, this._y, b.z);
      }
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    const mat = new THREE.LineBasicMaterial({
      color: this._color, transparent: this._opacity < 1, opacity: this._opacity,
    });
    this.gameObject.object3D.add(new THREE.LineSegments(geo, mat));
  }
}

import * as THREE from 'three';
import { Component } from '../gameobject.js';

const SEGMENTS = 64;
const COLOR    = 0x00ff44;

export class BaseZoneGizmo extends Component {
  constructor(map, { cellSize = 1, heightScale = 10 } = {}) {
    super();
    this._map         = map;
    this._cellSize    = cellSize;
    this._heightScale = heightScale;
  }

  start() {
    for (const base of this._map.bases) {
      this._addGizmo(base);
    }
  }

  _addGizmo(base) {
    const { _map: map, _cellSize: cs, _heightScale: hs } = this;
    const cell = map.get(base.x, base.z);
    const wx   = (base.x - map.width / 2) * cs;
    const wz   = (base.z - map.depth / 2) * cs;
    const wy   = cell.height * hs + 0.2;
    const r    = base.radius * cs;
    const mat  = new THREE.LineBasicMaterial({ color: COLOR });

    // Ring
    const pts = [];
    for (let i = 0; i <= SEGMENTS; i++) {
      const a = (i / SEGMENTS) * Math.PI * 2;
      pts.push(new THREE.Vector3(Math.cos(a) * r, 0, Math.sin(a) * r));
    }
    const ring = new THREE.Line(
      new THREE.BufferGeometry().setFromPoints(pts),
      mat
    );
    ring.position.set(wx, wy, wz);
    this.gameObject.object3D.add(ring);

    // Cross at center
    const cross = new THREE.LineSegments(
      new THREE.BufferGeometry().setFromPoints([
        new THREE.Vector3(-1, 0, 0), new THREE.Vector3(1, 0, 0),
        new THREE.Vector3(0, 0, -1), new THREE.Vector3(0, 0, 1),
      ]),
      mat
    );
    cross.position.set(wx, wy, wz);
    this.gameObject.object3D.add(cross);
  }
}

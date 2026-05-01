import * as THREE from 'three';
import { Component } from '../gameobject.js';

const TEAM_COLORS = [0x4488ff, 0xff4444, 0x44ff88, 0xffaa00];

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
    const cell  = map.get(base.x, base.z);
    const wx    = (base.x - map.width / 2) * cs;
    const wz    = (base.z - map.depth / 2) * cs;
    const wy    = cell.height * hs + 0.15;
    const r     = base.radius * cs;
    const color = TEAM_COLORS[base.teamIndex % TEAM_COLORS.length];

    const mat = new THREE.MeshBasicMaterial({
      color,
      side:        THREE.DoubleSide,
      transparent: true,
      opacity:     0.85,
      depthWrite:  false,
    });

    // Outer ring
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(r - 0.25, r + 0.25, 64).rotateX(-Math.PI / 2),
      mat
    );
    ring.position.set(wx, wy, wz);
    this.gameObject.object3D.add(ring);

    // Center dot
    const dot = new THREE.Mesh(
      new THREE.CircleGeometry(0.8, 32).rotateX(-Math.PI / 2),
      mat
    );
    dot.position.set(wx, wy, wz);
    this.gameObject.object3D.add(dot);
  }
}

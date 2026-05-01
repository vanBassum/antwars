import * as THREE from 'three';
import { Component } from '../gameobject.js';
import { TerrainType } from '../terrain_map.js';

// Normalized height at which the water surface sits (top of shallow_water band)
const WATER_H = 0.35;

const TYPE_COLOR = {
  [TerrainType.DEEP_WATER]:    new THREE.Color(0x1a4a8a),
  [TerrainType.SHALLOW_WATER]: new THREE.Color(0x3a72b0),
  [TerrainType.SAND]:          new THREE.Color(0xd4c07a),
  [TerrainType.GRASS]:         new THREE.Color(0x4a8a38),
  [TerrainType.DIRT]:          new THREE.Color(0x8a6040),
  [TerrainType.HILL]:          new THREE.Color(0x7a7060),
  [TerrainType.MOUNTAIN]:      new THREE.Color(0xc0b8b0),
};

export class TerrainRenderer extends Component {
  constructor(map, { cellSize = 1, heightScale = 10 } = {}) {
    super();
    this._map         = map;
    this._cellSize    = cellSize;
    this._heightScale = heightScale;
  }

  start() {
    const { width, depth } = this._map;
    const cs = this._cellSize;
    const hs = this._heightScale;

    // ── Build terrain mesh ────────────────────────────────────────────────────
    const positions = new Float32Array(width * depth * 3);
    const colors    = new Float32Array(width * depth * 3);
    const indices   = [];
    const col       = new THREE.Color();

    for (let z = 0; z < depth; z++) {
      for (let x = 0; x < width; x++) {
        const i    = z * width + x;
        const cell = this._map.get(x, z);

        positions[i * 3]     = (x - width / 2) * cs;
        positions[i * 3 + 1] = cell.height * hs;
        positions[i * 3 + 2] = (z - depth / 2) * cs;

        col.copy(TYPE_COLOR[cell.type]);
        colors[i * 3]     = col.r;
        colors[i * 3 + 1] = col.g;
        colors[i * 3 + 2] = col.b;
      }
    }

    for (let z = 0; z < depth - 1; z++) {
      for (let x = 0; x < width - 1; x++) {
        const tl = z * width + x;
        const tr = tl + 1;
        const bl = tl + width;
        const br = bl + 1;
        indices.push(tl, bl, tr, tr, bl, br);
      }
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geo.setAttribute('color',    new THREE.BufferAttribute(colors,    3));
    geo.setIndex(indices);
    geo.computeVertexNormals();

    const mesh = new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ vertexColors: true }));
    mesh.receiveShadow = true;
    this.gameObject.object3D.add(mesh);

    // ── Water plane ───────────────────────────────────────────────────────────
    const size      = width * cs;
    const waterMesh = new THREE.Mesh(
      new THREE.PlaneGeometry(size, size).rotateX(-Math.PI / 2),
      new THREE.MeshLambertMaterial({ color: 0x3a72b0, transparent: true, opacity: 0.72 })
    );
    waterMesh.position.y = WATER_H * hs;
    this.gameObject.object3D.add(waterMesh);
  }
}

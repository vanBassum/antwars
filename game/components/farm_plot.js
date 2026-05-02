import * as THREE from 'three';
import { Component } from '../../engine/gameobject.js';

// Color tint per crop type, so the player can see at a glance what was chosen.
const CROP_COLORS = {
  null:  0x8b6f4e, // bare soil
  berry: 0x6a8e3a, // bushy green
  tree:  0x2e5a2e, // dark forest green
};

export const FARM_CROPS = [
  { key: 'berry', icon: '🫐', label: 'Berry Bush' },
  { key: 'tree',  icon: '🌳', label: 'Tree' },
];

// A placeable plot of land. Holds a `crop` ('berry' | 'tree' | null);
// gameplay effects come later. The visual is a flat hex disc tinted by crop.
export class FarmPlot extends Component {
  constructor() {
    super();
    this._crop     = null;
    this._material = null;
  }

  get crop()  { return this._crop; }
  set crop(v) { this._crop = v; this._updateColor(); }

  start() {
    const grid = this.gameObject.game?.hexGrid;
    const size = (grid?.size ?? 1.5) * 0.92; // small inset so neighbors don't z-fight

    const shape = new THREE.Shape();
    for (let i = 0; i < 6; i++) {
      const a = (Math.PI / 3) * i;
      const x = size * Math.cos(a);
      const z = size * Math.sin(a);
      if (i === 0) shape.moveTo(x, z);
      else         shape.lineTo(x, z);
    }
    shape.closePath();

    const geo = new THREE.ShapeGeometry(shape);
    geo.rotateX(-Math.PI / 2);
    const mat  = new THREE.MeshLambertMaterial({ color: CROP_COLORS[null] });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.receiveShadow = true;
    mesh.position.y    = 0.04;
    this.gameObject.object3D.add(mesh);
    this._material = mat;
    this._updateColor();
  }

  _updateColor() {
    if (!this._material) return;
    const hex = CROP_COLORS[this._crop] ?? CROP_COLORS[null];
    this._material.color.setHex(hex);
  }
}

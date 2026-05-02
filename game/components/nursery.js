import { Component } from '../../engine/gameobject.js';
import { cloneModel } from '../../engine/model_cache.js';

const MAX_EGGS = 10;
const EGG_MODEL_URL = 'assets/models/Egg.glb';

// Nursery building — collects eggs delivered by workers.
// Visualises stored eggs as small meshes scattered around the building.
export class Nursery extends Component {
  constructor() {
    super();
    this._eggCount = 0;
    this._eggMeshes = [];
  }

  get eggCount() { return this._eggCount; }
  get isFull()   { return this._eggCount >= MAX_EGGS; }

  // WorkManager query: can this nursery accept more eggs?
  canAccept() { return this._eggCount < MAX_EGGS; }

  // Worker delivers an egg here.
  receiveEgg() {
    if (this._eggCount >= MAX_EGGS) return false;
    this._eggCount++;
    this._addEggVisual();
    return true;
  }

  _addEggVisual() {
    let mesh;
    try { mesh = cloneModel(EGG_MODEL_URL); } catch { return; }
    mesh.scale.setScalar(0.15);

    // Scatter eggs in a small ring around center
    const i = this._eggMeshes.length;
    const angle = (i / MAX_EGGS) * Math.PI * 2 + (Math.random() - 0.5) * 0.4;
    const r = 0.2 + Math.random() * 0.15;
    mesh.position.set(Math.cos(angle) * r, 0.05, Math.sin(angle) * r);
    mesh.rotation.set(0, Math.random() * Math.PI * 2, (Math.random() - 0.5) * 0.3);

    this.gameObject.object3D.add(mesh);
    this._eggMeshes.push(mesh);
  }

  destroy() {
    for (const m of this._eggMeshes) {
      this.gameObject.object3D.remove(m);
    }
    this._eggMeshes = [];
  }
}

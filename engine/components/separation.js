import { Component } from '../gameobject.js';

const RADIUS  = 1.0;
const FORCE   = 4.0;

export class Separation extends Component {
  static agents = new Set();

  start() {
    Separation.agents.add(this);
  }

  update(dt) {
    const pos = this.gameObject.position;
    let fx = 0, fz = 0;

    for (const other of Separation.agents) {
      if (other === this) continue;
      const op  = other.gameObject.position;
      const dx  = pos.x - op.x;
      const dz  = pos.z - op.z;
      const d2  = dx * dx + dz * dz;
      if (d2 < 0.0001 || d2 >= RADIUS * RADIUS) continue;
      const d   = Math.sqrt(d2);
      const w   = 1 - d / RADIUS; // stronger when closer
      fx += (dx / d) * w;
      fz += (dz / d) * w;
    }

    pos.x += fx * FORCE * dt;
    pos.z += fz * FORCE * dt;
  }

  destroy() {
    Separation.agents.delete(this);
  }
}

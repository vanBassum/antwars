import { Component } from '../gameobject.js';

const RADIUS = 1.6;  // influence distance (world units)
const FORCE  = 0.6;  // max push speed (world units/sec) — less than any unit's move speed

export class Steering extends Component {
  update(dt) {
    const pos = this.gameObject.position;
    let fx = 0, fz = 0;

    for (const go of this.gameObject.game.gameObjects) {
      if (go === this.gameObject) continue;
      if (!go.getComponent(Steering)) continue;

      const dx = pos.x - go.position.x;
      const dz = pos.z - go.position.z;
      const dist = Math.sqrt(dx * dx + dz * dz);
      if (dist >= RADIUS || dist < 0.001) continue;

      // Stronger push the closer they are; falls off linearly to zero at RADIUS.
      const strength = (RADIUS - dist) / RADIUS;
      fx += (dx / dist) * strength;
      fz += (dz / dist) * strength;
    }

    pos.x += fx * FORCE * dt;
    pos.z += fz * FORCE * dt;
  }
}

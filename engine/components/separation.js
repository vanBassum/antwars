import { Component } from '../gameobject.js';

export class Separation extends Component {
  constructor(radius = 0.4) {
    super();
    this.radius = radius;
  }

  update(_dt) {
    const game = this.gameObject.game;
    const pos  = this.gameObject.position;

    for (const go of game.gameObjects) {
      if (go === this.gameObject) continue;
      const other = go.getComponent(Separation);
      if (!other) continue;

      const dx   = pos.x - go.position.x;
      const dz   = pos.z - go.position.z;
      const dist2 = dx * dx + dz * dz;
      const minDist = this.radius + other.radius;
      if (dist2 >= minDist * minDist) continue;

      const dist = Math.sqrt(dist2);
      if (dist < 0.001) {
        // Exact stack — scatter randomly so they don't lock up
        const a = Math.random() * Math.PI * 2;
        pos.x += Math.cos(a) * minDist * 0.5;
        pos.z += Math.sin(a) * minDist * 0.5;
        continue;
      }

      // Push this unit half the overlap along the separating axis.
      // The other unit will push its own half when its update runs.
      const overlap = (minDist - dist) * 0.5;
      pos.x += (dx / dist) * overlap;
      pos.z += (dz / dist) * overlap;
    }
  }
}

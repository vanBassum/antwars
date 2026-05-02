import { Component } from '../gameobject.js';

const ARRIVE_DIST = 0.05;

export class Mover extends Component {
  static groundQuery = null; // set by game layer: Mover.groundQuery = heightAt

  constructor(speed = 4) {
    super();
    this.speed   = speed;
    this._target = null;
    this._path   = []; // remaining waypoints after _target
    this.arrived = true;
  }

  moveTo(position) {
    this._path   = [];
    this._target = { x: position.x, z: position.z };
    this.arrived = false;
  }

  // Walk through a list of waypoints in order. Each item: { x, z }.
  moveAlong(waypoints) {
    if (!waypoints || waypoints.length === 0) {
      this._target = null;
      this._path   = [];
      this.arrived = true;
      return;
    }
    this._target = { x: waypoints[0].x, z: waypoints[0].z };
    this._path   = waypoints.slice(1).map(p => ({ x: p.x, z: p.z }));
    this.arrived = false;
  }

  update(dt) {
    if (!this._target || this.arrived) return;

    const pos  = this.gameObject.position;
    const dx   = this._target.x - pos.x;
    const dz   = this._target.z - pos.z;
    const dist = Math.sqrt(dx * dx + dz * dz);

    if (dist < ARRIVE_DIST) {
      // Intermediate waypoint: advance without teleporting so motion stays
      // continuous. Only snap on the final waypoint.
      if (this._path.length > 0) {
        this._target = this._path.shift();
        return;
      }
      pos.x = this._target.x;
      pos.z = this._target.z;
      this._target = null;
      this.arrived = true;
      return;
    }

    const step = Math.min(this.speed * dt, dist);
    pos.x += (dx / dist) * step;
    pos.z += (dz / dist) * step;
    pos.y  = Mover.groundQuery ? Mover.groundQuery(pos.x, pos.z) : pos.y;

    // Face direction of travel
    this.gameObject.object3D.rotation.y = Math.atan2(dx, dz);
  }
}

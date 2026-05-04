import { Component } from '../gameobject.js';

const ARRIVE_DIST   = 0.05;
const ARRIVE_SLOW_R = 0.8;  // start decelerating within this distance of the final waypoint

export class Mover extends Component {
  static groundQuery = null; // set by game layer: Mover.groundQuery = heightAt

  constructor(speed = 4) {
    super();
    this.speed   = speed;
    this._target = null;
    this._path   = []; // remaining waypoints after _target
    this.arrived = true;
    // Per-mover lateral offset (world units) applied to every waypoint.
    // Lets each ant follow its own slightly-different track so two ants
    // on the same path don't visually walk on top of each other. Workers
    // pick their own small random offset on start; everything else
    // defaults to 0 (no offset).
    this.pathOffsetX = 0;
    this.pathOffsetZ = 0;
  }

  moveTo(position) {
    this._path   = [];
    this._target = { x: position.x + this.pathOffsetX, z: position.z + this.pathOffsetZ };
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
    this._target = { x: waypoints[0].x + this.pathOffsetX, z: waypoints[0].z + this.pathOffsetZ };
    this._path   = waypoints.slice(1).map(p => ({
      x: p.x + this.pathOffsetX,
      z: p.z + this.pathOffsetZ,
    }));
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

    const speed = (this._path.length === 0 && dist < ARRIVE_SLOW_R)
      ? this.speed * Math.max(dist / ARRIVE_SLOW_R, 0.15)
      : this.speed;
    const step = Math.min(speed * dt, dist);
    pos.x += (dx / dist) * step;
    pos.z += (dz / dist) * step;
    pos.y  = Mover.groundQuery ? Mover.groundQuery(pos.x, pos.z) : pos.y;

    // Face direction of travel
    this.gameObject.object3D.rotation.y = Math.atan2(dx, dz);
  }
}

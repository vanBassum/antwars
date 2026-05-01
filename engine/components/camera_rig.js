import * as THREE from 'three';
import { Component } from '../gameobject.js';

const DIST_MIN   = 5;
const DIST_MAX   = 60;
const ELEV_MIN   = 0.2;
const ELEV_MAX   = Math.PI / 2 - 0.05;
const PAN_SPEED  = 12;

export class CameraRig extends Component {
  constructor() {
    super();
    this._target    = new THREE.Vector3();
    this._dist      = 24;
    this._azimuth   = 0;
    this._elevation = Math.PI / 4;
    this._keys      = {};
    this._drag      = null;
  }

  start() {
    const { game } = this.gameObject;

    const el  = game.renderer.domElement;
    this._cam = new THREE.PerspectiveCamera(45, el.clientWidth / el.clientHeight || 1, 0.1, 500);
    game.camera = this._cam;
    this._apply();

    el.addEventListener('wheel', (e) => {
      this._dist = Math.max(DIST_MIN, Math.min(DIST_MAX, this._dist + e.deltaY * 0.05));
      this._apply();
    }, { passive: true });

    el.addEventListener('mousedown', (e) => {
      if (e.button === 1) { this._drag = { x: e.clientX, y: e.clientY }; e.preventDefault(); }
    });
    window.addEventListener('mouseup',   (e) => { if (e.button === 1) this._drag = null; });
    window.addEventListener('mousemove', (e) => {
      if (!this._drag) return;
      const dx = e.clientX - this._drag.x;
      const dy = e.clientY - this._drag.y;
      this._drag.x = e.clientX;
      this._drag.y = e.clientY;
      this._azimuth   -= dx * 0.005;
      this._elevation  = Math.max(ELEV_MIN, Math.min(ELEV_MAX, this._elevation + dy * 0.005));
      this._apply();
    });

    window.addEventListener('keydown', (e) => { this._keys[e.code] = true; });
    window.addEventListener('keyup',   (e) => { this._keys[e.code] = false; });
  }

  update(dt) {
    let fx = 0, fz = 0;
    if (this._keys['KeyW'] || this._keys['ArrowUp'])    fz -= 1;
    if (this._keys['KeyS'] || this._keys['ArrowDown'])  fz += 1;
    if (this._keys['KeyA'] || this._keys['ArrowLeft'])  fx -= 1;
    if (this._keys['KeyD'] || this._keys['ArrowRight']) fx += 1;
    if (fx === 0 && fz === 0) return;

    const speed = PAN_SPEED * (this._dist / 20) * dt;
    this._target.x += (fx * Math.cos(this._azimuth) + fz * Math.sin(this._azimuth)) * speed;
    this._target.z += (fz * Math.cos(this._azimuth) - fx * Math.sin(this._azimuth)) * speed;
    this._apply();
  }

  _apply() {
    const h = this._dist * Math.cos(this._elevation);
    const y = this._dist * Math.sin(this._elevation);
    this._cam.position.set(
      this._target.x + h * Math.sin(this._azimuth),
      this._target.y + y,
      this._target.z + h * Math.cos(this._azimuth)
    );
    this._cam.lookAt(this._target);
  }
}

import * as THREE from 'three';
import { Component } from '../gameobject.js';

export class DirectionalLight extends Component {
  constructor({ color = 0xffffff, intensity = 1 } = {}) {
    super();
    this._color     = color;
    this._intensity = intensity;
  }

  start() {
    const light = new THREE.DirectionalLight(this._color, this._intensity);
    light.position.copy(this.gameObject.position);
    light.castShadow = true;
    light.shadow.mapSize.set(2048, 2048);
    light.shadow.camera.near   =  0.5;
    light.shadow.camera.far    =  100;
    light.shadow.camera.left   = -30;
    light.shadow.camera.right  =  30;
    light.shadow.camera.top    =  30;
    light.shadow.camera.bottom = -30;
    this.gameObject.game.scene.add(light);
  }
}

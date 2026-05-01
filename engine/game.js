import * as THREE from 'three';

export class Game {
  constructor() {
    this.gameObjects = [];
    this._lastTime   = 0;
    this.camera      = null;

    this._initRenderer();
    this._initScene();
  }

  _initRenderer() {
    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setPixelRatio(window.devicePixelRatio);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    document.body.appendChild(this.renderer.domElement);

    window.addEventListener('resize', () => {
      if (!this.camera) return;
      this.camera.aspect = window.innerWidth / window.innerHeight;
      this.camera.updateProjectionMatrix();
      this.renderer.setSize(window.innerWidth, window.innerHeight);
    });
  }

  _initScene() {
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x87ceeb);
    this.scene.fog = new THREE.Fog(0x87ceeb, 60, 100);
    this.scene.add(new THREE.AmbientLight(0xffffff, 0.4));
  }

  add(gameObject) {
    gameObject.game = this;
    this.gameObjects.push(gameObject);
    this.scene.add(gameObject.object3D);
    gameObject.start();
    return gameObject;
  }

  remove(gameObject) {
    this.gameObjects = this.gameObjects.filter(g => g !== gameObject);
    this.scene.remove(gameObject.object3D);
    gameObject.destroy();
  }

  start() {
    this.renderer.setAnimationLoop((time) => this._tick(time));
  }

  _tick(time) {
    const dt = Math.min((time - this._lastTime) / 1000, 0.1);
    this._lastTime = time;
    for (const go of this.gameObjects) go.update(dt);
    this.onTick?.(dt);
    if (this.camera) this.renderer.render(this.scene, this.camera);
  }
}

import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';

export class Game {
  constructor({ container = document.body } = {}) {
    this.gameObjects     = [];
    this._lastTime       = 0;
    this.camera          = null;
    this._container      = container;
    this._sceneListeners = new Set();

    this._initRenderer();
    this._initScene();
  }

  // Multi-listener scene-change subscription. New code should use this.
  // The legacy `game.onSceneChange = fn` single-callback still fires too.
  // Returns an unsubscribe function.
  addSceneListener(fn) {
    this._sceneListeners.add(fn);
    return () => this._sceneListeners.delete(fn);
  }

  _notifySceneChange() {
    this.onSceneChange?.();
    for (const fn of this._sceneListeners) fn();
  }

  _initRenderer() {
    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setPixelRatio(window.devicePixelRatio);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    const w = this._container.clientWidth  || window.innerWidth;
    const h = this._container.clientHeight || window.innerHeight;
    this.renderer.setSize(w, h);
    this._container.appendChild(this.renderer.domElement);

    const ro = new ResizeObserver(() => {
      const w = this._container.clientWidth;
      const h = this._container.clientHeight;
      if (!w || !h) return;
      if (this.camera) {
        this.camera.aspect = w / h;
        this.camera.updateProjectionMatrix();
      }
      this.renderer.setSize(w, h);
    });
    ro.observe(this._container);
  }

  _initScene() {
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x87ceeb);
    this.scene.fog = new THREE.Fog(0x87ceeb, 60, 100);
    this.scene.add(new THREE.AmbientLight(0xffffff, 0.4));

    // Environment map so GLTF PBR materials (especially metallic ones) aren't pitch-black
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    this.scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    pmrem.dispose();
  }

  add(gameObject) {
    gameObject.game = this;
    this.gameObjects.push(gameObject);
    this.scene.add(gameObject.object3D);
    gameObject.start();
    this._notifySceneChange();
    return gameObject;
  }

  remove(gameObject) {
    this.gameObjects = this.gameObjects.filter(g => g !== gameObject);
    this.scene.remove(gameObject.object3D);
    gameObject.destroy();
    this._notifySceneChange();
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

import * as THREE from 'three';

const CAM_DIST_MIN  = 5;
const CAM_DIST_MAX  = 60;
const CAM_ELEV_MIN  = 0.2;          // ~11° — low dramatic angle
const CAM_ELEV_MAX  = Math.PI / 2 - 0.05; // ~87° — near top-down
const CAM_PAN_SPEED = 12;           // world units/sec at reference zoom

export class Game {
  constructor() {
    this.gameObjects  = [];
    this._lastTime    = 0;
    this._camTarget   = new THREE.Vector3(0, 0, 0);
    this._camDist     = 24;
    this._camAzimuth  = 0;                // horizontal rotation (radians)
    this._camElevation = Math.PI / 4;     // vertical tilt (radians)
    this._keys        = {};
    this._drag        = null;

    this._initRenderer();
    this._initScene();
    this._initCameraControls();
  }

  _initRenderer() {
    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setPixelRatio(window.devicePixelRatio);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    document.body.appendChild(this.renderer.domElement);

    window.addEventListener('resize', () => {
      this.camera.aspect = window.innerWidth / window.innerHeight;
      this.camera.updateProjectionMatrix();
      this.renderer.setSize(window.innerWidth, window.innerHeight);
    });
  }

  _initScene() {
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x87a96b);
    this.scene.fog = new THREE.Fog(0x87a96b, 50, 90);

    this.camera = new THREE.PerspectiveCamera(45, window.innerWidth / window.innerHeight, 0.1, 500);
    this._applyCamera();

    const ambient = new THREE.AmbientLight(0xffffff, 0.5);
    this.scene.add(ambient);

    const sun = new THREE.DirectionalLight(0xfff4cc, 1.4);
    sun.position.set(15, 30, 10);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    sun.shadow.camera.near   = 0.5;
    sun.shadow.camera.far    = 100;
    sun.shadow.camera.left   = -30;
    sun.shadow.camera.right  =  30;
    sun.shadow.camera.top    =  30;
    sun.shadow.camera.bottom = -30;
    this.scene.add(sun);
  }

  _applyCamera() {
    const h = this._camDist * Math.cos(this._camElevation);
    const y = this._camDist * Math.sin(this._camElevation);
    this.camera.position.set(
      this._camTarget.x + h * Math.sin(this._camAzimuth),
      this._camTarget.y + y,
      this._camTarget.z + h * Math.cos(this._camAzimuth)
    );
    this.camera.lookAt(this._camTarget);
  }

  _initCameraControls() {
    const el = this.renderer.domElement;

    // Scroll → zoom
    el.addEventListener('wheel', (e) => {
      this._camDist = Math.max(CAM_DIST_MIN, Math.min(CAM_DIST_MAX, this._camDist + e.deltaY * 0.05));
      this._applyCamera();
    }, { passive: true });

    // Middle-mouse drag → orbit (horizontal = azimuth, vertical = elevation)
    el.addEventListener('mousedown', (e) => {
      if (e.button === 1) {
        this._drag = { x: e.clientX, y: e.clientY };
        e.preventDefault();
      }
    });
    window.addEventListener('mouseup', (e) => {
      if (e.button === 1) this._drag = null;
    });
    window.addEventListener('mousemove', (e) => {
      if (!this._drag) return;
      const dx = e.clientX - this._drag.x;
      const dy = e.clientY - this._drag.y;
      this._drag.x = e.clientX;
      this._drag.y = e.clientY;

      this._camAzimuth  -= dx * 0.005;
      this._camElevation = Math.max(CAM_ELEV_MIN, Math.min(CAM_ELEV_MAX, this._camElevation + dy * 0.005));
      this._applyCamera();
    });

    // WASD / arrow keys → pan
    window.addEventListener('keydown', (e) => { this._keys[e.code] = true; });
    window.addEventListener('keyup',   (e) => { this._keys[e.code] = false; });
  }

  _updateCameraPan(dt) {
    let fx = 0, fz = 0;

    if (this._keys['KeyW'] || this._keys['ArrowUp'])    fz -= 1;
    if (this._keys['KeyS'] || this._keys['ArrowDown'])  fz += 1;
    if (this._keys['KeyA'] || this._keys['ArrowLeft'])  fx -= 1;
    if (this._keys['KeyD'] || this._keys['ArrowRight']) fx += 1;

    if (fx === 0 && fz === 0) return;

    // Pan relative to camera azimuth so WASD always feels like forward/back/left/right
    const speed = CAM_PAN_SPEED * (this._camDist / 20) * dt;
    const cos = Math.cos(this._camAzimuth);
    const sin = Math.sin(this._camAzimuth);

    this._camTarget.x += (fx * cos + fz * sin) * speed;
    this._camTarget.z += (fz * cos - fx * sin) * speed;
    this._applyCamera();
  }

  add(gameObject) {
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
    this._updateCameraPan(dt);
    for (const go of this.gameObjects) go.update(dt);
    this.onTick?.(dt);
    this.renderer.render(this.scene, this.camera);
  }
}

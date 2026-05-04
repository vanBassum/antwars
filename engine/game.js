import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { Component } from './gameobject.js';

export class Game {
  constructor({ container = document.body } = {}) {
    this.gameObjects     = [];
    this._lastTime       = 0;
    this.elapsed         = 0;  // cumulative game time in seconds
    this.timeScale       = 1;  // 0 = paused, 1 = normal, 2 = 2x, etc.
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

    // GPU-side timing via EXT_disjoint_timer_query_webgl2. Required because
    // WebGL is async — renderer.render() submits commands and returns; the
    // GPU does the work later. CPU-side performance.now() can't tell us
    // whether a fat render is JS+driver overhead or actual GPU work.
    // Results trail by a few frames (queries are read after they complete).
    const gl = this.renderer.getContext();
    this._gpuTimerExt = gl.getExtension('EXT_disjoint_timer_query_webgl2');
    this._pendingGpuQueries = [];
    this._lastGpuMs = 0;

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
    // requestAnimationFrame (used by setAnimationLoop) is already vsync-locked
    // to the display refresh rate, so no software cap is needed — running at
    // 60/120/144Hz is fine. The earlier "3000 FPS" reading was a display bug
    // (FPS calc was inverting work-time, not interval) — fixed by frameInterval
    // below.
    const elapsedMs = time - this._lastTime;
    const rawDt = Math.min(elapsedMs / 1000, 0.1);
    this._lastTime = time;
    const dt = rawDt * this.timeScale;
    this.elapsed += dt;

    if (Component.profileEnabled) Component.resetProfile();

    const t0 = performance.now();
    for (const go of this.gameObjects) go.update(dt);
    const t1 = performance.now();
    this.onTick?.(dt);
    const t2 = performance.now();

    // Render — split into:
    //   render·matrix   : scene.updateMatrixWorld (recursive transform refresh)
    //   render·three    : the rest of renderer.render (build render list, submit
    //                     draw calls, shadow + main passes — all CPU-side WebGL)
    //   render·gpu      : actual GPU-side work, measured via EXT timer query
    //                     (async; reads results from previous frames)
    let matrixMs = 0, threeMs = 0;
    if (this.camera) {
      const tm0 = performance.now();
      this.scene.updateMatrixWorld(true);
      const tm1 = performance.now();
      matrixMs = tm1 - tm0;

      const ext = this._gpuTimerExt;
      const gl  = ext ? this.renderer.getContext() : null;
      let query = null;
      if (ext && gl) {
        query = gl.createQuery();
        gl.beginQuery(ext.TIME_ELAPSED_EXT, query);
      }

      const tr0 = performance.now();
      this.renderer.render(this.scene, this.camera);
      const tr1 = performance.now();
      threeMs = tr1 - tr0;

      if (ext && gl && query) {
        gl.endQuery(ext.TIME_ELAPSED_EXT);
        this._pendingGpuQueries.push(query);
        // Drain any completed queries — typically 1-3 frames behind submission.
        while (this._pendingGpuQueries.length > 0) {
          const q = this._pendingGpuQueries[0];
          if (!gl.getQueryParameter(q, gl.QUERY_RESULT_AVAILABLE)) break;
          const disjoint = gl.getParameter(ext.GPU_DISJOINT_EXT);
          if (!disjoint) {
            this._lastGpuMs = gl.getQueryParameter(q, gl.QUERY_RESULT) / 1e6;
          }
          gl.deleteQuery(q);
          this._pendingGpuQueries.shift();
        }
      }
    }

    const t3 = performance.now();

    // Expose per-frame subsystem timings (ms) for perf overlay
    this.frameTiming = {
      update: t1 - t0,
      logic:  t2 - t1,
      render: t3 - t2,
      renderMatrix: matrixMs,
      renderThree:  threeMs,
      renderGpu:    this._lastGpuMs,
      total:  t3 - t0,
      // Wall-clock interval since the last tick that actually ran. Use this
      // for FPS — `total` is just the work time inside _tick.
      frameInterval: elapsedMs,
      components: Component.profileEnabled ? Component.snapshotProfile() : null,
    };
  }
}


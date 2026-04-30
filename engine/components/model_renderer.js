import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { Component } from '../gameobject.js';

const loader = new GLTFLoader();

export class ModelRenderer extends Component {
  constructor(path) {
    super();
    this.path   = path;
    this._root  = null;
    this._state = 'loading'; // 'loading' | 'ready' | 'failed'
  }

  get isReady()  { return this._state === 'ready'; }
  get isFailed() { return this._state === 'failed'; }

  start() {
    loader.load(
      this.path,
      (gltf) => {
        this._root = gltf.scene;
        this._root.traverse(node => {
          if (node.isMesh) {
            node.castShadow    = true;
            node.receiveShadow = true;
          }
        });
        this._state = 'ready';
        this.gameObject.object3D.add(this._root);
        this.onLoaded?.(gltf);
      },
      undefined,
      (err) => {
        this._state = 'failed';
        console.error(`[ModelRenderer] failed to load "${this.path}"`, err);
      }
    );
  }

  destroy() {
    if (this._root) {
      this.gameObject.object3D.remove(this._root);
      this._root = null;
    }
    this._state = 'loading';
  }
}

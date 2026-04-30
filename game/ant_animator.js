import * as THREE from 'three';
import { Component } from '../engine/gameobject.js';
import { Mover } from '../engine/components/mover.js';

export class AntAnimator extends Component {
  constructor() {
    super();
    this._mixer  = null;
    this._walk   = null;
    this._legs   = [];
    this._root   = null;  // scene root for body bob
    this._baseY  = 0;
    this._time   = 0;
    this._speed  = 0;
  }

  setup(gltf) {
    this._root  = gltf.scene;
    this._baseY = gltf.scene.position.y;

    // Baked animations
    if (gltf.animations?.length > 0) {
      this._mixer = new THREE.AnimationMixer(gltf.scene);
      const clip  = gltf.animations.find(a => /walk/i.test(a.name)) ?? gltf.animations[0];
      this._walk  = this._mixer.clipAction(clip);
      this._walk.play();
      this._walk.paused = true;
      console.log('[animator] baked clips:', gltf.animations.map(a => a.name));
      return;
    }

    // Known leg names from base_ant_prefab_v1.glb — pivot at hip, extends along X
    const LEG_NAMES = [
      'leg_front_left',  'leg_front_right',
      'leg_mid_left',    'leg_mid_right',
      'leg_back_left',   'leg_back_right',
    ];

    gltf.scene.traverse(obj => {
      const idx = LEG_NAMES.indexOf(obj.name);
      if (idx === -1) return;
      const isLeft = obj.name.endsWith('_left');
      this._legs.push({ node: obj, baseRot: obj.rotation.clone(), isLeft, index: idx });
    });
  }

  update(dt) {
    const mover  = this.gameObject.getComponent(Mover);
    const moving = mover ? !mover.arrived : false;

    const target = moving ? 1 : 0;
    this._speed += (target - this._speed) * Math.min(dt * 8, 1);
    if (this._speed < 0.005) return;

    this._time += dt * this._speed;
    const t     = this._time;
    const sp    = this._speed;

    // Baked: drive mixer time by speed
    if (this._mixer && this._walk) {
      this._walk.paused = false;
      this._mixer.update(dt * sp * 1.5);
      return;
    }

    // Body bob — works regardless of model structure
    if (this._root) {
      this._root.position.y = this._baseY + 0.04 * Math.abs(Math.sin(t * 8)) * sp;
      this._root.rotation.x = 0.04 * Math.sin(t * 4) * sp;  // gentle pitch
    }

    // Leg swing — try Z axis (forward-facing ant, legs extend along X)
    // Left and right legs swing in opposite directions
    for (const { node, baseRot, isLeft, index } of this._legs) {
      const side  = isLeft ? 1 : -1;
      const phase = (index % 2 === 0 ? 0 : Math.PI);        // tripod gait
      node.rotation.z = baseRot.z + side * 0.35 * Math.sin(t * 7 + phase) * sp;
    }
  }
}

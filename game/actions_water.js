import * as THREE from 'three';
import { Action } from '../engine/ai/goap/action.js';
import { Mover } from '../engine/components/mover.js';
import { SocketAttacher } from '../engine/components/socket_attacher.js';
import { ResourceManager } from './resources.js';
import { PropLoader } from './prop_loader.js';

const LEAF    = 'assets/models/leaf.glb';
const STRAW   = 'assets/models/straw_tool.glb';
const GLUCOSE = 'assets/models/glucose_blob.glb';

export class MoveToDockAction extends Action {
  constructor(duckGO) {
    super('MoveToDock');
    this.target        = duckGO;
    this.preconditions = { atDock: false };
    this.effects       = { atDock: true };
  }
  enter(agent) {
    agent.gameObject.getComponent(Mover)?.moveTo(this.target.position);
    const sockets = agent.gameObject.getComponent(SocketAttacher);
    sockets?.clear('SOCKET_mouth_front');
    const straw = PropLoader.clone(STRAW);
    if (straw) sockets?.attach('SOCKET_mouth_front', straw);
  }
  perform(agent) { return agent.gameObject.getComponent(Mover)?.arrived ?? true; }
}

export class BoardDuckAction extends Action {
  constructor(duck) {
    super('BoardDuck');
    this.duck          = duck;
    this.preconditions = { atDock: true, onDuck: false };
    this.effects       = { onDuck: true };
  }
  // Returns false (keeps waiting) when the duck is full — other ants queue at the dock
  perform(agent) {
    if (!this.duck.hasRoom) return false;
    return this.duck.board(agent.gameObject);
  }
}

export class GatherWaterAction extends Action {
  constructor(duck) {
    super('GatherWater');
    this.duck          = duck;
    this.preconditions = { onDuck: true, hasWater: false };
    this.effects       = { hasWater: true, onDuck: false };
    this._timer = 0;
    this._blob  = null;
    this._clonedMats = [];
  }
  enter(agent) {
    this._timer = 0;
    this._clonedMats = [];
    const sockets = agent.gameObject.getComponent(SocketAttacher);
    this._blob = PropLoader.clone(GLUCOSE);
    if (this._blob) {
      // Blue tint — water instead of glucose; track clones for disposal
      this._blob.traverse(child => {
        if (child.isMesh && child.material) {
          const mat = child.material.clone();
          mat.color.setHex(0x2299ee);
          child.material = mat;
          this._clonedMats.push(mat);
        }
      });
      this._blob.scale.setScalar(0.05);
      sockets?.attach('SOCKET_back_carry', this._blob, { position: new THREE.Vector3(0, 0.08, 0) });
    }
  }
  perform(_agent, dt) {
    this._timer += dt;
    const t = Math.min(this._timer / 2, 1);
    const s = t * t * (3 - 2 * t);
    this._blob?.scale.setScalar(0.05 + 1.4 * s);
    return this._timer >= 2;
  }
  exit(agent) {
    this.duck.disembark(agent.gameObject);
    agent.gameObject.getComponent(SocketAttacher)?.clear('SOCKET_mouth_front');
  }
  destroy() {
    for (const mat of this._clonedMats) mat.dispose();
    this._clonedMats = [];
  }
}

export class ReturnToBaseWaterAction extends Action {
  constructor(baseGO) {
    super('ReturnToBaseWater');
    this.target        = baseGO;
    this.preconditions = { hasWater: true, onDuck: false, atBase: false };
    this.effects       = { atBase: true };
  }
  enter(agent) {
    const p = this.target.position;
    agent.gameObject.getComponent(Mover)?.moveTo({ x: p.x - 2, z: p.z - 2 });
  }
  perform(agent) { return agent.gameObject.getComponent(Mover)?.arrived ?? true; }
}

export class DepositWaterAction extends Action {
  constructor(team) {
    super('DepositWater');
    this.team          = team;
    this.preconditions = { atBase: true, hasWater: true };
    this.effects       = { deliveredWater: true };
  }
  perform(agent) {
    ResourceManager.add(this.team, 'water', 10);
    const sockets = agent.gameObject.getComponent(SocketAttacher);
    sockets?.clear('SOCKET_back_carry');
    const leaf = PropLoader.clone(LEAF);
    if (leaf) sockets?.attach('SOCKET_back_carry', leaf);
    return true;
  }
}

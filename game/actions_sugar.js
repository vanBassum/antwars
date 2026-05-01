import * as THREE from 'three';
import { Action } from '../engine/ai/goap/action.js';
import { Mover } from '../engine/components/mover.js';
import { SocketAttacher } from '../engine/components/socket_attacher.js';
import { ResourceNode, ResourceManager } from './resources.js';
import { PropLoader } from './prop_loader.js';

const LEAF    = 'assets/models/leaf.glb';
const STRAW   = 'assets/models/straw_tool.glb';
const GLUCOSE = 'assets/models/glucose_blob.glb';

// Walking to the resource node — straw appears in mouth
// getNode: () => GameObject  — callback so workers can be reassigned to a new node
export class MoveToResourceAction extends Action {
  constructor(getNode) {
    super('MoveToResource');
    this.getNode       = getNode;
    this.preconditions = { atResource: false };
    this.effects       = { atResource: true };
  }
  enter(agent) {
    const node = this.getNode();
    agent._gatherTarget = node;
    agent.gameObject.getComponent(Mover)?.moveTo(node.position);
    const sockets = agent.gameObject.getComponent(SocketAttacher);
    sockets?.clear('SOCKET_mouth_front');
    const straw = PropLoader.clone(STRAW);
    if (straw) sockets?.attach('SOCKET_mouth_front', straw);
  }
  perform(agent, _dt) {
    if (agent._gatherTarget?.getComponent?.(ResourceNode)?.depleted) {
      agent.worldState.atResource = false;
      agent.invalidate();
      return false;
    }
    return agent.gameObject.getComponent(Mover)?.arrived ?? true;
  }
}

// Gathering — glucose blob grows on back over 2 seconds
export class GatherAction extends Action {
  constructor() {
    super('Gather');
    this.preconditions = { atResource: true, hasResource: false };
    this.effects       = { hasResource: true };
    this._timer = 0;
    this._blob  = null;
  }
  enter(agent) {
    this._timer = 0;
    const sockets = agent.gameObject.getComponent(SocketAttacher);
    this._blob = PropLoader.clone(GLUCOSE);
    if (this._blob) {
      this._blob.scale.setScalar(0.05);
      sockets?.attach('SOCKET_back_carry', this._blob, { position: new THREE.Vector3(0, 0.08, 0) });
    }
  }
  perform(agent, dt) {
    this._timer += dt;
    const t = Math.min(this._timer / 2, 1);
    const s = t * t * (3 - 2 * t);
    this._blob?.scale.setScalar(0.05 + 1.4 * s);
    if (this._timer >= 2) {
      agent._gatherTarget?.getComponent?.(ResourceNode)?.harvest(10);
      return true;
    }
    return false;
  }
  exit(agent) {
    agent.gameObject.getComponent(SocketAttacher)?.clear('SOCKET_mouth_front');
  }
}

// Returning to base — full glucose blob on back
export class ReturnToBaseAction extends Action {
  constructor(baseGO) {
    super('ReturnToBase');
    this.target        = baseGO;
    this.preconditions = { hasResource: true, atBase: false };
    this.effects       = { atBase: true };
  }
  enter(agent) {
    const p = this.target.position;
    agent.gameObject.getComponent(Mover)?.moveTo({ x: p.x + 2, z: p.z + 2 });
  }
  perform(agent, _dt) { return agent.gameObject.getComponent(Mover)?.arrived ?? true; }
}

// Depositing — remove glucose blob, restore leaf
export class DropOffAction extends Action {
  constructor(team, resourceType) {
    super('DropOff');
    this.team          = team;
    this.resourceType  = resourceType;
    this.preconditions = { atBase: true, hasResource: true };
    this.effects       = { delivered: true };
  }
  perform(agent, _dt) {
    ResourceManager.add(this.team, this.resourceType, 10);
    const sockets = agent.gameObject.getComponent(SocketAttacher);
    sockets?.clear('SOCKET_back_carry');
    const leaf = PropLoader.clone(LEAF);
    if (leaf) sockets?.attach('SOCKET_back_carry', leaf);
    return true;
  }
}

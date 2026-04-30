import * as THREE from 'three';
import { Action } from '../ai/goap/action.js';
import { Mover } from '../engine/components/mover.js';
import { SocketAttacher } from '../engine/components/socket_attacher.js';
import { PropLoader } from './prop_loader.js';
import { Egg } from './egg.js';
import { Nursery } from './nursery.js';

const LEAF = 'assets/models/leaf.glb';

// ── Poll for an available egg. Worker idles here until the queen lays one.
export class FindEggAction extends Action {
  constructor() {
    super('FindEgg');
    this.preconditions = { foundEgg: false };
    this.effects       = { foundEgg: true };
  }

  perform(agent, _dt) {
    for (const egg of Egg.available) {
      egg.claim();
      agent._eggTarget = egg;
      return true; // got one
    }
    return false; // still waiting
  }
}

// ── Walk to the egg, then scoop it up on arrival.
export class MoveToEggAction extends Action {
  constructor() {
    super('MoveToEgg');
    this.preconditions = { foundEgg: true, hasEgg: false };
    this.effects       = { hasEgg: true };
  }

  enter(agent) {
    const egg = agent._eggTarget;
    if (!egg) return;
    // Snapshot position now — the GO will be removed on arrival
    agent._eggDest = { x: egg.gameObject.position.x, z: egg.gameObject.position.z };
    agent.gameObject.getComponent(Mover)?.moveTo(agent._eggDest);
  }

  perform(agent, _dt) {
    return agent.gameObject.getComponent(Mover)?.arrived ?? true;
  }

  exit(agent) {
    // Remove the physical egg from the world
    const egg = agent._eggTarget;
    if (egg) agent._game?.remove(egg.gameObject);

    // Show carried egg on worker's back socket
    const sockets = agent.gameObject.getComponent(SocketAttacher);
    sockets?.clear('SOCKET_back_carry');
    sockets?.attach('SOCKET_back_carry', _makeCarriedEgg());
  }
}

// ── Carry the egg to the nursery.
export class CarryToNurseryAction extends Action {
  constructor(nurseryGO) {
    super('CarryToNursery');
    this.nurseryGO     = nurseryGO;
    this.preconditions = { hasEgg: true, atNursery: false };
    this.effects       = { atNursery: true };
  }

  enter(agent) {
    const p = this.nurseryGO.position;
    agent.gameObject.getComponent(Mover)?.moveTo({ x: p.x, z: p.z });
  }

  perform(agent, _dt) {
    return agent.gameObject.getComponent(Mover)?.arrived ?? true;
  }
}

// ── Hand the egg to the nursery and restore the worker's leaf.
export class DepositEggAction extends Action {
  constructor() {
    super('DepositEgg');
    this.preconditions = { hasEgg: true, atNursery: true };
    this.effects       = { delivered: true };
  }

  perform(agent, _dt) {
    Nursery.instance?.acceptEgg();
    agent._eggTarget = null;

    const sockets = agent.gameObject.getComponent(SocketAttacher);
    sockets?.clear('SOCKET_back_carry');
    const leaf = PropLoader.clone(LEAF);
    if (leaf) sockets?.attach('SOCKET_back_carry', leaf);

    return true;
  }
}

// Small inline egg mesh — no GLB needed, just a quick prop for the carry visual.
function _makeCarriedEgg() {
  const geo  = new THREE.SphereGeometry(0.18, 8, 6);
  const mat  = new THREE.MeshLambertMaterial({ color: 0xf5edd8 });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.scale.set(0.9, 1.35, 0.9);
  mesh.castShadow = true;
  return mesh;
}

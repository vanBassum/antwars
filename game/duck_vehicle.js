import { Component } from '../engine/gameobject.js';
import { GOAPAgent } from '../engine/ai/goap/goap_agent.js';
import { GameObject } from '../engine/gameobject.js';
import { ModelRenderer } from '../engine/components/model_renderer.js';
import { Mover } from '../engine/components/mover.js';
import { SocketAttacher } from '../engine/components/socket_attacher.js';
import { Separation } from '../engine/components/separation.js';
import { Selectable } from '../engine/components/selectable.js';
import { AntAnimator } from './ant_animator.js';
import { PropLoader } from './prop_loader.js';
import {
  MoveToDockAction, BoardDuckAction, GatherWaterAction,
  ReturnToBaseWaterAction, DepositWaterAction,
} from './actions_water.js';

const LEAF = 'assets/models/leaf.glb';

// Floats on water, tracks up to `capacity` rider ants, bobs gently each frame.
export class DuckVehicle extends Component {
  constructor(capacity = 4) {
    super();
    this.capacity  = capacity;
    this._riders   = new Set();
    this._time     = 0;
    this._baseY    = 0;
  }

  start() {
    this._baseY = this.gameObject.position.y;
  }

  board(go) {
    if (this._riders.size >= this.capacity) return false;
    this._riders.add(go);
    return true;
  }

  disembark(go) {
    this._riders.delete(go);
  }

  get hasRoom()        { return this._riders.size < this.capacity; }
  get passengerCount() { return this._riders.size; }

  update(dt) {
    this._time += dt;
    this.gameObject.position.y           = this._baseY + Math.sin(this._time * 1.3)       * 0.055;
    this.gameObject.object3D.rotation.z  = Math.sin(this._time * 0.85)                    * 0.025;
    this.gameObject.object3D.rotation.x  = Math.sin(this._time * 1.1 + 0.6)               * 0.018;
  }
}

export function spawnWaterWorker(game, x, z, duckGO, baseGO, team = 'colony') {
  const worker  = new GameObject('WaterWorker');
  const mr      = worker.addComponent(new ModelRenderer('assets/models/base_ant_prefab_v1.glb'));
  const sockets = worker.addComponent(new SocketAttacher());
  const anim    = worker.addComponent(new AntAnimator());

  mr.onLoaded = (gltf) => {
    sockets.scanSockets(gltf);
    anim.setup(gltf);
    const leaf = PropLoader.clone(LEAF);
    if (leaf) sockets.attach('SOCKET_back_carry', leaf);
  };

  worker.addComponent(new Mover(3.5));
  worker.addComponent(new Separation());
  worker.addComponent(new Selectable());

  const duck  = duckGO.getComponent(DuckVehicle);
  const agent = worker.addComponent(new GOAPAgent());
  agent.actions = [
    new MoveToDockAction(duckGO),
    new BoardDuckAction(duck),
    new GatherWaterAction(duck),
    new ReturnToBaseWaterAction(baseGO),
    new DepositWaterAction(team),
  ];
  agent.worldState = { atDock: false, onDuck: false, hasWater: false, atBase: false, deliveredWater: false };
  agent.goal       = { deliveredWater: true };

  agent.onGoalReached = () => {
    agent.worldState = { atDock: false, onDuck: false, hasWater: false, atBase: false, deliveredWater: false };
    agent.invalidate();
  };

  worker.position.set(x, 0, z);
  worker.scale.setScalar(0.75);
  game.add(worker);
  return worker;
}

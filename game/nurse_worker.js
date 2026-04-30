import { GOAPAgent } from '../ai/goap/goap_agent.js';
import { GameObject } from '../engine/gameobject.js';
import { ModelRenderer } from '../engine/components/model_renderer.js';
import { Mover } from '../engine/components/mover.js';
import { SocketAttacher } from '../engine/components/socket_attacher.js';
import { Separation } from '../engine/components/separation.js';
import { Selectable } from '../engine/components/selectable.js';
import { AntAnimator } from './ant_animator.js';
import { PropLoader } from './prop_loader.js';
import {
  FindEggAction, MoveToEggAction,
  CarryToNurseryAction, DepositEggAction,
} from './actions_eggs.js';

const LEAF = 'assets/models/leaf.glb';

export function spawnNurseWorker(game, x, z, nurseryGO) {
  const worker  = new GameObject('NurseWorker');
  const mr      = worker.addComponent(new ModelRenderer('assets/models/base_ant_prefab_v1.glb'));
  const sockets = worker.addComponent(new SocketAttacher());
  const anim    = worker.addComponent(new AntAnimator());

  mr.onLoaded = (gltf) => {
    sockets.scanSockets(gltf);
    anim.setup(gltf);
    const leaf = PropLoader.clone(LEAF);
    if (leaf) sockets.attach('SOCKET_back_carry', leaf);
  };

  worker.addComponent(new Mover(3.2));
  worker.addComponent(new Separation());
  worker.addComponent(new Selectable());

  const agent = worker.addComponent(new GOAPAgent());
  agent._game = game; // MoveToEggAction needs this to remove the egg GO

  agent.actions = [
    new FindEggAction(),
    new MoveToEggAction(),
    new CarryToNurseryAction(nurseryGO),
    new DepositEggAction(),
  ];
  agent.worldState = { foundEgg: false, hasEgg: false, atNursery: false, delivered: false };
  agent.goal       = { delivered: true };

  agent.onGoalReached = () => {
    agent.worldState = { foundEgg: false, hasEgg: false, atNursery: false, delivered: false };
    agent.invalidate();
  };

  worker.position.set(x, 0, z);
  worker.scale.setScalar(0.75);
  game.add(worker);
  return worker;
}

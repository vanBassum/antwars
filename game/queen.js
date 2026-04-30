import { Component, GameObject } from '../engine/gameobject.js';
import { ModelRenderer } from '../engine/components/model_renderer.js';
import { Mover } from '../engine/components/mover.js';
import { SocketAttacher } from '../engine/components/socket_attacher.js';
import { Separation } from '../engine/components/separation.js';
import { Selectable } from '../engine/components/selectable.js';
import { AntAnimator } from './ant_animator.js';
import { Egg } from './egg.js';
import { ResourceManager } from './resources.js';

const ROAM_RADIUS  = 8;          // max wander distance from anthill centre
const LAY_INTERVAL = 20;         // seconds between egg-laying attempts
const LAY_COST     = { sugar: 25, water: 8 };
const PAUSE_RANGE  = [3, 8];     // [min, max] seconds to linger at each waypoint

class QueenBehavior extends Component {
  constructor(game, anthillPos) {
    super();
    this._game        = game;
    this._origin      = anthillPos.clone();
    this._layTimer    = LAY_INTERVAL * 0.4; // first egg comes sooner
    this._wanderTimer = 0;
  }

  start() {
    this._mover = this.gameObject.getComponent(Mover);
    // Snap to terrain height right away
    const p = this.gameObject.position;
    if (Mover.groundQuery) p.y = Mover.groundQuery(p.x, p.z);
    this._pickTarget();
  }

  update(dt) {
    // Wander — pick a new target once the queen stops and her pause expires
    if (this._mover.arrived) {
      this._wanderTimer -= dt;
      if (this._wanderTimer <= 0) this._pickTarget();
    }

    // Egg laying
    this._layTimer -= dt;
    if (this._layTimer <= 0) {
      this._layTimer = LAY_INTERVAL;
      this._tryLayEgg();
    }
  }

  _pickTarget() {
    const angle = Math.random() * Math.PI * 2;
    const dist  = 1.5 + Math.random() * ROAM_RADIUS;
    this._mover.moveTo({
      x: this._origin.x + Math.cos(angle) * dist,
      z: this._origin.z + Math.sin(angle) * dist,
    });
    this._wanderTimer = PAUSE_RANGE[0] + Math.random() * (PAUSE_RANGE[1] - PAUSE_RANGE[0]);
  }

  _tryLayEgg() {
    const canAfford = ResourceManager.get('colony', 'sugar') >= LAY_COST.sugar
                   && ResourceManager.get('colony', 'water') >= LAY_COST.water;
    if (!canAfford) return;

    ResourceManager.spend('colony', 'sugar', LAY_COST.sugar);
    ResourceManager.spend('colony', 'water', LAY_COST.water);

    const { x, z } = this.gameObject.position;
    const angle = Math.random() * Math.PI * 2;
    const r     = 1.0 + Math.random() * 1.5;
    const ex    = x + Math.cos(angle) * r;
    const ez    = z + Math.sin(angle) * r;
    const ey    = Mover.groundQuery ? Mover.groundQuery(ex, ez) + 0.15 : 0.15;

    const eggGO = new GameObject('Egg');
    eggGO.addComponent(new Egg());
    eggGO.position.set(ex, ey, ez);
    this._game.add(eggGO);
  }
}

export function spawnQueenAnt(game, anthillPos) {
  const queen   = new GameObject('QueenAnt');
  const mr      = queen.addComponent(new ModelRenderer('assets/models/hero_worker_ant_v1.glb'));
  const sockets = queen.addComponent(new SocketAttacher());
  const anim    = queen.addComponent(new AntAnimator());

  mr.onLoaded = (gltf) => {
    sockets.scanSockets(gltf);
    anim.setup(gltf);
  };

  queen.addComponent(new Mover(1.6));     // slow, regal pace
  queen.addComponent(new Separation());
  queen.addComponent(new Selectable());
  queen.addComponent(new QueenBehavior(game, anthillPos));

  // Start just outside the anthill entrance
  queen.position.set(anthillPos.x + 2, 0, anthillPos.z + 2);
  queen.scale.setScalar(2.2);             // visibly larger than workers
  game.add(queen);
  return queen;
}

import { Component } from '../../engine/gameobject.js';
import { ENTITY_DEFS } from '../entities.js';
import { cloneModel } from '../../engine/model_cache.js';

const EGG_MODEL_URL = 'assets/models/Egg.glb';

// Training Hut — accepts eggs delivered by workers and hatches them into
// new Worker ants. The player queues training requests via the context menu;
// each request consumes one egg on delivery and spawns a Worker at the hut.
export class TrainingHut extends Component {
  constructor() {
    super();
    this._queue    = 0;  // pending training requests
    this._eggMeshes = [];
  }

  get queueLength() { return this._queue; }

  // Player requests a new worker to be trained.
  enqueue() {
    this._queue++;
    // Nudge workers so they re-evaluate immediately instead of finishing
    // their current ambient cycle first (fixes training-queue starvation).
    const wm = this.gameObject.game?.workManager;
    if (wm) wm.preemptWorkers();
  }

  // Does this hut have pending requests waiting for an egg?
  hasPendingRequest() { return this._queue > 0; }

  // Worker delivers an egg — pop the front request and spawn an ant.
  receiveEgg() {
    if (this._queue <= 0) return false;
    this._queue--;
    this._spawnWorker();
    return true;
  }

  _spawnWorker() {
    const game = this.gameObject.game;
    const def  = ENTITY_DEFS.find(d => d.id === 'ant');
    if (!def || !game) return;

    const go = def.createObject();
    go.object3D.position.copy(this.gameObject.object3D.position);
    game.add(go);
  }

  // ── Context menu ────────────────────────────────────────────────────────
  getContextMenu() {
    const game = this.gameObject.game;
    const wm   = game?.workManager;
    const eggs  = wm ? wm.availableEggs() : 0;

    return {
      title: 'Training Hut',
      state: this._queue > 0
        ? `Training queue: ${this._queue}`
        : 'Idle',
      actions: [
        {
          icon:  '🐜',
          iconUrl: 'assets/icons/Ant.png',
          label: eggs > 0 ? 'Train Worker' : 'Train Worker (no eggs)',
          onClick: () => this.enqueue(),
        },
      ],
    };
  }
}

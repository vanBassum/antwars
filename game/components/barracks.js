import { Component } from '../../engine/gameobject.js';
import { ENTITY_DEFS } from '../entities.js';

// Barracks — accepts eggs delivered by workers and trains them into Soldier Ants.
// Works identically to TrainingHut but spawns soldier_ant instead of ant.
export class Barracks extends Component {
  constructor() {
    super();
    this._queue = 0;
  }

  get queueLength() { return this._queue; }

  enqueue() {
    this._queue++;
    const wm = this.gameObject.game?.workManager;
    if (wm) wm.preemptWorkers();
  }

  hasPendingRequest() { return this._queue > 0; }

  receiveEgg() {
    if (this._queue <= 0) return false;
    this._queue--;
    this._spawnSoldier();
    return true;
  }

  _spawnSoldier() {
    const game = this.gameObject.game;
    const def  = ENTITY_DEFS.find(d => d.id === 'soldier_ant');
    if (!def || !game) return;
    const go = def.createObject(game);
    go.object3D.position.copy(this.gameObject.object3D.position);
    game.add(go);
  }

  getContextMenu() {
    const game = this.gameObject.game;
    const wm   = game?.workManager;
    const eggs = wm ? wm.availableEggs() : 0;

    return {
      title: 'Barracks',
      state: this._queue > 0 ? `Training queue: ${this._queue}` : 'Idle',
      actions: [
        {
          icon:    '⚔️',
          iconUrl: 'assets/icons/SoldierAnt.png',
          label:   eggs > 0 ? 'Train Soldier' : 'Train Soldier (no eggs)',
          onClick: () => this.enqueue(),
        },
      ],
    };
  }
}

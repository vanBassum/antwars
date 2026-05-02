import { EggPickup } from './egg_pickup.js';
import { TrainingHut } from './training_hut.js';

// What an ant is currently delivering an egg to. Pure data holder; the
// WorkManager assigns the egg target and the training hut destination.
export class DeliverEggTask {
  constructor() {
    this.egg         = null; // EggPickup-bearing gameObject (the loose egg)
    this.trainingHut = null; // TrainingHut-bearing gameObject (delivery destination)
  }

  // True while we still have something to do — either fetching the egg
  // (pre-pickup) or carrying it to the training hut (post-pickup).
  hasTarget() { return !!this.egg || !!this.trainingHut; }

  isStillValid() {
    // Pre-pickup: the loose egg must still be in the field.
    if (this.egg) {
      if (!this.egg.game?.gameObjects.includes(this.egg)) return false;
      return !!this.egg.getComponent(EggPickup);
    }
    // Post-pickup: the training hut must still exist and still want a worker.
    if (this.trainingHut) {
      if (!this.trainingHut.game?.gameObjects.includes(this.trainingHut)) return false;
      const th = this.trainingHut.getComponent(TrainingHut);
      return !!th && th.hasPendingRequest();
    }
    return false;
  }

  // Pick up the egg — removes it from the world and clears our egg ref
  // so the worker validity sweep transitions to the post-pickup phase
  // instead of seeing "target gone" and abandoning the cycle.
  pickUp() {
    if (!this.egg) return false;
    const game = this.egg.game;
    if (!game) return false;
    game.remove(this.egg);
    this.egg = null;
    return true;
  }

  // Deliver the egg to the training hut. Returns true on success.
  dropOff() {
    if (!this.trainingHut) return false;
    const th = this.trainingHut.getComponent(TrainingHut);
    if (!th) return false;
    return th.receiveEgg();
  }

  clear() {
    this.egg         = null;
    this.trainingHut = null;
  }
}

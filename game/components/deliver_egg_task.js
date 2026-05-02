import { EggPickup } from './egg_pickup.js';
import { Nursery } from './nursery.js';

// What an ant is currently delivering an egg to. Pure data holder; the
// WorkManager assigns the egg target, and the nursery is resolved at pickup.
export class DeliverEggTask {
  constructor() {
    this.egg     = null; // EggPickup-bearing gameObject (the loose egg)
    this.nursery = null; // Nursery-bearing gameObject (delivery destination)
  }

  hasTarget() { return !!this.egg; }

  // Is the assigned egg still loose in the world?
  isStillValid() {
    if (!this.egg) return false;
    if (!this.egg.game?.gameObjects.includes(this.egg)) return false;
    return !!this.egg.getComponent(EggPickup);
  }

  // Pick up the egg — removes it from the world. Returns true on success.
  pickUp() {
    if (!this.egg) return false;
    const game = this.egg.game;
    if (!game) return false;
    game.remove(this.egg);
    return true;
  }

  // Deliver the egg to the nursery. Returns true on success.
  dropOff() {
    if (!this.nursery) return false;
    const n = this.nursery.getComponent(Nursery);
    if (!n) return false;
    n.receiveEgg();
    return true;
  }

  clear() {
    this.egg     = null;
    this.nursery = null;
  }
}

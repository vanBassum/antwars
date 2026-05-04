import { ResourceNode } from './resource_node.js';
import { FeedingTray } from './feeding_tray.js';

// What an ant is currently delivering sugar for. Pure data holder; the
// WorkManager assigns the sugar source and the feeding tray destination.
export class DeliverSugarTask {
  constructor() {
    this.source = null; // ResourceNode-bearing gameObject, or null for stockpile
    this.tray   = null; // FeedingTray-bearing gameObject (delivery destination)
    this._useStockpile = false;
  }

  hasTarget() { return !!this.tray; }

  get useStockpile() { return this._useStockpile; }

  isStillValid() {
    // The tray must still exist and still need sugar.
    if (!this.tray) return false;
    if (!this.tray.game?.gameObjects.includes(this.tray)) return false;
    const ft = this.tray.getComponent(FeedingTray);
    if (!ft || !ft.needsSugar()) return false;

    // If using a resource node, it must still exist and have sugar.
    if (this.source) {
      if (!this.source.game?.gameObjects.includes(this.source)) return false;
      const rn = this.source.getComponent(ResourceNode);
      if (!rn || rn.isEmpty) return false;
    }
    return true;
  }

  // Take 1 sugar from the source (resource node or stockpile).
  // Returns true on success.
  takeSugar(game) {
    if (this.source) {
      const rn = this.source.getComponent(ResourceNode);
      if (!rn) return false;
      return rn.take(1) > 0;
    }
    // Fallback: stockpile
    if (game.resources.get('sugar') <= 0) return false;
    game.resources.add('sugar', -1);
    return true;
  }

  // Deliver sugar to the feeding tray.
  dropOff() {
    if (!this.tray) return false;
    const ft = this.tray.getComponent(FeedingTray);
    if (!ft) return false;
    return ft.receiveSugar();
  }

  clear() {
    this.source        = null;
    this.tray          = null;
    this._useStockpile = false;
  }
}

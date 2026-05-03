import { ConstructionSite } from './construction_site.js';

// Worker's task descriptor for delivering one unit of construction material
// from the hive stockpile to a ConstructionSite.
export class DeliverMaterialTask {
  constructor() {
    this.site         = null; // gameObject with a ConstructionSite component
    this.materialType = null; // 'wood' | 'sugar' | ...
  }

  hasTarget() { return !!this.site; }

  isStillValid() {
    if (!this.site) return false;
    if (!this.site.game?.gameObjects.includes(this.site)) return false;
    const cs = this.site.getComponent(ConstructionSite);
    if (!cs || cs.isComplete()) return false;
    return cs.needsMaterial(this.materialType);
  }

  // Take 1 unit of materialType from the player stockpile.
  takeMaterial(game) {
    if (!this.materialType) return false;
    if ((game.resources?.get(this.materialType) ?? 0) <= 0) return false;
    game.resources.add(this.materialType, -1);
    return true;
  }

  // Drop 1 unit at the construction site.
  dropOff() {
    if (!this.site) return false;
    const cs = this.site.getComponent(ConstructionSite);
    if (!cs) return false;
    return cs.receiveMaterial(this.materialType);
  }

  clear() {
    this.site         = null;
    this.materialType = null;
  }
}

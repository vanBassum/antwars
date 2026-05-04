export class EntityDef {
  constructor({ id, name, icon, iconUrl = null, yOffset = 0, modelUrl = null, createObject, occupiesHex = false, entrance = null, constructionCost = null }) {
    this.id           = id;
    this.name         = name;
    this.icon         = icon;
    this.iconUrl      = iconUrl;
    this.yOffset      = yOffset;
    this.modelUrl     = modelUrl;
    this.createObject = createObject;
    this.occupiesHex  = occupiesHex;
    this.entrance     = entrance;          // [dq, dr] — neighbor offset that allows traversal, or null
    this.constructionCost = constructionCost; // { wood: N, ... } — null means no construction phase
  }
}

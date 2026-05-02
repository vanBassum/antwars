export class EntityDef {
  constructor({ id, name, icon, yOffset = 0, modelUrl = null, createObject, occupiesHex = false, entrance = null }) {
    this.id           = id;
    this.name         = name;
    this.icon         = icon;
    this.yOffset      = yOffset;
    this.modelUrl     = modelUrl;
    this.createObject = createObject;
    this.occupiesHex  = occupiesHex;
    this.entrance     = entrance; // [dq, dr] — neighbor offset that allows traversal, or null
  }
}

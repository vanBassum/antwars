export class EntityDef {
  constructor({ id, name, icon, yOffset = 0.5, createObject }) {
    this.id           = id;
    this.name         = name;
    this.icon         = icon;
    this.yOffset      = yOffset;
    this.createObject = createObject;
  }
}

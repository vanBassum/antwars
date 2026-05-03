import { Component } from '../../engine/gameobject.js';

export class FeedingTray extends Component {
  constructor() {
    super();
    this.level    = 0;
    this.capacity = 5;
  }

  needsSugar() { return this.level < this.capacity; }

  receiveSugar() {
    if (this.level >= this.capacity) return false;
    this.level++;
    return true;
  }

  drink() {
    if (this.level <= 0) return false;
    this.level--;
    return true;
  }

  getContextMenu() {
    return {
      title: 'Feeding Tray',
      state: `Sugar: ${this.level} / ${this.capacity}`,
    };
  }
}

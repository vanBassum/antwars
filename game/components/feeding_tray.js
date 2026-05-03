import { Component } from '../../engine/gameobject.js';

export class FeedingTray extends Component {
  constructor() {
    super();
    this.level    = 0;
    this.capacity = 5;
  }

  getContextMenu() {
    return {
      title: 'Feeding Tray',
      state: `Sugar: ${this.level} / ${this.capacity}`,
    };
  }
}

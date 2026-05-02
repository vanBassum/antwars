import { Component } from '../../engine/gameobject.js';

// Available crops. Functionality comes later — for now just selection.
export const FARM_CROPS = [
  { key: 'berry', icon: '🫐', label: 'Berry Bush' },
  { key: 'tree',  icon: '🌳', label: 'Tree' },
];

// A placeable plot that "grows" something. Pure data holder for now;
// the visual is the FarmPlot.glb model on the entity itself.
export class FarmPlot extends Component {
  constructor() {
    super();
    this.crop = null; // 'berry' | 'tree' | null
  }
}

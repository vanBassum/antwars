import { Component } from '../../engine/gameobject.js';

// Available crops. Functionality comes later — for now just selection.
export const FARM_CROPS = [
  { key: 'berry', icon: '🫐', label: 'Berry Bush' },
  { key: 'tree',  icon: '🌳', label: 'Tree' },
];

const cropLabel = (key) => FARM_CROPS.find(c => c.key === key)?.label ?? '';

// A placeable plot that "grows" something. Pure data holder for now;
// the visual is the FarmPlot.glb model on the entity itself.
export class FarmPlot extends Component {
  constructor() {
    super();
    this.crop     = null; // 'berry' | 'tree' | null
    this.growth   = 0;    // 0..1 — placeholder; no growth tick yet
  }

  // Click-to-open context menu descriptor consumed by ContextMenu.
  getContextMenu() {
    return {
      title: 'Farm Plot',
      state: this.crop ? `Growing: ${cropLabel(this.crop)}` : 'Empty plot',
      progress: this.crop ? {
        label: 'Growth',
        value: this.growth,
        text:  `${Math.round(this.growth * 100)}%`,
      } : null,
      actions: FARM_CROPS.map(c => ({
        icon:     c.icon,
        label:    c.label,
        selected: this.crop === c.key,
        onClick:  () => { this.crop = c.key; },
      })),
    };
  }
}

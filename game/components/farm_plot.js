import { Component } from '../../engine/gameobject.js';

export const FARM_CROPS = [
  { key: 'berry', icon: '🫐', label: 'Berry Bush' },
  { key: 'tree',  icon: '🌳', label: 'Tree' },
];

const cropName = (key) => FARM_CROPS.find(c => c.key === key)?.label ?? key;

const PULSE_DURATION = 0.4;

// A placeable plot that grows a crop over time. Ants tend the plot to add
// growth; the chosen crop persists across the growth cycle.
//
// Switching crop rules:
//   - empty plot       → switches immediately
//   - 0 < growth < 1   → queued (`pendingCrop`); current crop finishes first,
//                        then swap on completion
//   - fully grown      → switches immediately (loses the ripe plant)
//
// The visual is the FarmPlot.glb model on the entity itself; on water() we
// briefly pulse the scale as feedback.
export class FarmPlot extends Component {
  constructor() {
    super();
    this.crop        = null; // 'berry' | 'tree' | null
    this.growth      = 0;    // 0..1
    this.pendingCrop = null; // queued switch
    this._pulseT     = PULSE_DURATION; // settled
  }

  // Player-facing selection (called from the context menu).
  selectCrop(newCrop) {
    if (this.growth > 0 && this.growth < 1) {
      // In progress — queue (or clear queue if user re-picked the current crop)
      this.pendingCrop = newCrop === this.crop ? null : newCrop;
    } else {
      // Empty plot or fully ripe — switch immediately
      this.crop        = newCrop;
      this.growth      = 0;
      this.pendingCrop = null;
    }
  }

  // Ant-facing harvest: returns true if water was actually applied.
  water(amount = 0.1) {
    if (!this.crop || this.growth >= 1) return false;
    this.growth = Math.min(1, this.growth + amount);
    if (this.growth >= 1 && this.pendingCrop) {
      this.crop        = this.pendingCrop;
      this.growth      = 0;
      this.pendingCrop = null;
    }
    this._pulseT = 0;
    return true;
  }

  // Used by TendTask to filter candidates.
  needsAttention() { return !!this.crop && this.growth < 1; }

  update(dt) {
    if (this._pulseT >= PULSE_DURATION) {
      this.gameObject.object3D.scale.setScalar(1);
      return;
    }
    this._pulseT += dt;
    const p = Math.min(1, this._pulseT / PULSE_DURATION);
    const s = 1 + 0.08 * Math.sin(p * Math.PI); // gentle bump
    this.gameObject.object3D.scale.setScalar(s);
  }

  // Click-to-open context menu descriptor consumed by ContextMenu.
  getContextMenu() {
    let state;
    if (!this.crop)              state = 'Empty plot';
    else if (this.growth >= 1)   state = `Ripe: ${cropName(this.crop)}`;
    else if (this.pendingCrop)   state = `Growing: ${cropName(this.crop)} → ${cropName(this.pendingCrop)}`;
    else                         state = `Growing: ${cropName(this.crop)}`;

    return {
      title: 'Farm Plot',
      state,
      progress: this.crop ? {
        label: 'Growth',
        value: this.growth,
        text:  `${Math.round(this.growth * 100)}%`,
      } : null,
      actions: FARM_CROPS.map(c => ({
        icon:     c.icon,
        label:    c.label,
        selected: this.crop === c.key,
        onClick:  () => this.selectCrop(c.key),
      })),
    };
  }
}

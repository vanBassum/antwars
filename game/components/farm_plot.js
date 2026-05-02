import { Component } from '../../engine/gameobject.js';

export const FARM_CROPS = [
  { key: 'berry', icon: '🫐', label: 'Berry Bush' },
  { key: 'tree',  icon: '🌳', label: 'Tree' },
];

const cropName = (key) => FARM_CROPS.find(c => c.key === key)?.label ?? key;

const PULSE_DURATION    = 0.4;
const DECAY_RATE        = 0.05;  // water level lost per second  → full plot dries in 20s
const GROW_RATE         = 0.02;  // growth per second while watered → full grow in 50s
const REFILL_THRESHOLD  = 0.5;   // ants start being summoned below this water level
const DARKEN_AT_DRY     = 0.45;  // material color multiplier at waterLevel = 0

// A placeable plot that grows a crop over time. The plot needs water to
// keep growing — water decays over time; once it drops below
// REFILL_THRESHOLD the plot is "thirsty" and ants will bring a droplet.
// Watering refills it to 1.0. Crop only grows while waterLevel > 0; the
// model darkens as it dries so the dry state is visible at a glance.
//
// Crop switching:
//   empty plot or fully ripe → switches immediately
//   0 < growth < 1           → queued in pendingCrop; current crop finishes
//                              first, then swap on completion
export class FarmPlot extends Component {
  constructor() {
    super();
    this.crop        = null; // 'berry' | 'tree' | null
    this.growth      = 0;    // 0..1
    this.pendingCrop = null;
    this.waterLevel  = 1.0;  // 0..1
    this._pulseT     = PULSE_DURATION;
    this._materials  = [];   // cloned per-instance for safe tinting
  }

  // Player-facing.
  selectCrop(newCrop) {
    if (this.growth > 0 && this.growth < 1) {
      this.pendingCrop = newCrop === this.crop ? null : newCrop;
    } else {
      this.crop        = newCrop;
      this.growth      = 0;
      this.pendingCrop = null;
    }
  }

  // Ant-facing — refills the plot's water buffer. Returns false if the plot
  // doesn't actually need it (no crop, or already topped up).
  water() {
    if (!this.crop) return false;
    if (this.waterLevel >= 0.99) return false;
    this.waterLevel = 1.0;
    this._pulseT = 0;
    return true;
  }

  needsAttention() {
    return !!this.crop && this.growth < 1 && this.waterLevel < REFILL_THRESHOLD;
  }

  start() {
    // Clone materials per-instance so per-plot tinting doesn't bleed across
    // other entities sharing the same cached model.
    this.gameObject.object3D.traverse(obj => {
      if (!obj.isMesh || !obj.material) return;
      const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
      const cloned = mats.map(m => (m.color ? m.clone() : m));
      obj.material = Array.isArray(obj.material) ? cloned : cloned[0];
      for (const c of cloned) {
        if (c.color) this._materials.push({ mat: c, base: c.color.clone() });
      }
    });
  }

  destroy() {
    for (const { mat } of this._materials) mat.dispose();
    this._materials = [];
  }

  update(dt) {
    // Water decays only while a crop is planted and not fully grown.
    if (this.crop && this.growth < 1 && this.waterLevel > 0) {
      this.waterLevel = Math.max(0, this.waterLevel - DECAY_RATE * dt);
    }

    // Crop only grows while there's water in the soil.
    if (this.crop && this.growth < 1 && this.waterLevel > 0) {
      this.growth = Math.min(1, this.growth + GROW_RATE * dt);
      if (this.growth >= 1 && this.pendingCrop) {
        this.crop        = this.pendingCrop;
        this.growth      = 0;
        this.pendingCrop = null;
      }
    }

    // Tint the model darker as it dries.
    const factor = DARKEN_AT_DRY + (1 - DARKEN_AT_DRY) * this.waterLevel;
    for (const { mat, base } of this._materials) {
      mat.color.copy(base).multiplyScalar(factor);
    }

    // Scale pulse on watering.
    if (this._pulseT < PULSE_DURATION) {
      this._pulseT += dt;
      const p = Math.min(1, this._pulseT / PULSE_DURATION);
      const s = 1 + 0.08 * Math.sin(p * Math.PI);
      this.gameObject.object3D.scale.setScalar(s);
    } else {
      this.gameObject.object3D.scale.setScalar(1);
    }
  }

  getContextMenu() {
    let state;
    if (!this.crop)              state = 'Empty plot';
    else if (this.growth >= 1)   state = `Ripe: ${cropName(this.crop)}`;
    else if (this.pendingCrop)   state = `Growing: ${cropName(this.crop)} → ${cropName(this.pendingCrop)}`;
    else                         state = `Growing: ${cropName(this.crop)}`;

    const progress = [];
    if (this.crop) {
      progress.push({
        label: 'Growth',
        value: this.growth,
        text:  `${Math.round(this.growth * 100)}%`,
      });
      progress.push({
        label: 'Water',
        value: this.waterLevel,
        text:  this.waterLevel < REFILL_THRESHOLD ? 'thirsty' : `${Math.round(this.waterLevel * 100)}%`,
      });
    }

    return {
      title: 'Farm Plot',
      state,
      progress,
      actions: FARM_CROPS.map(c => ({
        icon:     c.icon,
        label:    c.label,
        selected: this.crop === c.key,
        onClick:  () => this.selectCrop(c.key),
      })),
    };
  }
}

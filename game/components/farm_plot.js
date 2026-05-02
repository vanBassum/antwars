import { Component } from '../../engine/gameobject.js';
import { cloneModel } from '../../engine/model_cache.js';

export const FARM_CROPS = [
  { key: 'berry', icon: '🫐', label: 'Berry Bush' },
  { key: 'tree',  icon: '🌳', label: 'Tree' },
];

// Lifecycle states. Other systems (WorkManager) react to these.
export const FARM_STATE = {
  IDLE:           'idle',           // empty plot
  AWAITING_SEED:  'awaiting_seed',  // crop picked, no seed delivered yet
  GROWING:        'growing',        // seed delivered, crop scaling up
  GROWN:          'grown',          // full size, awaiting harvest (TBD)
};

const cropName = (key) => FARM_CROPS.find(c => c.key === key)?.label ?? key;

// Crop visuals (separate child mesh on top of the plot).
const CROP_MODELS = {
  berry: 'assets/models/BerryBush.glb',
  tree:  'assets/models/Bush.glb',  // placeholder until a Tree.glb exists
};

const GROW_STEPS  = 5;
const STEP_SCALES = Array.from({ length: GROW_STEPS }, (_, i) => 0.2 + i * 0.2); // 0.2..1.0

const PULSE_DURATION   = 0.4;   // plot scale pulse on water
const BOINK_DURATION   = 0.3;   // crop mesh overshoot pulse on step-up
const DECAY_RATE       = 0.05;  // water lost per second while GROWING
const GROW_RATE        = 0.02;  // growth per second while GROWING + watered
const REFILL_THRESHOLD = 0.5;
const DARKEN_AT_DRY    = 0.45;

export class FarmPlot extends Component {
  constructor() {
    super();
    this._state       = FARM_STATE.IDLE;
    this.crop         = null;
    this.pendingCrop  = null;
    this.growth       = 0;     // 0..1
    this.waterLevel   = 1.0;   // 0..1, only matters while GROWING

    this._cropMesh    = null;  // separate child object3D for the crop visual
    this._lastStep    = -1;
    this._cropPulseT  = BOINK_DURATION;

    this._waterPulseT = PULSE_DURATION;
    this._materials   = [];    // cloned per-instance for safe tinting
  }

  get state() { return this._state; }

  // Player-facing.
  selectCrop(newCrop) {
    if (!newCrop) { this._setIdle(); return; }
    switch (this._state) {
      case FARM_STATE.IDLE:
        this._setAwaitingSeed(newCrop);
        break;
      case FARM_STATE.AWAITING_SEED:
        // Same target state; just swap the desired crop.
        this.crop        = newCrop;
        this.pendingCrop = null;
        break;
      case FARM_STATE.GROWING:
        // Queue while in progress (or clear queue if user re-picked current).
        this.pendingCrop = newCrop === this.crop ? null : newCrop;
        break;
      case FARM_STATE.GROWN:
        // Replace immediately, lose the ripe crop.
        this._setAwaitingSeed(newCrop);
        break;
    }
  }

  // Ant-facing — called when seed delivery completes.
  deliverSeed() {
    if (this._state !== FARM_STATE.AWAITING_SEED) return false;
    this._setGrowing();
    return true;
  }

  // Ant-facing — called when watering visit lands.
  water() {
    if (this._state !== FARM_STATE.GROWING)  return false;
    if (this.waterLevel >= 0.99)             return false;
    this.waterLevel  = 1.0;
    this._waterPulseT = 0;
    return true;
  }

  // WorkManager queries.
  needsSeed()      { return this._state === FARM_STATE.AWAITING_SEED; }
  needsAttention() {
    return this._state === FARM_STATE.GROWING
        && this.growth < 1
        && this.waterLevel < REFILL_THRESHOLD;
  }

  start() {
    this.gameObject.object3D.traverse(obj => {
      if (!obj.isMesh || !obj.material) return;
      const mats   = Array.isArray(obj.material) ? obj.material : [obj.material];
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
    this._removeCropMesh();
  }

  update(dt) {
    if (this._state === FARM_STATE.GROWING) {
      this.waterLevel = Math.max(0, this.waterLevel - DECAY_RATE * dt);
      if (this.waterLevel > 0 && this.growth < 1) {
        this.growth = Math.min(1, this.growth + GROW_RATE * dt);
        if (this.growth >= 1) this._setGrown();
      }
    }

    // Stepped crop scale + boink on step transitions.
    if (this._cropMesh) {
      const step = this._currentStep();
      const target = STEP_SCALES[step];
      if (step !== this._lastStep) {
        this._cropPulseT = 0;
        this._lastStep   = step;
      }
      let s = target;
      if (this._cropPulseT < BOINK_DURATION) {
        this._cropPulseT += dt;
        const p = Math.min(1, this._cropPulseT / BOINK_DURATION);
        s = target * (1 + 0.22 * Math.sin(p * Math.PI)); // overshoot+settle
      }
      this._cropMesh.scale.setScalar(s);
    }

    // Plot tint — only meaningful while GROWING; reset to base otherwise.
    if (this._state === FARM_STATE.GROWING) {
      const factor = DARKEN_AT_DRY + (1 - DARKEN_AT_DRY) * this.waterLevel;
      for (const { mat, base } of this._materials) {
        mat.color.copy(base).multiplyScalar(factor);
      }
    } else {
      for (const { mat, base } of this._materials) mat.color.copy(base);
    }

    // Plot scale pulse on watering.
    if (this._waterPulseT < PULSE_DURATION) {
      this._waterPulseT += dt;
      const p = Math.min(1, this._waterPulseT / PULSE_DURATION);
      const s = 1 + 0.08 * Math.sin(p * Math.PI);
      this.gameObject.object3D.scale.setScalar(s);
    } else {
      this.gameObject.object3D.scale.setScalar(1);
    }
  }

  _currentStep() {
    if (this.growth >= 1) return GROW_STEPS - 1;
    return Math.min(GROW_STEPS - 1, Math.floor(this.growth * GROW_STEPS));
  }

  // ── State transitions ──────────────────────────────────────────────────
  _setIdle() {
    this._state       = FARM_STATE.IDLE;
    this.crop         = null;
    this.pendingCrop  = null;
    this.growth       = 0;
    this.waterLevel   = 1.0;
    this._removeCropMesh();
  }
  _setAwaitingSeed(crop) {
    this._state       = FARM_STATE.AWAITING_SEED;
    this.crop         = crop;
    this.pendingCrop  = null;
    this.growth       = 0;
    this.waterLevel   = 1.0;
    this._removeCropMesh();
  }
  _setGrowing() {
    this._state     = FARM_STATE.GROWING;
    this.growth     = 0;
    this.waterLevel = 1.0;
    this._spawnCropMesh();
  }
  _setGrown() {
    this._state = FARM_STATE.GROWN;
    // If the player queued a switch while it was growing, kick off the next.
    if (this.pendingCrop) {
      const next = this.pendingCrop;
      this._setAwaitingSeed(next);
    }
  }

  _spawnCropMesh() {
    this._removeCropMesh();
    const url = CROP_MODELS[this.crop];
    if (!url) return;
    let mesh;
    try { mesh = cloneModel(url); } catch { return; }
    mesh.scale.setScalar(STEP_SCALES[0]);
    this.gameObject.object3D.add(mesh);
    this._cropMesh   = mesh;
    this._lastStep   = 0;
    this._cropPulseT = 0; // boink on spawn
  }

  _removeCropMesh() {
    if (this._cropMesh) {
      this.gameObject.object3D.remove(this._cropMesh);
      this._cropMesh = null;
    }
    this._lastStep = -1;
  }

  getContextMenu() {
    let stateText;
    switch (this._state) {
      case FARM_STATE.IDLE:
        stateText = 'Empty plot'; break;
      case FARM_STATE.AWAITING_SEED:
        stateText = `Waiting for ${cropName(this.crop)} seed`; break;
      case FARM_STATE.GROWING:
        stateText = this.pendingCrop
          ? `Growing: ${cropName(this.crop)} → ${cropName(this.pendingCrop)}`
          : `Growing: ${cropName(this.crop)}`;
        break;
      case FARM_STATE.GROWN:
        stateText = `Ripe: ${cropName(this.crop)}`; break;
    }

    const progress = [];
    if (this._state === FARM_STATE.GROWING || this._state === FARM_STATE.GROWN) {
      progress.push({
        label: 'Growth',
        value: this.growth,
        text:  `${Math.round(this.growth * 100)}%`,
      });
    }
    if (this._state === FARM_STATE.GROWING) {
      progress.push({
        label: 'Water',
        value: this.waterLevel,
        text:  this.waterLevel < REFILL_THRESHOLD ? 'thirsty' : `${Math.round(this.waterLevel * 100)}%`,
      });
    }

    return {
      title: 'Farm Plot',
      state: stateText,
      progress,
      picker: {
        options: FARM_CROPS.map(c => ({
          icon:     c.icon,
          label:    c.label,
          selected: this.crop === c.key,
          onClick:  () => this.selectCrop(c.key),
        })),
      },
    };
  }
}

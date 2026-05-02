import { Component } from '../../engine/gameobject.js';
import { cloneModel } from '../../engine/model_cache.js';

// `count` is how many crop instances spawn on the plot when it ripens —
// each gets harvested individually for +1 yield, so a 5-count berry plot
// produces 5 sugar over the full cycle.
export const FARM_CROPS = [
  { key: 'berry', icon: '🫐', iconUrl: 'assets/icons/BerryBush.png', label: 'Berry Bush', count: 5 },
  { key: 'tree',  icon: '🌳', iconUrl: 'assets/icons/Bush.png',      label: 'Tree',       count: 5 },
];

// Lifecycle states. Other systems (WorkManager) react to these.
export const FARM_STATE = {
  IDLE:           'idle',           // empty plot
  AWAITING_SEED:  'awaiting_seed',  // crop picked, no seed delivered yet
  GROWING:        'growing',        // seed delivered, crops scaling up
  GROWN:          'grown',          // full size, awaiting harvest (one or more instances remain)
};

const cropDef   = (key) => FARM_CROPS.find(c => c.key === key);
const cropName  = (key) => cropDef(key)?.label ?? key;
const cropCount = (key) => cropDef(key)?.count ?? 1;

// Crop visuals (separate child meshes on top of the plot).
const CROP_MODELS = {
  berry: 'assets/models/BerryBush.glb',
  tree:  'assets/models/Bush.glb',  // placeholder until a Tree.glb exists
};

// What each crop yields when harvested. The deposit credits this resource
// at the hive — keeps the farm loop slotting into the same harvest pipeline
// as ResourceNodes.
const CROP_YIELDS = {
  berry: 'sugar',
  tree:  'wood',
};

const GROW_STEPS      = 5;
const MAX_WATERINGS   = GROW_STEPS;                                                // one watering per growth step
const FULL_SCALE      = 0.85;                                                      // single-instance full size
const STEP_RATIOS     = Array.from({ length: GROW_STEPS }, (_, i) => 0.2 + i * 0.2); // 0.2..1.0 (multiplied by per-instance base)
const CROP_Y_OFFSET   = 0.15;                                                      // lift crop onto the plot surface

const PULSE_DURATION   = 0.4;   // plot scale pulse on water
const BOINK_DURATION   = 0.3;   // crop mesh overshoot pulse on step-up
const DECAY_RATE       = 0.05;  // water lost per second — paces when the next tend task is posted
const REFILL_THRESHOLD = 0.5;
const DARKEN_AT_DRY    = 0.45;

// Local XZ offsets for crop instances on the plot. Indexed by crop count.
// 5-dot domino reads cleanly on a hex plot — centre + four corners.
const INSTANCE_LAYOUTS = {
  1: [{ x:  0.0,  z:  0.0  }],
  5: [
    { x:  0.0,  z:  0.0  },
    { x:  0.32, z:  0.32 },
    { x: -0.32, z:  0.32 },
    { x:  0.32, z: -0.32 },
    { x: -0.32, z: -0.32 },
  ],
};

// Per-instance base scale at full growth. Multi-instance plots use a smaller
// base so the crops sit alongside each other without overlap.
const INSTANCE_BASE_SCALE = {
  1: FULL_SCALE,
  5: 0.45,
};

const layoutFor = (count) => INSTANCE_LAYOUTS[count] ?? INSTANCE_LAYOUTS[5].slice(0, count);
const baseScaleFor = (count) => INSTANCE_BASE_SCALE[count] ?? FULL_SCALE / Math.sqrt(count);

export class FarmPlot extends Component {
  constructor() {
    super();
    this._state       = FARM_STATE.IDLE;
    this.crop         = null;
    this.pendingCrop  = null;
    this.growth       = 0;     // 0..1
    this.waterLevel   = 1.0;   // 0..1, only matters while GROWING

    this._waterings   = 0;     // discrete tend visits required to fully grow

    // One entry per spawned crop instance. Each harvest pops the last entry
    // and removes its mesh; when the array empties we restart the cycle.
    this._cropMeshes  = [];    // [{ mesh, baseScale }]
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
        // Replace immediately, lose any remaining ripe crops.
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

  // Ant-facing — called when watering visit lands. Each successful watering
  // bumps both the discrete waterings counter (which gates growth) and the
  // continuous waterLevel buffer (which paces when the next tend task posts).
  water() {
    if (this._state !== FARM_STATE.GROWING)  return false;
    if (this.waterLevel >= 0.99)             return false; // not thirsty yet
    if (this._waterings >= MAX_WATERINGS)    return false; // already done
    this.waterLevel  = 1.0;
    this._waterings += 1;
    this.growth      = Math.min(1, this._waterings / MAX_WATERINGS);
    this._waterPulseT = 0;
    if (this._waterings >= MAX_WATERINGS) this._setGrown();
    return true;
  }

  // WorkManager queries.
  needsSeed()        { return this._state === FARM_STATE.AWAITING_SEED; }
  needsAttention()   {
    return this._state === FARM_STATE.GROWING
        && this.growth < 1
        && this.waterLevel < REFILL_THRESHOLD;
  }
  isReadyToHarvest() {
    return this._state === FARM_STATE.GROWN && this._cropMeshes.length > 0;
  }
  yieldType()        { return CROP_YIELDS[this.crop] ?? null; }

  // Ant-facing — called when a harvest visit lands. Pops one crop instance
  // and yields one unit of the crop's mapped resource type. When the last
  // instance is taken, restarts the cycle (back to AWAITING_SEED with the
  // same crop, or with the queued pendingCrop if one was set during
  // growing). Returns the amount taken (0 if not harvestable).
  harvestOne() {
    if (!this.isReadyToHarvest()) return 0;
    const entry = this._cropMeshes.pop();
    if (entry) this.gameObject.object3D.remove(entry.mesh);
    if (this._cropMeshes.length === 0) {
      const next = this.pendingCrop ?? this.crop;
      this._setAwaitingSeed(next);
    }
    return 1;
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
    this._removeCropMeshes();
  }

  update(dt) {
    if (this._state === FARM_STATE.GROWING) {
      // Decay only — growth advances discretely on each water() call now.
      this.waterLevel = Math.max(0, this.waterLevel - DECAY_RATE * dt);
    }

    // Stepped crop scale + boink on step transitions. All instances share
    // the same step (synced growth); each scales by its own per-instance base.
    if (this._cropMeshes.length > 0) {
      const step = this._currentStep();
      const ratio = STEP_RATIOS[step];
      if (step !== this._lastStep) {
        this._cropPulseT = 0;
        this._lastStep   = step;
      }
      let mul = ratio;
      if (this._cropPulseT < BOINK_DURATION) {
        this._cropPulseT += dt;
        const p = Math.min(1, this._cropPulseT / BOINK_DURATION);
        mul = ratio * (1 + 0.22 * Math.sin(p * Math.PI)); // overshoot+settle
      }
      for (const entry of this._cropMeshes) {
        entry.mesh.scale.setScalar(entry.baseScale * mul);
      }
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
    this._waterings   = 0;
    this._removeCropMeshes();
  }
  _setAwaitingSeed(crop) {
    this._state       = FARM_STATE.AWAITING_SEED;
    this.crop         = crop;
    this.pendingCrop  = null;
    this.growth       = 0;
    this.waterLevel   = 1.0;
    this._waterings   = 0;
    this._removeCropMeshes();
  }
  _setGrowing() {
    this._state     = FARM_STATE.GROWING;
    this.growth     = 0;
    this._waterings = 0;
    // Start thirsty so the first tend task posts immediately and the player
    // sees the colony engage with the new plot right away.
    this.waterLevel = 0;
    this._spawnCropMeshes();
  }
  _setGrown() {
    this._state = FARM_STATE.GROWN;
    // If the player queued a switch while it was growing, kick off the next.
    if (this.pendingCrop) {
      const next = this.pendingCrop;
      this._setAwaitingSeed(next);
    }
  }

  _spawnCropMeshes() {
    this._removeCropMeshes();
    const url = CROP_MODELS[this.crop];
    if (!url) return;
    const count  = cropCount(this.crop);
    const layout = layoutFor(count);
    const baseS  = baseScaleFor(count);
    for (const offset of layout) {
      let mesh;
      try { mesh = cloneModel(url); } catch { continue; } // model not loaded — silently skip this one
      mesh.scale.setScalar(baseS * STEP_RATIOS[0]);
      mesh.position.set(offset.x, CROP_Y_OFFSET, offset.z);
      this.gameObject.object3D.add(mesh);
      this._cropMeshes.push({ mesh, baseScale: baseS });
    }
    this._lastStep   = 0;
    this._cropPulseT = 0; // boink on spawn
  }

  _removeCropMeshes() {
    for (const { mesh } of this._cropMeshes) {
      this.gameObject.object3D.remove(mesh);
    }
    this._cropMeshes = [];
    this._lastStep   = -1;
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
      case FARM_STATE.GROWN: {
        const total = cropCount(this.crop);
        const left  = this._cropMeshes.length;
        stateText = `Ripe: ${cropName(this.crop)} (${left} / ${total})`;
        break;
      }
    }

    const progress = [];
    if (this._state === FARM_STATE.GROWING || this._state === FARM_STATE.GROWN) {
      progress.push({
        label: 'Growth',
        value: this.growth,
        text:  `${this._waterings} / ${MAX_WATERINGS} watered`,
      });
    }
    if (this._state === FARM_STATE.GROWING) {
      progress.push({
        label: 'Water',
        value: this.waterLevel,
        text:  this.waterLevel < REFILL_THRESHOLD ? 'thirsty' : 'wet',
      });
    }

    return {
      title: 'Farm Plot',
      state: stateText,
      progress,
      picker: {
        options: FARM_CROPS.map(c => ({
          icon:     c.icon,
          iconUrl:  c.iconUrl,
          label:    c.label,
          selected: this.crop === c.key,
          onClick:  () => this.selectCrop(c.key),
        })),
      },
    };
  }
}

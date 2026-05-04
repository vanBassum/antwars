import * as THREE from 'three';
import { Component } from '../../engine/gameobject.js';
import { InstancedBuilding } from './instanced_building.js';
import { getCropInstances } from '../crop_instance_registry.js';

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

const GROW_STEPS         = 5;
const MAX_WATERINGS      = GROW_STEPS;       // one watering per growth step
const FULL_SCALE         = 0.85;             // single-instance full size
const MIN_VISIBLE_SCALE  = 0.2;              // relative scale at growth=0 (so crop is visible right after seed)
const CROP_Y_OFFSET      = 0.15;             // lift crop onto the plot surface

const GROW_TICK_DURATION = 4.0;   // seconds for the plant to visibly grow one step after a watering
const PULSE_DURATION     = 0.4;   // plot scale pulse on water
const BOINK_DURATION     = 0.3;   // crop mesh overshoot pulse on watering
const DARKEN_AT_DRY      = 0.45;  // plot tint when waterLevel = 0

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
    this._state         = FARM_STATE.IDLE;
    this.crop           = null;
    this.pendingCrop    = null;
    this.growth         = 0;     // 0..1, lerps toward _growthTarget after each watering
    this._growthTarget  = 0;     // 0..1, set by water() to (waterings / MAX_WATERINGS)
    this.waterLevel     = 1.0;   // 0..1, mirrors tick remaining while GROWING (1 just-watered, 0 done)

    this._waterings     = 0;     // discrete tend visits required to fully grow

    // Instanced crop slots. Each entry holds { slotId, baseScale, offset }
    // where slotId is the handle into the CropInstanceRegistry.
    this._cropSlots     = [];
    this._cropPulseT    = BOINK_DURATION;
    this._lastScale     = -1;    // cached to avoid redundant matrix writes

    this._waterPulseT = PULSE_DURATION;
    this._baseColor   = new THREE.Color(0xffffff);
    this._tintColor   = new THREE.Color();

    // Reusable temporaries for crop matrix composition
    this._tmpMatrix = new THREE.Matrix4();
    this._tmpPos    = new THREE.Vector3();
    this._tmpQuat   = new THREE.Quaternion();
    this._tmpScale  = new THREE.Vector3();
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
  // bumps the discrete waterings counter and updates _growthTarget; growth
  // itself lerps toward the target over GROW_TICK_DURATION (in update). The
  // next watering is rejected until the previous tick has played out, so the
  // visual order is water → wait → grow → next water.
  water() {
    if (this._state !== FARM_STATE.GROWING)        return false;
    if (this._waterings >= MAX_WATERINGS)          return false; // already fully watered
    if (this.growth < this._growthTarget - 1e-4)   return false; // previous tick still playing out
    this._waterings   += 1;
    this._growthTarget = Math.min(1, this._waterings / MAX_WATERINGS);
    this.waterLevel    = 1.0;        // refilled — drains as the tick progresses
    this._cropPulseT   = 0;          // crop boink on watering
    this._waterPulseT  = 0;          // plot scale pulse
    return true;
  }

  // WorkManager queries.
  needsSeed()        { return this._state === FARM_STATE.AWAITING_SEED; }
  needsAttention()   {
    // Ready for the next watering only after the previous tick has played out
    // (growth has caught up to the per-watering target).
    return this._state === FARM_STATE.GROWING
        && this._waterings < MAX_WATERINGS
        && this.growth >= this._growthTarget - 1e-4;
  }
  isReadyToHarvest() {
    return this._state === FARM_STATE.GROWN && this._cropSlots.length > 0;
  }
  yieldType()        { return CROP_YIELDS[this.crop] ?? null; }

  // Ant-facing — called when a harvest visit lands. Pops one crop instance
  // and yields one unit of the crop's mapped resource type. When the last
  // instance is taken, restarts the cycle (back to AWAITING_SEED with the
  // same crop, or with the queued pendingCrop if one was set during
  // growing). Returns the amount taken (0 if not harvestable).
  harvestOne() {
    if (!this.isReadyToHarvest()) return 0;
    const entry = this._cropSlots.pop();
    if (entry) {
      const registry = getCropInstances();
      const url = CROP_MODELS[this.crop];
      if (registry && url) registry.remove(url, entry.slotId);
    }
    if (this._cropSlots.length === 0) {
      const next = this.pendingCrop ?? this.crop;
      this._setAwaitingSeed(next);
    }
    return 1;
  }

  start() {
    // Plot tile renders via InstancedBuilding (registered by the entity
    // factory). No per-mesh material cloning — tinting goes through
    // setColor() on the InstancedBuilding instance.
  }

  destroy() {
    this._removeCropSlots();
  }

  update(dt) {
    if (this._state === FARM_STATE.GROWING) {
      // Lerp growth toward the per-watering target. Each watering buys
      // GROW_TICK_DURATION seconds of visible growth animation; waterLevel
      // mirrors tick-remaining (1 just-watered → 0 done) so it doubles as
      // the dry/wet visual signal AND the gating for the next tend task.
      if (this.growth < this._growthTarget) {
        const stepSize = 1 / MAX_WATERINGS;
        const rate     = stepSize / GROW_TICK_DURATION;
        this.growth    = Math.min(this._growthTarget, this.growth + rate * dt);
        const remaining = this._growthTarget - this.growth;
        this.waterLevel = Math.max(0, Math.min(1, remaining / stepSize));
        if (this.growth >= 1 - 1e-6) this._setGrown();
      } else {
        this.waterLevel = 0; // tick complete — plot is dry, ready for next watering
      }
    }

    // Crop scale follows growth continuously. Boink overlays a brief pulse
    // each time water() resets _cropPulseT.
    if (this._cropSlots.length > 0) {
      let mul = MIN_VISIBLE_SCALE + (1 - MIN_VISIBLE_SCALE) * this.growth;
      if (this._cropPulseT < BOINK_DURATION) {
        this._cropPulseT += dt;
        const p = Math.min(1, this._cropPulseT / BOINK_DURATION);
        mul *= 1 + 0.22 * Math.sin(p * Math.PI); // overshoot+settle
      }

      // Only update instance matrices if the effective scale changed.
      if (Math.abs(mul - this._lastScale) > 1e-4) {
        this._lastScale = mul;
        this._updateCropTransforms(mul);
      }
    }

    // Plot tint via instanced color — only meaningful while GROWING; reset to
    // base otherwise. Goes through the InstancedBuilding component since the
    // plot tile no longer has a per-instance material we can mutate directly.
    const ib = this.gameObject.getComponent(InstancedBuilding);
    if (ib) {
      if (this._state === FARM_STATE.GROWING) {
        const factor = DARKEN_AT_DRY + (1 - DARKEN_AT_DRY) * this.waterLevel;
        this._tintColor.copy(this._baseColor).multiplyScalar(factor);
        ib.setColor(this._tintColor);
      } else {
        ib.setColor(this._baseColor);
      }
    }

    // Plot scale pulse on watering — sync instanced transform.
    if (this._waterPulseT < PULSE_DURATION) {
      this._waterPulseT += dt;
      const p = Math.min(1, this._waterPulseT / PULSE_DURATION);
      const s = 1 + 0.08 * Math.sin(p * Math.PI);
      this.gameObject.object3D.scale.setScalar(s);
      if (ib) ib.syncTransform();
    } else {
      this.gameObject.object3D.scale.setScalar(1);
      if (ib) ib.syncTransform();
    }
  }

  // ── State transitions ──────────────────────────────────────────────────
  _setIdle() {
    this._state         = FARM_STATE.IDLE;
    this.crop           = null;
    this.pendingCrop    = null;
    this.growth         = 0;
    this._growthTarget  = 0;
    this.waterLevel     = 1.0;
    this._waterings     = 0;
    this._removeCropSlots();
  }
  _setAwaitingSeed(crop) {
    this._state         = FARM_STATE.AWAITING_SEED;
    this.crop           = crop;
    this.pendingCrop    = null;
    this.growth         = 0;
    this._growthTarget  = 0;
    this.waterLevel     = 1.0;
    this._waterings     = 0;
    this._removeCropSlots();
  }
  _setGrowing() {
    this._state         = FARM_STATE.GROWING;
    this.growth         = 0;
    this._growthTarget  = 0;
    this._waterings     = 0;
    // Start thirsty so the first tend task posts immediately and the player
    // sees the colony engage with the new plot right away.
    this.waterLevel = 0;
    this._spawnCropSlots();
  }
  _setGrown() {
    this._state = FARM_STATE.GROWN;
    // If the player queued a switch while it was growing, kick off the next.
    if (this.pendingCrop) {
      const next = this.pendingCrop;
      this._setAwaitingSeed(next);
    }
  }

  _spawnCropSlots() {
    this._removeCropSlots();
    const url = CROP_MODELS[this.crop];
    if (!url) return;
    const registry = getCropInstances();
    if (!registry) return;

    const count  = cropCount(this.crop);
    const layout = layoutFor(count);
    const baseS  = baseScaleFor(count);
    const plotPos = this.gameObject.object3D.position;

    for (const offset of layout) {
      const scale = baseS * MIN_VISIBLE_SCALE;
      this._tmpPos.set(plotPos.x + offset.x, plotPos.y + CROP_Y_OFFSET, plotPos.z + offset.z);
      this._tmpQuat.identity();
      this._tmpScale.set(scale, scale, scale);
      this._tmpMatrix.compose(this._tmpPos, this._tmpQuat, this._tmpScale);
      const slotId = registry.add(url, this._tmpMatrix);
      if (slotId != null) {
        this._cropSlots.push({ slotId, baseScale: baseS, offset });
      }
    }
    this._lastScale = MIN_VISIBLE_SCALE;
    this._cropPulseT = 0; // boink on spawn
  }

  _updateCropTransforms(mul) {
    const url = CROP_MODELS[this.crop];
    if (!url) return;
    const registry = getCropInstances();
    if (!registry) return;

    const plotPos = this.gameObject.object3D.position;
    for (const entry of this._cropSlots) {
      const scale = entry.baseScale * mul;
      this._tmpPos.set(
        plotPos.x + entry.offset.x,
        plotPos.y + CROP_Y_OFFSET,
        plotPos.z + entry.offset.z,
      );
      this._tmpQuat.identity();
      this._tmpScale.set(scale, scale, scale);
      this._tmpMatrix.compose(this._tmpPos, this._tmpQuat, this._tmpScale);
      registry.update(url, entry.slotId, this._tmpMatrix);
    }
  }

  _removeCropSlots() {
    if (this._cropSlots.length === 0) return;
    const url = CROP_MODELS[this.crop];
    const registry = getCropInstances();
    if (registry && url) {
      for (const entry of this._cropSlots) {
        registry.remove(url, entry.slotId);
      }
    }
    this._cropSlots = [];
    this._lastScale = -1;
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
        const left  = this._cropSlots.length;
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
        text:  this.waterLevel > 0 ? 'growing…' : 'thirsty',
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

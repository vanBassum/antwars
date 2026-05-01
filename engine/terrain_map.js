export const TerrainType = Object.freeze({
  DEEP_WATER:    'deep_water',
  SHALLOW_WATER: 'shallow_water',
  SAND:          'sand',
  GRASS:         'grass',
  DIRT:          'dirt',
  HILL:          'hill',
  MOUNTAIN:      'mountain',
});

// Height thresholds — normalized [0, 1] after min/max stretch
const THRESHOLDS = [
  [0.25, TerrainType.DEEP_WATER],
  [0.35, TerrainType.SHALLOW_WATER],
  [0.42, TerrainType.SAND],
  [0.62, TerrainType.GRASS],
  [0.76, TerrainType.DIRT],
  [0.90, TerrainType.HILL],
];

const VALID_BASE_TYPES = new Set([
  TerrainType.GRASS,
  TerrainType.DIRT,
  TerrainType.HILL,
]);

function typeFromHeight(h) {
  for (const [limit, type] of THRESHOLDS) {
    if (h < limit) return type;
  }
  return TerrainType.MOUNTAIN;
}

function makeNoise(seed) {
  const p = new Uint8Array(512);
  for (let i = 0; i < 256; i++) p[i] = i;
  let s = seed | 0;
  for (let i = 255; i > 0; i--) {
    s = Math.imul(s, 1664525) + 1013904223 | 0;
    const j = (s >>> 0) % (i + 1);
    [p[i], p[j]] = [p[j], p[i]];
  }
  for (let i = 0; i < 256; i++) p[i + 256] = p[i];

  const fade = t => t * t * t * (t * (t * 6 - 15) + 10);
  const lerp  = (a, b, t) => a + t * (b - a);
  const grad  = (h, x, y) => ((h & 1) ? -x : x) + ((h & 2) ? -y : y);

  return (x, y) => {
    const xi = Math.floor(x) & 255, yi = Math.floor(y) & 255;
    const xf = x - Math.floor(x),   yf = y - Math.floor(y);
    const u  = fade(xf), v = fade(yf);
    return lerp(
      lerp(grad(p[p[xi]     + yi],     xf,     yf),
           grad(p[p[xi + 1] + yi],     xf - 1, yf), u),
      lerp(grad(p[p[xi]     + yi + 1], xf,     yf - 1),
           grad(p[p[xi + 1] + yi + 1], xf - 1, yf - 1), u),
      v
    );
  };
}

export class TerrainMap {
  /**
   * bases: number  — how many bases to place (teamIndex assigned 0..n-1)
   *      | array   — [{ teamIndex }, ...] for explicit team assignment
   */
  constructor({ width = 128, depth = 128, seed = 42, bases = 0 } = {}) {
    this.width = width;
    this.depth = depth;
    this.seed  = seed;

    const baseDefs = typeof bases === 'number'
      ? Array.from({ length: bases }, (_, i) => ({ teamIndex: i }))
      : bases;

    this.bases = [];
    this.cells = this._generate(baseDefs);
  }

  // Returns { height, type } for cell (x, z), or null if out of bounds.
  get(x, z) {
    if (x < 0 || x >= this.width || z < 0 || z >= this.depth) return null;
    return this.cells[z * this.width + x];
  }

  _generate(baseDefs) {
    const noise = makeNoise(this.seed);
    const { width: w, depth: d } = this;
    const raw = new Float32Array(w * d);

    for (let z = 0; z < d; z++) {
      for (let x = 0; x < w; x++) {
        const nx = x / w, nz = z / d;
        raw[z * w + x] =
          noise(nx * 3,  nz * 3)           // large landmasses
        + noise(nx * 6,  nz * 6)  * 0.40   // rolling hills
        + noise(nx * 12, nz * 12) * 0.12   // gentle undulation
        + noise(nx * 24, nz * 24) * 0.04;  // subtle surface variation
      }
    }

    // Stretch to full [0, 1] range so all terrain types appear every seed
    let min = Infinity, max = -Infinity;
    for (const v of raw) {
      if (v < min) min = v;
      if (v > max) max = v;
    }
    const range = max - min;

    const cells = Array.from(raw, v => {
      const h = (v - min) / range;
      return { height: h, type: typeFromHeight(h) };
    });

    if (baseDefs.length > 0) {
      this.bases = this._placeBases(cells, baseDefs);
      this._flattenBases(cells, this.bases);
    }

    return cells;
  }

  // ── Base placement ──────────────────────────────────────────────────────────

  _placeBases(cells, baseDefs) {
    const { width: w, depth: d } = this;
    const n      = baseDefs.length;
    const BASE_R = 8;
    const MARGIN = Math.ceil(BASE_R * 1.5);

    // 8 outer cells of a 3x3 grid, clockwise from top-left.
    // Center cell (1,1) is always free — never used for bases.
    const OUTER = [
      [0,0],[1,0],[2,0],  // 0 top-left  1 top-center  2 top-right
      [2,1],              // 3 right-center
      [2,2],[1,2],[0,2],  // 4 bot-right  5 bot-center  6 bot-left
      [0,1],              // 7 left-center
    ];

    // Explicit slot assignments per player count — easy to read and adjust
    const SLOTS_BY_COUNT = [
      [],                     // 0
      [0],                    // 1
      [0, 4],                 // 2  opposite corners
      [0, 2, 5],              // 3  triangle
      [0, 2, 4, 6],           // 4  four corners
      [0, 2, 4, 6, 1],        // 5
      [0, 2, 4, 6, 1, 5],     // 6
      [0, 2, 4, 6, 1, 3, 5],  // 7
      [0, 1, 2, 3, 4, 5, 6, 7], // 8
    ];

    const slotIndices = SLOTS_BY_COUNT[Math.min(n, 8)] ?? SLOTS_BY_COUNT[8];
    const slots = slotIndices.slice(0, n).map(i => OUTER[i]);

    const cellW = (w - 2 * MARGIN) / 3;
    const cellD = (d - 2 * MARGIN) / 3;
    const bases = [];

    for (let i = 0; i < n; i++) {
      const [col, row] = slots[i];
      const xMin = Math.round(MARGIN + col * cellW);
      const xMax = Math.round(MARGIN + (col + 1) * cellW);
      const zMin = Math.round(MARGIN + row * cellD);
      const zMax = Math.round(MARGIN + (row + 1) * cellD);

      // Flattest valid cell inside the assigned grid square
      let bestX = -1, bestZ = -1, bestV = Infinity;
      for (let z = zMin; z < zMax; z++) {
        for (let x = xMin; x < xMax; x++) {
          if (!VALID_BASE_TYPES.has(cells[z * w + x].type)) continue;
          const v = this._localVariance(cells, x, z, BASE_R);
          if (v < bestV) { bestV = v; bestX = x; bestZ = z; }
        }
      }

      // Fallback: grid square was all water — find nearest valid flat cell
      if (bestX < 0) {
        const gcx = (xMin + xMax) / 2, gcz = (zMin + zMax) / 2;
        let bestScore = Infinity;
        for (let z = MARGIN; z < d - MARGIN; z++) {
          for (let x = MARGIN; x < w - MARGIN; x++) {
            if (!VALID_BASE_TYPES.has(cells[z * w + x].type)) continue;
            const dist2 = (x - gcx) ** 2 + (z - gcz) ** 2;
            const score = dist2 + this._localVariance(cells, x, z, BASE_R) * 500;
            if (score < bestScore) { bestScore = score; bestX = x; bestZ = z; }
          }
        }
      }

      if (bestX >= 0) {
        bases.push({ id: i, x: bestX, z: bestZ, radius: BASE_R, teamIndex: baseDefs[i].teamIndex ?? i });
      }
    }

    return bases;
  }

  // Variance of heights within radius r around (cx, cz)
  _localVariance(cells, cx, cz, r) {
    const { width: w, depth: d } = this;
    let sum = 0, sum2 = 0, count = 0;
    const r2 = r * r;
    for (let dz = -r; dz <= r; dz++) {
      for (let dx = -r; dx <= r; dx++) {
        if (dx * dx + dz * dz > r2) continue;
        const x = cx + dx, z = cz + dz;
        if (x < 0 || x >= w || z < 0 || z >= d) continue;
        const h = cells[z * w + x].height;
        sum  += h;
        sum2 += h * h;
        count++;
      }
    }
    if (count === 0) return Infinity;
    const mean = sum / count;
    return sum2 / count - mean * mean;
  }

  // Smoothly flatten terrain around each base toward the local average height
  _flattenBases(cells, bases) {
    const { width: w, depth: d } = this;

    for (const base of bases) {
      const r      = base.radius;
      const innerR = Math.round(r * 0.5);
      const r2     = r * r;
      const i2     = innerR * innerR;

      // Target height = average of the inner half-radius area
      let sum = 0, count = 0;
      for (let dz = -innerR; dz <= innerR; dz++) {
        for (let dx = -innerR; dx <= innerR; dx++) {
          if (dx * dx + dz * dz > i2) continue;
          const x = base.x + dx, z = base.z + dz;
          if (x < 0 || x >= w || z < 0 || z >= d) continue;
          sum += cells[z * w + x].height;
          count++;
        }
      }
      const targetH = count > 0 ? sum / count : 0.5;

      // Blend heights toward targetH — full at center, zero at edge
      for (let dz = -r; dz <= r; dz++) {
        for (let dx = -r; dx <= r; dx++) {
          const dist2 = dx * dx + dz * dz;
          if (dist2 > r2) continue;
          const x = base.x + dx, z = base.z + dz;
          if (x < 0 || x >= w || z < 0 || z >= d) continue;
          const t     = 1 - Math.sqrt(dist2) / r;
          const blend = t * t * (3 - 2 * t); // smoothstep
          const cell  = cells[z * w + x];
          cell.height = cell.height + (targetH - cell.height) * blend;
        }
      }
    }

    // Re-derive terrain types after height changes
    for (const cell of cells) {
      cell.type = typeFromHeight(cell.height);
    }
  }
}

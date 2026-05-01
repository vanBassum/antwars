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

// Simple seeded LCG — reproducible random in [0, 1)
function makeLCG(seed) {
  let s = seed | 0;
  return () => {
    s = Math.imul(s, 1664525) + 1013904223 | 0;
    return (s >>> 0) / 0x100000000;
  };
}

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
      this._ensureConnectivity(cells);
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

    // Each base gets its own RNG stream derived from the map seed + index
    const bases = [];

    for (let i = 0; i < n; i++) {
      const rng = makeLCG(this.seed ^ (i * 0x9e3779b9));

      const [col, row] = slots[i];
      const xMin = Math.round(MARGIN + col * cellW);
      const xMax = Math.round(MARGIN + (col + 1) * cellW);
      const zMin = Math.round(MARGIN + row * cellD);
      const zMax = Math.round(MARGIN + (row + 1) * cellD);

      // Inner region — keep base away from grid square edges by BASE_R
      const ixMin = xMin + BASE_R;
      const ixMax = xMax - BASE_R;
      const izMin = zMin + BASE_R;
      const izMax = zMax - BASE_R;

      // Random position within inner region (terrain type doesn't matter —
      // _flattenBases will force the height to valid land regardless)
      const bx = ixMin + Math.floor(rng() * (ixMax - ixMin));
      const bz = izMin + Math.floor(rng() * (izMax - izMin));

      bases.push({ id: i, x: bx, z: bz, radius: BASE_R, teamIndex: baseDefs[i].teamIndex ?? i });
    }

    return bases;
  }

  _ensureConnectivity(cells) {
    const { width: w, depth: d } = this;
    if (this.bases.length < 2) return;

    const WATER_H    = 0.35; // anything below this is water
    const BRIDGE_H   = 0.40; // raised cells land at sand level
    const CORRIDOR_R = 2;    // half-width of the carved land bridge

    const isWater = idx => cells[idx].height < WATER_H;

    // BFS on walkable cells only — returns a visited bitfield
    const walkableBFS = start => {
      const visited = new Uint8Array(w * d);
      const queue   = [start.x + start.z * w];
      visited[queue[0]] = 1;
      for (let head = 0; head < queue.length; head++) {
        const idx = queue[head];
        const x = idx % w, z = (idx / w) | 0;
        for (const [dx, dz] of [[-1,0],[1,0],[0,-1],[0,1]]) {
          const nx = x + dx, nz = z + dz;
          if (nx < 0 || nx >= w || nz < 0 || nz >= d) continue;
          const ni = nx + nz * w;
          if (visited[ni] || isWater(ni)) continue;
          visited[ni] = 1;
          queue.push(ni);
        }
      }
      return visited;
    };

    // BFS through all cells (including water) — returns shortest path as [{x,z}]
    const shortestPath = (from, to) => {
      const parent  = new Int32Array(w * d).fill(-1);
      const visited = new Uint8Array(w * d);
      const toIdx   = to.x + to.z * w;
      const queue   = [from.x + from.z * w];
      visited[queue[0]] = 1;
      for (let head = 0; head < queue.length; head++) {
        const idx = queue[head];
        if (idx === toIdx) {
          const path = [];
          for (let cur = idx; cur !== -1; cur = parent[cur])
            path.push({ x: cur % w, z: (cur / w) | 0 });
          return path.reverse();
        }
        const x = idx % w, z = (idx / w) | 0;
        for (const [dx, dz] of [[-1,0],[1,0],[0,-1],[0,1]]) {
          const nx = x + dx, nz = z + dz;
          if (nx < 0 || nx >= w || nz < 0 || nz >= d) continue;
          const ni = nx + nz * w;
          if (visited[ni]) continue;
          visited[ni] = 1;
          parent[ni] = idx;
          queue.push(ni);
        }
      }
      return null;
    };

    let changed = false;

    for (let i = 1; i < this.bases.length; i++) {
      // Re-check each iteration so earlier bridges help later ones
      const reachable = walkableBFS(this.bases[0]);
      const dest      = this.bases[i];
      if (reachable[dest.x + dest.z * w]) continue;

      const path = shortestPath(this.bases[0], dest);
      if (!path) continue;

      for (const { x, z } of path) {
        for (let dz = -CORRIDOR_R; dz <= CORRIDOR_R; dz++) {
          for (let dx = -CORRIDOR_R; dx <= CORRIDOR_R; dx++) {
            if (dx * dx + dz * dz > CORRIDOR_R * CORRIDOR_R) continue;
            const nx = x + dx, nz = z + dz;
            if (nx < 0 || nx >= w || nz < 0 || nz >= d) continue;
            const cell = cells[nz * w + nx];
            if (cell.height < BRIDGE_H) { cell.height = BRIDGE_H; changed = true; }
          }
        }
      }
    }

    if (changed)
      for (const cell of cells) cell.type = typeFromHeight(cell.height);
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

      // Target height = average of inner area, clamped to grass/dirt range
      // so water or mountain zones get forced to buildable land
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
      const BASE_H_MIN = 0.45; // low end of GRASS
      const BASE_H_MAX = 0.73; // high end of DIRT
      const targetH = Math.max(BASE_H_MIN, Math.min(BASE_H_MAX, count > 0 ? sum / count : 0.55));

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

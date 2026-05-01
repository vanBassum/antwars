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
  [0.58, TerrainType.GRASS],
  [0.70, TerrainType.DIRT],
  [0.83, TerrainType.HILL],
];

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
  constructor({ width = 128, depth = 128, seed = 42 } = {}) {
    this.width = width;
    this.depth = depth;
    this.seed  = seed;
    this.cells = this._generate();
  }

  // Returns { height, type } for cell (x, z), or null if out of bounds.
  get(x, z) {
    if (x < 0 || x >= this.width || z < 0 || z >= this.depth) return null;
    return this.cells[z * this.width + x];
  }

  _generate() {
    const noise = makeNoise(this.seed);
    const { width: w, depth: d } = this;
    const raw = new Float32Array(w * d);

    for (let z = 0; z < d; z++) {
      for (let x = 0; x < w; x++) {
        const nx = x / w, nz = z / d;
        raw[z * w + x] =
          noise(nx * 4,  nz * 4)           // large landmasses
        + noise(nx * 8,  nz * 8)  * 0.5    // regional hills
        + noise(nx * 16, nz * 16) * 0.25   // local detail
        + noise(nx * 32, nz * 32) * 0.125; // fine texture
      }
    }

    // Stretch to full [0, 1] range so all terrain types appear every seed
    let min = Infinity, max = -Infinity;
    for (const v of raw) {
      if (v < min) min = v;
      if (v > max) max = v;
    }
    const range = max - min;

    return Array.from(raw, v => {
      const h = (v - min) / range;
      return { height: h, type: typeFromHeight(h) };
    });
  }
}

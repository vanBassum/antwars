// Flat-top hex grid using axial coordinates (q, r).
// `size` = circumradius (center → corner). Flat-to-flat distance = sqrt(3) * size.

const SQRT3 = Math.sqrt(3);

const NEIGHBORS = [
  [+1,  0], [+1, -1], [ 0, -1],
  [-1,  0], [-1, +1], [ 0, +1],
];

export class HexGrid {
  constructor({ size = 1, radius = 16 } = {}) {
    this.size       = size;
    this.radius     = radius;
    this._occupied  = new Set();    // "q,r" keys
    this._entrances = new Map();    // "q,r" → [dq, dr] — only this neighbor can traverse the hex
  }

  // ── Coords ────────────────────────────────────────────────────────────────
  hexToWorld(q, r) {
    return {
      x: this.size * 1.5 * q,
      z: this.size * SQRT3 * (r + q / 2),
    };
  }

  worldToHex(x, z) {
    const q = (2 / 3 * x) / this.size;
    const r = (-x / 3 + SQRT3 / 3 * z) / this.size;
    return this._roundAxial(q, r);
  }

  _roundAxial(q, r) {
    let x = q, z = r, y = -x - z;
    let rx = Math.round(x), ry = Math.round(y), rz = Math.round(z);
    const dx = Math.abs(rx - x), dy = Math.abs(ry - y), dz = Math.abs(rz - z);
    if (dx > dy && dx > dz)      rx = -ry - rz;
    else if (dy > dz)            ry = -rx - rz;
    else                         rz = -rx - ry;
    return { q: rx, r: rz };
  }

  hexDistance(aq, ar, bq, br) {
    return (Math.abs(aq - bq) + Math.abs(aq + ar - bq - br) + Math.abs(ar - br)) / 2;
  }

  inBounds(q, r) {
    const s = -q - r;
    return Math.max(Math.abs(q), Math.abs(r), Math.abs(s)) <= this.radius;
  }

  *neighbors(q, r) {
    for (const [dq, dr] of NEIGHBORS) {
      const nq = q + dq, nr = r + dr;
      if (this.inBounds(nq, nr)) yield { q: nq, r: nr };
    }
  }

  *allHexes() {
    for (let q = -this.radius; q <= this.radius; q++) {
      const r1 = Math.max(-this.radius, -q - this.radius);
      const r2 = Math.min( this.radius, -q + this.radius);
      for (let r = r1; r <= r2; r++) yield { q, r };
    }
  }

  hexCorners(q, r) {
    const { x, z } = this.hexToWorld(q, r);
    const out = [];
    for (let i = 0; i < 6; i++) {
      const a = (Math.PI / 3) * i;
      out.push({ x: x + this.size * Math.cos(a), z: z + this.size * Math.sin(a) });
    }
    return out;
  }

  // ── Occupancy ─────────────────────────────────────────────────────────────
  _key(q, r)         { return `${q},${r}`; }
  occupy(q, r)       { this._occupied.add(this._key(q, r)); }
  free(q, r)         { this._occupied.delete(this._key(q, r)); this._entrances.delete(this._key(q, r)); }
  isOccupied(q, r)   { return this._occupied.has(this._key(q, r)); }
  isWalkable(q, r)   { return this.inBounds(q, r) && !this.isOccupied(q, r); }

  // Mark an occupied hex as having an entrance — that single neighbor (offset
  // dq, dr) can traverse into and out of the hex; all others cannot.
  setEntrance(q, r, dq, dr) { this._entrances.set(this._key(q, r), [dq, dr]); }
  getEntrance(q, r)         { return this._entrances.get(this._key(q, r)) ?? null; }

  // Can a unit step from (aq, ar) to (bq, br) — accounting for entrances?
  // Both hexes must be in-bounds. Edge rules:
  //   both walkable          → yes
  //   both occupied          → no
  //   one occupied w/o door  → no
  //   one occupied w/  door  → yes iff the walkable side is the entrance neighbor
  canTraverse(aq, ar, bq, br) {
    const aOcc = this.isOccupied(aq, ar);
    const bOcc = this.isOccupied(bq, br);
    if (!aOcc && !bOcc) return true;
    if ( aOcc &&  bOcc) return false;

    const occQ = aOcc ? aq : bq, occR = aOcc ? ar : br;
    const freeQ = aOcc ? bq : aq, freeR = aOcc ? br : ar;
    const ent = this.getEntrance(occQ, occR);
    if (!ent) return false;
    return freeQ === occQ + ent[0] && freeR === occR + ent[1];
  }

  // Walkable neighbor of (tq, tr) closest to (fq, fr). Used so the ant
  // approaches a building rather than walking onto it.
  findApproachHex(tq, tr, fq, fr) {
    let best = null, bestD = Infinity;
    for (const n of this.neighbors(tq, tr)) {
      if (!this.isWalkable(n.q, n.r)) continue;
      const d = this.hexDistance(n.q, n.r, fq, fr);
      if (d < bestD) { best = n; bestD = d; }
    }
    return best;
  }

  // ── A* pathfinding (returns array of {q, r} including start) ─────────────
  findPath(sq, sr, gq, gr) {
    const open   = new Map();   // key → node
    const closed = new Set();
    const startK = this._key(sq, sr);
    open.set(startK, { q: sq, r: sr, g: 0, f: this.hexDistance(sq, sr, gq, gr), parent: null });

    while (open.size > 0) {
      // Pop lowest f (linear scan — grid is small)
      let bestK = null, best = null;
      for (const [k, v] of open) {
        if (best === null || v.f < best.f) { best = v; bestK = k; }
      }
      open.delete(bestK);

      if (best.q === gq && best.r === gr) {
        const path = [];
        for (let cur = best; cur; cur = cur.parent) path.unshift({ q: cur.q, r: cur.r });
        return path;
      }
      closed.add(bestK);

      for (const { q, r } of this.neighbors(best.q, best.r)) {
        const k = this._key(q, r);
        if (closed.has(k))                             continue;
        if (!this.canTraverse(best.q, best.r, q, r))   continue;
        const g = best.g + 1;
        const existing = open.get(k);
        if (existing && existing.g <= g)               continue;
        open.set(k, { q, r, g, f: g + this.hexDistance(q, r, gq, gr), parent: best });
      }
    }
    return null;
  }
}

// Assigns each idle Soldier Ant a unique hex slot radiating outward from the
// Ant Hill via BFS. Soldiers navigate to their slot when idle and return to it
// after combat, producing a hex-grid hold pattern around the colony.
export class SoldierFormation {
  constructor(game) {
    this._game  = game;
    this._slots = new Map(); // gameObject → {q, r, x, z}
    this._used  = new Set(); // "q,r" keys currently claimed
  }

  register(go) {
    if (this._slots.has(go)) return;
    const slot = this._findSlot();
    if (slot) {
      this._slots.set(go, slot);
      this._used.add(`${slot.q},${slot.r}`);
    }
  }

  unregister(go) {
    const slot = this._slots.get(go);
    if (!slot) return;
    this._used.delete(`${slot.q},${slot.r}`);
    this._slots.delete(go);
  }

  getSlot(go) {
    return this._slots.get(go) ?? null;
  }

  // BFS outward from the Ant Hill hex; returns the nearest free walkable hex.
  _findSlot() {
    const grid = this._game.hexGrid;
    if (!grid) return null;

    const center  = this._centerHex();
    const visited = new Set();
    const queue   = [[center.q, center.r]];
    visited.add(`${center.q},${center.r}`);

    while (queue.length) {
      const [q, r] = queue.shift();
      const key = `${q},${r}`;
      if (!this._used.has(key) && grid.isWalkable(q, r)) {
        const wp = grid.hexToWorld(q, r);
        return { q, r, x: wp.x, z: wp.z };
      }
      for (const n of grid.neighbors(q, r)) {
        const nk = `${n.q},${n.r}`;
        if (!visited.has(nk)) {
          visited.add(nk);
          queue.push([n.q, n.r]);
        }
      }
    }
    return null;
  }

  _centerHex() {
    const grid = this._game.hexGrid;
    for (const go of this._game.gameObjects) {
      if (go.name === 'Ant Hill') {
        const { x, z } = go.position;
        return grid.worldToHex(x, z);
      }
    }
    return { q: 0, r: 0 };
  }
}

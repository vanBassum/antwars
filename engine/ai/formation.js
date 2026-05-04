// Formation slot assignment for combat units.
//
// When multiple attackers converge on the same target, each one calls
// pickAttackHex() to claim a unique adjacent hex. Units that are already
// sitting on a valid neighbor keep it (hysteresis), so they don't shuffle
// around when the target moves slightly. Fresh arrivals pick the closest
// unclaimed neighbor.

export function pickAttackHex(unit, targetHex, game, grid) {
  const candidates = [];
  for (const n of grid.neighbors(targetHex.q, targetHex.r)) {
    if (grid.isWalkable(n.q, n.r)) candidates.push(n);
  }
  if (candidates.length === 0) return null;

  // If already sitting on a valid neighbor, stay put.
  const myHex = grid.worldToHex(unit.position.x, unit.position.z);
  const held = candidates.find(c => c.q === myHex.q && c.r === myHex.r);
  if (held) return held;

  // Score each candidate: closer to self is better; penalise hexes that
  // already have another unit on them so attackers naturally spread out.
  const myPos = unit.position;
  let best = null, bestScore = Infinity;

  for (const hex of candidates) {
    const wp = grid.hexToWorld(hex.q, hex.r);
    const dx = wp.x - myPos.x, dz = wp.z - myPos.z;
    let score = Math.sqrt(dx * dx + dz * dz);

    for (const go of game.gameObjects) {
      if (go === unit) continue;
      const ex = go.position.x - wp.x, ez = go.position.z - wp.z;
      if (Math.sqrt(ex * ex + ez * ez) < 1.0) score += 20;
    }

    if (score < bestScore) { bestScore = score; best = hex; }
  }
  return best;
}

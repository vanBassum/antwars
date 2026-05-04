// Finds the cheapest sequence of actions that transforms currentState into goal state.
// Uses A* search over the action graph.

// Hard cap on nodes expanded per plan() call. Real plans for this game's
// cycles top out around 5-7 actions over ~10-15 candidate actions, so 100
// nodes is comfortable headroom. The cap exists to keep unreachable goals
// (typical in the stress scene where ants outnumber claimable work) from
// exhausting the full search space — that was costing ~10ms per failed plan.
const MAX_NODES = 100;

export class Planner {
  plan(actions, currentState, goal) {
    const open = [{ state: { ...currentState }, plan: [], cost: 0 }];
    const visited = new Set();
    let expanded = 0;

    while (open.length > 0) {
      if (expanded++ >= MAX_NODES) return null;

      open.sort((a, b) => (a.cost + heuristic(a.state, goal)) - (b.cost + heuristic(b.state, goal)));
      const node = open.shift();

      if (satisfies(node.state, goal)) return node.plan;

      const key = stateKey(node.state);
      if (visited.has(key)) continue;
      visited.add(key);

      for (const action of actions) {
        if (!action.checkPreconditions(node.state)) continue;
        const next = action.applyEffects(node.state);
        open.push({
          state: next,
          plan: [...node.plan, action],
          cost: node.cost + action.cost,
        });
      }
    }

    return null; // no plan found
  }
}

function satisfies(state, goal) {
  for (const [k, v] of Object.entries(goal)) {
    if (state[k] !== v) return false;
  }
  return true;
}

// Heuristic: number of unsatisfied goal conditions
function heuristic(state, goal) {
  let n = 0;
  for (const [k, v] of Object.entries(goal)) {
    if (state[k] !== v) n++;
  }
  return n;
}

function stateKey(state) {
  return Object.entries(state).sort((a, b) => a[0].localeCompare(b[0])).map(([k, v]) => `${k}:${v}`).join('|');
}

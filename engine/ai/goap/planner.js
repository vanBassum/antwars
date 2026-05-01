// Finds the cheapest sequence of actions that transforms currentState into goal state.
// Uses A* search over the action graph.

export class Planner {
  plan(actions, currentState, goal) {
    const open = [{ state: { ...currentState }, plan: [], cost: 0 }];
    const visited = new Set();

    while (open.length > 0) {
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

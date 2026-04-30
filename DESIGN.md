# Anthill RTS — Design Document

## Vision
A browser-based 3D RTS game set in an ant colony. You manage a growing anthill,
direct worker ants to gather sugar, and grow your colony.

Later: improvised vehicles built from everyday objects — skewers, toothpicks,
rubber bands, matchsticks. Think "Honey I Shrunk the Kids" meets RTS.

Runs in the browser with no build step — plain JS ES modules + Three.js via CDN.
Developed incrementally: build what's needed, nothing more.

## Tech Stack
- **Rendering:** Three.js (r0.167)
- **Language:** Plain JavaScript (ES modules)
- **Dev environment:** VS Code Live Preview
- **AI:** GOAP (Goal Oriented Action Planning)

## Architecture — Unity-style GameObject/Component

Every "thing" in the world is a `GameObject`.
Behaviour is added by attaching `Component` instances to it.

```
GameObject
  └── Transform         (built-in via Three.js Object3D — position/rotation/scale)
  └── ModelRenderer     → loads a GLB, adds it to the scene
  └── MeshRenderer      → procedural geometry placeholder
  └── Mover             → steers unit along XZ plane toward a target
  └── Collider          → AABB (not yet built)
  └── GOAPAgent         → runs the GOAP planner, executes action sequence
  └── ResourceNode      → marks a GameObject as harvestable (type + amount)
  └── DropOff           → marks a GameObject as a resource drop-off point
  └── EggSac            → tracks egg incubation timer, hatches into a worker
```

`Game` owns the scene, camera, renderer, and the list of all GameObjects.
It calls `update(dt)` on every GameObject each frame, then fires `onTick`.

## GOAP — Goal Oriented Action Planning
Each ant has a set of **goals** and a set of **actions**.
The **Planner** does an A* search over the action graph to find the cheapest
sequence of actions that satisfies the active goal.

Files:
- `ai/goap/action.js`     — base Action class (preconditions, effects, cost)
- `ai/goap/planner.js`    — A* planner
- `ai/goap/goap_agent.js` — Component that drives the planner each frame
- `game/worker_ai.js`     — Worker ant actions + spawn factory

## Resource System
Single resource for now: **Sugar**

Workers gather sugar from sugar nodes and carry it back to the anthill.
Sugar is used by the queen to lay eggs; eggs hatch into new workers.

```
ResourceManager.get('colony', 'sugar')
ResourceManager.add('colony', 'sugar', amount)
ResourceManager.spend('colony', 'sugar', cost)  // returns false if insufficient
```

## Spawning — Queen & Eggs
- The **Anthill** contains a **Queen** ant.
- Player clicks "Lay Egg" (costs sugar).
- An **EggSac** GameObject appears near the anthill.
- After an incubation period, the egg hatches: EggSac is removed, a new Worker spawns.
- Workers immediately start the gather → return → drop-off loop via GOAP.

No manual building placement for now — the anthill is the only structure.

## Gameplay Loop (target)
1. Game starts: anthill + queen, a few sugar nodes on the map, 1–2 starting workers
2. Workers autonomously gather sugar (GOAP: move → gather → return → drop off → repeat)
3. Player spends sugar to lay eggs → eggs hatch into more workers
4. Colony grows; more sugar nodes become reachable
5. Later: construct improvised vehicles to reach distant sugar sources or fight enemies

## Improvised Vehicles (future)
Vehicles built from everyday objects found near the anthill:
- **Skewer car** — fast scout, low capacity
- **Rubber band launcher** — ranged unit
- **Matchstick tank** — slow, heavy, armoured
- **Toothpick raft** — crosses water/spilled liquids

These will have their own GOAP actions and unique models.

## Camera Controls
- **WASD / Arrow keys** — pan (always relative to camera facing direction)
- **Scroll wheel** — zoom in / out (range: 5–60 units)
- **Middle-mouse drag** — orbit (horizontal = rotate, vertical = tilt)

## Models Expected (drop in Downloads as ZIP)
| GLB filename            | What it is                        |
|-------------------------|-----------------------------------|
| `anthill.glb`           | Main anthill structure            |
| `queen_ant.glb`         | Queen ant (inside/on anthill)     |
| `worker_ant.glb`        | Worker ant unit                   |
| `sugar_node.glb`        | Sugar crystal / sugar cube node   |
| `egg.glb`               | Egg sac (incubating)              |

## Roadmap

### Engine (done)
- [x] Game loop, GameObject, Component base
- [x] ModelRenderer (GLB/GLTF via GLTFLoader)
- [x] MeshRenderer (procedural placeholder geometry)
- [x] RTS camera — pan, zoom, orbit
- [x] GOAP: Action, Planner (A*), GOAPAgent component
- [x] Mover component (steers unit on XZ plane)
- [x] ResourceManager + ResourceNode + DropOff components
- [x] HUD (resource display, spawn button)
- [x] Debug overlay (backtick to toggle — shows all AI units + current action)

### Next up
- [ ] Swap placeholder models for ant-themed GLBs when ready
- [ ] Rename resource type from 'ore' → 'sugar' throughout
- [ ] EggSac component (incubation timer → hatch → spawn worker)
- [ ] "Lay Egg" button in HUD (replaces "Spawn Worker"), costs sugar
- [ ] Queen ant GameObject on/near anthill
- [ ] AABB Collider (units avoid walking through each other)
- [ ] Click to select a unit, show its current goal/action
- [ ] Multiple sugar nodes with varying distances from anthill
- [ ] Win/lose condition (TBD)

### Future
- [ ] Improvised vehicles (skewer car, rubber band launcher, etc.)
- [ ] Enemy colony (rival ants)
- [ ] Terrain features: cracks, puddles, grass blades as obstacles
- [ ] Sound effects

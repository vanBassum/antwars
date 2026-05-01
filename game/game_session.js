import { spawnWorker } from './worker_ai.js';
import { spawnWaterWorker } from './duck_vehicle.js';
import { spawnNurseWorker } from './nurse_worker.js';
import { spawnQueenAnt } from './queen.js';
import { ResourceNode } from './resources.js';
import { Nursery } from './nursery.js';
import { ModelRenderer } from '../engine/components/model_renderer.js';
import { GameObject } from '../engine/gameobject.js';
import { SelectionManager } from './selection_manager.js';
import { HUD } from './ui/hud.js';
import { DebugOverlay } from './ui/debug_overlay.js';
import { DebugInspector } from './ui/debug_inspector.js';

export function startSession(game, { anthill, sugarNodes, duckGO, heightAt }) {
  const workers      = [];
  const waterWorkers = [];
  let   nodeIndex    = 0;

  function getNextNode() {
    const live = sugarNodes.filter(n => !n.getComponent(ResourceNode)?.depleted);
    const pool = live.length > 0 ? live : sugarNodes;
    const node = pool[nodeIndex % pool.length];
    nodeIndex++;
    return node;
  }

  function addWorker() {
    const node  = getNextNode();
    const angle = (workers.length / 8) * Math.PI * 2;
    const w = spawnWorker(
      game,
      Math.cos(angle) * 2.5,
      Math.sin(angle) * 2.5,
      node, anthill, 'colony', 'sugar'
    );
    w.name = `Worker_${workers.length + 1}`;
    workers.push(w);
    hud.setWorkerCount(workers.length + waterWorkers.length);
  }

  // ── Water workers ────────────────────────────────────────────────────────
  for (let i = 0; i < 2; i++) {
    const angle = Math.PI + (i / 2) * Math.PI * 2;
    const w = spawnWaterWorker(
      game,
      Math.cos(angle) * 2.5,
      Math.sin(angle) * 2.5,
      duckGO, anthill, 'colony'
    );
    w.name = `WaterWorker_${i + 1}`;
    waterWorkers.push(w);
  }

  // ── Nursery — where eggs are hatched into new workers ───────────────────
  const nx = 4, nz = -2;
  const ny = heightAt ? heightAt(nx, nz) : 0;

  const nurseryGO = new GameObject('Nursery');
  nurseryGO.addComponent(new ModelRenderer('assets/models/worker_spawn_base.glb'));
  nurseryGO.addComponent(new Nursery({ onHatch: addWorker }));
  nurseryGO.position.set(nx, ny, nz);
  game.add(nurseryGO);

  // ── Queen ant — roams the anthill, lays eggs ─────────────────────────────
  spawnQueenAnt(game, anthill.position);

  // ── Nurse workers — carry eggs from queen to nursery ────────────────────
  for (let i = 0; i < 2; i++) {
    const angle = (i / 2) * Math.PI * 2 + Math.PI * 0.25;
    const w = spawnNurseWorker(
      game,
      Math.cos(angle) * 3,
      Math.sin(angle) * 3,
      nurseryGO
    );
    w.name = `Nurse_${i + 1}`;
  }

  // ── UI ───────────────────────────────────────────────────────────────────
  const hud   = new HUD({ onSpawnWorker: addWorker });
  const debug = new DebugOverlay(game);
  new SelectionManager(game, (go) => hud.setSelection(go));
  new DebugInspector(game);

  // Seed initial sugar workers
  addWorker();
  addWorker();
  addWorker();

  hud.setWorkerCount(workers.length + waterWorkers.length);

  game.onTick = () => {
    hud.update();
    debug.update();
  };
}

import { ResourceManager } from '../game/resources.js';

const RESOURCE_TYPES = [
  { type: 'sugar', icon: '🍬', label: 'Sugar' },
  { type: 'water', icon: '💧', label: 'Water' },
];

const SPAWN_COST = { sugar: 50, water: 20 };

export class HUD {
  constructor({ onSpawnWorker } = {}) {
    this._workerCount = 0;
    this._resourceEls = {};
    this._workerCountEl = null;
    this._spawnBtn = null;
    this._build(onSpawnWorker);
  }

  _build(onSpawnWorker) {
    const hud = document.createElement('div');
    hud.id = 'hud';

    // Resource counters
    const resources = document.createElement('div');
    resources.className = 'hud-resources';
    for (const { type, icon, label } of RESOURCE_TYPES) {
      const span = document.createElement('span');
      span.className = 'hud-resource';
      span.textContent = `${icon} ${label}: 0`;
      this._resourceEls[type] = span;
      resources.appendChild(span);
    }
    hud.appendChild(resources);

    const div = document.createElement('div');
    div.className = 'hud-divider';
    hud.appendChild(div);

    this._workerCountEl = document.createElement('span');
    this._workerCountEl.className = 'hud-worker-count';
    this._workerCountEl.textContent = 'Workers: 0';
    hud.appendChild(this._workerCountEl);

    const buttons = document.createElement('div');
    buttons.className = 'hud-buttons';
    const btn = document.createElement('button');
    btn.className = 'hud-btn';
    btn.textContent = `+ Spawn Worker (${SPAWN_COST.sugar}🍬 ${SPAWN_COST.water}💧)`;
    btn.addEventListener('click', () => {
      if (btn.disabled) return;
      const canAfford = ResourceManager.get('colony', 'sugar') >= SPAWN_COST.sugar
                     && ResourceManager.get('colony', 'water') >= SPAWN_COST.water;
      if (!canAfford) return;
      ResourceManager.spend('colony', 'sugar', SPAWN_COST.sugar);
      ResourceManager.spend('colony', 'water', SPAWN_COST.water);
      onSpawnWorker?.();
    });
    this._spawnBtn = btn;
    buttons.appendChild(btn);
    hud.appendChild(buttons);

    document.body.appendChild(hud);

    // Selected unit panel (hidden until something is selected)
    this._selPanel = document.createElement('div');
    this._selPanel.id = 'hud-selection';
    this._selPanel.style.display = 'none';
    document.body.appendChild(this._selPanel);
  }

  setWorkerCount(n) {
    this._workerCount = n;
    this._workerCountEl.textContent = `Workers: ${n}`;
  }

  setSelection(go) {
    if (!go) {
      this._selPanel.style.display = 'none';
      this._selectedGO = null;
      return;
    }
    this._selectedGO = go;
    this._selPanel.style.display = 'block';
    this._updateSelPanel();
  }

  _updateSelPanel() {
    if (!this._selectedGO) return;
    const sel = this._selectedGO.components.find(c => typeof c.actionLabel === 'string');
    const action = sel?.actionLabel ?? 'idle';
    this._selPanel.innerHTML =
      `<span class="sel-name">${this._selectedGO.name}</span>`
    + `<span class="sel-action">${action}</span>`;
  }

  update() {
    for (const { type, icon, label } of RESOURCE_TYPES) {
      const count = ResourceManager.get('colony', type);
      this._resourceEls[type].textContent = `${icon} ${label}: ${count}`;
    }

    const canAfford = ResourceManager.get('colony', 'sugar') >= SPAWN_COST.sugar
                   && ResourceManager.get('colony', 'water') >= SPAWN_COST.water;
    this._spawnBtn.disabled = !canAfford;
    this._spawnBtn.style.opacity = canAfford ? '1' : '0.4';

    if (this._selectedGO) this._updateSelPanel();
  }
}

import * as THREE from 'three';
import { FarmPlot, FARM_CROPS } from './components/farm_plot.js';

const HIDE_DELAY_MS = 250;

// Hover-driven crop selection menu. Watches the canvas for hover over any
// FarmPlot gameObject; when one is hit, a small DOM popup appears near the
// cursor with one button per crop. Clicking sets the farm's crop. Leaving
// both the farm and the menu hides it after a short grace period.
export class FarmHoverMenu {
  constructor(game) {
    this._game        = game;
    this._raycaster   = new THREE.Raycaster();
    this._currentFarm = null;
    this._menu        = null;
    this._hideTimer   = null;

    this._onMouseMove = this._onMouseMove.bind(this);
    game.renderer.domElement.addEventListener('mousemove', this._onMouseMove);
  }

  _onMouseMove(e) {
    const farm = this._raycastFarm(e);
    if (farm) {
      this._cancelHide();
      if (farm !== this._currentFarm) this._show(farm, e);
    } else if (this._menu && !this._hideTimer) {
      this._scheduleHide();
    }
  }

  _show(farm, e) {
    this._hide();
    this._currentFarm = farm;

    const fp   = farm.getComponent(FarmPlot);
    const menu = document.createElement('div');
    menu.className = 'farm-menu';
    menu.style.left = `${e.clientX + 14}px`;
    menu.style.top  = `${e.clientY + 14}px`;

    const header = document.createElement('div');
    header.className   = 'farm-menu-header';
    header.textContent = 'Grow';
    menu.append(header);

    for (const crop of FARM_CROPS) {
      const btn = document.createElement('button');
      btn.className = 'farm-crop-btn' + (fp.crop === crop.key ? ' selected' : '');
      btn.title     = crop.label;
      btn.innerHTML = `<span class="crop-icon">${crop.icon}</span><span class="crop-label">${crop.label}</span>`;
      btn.addEventListener('click', (ev) => {
        ev.stopPropagation();
        fp.crop = crop.key;
        // Refresh the menu so the new selection highlights
        this._show(farm, e);
      });
      menu.append(btn);
    }

    menu.addEventListener('mouseenter', () => this._cancelHide());
    menu.addEventListener('mouseleave', () => this._scheduleHide());

    document.body.append(menu);
    this._menu = menu;
  }

  _hide() {
    if (this._menu) { this._menu.remove(); this._menu = null; }
    this._currentFarm = null;
  }

  _scheduleHide() {
    this._cancelHide();
    this._hideTimer = setTimeout(() => {
      this._hide();
      this._hideTimer = null;
    }, HIDE_DELAY_MS);
  }

  _cancelHide() {
    if (this._hideTimer) {
      clearTimeout(this._hideTimer);
      this._hideTimer = null;
    }
  }

  _raycastFarm(e) {
    const canvas = this._game.renderer.domElement;
    const rect   = canvas.getBoundingClientRect();
    const ndc = new THREE.Vector2(
      ((e.clientX - rect.left) / rect.width)  *  2 - 1,
      ((e.clientY - rect.top)  / rect.height) * -2 + 1,
    );
    if (!this._game.camera) return null;
    this._raycaster.setFromCamera(ndc, this._game.camera);

    const farms = this._game.gameObjects.filter(g => g.getComponent(FarmPlot));
    if (farms.length === 0) return null;

    const meshes = [];
    for (const f of farms) {
      f.object3D.traverse(o => {
        if (o.isMesh) {
          o.userData._farm = f;
          meshes.push(o);
        }
      });
    }

    const hit = this._raycaster.intersectObjects(meshes, false)[0];
    if (!hit) return null;

    let obj = hit.object;
    while (obj && !obj.userData?._farm) obj = obj.parent;
    return obj?.userData?._farm ?? null;
  }
}

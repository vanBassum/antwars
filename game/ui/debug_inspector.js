import * as THREE from 'three';

// Right-click on any scene object to inspect it.
// Shows GameObject info, level prop tags, or raw Three.js fallback.
export class DebugInspector {
  constructor(game) {
    this._game  = game;
    this._ray   = new THREE.Raycaster();
    this._mouse = new THREE.Vector2();
    this._panel = this._buildPanel();

    const canvas = game.renderer.domElement;

    canvas.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      this._inspect(e);
    });

    window.addEventListener('keydown', (e) => {
      if (e.code === 'Escape') this._hide();
    });

    // Left-click anywhere outside the panel dismisses it.
    window.addEventListener('click', (e) => {
      if (!this._panel.contains(e.target)) this._hide();
    });
  }

  _buildPanel() {
    const el = document.createElement('div');
    el.id = 'debug-inspector';
    el.style.display = 'none';
    document.body.appendChild(el);
    return el;
  }

  _inspect(e) {
    const rect = this._game.renderer.domElement.getBoundingClientRect();
    this._mouse.set(
      ((e.clientX - rect.left) / rect.width)  * 2 - 1,
      -((e.clientY - rect.top)  / rect.height) * 2 + 1
    );
    this._ray.setFromCamera(this._mouse, this._game.camera);

    const meshes = [];
    this._game.scene.traverse(obj => { if (obj.isMesh) meshes.push(obj); });
    const hits = this._ray.intersectObjects(meshes, false);

    if (hits.length === 0) { this._hide(); return; }
    this._show(e.clientX, e.clientY, this._buildInfo(hits[0]));
  }

  _buildInfo(hit) {
    // Walk up the parent chain to find a tag.
    let obj = hit.object;
    while (obj) {
      if (obj.userData?.gameObject) return this._infoGameObject(obj.userData.gameObject, hit.point);
      if (obj.userData?.debugInfo)  return this._infoProp(obj.userData.debugInfo, obj, hit.point);
      obj = obj.parent;
    }
    return this._infoRaw(hit.object, hit.point);
  }

  _infoGameObject(go, point) {
    const p = go.position;
    let html = `<div class="di-header">GAME OBJECT</div>`;
    html += `<div class="di-name">${go.name}</div>`;
    html += `<div class="di-pos">${_fmt(p.x)} ${_fmt(p.y)} ${_fmt(p.z)}</div>`;
    for (const c of go.components) {
      const type = c.constructor.name;
      if (type === 'ModelRenderer') {
        html += _row('model', _file(c.path));
        if (c._state !== 'ready') html += _row('state', `<span class="di-warn">${c._state}</span>`);
      } else if (type === 'GOAPAgent') {
        html += _row('action', c.currentActionName ?? 'idle');
      } else {
        html += _row('comp', `<span class="di-dim">${type}</span>`);
      }
    }
    return html;
  }

  _infoProp(info, obj, point) {
    const header = info.source === 'path' ? 'PATH DECAL' : 'LEVEL PROP';
    let html = `<div class="di-header">${header}</div>`;
    html += `<div class="di-name">${_file(info.model)}</div>`;
    if (info.zone)     html += _row('zone', info.zone);
    if (info.zoneType) html += _row('type', info.zoneType);
    if (info.pathFrom) html += _row('from → to', `${info.pathFrom} → ${info.pathTo}`);
    const p = obj.position;
    html += `<div class="di-pos">${_fmt(p.x)} ${_fmt(p.y)} ${_fmt(p.z)}</div>`;
    return html;
  }

  _infoRaw(mesh, point) {
    let html = `<div class="di-header">THREE OBJECT</div>`;
    html += `<div class="di-name">${mesh.name || '(unnamed)'}</div>`;
    html += _row('type', mesh.type);
    html += `<div class="di-pos">hit ${_fmt(point.x)} ${_fmt(point.y)} ${_fmt(point.z)}</div>`;
    let p = mesh.parent;
    let depth = 0;
    while (p && p.type !== 'Scene' && depth < 5) {
      if (p.name) html += _row('parent', `<span class="di-dim">${p.name}</span>`);
      p = p.parent;
      depth++;
    }
    return html;
  }

  _show(cx, cy, html) {
    this._panel.innerHTML = html;
    this._panel.style.display = 'block';
    // Clamp to viewport so the panel never overflows the edge.
    const pw = this._panel.offsetWidth  || 220;
    const ph = this._panel.offsetHeight || 160;
    this._panel.style.left = `${Math.min(cx + 14, window.innerWidth  - pw - 8)}px`;
    this._panel.style.top  = `${Math.min(cy + 14, window.innerHeight - ph - 8)}px`;
  }

  _hide() {
    this._panel.style.display = 'none';
  }
}

function _row(label, val) {
  return `<div class="di-row"><span class="di-label">${label}</span><span class="di-val">${val}</span></div>`;
}
function _fmt(n) { return n.toFixed(2); }
function _file(path) { return path ? path.split('/').pop().replace('.glb', '') : '(?)'; }

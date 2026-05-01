const f4    = v => +v.toFixed(4);
const toDeg = v => +(v * 180 / Math.PI).toFixed(2);
const toRad = v => v * Math.PI / 180;

export class Inspector {
  constructor(el, selection, { terrain } = {}) {
    this._el      = el;
    this._sel     = selection;
    this._terrain = terrain;
    this._go      = null;

    this._render(null);
    selection.onChange(go => { this._go = go; this._render(go); });
  }

  _render(go) {
    if (!go) {
      this._el.innerHTML = `<div class="panel-header">Inspector</div><div class="insp-empty">Nothing selected</div>`;
      return;
    }

    const { position: p, rotation: r, scale: s } = go.object3D;
    const isTerrain = this._terrain && go === this._terrain.go;

    this._el.innerHTML = `
      <div class="panel-header">Inspector</div>
      <div class="insp-scroll">
        <div class="insp-name">${go.name}</div>
        <div class="insp-section">
          <div class="insp-section-title">Transform</div>
          ${this._row('P','p', [f4(p.x), f4(p.y), f4(p.z)], 0.1)}
          ${this._row('R','r', [toDeg(r.x), toDeg(r.y), toDeg(r.z)], 1)}
          ${this._row('S','s', [f4(s.x), f4(s.y), f4(s.z)], 0.1)}
        </div>
        ${isTerrain ? this._terrainBlock() : ''}
      </div>`;

    this._el.querySelectorAll('.t-inp').forEach(inp =>
      inp.addEventListener('input', () => this._applyTransform(inp)));

    if (isTerrain) this._wireTerrain();
  }

  _row(lbl, pfx, [x,y,z], step) {
    return `<div class="t-row">
      <span class="t-label">${lbl}</span>
      <div class="t-fields">
        <div class="t-field"><span>X</span><input class="t-inp" type="number" data-prop="${pfx}x" value="${x}" step="${step}"></div>
        <div class="t-field"><span>Y</span><input class="t-inp" type="number" data-prop="${pfx}y" value="${y}" step="${step}"></div>
        <div class="t-field"><span>Z</span><input class="t-inp" type="number" data-prop="${pfx}z" value="${z}" step="${step}"></div>
      </div></div>`;
  }

  _applyTransform(inp) {
    const v = parseFloat(inp.value);
    if (isNaN(v) || !this._go) return;
    const o = this._go.object3D;
    switch (inp.dataset.prop) {
      case 'px': o.position.x = v;        break;
      case 'py': o.position.y = v;        break;
      case 'pz': o.position.z = v;        break;
      case 'rx': o.rotation.x = toRad(v); break;
      case 'ry': o.rotation.y = toRad(v); break;
      case 'rz': o.rotation.z = toRad(v); break;
      case 'sx': o.scale.x    = v;        break;
      case 'sy': o.scale.y    = v;        break;
      case 'sz': o.scale.z    = v;        break;
    }
  }

  _terrainBlock() {
    const s = this._terrain.getSettings() ?? { seed:42, width:128, depth:128, heightScale:5 };
    return `<div class="insp-section">
      <div class="insp-section-title">Terrain</div>
      <div class="f-row"><label>Seed</label><input class="f-input" type="number" id="ti-seed" value="${s.seed}" step="1"></div>
      <div class="f-row"><label>Width</label><input class="f-input" type="number" id="ti-w" value="${s.width}" step="8" min="16" max="512"></div>
      <div class="f-row"><label>Depth</label><input class="f-input" type="number" id="ti-d" value="${s.depth}" step="8" min="16" max="512"></div>
      <div class="f-row"><label>Height Scale</label><input class="f-input" type="number" id="ti-h" value="${s.heightScale}" step="0.5" min="1"></div>
      <button class="insp-btn" id="ti-regen">Regenerate</button>
    </div>`;
  }

  _wireTerrain() {
    this._el.querySelector('#ti-regen')?.addEventListener('click', () => {
      const s = {
        seed:        parseInt(this._el.querySelector('#ti-seed').value) || 42,
        width:       parseInt(this._el.querySelector('#ti-w').value)    || 128,
        depth:       parseInt(this._el.querySelector('#ti-d').value)    || 128,
        heightScale: parseFloat(this._el.querySelector('#ti-h').value)  || 5,
      };
      this._terrain.loadSettings(s);
      this._sel.set(this._terrain.go);
    });
  }
}

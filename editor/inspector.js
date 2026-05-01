const f4  = v => +v.toFixed(4);
const toDeg = v => +(v * 180 / Math.PI).toFixed(2);
const toRad = v => v * Math.PI / 180;

export class Inspector {
  constructor(el, selection) {
    this._el = el;
    this._go = null;

    this._render(null);
    selection.onChange(go => { this._go = go; this._render(go); });
  }

  _render(go) {
    if (!go) {
      this._el.innerHTML = `
        <div class="panel-header">Inspector</div>
        <div class="panel-empty">Select an object</div>`;
      return;
    }

    const { position: p, rotation: r, scale: s } = go.object3D;

    this._el.innerHTML = `
      <div class="panel-header">Inspector</div>
      <div class="inspector-body">
        <div class="inspector-name">${go.name}</div>
        <hr class="panel-separator">
        <div class="inspector-group-title">Transform</div>
        ${this._row('P', 'p', [f4(p.x),    f4(p.y),    f4(p.z)],    0.1)}
        ${this._row('R', 'r', [toDeg(r.x), toDeg(r.y), toDeg(r.z)], 1)}
        ${this._row('S', 's', [f4(s.x),    f4(s.y),    f4(s.z)],    0.1)}
      </div>`;

    this._el.querySelectorAll('.insp-input').forEach(input => {
      input.addEventListener('input', () => this._apply(input));
    });
  }

  _row(label, prefix, [x, y, z], step) {
    return `
      <div class="insp-row">
        <span class="insp-row-label">${label}</span>
        <div class="insp-row-fields">
          <label class="insp-field">X<input class="insp-input" type="number" data-prop="${prefix}x" value="${x}" step="${step}"></label>
          <label class="insp-field">Y<input class="insp-input" type="number" data-prop="${prefix}y" value="${y}" step="${step}"></label>
          <label class="insp-field">Z<input class="insp-input" type="number" data-prop="${prefix}z" value="${z}" step="${step}"></label>
        </div>
      </div>`;
  }

  _apply(input) {
    const v = parseFloat(input.value);
    if (isNaN(v) || !this._go) return;
    const o = this._go.object3D;
    switch (input.dataset.prop) {
      case 'px': o.position.x = v;       break;
      case 'py': o.position.y = v;       break;
      case 'pz': o.position.z = v;       break;
      case 'rx': o.rotation.x = toRad(v); break;
      case 'ry': o.rotation.y = toRad(v); break;
      case 'rz': o.rotation.z = toRad(v); break;
      case 'sx': o.scale.x = v;          break;
      case 'sy': o.scale.y = v;          break;
      case 'sz': o.scale.z = v;          break;
    }
  }
}

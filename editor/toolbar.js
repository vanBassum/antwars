export class Toolbar {
  constructor(toolbarEl, panelEl) {
    this._toolbarEl = toolbarEl;
    this._panelEl   = panelEl;
    this._tools     = [];
    this._active    = null;
  }

  register(tool) {
    this._tools.push(tool);

    const btn = document.createElement('button');
    btn.className = 'tool-btn';
    btn.title     = tool.label;
    btn.textContent = tool.icon;
    btn.addEventListener('click', () => this.activate(tool));
    this._toolbarEl.appendChild(btn);
    tool._btn = btn;

    if (!this._active) this.activate(tool);
  }

  activate(tool) {
    if (this._active) {
      this._active._btn.classList.remove('active');
      this._active.deactivate?.();
    }
    this._active = tool;
    tool._btn.classList.add('active');
    this._panelEl.innerHTML = '';
    tool.buildPanel(this._panelEl);
  }
}

export const Selection = {
  _current:   null,
  _listeners: [],
  get current() { return this._current; },
  set(go) {
    if (this._current === go) return;
    this._current = go;
    for (const fn of this._listeners) fn(go);
  },
  clear() { this.set(null); },
  onChange(fn) {
    this._listeners.push(fn);
    return () => { this._listeners = this._listeners.filter(l => l !== fn); };
  },
};

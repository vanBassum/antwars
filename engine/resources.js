// Player-wide resource stockpile. Shared mutable state with change notifications.
export class Resources {
  constructor() {
    this._values    = {};
    this._listeners = new Set();
  }

  get(key)        { return this._values[key] ?? 0; }
  set(key, n)     { this._values[key] = n; this._notify(); }
  add(key, n = 1) {
    this._values[key] = (this._values[key] ?? 0) + n;
    this._notify();
  }

  values() { return { ...this._values }; }

  // Subscribe; fires immediately with current values. Returns an unsubscribe fn.
  onChange(fn) {
    this._listeners.add(fn);
    fn(this.values());
    return () => this._listeners.delete(fn);
  }

  _notify() {
    const v = this.values();
    for (const fn of this._listeners) fn(v);
  }
}

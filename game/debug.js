// Central debug-mode flag. UI components and overlays subscribe to onChange
// so they can switch their rendering between "release" and "debug" without
// every system having to poll a global each frame.
//
// State persists across sessions via localStorage.
export class DebugMode {
  constructor({ key = 'antwars.debugMode' } = {}) {
    this._key       = key;
    this._listeners = new Set();
    let saved = null;
    try { saved = localStorage.getItem(key); } catch {}
    this._enabled = saved === 'true';
  }

  get enabled() { return this._enabled; }

  toggle()    { this.set(!this._enabled); }
  enable()    { this.set(true); }
  disable()   { this.set(false); }

  set(value) {
    value = !!value;
    if (value === this._enabled) return;
    this._enabled = value;
    try { localStorage.setItem(this._key, String(value)); } catch {}
    for (const fn of this._listeners) fn(value);
  }

  // Subscribe; fires immediately with current state. Returns an unsubscribe.
  onChange(fn) {
    this._listeners.add(fn);
    fn(this._enabled);
    return () => this._listeners.delete(fn);
  }
}

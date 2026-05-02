// Global debug-mode flag. Toggle with the backtick (`) key.
// Other modules subscribe via onDebugChange() to react when it flips.
const _listeners = new Set();
let _debug = false;

export function isDebug()     { return _debug; }
export function setDebug(v)   { _debug = !!v; _notify(); }
export function toggleDebug() { setDebug(!_debug); }

// Subscribe; fires immediately with the current value. Returns an unsubscribe fn.
export function onDebugChange(fn) {
  _listeners.add(fn);
  fn(_debug);
  return () => _listeners.delete(fn);
}

function _notify() {
  for (const fn of _listeners) fn(_debug);
}

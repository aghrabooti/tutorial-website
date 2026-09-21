globalThis.__ENV = globalThis.__ENV || {};
globalThis.Deno = {
  env: { get: (k) => globalThis.__ENV[k] },
  serve: (fn) => { globalThis.__handler = fn; },
};

function applyTestEnv(nextVars) {
  const prev = {};
  for (const [k, v] of Object.entries(nextVars || {})) {
    prev[k] = process.env[k];
    process.env[k] = v;
  }
  return function restore() {
    for (const [k, v] of Object.entries(prev)) {
      if (typeof v === 'undefined') delete process.env[k];
      else process.env[k] = v;
    }
  };
}

module.exports = { applyTestEnv };


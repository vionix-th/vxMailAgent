const { requireBackend } = require('./paths');

function createLogCapture() {
  const loggerModule = requireBackend('services/logger.js');
  if (typeof loggerModule.addLogObserver !== 'function') {
    throw new Error('Backend logger does not expose addLogObserver; rebuild the backend.');
  }
  const buffer = [];
  const remove = loggerModule.addLogObserver((entry) => {
    buffer.push(entry);
  });
  return {
    entries: buffer,
    drain() {
      const copy = buffer.slice();
      buffer.length = 0;
      return copy;
    },
    clear() {
      buffer.length = 0;
    },
    stop() {
      remove();
    },
    waitFor(predicate, { timeoutMs = 5000, intervalMs = 50 } = {}) {
      if (typeof predicate !== 'function') {
        throw new Error('predicate must be a function');
      }
      const start = Date.now();
      return new Promise((resolve, reject) => {
        function poll() {
          const match = buffer.find((entry) => {
            try {
              return predicate(entry);
            } catch {
              return false;
            }
          });
          if (match) {
            resolve(match);
            return;
          }
          if (Date.now() - start >= timeoutMs) {
            reject(new Error('Timed out waiting for matching log entry'));
            return;
          }
          setTimeout(poll, intervalMs);
        }
        poll();
      });
    },
  };
}

function assertMetaFields(entry, fields) {
  if (!entry || typeof entry !== 'object') {
    throw new Error('log entry required');
  }
  const meta = entry.meta || {};
  const missing = [];
  for (const key of fields || []) {
    if (!(key in meta)) missing.push(key);
  }
  if (missing.length) {
    throw new Error(`log meta missing required fields: ${missing.join(', ')}`);
  }
  return meta;
}

module.exports = { createLogCapture, assertMetaFields };

// Minimal diagnostics shim for Node test child processes.
// Loaded via NODE_OPTIONS="-r ./lib/diagnostics-shim.cjs" by run-all-tests.cjs
// Dumps active handles/requests upon IPC signal or SIGUSR2 to help find leaks.

function safeStringify(x) {
  try {
    return JSON.stringify(x);
  } catch {
    return String(x);
  }
}

function describeHandle(h) {
  const name = (h && h.constructor && h.constructor.name) || typeof h;
  const info = {};
  try {
    if (name === 'Timeout' || name === 'Immediate' || name === 'Interval') {
      info._timer = true;
    }
    if (h && typeof h.hasRef === 'function') info.ref = h.hasRef();
    if (h && typeof h.refresh === 'function') info.refreshable = true;
    if (h && typeof h._onTimeout === 'function') info.onTimeout = true;
  } catch {}
  return { name, info };
}

function dumpActive(reason) {
  const handles = (process._getActiveHandles ? process._getActiveHandles() : []) || [];
  const requests = (process._getActiveRequests ? process._getActiveRequests() : []) || [];
  // Avoid creating new timers here; keep it synchronous
  const out = {
    diag: 'active-handles',
    reason,
    pid: process.pid,
    handles: handles.map(describeHandle),
    requests: requests.map((r) => ({ name: (r && r.constructor && r.constructor.name) || typeof r })),
  };
  // Print a JSON line prefix the runner can spot
  try { console.error(`__DIAG__ ${JSON.stringify(out)}`); } catch { console.error('__DIAG__ diagnostics failed'); }
}

process.on('message', (msg) => {
  try {
    if (msg && msg.type === 'dump-handles') dumpActive('ipc');
  } catch {}
});

try { process.on('SIGUSR2', () => dumpActive('SIGUSR2')); } catch {}


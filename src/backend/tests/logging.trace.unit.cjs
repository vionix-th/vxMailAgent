const { test } = require('node:test');
const assert = require('node:assert');
const path = require('path');

test('logging trace: begin/end trace and spans update fields', async () => {
  const logging = require(path.join(__dirname, '..', 'dist', 'backend', 'services', 'logging.js'));
  const traces = [];
  const req = {
    userContext: {
      uid: 'u1',
      repos: {
        traces: {
          append: async (t) => { traces.push(t); },
          update: async (id, updater) => {
            const idx = traces.findIndex(x => x.id === id);
            if (idx >= 0) {
              const cur = traces[idx];
              const res = updater(cur);
              if (res) traces[idx] = res;
            }
          },
          list: async () => traces.slice(),
          replace: async (n) => { traces.splice(0, traces.length, ...n); },
          clear: async () => { traces.splice(0, traces.length); },
        }
      }
    }
  };

  process.env.TRACE_PERSIST = 'true';
  const id = logging.beginTrace({ emailId: 'e1' }, req);
  assert.ok(id);
  const sid = logging.beginSpan(id, { type: 'other', name: 'n1' }, req);
  assert.ok(typeof sid === 'string');
  logging.endSpan(id, sid, { status: 'ok' }, req);
  logging.endTrace(id, 'ok', undefined, req);
  // Wait for queued async writes to complete
  if (typeof logging.flushLogQueue === 'function') { await logging.flushLogQueue(); }
  const all = await req.userContext.repos.traces.list();
  assert.strictEqual(all.length, 1);
  const t = all[0];
  assert.ok(t.endedAt);
  assert.ok(t.spans && t.spans.length === 1);
  assert.strictEqual(t.spans[0].status, 'ok');
});

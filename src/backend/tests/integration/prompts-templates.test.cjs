const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  discoverTestUser,
  startBackend,
  createSession,
  fetchJson,
} = require('../lib/harness');
const { uid } = discoverTestUser();

function authHeaders(sessionHeaders, extra = {}) {
  return { ...sessionHeaders, ...extra };
}

test('integration: prompts and templates lifecycle', { concurrency: false, timeout: 20000 }, async () => {
  const { baseUrl, stop } = await startBackend();
  const { headers: sessionHeaders } = await createSession(baseUrl, uid);
  const jsonHeaders = authHeaders(sessionHeaders, { 'Content-Type': 'application/json' });

  const resources = {
    promptId: `int-prompt-${Date.now()}`,
    templateId: `int-template-${Date.now()}`,
    imprintId: `int-imprint-${Date.now()}`,
  };

  try {
      const promptPayload = {
        id: resources.promptId,
        name: 'Integration Prompt',
        messages: [
          { id: 'm1', role: 'system', content: 'system msg' },
          { id: 'm2', role: 'user', content: 'hello' },
        ],
      };
      const createPrompt = await fetchJson(baseUrl, '/api/prompts', {
        method: 'POST',
        headers: jsonHeaders,
        body: JSON.stringify(promptPayload),
      });
      assert.strictEqual(createPrompt.ok, true, 'prompt creation failed');

      const duplicatePrompt = await fetch(`${baseUrl}/api/prompts`, {
        method: 'POST',
        headers: jsonHeaders,
        body: JSON.stringify(promptPayload),
      });
      assert.strictEqual(duplicatePrompt.status, 409, 'duplicate prompt must conflict');

      const updatePrompt = await fetchJson(baseUrl, `/api/prompts/${encodeURIComponent(resources.promptId)}`, {
        method: 'PUT',
        headers: jsonHeaders,
        body: JSON.stringify({ ...promptPayload, name: 'Integration Prompt v2' }),
      });
      assert.strictEqual(updatePrompt.ok, true, 'prompt update failed');

      const deleteMissing = await fetch(`${baseUrl}/api/prompts/nonexistent`, {
        method: 'DELETE',
        headers: sessionHeaders,
      });
      assert.strictEqual(deleteMissing.status, 404, 'deleting missing prompt should 404');

      const templatePayload = {
        id: resources.templateId,
        name: 'Integration Template',
        messages: [
          { role: 'system', content: 'Template system' },
        ],
      };
      const createTemplate = await fetchJson(baseUrl, '/api/prompt-templates', {
        method: 'POST',
        headers: jsonHeaders,
        body: JSON.stringify(templatePayload),
      });
      assert.strictEqual(createTemplate.ok, true, 'template creation failed');

      const updateTemplate = await fetchJson(baseUrl, `/api/prompt-templates/${encodeURIComponent(resources.templateId)}`, {
        method: 'PUT',
        headers: jsonHeaders,
        body: JSON.stringify({ name: 'Integration Template v2' }),
      });
      assert.strictEqual(updateTemplate.ok, true, 'template update failed');

      const deleteOptimizer = await fetch(`${baseUrl}/api/prompt-templates/prompt_optimizer`, {
        method: 'DELETE',
        headers: sessionHeaders,
      });
      assert.strictEqual(deleteOptimizer.status, 400, 'deleting prompt_optimizer should fail');

      const imprintPayload = {
        id: resources.imprintId,
        name: 'Integration Imprint',
        content: 'Hello integration',
        agentId: 'agent-placeholder',
      };
      const createImprint = await fetchJson(baseUrl, '/api/imprints', {
        method: 'POST',
        headers: jsonHeaders,
        body: JSON.stringify(imprintPayload),
      });
      assert.strictEqual(createImprint.status, 201, 'imprint creation must return 201');

      const updateImprint = await fetchJson(baseUrl, `/api/imprints/${encodeURIComponent(resources.imprintId)}`, {
        method: 'PUT',
        headers: jsonHeaders,
        body: JSON.stringify({ name: 'Integration Imprint v2' }),
      });
      assert.strictEqual(updateImprint.ok, true, 'imprint update failed');

      const listImprints = await fetchJson(baseUrl, '/api/imprints', { headers: sessionHeaders });
      assert.strictEqual(listImprints.ok, true, 'list imprints failed');
      const imprintExists = Array.isArray(listImprints.data)
        && listImprints.data.some((item) => item.id === resources.imprintId);
      assert.ok(imprintExists, 'created imprint missing from list');

      const deleteImprint = await fetch(`${baseUrl}/api/imprints/${encodeURIComponent(resources.imprintId)}`, {
        method: 'DELETE',
        headers: sessionHeaders,
      });
      assert.strictEqual(deleteImprint.status, 204, 'imprint delete must return 204');
  } finally {
    await stop();
  }
});

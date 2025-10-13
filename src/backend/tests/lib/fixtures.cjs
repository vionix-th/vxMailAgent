const path = require('path');
const { applyTestEnvDefaults, resolveTestUserId } = require('./env.cjs');

const distBackend = path.join(__dirname, '..', '..', 'dist', 'backend');

function requireBackend(relPath) {
  return require(path.join(distBackend, relPath));
}

function uniqueId(prefix) {
  const now = Date.now().toString(36);
  const rand = Math.random().toString(36).slice(2, 8);
  return `${prefix}_${now}_${rand}`;
}

function cloneSettings(settings) {
  return {
    virtualRoot: settings.virtualRoot,
    apiConfigs: settings.apiConfigs.map((cfg) => ({ ...cfg })),
    signatures: { ...(settings.signatures || {}) },
    fetcherAutoStart: settings.fetcherAutoStart,
    sessionTimeoutMinutes: settings.sessionTimeoutMinutes,
    ...(settings.payload ? { payload: { ...settings.payload } } : {}),
  };
}

function defaultSettings() {
  return {
    virtualRoot: '',
    apiConfigs: [],
    signatures: {},
    fetcherAutoStart: false,
    sessionTimeoutMinutes: 15,
  };
}

class TestFixtures {
  constructor(uid) {
    applyTestEnvDefaults();
    this.uid = uid || resolveTestUserId();
    this.bundlePromise = null;
    this.initialSettings = undefined;
    this.created = {
      prompts: [],
      agents: [],
      directors: [],
      filters: [],
      accounts: [],
    };
  }

  async bundle() {
    if (!this.bundlePromise) {
      applyTestEnvDefaults();
      const { getUserRepoBundle } = requireBackend('repository/registry.js');
      this.bundlePromise = getUserRepoBundle(this.uid);
    }
    return this.bundlePromise;
  }

  async ensureSettings(mutator) {
    const bundle = await this.bundle();
    const loaded = await bundle.settings.load();
    const base = cloneSettings(loaded ?? defaultSettings());
    if (this.initialSettings === undefined) {
      this.initialSettings = cloneSettings(base);
    }
    const next = mutator ? mutator(cloneSettings(base)) : base;
    await bundle.settings.save(next);
    return cloneSettings(next);
  }

  async ensureApiConfig(override = {}) {
    const apiConfig = {
      id: override.id || uniqueId('cfg'),
      name: override.name || 'Fixture OpenAI',
      provider: override.provider || 'openai',
      apiKey: override.apiKey || 'mock-api-key',
      model: override.model || 'gpt-4o-mini',
      ...(override.baseUrl ? { baseUrl: override.baseUrl } : {}),
    };
    await this.ensureSettings((settings) => {
      const existingIdx = settings.apiConfigs.findIndex((cfg) => cfg.id === apiConfig.id);
      const nextConfigs = settings.apiConfigs.filter((cfg) => cfg.id !== apiConfig.id);
      nextConfigs.push(apiConfig);
      return {
        ...settings,
        apiConfigs: nextConfigs,
        fetcherAutoStart: typeof override.fetcherAutoStart === 'boolean' ? override.fetcherAutoStart : false,
      };
    });
    return apiConfig;
  }

  async ensurePrompt(override = {}) {
    const prompt = {
      id: override.id || uniqueId('prompt'),
      name: override.name || 'Fixture Prompt',
      messages: Array.isArray(override.messages) && override.messages.length
        ? override.messages
        : [{ role: 'system', content: 'You are a fixture prompt.' }],
    };
    const bundle = await this.bundle();
    const existing = await bundle.prompts.getById(prompt.id);
    if (existing) return existing;
    await bundle.prompts.insert(prompt);
    this.created.prompts.push(prompt.id);
    return prompt;
  }

  async ensureAgent(override = {}) {
    const agent = {
      id: override.id || uniqueId('agent'),
      name: override.name || 'Fixture Agent',
      type: override.type || 'openai',
      promptId: override.promptId,
      apiConfigId: override.apiConfigId,
      enabledOptionalTools: Array.isArray(override.enabledOptionalTools)
        ? [...override.enabledOptionalTools]
        : [],
    };
    if (typeof agent.promptId !== 'string' || !agent.promptId) {
      throw new Error('ensureAgent requires promptId');
    }
    if (typeof agent.apiConfigId !== 'string' || !agent.apiConfigId) {
      throw new Error('ensureAgent requires apiConfigId');
    }
    const bundle = await this.bundle();
    const existing = await bundle.agents.getById(agent.id);
    if (existing) return existing;
    await bundle.agents.insert(agent);
    this.created.agents.push(agent.id);
    return agent;
  }

  async ensureDirector(override = {}) {
    const director = {
      id: override.id || uniqueId('director'),
      name: override.name || 'Fixture Director',
      promptId: override.promptId,
      apiConfigId: override.apiConfigId,
      agentIds: Array.isArray(override.agentIds) ? [...override.agentIds] : [],
      enabledOptionalTools: Array.isArray(override.enabledOptionalTools)
        ? [...override.enabledOptionalTools]
        : [],
    };
    if (typeof director.promptId !== 'string' || !director.promptId) {
      throw new Error('ensureDirector requires promptId');
    }
    if (typeof director.apiConfigId !== 'string' || !director.apiConfigId) {
      throw new Error('ensureDirector requires apiConfigId');
    }
    const bundle = await this.bundle();
    const existing = await bundle.directors.getById(director.id);
    if (existing) return existing;
    await bundle.directors.insert(director);
    this.created.directors.push(director.id);
    return director;
  }

  async ensureFilter(override = {}) {
    const filter = {
      id: override.id || uniqueId('filter'),
      field: override.field || 'subject',
      regex: override.regex || '.*',
      directorId: override.directorId,
      duplicateAllowed: typeof override.duplicateAllowed === 'boolean' ? override.duplicateAllowed : false,
    };
    if (typeof filter.directorId !== 'string' || !filter.directorId) {
      throw new Error('ensureFilter requires directorId');
    }
    const bundle = await this.bundle();
    const existing = await bundle.filters.getById(filter.id);
    if (existing) return existing;
    await bundle.filters.insert(filter);
    this.created.filters.push(filter.id);
    return filter;
  }

  async ensureAccount(override = {}) {
    const expiry = new Date(Date.now() + 60 * 60 * 1000).toISOString();
    const account = {
      id: override.id || uniqueId('acct'),
      provider: override.provider || 'gmail',
      email: override.email || `${uniqueId('fixture')}@example.com`,
      signature: typeof override.signature === 'string' ? override.signature : '',
      tokens: override.tokens || {
        accessToken: 'test-access-token',
        refreshToken: 'test-refresh-token',
        expiry,
      },
    };
    const bundle = await this.bundle();
    const existing = await bundle.accounts.getById(account.id);
    if (existing) return existing;
    await bundle.accounts.insert(account);
    this.created.accounts.push(account.id);
    return account;
  }

  async cleanup() {
    try {
      const bundle = await this.bundle();
      for (const id of [...this.created.filters].reverse()) {
        try { await bundle.filters.delete(id); } catch {}
      }
      for (const id of [...this.created.directors].reverse()) {
        try { await bundle.directors.delete(id); } catch {}
      }
      for (const id of [...this.created.agents].reverse()) {
        try { await bundle.agents.delete(id); } catch {}
      }
      for (const id of [...this.created.prompts].reverse()) {
        try { await bundle.prompts.delete(id); } catch {}
      }
      for (const id of [...this.created.accounts].reverse()) {
        try { await bundle.accounts.delete(id); } catch {}
      }
      if (this.initialSettings) {
        try {
          await bundle.settings.save(cloneSettings(this.initialSettings));
        } catch (error) {
          console.warn('Fixture settings restore failed', error);
        }
      }
    } catch (error) {
      console.warn('Fixture cleanup error', error);
    } finally {
      const { repoBundleRegistry } = requireBackend('repository/registry.js');
      try {
        repoBundleRegistry.removeBundle(this.uid);
      } catch {}
      this.created = { prompts: [], agents: [], directors: [], filters: [], accounts: [] };
      this.initialSettings = undefined;
      this.bundlePromise = null;
    }
  }
}

function createFixtures(options = {}) {
  return new TestFixtures(options.uid);
}

module.exports = {
  createFixtures,
  TestFixtures,
  uniqueId,
};

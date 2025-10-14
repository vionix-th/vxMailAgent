import { ToolCallResult, ApiConfig, ConversationThread, Director, Agent, ToolDescriptor, PromptMessage } from '../../shared/types';
import { TOOL_REGISTRY } from '../../shared/tools';
import { resolveAgentToolDescriptors, resolveDirectorToolDescriptors, resolveMandatoryToolDescriptors } from '../services/tool-config-service';
import { ValidationError, InvalidAgentConfigError } from '../services/error-handler';
import { ToolHandlerRegistrar, ToolExecutionRuntime } from './types';
import { serializeApiConfig } from '../services/apiConfigSerializer';
import { ensureAgentThread, runAgentConversation, AgentConversationPersistence } from '../services/orchestration-agent';
import { newId } from '../utils/id';

export function registerMetaHandlers(register: ToolHandlerRegistrar) {
  register('list_tools', listToolsExecutor);
  register('describe_tool', describeToolExecutor);
  register('read_api_docs', readApiDocsExecutor);
  register('delegate_to_agent', delegateToAgentExecutor);
  register('list_agents', listAgentsExecutor);
}

const listToolsExecutor = async ({ repos, params }: ToolExecutionRuntime): Promise<ToolCallResult> => {
  const roleRaw = typeof params?.role === 'string' ? params.role.toLowerCase() : '';
  const role = roleRaw === 'director' ? 'director' as const : 'agent' as const;
  const directorId = typeof params?.directorId === 'string' ? params.directorId : '';
  const agentId = typeof params?.agentId === 'string' ? params.agentId : '';
  let descriptors: ToolDescriptor[];
  if (directorId) {
    try {
      const { descriptors: descs } = await getDirectorWithDescriptors(repos, directorId);
      descriptors = descs;
    } catch (error: any) {
      return { kind: 'list_tools', success: false, result: null, error: error?.message || 'invalid_director_tool_config' };
    }
  } else if (agentId) {
    try {
      const { descriptors: descs } = await getAgentWithDescriptors(repos, agentId);
      descriptors = descs;
    } catch (error: any) {
      return { kind: 'list_tools', success: false, result: null, error: error?.message || 'invalid_agent_tool_config' };
    }
  } else {
    descriptors = resolveMandatoryToolDescriptors(role);
  }
  const visible = descriptors.map((descriptor) => ({ name: descriptor.name, description: descriptor.description }));
  return { kind: 'list_tools', success: true, result: visible };
};

const describeToolExecutor = async ({ params }: ToolExecutionRuntime): Promise<ToolCallResult> => {
  const toolName = typeof params?.name === 'string' ? params.name : '';
  if (!toolName) {
    return { kind: 'describe_tool', success: false, result: null, error: 'name is required' };
  }
  const descriptor = TOOL_REGISTRY.find((tool) => tool.name === toolName);
  if (!descriptor) {
    return { kind: 'describe_tool', success: false, result: null, error: 'tool not found' };
  }
  return {
    kind: 'describe_tool',
    success: true,
    result: { name: descriptor.name, description: descriptor.description, parameters: descriptor.parameters },
  };
};

const readApiDocsExecutor = async ({ params }: ToolExecutionRuntime): Promise<ToolCallResult> => {
  const query = typeof params?.query === 'string' ? params.query : '';
  const topK = typeof params?.topK === 'number' ? params.topK : 3;
  if (!query) {
    return { kind: 'read_api_docs', success: false, result: null, error: 'query is required' };
  }
  const snippets = [
    { source: 'docs/DEVELOPER.md', note: 'Backend API and type system overview.' },
    { source: 'docs/DESIGN.md', note: 'Architecture, data model, and contracts.' },
    { source: 'README.md', note: 'Quick start guidance and API summary.' },
  ].slice(0, Math.max(1, Math.min(3, topK)));
  return { kind: 'read_api_docs', success: true, result: { query, matches: snippets } };
};

const delegateToAgentExecutor = async (runtime: ToolExecutionRuntime): Promise<ToolCallResult> => {
  return await executeDelegateToAgent(runtime);
};

const listAgentsExecutor = async ({ repos, params }: ToolExecutionRuntime): Promise<ToolCallResult> => {
  const allAgents = await repos.agents.list();
  const directorId = typeof params?.directorId === 'string' ? params.directorId : undefined;
  let result = allAgents;
  if (directorId) {
    const directors = await repos.directors.list();
    const director = directors.find((candidate: any) => candidate.id === directorId);
    if (!director) {
      return { kind: 'list_agents', success: false, result: null, error: 'Director not found' };
    }
    const agentSet = new Set<string>(Array.isArray(director.agentIds) ? director.agentIds : []);
    result = allAgents.filter((agent: any) => agentSet.has(agent.id));
  }
  const agentsSlim = result.map((agent: any) => ({ id: agent.id, name: agent.name, apiConfigId: agent.apiConfigId }));
  return { kind: 'list_agents', success: true, result: agentsSlim };
};

async function getDirectorWithDescriptors(
  repos: ToolExecutionRuntime['repos'],
  directorId: string
): Promise<{ director: Director; descriptors: ToolDescriptor[] }> {
  const directors = await repos.directors.list();
  const director = (directors as Director[]).find((candidate) => candidate.id === directorId);
  if (!director) {
    throw new ValidationError('Director not found', 'DIRECTOR_NOT_FOUND');
  }
  return { director, descriptors: resolveDirectorToolDescriptors(director) };
}

async function getAgentWithDescriptors(
  repos: ToolExecutionRuntime['repos'],
  agentId: string
): Promise<{ agent: Agent; descriptors: ToolDescriptor[] }> {
  const agents = await repos.agents.list();
  const agent = (agents as Agent[]).find((candidate) => candidate.id === agentId);
  if (!agent) {
    throw new InvalidAgentConfigError('Agent not found', 'AGENT_NOT_FOUND');
  }
  return { agent, descriptors: resolveAgentToolDescriptors(agent) };
}

async function executeDelegateToAgent(runtime: ToolExecutionRuntime): Promise<ToolCallResult> {
  const { repos, params, handleToolByName } = runtime;
  const agentId = typeof params?.agentId === 'string' ? params.agentId : '';
  const input = typeof params?.input === 'string' ? params.input : '';
  const parentId = typeof params?.conversationId === 'string' ? params.conversationId : '';
  const directorId = typeof params?.directorId === 'string' ? params.directorId : '';
  if (!agentId || !input || !parentId || !directorId) {
    return { kind: 'delegate_to_agent', success: false, result: null, error: 'Missing agentId, input, conversationId, or directorId' };
  }

  const conversations = [...await repos.conversations.list()];
  const parent = conversations.find((conversation: any) => conversation.id === parentId);
  if (!parent) {
    return { kind: 'delegate_to_agent', success: false, result: null, error: 'Parent conversation not found' };
  }

  let director: Director;
  try {
    ({ director } = await getDirectorWithDescriptors(repos, directorId));
  } catch (error: any) {
    return { kind: 'delegate_to_agent', success: false, result: null, error: error?.message || 'Director not found' };
  }

  let agent: Agent;
  let agentToolDescriptors: ToolDescriptor[];
  try {
    const agentResult = await getAgentWithDescriptors(repos, agentId);
    agent = agentResult.agent;
    agentToolDescriptors = agentResult.descriptors;
  } catch (error: any) {
    return { kind: 'delegate_to_agent', success: false, result: null, error: error?.message || 'invalid_agent_tool_config' };
  }

  const prompts = Array.from(await repos.prompts.list());
  const settings = await repos.settings.load();
  const apiConfigs = Array.isArray(settings?.apiConfigs) ? settings.apiConfigs as ApiConfig[] : null;
  if (!apiConfigs) {
    return { kind: 'delegate_to_agent', success: false, result: null, error: 'settings_not_initialized' };
  }

  const nowIso = new Date().toISOString();
  let ensured;
  try {
    ensured = ensureAgentThread(
      conversations,
      parent.id,
      director,
      agent,
      parent.email,
      prompts,
      apiConfigs,
      nowIso,
      newId,
      parent.accountId
    );
  } catch (error: any) {
    return { kind: 'delegate_to_agent', success: false, result: null, error: error?.message || String(error) };
  }

  let agentThread: ConversationThread = ensured.agentThread;
  if (ensured.isNew) {
    await repos.conversations.insert(agentThread);
  } else {
    const persisted = await repos.conversations.getById(agentThread.id);
    if (persisted) {
      agentThread = persisted;
    }
  }

  const apiConfig = apiConfigs.find((config: ApiConfig) => config.id === agentThread.apiConfigId);
  if (!apiConfig) {
    return { kind: 'delegate_to_agent', success: false, result: null, error: 'API config not found for agent' };
  }
  if (typeof apiConfig.apiKey !== 'string' || !apiConfig.apiKey.trim()) {
    return { kind: 'delegate_to_agent', success: false, result: null, error: 'api_key_missing_for_agent' };
  }

  const scopedHandleTool = (toolName: string, toolParams: any) =>
    handleToolByName(
      toolName,
      toolParams,
      toolName.startsWith('workspace_') ? { workspace: { conversationId: agentThread.id } } : undefined,
    );

  const persistence: AgentConversationPersistence = {
    appendMessages: async (messages: PromptMessage[]): Promise<ConversationThread> => {
      const updated = await repos.conversations.appendMessages(agentThread.id, messages);
      agentThread = updated;
      return updated;
    },
    finalize: async (status: 'completed' | 'failed'): Promise<ConversationThread> => {
      const updated = await repos.conversations.finalizeStatus(agentThread.id, status, new Date().toISOString());
      if (!updated) {
        throw new Error(`Agent thread ${agentThread.id} missing after finalize`);
      }
      agentThread = updated;
      return updated;
    },
  };

  const agentResult = await runAgentConversation(
    agentThread,
    input,
    persistence,
    serializeApiConfig(apiConfig),
    agentToolDescriptors,
    scopedHandleTool,
    undefined,
    { apiKey: apiConfig.apiKey },
  );

  if (agentResult.success) {
    return { kind: 'delegate_to_agent', success: true, result: { content: agentResult.finalAssistantMessage?.content ?? null } };
  }
  return { kind: 'delegate_to_agent', success: false, result: null, error: agentResult.error || 'Agent conversation failed' };
}

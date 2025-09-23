import { Agent, Director, ToolDescriptor } from '../../shared/types';
import { OPTIONAL_TOOL_NAMES } from '../../shared/tools';
import { selectToolDescriptors } from '../utils/tools';
import { InvalidAgentConfigError, ValidationError } from './error-handler';

const OPTIONAL_TOOL_NAME_SET: ReadonlySet<string> = new Set(OPTIONAL_TOOL_NAMES);

type ToolRole = 'director' | 'agent';

type ToolConfigErrorFactory = (message: string) => Error;

const directorError: ToolConfigErrorFactory = (message) => new ValidationError(message, 'DIRECTOR_TOOL_CONFIG_INVALID');
const agentError: ToolConfigErrorFactory = (message) => new InvalidAgentConfigError(message, 'AGENT_TOOL_CONFIG_INVALID');

function ensureEnabledToolCalls(role: ToolRole, raw: unknown): readonly string[] {
  const errorFactory = role === 'director' ? directorError : agentError;
  if (!Array.isArray(raw)) {
    throw errorFactory('enabledToolCalls must be a non-empty array of optional tool names');
  }
  if (raw.length === 0) {
    throw errorFactory('enabledToolCalls must specify at least one optional tool');
  }
  const unique = new Set<string>();
  for (const entry of raw) {
    if (typeof entry !== 'string') {
      throw errorFactory('enabledToolCalls entries must be strings');
    }
    if (entry.length === 0) {
      throw errorFactory('enabledToolCalls cannot contain empty strings');
    }
    if (entry.trim() !== entry) {
      throw errorFactory('enabledToolCalls must not contain leading or trailing whitespace');
    }
    if (!OPTIONAL_TOOL_NAME_SET.has(entry)) {
      throw errorFactory(`Unsupported optional tool: ${entry}`);
    }
    if (unique.has(entry)) {
      throw errorFactory(`Duplicate optional tool entry: ${entry}`);
    }
    unique.add(entry);
  }
  return Array.from(unique);
}

export function resolveDirectorToolDescriptors(director: Director): ToolDescriptor[] {
  const allowlist = ensureEnabledToolCalls('director', director.enabledToolCalls);
  return selectToolDescriptors('director', allowlist);
}

export function resolveAgentToolDescriptors(agent: Agent): ToolDescriptor[] {
  const allowlist = ensureEnabledToolCalls('agent', agent.enabledToolCalls);
  return selectToolDescriptors('agent', allowlist);
}

export function validateDirectorToolConfig(director: Director): void {
  void ensureEnabledToolCalls('director', director.enabledToolCalls);
}

export function validateAgentToolConfig(agent: Agent): void {
  void ensureEnabledToolCalls('agent', agent.enabledToolCalls);
}

import { Agent, Director, ToolDescriptor } from '../../shared/types';
import { OPTIONAL_TOOL_NAMES } from '../../shared/tools';
import { selectToolDescriptors } from '../utils/tools';
import { InvalidAgentConfigError, ValidationError } from './error-handler';

const OPTIONAL_TOOL_NAME_SET: ReadonlySet<string> = new Set(OPTIONAL_TOOL_NAMES);

type ToolRole = 'director' | 'agent';

type ToolConfigErrorFactory = (message: string) => Error;

const directorError: ToolConfigErrorFactory = (message) => new ValidationError(message, 'DIRECTOR_TOOL_CONFIG_INVALID');
const agentError: ToolConfigErrorFactory = (message) => new InvalidAgentConfigError(message, 'AGENT_TOOL_CONFIG_INVALID');

function ensureEnabledOptionalTools(role: ToolRole, raw: unknown): readonly string[] {
  const errorFactory = role === 'director' ? directorError : agentError;
  if (!Array.isArray(raw)) {
    throw errorFactory('enabledOptionalTools must be an array of optional tool names');
  }
  const unique = new Set<string>();
  for (const entry of raw) {
    if (typeof entry !== 'string') {
      throw errorFactory('enabledOptionalTools entries must be strings');
    }
    if (entry.length === 0) {
      throw errorFactory('enabledOptionalTools cannot contain empty strings');
    }
    if (entry.trim() !== entry) {
      throw errorFactory('enabledOptionalTools must not contain leading or trailing whitespace');
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
  const allowlist = ensureEnabledOptionalTools('director', director.enabledOptionalTools);
  return selectToolDescriptors('director', allowlist);
}

export function resolveAgentToolDescriptors(agent: Agent): ToolDescriptor[] {
  const allowlist = ensureEnabledOptionalTools('agent', agent.enabledOptionalTools);
  return selectToolDescriptors('agent', allowlist);
}

export function resolveMandatoryToolDescriptors(role: 'director' | 'agent'): ToolDescriptor[] {
  return selectToolDescriptors(role);
}

export function validateDirectorToolConfig(director: Director): void {
  void ensureEnabledOptionalTools('director', director.enabledOptionalTools);
}

export function validateAgentToolConfig(agent: Agent): void {
  void ensureEnabledOptionalTools('agent', agent.enabledOptionalTools);
}

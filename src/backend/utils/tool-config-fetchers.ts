import type { RepoBundle } from '../repository/registry';
import type { Director, Agent, ToolDescriptor, ConversationRole } from '../../shared/types';
import { resolveDirectorToolDescriptors, resolveAgentToolDescriptors } from '../services/tool-config-service';
import { InvalidAgentConfigError, ValidationError } from '../services/error-handler';
import { selectToolDescriptors } from './tools';

export async function loadDirectorWithDescriptors(
  repos: RepoBundle,
  directorId: string
): Promise<{ director: Director; descriptors: ToolDescriptor[] }> {
  const directors = await repos.directors.getAll();
  const director = (directors as Director[]).find((d) => d.id === directorId);
  if (!director) {
    throw new ValidationError('Director not found', 'DIRECTOR_NOT_FOUND');
  }
  const descriptors = resolveDirectorToolDescriptors(director);
  return { director, descriptors };
}

export async function loadAgentWithDescriptors(
  repos: RepoBundle,
  agentId: string
): Promise<{ agent: Agent; descriptors: ToolDescriptor[] }> {
  const agents = await repos.agents.getAll();
  const agent = (agents as Agent[]).find((a) => a.id === agentId);
  if (!agent) {
    throw new InvalidAgentConfigError('Agent not found', 'AGENT_NOT_FOUND');
  }
  const descriptors = resolveAgentToolDescriptors(agent);
  return { agent, descriptors };
}

export function loadMandatoryDescriptors(role: ConversationRole): ToolDescriptor[] {
  return selectToolDescriptors(role);
}

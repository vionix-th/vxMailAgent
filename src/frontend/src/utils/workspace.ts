import type { WorkspaceProvenance, Director, Agent } from '../types/shared';

export interface WorkspaceLookupContext {
  directorMap?: Map<string, Director>;
  agentMap?: Map<string, Agent>;
  directors?: Director[];
  agents?: Agent[];
}

export interface WorkspaceCreatorInfo {
  label: string;
  role: string;
  name?: string;
  id?: string;
  toolName?: string;
}

const toMap = <T extends { id: string }>(map: Map<string, T> | undefined, list: T[] | undefined): Map<string, T> => {
  if (map) return map;
  return new Map((list || []).map((item) => [item.id, item]));
};

export function resolveWorkspaceCreator(
  provenance?: WorkspaceProvenance | null,
  ctx?: WorkspaceLookupContext
): WorkspaceCreatorInfo {
  if (!provenance) {
    return { label: '', role: '', name: undefined, id: undefined, toolName: undefined };
  }

  const directorMap = toMap(ctx?.directorMap, ctx?.directors);
  const agentMap = toMap(ctx?.agentMap, ctx?.agents);

  let name: string | undefined;
  if (provenance.createdBy === 'director') {
    name = directorMap.get(provenance.creatorId)?.name;
  } else if (provenance.createdBy === 'agent') {
    name = agentMap.get(provenance.creatorId)?.name;
  } else if (provenance.createdBy === 'tool') {
    name = provenance.creatorId || undefined;
  }

  const info: WorkspaceCreatorInfo = {
    label: '',
    role: provenance.createdBy,
    name,
    id: provenance.creatorId,
    toolName: provenance.toolName,
  };

  const parts: string[] = [];
  if (provenance.createdBy) {
    parts.push(provenance.createdBy);
  }
  if (name) {
    parts.push(name);
  }
  if (provenance.creatorId && provenance.creatorId !== name) {
    parts.push(`(${provenance.creatorId})`);
  }
  if (provenance.toolName) {
    parts.push(`• ${provenance.toolName}`);
  }
  info.label = parts.join(' ').trim();

  return info;
}

export function formatWorkspaceCreator(
  provenance?: WorkspaceProvenance | null,
  ctx?: WorkspaceLookupContext
): string {
  return resolveWorkspaceCreator(provenance, ctx).label;
}

import { TOOL_REGISTRY, OPTIONAL_TOOL_NAMES, TOOL_DESCRIPTORS } from '../../shared/tools';
import { ConversationRole, ToolDescriptor } from '../../shared/types';

export type OptionalTool = typeof OPTIONAL_TOOL_NAMES[number];

/** Build optional tool specs from the registry using an allowlist. */
export function buildOptionalToolSpecs(allowed: Set<string>): any[] {
  return TOOL_REGISTRY
    .filter(t => t.category === 'optional' && allowed.has(t.name))
    .map(t => ({ type: 'function', function: { name: t.name, description: t.description, parameters: t.parameters } }));
}

/** Build core tool specs, optionally limited to a set of names. */
export function buildCoreToolSpecs(include?: Set<string>): any[] {
  const want = include && include.size ? include : new Set(TOOL_REGISTRY.filter(t => t.category === 'mandatory').map(t => t.name));
  return TOOL_REGISTRY
    .filter(t => t.category === 'mandatory' && want.has(t.name))
    .map(t => ({ type: 'function', function: { name: t.name, description: t.description, parameters: t.parameters } }));
}

function toOpenAiToolSpec(desc: ToolDescriptor): any {
  return { type: 'function', function: { name: desc.name, description: desc.description, parameters: desc.inputSchema } };
}

/**
 * Select tool specs for the given role based on descriptor flags.
 * Role capabilities are currently unused but reserved for future expansion.
 */
export function filterToolDescriptorsByRole(role: ConversationRole): ToolDescriptor[] {
  // Registry-driven gating only: directorOnly tools require director role.
  return TOOL_DESCRIPTORS.filter((d) => !(d.flags.directorOnly && role !== 'director'));
}

export function buildToolSpecsByFlags(role: ConversationRole): any[] {
  return filterToolDescriptorsByRole(role).map(toOpenAiToolSpec);
}

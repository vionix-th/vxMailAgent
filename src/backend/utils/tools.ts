import { TOOL_REGISTRY, OPTIONAL_TOOL_NAMES, TOOL_DESCRIPTORS } from '../../shared/tools';
import { ConversationRole, RoleCapabilities, ToolDescriptor } from '../../shared/types';

export type OptionalTool = typeof OPTIONAL_TOOL_NAMES[number];

// Build optional tool specs based on an allowlist set
export function buildOptionalToolSpecs(allowed: Set<string>): any[] {
  return TOOL_REGISTRY
    .filter(t => t.category === 'optional' && allowed.has(t.name))
    .map(t => ({ type: 'function', function: { name: t.name, description: t.description, parameters: t.parameters } }));
}

// Build core, read-only tool specs. Accept a set of names to include; if empty, include all core tools.
export function buildCoreToolSpecs(include?: Set<string>): any[] {
  const want = include && include.size ? include : new Set(TOOL_REGISTRY.filter(t => t.category === 'mandatory').map(t => t.name));
  return TOOL_REGISTRY
    .filter(t => t.category === 'mandatory' && want.has(t.name))
    .map(t => ({ type: 'function', function: { name: t.name, description: t.description, parameters: t.parameters } }));
}

// Removed legacy buildAgentToolSpecs; engine + flags-based descriptors are canonical.

// --- New flags-based helpers (preferred path) ---

function toOpenAiToolSpec(desc: ToolDescriptor): any {
  return { type: 'function', function: { name: desc.name, description: desc.description, parameters: desc.inputSchema } };
}

export function buildToolSpecsByFlags(role: ConversationRole, roleCaps: RoleCapabilities): any[] {
  // reference roleCaps to avoid lint for now; engine will use this to add dynamic tools (e.g., CallAgent)
  const canSpawn = roleCaps?.canSpawnAgents === true;
  void canSpawn;
  const enabled = TOOL_DESCRIPTORS.filter((d) => {
    const f = d.flags || {};
    // mandatory always included for applicable roles; directorOnly hides from agents
    if (f.mandatory) return role === 'director' || !f.directorOnly;
    // defaultEnabled gated by role visibility
    if (f.defaultEnabled) return role === 'director' || !f.directorOnly;
    return false;
  });
  // Engine will also decide whether to add orchestration-only dynamic tools (e.g., CallAgent) based on roleCaps.canSpawnAgents
  return enabled.map(toOpenAiToolSpec);
}

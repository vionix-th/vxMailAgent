// Simple frontend API client for diagnostics endpoints
// Provides typed helpers and consistent error handling

export type SortDir = 'asc' | 'desc';

export interface OrchestrationListParams {
  director?: string;
  agent?: string;
  emailId?: string;
  phase?: string;
  since?: string; // ISO
  until?: string; // ISO
  limit?: number;
  offset?: number;
}

export interface OrchestrationListResponse<T = any> {
  total: number;
  items: T[];
}

export async function getOrchestrationDiagnostics(params: OrchestrationListParams = {}): Promise<OrchestrationListResponse> {
  const qs = new URLSearchParams();
  Object.entries(params).forEach(([k, v]) => {
    if (v === undefined || v === null || v === '') return;
    qs.set(k, String(v));
  });
  const res = await fetch(`/api/orchestration/diagnostics${qs.toString() ? `?${qs}` : ''}`);
  if (!res.ok) throw new Error(`Failed orchestration diagnostics: ${res.status}`);
  return res.json();
}

export async function deleteOrchestrationDiagnosticOne(id: string): Promise<void> {
  const res = await fetch(`/api/orchestration/diagnostics/${encodeURIComponent(id)}`, { method: 'DELETE' });
  if (!res.ok) throw new Error(`Failed to delete orchestration diagnostic: ${res.status}`);
}

export async function deleteOrchestrationDiagnosticsBulk(ids: string[]): Promise<void> {
  const res = await fetch('/api/orchestration/diagnostics', {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ids }),
  });
  if (!res.ok) throw new Error(`Failed bulk delete orchestration diagnostics: ${res.status}`);
}

// Traces diagnostics
export interface TracesListParams {
  limit?: number;
  offset?: number;
}

export interface TraceSummaryItem {
  id: string;
  createdAt?: string;
  emailId?: string;
  directorId?: string;
  agentId?: string;
  status?: string;
  spanCount?: number;
  providerCounts?: Record<string, number>;
}

export interface TracesListResponse {
  total: number;
  items: TraceSummaryItem[];
}

export async function getDiagnosticsTraces(params: TracesListParams = {}): Promise<TracesListResponse> {
  const qs = new URLSearchParams();
  if (typeof params.limit === 'number') qs.set('limit', String(params.limit));
  if (typeof params.offset === 'number') qs.set('offset', String(params.offset));
  const url = `/api/diagnostics/traces${qs.toString() ? `?${qs}` : ''}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed traces diagnostics: ${res.status}`);
  return res.json();
}

export async function getDiagnosticsTrace(id: string): Promise<any> {
  const res = await fetch(`/api/diagnostics/trace/${encodeURIComponent(id)}`);
  if (!res.ok) throw new Error(`Failed trace detail: ${res.status}`);
  return res.json();
}

export async function getDiagnosticsRuntime(): Promise<any> {
  const res = await fetch('/api/diagnostics/runtime');
  if (!res.ok) throw new Error(`Failed runtime diagnostics: ${res.status}`);
  return res.json();
}

// Cleanup API
export interface CleanupStats {
  fetcherLogs: number;
  orchestrationLogs: number;
  conversations: number;
  providerEvents: number;
  traces: number;
  total: number;
}

export async function getCleanupStats(): Promise<CleanupStats> {
  const res = await fetch('/api/cleanup/stats');
  if (!res.ok) throw new Error(`Failed to get cleanup stats: ${res.status}`);
  return res.json();
}

export async function cleanupAll(): Promise<{ success: boolean; deleted: CleanupStats; message: string }> {
  const res = await fetch('/api/cleanup/all', { method: 'DELETE' });
  if (!res.ok) throw new Error(`Failed to cleanup all: ${res.status}`);
  return res.json();
}

export async function cleanupFetcherLogs(): Promise<{ success: boolean; deleted: number; message: string }> {
  const res = await fetch('/api/cleanup/fetcher-logs', { method: 'DELETE' });
  if (!res.ok) throw new Error(`Failed to cleanup fetcher logs: ${res.status}`);
  return res.json();
}

export async function cleanupOrchestrationLogs(): Promise<{ success: boolean; deleted: number; message: string }> {
  const res = await fetch('/api/cleanup/orchestration-logs', { method: 'DELETE' });
  if (!res.ok) throw new Error(`Failed to cleanup orchestration logs: ${res.status}`);
  return res.json();
}

export async function cleanupConversations(): Promise<{ success: boolean; deleted: number; message: string }> {
  const res = await fetch('/api/cleanup/conversations', { method: 'DELETE' });
  if (!res.ok) throw new Error(`Failed to cleanup conversations: ${res.status}`);
  return res.json();
}

export async function cleanupProviderEvents(): Promise<{ success: boolean; deleted: number; message: string }> {
  const res = await fetch('/api/cleanup/provider-events', { method: 'DELETE' });
  if (!res.ok) throw new Error(`Failed to cleanup provider events: ${res.status}`);
  return res.json();
}

export async function cleanupTraces(): Promise<{ success: boolean; deleted: number; message: string }> {
  const res = await fetch('/api/cleanup/traces', { method: 'DELETE' });
  if (!res.ok) throw new Error(`Failed to cleanup traces: ${res.status}`);
  return res.json();
}

// Unified diagnostics
export interface DiagnosticNode {
  id: string;
  type: 'fetchCycle' | 'account' | 'email' | 'director' | 'agent' | 'conversation' | 'providerEvent';
  name: string;
  timestamp?: string;
  status?: 'success' | 'error' | 'pending';
  metadata?: any;
  children?: DiagnosticNode[];
  orchestrationEntry?: any;
  conversation?: any;
  providerEvent?: any;
  trace?: any;
}

export interface UnifiedDiagnosticsResponse {
  tree: DiagnosticNode[];
  summary: {
    totalFetchCycles: number;
    totalEmails: number;
    totalDirectors: number;
    totalAgents: number;
    totalConversations: number;
    totalProviderEvents: number;
    totalErrors: number;
  };
}

export async function getUnifiedDiagnostics(): Promise<UnifiedDiagnosticsResponse> {
  const res = await fetch('/api/diagnostics/unified');
  if (!res.ok) throw new Error(`Failed unified diagnostics: ${res.status}`);
  return res.json();
}

export async function getUnifiedDiagnosticsNode(nodeId: string): Promise<any> {
  const res = await fetch(`/api/diagnostics/unified/${encodeURIComponent(nodeId)}`);
  if (!res.ok) throw new Error(`Failed to get diagnostic node: ${res.status}`);
  return res.json();
}

// Delete diagnostics traces
export async function deleteDiagnosticsTrace(id: string): Promise<{ deleted: number }> {
  const res = await fetch(`/api/diagnostics/trace/${encodeURIComponent(id)}`, { method: 'DELETE' });
  if (!res.ok) throw new Error(`Failed to delete trace: ${res.status}`);
  return res.json();
}

export async function deleteDiagnosticsTracesBulk(ids?: string[]): Promise<{ deleted: number }> {
  const init: RequestInit = { method: 'DELETE' };
  if (ids && ids.length) {
    init.headers = { 'Content-Type': 'application/json' };
    init.body = JSON.stringify({ ids });
  }
  const res = await fetch('/api/diagnostics/traces', init);
  if (!res.ok) throw new Error(`Failed to bulk delete traces: ${res.status}`);
  return res.json();
}

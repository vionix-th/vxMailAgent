/**
 * Frontend API client for diagnostics and cleanup endpoints.
 * Provides typed helpers and consistent error handling.
 */

import { apiFetch } from './http';

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

/** Fetch orchestration diagnostics. */
export async function getOrchestrationDiagnostics(params: OrchestrationListParams = {}): Promise<OrchestrationListResponse> {
  const qs = new URLSearchParams();
  Object.entries(params).forEach(([k, v]) => {
    if (v === undefined || v === null || v === '') return;
    qs.set(k, String(v));
  });
  return apiFetch(`/api/orchestration/diagnostics${qs.toString() ? `?${qs}` : ''}`);
}

/** Delete a single orchestration diagnostic entry. */
export async function deleteOrchestrationDiagnosticOne(id: string): Promise<void> {
  await apiFetch(`/api/orchestration/diagnostics/${encodeURIComponent(id)}`, { method: 'DELETE' });
}

/** Delete multiple orchestration diagnostics. */
export async function deleteOrchestrationDiagnosticsBulk(ids: string[]): Promise<void> {
  await apiFetch('/api/orchestration/diagnostics', {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ids }),
  });
}

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

/** Fetch trace summaries. */
export async function getDiagnosticsTraces(params: TracesListParams = {}): Promise<TracesListResponse> {
  const qs = new URLSearchParams();
  if (typeof params.limit === 'number') qs.set('limit', String(params.limit));
  if (typeof params.offset === 'number') qs.set('offset', String(params.offset));
  const url = `/api/diagnostics/traces${qs.toString() ? `?${qs}` : ''}`;
  return apiFetch(url);
}

/** Fetch details for a single trace. */
export async function getDiagnosticsTrace(id: string): Promise<any> {
  return apiFetch(`/api/diagnostics/trace/${encodeURIComponent(id)}`);
}

/** Retrieve runtime diagnostics information. */
export async function getDiagnosticsRuntime(): Promise<any> {
  return apiFetch('/api/diagnostics/runtime');
}

export interface CleanupStats {
  fetcherLogs: number;
  orchestrationLogs: number;
  conversations: number;
  workspaceItems: number;
  providerEvents: number;
  traces: number;
  total: number;
}

/** Retrieve cleanup statistics. */
export async function getCleanupStats(): Promise<CleanupStats> {
  return apiFetch('/api/cleanup/stats');
}

/** Remove all diagnostics and related data. */
export async function cleanupAll(): Promise<{ success: boolean; deleted: CleanupStats; message: string }> {
  return apiFetch('/api/cleanup/all', { method: 'DELETE' });
}

/** Delete fetcher log entries. */
export async function cleanupFetcherLogs(): Promise<{ success: boolean; deleted: number; message: string }> {
  return apiFetch('/api/cleanup/fetcher-logs', { method: 'DELETE' });
}

/** Delete orchestration log entries. */
export async function cleanupOrchestrationLogs(): Promise<{ success: boolean; deleted: number; message: string }> {
  return apiFetch('/api/cleanup/orchestration-logs', { method: 'DELETE' });
}

/** Delete stored conversations. */
export async function cleanupConversations(): Promise<{ success: boolean; deleted: number; message: string }> {
  return apiFetch('/api/cleanup/conversations', { method: 'DELETE' });
}

/** Delete workspace items. */
export async function cleanupWorkspaceItems(): Promise<{ success: boolean; deleted: number; message: string }> {
  return apiFetch('/api/cleanup/workspace-items', { method: 'DELETE' });
}

/** Delete a single workspace item (soft by default; pass hard=true to permanently remove). */
export async function deleteWorkspaceItem(itemId: string, opts?: { hard?: boolean }): Promise<any> {
  const hard = opts?.hard ? '?hard=true' : '';
  return apiFetch(`/api/workspaces/default/items/${encodeURIComponent(itemId)}${hard}`, { method: 'DELETE' });
}

/** Delete provider event logs. */
export async function cleanupProviderEvents(): Promise<{ success: boolean; deleted: number; message: string }> {
  return apiFetch('/api/cleanup/provider-events', { method: 'DELETE' });
}

/** Delete trace records. */
export async function cleanupTraces(): Promise<{ success: boolean; deleted: number; message: string }> {
  return apiFetch('/api/cleanup/traces', { method: 'DELETE' });
}

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

/** Fetch aggregated diagnostics tree. */
export async function getUnifiedDiagnostics(): Promise<UnifiedDiagnosticsResponse> {
  return apiFetch('/api/diagnostics/unified');
}

/** Fetch a node from the diagnostics tree. */
export async function getUnifiedDiagnosticsNode(nodeId: string): Promise<any> {
  return apiFetch(`/api/diagnostics/unified/${encodeURIComponent(nodeId)}`);
}

/** Delete a single diagnostics trace. */
export async function deleteDiagnosticsTrace(id: string): Promise<{ deleted: number }> {
  return apiFetch(`/api/diagnostics/trace/${encodeURIComponent(id)}`, { method: 'DELETE' });
}

/** Delete multiple diagnostics traces. */
export async function deleteDiagnosticsTracesBulk(ids?: string[]): Promise<{ deleted: number }> {
  const init: RequestInit = { method: 'DELETE' };
  if (ids && ids.length) {
    init.headers = { 'Content-Type': 'application/json' };
    init.body = JSON.stringify({ ids });
  }
  return apiFetch('/api/diagnostics/traces', init);
}

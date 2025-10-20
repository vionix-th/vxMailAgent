/**
 * Frontend API client for cleanup and workspace operations.
 * Legacy diagnostics helpers removed (forward-only).
 */

import { apiFetch } from './http';

export interface ApiConfigView {
  id: string;
  name: string;
  model: string;
  maxCompletionTokens?: number;
}

export interface CreateApiConfigRequest {
  name: string;
  model: string;
  apiKey: string;
  provider?: string;
  maxCompletionTokens?: number;
}

export interface UpdateApiConfigRequest {
  name?: string;
  model?: string;
  apiKey?: string;
  provider?: string;
  maxCompletionTokens?: number | null;
}

export interface CleanupStats {
  fetcherLogs: number;
  orchestrationLogs: number;
  conversations: number;
  workspaceItems: number;
  providerEvents: number;
  traces: number;
  emails: number;
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

/** Delete stored emails. */
export async function cleanupEmails(): Promise<{ success: boolean; deleted: number; message: string }> {
  return apiFetch('/api/cleanup/emails', { method: 'DELETE' });
}

/** Delete a single email envelope. */
export async function deleteEmail(id: string): Promise<{ success: boolean; deleted?: { id: string }; message?: string }> {
  return apiFetch(`/api/emails/${encodeURIComponent(id)}`, { method: 'DELETE' });
}

/** Delete a single workspace item (soft by default; pass hard=true to permanently remove). */
export async function deleteWorkspaceItem(conversationId: string, itemId: string, opts?: { hard?: boolean }): Promise<any> {
  const search = opts?.hard ? '?hard=true' : '';
  return apiFetch(`/api/workspaces/${encodeURIComponent(conversationId)}/items/${encodeURIComponent(itemId)}${search}`, { method: 'DELETE' });
}

export async function createApiConfig(input: CreateApiConfigRequest): Promise<ApiConfigView> {
  const response = await apiFetch<{ success: boolean; apiConfig: ApiConfigView }>(
    '/api/settings/api-configs',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    }
  );
  return response.apiConfig;
}

export async function updateApiConfig(id: string, input: UpdateApiConfigRequest): Promise<ApiConfigView> {
  const response = await apiFetch<{ success: boolean; apiConfig: ApiConfigView }>(
    `/api/settings/api-configs/${encodeURIComponent(id)}`,
    {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    }
  );
  return response.apiConfig;
}

export async function deleteApiConfig(id: string): Promise<void> {
  await apiFetch(`/api/settings/api-configs/${encodeURIComponent(id)}`, { method: 'DELETE' });
}

/** Delete provider event logs. */
export async function cleanupProviderEvents(): Promise<{ success: boolean; deleted: number; message: string }> {
  return apiFetch('/api/cleanup/provider-events', { method: 'DELETE' });
}

/** Delete trace records. */
export async function cleanupTraces(): Promise<{ success: boolean; deleted: number; message: string }> {
  return apiFetch('/api/cleanup/traces', { method: 'DELETE' });
}

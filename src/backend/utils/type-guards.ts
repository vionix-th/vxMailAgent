/**
 * Type guards and utility functions for runtime type checking.
 * Replaces unsafe 'any' type usage with proper validation.
 */

import { 
  Agent, 
  Director, 
  Filter, 
  Prompt, 
  Imprint, 
  ConversationThread, 
  Account,
  User,
  FetcherLogEntry,
  OrchestrationDiagnosticEntry,
  ProviderEvent,
  Trace,
  WorkspaceItem
} from '../../shared/types';

/**
 * Generic type guard for objects with required properties.
 */
export function hasRequiredProperties(
  obj: unknown,
  requiredProps: string[]
): boolean {
  if (!obj || typeof obj !== 'object') return false;
  
  const typedObj = obj as Record<string, unknown>;
  return requiredProps.every(prop => 
    prop in typedObj && typedObj[prop] !== undefined
  );
}

/**
 * Type guard for string validation.
 */
export function isString(value: unknown): value is string {
  return typeof value === 'string';
}

/**
 * Type guard for non-empty string validation.
 */
export function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

/**
 * Type guard for array validation.
 */
export function isArray<T>(value: unknown, itemGuard?: (item: unknown) => item is T): value is T[] {
  if (!Array.isArray(value)) return false;
  if (!itemGuard) return true;
  return value.every(itemGuard);
}

/**
 * Type guard for Agent objects.
 */
export function isAgent(obj: unknown): obj is Agent {
  return hasRequiredProperties(obj, ['id', 'name', 'apiConfigId']) &&
    isNonEmptyString((obj as any).id) &&
    isNonEmptyString((obj as any).name) &&
    isNonEmptyString((obj as any).apiConfigId);
}

/**
 * Type guard for Director objects.
 */
export function isDirector(obj: unknown): obj is Director {
  return hasRequiredProperties(obj, ['id', 'name']) &&
    isNonEmptyString((obj as any).id) &&
    isNonEmptyString((obj as any).name);
}

/**
 * Type guard for Filter objects.
 */
export function isFilter(obj: unknown): obj is Filter {
  return hasRequiredProperties(obj, ['id', 'field', 'regex']) &&
    isNonEmptyString((obj as any).id) &&
    isNonEmptyString((obj as any).field) &&
    isNonEmptyString((obj as any).regex);
}

/**
 * Type guard for Prompt objects.
 */
export function isPrompt(obj: unknown): obj is Prompt {
  return hasRequiredProperties(obj, ['id', 'name', 'text']) &&
    isNonEmptyString((obj as any).id) &&
    isNonEmptyString((obj as any).name) &&
    isNonEmptyString((obj as any).text);
}

/**
 * Type guard for Imprint objects.
 */
export function isImprint(obj: unknown): obj is Imprint {
  return hasRequiredProperties(obj, ['id', 'name']) &&
    isNonEmptyString((obj as any).id) &&
    isNonEmptyString((obj as any).name);
}

/**
 * Type guard for Account objects.
 */
export function isAccount(obj: unknown): obj is Account {
  return hasRequiredProperties(obj, ['id', 'provider', 'email']) &&
    isNonEmptyString((obj as any).id) &&
    isNonEmptyString((obj as any).provider) &&
    isNonEmptyString((obj as any).email);
}

/**
 * Type guard for User objects.
 */
export function isUser(obj: unknown): obj is User {
  return hasRequiredProperties(obj, ['id', 'email']) &&
    isNonEmptyString((obj as any).id) &&
    isNonEmptyString((obj as any).email);
}

/**
 * Type guard for ConversationThread objects.
 */
export function isConversationThread(obj: unknown): obj is ConversationThread {
  return hasRequiredProperties(obj, ['id', 'messages']) &&
    isNonEmptyString((obj as any).id) &&
    isArray((obj as any).messages);
}

/**
 * Type guard for FetcherLogEntry objects.
 */
export function isFetcherLogEntry(obj: unknown): obj is FetcherLogEntry {
  return hasRequiredProperties(obj, ['timestamp', 'level', 'event']) &&
    isNonEmptyString((obj as any).timestamp) &&
    isNonEmptyString((obj as any).level) &&
    isNonEmptyString((obj as any).event);
}

/**
 * Type guard for OrchestrationDiagnosticEntry objects.
 */
export function isOrchestrationDiagnosticEntry(obj: unknown): obj is OrchestrationDiagnosticEntry {
  return hasRequiredProperties(obj, ['timestamp']) &&
    isNonEmptyString((obj as any).timestamp);
}

/**
 * Type guard for ProviderEvent objects.
 */
export function isProviderEvent(obj: unknown): obj is ProviderEvent {
  return hasRequiredProperties(obj, ['timestamp', 'provider']) &&
    isNonEmptyString((obj as any).timestamp) &&
    isNonEmptyString((obj as any).provider);
}

/**
 * Type guard for Trace objects.
 */
export function isTrace(obj: unknown): obj is Trace {
  return hasRequiredProperties(obj, ['id', 'createdAt', 'spans']) &&
    isNonEmptyString((obj as any).id) &&
    isNonEmptyString((obj as any).createdAt) &&
    isArray((obj as any).spans);
}

/**
 * Type guard for WorkspaceItem objects.
 */
export function isWorkspaceItem(obj: unknown): obj is WorkspaceItem {
  return hasRequiredProperties(obj, ['id']) &&
    isNonEmptyString((obj as any).id);
}

/**
 * Safe type assertion with runtime validation.
 */
export function assertType<T>(
  value: unknown,
  guard: (value: unknown) => value is T,
  errorMessage: string
): T {
  if (!guard(value)) {
    throw new Error(`Type assertion failed: ${errorMessage}`);
  }
  return value;
}

/**
 * Safe array type assertion with item validation.
 */
export function assertArrayType<T>(
  value: unknown,
  itemGuard: (item: unknown) => item is T,
  errorMessage: string
): T[] {
  if (!isArray(value, itemGuard)) {
    throw new Error(`Array type assertion failed: ${errorMessage}`);
  }
  return value;
}

/**
 * Utility to safely parse JSON with type validation.
 */
export function parseJsonWithValidation<T>(
  jsonString: string,
  guard: (value: unknown) => value is T,
  errorMessage: string
): T {
  try {
    const parsed = JSON.parse(jsonString);
    return assertType(parsed, guard, errorMessage);
  } catch (error) {
    throw new Error(`JSON parsing failed: ${errorMessage}. ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}

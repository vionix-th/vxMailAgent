import type { MemoryScope } from '../../shared/types';
import { ValidationError } from '../services/error-handler';

const SCOPE_VALUES: ReadonlySet<MemoryScope> = new Set(['local', 'shared', 'global']);

export function requireMemoryScope(value: unknown, field: string): MemoryScope {
  if (typeof value !== 'string') {
    throw new ValidationError(`${field} is required`, 'MEMORY_SCOPE_REQUIRED');
  }
  const scope = value.trim() as MemoryScope;
  if (!scope) {
    throw new ValidationError(`${field} is required`, 'MEMORY_SCOPE_REQUIRED');
  }
  if (!SCOPE_VALUES.has(scope)) {
    throw new ValidationError(`${field} must be one of local, shared, global`, 'MEMORY_SCOPE_INVALID');
  }
  return scope;
}

export function optionalMemoryScope(value: unknown, field: string): MemoryScope | undefined {
  if (typeof value === 'undefined' || value === null) {
    return undefined;
  }
  return requireMemoryScope(value, field);
}

export function requireMemoryOwner(value: unknown, field: string): string {
  if (typeof value !== 'string') {
    throw new ValidationError(`${field} is required`, 'MEMORY_OWNER_REQUIRED');
  }
  const owner = value.trim();
  if (!owner) {
    throw new ValidationError(`${field} cannot be empty`, 'MEMORY_OWNER_REQUIRED');
  }
  return owner;
}

export function requireContent(value: unknown, field: string): string {
  if (typeof value !== 'string') {
    throw new ValidationError(`${field} is required`, 'MEMORY_CONTENT_REQUIRED');
  }
  const content = value.trim();
  if (!content) {
    throw new ValidationError(`${field} cannot be empty`, 'MEMORY_CONTENT_REQUIRED');
  }
  return content;
}

export function normalizeMemoryTags(value: unknown): string[] | undefined {
  if (typeof value === 'undefined' || value === null) {
    return undefined;
  }
  if (!Array.isArray(value)) {
    throw new ValidationError('tags must be an array of strings', 'MEMORY_TAGS_INVALID');
  }
  const tags: string[] = [];
  for (const raw of value) {
    if (typeof raw !== 'string') {
      throw new ValidationError('tags must be an array of strings', 'MEMORY_TAGS_INVALID');
    }
    const tag = raw.trim();
    if (!tag) {
      continue;
    }
    if (!tags.includes(tag)) {
      tags.push(tag);
    }
  }
  return tags.length ? tags : undefined;
}

export function normalizeOptionalString(value: unknown, field: string): string | undefined {
  if (typeof value === 'undefined' || value === null) {
    return undefined;
  }
  if (typeof value !== 'string') {
    throw new ValidationError(`${field} must be a string`, 'MEMORY_FIELD_TYPE_ERROR');
  }
  const trimmed = value.trim();
  return trimmed.length ? trimmed : undefined;
}

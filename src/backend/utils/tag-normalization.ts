import { ValidationError } from '../services/error-handler';

export interface NormalizeTagOptions {
  optional?: boolean;
  skipEmpty?: boolean;
  allowEmptyResult?: boolean;
  fieldLabel?: string;
}

const DEFAULT_FIELD = 'tags';
export function normalizeStringTags(value: unknown, field: string, options?: NormalizeTagOptions & { optional?: false }): string[];
export function normalizeStringTags(value: unknown, field: string, options: NormalizeTagOptions & { optional: true }): string[] | undefined;
export function normalizeStringTags(value: unknown, field: string = DEFAULT_FIELD, options: NormalizeTagOptions = {}): string[] | undefined {
  const { optional = false, skipEmpty = false, allowEmptyResult = true, fieldLabel } = options;
  const label = fieldLabel ?? field;

  if (typeof value === 'undefined' || value === null) {
    if (optional) {
      return undefined;
    }
    throw new ValidationError(`${label} is required`, 'TAGS_REQUIRED');
  }

  if (!Array.isArray(value)) {
    throw new ValidationError(`${label} must be an array of strings`, 'TAGS_NOT_ARRAY');
  }

  const normalized: string[] = [];
  for (const raw of value) {
    if (typeof raw !== 'string') {
      throw new ValidationError(`${label} must contain only strings`, 'TAGS_INVALID_ELEMENT');
    }
    const trimmed = raw.trim();
    if (!trimmed) {
      if (skipEmpty) {
        continue;
      }
      throw new ValidationError(`${label} cannot include empty tags`, 'TAGS_EMPTY_VALUE');
    }
    if (!normalized.includes(trimmed)) {
      normalized.push(trimmed);
    }
  }

  if (!normalized.length && !allowEmptyResult) {
    throw new ValidationError(`${label} cannot be empty`, 'TAGS_EMPTY_RESULT');
  }

  return normalized;
}

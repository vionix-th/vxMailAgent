import { useCallback, useEffect, useMemo, useState } from 'react';
import { randomId as genId } from '../utils/randomId';
import { apiFetch } from '../utils/http';

export interface CrudOptions<T extends { id?: string }> {
  autoFetch?: boolean;
  idField?: keyof T; // defaults to 'id'
}

export interface ActionOptions {
  successMessage?: string;
  errorMessage?: string;
  createIdIfMissing?: boolean; // default true for create/upsert
}

export interface CrudApi<T> {
  items: T[];
  loading: boolean;
  error: string | null;
  success: string | null;
  refresh: () => Promise<void>;
  create: (item: T, opts?: ActionOptions) => Promise<T | null>;
  update: (id: string, item: Partial<T> | T, opts?: ActionOptions) => Promise<T | null>;
  upsert: (item: T, opts?: ActionOptions) => Promise<T | null>;
  remove: (id: string, opts?: ActionOptions) => Promise<boolean>;
  setError: (msg: string | null) => void;
  setSuccess: (msg: string | null) => void;
}

export function useCrudResource<T extends { id?: string }>(endpoint: string, options: CrudOptions<T> = {}): CrudApi<T> {
  const { autoFetch = true, idField } = options;
  const idKey = (idField || 'id') as keyof T;

  const [items, setItems] = useState<T[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await apiFetch<T[]>(endpoint);
      setItems(Array.isArray(data) ? data : []);
    } catch (e: any) {
      setError(e?.message || 'Failed to load');
    } finally {
      setLoading(false);
    }
  }, [endpoint]);

  useEffect(() => {
    if (autoFetch) {
      void refresh();
    }
  }, [autoFetch, refresh]);

  const create = useCallback(async (item: T, opts: ActionOptions = {}) => {
    setError(null);
    const { successMessage, errorMessage, createIdIfMissing = true } = opts;
    const payload: any = { ...item };
    if (createIdIfMissing && !payload[idKey]) payload[idKey] = genId();
    try {
      const created = await apiFetch<T>(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      await refresh();
      setSuccess(successMessage || 'Created');
      return created ?? payload;
    } catch (e: any) {
      setError(errorMessage || e?.message || 'Failed to create');
      return null;
    }
  }, [endpoint, idKey, refresh]);

  const update = useCallback(async (id: string, item: Partial<T> | T, opts: ActionOptions = {}) => {
    setError(null);
    const { successMessage, errorMessage } = opts;
    try {
      const updated = await apiFetch<T>(`${endpoint}/${encodeURIComponent(id)}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(item),
      });
      await refresh();
      setSuccess(successMessage || 'Updated');
      return updated ?? (item as T);
    } catch (e: any) {
      setError(errorMessage || e?.message || 'Failed to update');
      return null;
    }
  }, [endpoint, refresh]);

  const upsert = useCallback(async (item: T, opts: ActionOptions = {}) => {
    const idVal = item?.[idKey];
    if (!idVal) {
      return create(item, { ...opts, createIdIfMissing: opts.createIdIfMissing ?? true });
    }
    return update(String(idVal), item, opts);
  }, [create, idKey, update]);

  const remove = useCallback(async (id: string, opts: ActionOptions = {}) => {
    setError(null);
    const { successMessage, errorMessage } = opts;
    try {
      await apiFetch(`${endpoint}/${encodeURIComponent(id)}`, { method: 'DELETE' });
      // Optimistic update
      setItems(prev => prev.filter((it: any) => String((it as any)[idKey]) !== id));
      setSuccess(successMessage || 'Deleted');
      return true;
    } catch (e: any) {
      setError(errorMessage || e?.message || 'Failed to delete');
      return false;
    }
  }, [endpoint, idKey]);

  return useMemo(() => ({
    items,
    loading,
    error,
    success,
    refresh,
    create,
    update,
    upsert,
    remove,
    setError,
    setSuccess,
  }), [items, loading, error, success, refresh, create, update, upsert, remove]);
}

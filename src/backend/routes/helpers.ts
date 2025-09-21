import express from 'express';
import { ReqLike } from '../utils/repo-access';
import logger from '../services/logger';
import { errorHandler, ValidationError, NotFoundError, ConflictError } from '../services/error-handler';

export interface CrudRepoFunctions<T> {
  getAll: (req?: ReqLike) => Promise<T[]>;
  setAll: (req: ReqLike, items: T[]) => Promise<void> | void;
}

export interface CrudCallbacks<T> {
  /** Transform item before validation (e.g., set defaults) */
  beforeValidate?: (item: T, isUpdate?: boolean) => T;
  /** Validate item, throw error if invalid */
  validate?: (item: T, isUpdate?: boolean) => void | Promise<void>;
  /** Transform item after validation (e.g., sanitize) */
  afterValidate?: (item: T, isUpdate?: boolean) => T;
  /** Transform list before sending response */
  transformList?: (items: T[]) => T[];
  /** Optional merge strategy for updates: merge patch into current to form a full item */
  mergeUpdate?: (current: T, patch: Partial<T>) => T;
  /** Custom route handlers (return true to skip default handler) */
  customRoutes?: (app: express.Express, basePath: string, repoFns: CrudRepoFunctions<T>) => boolean;
}

export interface CrudOptions<T> {
  /** Item type name for error messages */
  itemName: string;
  /** ID field name (default: 'id') */
  idField?: keyof T;
  /** Enable reorder endpoint */
  enableReorder?: boolean;
}

export function createCrudRoutes<T extends Record<string, any>>(
  app: express.Express,
  basePath: string,
  repoFns: CrudRepoFunctions<T>,
  options: CrudOptions<T>,
  callbacks: CrudCallbacks<T> = {}
) {
  const {
    itemName,
    idField = 'id' as keyof T,
    enableReorder = false
  } = options;

  const {
    beforeValidate,
    validate,
    afterValidate,
    transformList,
    mergeUpdate,
    customRoutes
  } = callbacks;

  // Allow custom routes to override default behavior
  if (customRoutes && customRoutes(app, basePath, repoFns)) {
    return;
  }

  // GET /api/{resource}
  app.get(basePath, errorHandler.wrapAsync(async (req: express.Request, res: express.Response) => {
    logger.info(`GET ${basePath}`);
    let items = await repoFns.getAll(req as ReqLike);
    if (transformList) {
      items = transformList(items);
    }
    res.json(items);
  }));

  // POST /api/{resource}
  app.post(basePath, errorHandler.wrapAsync(async (req: express.Request, res: express.Response) => {
    let item: T = req.body;

    if (beforeValidate) {
      item = beforeValidate(item, false);
    }

    if (validate) {
      await validate(item, false);
    }

    if (afterValidate) {
      item = afterValidate(item, false);
    }

    const current = await repoFns.getAll(req as ReqLike);
    const newId = item[idField] as any;
    if (newId === undefined || newId === null || String(newId).length === 0) {
      throw new ValidationError(`${itemName} ${String(idField)} is required`);
    }
    if (current.some(existing => existing[idField] === newId)) {
      throw new ConflictError(`${itemName} with ${String(idField)} '${String(newId)}' already exists`);
    }

    const next = [...current, item];
    await repoFns.setAll(req as ReqLike, next);

    logger.info(`POST ${basePath}: added ${itemName}`, { id: newId });
    res.status(201)
      .location(`${basePath}/${encodeURIComponent(String(newId))}`)
      .json(item);
  }));

  // PUT /api/{resource}/:id
  app.put(`${basePath}/:id`, errorHandler.wrapAsync(async (req: express.Request, res: express.Response) => {
    const id = req.params.id;
    const current = await repoFns.getAll(req as ReqLike);
    const idx = current.findIndex(item => item[idField] === id);

    if (idx === -1) {
      logger.warn(`PUT ${basePath}/:id not found`, { id });
      throw new NotFoundError(`${itemName} not found`);
    }

    // Build patch and optionally merge into current for validation
    let patch: Partial<T> = req.body as Partial<T>;
    if (beforeValidate) {
      patch = beforeValidate(patch as T, true) as Partial<T>;
    }

    // Ensure ID is consistent if provided in body
    const bodyId = (patch as any)[idField];
    if (bodyId != null && bodyId !== id) {
      logger.warn(`PUT ${basePath}/:id id mismatch`, { idParam: id, bodyId });
      throw new ValidationError(`${itemName} ID mismatch`);
    }

    let candidate: T = mergeUpdate ? mergeUpdate(current[idx], patch) : (patch as T);

    if ((candidate as any)[idField] == null) {
      (candidate as any)[idField] = id;
    }

    if (validate) {
      await validate(candidate, true);
    }

    if (afterValidate) {
      candidate = afterValidate(candidate, true);
    }

    const next = current.slice();
    next[idx] = candidate;
    await repoFns.setAll(req as ReqLike, next);

    logger.info(`PUT ${basePath}/:id updated`, { id });
    res.json(candidate);
  }));

  // DELETE /api/{resource}/:id
  app.delete(`${basePath}/:id`, errorHandler.wrapAsync(async (req: express.Request, res: express.Response) => {
    const id = req.params.id;
    const current = await repoFns.getAll(req as ReqLike);
    const idx = current.findIndex(item => item[idField] === id);
    if (idx === -1) {
      logger.warn(`DELETE ${basePath}/:id not found`, { id });
      throw new NotFoundError(`${itemName} not found`);
    }
    const next = current.slice();
    next.splice(idx, 1);
    await repoFns.setAll(req as ReqLike, next);

    logger.info(`DELETE ${basePath}/:id deleted`, { id, deleted: 1 });
    res.status(204).send();
  }));

  // PUT /api/{resource}/reorder (optional)
  if (enableReorder) {
    app.put(`${basePath}/reorder`, errorHandler.wrapAsync(async (req: express.Request, res: express.Response) => {
      const body = req.body || {};
      const orderedIds: string[] = Array.isArray(body.orderedIds) ? body.orderedIds : [];

      if (!orderedIds.length) {
        throw new ValidationError('orderedIds is required and must be a non-empty array');
      }

      const current = await repoFns.getAll(req as ReqLike);
      const byId = new Map(current.map(item => [item[idField], item] as const));
      const reordered: T[] = [];

      for (const id of orderedIds) {
        const item = byId.get(id as any);
        if (item) reordered.push(item);
      }

      for (const item of current) {
        if (!orderedIds.includes(item[idField] as any)) reordered.push(item);
      }

      await repoFns.setAll(req as ReqLike, reordered);
      logger.info(`PUT ${basePath}/reorder: reordered ${itemName}s`, { count: reordered.length });
      res.json({ success: true });
    }));
  }
}

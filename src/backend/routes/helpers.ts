import express from 'express';
import { ReqLike } from '../utils/repo-access';
import logger from '../services/logger';
import { errorHandler, ValidationError, NotFoundError, ConflictError } from '../services/error-handler';

export interface CrudRepoFunctions<T> {
  list: (req?: ReqLike) => Promise<readonly T[]>;
  getById: (req: ReqLike, id: string) => Promise<T | null>;
  create: (req: ReqLike, item: T) => Promise<void>;
  update: (req: ReqLike, item: T) => Promise<void>;
  delete: (req: ReqLike, id: string) => Promise<boolean>;
  reorder?: (req: ReqLike, orderedIds: readonly string[]) => Promise<void>;
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
    let items = Array.from(await repoFns.list(req as ReqLike));
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

    const newId = item[idField] as any;
    if (newId === undefined || newId === null || String(newId).length === 0) {
      throw new ValidationError(`${itemName} ${String(idField)} is required`);
    }
    const existing = await repoFns.getById(req as ReqLike, String(newId));
    if (existing) {
      throw new ConflictError(`${itemName} with ${String(idField)} '${String(newId)}' already exists`);
    }

    await repoFns.create(req as ReqLike, item);

    logger.info(`POST ${basePath}: added ${itemName}`, { id: newId });
    res.status(201)
      .location(`${basePath}/${encodeURIComponent(String(newId))}`)
      .json(item);
  }));

  // PUT /api/{resource}/:id
  app.put(`${basePath}/:id`, errorHandler.wrapAsync(async (req: express.Request, res: express.Response) => {
    const id = req.params.id;
    const current = await repoFns.getById(req as ReqLike, id);

    if (!current) {
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

    let candidate: T = mergeUpdate ? mergeUpdate(current, patch) : (patch as T);

    if ((candidate as any)[idField] == null) {
      (candidate as any)[idField] = id;
    }

    if (validate) {
      await validate(candidate, true);
    }

    if (afterValidate) {
      candidate = afterValidate(candidate, true);
    }

    await repoFns.update(req as ReqLike, candidate);

    logger.info(`PUT ${basePath}/:id updated`, { id });
    res.json(candidate);
  }));

  // DELETE /api/{resource}/:id
  app.delete(`${basePath}/:id`, errorHandler.wrapAsync(async (req: express.Request, res: express.Response) => {
    const id = req.params.id;
    const removed = await repoFns.delete(req as ReqLike, id);
    if (!removed) {
      logger.warn(`DELETE ${basePath}/:id not found`, { id });
      throw new NotFoundError(`${itemName} not found`);
    }

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

      if (typeof repoFns.reorder !== 'function') {
        throw new Error('Reorder operation not supported for this resource');
      }

      await repoFns.reorder(req as ReqLike, orderedIds);
      logger.info(`PUT ${basePath}/reorder: reordered ${itemName}s`, { count: orderedIds.length });
      res.json({ success: true });
    }));
  }
}

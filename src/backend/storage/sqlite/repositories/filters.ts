import type { Filter } from '../../../../shared/types';
import type { StorageHandle } from '../types';
import { SqliteRepository } from './base';

const FILTER_FIELDS = new Set(['from', 'to', 'cc', 'bcc', 'subject', 'body', 'date']);

export class FiltersRepository extends SqliteRepository {
  constructor(handle: StorageHandle) {
    super(handle);
  }

  async list(): Promise<readonly Filter[]> {
    return this.withConnection((db) => this.readAll(db));
  }

  async getById(id: string): Promise<Filter | null> {
    this.assertId(id);
    return this.withConnection((db) => {
      const row = db
        .prepare('SELECT id, field, regex, director_id, duplicate_allowed FROM filters WHERE id = ?')
        .get(id);
      return row ? this.mapRow(row) : null;
    });
  }

  async insert(filter: Filter): Promise<void> {
    this.assertFilter(filter);
    await this.transaction((db) => {
      const exists = db.prepare('SELECT 1 FROM filters WHERE id = ?').get(filter.id);
      if (exists) {
        throw new Error(`FiltersRepository: filter '${filter.id}' already exists`);
      }
      db.prepare(
        'INSERT INTO filters (id, field, regex, director_id, duplicate_allowed) VALUES (@id, @field, @regex, @director_id, @duplicate_allowed)'
      ).run({
        id: filter.id,
        field: filter.field,
        regex: filter.regex,
        director_id: filter.directorId,
        duplicate_allowed: filter.duplicateAllowed ? 1 : 0,
      });
    });
  }

  async update(filter: Filter): Promise<void> {
    this.assertFilter(filter);
    await this.transaction((db) => {
      const result = db
        .prepare(
          'UPDATE filters SET field = @field, regex = @regex, director_id = @director_id, duplicate_allowed = @duplicate_allowed WHERE id = @id'
        )
        .run({
          id: filter.id,
          field: filter.field,
          regex: filter.regex,
          director_id: filter.directorId,
          duplicate_allowed: filter.duplicateAllowed ? 1 : 0,
        });
      if (result.changes === 0) {
        throw new Error(`FiltersRepository: filter '${filter.id}' not found`);
      }
    });
  }

  async delete(id: string): Promise<boolean> {
    this.assertId(id);
    return this.transaction((db) => {
      const result = db.prepare('DELETE FROM filters WHERE id = ?').run(id);
      return result.changes > 0;
    });
  }

  async reorder(orderedIds: readonly string[]): Promise<void> {
    await this.transaction((db) => {
      const current = this.readAll(db);
      const byId = new Map(current.map((filter) => [filter.id, filter] as const));
      const seen = new Set<string>();
      const next: Filter[] = [];
      for (const rawId of orderedIds) {
        this.assertId(rawId);
        const filter = byId.get(rawId);
        if (filter && !seen.has(filter.id)) {
          next.push(filter);
          seen.add(filter.id);
        }
      }
      for (const filter of current) {
        if (!seen.has(filter.id)) {
          next.push(filter);
        }
      }

      db.prepare('DELETE FROM filters').run();
      const insert = db.prepare(
        'INSERT INTO filters (id, field, regex, director_id, duplicate_allowed) VALUES (@id, @field, @regex, @director_id, @duplicate_allowed)'
      );
      for (const filter of next) {
        insert.run({
          id: filter.id,
          field: filter.field,
          regex: filter.regex,
          director_id: filter.directorId,
          duplicate_allowed: filter.duplicateAllowed ? 1 : 0,
        });
      }
    });
  }

  async getAll(): Promise<Filter[]> {
    const rows = await this.list();
    return [...rows];
  }

  private readAll(db: any): Filter[] {
    const rows = db
      .prepare('SELECT id, field, regex, director_id, duplicate_allowed FROM filters ORDER BY rowid')
      .all();
    return rows.map((row: any) => this.mapRow(row));
  }

  private mapRow(row: any): Filter {
    return {
      id: row.id,
      field: row.field,
      regex: row.regex,
      directorId: row.director_id,
      duplicateAllowed: Boolean(row.duplicate_allowed),
    };
  }

  private assertId(value: unknown): asserts value is string {
    if (typeof value !== 'string' || !value.trim()) {
      throw new Error('FiltersRepository: id is required');
    }
  }

  private assertFilter(filter: Filter): void {
    if (!filter || typeof filter !== 'object') {
      throw new Error('FiltersRepository: filter payload required');
    }
    this.assertId(filter.id);
    if (typeof filter.field !== 'string' || !FILTER_FIELDS.has(filter.field)) {
      throw new Error(`FiltersRepository: invalid field for '${filter.id}'`);
    }
    if (typeof filter.regex !== 'string' || !filter.regex.trim()) {
      throw new Error(`FiltersRepository: regex required for '${filter.id}'`);
    }
    if (typeof filter.directorId !== 'string' || !filter.directorId.trim()) {
      throw new Error(`FiltersRepository: directorId required for '${filter.id}'`);
    }
    if (typeof filter.duplicateAllowed !== 'boolean') {
      throw new Error(`FiltersRepository: duplicateAllowed must be boolean for '${filter.id}'`);
    }
  }
}

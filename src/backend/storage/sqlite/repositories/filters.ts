import type { Filter } from '../../../../shared/types';
import type { StorageHandle } from '../types';
import { SqliteRepository } from './base';

export class FiltersRepository extends SqliteRepository {
  constructor(handle: StorageHandle) {
    super(handle);
  }

  async getAll(): Promise<Filter[]> {
    return this.withConnection((db) => {
      const rows = db.prepare(
        'SELECT id, field, regex, director_id, duplicate_allowed FROM filters ORDER BY id'
      ).all();
      return rows.map((row: any) => ({
        id: row.id,
        field: row.field,
        regex: row.regex,
        directorId: row.director_id,
        duplicateAllowed: Boolean(row.duplicate_allowed),
      }));
    });
  }

  async setAll(filters: Filter[]): Promise<void> {
    await this.transaction((db) => {
      db.prepare('DELETE FROM filters').run();
      const insert = db.prepare(
        'INSERT INTO filters (id, field, regex, director_id, duplicate_allowed) VALUES (@id, @field, @regex, @director_id, @duplicate_allowed)'
      );
      for (const filter of filters) {
        insert.run({
          id: filter.id,
          field: filter.field,
          regex: filter.regex,
          director_id: filter.directorId,
          duplicate_allowed: filter.duplicateAllowed ? 1 : 0,
        });
      }
      return undefined;
    });
  }
}

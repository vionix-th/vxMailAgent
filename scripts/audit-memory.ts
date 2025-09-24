#!/usr/bin/env ts-node
import fs from 'fs';
import path from 'path';
import process from 'process';
import { SqliteConnectionFactory, SystemUsersRepository } from '../src/backend/storage/sqlite';
import type { StorageHandle } from '../src/backend/storage/sqlite/types';
import { resolveDataDir } from '../src/backend/utils/paths';

const VALID_SCOPES = new Set(['local', 'shared', 'global']);

type AuditIssue = 'owner_missing' | 'owner_blank' | 'scope_missing' | 'scope_invalid';

interface AuditSummary {
  userId: string;
  totalEntries: number;
  invalidEntries: Array<{
    id: string;
    scope: string | null;
    owner: string | null;
    issues: AuditIssue[];
    createdAt: string | null;
    updatedAt: string | null;
  }>;
}

function escapeSql(value: string): string {
  return value.replace(/'/g, "''");
}

async function readRows(handle: StorageHandle) {
  return handle.withConnection((db) => {
    const stmt = db.prepare(
      'SELECT id, scope, owner, created_at as createdAt, updated_at as updatedAt FROM memory_entries'
    );
    return stmt.all() as Array<{
      id: string;
      scope: string | null;
      owner: string | null;
      createdAt: string | null;
      updatedAt: string | null;
    }>;
  });
}

function auditRows(rows: Array<{ id: string; scope: string | null; owner: string | null; createdAt: string | null; updatedAt: string | null }>): AuditSummary['invalidEntries'] {
  const invalid: AuditSummary['invalidEntries'] = [];
  for (const row of rows) {
    const issues: AuditIssue[] = [];
    const scope = typeof row.scope === 'string' ? row.scope.trim() : null;
    const owner = typeof row.owner === 'string' ? row.owner.trim() : null;
    if (!scope) {
      issues.push('scope_missing');
    } else if (!VALID_SCOPES.has(scope as any)) {
      issues.push('scope_invalid');
    }
    if (owner === null) {
      issues.push('owner_missing');
    } else if (owner.length === 0) {
      issues.push('owner_blank');
    }
    if (issues.length) {
      invalid.push({ id: row.id, scope: row.scope, owner: row.owner, issues, createdAt: row.createdAt, updatedAt: row.updatedAt });
    }
  }
  return invalid;
}

async function auditUser(factory: SqliteConnectionFactory, userId: string): Promise<AuditSummary> {
  const handle = factory.getUserHandle(userId);
  const rows = await readRows(handle);
  return {
    userId,
    totalEntries: rows.length,
    invalidEntries: auditRows(rows),
  };
}

async function resolveUserIds(factory: SqliteConnectionFactory, explicit: string[]): Promise<string[]> {
  if (explicit.length) {
    return Array.from(new Set(explicit)).sort();
  }
  const sharedHandle = factory.getSharedHandle();
  const usersRepo = new SystemUsersRepository(sharedHandle);
  const registered = await usersRepo.getAll();
  const ids = Array.from(new Set(registered.map((u) => u.id))).sort();
  if (ids.length) {
    return ids;
  }
  const dataDir = resolveDataDir();
  const usersDir = path.join(dataDir, 'users');
  if (!fs.existsSync(usersDir)) {
    return [];
  }
  const entries = fs.readdirSync(usersDir, { withFileTypes: true }).filter((d) => d.isDirectory());
  return entries.map((d) => d.name.replace(/_/g, ':'));
}

function printSummary(reports: AuditSummary[]) {
  if (!reports.length) {
    console.log('No users found. Pass user IDs as arguments if needed.');
    return;
  }
  console.log('Memory audit summary:');
  let invalidTotal = 0;
  for (const report of reports) {
    const invalidCount = report.invalidEntries.length;
    invalidTotal += invalidCount;
    console.log(`- ${report.userId}: ${report.totalEntries} entries, ${invalidCount} invalid`);
    if (invalidCount) {
      for (const entry of report.invalidEntries) {
        console.log(`  * ${entry.id} scope=${entry.scope ?? 'null'} owner=${entry.owner ?? 'null'} issues=${entry.issues.join(',')}`);
      }
    }
  }
  if (invalidTotal === 0) {
    console.log('All memory entries have valid scopes and owners.');
    return;
  }
  console.log('\nSuggested cleanup SQL (review carefully before executing):');
  for (const report of reports) {
    for (const entry of report.invalidEntries) {
      const commentIssues = entry.issues.join(',');
      console.log(`-- ${report.userId} ${entry.id} issues: ${commentIssues}`);
      console.log(`DELETE FROM memory_entries WHERE id = '${escapeSql(entry.id)}';`);
    }
  }
}

async function main() {
  const args = process.argv.slice(2).filter((arg) => !arg.startsWith('-'));
  const factory = new SqliteConnectionFactory();
  try {
    const userIds = await resolveUserIds(factory, args);
    const reports: AuditSummary[] = [];
    for (const userId of userIds) {
      try {
        reports.push(await auditUser(factory, userId));
      } catch (error) {
        console.error(`Failed to audit user ${userId}:`, (error as Error)?.message || String(error));
      }
    }
    printSummary(reports);
  } finally {
    await factory.closeAll();
  }
}

void main().catch((error) => {
  console.error('Memory audit failed:', error);
  process.exit(1);
});

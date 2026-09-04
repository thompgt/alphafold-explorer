import type { Db } from './db.ts';
import { guardSql, type GuardOptions, type GuardedSql } from './sqlGuard.ts';

export interface GuardedQueryResult extends GuardedSql {
  rows: Record<string, unknown>[];
}

/**
 * Runs model-generated SQL as safely as this process can.
 *
 * Two independent layers, because either one alone is a single point of failure:
 *   1. guardSql only lets a read-only SELECT over allowed views through at all;
 *   2. the statement runs inside a transaction that is always rolled back, so
 *      anything that did slip past the guard still cannot commit.
 *
 * DuckDB takes a per-process file lock, so opening a second read-only handle to the
 * same database is not an option — the rollback is what stands in for one.
 */
export async function runGuardedQuery(
  db: Db,
  sql: string,
  options: GuardOptions = {},
): Promise<GuardedQueryResult> {
  const guarded = guardSql(sql, options);

  await db.exec('BEGIN TRANSACTION');
  try {
    const rows = await db.all(guarded.sql);
    return { ...guarded, rows };
  } finally {
    await db.exec('ROLLBACK');
  }
}

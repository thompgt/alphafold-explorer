import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Db } from './db.ts';

const MIGRATIONS_DIR = path.resolve(fileURLToPath(new URL('../migrations', import.meta.url)));

export interface MigrationResult {
  applied: string[];
  skipped: string[];
}

/**
 * Applies every numbered .sql file in packages/core/migrations that has not run yet.
 * Deliberately tiny: no down-migrations, no checksums beyond the recorded filename.
 */
export async function migrate(db: Db, dir = MIGRATIONS_DIR): Promise<MigrationResult> {
  await db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      name       VARCHAR PRIMARY KEY,
      applied_at TIMESTAMP NOT NULL
    )
  `);

  const done = new Set(
    (await db.all<{ name: string }>('SELECT name FROM schema_migrations')).map((r) => r.name),
  );

  const files = fs
    .readdirSync(dir)
    .filter((f) => f.endsWith('.sql'))
    .sort();

  const result: MigrationResult = { applied: [], skipped: [] };
  for (const file of files) {
    if (done.has(file)) {
      result.skipped.push(file);
      continue;
    }
    const sql = fs.readFileSync(path.join(dir, file), 'utf8');
    // DuckDB's run() accepts multiple statements in one call.
    await db.exec(sql);
    await db.exec('INSERT INTO schema_migrations VALUES (?, now())', [file]);
    result.applied.push(file);
  }
  return result;
}

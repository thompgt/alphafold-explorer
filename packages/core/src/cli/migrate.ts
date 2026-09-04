import { openDb } from '../db.ts';
import { migrate } from '../migrate.ts';
import { config } from '../config.ts';

const db = await openDb();
try {
  const { applied, skipped } = await migrate(db);
  console.log(`database: ${config.dbPath}`);
  console.log(applied.length ? `applied: ${applied.join(', ')}` : 'applied: none');
  if (skipped.length) console.log(`already applied: ${skipped.length}`);
} finally {
  await db.close();
}

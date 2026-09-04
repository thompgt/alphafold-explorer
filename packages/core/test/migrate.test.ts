import { describe, expect, it } from 'vitest';
import { openDb } from '../src/db.ts';
import { migrate } from '../src/migrate.ts';

async function freshDb() {
  const db = await openDb({ dbPath: ':memory:' });
  await migrate(db);
  return db;
}

describe('migrations', () => {
  it('creates every core table and view', async () => {
    const db = await freshDb();
    try {
      const rows = await db.all<{ table_name: string }>(
        "SELECT table_name FROM information_schema.tables WHERE table_schema = 'main'",
      );
      const names = new Set(rows.map((r) => r.table_name));
      for (const expected of [
        'proteins',
        'residues',
        'confidence_summary',
        'segments',
        'annotations',
        'chunks',
        'schema_migrations',
        'v_protein_overview',
        'v_low_confidence_segments',
        'v_residue_confidence',
      ]) {
        expect(names, `missing ${expected}`).toContain(expected);
      }
    } finally {
      await db.close();
    }
  });

  it('is idempotent and records what it applied', async () => {
    const db = await openDb({ dbPath: ':memory:' });
    try {
      const first = await migrate(db);
      expect(first.applied.length).toBeGreaterThan(0);
      expect(first.skipped).toHaveLength(0);

      const second = await migrate(db);
      expect(second.applied).toHaveLength(0);
      expect(second.skipped).toEqual(first.applied);
    } finally {
      await db.close();
    }
  });

  it('normalises BIGINT results to plain numbers', async () => {
    const db = await freshDb();
    try {
      const row = await db.one<{ n: number }>('SELECT count(*) AS n FROM proteins');
      expect(row?.n).toBe(0);
      expect(typeof row?.n).toBe('number');
    } finally {
      await db.close();
    }
  });

  it('exposes the overview view over an inserted protein', async () => {
    const db = await freshDb();
    try {
      await db.exec(`
        INSERT INTO proteins (accession, entry_id, protein_name, gene, organism, sequence_length, cif_url, ingested_at)
        VALUES ('P69905', 'AF-P69905-F1', 'Hemoglobin subunit alpha', 'HBA1', 'Homo sapiens', 142, 'https://example.invalid/a.cif', now())
      `);
      const row = await db.one<{ accession: string; gene: string; mean_plddt: number | null }>(
        'SELECT accession, gene, mean_plddt FROM v_protein_overview',
      );
      expect(row?.accession).toBe('P69905');
      expect(row?.gene).toBe('HBA1');
      expect(row?.mean_plddt).toBeNull();
    } finally {
      await db.close();
    }
  });
});

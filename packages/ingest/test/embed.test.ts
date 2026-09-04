import { beforeEach, describe, expect, it } from 'vitest';
import { migrate, openDb, type Db } from '@afx/core';
import { stubProvider } from '@afx/llm';
import { buildChunks, embedAccession, retrieveChunks } from '../src/embed.ts';

const ENTRIES = [
  {
    accession: 'P04637',
    gene: 'TP53',
    name: 'Cellular tumor antigen p53',
    length: 393,
    summary: [75.1, 80.0, 20.5, 98.9, 40.0, 20.0, 10.23, 29.77, 68],
    segment: ['P04637:26-93', 26, 93, 68, 46.08, 'internal'] as const,
  },
  {
    accession: 'P00918',
    gene: 'CA2',
    name: 'Carbonic anhydrase 2',
    length: 260,
    summary: [96.4, 97.1, 60.2, 98.9, 92.0, 7.0, 1.0, 0.0, 2],
    segment: null,
  },
];

async function seed(): Promise<Db> {
  const db = await openDb({ dbPath: ':memory:' });
  await migrate(db);
  for (const entry of ENTRIES) {
    await db.exec(
      `INSERT INTO proteins (accession, entry_id, protein_name, gene, organism, sequence_length,
                             uniprot_description, cif_url, ingested_at)
       VALUES (?, ?, ?, ?, 'Homo sapiens', ?, ?, 'https://example.invalid/a.cif', now())`,
      [
        entry.accession,
        `AF-${entry.accession}-F1`,
        entry.name,
        entry.gene,
        entry.length,
        entry.name,
      ],
    );
    await db.exec('INSERT INTO confidence_summary VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)', [
      entry.accession,
      ...entry.summary,
    ]);
    if (entry.segment) {
      const [id, start, end, length, mean, terminal] = entry.segment;
      await db.exec('INSERT INTO segments VALUES (?, ?, ?, ?, ?, ?, ?)', [
        id,
        entry.accession,
        start,
        end,
        length,
        mean,
        terminal,
      ]);
    }
  }
  return db;
}

let db: Db;
beforeEach(async () => {
  db = await seed();
  return async () => {
    await db.close();
  };
});

describe('buildChunks', () => {
  const facts = {
    proteinName: 'Cellular tumor antigen p53',
    gene: 'TP53',
    organism: 'Homo sapiens',
    sequenceLength: 393,
    uniprotDescription: 'Cellular tumor antigen p53',
    summary: {
      mean_plddt: 75.1,
      pct_very_high: 40,
      pct_confident: 20,
      pct_low: 10.23,
      pct_very_low: 29.77,
      longest_low_run: 68,
    },
    segments: [
      { start_residue: 26, end_residue: 93, length: 68, mean_plddt: 46.08, terminal: 'internal' },
    ],
  };

  it('names the protein in every chunk so passages stand alone', () => {
    const chunks = buildChunks('P04637', facts, null);
    expect(chunks.length).toBeGreaterThan(0);
    for (const chunk of chunks) expect(chunk.text).toContain('P04637');
  });

  it('describes the segments it was given', () => {
    const [structure] = buildChunks('P04637', facts, null);
    expect(structure?.text).toContain('residues 26-93');
    expect(structure?.text).toContain('mean pLDDT of 75.1');
  });

  it('says so plainly when there are no candidate regions', () => {
    const [structure] = buildChunks('P00918', { ...facts, segments: [] }, null);
    expect(structure?.text).toContain('no candidate disordered regions');
  });

  it('adds an annotation chunk only when a card exists', () => {
    expect(buildChunks('P04637', facts, null).map((c) => c.source)).not.toContain('annotation');
    const withCard = buildChunks('P04637', facts, {
      summary: 'A tumour suppressor.',
      confidence_profile: 'Mixed confidence.',
      disordered_regions: 'Residues 26-93.',
      caveats: 'Confidence is not disorder.',
      keywords: ['human'],
    });
    expect(withCard.map((c) => c.source)).toContain('annotation');
  });
});

describe('embedAccession', () => {
  it('stores one row per chunk with the model recorded', async () => {
    const provider = stubProvider();
    const report = await embedAccession(db, provider, 'P04637');
    expect(report.chunks).toBeGreaterThan(1);

    const rows = await db.all<{ chunk_id: string; model: string; source: string }>(
      'SELECT chunk_id, model, source FROM chunks WHERE accession = ? ORDER BY chunk_id',
      ['P04637'],
    );
    expect(rows).toHaveLength(report.chunks);
    expect(rows.every((r) => r.model === 'stub-embed')).toBe(true);
  });

  it('replaces previous chunks instead of accumulating them', async () => {
    const provider = stubProvider();
    await embedAccession(db, provider, 'P04637');
    await embedAccession(db, provider, 'P04637');
    const row = await db.one<{ n: number }>(
      'SELECT count(*) AS n FROM chunks WHERE accession = ?',
      ['P04637'],
    );
    expect(row?.n).toBe(3 - 1); // structure_summary + uniprot; no annotation card yet
  });

  it('refuses to store a non-finite embedding', async () => {
    const provider = stubProvider({ embed: (texts) => texts.map(() => Array(768).fill(Number.NaN)) });
    await expect(embedAccession(db, provider, 'P04637')).rejects.toThrow(/non-finite/);
  });
});

describe('retrieveChunks', () => {
  beforeEach(async () => {
    const provider = stubProvider();
    for (const entry of ENTRIES) await embedAccession(db, provider, entry.accession);
  });

  it('ranks the entry the question is about first', async () => {
    const provider = stubProvider();
    const hits = await retrieveChunks(db, provider, 'candidate disordered regions in p53', {
      minSimilarity: 0,
    });
    expect(hits.length).toBeGreaterThan(0);
    expect(hits[0]?.accession).toBe('P04637');
  });

  it('returns similarities in descending order', async () => {
    const provider = stubProvider();
    const hits = await retrieveChunks(db, provider, 'carbonic anhydrase', { minSimilarity: 0 });
    const scores = hits.map((h) => h.similarity);
    expect([...scores].sort((a, b) => b - a)).toEqual(scores);
  });

  it('returns nothing when no passage clears the similarity floor', async () => {
    const provider = stubProvider();
    const hits = await retrieveChunks(db, provider, 'quarterly revenue in the eurozone', {
      minSimilarity: 0.9,
    });
    expect(hits).toEqual([]);
  });

  it('honours topK', async () => {
    const provider = stubProvider();
    const hits = await retrieveChunks(db, provider, 'protein', { topK: 2, minSimilarity: 0 });
    expect(hits.length).toBeLessThanOrEqual(2);
  });
});

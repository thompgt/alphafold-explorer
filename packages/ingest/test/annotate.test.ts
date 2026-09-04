import { beforeEach, describe, expect, it } from 'vitest';
import { migrate, openDb, type Db } from '@afx/core';
import { stubProvider } from '@afx/llm';
import { annotateAccession, collectFacts, pendingAnnotations } from '../src/annotate.ts';

const VALID_CARD = {
  summary: 'A 393-residue human protein predicted as a single chain by AlphaFold.',
  confidence_profile: 'Roughly half the chain is modelled confidently, the rest is not.',
  disordered_regions: 'Residues 26-93 are a candidate disordered region.',
  caveats: 'Low pLDDT indicates low confidence, not measured disorder.',
  keywords: ['human', 'disordered', 'tumour suppressor'],
};

async function seed(): Promise<Db> {
  const db = await openDb({ dbPath: ':memory:' });
  await migrate(db);
  await db.exec(`
    INSERT INTO proteins (accession, entry_id, protein_name, gene, organism, sequence_length,
                          uniprot_description, cif_url, ingested_at)
    VALUES ('P04637', 'AF-P04637-F1', 'Cellular tumor antigen p53', 'TP53', 'Homo sapiens', 393,
            'Cellular tumor antigen p53', 'https://example.invalid/a.cif', now())
  `);
  await db.exec(`
    INSERT INTO confidence_summary
    VALUES ('P04637', 75.1, 80.0, 20.5, 98.9, 40.0, 20.0, 10.23, 29.77, 68)
  `);
  await db.exec(`
    INSERT INTO segments VALUES ('P04637:26-93', 'P04637', 26, 93, 68, 46.08, 'internal')
  `);
  return db;
}

let db: Db;
beforeEach(async () => {
  db = await seed();
  return async () => {
    await db.close();
  };
});

describe('collectFacts', () => {
  it('assembles protein, summary and segments', async () => {
    const facts = await collectFacts(db, 'P04637');
    expect(facts.gene).toBe('TP53');
    expect(facts.summary.pct_very_low).toBe(29.77);
    expect(facts.segments).toHaveLength(1);
    expect(facts.segments[0]?.start_residue).toBe(26);
  });

  it('explains itself when the accession is unknown', async () => {
    await expect(collectFacts(db, 'NOPE')).rejects.toThrow(/not in the database/);
  });
});

describe('annotateAccession', () => {
  it('stores a valid card', async () => {
    const provider = stubProvider({ chat: () => JSON.stringify(VALID_CARD) });
    const report = await annotateAccession('P04637', { db, provider });
    expect(report).toMatchObject({ outcome: 'annotated', attempts: 1 });

    const row = await db.one<{ status: string; card: string; model: string }>(
      'SELECT status, card, model FROM annotations WHERE accession = ?',
      ['P04637'],
    );
    expect(row?.status).toBe('ok');
    expect(row?.model).toBe('stub-chat');
    expect(JSON.parse(row!.card).keywords).toContain('human');
  });

  it('passes the real confidence numbers to the model', async () => {
    let seen = '';
    const provider = stubProvider({
      chat: (prompt) => {
        seen = prompt;
        return JSON.stringify(VALID_CARD);
      },
    });
    await annotateAccession('P04637', { db, provider });
    expect(seen).toContain('29.77%');
    expect(seen).toContain('residues 26-93');
    expect(seen).toContain('TP53');
  });

  it('retries once, then succeeds', async () => {
    let calls = 0;
    const provider = stubProvider({
      chat: () => {
        calls += 1;
        return calls === 1 ? 'sorry, I cannot do that' : JSON.stringify(VALID_CARD);
      },
    });
    const report = await annotateAccession('P04637', { db, provider });
    expect(report).toMatchObject({ outcome: 'annotated', attempts: 2 });
  });

  it('records a failure rather than writing a malformed card', async () => {
    const provider = stubProvider({ chat: () => JSON.stringify({ summary: 'too short' }) });
    const report = await annotateAccession('P04637', { db, provider });
    expect(report.outcome).toBe('failed');

    const row = await db.one<{ status: string; card: unknown; error: string }>(
      'SELECT status, card, error FROM annotations WHERE accession = ?',
      ['P04637'],
    );
    expect(row?.status).toBe('failed');
    expect(row?.card).toBeNull();
    expect(row?.error).toBeTruthy();
  });

  it('replaces an existing card instead of duplicating it', async () => {
    const provider = stubProvider({ chat: () => JSON.stringify(VALID_CARD) });
    await annotateAccession('P04637', { db, provider });
    await annotateAccession('P04637', { db, provider });
    const row = await db.one<{ n: number }>('SELECT count(*) AS n FROM annotations');
    expect(row?.n).toBe(1);
  });
});

describe('pendingAnnotations', () => {
  it('lists entries with no card', async () => {
    expect(await pendingAnnotations(db, 'stub-chat')).toEqual(['P04637']);
  });

  it('skips entries already annotated by the same model', async () => {
    const provider = stubProvider({ chat: () => JSON.stringify(VALID_CARD) });
    await annotateAccession('P04637', { db, provider });
    expect(await pendingAnnotations(db, 'stub-chat')).toEqual([]);
  });

  it('re-queues entries annotated by a different model', async () => {
    const provider = stubProvider({ chat: () => JSON.stringify(VALID_CARD) });
    await annotateAccession('P04637', { db, provider });
    expect(await pendingAnnotations(db, 'some-other-model')).toEqual(['P04637']);
  });

  it('re-queues everything when forced', async () => {
    const provider = stubProvider({ chat: () => JSON.stringify(VALID_CARD) });
    await annotateAccession('P04637', { db, provider });
    expect(await pendingAnnotations(db, 'stub-chat', true)).toEqual(['P04637']);
  });
});

import type { FastifyInstance } from 'fastify';
import { beforeEach, describe, expect, it } from 'vitest';
import { migrate, openDb, type Db } from '@afx/core';
import { stubProvider, type LlmProvider } from '@afx/llm';
import { embedAccession, localStore } from '@afx/ingest';
import { buildServer } from '../src/server.ts';

const CARD = {
  summary: 'A human tumour suppressor predicted as one chain.',
  confidence_profile: 'About half the chain is modelled confidently.',
  disordered_regions: 'Residues 26-93 are a candidate disordered region.',
  caveats: 'Low pLDDT means low confidence, not measured disorder.',
  keywords: ['human', 'disordered'],
};

async function seed(): Promise<Db> {
  const db = await openDb({ dbPath: ':memory:' });
  await migrate(db);

  await db.exec(`
    INSERT INTO proteins (accession, entry_id, protein_name, gene, organism, sequence_length,
                          uniprot_description, model_version, cif_url, cif_object_key, ingested_at)
    VALUES
      ('P04637', 'AF-P04637-F1', 'Cellular tumor antigen p53', 'TP53', 'Homo sapiens', 393,
       'Cellular tumor antigen p53', 6, 'https://alphafold.ebi.ac.uk/files/AF-P04637-F1-model_v6.cif', NULL, now()),
      ('P00918', 'AF-P00918-F1', 'Carbonic anhydrase 2', 'CA2', 'Homo sapiens', 260,
       'Carbonic anhydrase 2', 6, 'https://alphafold.ebi.ac.uk/files/AF-P00918-F1-model_v6.cif', NULL, now())
  `);
  await db.exec(`
    INSERT INTO confidence_summary VALUES
      ('P04637', 75.1, 80.0, 20.5, 98.9, 40.0, 20.0, 10.23, 29.77, 68),
      ('P00918', 96.4, 97.1, 60.2, 98.9, 92.0, 7.0, 1.0, 0.0, 2)
  `);
  await db.exec(`
    INSERT INTO segments VALUES ('P04637:26-93', 'P04637', 26, 93, 68, 46.08, 'internal')
  `);
  await db.exec(
    "INSERT INTO annotations VALUES ('P04637', 'stub-chat', 'ok', ?, NULL, now())",
    [JSON.stringify(CARD)],
  );
  await db.exec(`
    INSERT INTO residues VALUES
      ('P04637', 1, 'M', 45.2), ('P04637', 2, 'E', 47.9), ('P04637', 3, 'E', 51.4)
  `);
  return db;
}

interface Harness {
  app: FastifyInstance;
  db: Db;
}

async function harness(provider: LlmProvider = stubProvider()): Promise<Harness> {
  const db = await seed();
  const app = await buildServer({ db, provider });
  return { app, db };
}

let h: Harness;

describe('GET /health', () => {
  beforeEach(async () => {
    h = await harness();
    return async () => {
      await h.app.close();
      await h.db.close();
    };
  });

  it('reports both dependencies and what is in the database', async () => {
    const response = await h.app.inject({ method: 'GET', url: '/health' });
    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.ok).toBe(true);
    expect(body.database.detail).toContain('2 proteins');
    expect(body.database.detail).toContain('1 annotations');
  });

  it('returns 503 when the model is unreachable', async () => {
    const broken = stubProvider();
    broken.health = async () => ({ ok: false, detail: 'ollama unreachable' });
    const db = await seed();
    const app = await buildServer({ db, provider: broken });
    const response = await app.inject({ method: 'GET', url: '/health' });
    expect(response.statusCode).toBe(503);
    expect(response.json().model.ok).toBe(false);
    await app.close();
    await db.close();
  });
});

describe('protein routes', () => {
  beforeEach(async () => {
    h = await harness();
    return async () => {
      await h.app.close();
      await h.db.close();
    };
  });

  it('lists proteins with a total', async () => {
    const body = (await h.app.inject({ method: 'GET', url: '/proteins' })).json();
    expect(body.total).toBe(2);
    expect(body.proteins.map((p: { accession: string }) => p.accession)).toEqual([
      'P00918',
      'P04637',
    ]);
  });

  it('searches by gene, name and accession', async () => {
    for (const q of ['TP53', 'tumor', 'p04637']) {
      const body = (await h.app.inject({ method: 'GET', url: `/proteins?q=${q}` })).json();
      expect(body.total, `search for ${q}`).toBe(1);
      expect(body.proteins[0].accession).toBe('P04637');
    }
  });

  it('sorts on an allowed column', async () => {
    const body = (
      await h.app.inject({ method: 'GET', url: '/proteins?sort=mean_plddt&order=desc' })
    ).json();
    expect(body.proteins[0].accession).toBe('P00918');
  });

  it('rejects a sort column that is not in the enum', async () => {
    const response = await h.app.inject({ method: 'GET', url: '/proteins?sort=1;DROP+TABLE' });
    expect(response.statusCode).toBe(400);
  });

  it('returns a protein with its segments and annotation card', async () => {
    const body = (await h.app.inject({ method: 'GET', url: '/proteins/P04637' })).json();
    expect(body.protein.gene).toBe('TP53');
    expect(body.protein.mean_plddt).toBe(75.1);
    expect(body.segments).toHaveLength(1);
    expect(body.annotation.card.keywords).toContain('human');
  });

  it('lower-cases and upper-cases accessions consistently', async () => {
    const response = await h.app.inject({ method: 'GET', url: '/proteins/p04637' });
    expect(response.statusCode).toBe(200);
    expect(response.json().protein.accession).toBe('P04637');
  });

  it('404s an unknown accession and 400s a malformed one', async () => {
    expect((await h.app.inject({ method: 'GET', url: '/proteins/Q00000' })).statusCode).toBe(404);
    expect((await h.app.inject({ method: 'GET', url: '/proteins/..%2Fetc' })).statusCode).toBe(400);
  });

  it('serves per-residue confidence', async () => {
    const body = (await h.app.inject({ method: 'GET', url: '/proteins/P04637/residues' })).json();
    expect(body.residues).toHaveLength(3);
    expect(body.residues[0]).toEqual({ residue_index: 1, amino_acid: 'M', plddt: 45.2 });
  });

  it('redirects to AlphaFold when the model file is not in the object store', async () => {
    const response = await h.app.inject({ method: 'GET', url: '/proteins/P04637/structure' });
    expect(response.statusCode).toBe(302);
    expect(response.headers.location).toContain('alphafold.ebi.ac.uk');
  });
});

describe('POST /ask', () => {
  function askHarness(sqlToReturn: string) {
    return stubProvider({
      chat: (prompt) =>
        prompt.startsWith('Schema:') ? sqlToReturn : 'The rows show two human proteins.',
    });
  }

  it('runs safe SQL and returns rows, the query and a summary', async () => {
    const db = await seed();
    const app = await buildServer({
      db,
      provider: askHarness('SELECT gene, mean_plddt FROM v_protein_overview ORDER BY mean_plddt'),
    });
    const response = await app.inject({
      method: 'POST',
      url: '/ask',
      payload: { question: 'which proteins are least confidently modelled?' },
    });
    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.rowCount).toBe(2);
    expect(body.rows[0].gene).toBe('TP53');
    expect(body.sql).toContain('v_protein_overview');
    expect(body.limitApplied).toBe(true);
    expect(body.summary).toContain('two human proteins');
    await app.close();
    await db.close();
  });

  it('rejects a destructive query and says why, without touching the data', async () => {
    const db = await seed();
    const app = await buildServer({ db, provider: askHarness('DROP TABLE proteins') });
    const response = await app.inject({
      method: 'POST',
      url: '/ask',
      payload: { question: 'drop the proteins table' },
    });
    expect(response.statusCode).toBe(422);
    const body = response.json();
    expect(body.error).toBe('rejected_sql');
    expect(body.reason).toBe('not_a_select');
    expect(body.sql).toBe('DROP TABLE proteins');

    const still = await db.one<{ n: number }>('SELECT count(*) AS n FROM proteins');
    expect(still?.n).toBe(2);
    await app.close();
    await db.close();
  });

  it('rejects a query that reads a base table directly', async () => {
    const db = await seed();
    const app = await buildServer({ db, provider: askHarness('SELECT * FROM annotations') });
    const response = await app.inject({
      method: 'POST',
      url: '/ask',
      payload: { question: 'show me every annotation row' },
    });
    expect(response.statusCode).toBe(422);
    expect(response.json().reason).toBe('unknown_relation');
    await app.close();
    await db.close();
  });

  it('reports a query that is valid but does not execute', async () => {
    const db = await seed();
    const app = await buildServer({
      db,
      provider: askHarness('SELECT no_such_column FROM v_protein_overview'),
    });
    const response = await app.inject({
      method: 'POST',
      url: '/ask',
      payload: { question: 'something impossible' },
    });
    expect(response.statusCode).toBe(400);
    expect(response.json().error).toBe('query_failed');
    await app.close();
    await db.close();
  });

  it('validates the question', async () => {
    const { app, db } = await harness();
    expect(
      (await app.inject({ method: 'POST', url: '/ask', payload: { question: 'a' } })).statusCode,
    ).toBe(400);
    await app.close();
    await db.close();
  });
});

describe('POST /recall', () => {
  it('answers from retrieved passages and resolves citations', async () => {
    const db = await seed();
    const provider = stubProvider({
      chat: () => 'p53 has a candidate disordered region at residues 26-93 [P04637].',
    });
    for (const accession of ['P04637', 'P00918']) await embedAccession(db, provider, accession);

    const app = await buildServer({ db, provider });
    const response = await app.inject({
      method: 'POST',
      url: '/recall',
      payload: { question: 'candidate disordered regions in p53', minSimilarity: 0 },
    });
    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.grounded).toBe(true);
    expect(body.citations).toEqual(['P04637']);
    expect(body.passages.length).toBeGreaterThan(0);
    await app.close();
    await db.close();
  });

  it('declines to answer when nothing clears the similarity floor', async () => {
    const db = await seed();
    let called = false;
    const provider = stubProvider({
      chat: () => {
        called = true;
        return 'I should never be asked.';
      },
    });
    await embedAccession(db, provider, 'P04637');

    const app = await buildServer({ db, provider });
    const body = (
      await app.inject({
        method: 'POST',
        url: '/recall',
        payload: { question: 'what is the eurozone inflation rate', minSimilarity: 0.99 },
      })
    ).json();
    expect(body.grounded).toBe(false);
    expect(body.citations).toEqual([]);
    expect(called, 'the model must not be called with no evidence').toBe(false);
    await app.close();
    await db.close();
  });
});

describe('POST /annotate/:accession', () => {
  it('regenerates a card and re-embeds the entry', async () => {
    const db = await seed();
    const provider = stubProvider({ chat: () => JSON.stringify({ ...CARD, summary: 'A fresh summary of this human protein.' }) });
    const app = await buildServer({ db, provider });

    const response = await app.inject({ method: 'POST', url: '/annotate/P00918' });
    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.card.summary).toContain('fresh summary');
    expect(body.reembedded).toBe(true);

    const chunks = await db.one<{ n: number }>(
      'SELECT count(*) AS n FROM chunks WHERE accession = ?',
      ['P00918'],
    );
    expect(chunks?.n).toBeGreaterThan(0);
    await app.close();
    await db.close();
  });

  it('reports a model that will not produce a valid card', async () => {
    const db = await seed();
    const app = await buildServer({ db, provider: stubProvider({ chat: () => 'nope' }) });
    const response = await app.inject({ method: 'POST', url: '/annotate/P00918' });
    expect(response.statusCode).toBe(502);
    expect(response.json().error).toBe('annotation_failed');
    await app.close();
    await db.close();
  });

  it('404s an unknown accession', async () => {
    const { app, db } = await harness();
    expect((await app.inject({ method: 'POST', url: '/annotate/Q00000' })).statusCode).toBe(404);
    await app.close();
    await db.close();
  });
});

describe('object store integration', () => {
  it('serves a stored model file', async () => {
    const db = await seed();
    const store = localStore(
      `${process.env.TEMP ?? '.'}/afx-test-store-${Math.random().toString(36).slice(2)}`,
    );
    await store.put('AF-P04637-F1.cif', 'data_AF-P04637-F1\n#\n', 'chemical/x-mmcif');
    await db.exec("UPDATE proteins SET cif_object_key = 'AF-P04637-F1.cif' WHERE accession = 'P04637'");

    const app = await buildServer({ db, provider: stubProvider(), store });
    const response = await app.inject({ method: 'GET', url: '/proteins/P04637/structure' });
    expect(response.statusCode).toBe(200);
    expect(response.body).toContain('data_AF-P04637-F1');
    await app.close();
    await db.close();
  });
});

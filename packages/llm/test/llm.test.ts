import { describe, expect, it } from 'vitest';
import { extractSql } from '../src/prompts/nl2sql.ts';
import { extractCitations } from '../src/prompts/recall.ts';
import { annotationCardSchema, parseJsonObject } from '../src/schemas.ts';
import { hashEmbedding, stubProvider } from '../src/provider.ts';

describe('extractSql', () => {
  it('returns a bare statement unchanged', () => {
    expect(extractSql('SELECT * FROM v_protein_overview')).toBe('SELECT * FROM v_protein_overview');
  });

  it('unwraps markdown fences', () => {
    expect(extractSql('```sql\nSELECT 1\n```')).toBe('SELECT 1');
    expect(extractSql('```\nSELECT 1\n```')).toBe('SELECT 1');
  });

  it('drops a prose lead-in and the trailing semicolon', () => {
    expect(extractSql('Here is the query:\nSELECT gene FROM v_protein_overview;')).toBe(
      'SELECT gene FROM v_protein_overview',
    );
  });

  it('keeps CTEs intact', () => {
    const sql = 'WITH x AS (SELECT 1) SELECT * FROM x';
    expect(extractSql(`\`\`\`sql\n${sql};\n\`\`\``)).toBe(sql);
  });
});

describe('parseJsonObject', () => {
  it('parses plain JSON', () => {
    expect(parseJsonObject('{"a":1}')).toEqual({ a: 1 });
  });

  it('parses fenced JSON', () => {
    expect(parseJsonObject('```json\n{"a":1}\n```')).toEqual({ a: 1 });
  });

  it('recovers JSON wrapped in prose', () => {
    expect(parseJsonObject('Sure! {"a":1} Hope that helps.')).toEqual({ a: 1 });
  });

  it('throws when there is no object at all', () => {
    expect(() => parseJsonObject('no json here')).toThrow(/no JSON object/);
  });
});

describe('annotationCardSchema', () => {
  const valid = {
    summary: 'A predicted structure of a human protein of moderate length.',
    confidence_profile: 'Most residues are modelled with very high confidence above 90.',
    disordered_regions: 'None found.',
    caveats: 'Confidence is not a disorder measurement.',
    keywords: ['human', 'kinase'],
  };

  it('accepts a well-formed card', () => {
    expect(annotationCardSchema.parse(valid)).toEqual(valid);
  });

  it('rejects missing fields and empty keyword lists', () => {
    expect(() => annotationCardSchema.parse({ ...valid, keywords: [] })).toThrow();
    const { caveats: _dropped, ...withoutCaveats } = valid;
    expect(() => annotationCardSchema.parse(withoutCaveats)).toThrow();
  });

  it('rejects a runaway summary', () => {
    expect(() => annotationCardSchema.parse({ ...valid, summary: 'x'.repeat(1000) })).toThrow();
  });
});

describe('extractCitations', () => {
  const known = ['P04637', 'P10636'];

  it('keeps only known accessions, in first-mention order', () => {
    const answer = 'Tau [P10636] is disordered, as is p53 [P04637]. Unlike [Q99999].';
    expect(extractCitations(answer, known)).toEqual(['P10636', 'P04637']);
  });

  it('normalises AlphaFold entry ids to accessions', () => {
    expect(extractCitations('see [AF-P04637-F1]', known)).toEqual(['P04637']);
  });

  it('deduplicates', () => {
    expect(extractCitations('[P04637] and again [P04637]', known)).toEqual(['P04637']);
  });
});

describe('stub provider', () => {
  it('produces deterministic unit-length embeddings', async () => {
    const provider = stubProvider({}, 64);
    const [a] = await provider.embed(['alpha synuclein']);
    const [b] = await provider.embed(['alpha synuclein']);
    expect(a).toEqual(b);
    expect(a).toHaveLength(64);
    expect(Math.hypot(...a!)).toBeCloseTo(1, 6);
  });

  it('puts similar text closer than unrelated text', () => {
    const dot = (x: number[], y: number[]) => x.reduce((sum, v, i) => sum + v * y[i]!, 0);
    const base = hashEmbedding('disordered region in tau protein', 256);
    const near = hashEmbedding('disordered region in tau', 256);
    const far = hashEmbedding('carbonic anhydrase enzyme kinetics', 256);
    expect(dot(base, near)).toBeGreaterThan(dot(base, far));
  });
});

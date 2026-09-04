import type { Db } from '@afx/core';
import type { AnnotationCard, LlmProvider, RetrievedChunk } from '@afx/llm';
import { collectFacts } from './annotate.ts';

export interface ChunkDraft {
  chunkId: string;
  accession: string;
  source: 'annotation' | 'uniprot' | 'structure_summary';
  text: string;
}

/**
 * Builds the passages for one entry.
 *
 * Each chunk is written to stand on its own: retrieval returns a passage without its
 * neighbours, so every one repeats the protein's name and accession rather than
 * relying on context the reader will not have.
 */
export function buildChunks(
  accession: string,
  facts: {
    proteinName: string | null;
    gene: string | null;
    organism: string | null;
    sequenceLength: number;
    uniprotDescription: string | null;
    summary: {
      mean_plddt: number;
      pct_very_high: number;
      pct_confident: number;
      pct_low: number;
      pct_very_low: number;
      longest_low_run: number;
    };
    segments: { start_residue: number; end_residue: number; length: number; mean_plddt: number; terminal: string }[];
  },
  card: AnnotationCard | null,
): ChunkDraft[] {
  const label = `${facts.proteinName ?? accession} (${facts.gene ?? 'unknown gene'}, ${accession})`;
  const chunks: ChunkDraft[] = [];

  const s = facts.summary;
  const segmentText =
    facts.segments.length === 0
      ? 'It has no continuous run of 8 or more residues below pLDDT 70, so no candidate disordered regions were found.'
      : `Candidate disordered regions (continuous runs below pLDDT 70): ${facts.segments
          .map(
            (seg) =>
              `residues ${seg.start_residue}-${seg.end_residue} (${seg.length} aa, mean pLDDT ${seg.mean_plddt}, ${seg.terminal})`,
          )
          .join('; ')}.`;

  chunks.push({
    chunkId: `${accession}:structure`,
    accession,
    source: 'structure_summary',
    text:
      `${label} is a ${facts.sequenceLength}-residue protein from ${facts.organism ?? 'an unspecified organism'}. ` +
      `Its AlphaFold model has a mean pLDDT of ${s.mean_plddt}: ${s.pct_very_high}% of residues are very high confidence (>=90), ` +
      `${s.pct_confident}% confident (70-90), ${s.pct_low}% low (50-70) and ${s.pct_very_low}% very low (<50). ` +
      `The longest continuous stretch below pLDDT 70 is ${s.longest_low_run} residues. ${segmentText}`,
  });

  if (facts.uniprotDescription) {
    chunks.push({
      chunkId: `${accession}:uniprot`,
      accession,
      source: 'uniprot',
      text: `${label}: ${facts.uniprotDescription}.`,
    });
  }

  if (card) {
    chunks.push({
      chunkId: `${accession}:annotation`,
      accession,
      source: 'annotation',
      text:
        `${label}. ${card.summary} ${card.confidence_profile} ${card.disordered_regions} ` +
        `Caveats: ${card.caveats} Keywords: ${card.keywords.join(', ')}.`,
    });
  }

  return chunks;
}

export interface EmbedReport {
  accession: string;
  chunks: number;
}

/** Embeds and stores every chunk for one accession, replacing any previous ones. */
export async function embedAccession(
  db: Db,
  provider: LlmProvider,
  accession: string,
): Promise<EmbedReport> {
  const facts = await collectFacts(db, accession);
  const annotation = await db.one<{ status: string; card: string | null }>(
    'SELECT status, card FROM annotations WHERE accession = ?',
    [accession],
  );
  const card =
    annotation?.status === 'ok' && annotation.card
      ? (JSON.parse(annotation.card) as AnnotationCard)
      : null;

  const drafts = buildChunks(accession, facts, card);
  const vectors = await provider.embed(drafts.map((d) => d.text));

  await db.exec('DELETE FROM chunks WHERE accession = ?', [accession]);
  for (const [index, draft] of drafts.entries()) {
    const vector = vectors[index];
    if (!vector) throw new Error(`embedding provider returned no vector for ${draft.chunkId}`);
    await db.exec(
      `INSERT INTO chunks VALUES (?, ?, ?, ?, ?, ${vectorLiteral(vector)})`,
      [draft.chunkId, draft.accession, draft.source, draft.text, provider.embedModel],
    );
  }

  return { accession, chunks: drafts.length };
}

/**
 * Vectors go into SQL as a literal rather than a bound parameter: DuckDB's fixed-size
 * array type needs an explicit cast that a parameter placeholder cannot carry. The
 * values are finite numbers checked below, never text, so nothing is injectable.
 */
function vectorLiteral(vector: number[]): string {
  for (const value of vector) {
    if (!Number.isFinite(value)) throw new Error('embedding contained a non-finite value');
  }
  return `[${vector.join(',')}]::FLOAT[${vector.length}]`;
}

/** Builds the HNSW index used for similarity search. Safe to call repeatedly. */
export async function ensureVectorIndex(db: Db): Promise<void> {
  await db.exec('INSTALL vss');
  await db.exec('LOAD vss');
  await db.exec('SET hnsw_enable_experimental_persistence = true');
  await db.exec(
    "CREATE INDEX IF NOT EXISTS idx_chunks_hnsw ON chunks USING HNSW (embedding) WITH (metric = 'cosine')",
  );
}

export interface RetrieveOptions {
  topK?: number;
  /** Cosine similarity below which a passage is treated as irrelevant. */
  minSimilarity?: number;
}

/**
 * Retrieves the passages closest to `question`.
 *
 * The similarity floor matters: without it the model is always handed three passages,
 * however unrelated, and will dutifully answer an unanswerable question from them.
 */
export async function retrieveChunks(
  db: Db,
  provider: LlmProvider,
  question: string,
  options: RetrieveOptions = {},
): Promise<RetrievedChunk[]> {
  const topK = options.topK ?? 6;
  const minSimilarity = options.minSimilarity ?? 0.35;

  const [vector] = await provider.embed([question]);
  if (!vector) throw new Error('embedding provider returned no vector for the question');

  const rows = await db.all<{
    accession: string;
    source: string;
    text: string;
    similarity: number;
  }>(
    `SELECT accession, source, text,
            array_cosine_similarity(embedding, ${vectorLiteral(vector)}) AS similarity
       FROM chunks
      WHERE embedding IS NOT NULL
      ORDER BY similarity DESC
      LIMIT ?`,
    [topK],
  );

  return rows.filter((row) => row.similarity >= minSimilarity);
}

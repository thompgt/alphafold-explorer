import type { ConfidenceSummary, Db, Segment } from '@afx/core';
import {
  ANNOTATION_SYSTEM,
  annotationCardSchema,
  buildAnnotationPrompt,
  parseJsonObject,
  type AnnotationCard,
  type AnnotationFacts,
  type LlmProvider,
} from '@afx/llm';

export interface AnnotateReport {
  accession: string;
  outcome: 'annotated' | 'skipped' | 'failed';
  attempts?: number;
  error?: string;
}

export interface AnnotateOptions {
  db: Db;
  provider: LlmProvider;
  /** Re-annotate entries that already have a card. */
  force?: boolean;
  /** Attempts per entry before recording a failure. */
  attempts?: number;
}

/** Accessions still needing a card: never annotated, or annotated by a different model. */
export async function pendingAnnotations(
  db: Db,
  model: string,
  force = false,
): Promise<string[]> {
  const sql = force
    ? 'SELECT accession FROM proteins ORDER BY accession'
    : `SELECT p.accession
         FROM proteins p
         LEFT JOIN annotations a ON a.accession = p.accession
        WHERE a.accession IS NULL OR a.status <> 'ok' OR a.model <> ?
        ORDER BY p.accession`;
  const rows = await db.all<{ accession: string }>(sql, force ? [] : [model]);
  return rows.map((r) => r.accession);
}

/** Gathers everything the model is allowed to see about one entry. */
export async function collectFacts(db: Db, accession: string): Promise<AnnotationFacts> {
  const protein = await db.one<{
    accession: string;
    entry_id: string;
    protein_name: string | null;
    gene: string | null;
    organism: string | null;
    sequence_length: number;
    uniprot_description: string | null;
  }>(
    `SELECT accession, entry_id, protein_name, gene, organism, sequence_length, uniprot_description
       FROM proteins WHERE accession = ?`,
    [accession],
  );
  if (!protein) throw new Error(`${accession} is not in the database`);

  const summary = await db.one<ConfidenceSummary>(
    'SELECT * FROM confidence_summary WHERE accession = ?',
    [accession],
  );
  if (!summary) throw new Error(`${accession} has no confidence summary; re-run ingest`);

  const segments = await db.all<Segment>(
    'SELECT * FROM segments WHERE accession = ? ORDER BY start_residue',
    [accession],
  );

  return {
    accession: protein.accession,
    entryId: protein.entry_id,
    proteinName: protein.protein_name,
    gene: protein.gene,
    organism: protein.organism,
    sequenceLength: protein.sequence_length,
    uniprotDescription: protein.uniprot_description,
    summary,
    segments,
  };
}

/**
 * Asks the model for one annotation card and validates it.
 *
 * A small local model gets JSON wrong often enough that a retry is worth it, but not
 * so often that retrying forever helps — after `attempts` tries the failure is
 * recorded rather than papered over with a half-empty card.
 */
export async function annotateAccession(
  accession: string,
  options: AnnotateOptions,
): Promise<AnnotateReport> {
  const { db, provider, attempts = 2 } = options;

  let facts: AnnotationFacts;
  try {
    facts = await collectFacts(db, accession);
  } catch (error) {
    return { accession, outcome: 'failed', error: String(error) };
  }

  const prompt = buildAnnotationPrompt(facts);
  let lastError = 'unknown error';

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const raw = await provider.chat(prompt, {
        system: ANNOTATION_SYSTEM,
        json: true,
        // Nudge the temperature up on a retry; repeating a failed sample rarely helps.
        temperature: attempt === 1 ? 0.1 : 0.4,
      });
      const card = annotationCardSchema.parse(parseJsonObject(raw));
      await writeAnnotation(db, accession, provider.chatModel, card);
      return { accession, outcome: 'annotated', attempts: attempt };
    } catch (error) {
      lastError = String(error);
    }
  }

  await writeFailure(db, accession, provider.chatModel, lastError);
  return { accession, outcome: 'failed', attempts, error: lastError };
}

async function writeAnnotation(
  db: Db,
  accession: string,
  model: string,
  card: AnnotationCard,
): Promise<void> {
  await db.exec('DELETE FROM annotations WHERE accession = ?', [accession]);
  await db.exec("INSERT INTO annotations VALUES (?, ?, 'ok', ?, NULL, now())", [
    accession,
    model,
    JSON.stringify(card),
  ]);
}

async function writeFailure(
  db: Db,
  accession: string,
  model: string,
  error: string,
): Promise<void> {
  await db.exec('DELETE FROM annotations WHERE accession = ?', [accession]);
  await db.exec("INSERT INTO annotations VALUES (?, ?, 'failed', NULL, ?, now())", [
    accession,
    model,
    error.slice(0, 500),
  ]);
}

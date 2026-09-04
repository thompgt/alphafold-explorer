import type { Db } from '@afx/core';
import { AfdbClient, AfdbNotFoundError, type AfdbPrediction } from './afdbClient.ts';
import { parseCifPlddt } from './cifPlddt.ts';
import { findLowConfidenceSegments, summariseConfidence } from './features.ts';
import type { ObjectStore } from './objectStore.ts';

export type IngestOutcome = 'ingested' | 'skipped' | 'not_found' | 'failed';

export interface IngestReport {
  accession: string;
  outcome: IngestOutcome;
  residues?: number;
  segments?: number;
  warning?: string;
  error?: string;
}

export interface IngestOptions {
  db: Db;
  client: AfdbClient;
  store?: ObjectStore;
  /** Re-ingest accessions already present in the database. */
  force?: boolean;
}

/**
 * Ingests one accession end to end: metadata, model file, per-residue pLDDT,
 * confidence rollup and candidate disordered segments. Idempotent — re-running
 * replaces that accession's derived rows rather than duplicating them.
 */
export async function ingestAccession(
  accession: string,
  options: IngestOptions,
): Promise<IngestReport> {
  const { db, client, store, force = false } = options;

  if (!force) {
    const existing = await db.one<{ n: number }>(
      'SELECT count(*) AS n FROM proteins WHERE accession = ?',
      [accession],
    );
    if ((existing?.n ?? 0) > 0) return { accession, outcome: 'skipped' };
  }

  let prediction: AfdbPrediction;
  try {
    prediction = await client.getPrediction(accession);
  } catch (error) {
    if (error instanceof AfdbNotFoundError) return { accession, outcome: 'not_found' };
    return { accession, outcome: 'failed', error: String(error) };
  }

  try {
    const cif = await client.getStructure(prediction);
    const { residues } = parseCifPlddt(cif);
    if (residues.length === 0) {
      return { accession, outcome: 'failed', error: 'no residues parsed from mmCIF' };
    }

    const summary = summariseConfidence(accession, residues);
    const segments = findLowConfidenceSegments(accession, residues);

    // AFDB publishes its own mean pLDDT; a mismatch means we misread the file.
    let warning: string | undefined;
    if (prediction.globalMetricValue !== undefined) {
      const delta = Math.abs(prediction.globalMetricValue - summary.mean_plddt);
      if (delta > 1) {
        warning =
          `mean pLDDT ${summary.mean_plddt} differs from AFDB globalMetricValue ` +
          `${prediction.globalMetricValue} by ${delta.toFixed(2)}`;
      }
    }

    let objectKey: string | null = null;
    if (store) {
      objectKey = `${prediction.entryId}.cif`;
      await store.put(objectKey, cif, 'chemical/x-mmcif');
    }

    await writeProtein(db, accession, prediction, residues.length, objectKey);
    await writeResidues(db, accession, residues);
    await writeSummary(db, summary);
    await writeSegments(db, accession, segments);

    return {
      accession,
      outcome: 'ingested',
      residues: residues.length,
      segments: segments.length,
      ...(warning ? { warning } : {}),
    };
  } catch (error) {
    return { accession, outcome: 'failed', error: String(error) };
  }
}

async function writeProtein(
  db: Db,
  accession: string,
  p: AfdbPrediction,
  residueCount: number,
  objectKey: string | null,
): Promise<void> {
  await db.exec('DELETE FROM proteins WHERE accession = ?', [accession]);
  await db.exec(
    `INSERT INTO proteins (
       accession, entry_id, protein_name, gene, organism, taxon_id,
       sequence_length, sequence, uniprot_description, model_version,
       cif_url, cif_object_key, ingested_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, now())`,
    [
      accession,
      p.entryId,
      p.uniprotDescription ?? null,
      p.gene ?? null,
      p.organismScientificName ?? null,
      p.taxId ?? null,
      p.uniprotSequence?.length ?? residueCount,
      p.uniprotSequence ?? null,
      p.uniprotDescription ?? null,
      p.latestVersion ?? null,
      p.cifUrl,
      objectKey,
    ],
  );
}

async function writeResidues(
  db: Db,
  accession: string,
  residues: { residueIndex: number; aminoAcid: string; plddt: number }[],
): Promise<void> {
  await db.exec('DELETE FROM residues WHERE accession = ?', [accession]);
  if (residues.length === 0) return;
  // Batched multi-row INSERTs: a round trip per residue costs orders of magnitude more
  // on a long chain. Still fully parameterised — no values are interpolated into SQL.
  const BATCH = 500;
  for (let offset = 0; offset < residues.length; offset += BATCH) {
    const batch = residues.slice(offset, offset + BATCH);
    const placeholders = batch.map(() => '(?, ?, ?, ?)').join(', ');
    const params = batch.flatMap((r) => [accession, r.residueIndex, r.aminoAcid, r.plddt]);
    await db.exec(`INSERT INTO residues VALUES ${placeholders}`, params);
  }
}

async function writeSummary(
  db: Db,
  s: Awaited<ReturnType<typeof summariseConfidence>>,
): Promise<void> {
  await db.exec('DELETE FROM confidence_summary WHERE accession = ?', [s.accession]);
  await db.exec('INSERT INTO confidence_summary VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)', [
    s.accession,
    s.mean_plddt,
    s.median_plddt,
    s.min_plddt,
    s.max_plddt,
    s.pct_very_high,
    s.pct_confident,
    s.pct_low,
    s.pct_very_low,
    s.longest_low_run,
  ]);
}

async function writeSegments(
  db: Db,
  accession: string,
  segments: ReturnType<typeof findLowConfidenceSegments>,
): Promise<void> {
  await db.exec('DELETE FROM segments WHERE accession = ?', [accession]);
  for (const s of segments) {
    await db.exec('INSERT INTO segments VALUES (?, ?, ?, ?, ?, ?, ?)', [
      s.segment_id,
      s.accession,
      s.start_residue,
      s.end_residue,
      s.length,
      s.mean_plddt,
      s.terminal,
    ]);
  }
}

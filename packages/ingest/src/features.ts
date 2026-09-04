import { PLDDT_BANDS } from '@afx/core';
import type { ConfidenceSummary, Segment, Terminal } from '@afx/core';
import type { ParsedResidue } from './cifPlddt.ts';

/** A run shorter than this is noise, not a candidate disordered region. */
export const MIN_SEGMENT_LENGTH = 8;

export function summariseConfidence(
  accession: string,
  residues: ParsedResidue[],
): ConfidenceSummary {
  if (residues.length === 0) {
    throw new Error(`cannot summarise ${accession}: no residues parsed`);
  }
  const values = residues.map((r) => r.plddt);
  const sorted = [...values].sort((a, b) => a - b);
  const n = values.length;

  const count = (predicate: (v: number) => boolean) => values.filter(predicate).length;
  const pct = (c: number) => round2((c / n) * 100);

  return {
    accession,
    mean_plddt: round2(values.reduce((a, b) => a + b, 0) / n),
    median_plddt: round2(median(sorted)),
    min_plddt: sorted[0]!,
    max_plddt: sorted[n - 1]!,
    pct_very_high: pct(count((v) => v >= PLDDT_BANDS.veryHigh)),
    pct_confident: pct(count((v) => v >= PLDDT_BANDS.confident && v < PLDDT_BANDS.veryHigh)),
    pct_low: pct(count((v) => v >= PLDDT_BANDS.low && v < PLDDT_BANDS.confident)),
    pct_very_low: pct(count((v) => v < PLDDT_BANDS.low)),
    longest_low_run: longestRun(residues, (r) => r.plddt < PLDDT_BANDS.confident),
  };
}

/**
 * Contiguous runs of residues below the "confident" band (pLDDT < 70). These are
 * candidate intrinsically disordered regions — AlphaFold's own guidance is that very
 * low pLDDT is a *predictor* of disorder, not a measurement of it, so callers must
 * present them as candidates.
 */
export function findLowConfidenceSegments(
  accession: string,
  residues: ParsedResidue[],
  minLength = MIN_SEGMENT_LENGTH,
): Segment[] {
  const sorted = [...residues].sort((a, b) => a.residueIndex - b.residueIndex);
  const last = sorted.at(-1)?.residueIndex ?? 0;
  const segments: Segment[] = [];

  let run: ParsedResidue[] = [];
  const flush = () => {
    if (run.length >= minLength) {
      const start = run[0]!.residueIndex;
      const end = run.at(-1)!.residueIndex;
      segments.push({
        segment_id: `${accession}:${start}-${end}`,
        accession,
        start_residue: start,
        end_residue: end,
        length: run.length,
        mean_plddt: round2(run.reduce((a, r) => a + r.plddt, 0) / run.length),
        terminal: classifyTerminal(start, end, last),
      });
    }
    run = [];
  };

  let previousIndex: number | null = null;
  for (const residue of sorted) {
    const isLow = residue.plddt < PLDDT_BANDS.confident;
    const contiguous = previousIndex === null || residue.residueIndex === previousIndex + 1;
    if (!isLow || !contiguous) flush();
    if (isLow) run.push(residue);
    previousIndex = residue.residueIndex;
  }
  flush();

  return segments;
}

function classifyTerminal(start: number, end: number, lastIndex: number): Terminal {
  const atN = start === 1;
  const atC = end === lastIndex;
  if (atN && atC) return 'both';
  if (atN) return 'N';
  if (atC) return 'C';
  return 'internal';
}

function longestRun(residues: ParsedResidue[], predicate: (r: ParsedResidue) => boolean): number {
  const sorted = [...residues].sort((a, b) => a.residueIndex - b.residueIndex);
  let best = 0;
  let current = 0;
  let previousIndex: number | null = null;
  for (const residue of sorted) {
    const contiguous = previousIndex === null || residue.residueIndex === previousIndex + 1;
    current = predicate(residue) && contiguous ? current + 1 : predicate(residue) ? 1 : 0;
    if (current > best) best = current;
    previousIndex = residue.residueIndex;
  }
  return best;
}

function median(sorted: number[]): number {
  const n = sorted.length;
  const mid = Math.floor(n / 2);
  return n % 2 === 0 ? (sorted[mid - 1]! + sorted[mid]!) / 2 : sorted[mid]!;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

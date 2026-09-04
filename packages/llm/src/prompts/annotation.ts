import type { ConfidenceSummary, Segment } from '@afx/core';

export interface AnnotationFacts {
  accession: string;
  entryId: string;
  proteinName: string | null;
  gene: string | null;
  organism: string | null;
  sequenceLength: number;
  uniprotDescription: string | null;
  summary: ConfidenceSummary;
  segments: Segment[];
}

export const ANNOTATION_SYSTEM = `You are a structural biology annotator writing short factual cards about AlphaFold predicted structures.

Rules you must follow:
- Use ONLY the facts given to you. Do not add function, disease, pathway or interaction claims that are not in the supplied text.
- pLDDT is AlphaFold's per-residue CONFIDENCE score, not a measurement of disorder. Low pLDDT regions are CANDIDATE disordered regions. Always phrase them that way.
- If a fact is not supplied, say it is not available rather than guessing.
- Be concise. Two or three sentences per field.
- Reply with a single JSON object and nothing else.`;

export function buildAnnotationPrompt(facts: AnnotationFacts): string {
  const s = facts.summary;
  const segmentLines =
    facts.segments.length === 0
      ? '  (none: no run of 8+ residues below pLDDT 70)'
      : facts.segments
          .map(
            (seg) =>
              `  - residues ${seg.start_residue}-${seg.end_residue} ` +
              `(${seg.length} aa, mean pLDDT ${seg.mean_plddt}, ${describeTerminal(seg.terminal)})`,
          )
          .join('\n');

  return `Facts about one AlphaFold entry:

  UniProt accession: ${facts.accession}
  AlphaFold entry:   ${facts.entryId}
  Protein name:      ${facts.proteinName ?? 'not available'}
  Gene:              ${facts.gene ?? 'not available'}
  Organism:          ${facts.organism ?? 'not available'}
  Length:            ${facts.sequenceLength} residues
  Description:       ${facts.uniprotDescription ?? 'not available'}

Confidence (AlphaFold pLDDT bands):
  mean ${s.mean_plddt}, median ${s.median_plddt}, range ${s.min_plddt}-${s.max_plddt}
  very high (>=90): ${s.pct_very_high}%
  confident (70-90): ${s.pct_confident}%
  low (50-70): ${s.pct_low}%
  very low (<50): ${s.pct_very_low}%
  longest continuous run below 70: ${s.longest_low_run} residues

Candidate disordered regions (continuous runs below pLDDT 70):
${segmentLines}

Return JSON with exactly these keys:
{
  "summary": "what this entry is, in one or two sentences",
  "confidence_profile": "how well AlphaFold modelled this chain overall, referencing the band percentages",
  "disordered_regions": "which regions are candidates for disorder and where they sit, or that there are none",
  "caveats": "what a reader should not conclude from this prediction",
  "keywords": ["3 to 8 short tags"]
}`;
}

function describeTerminal(terminal: string): string {
  switch (terminal) {
    case 'N':
      return 'at the N-terminus';
    case 'C':
      return 'at the C-terminus';
    case 'both':
      return 'spanning the whole chain';
    default:
      return 'internal';
  }
}

export interface RetrievedChunk {
  accession: string;
  source: string;
  text: string;
  similarity: number;
}

export const RECALL_SYSTEM = `You answer questions about AlphaFold predicted structures using ONLY the numbered passages supplied to you.

Rules:
- Every claim must come from a passage. If the passages do not answer the question, say so plainly.
- Cite the source of each claim with its UniProt accession in square brackets, like [P04637].
- Do not add function, disease or interaction claims that are not in the passages.
- pLDDT is AlphaFold's confidence score, not a measurement of disorder.
- Three or four sentences. No markdown, no bullet lists.`;

export function buildRecallPrompt(question: string, chunks: RetrievedChunk[]): string {
  const passages = chunks
    .map(
      (chunk, index) =>
        `[${index + 1}] (${chunk.accession}, ${chunk.source}, similarity ${chunk.similarity.toFixed(3)})\n${chunk.text}`,
    )
    .join('\n\n');

  return `Passages:

${passages}

Question: ${question}

Answer, citing accessions in square brackets:`;
}

/** Pulls the accessions a model actually cited, keeping first-mention order. */
export function extractCitations(answer: string, known: Iterable<string>): string[] {
  const valid = new Set(known);
  const cited: string[] = [];
  for (const match of answer.matchAll(/\[([A-Z0-9\-]+)\]/g)) {
    const accession = match[1]!.replace(/^AF-/, '').replace(/-F\d+$/, '');
    if (valid.has(accession) && !cited.includes(accession)) cited.push(accession);
  }
  return cited;
}

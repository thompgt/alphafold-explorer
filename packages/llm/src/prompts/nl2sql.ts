/**
 * The schema description handed to the model. It documents ONLY the three views —
 * the SQL guard rejects anything referencing the base tables, so showing them
 * would just invite rejected queries.
 */
export const SCHEMA_DOC = `-- One row per AlphaFold entry, with its confidence rollup.
v_protein_overview(
  accession VARCHAR,            -- UniProt accession, e.g. 'P04637'
  entry_id VARCHAR,             -- AlphaFold entry, e.g. 'AF-P04637-F1'
  protein_name VARCHAR,
  gene VARCHAR,                 -- gene symbol, e.g. 'TP53'
  organism VARCHAR,             -- e.g. 'Homo sapiens'
  sequence_length INTEGER,
  uniprot_description VARCHAR,
  mean_plddt DOUBLE,            -- 0-100, higher means more confident
  median_plddt DOUBLE,
  pct_very_high DOUBLE,         -- % of residues with pLDDT >= 90
  pct_confident DOUBLE,         -- % with 70 <= pLDDT < 90
  pct_low DOUBLE,               -- % with 50 <= pLDDT < 70
  pct_very_low DOUBLE,          -- % with pLDDT < 50
  pct_below_confident DOUBLE,   -- pct_low + pct_very_low
  longest_low_run INTEGER,      -- longest continuous run of residues below pLDDT 70
  annotation_status VARCHAR,
  annotation_summary VARCHAR
)

-- One row per continuous run of 8+ residues below pLDDT 70 (candidate disordered region).
v_low_confidence_segments(
  accession VARCHAR, protein_name VARCHAR, gene VARCHAR, organism VARCHAR,
  start_residue INTEGER, end_residue INTEGER, length INTEGER,
  mean_plddt DOUBLE,
  terminal VARCHAR,             -- 'N', 'C', 'both' or 'internal'
  sequence_length INTEGER
)

-- One row per residue.
v_residue_confidence(
  accession VARCHAR, gene VARCHAR, residue_index INTEGER, amino_acid VARCHAR,
  plddt DOUBLE,
  confidence_band VARCHAR       -- 'very_high' | 'confident' | 'low' | 'very_low'
)`;

export const NL2SQL_SYSTEM = `You translate questions about AlphaFold protein structure predictions into a single DuckDB SELECT statement.

Rules:
- Output ONLY the SQL. No prose, no explanation, no markdown fences.
- Exactly one statement. It must start with SELECT or WITH.
- Query only the views listed in the schema. Never reference any other table.
- Never write INSERT, UPDATE, DELETE, CREATE, DROP, ATTACH, COPY, INSTALL or LOAD.
- Never call file-reading functions such as read_csv, read_parquet or read_json.
- Always include an ORDER BY when the question implies ranking, and a LIMIT of at most 50.
- pLDDT is a confidence score from 0 to 100. "Low confidence" means below 70; "very low" means below 50; "well modelled" or "high confidence" means 90 or above.`;

export function buildNl2SqlPrompt(question: string): string {
  return `Schema:

${SCHEMA_DOC}

Question: ${question}

SQL:`;
}

/** Strips markdown fences, stray prose and trailing semicolons from a model's SQL. */
export function extractSql(raw: string): string {
  let text = raw.trim();

  const fenced = /```(?:sql)?\s*([\s\S]*?)\s*```/i.exec(text);
  if (fenced) text = fenced[1]!.trim();

  // Drop any lead-in the model added before the statement.
  const start = text.search(/\b(select|with)\b/i);
  if (start > 0) text = text.slice(start);

  return text.replace(/;\s*$/, '').trim();
}

export const ANSWER_SYSTEM = `You summarise the result of a database query about AlphaFold protein structures.

Rules:
- Describe only what the rows show. Never invent values or add biology that is not in the rows.
- Two or three sentences. No bullet lists, no markdown.
- If the result is empty, say plainly that nothing matched.
- Remember that pLDDT is AlphaFold's confidence, not a measurement of disorder.`;

export function buildAnswerPrompt(question: string, sql: string, rows: unknown[]): string {
  const shown = rows.slice(0, 25);
  return `Question: ${question}

SQL that was run:
${sql}

Rows returned (${rows.length} total${rows.length > shown.length ? `, first ${shown.length} shown` : ''}):
${JSON.stringify(shown, null, 1)}

Write the summary:`;
}

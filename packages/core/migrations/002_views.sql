-- Views are the ONLY surface the natural-language-to-SQL feature is allowed to query.
-- Keeping them denormalised and plainly named keeps generated SQL simple and the
-- allowlist in sqlGuard.ts small.

CREATE OR REPLACE VIEW v_protein_overview AS
SELECT
  p.accession,
  p.entry_id,
  p.protein_name,
  p.gene,
  p.organism,
  p.sequence_length,
  p.uniprot_description,
  c.mean_plddt,
  c.median_plddt,
  c.pct_very_high,
  c.pct_confident,
  c.pct_low,
  c.pct_very_low,
  c.pct_low + c.pct_very_low AS pct_below_confident,
  c.longest_low_run,
  a.status              AS annotation_status,
  json_extract_string(a.card, '$.summary') AS annotation_summary
FROM proteins p
LEFT JOIN confidence_summary c USING (accession)
LEFT JOIN annotations a        USING (accession);

CREATE OR REPLACE VIEW v_low_confidence_segments AS
SELECT
  s.accession,
  p.protein_name,
  p.gene,
  p.organism,
  s.start_residue,
  s.end_residue,
  s.length,
  s.mean_plddt,
  s.terminal,
  p.sequence_length
FROM segments s
JOIN proteins p USING (accession);

CREATE OR REPLACE VIEW v_residue_confidence AS
SELECT
  r.accession,
  p.gene,
  r.residue_index,
  r.amino_acid,
  r.plddt,
  CASE
    WHEN r.plddt >= 90 THEN 'very_high'
    WHEN r.plddt >= 70 THEN 'confident'
    WHEN r.plddt >= 50 THEN 'low'
    ELSE 'very_low'
  END AS confidence_band
FROM residues r
JOIN proteins p USING (accession);

-- Core AlphaFold entities.

CREATE TABLE IF NOT EXISTS proteins (
  accession           VARCHAR PRIMARY KEY,
  entry_id            VARCHAR NOT NULL,          -- e.g. AF-P69905-F1
  protein_name        VARCHAR,
  gene                VARCHAR,
  organism            VARCHAR,
  taxon_id            INTEGER,
  sequence_length     INTEGER NOT NULL,
  sequence            VARCHAR,
  uniprot_description VARCHAR,
  model_version       INTEGER,                   -- AFDB latestVersion at ingest time
  cif_url             VARCHAR NOT NULL,
  cif_object_key      VARCHAR,                   -- key in the object store, NULL if store disabled
  ingested_at         TIMESTAMP NOT NULL
);

-- Per-residue pLDDT, taken from the CA atom's B_iso_or_equiv column of the mmCIF.
CREATE TABLE IF NOT EXISTS residues (
  accession     VARCHAR NOT NULL,
  residue_index INTEGER NOT NULL,                -- 1-based, matches label_seq_id
  amino_acid    VARCHAR NOT NULL,                -- one-letter code
  plddt         DOUBLE  NOT NULL,
  PRIMARY KEY (accession, residue_index)
);

-- Whole-chain confidence rollup. Bands are AlphaFold's own:
-- very high >=90, confident 70-90, low 50-70, very low <50.
CREATE TABLE IF NOT EXISTS confidence_summary (
  accession        VARCHAR PRIMARY KEY,
  mean_plddt       DOUBLE NOT NULL,
  median_plddt     DOUBLE NOT NULL,
  min_plddt        DOUBLE NOT NULL,
  max_plddt        DOUBLE NOT NULL,
  pct_very_high    DOUBLE NOT NULL,
  pct_confident    DOUBLE NOT NULL,
  pct_low          DOUBLE NOT NULL,
  pct_very_low     DOUBLE NOT NULL,
  longest_low_run  INTEGER NOT NULL
);

-- Contiguous runs of low-confidence residues (candidate disordered regions).
CREATE TABLE IF NOT EXISTS segments (
  segment_id    VARCHAR PRIMARY KEY,
  accession     VARCHAR NOT NULL,
  start_residue INTEGER NOT NULL,
  end_residue   INTEGER NOT NULL,
  length        INTEGER NOT NULL,
  mean_plddt    DOUBLE  NOT NULL,
  terminal      VARCHAR NOT NULL                 -- 'N', 'C', 'both' or 'internal'
);

-- LLM-written annotation cards. One current row per accession.
CREATE TABLE IF NOT EXISTS annotations (
  accession    VARCHAR PRIMARY KEY,
  model        VARCHAR NOT NULL,
  status       VARCHAR NOT NULL,                 -- 'ok' | 'failed'
  card         JSON,
  error        VARCHAR,
  generated_at TIMESTAMP NOT NULL
);

-- Embedded text chunks for retrieval.
CREATE TABLE IF NOT EXISTS chunks (
  chunk_id   VARCHAR PRIMARY KEY,
  accession  VARCHAR NOT NULL,
  source     VARCHAR NOT NULL,                   -- 'annotation' | 'uniprot' | 'structure_summary'
  text       VARCHAR NOT NULL,
  model      VARCHAR NOT NULL,
  embedding  FLOAT[768]
);

CREATE INDEX IF NOT EXISTS idx_residues_accession ON residues(accession);
CREATE INDEX IF NOT EXISTS idx_segments_accession ON segments(accession);
CREATE INDEX IF NOT EXISTS idx_chunks_accession  ON chunks(accession);

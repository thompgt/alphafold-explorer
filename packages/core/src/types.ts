export interface Protein {
  accession: string;
  entry_id: string;
  protein_name: string | null;
  gene: string | null;
  organism: string | null;
  taxon_id: number | null;
  sequence_length: number;
  sequence: string | null;
  uniprot_description: string | null;
  model_version: number | null;
  cif_url: string;
  cif_object_key: string | null;
  ingested_at: string;
}

export interface ConfidenceSummary {
  accession: string;
  mean_plddt: number;
  median_plddt: number;
  min_plddt: number;
  max_plddt: number;
  pct_very_high: number;
  pct_confident: number;
  pct_low: number;
  pct_very_low: number;
  longest_low_run: number;
}

export type Terminal = 'N' | 'C' | 'both' | 'internal';

export interface Segment {
  segment_id: string;
  accession: string;
  start_residue: number;
  end_residue: number;
  length: number;
  mean_plddt: number;
  terminal: Terminal;
}

export interface Residue {
  residue_index: number;
  amino_acid: string;
  plddt: number;
}

/** The structured card the annotation worker asks the model to produce. */
export interface AnnotationCard {
  summary: string;
  confidence_profile: string;
  disordered_regions: string;
  caveats: string;
  keywords: string[];
}

export interface Annotation {
  accession: string;
  model: string;
  status: 'ok' | 'failed';
  card: AnnotationCard | null;
  error: string | null;
  generated_at: string;
}

export type ChunkSource = 'annotation' | 'uniprot' | 'structure_summary';

export interface Chunk {
  chunk_id: string;
  accession: string;
  source: ChunkSource;
  text: string;
  model: string;
}

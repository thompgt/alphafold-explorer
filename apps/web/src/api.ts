/** Typed wrapper around the API. Everything goes through /api, proxied by Vite. */

export interface ProteinRow {
  accession: string;
  entry_id: string;
  protein_name: string | null;
  gene: string | null;
  organism: string | null;
  sequence_length: number;
  mean_plddt: number | null;
  pct_very_high: number | null;
  pct_confident: number | null;
  pct_low: number | null;
  pct_very_low: number | null;
  longest_low_run: number | null;
  annotation_status: string | null;
}

export interface Segment {
  segment_id: string;
  accession: string;
  start_residue: number;
  end_residue: number;
  length: number;
  mean_plddt: number;
  terminal: 'N' | 'C' | 'both' | 'internal';
}

export interface AnnotationCard {
  summary: string;
  confidence_profile: string;
  disordered_regions: string;
  caveats: string;
  keywords: string[];
}

export interface ProteinDetail {
  protein: ProteinRow & {
    sequence: string | null;
    uniprot_description: string | null;
    model_version: number | null;
    cif_url: string;
    median_plddt: number | null;
    min_plddt: number | null;
    max_plddt: number | null;
  };
  segments: Segment[];
  annotation: {
    status: string;
    model: string;
    generated_at: string;
    error: string | null;
    card: AnnotationCard | null;
  } | null;
}

export interface Residue {
  residue_index: number;
  amino_acid: string;
  plddt: number;
}

export interface AskResponse {
  question: string;
  sql: string;
  executedSql: string;
  relations: string[];
  limitApplied: boolean;
  rowCount: number;
  rows: Record<string, unknown>[];
  summary: string | null;
}

export interface RecallResponse {
  question: string;
  answer: string;
  citations: string[];
  passages: { accession: string; source: string; similarity: number; text: string }[];
  grounded: boolean;
}

export interface HealthResponse {
  ok: boolean;
  database: { ok: boolean; detail: string };
  model: { ok: boolean; detail: string; chatModel: string; embedModel: string };
  objectStore: string;
}

/** Errors carry the API's own message, which is usually the useful part. */
export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly body: Record<string, unknown>,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`/api${path}`, {
    ...init,
    headers: { 'content-type': 'application/json', ...(init?.headers ?? {}) },
  });
  const text = await response.text();
  const body = text ? (JSON.parse(text) as Record<string, unknown>) : {};
  if (!response.ok) {
    throw new ApiError(
      typeof body.message === 'string' ? body.message : `request failed (${response.status})`,
      response.status,
      body,
    );
  }
  return body as T;
}

export const api = {
  health: () => request<HealthResponse>('/health'),

  listProteins: (params: { q?: string; sort?: string; order?: string; limit?: number }) => {
    const search = new URLSearchParams();
    if (params.q) search.set('q', params.q);
    if (params.sort) search.set('sort', params.sort);
    if (params.order) search.set('order', params.order);
    search.set('limit', String(params.limit ?? 200));
    return request<{ total: number; proteins: ProteinRow[] }>(`/proteins?${search.toString()}`);
  },

  getProtein: (accession: string) => request<ProteinDetail>(`/proteins/${accession}`),

  getResidues: (accession: string) =>
    request<{ accession: string; residues: Residue[] }>(`/proteins/${accession}/residues`),

  structureUrl: (accession: string) => `/api/proteins/${accession}/structure`,

  ask: (question: string) =>
    request<AskResponse>('/ask', { method: 'POST', body: JSON.stringify({ question }) }),

  recall: (question: string) =>
    request<RecallResponse>('/recall', { method: 'POST', body: JSON.stringify({ question }) }),

  reannotate: (accession: string) =>
    request<{ accession: string; card: AnnotationCard }>(`/annotate/${accession}`, {
      method: 'POST',
    }),
};

/** AlphaFold's own confidence bands and colours, reused everywhere in the UI. */
export const BANDS = [
  { key: 'very_high', label: 'Very high (>=90)', min: 90, colour: '#0053d6' },
  { key: 'confident', label: 'Confident (70-90)', min: 70, colour: '#65cbf3' },
  { key: 'low', label: 'Low (50-70)', min: 50, colour: '#ffdb13' },
  { key: 'very_low', label: 'Very low (<50)', min: 0, colour: '#ff7d45' },
] as const;

export function bandColour(plddt: number): string {
  return BANDS.find((band) => plddt >= band.min)?.colour ?? BANDS[3].colour;
}

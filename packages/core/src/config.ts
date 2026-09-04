import path from 'node:path';

function env(name: string, fallback: string): string {
  const v = process.env[name];
  return v === undefined || v === '' ? fallback : v;
}

function envInt(name: string, fallback: number): number {
  const v = process.env[name];
  if (v === undefined || v === '') return fallback;
  const n = Number.parseInt(v, 10);
  if (!Number.isFinite(n)) throw new Error(`${name} must be an integer, got ${JSON.stringify(v)}`);
  return n;
}

/**
 * Resolved once at import time. Everything is overridable by environment so the
 * same code runs on the host, in Docker, and in tests.
 */
export const config = {
  dbPath: path.resolve(env('AFX_DB_PATH', './data/afdb.duckdb')),
  cacheDir: path.resolve(env('AFX_CACHE_DIR', './data/cache')),

  ollamaHost: env('OLLAMA_HOST', 'http://127.0.0.1:11434'),
  chatModel: env('AFX_CHAT_MODEL', 'llama3.1:8b'),
  embedModel: env('AFX_EMBED_MODEL', 'nomic-embed-text'),
  embedDim: envInt('AFX_EMBED_DIM', 768),

  s3Endpoint: env('AFX_S3_ENDPOINT', 'http://127.0.0.1:9000'),
  s3Bucket: env('AFX_S3_BUCKET', 'afx-structures'),
  s3AccessKey: env('AFX_S3_ACCESS_KEY', 'afxadmin'),
  s3SecretKey: env('AFX_S3_SECRET_KEY', 'afxadmin123'),
  s3Enabled: env('AFX_S3_ENABLED', 'true') !== 'false',

  apiPort: envInt('AFX_API_PORT', 3000),
  afdbApiBase: env('AFX_AFDB_API', 'https://alphafold.ebi.ac.uk/api'),
} as const;

/** pLDDT band thresholds, as defined by AlphaFold DB itself. */
export const PLDDT_BANDS = {
  veryHigh: 90,
  confident: 70,
  low: 50,
} as const;

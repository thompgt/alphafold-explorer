import fs from 'node:fs';
import path from 'node:path';
import { config } from '@afx/core';

/** The subset of the AlphaFold DB prediction payload this project relies on. */
export interface AfdbPrediction {
  entryId: string;
  uniprotAccession: string;
  uniprotDescription?: string;
  gene?: string;
  organismScientificName?: string;
  taxId?: number;
  uniprotSequence?: string;
  uniprotStart?: number;
  uniprotEnd?: number;
  latestVersion?: number;
  cifUrl: string;
  pdbUrl?: string;
  /** Mean pLDDT as reported by AFDB — used to sanity-check our own parse. */
  globalMetricValue?: number;
  fractionPlddtVeryLow?: number;
  fractionPlddtLow?: number;
  fractionPlddtConfident?: number;
  fractionPlddtVeryHigh?: number;
}

/**
 * EBI rejects requests that arrive without a User-Agent with a bare 403 — Node's
 * fetch sends none by default, so this header is required, not cosmetic.
 */
const REQUEST_HEADERS = {
  'user-agent': 'alphafold-explorer/0.1 (https://github.com/thompgt/alphafold-explorer)',
  accept: 'application/json, text/plain, */*',
} as const;

export class AfdbNotFoundError extends Error {
  constructor(public readonly accession: string) {
    super(`AlphaFold DB has no prediction for ${accession}`);
    this.name = 'AfdbNotFoundError';
  }
}

export interface AfdbClientOptions {
  /** Directory for cached responses. Set to null to disable caching. */
  cacheDir?: string | null;
  /** Max attempts per request, including the first. */
  attempts?: number;
  fetchImpl?: typeof fetch;
}

/**
 * Thin AlphaFold DB client with an on-disk cache and bounded retries.
 *
 * The cache matters more than it looks: re-running ingest during development
 * otherwise hammers a public EBI service for bytes we already have.
 */
export class AfdbClient {
  private readonly cacheDir: string | null;
  private readonly attempts: number;
  private readonly fetchImpl: typeof fetch;

  constructor(options: AfdbClientOptions = {}) {
    this.cacheDir = options.cacheDir === undefined ? config.cacheDir : options.cacheDir;
    this.attempts = options.attempts ?? 4;
    this.fetchImpl = options.fetchImpl ?? fetch;
    if (this.cacheDir) fs.mkdirSync(this.cacheDir, { recursive: true });
  }

  async getPrediction(accession: string): Promise<AfdbPrediction> {
    const url = `${config.afdbApiBase}/prediction/${encodeURIComponent(accession)}`;
    const body = await this.getText(url, `${accession}.json`, accession);
    const parsed: unknown = JSON.parse(body);
    if (!Array.isArray(parsed) || parsed.length === 0) throw new AfdbNotFoundError(accession);

    // AFDB returns one entry per fragment; monomers under 2700 residues have exactly one.
    const entry = parsed[0] as AfdbPrediction;
    if (!entry.cifUrl || !entry.entryId) {
      throw new Error(`unexpected AFDB payload for ${accession}: missing cifUrl/entryId`);
    }
    return entry;
  }

  /** Downloads the model file named by the prediction. The URL is never reconstructed
   *  by hand — AFDB has bumped the model version six times and hardcoding v4 would rot. */
  async getStructure(prediction: AfdbPrediction): Promise<string> {
    const fileName = prediction.cifUrl.split('/').pop() ?? `${prediction.entryId}.cif`;
    return this.getText(prediction.cifUrl, fileName, prediction.uniprotAccession);
  }

  private async getText(url: string, cacheKey: string, accession: string): Promise<string> {
    const cachePath = this.cacheDir ? path.join(this.cacheDir, cacheKey) : null;
    if (cachePath && fs.existsSync(cachePath)) return fs.readFileSync(cachePath, 'utf8');

    let lastError: unknown;
    for (let attempt = 1; attempt <= this.attempts; attempt += 1) {
      try {
        const response = await this.fetchImpl(url, { headers: REQUEST_HEADERS });
        if (response.status === 404) throw new AfdbNotFoundError(accession);
        if (!response.ok) throw new Error(`${url} responded ${response.status}`);
        const text = await response.text();
        if (cachePath) fs.writeFileSync(cachePath, text, 'utf8');
        return text;
      } catch (error) {
        if (error instanceof AfdbNotFoundError) throw error;
        lastError = error;
        if (attempt < this.attempts) await sleep(400 * 2 ** (attempt - 1));
      }
    }
    throw new Error(`failed to fetch ${url} after ${this.attempts} attempts: ${String(lastError)}`);
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

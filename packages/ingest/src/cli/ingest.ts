import path from 'node:path';
import { config, migrate, openDb } from '@afx/core';
import { AfdbClient } from '../afdbClient.ts';
import { readAccessions } from '../accessions.ts';
import { ingestAccession, type IngestReport } from '../ingest.ts';
import { openObjectStore } from '../objectStore.ts';

interface Args {
  file: string;
  limit: number;
  force: boolean;
  only: string[];
}

function parseArgs(argv: string[]): Args {
  const args: Args = {
    file: path.resolve('./data/accessions.txt'),
    limit: Number.POSITIVE_INFINITY,
    force: false,
    only: [],
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]!;
    if (arg === '--force') args.force = true;
    else if (arg === '--limit') args.limit = Number.parseInt(argv[++i] ?? '', 10);
    else if (arg === '--file') args.file = path.resolve(argv[++i] ?? '');
    else if (arg === '--only') args.only.push(...(argv[++i] ?? '').split(',').filter(Boolean));
    else if (arg.startsWith('-')) throw new Error(`unknown flag ${arg}`);
  }
  if (!Number.isFinite(args.limit) && args.limit !== Number.POSITIVE_INFINITY) {
    throw new Error('--limit expects an integer');
  }
  return args;
}

const args = parseArgs(process.argv.slice(2));
const accessions = (args.only.length > 0 ? args.only : readAccessions(args.file)).slice(
  0,
  args.limit,
);

const db = await openDb();
await migrate(db);
const store = await openObjectStore();
const client = new AfdbClient();

console.log(`database:     ${config.dbPath}`);
console.log(`object store: ${store.kind}`);
console.log(`accessions:   ${accessions.length}${args.force ? ' (force)' : ''}\n`);

const reports: IngestReport[] = [];
try {
  for (const [index, accession] of accessions.entries()) {
    const report = await ingestAccession(accession, { db, client, store, force: args.force });
    reports.push(report);

    const position = `[${String(index + 1).padStart(3)}/${accessions.length}]`;
    const detail =
      report.outcome === 'ingested'
        ? `${report.residues} residues, ${report.segments} low-confidence segment(s)`
        : (report.error ?? '');
    console.log(`${position} ${accession.padEnd(8)} ${report.outcome.padEnd(10)} ${detail}`);
    if (report.warning) console.warn(`      warning: ${report.warning}`);
  }
} finally {
  await db.close();
}

const tally = new Map<string, number>();
for (const r of reports) tally.set(r.outcome, (tally.get(r.outcome) ?? 0) + 1);
console.log(`\n${[...tally].map(([k, v]) => `${k}: ${v}`).join('  ')}`);

if ((tally.get('failed') ?? 0) > 0) process.exitCode = 1;

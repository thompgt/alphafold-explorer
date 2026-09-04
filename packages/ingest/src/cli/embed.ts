import { config, migrate, openDb } from '@afx/core';
import { ollamaProvider } from '@afx/llm';
import { embedAccession, ensureVectorIndex } from '../embed.ts';

const argv = process.argv.slice(2);
const onlyFlag = argv.indexOf('--only');
const only = onlyFlag === -1 ? [] : (argv[onlyFlag + 1] ?? '').split(',').filter(Boolean);

const provider = ollamaProvider();
const health = await provider.health();
if (!health.ok) {
  console.error(`cannot embed: ${health.detail}`);
  process.exit(1);
}

const db = await openDb({ vss: true });
await migrate(db);

const targets =
  only.length > 0
    ? only
    : (await db.all<{ accession: string }>('SELECT accession FROM proteins ORDER BY accession')).map(
        (r) => r.accession,
      );

console.log(`database: ${config.dbPath}`);
console.log(`model:    ${provider.embedModel} (${provider.embedDim} dimensions)`);
console.log(`entries:  ${targets.length}\n`);

let chunks = 0;
let failed = 0;
try {
  for (const [index, accession] of targets.entries()) {
    try {
      const report = await embedAccession(db, provider, accession);
      chunks += report.chunks;
      console.log(
        `[${String(index + 1).padStart(3)}/${targets.length}] ${accession.padEnd(8)} ${report.chunks} chunk(s)`,
      );
    } catch (error) {
      failed += 1;
      console.error(`[${index + 1}/${targets.length}] ${accession} failed: ${String(error)}`);
    }
  }

  // Build the index once, after the rows exist — HNSW builds faster in bulk.
  await ensureVectorIndex(db);
} finally {
  await db.close();
}

console.log(`\nchunks: ${chunks}  failed: ${failed}`);
if (failed > 0) process.exitCode = 1;

import { config, migrate, openDb } from '@afx/core';
import { ollamaProvider } from '@afx/llm';
import { annotateAccession, pendingAnnotations } from '../annotate.ts';

const argv = process.argv.slice(2);
const force = argv.includes('--force');
const limitFlag = argv.indexOf('--limit');
const limit = limitFlag === -1 ? Number.POSITIVE_INFINITY : Number.parseInt(argv[limitFlag + 1] ?? '', 10);
const onlyFlag = argv.indexOf('--only');
const only = onlyFlag === -1 ? [] : (argv[onlyFlag + 1] ?? '').split(',').filter(Boolean);

const provider = ollamaProvider();
const health = await provider.health();
if (!health.ok) {
  console.error(`cannot annotate: ${health.detail}`);
  process.exit(1);
}

const db = await openDb();
await migrate(db);

const targets = (only.length > 0 ? only : await pendingAnnotations(db, provider.chatModel, force)).slice(
  0,
  limit,
);

console.log(`database: ${config.dbPath}`);
console.log(`model:    ${provider.chatModel}`);
console.log(`to do:    ${targets.length}\n`);

let annotated = 0;
let failed = 0;
try {
  for (const [index, accession] of targets.entries()) {
    const started = Date.now();
    const report = await annotateAccession(accession, { db, provider, force });
    const seconds = ((Date.now() - started) / 1000).toFixed(1);
    if (report.outcome === 'annotated') annotated += 1;
    else failed += 1;

    const position = `[${String(index + 1).padStart(3)}/${targets.length}]`;
    console.log(
      `${position} ${accession.padEnd(8)} ${report.outcome.padEnd(9)} ${seconds}s` +
        (report.error ? ` ${report.error.slice(0, 120)}` : ''),
    );
  }
} finally {
  await db.close();
}

console.log(`\nannotated: ${annotated}  failed: ${failed}`);
if (failed > 0) process.exitCode = 1;

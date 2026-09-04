import { config, migrate, openDb } from '@afx/core';
import { ollamaProvider } from '@afx/llm';
import { openObjectStore } from '@afx/ingest';
import { buildServer } from './server.ts';

/**
 * DuckDB takes a per-process file lock, so the API cannot be running while
 * `npm run ingest`, `annotate` or `embed` holds the same database file.
 */
const db = await openDb({ vss: true });
await migrate(db);

const provider = ollamaProvider();
const store = await openObjectStore();

const app = await buildServer({ db, provider, store, logger: true });

const health = await provider.health();
if (!health.ok) app.log.warn(health.detail);

await app.listen({ port: config.apiPort, host: '0.0.0.0' });
app.log.info(`database ${config.dbPath}, object store ${store.kind}, model ${provider.chatModel}`);

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    void (async () => {
      await app.close();
      await db.close();
      process.exit(0);
    })();
  });
}

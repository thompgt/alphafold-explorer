import cors from '@fastify/cors';
import Fastify, { type FastifyInstance } from 'fastify';
import type { Db } from '@afx/core';
import type { LlmProvider } from '@afx/llm';
import type { ObjectStore } from '@afx/ingest';
import { registerHealthRoutes } from './routes/health.ts';
import { registerProteinRoutes } from './routes/proteins.ts';
import { registerAskRoutes } from './routes/ask.ts';
import { registerRecallRoutes } from './routes/recall.ts';
import { registerAnnotateRoutes } from './routes/annotate.ts';

export interface ServerDeps {
  db: Db;
  provider: LlmProvider;
  store?: ObjectStore;
  logger?: boolean;
}

export type AppInstance = FastifyInstance & { deps: ServerDeps };

/**
 * Builds the HTTP app with its dependencies injected, so tests can run the real
 * routes against an in-memory database and a stub model provider.
 */
export async function buildServer(deps: ServerDeps): Promise<FastifyInstance> {
  const app = Fastify({
    logger: deps.logger ?? false,
    // Every model-backed route is slow by nature; a local 8B model can take a minute.
    requestTimeout: 300_000,
  });

  await app.register(cors, { origin: true });

  app.decorate('deps', deps);

  await registerHealthRoutes(app, deps);
  await registerProteinRoutes(app, deps);
  await registerAskRoutes(app, deps);
  await registerRecallRoutes(app, deps);
  await registerAnnotateRoutes(app, deps);

  app.setNotFoundHandler((request, reply) => {
    reply.code(404).send({ error: 'not_found', message: `no route for ${request.url}` });
  });

  return app;
}

import type { FastifyInstance } from 'fastify';
import type { ServerDeps } from '../server.ts';

export async function registerHealthRoutes(app: FastifyInstance, deps: ServerDeps): Promise<void> {
  /**
   * Reports on both dependencies separately. The database being up while the model
   * is not is the normal state before `ollama pull`, and the UI needs to say which
   * of the two is missing rather than just failing.
   */
  app.get('/health', async (_request, reply) => {
    const [database, model] = await Promise.all([checkDatabase(deps), deps.provider.health()]);
    const ok = database.ok && model.ok;
    return reply.code(ok ? 200 : 503).send({
      ok,
      database,
      model: { ...model, chatModel: deps.provider.chatModel, embedModel: deps.provider.embedModel },
      objectStore: deps.store ? deps.store.kind : 'disabled',
    });
  });
}

async function checkDatabase(deps: ServerDeps): Promise<{ ok: boolean; detail: string }> {
  try {
    const proteins = await deps.db.one<{ n: number }>('SELECT count(*) AS n FROM proteins');
    const chunks = await deps.db.one<{ n: number }>('SELECT count(*) AS n FROM chunks');
    const annotations = await deps.db.one<{ n: number }>(
      "SELECT count(*) AS n FROM annotations WHERE status = 'ok'",
    );
    return {
      ok: true,
      detail: `${proteins?.n ?? 0} proteins, ${annotations?.n ?? 0} annotations, ${chunks?.n ?? 0} chunks`,
    };
  } catch (error) {
    return { ok: false, detail: String(error) };
  }
}

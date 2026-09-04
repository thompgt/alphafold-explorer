import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { annotateAccession, embedAccession } from '@afx/ingest';
import type { ServerDeps } from '../server.ts';

const accessionSchema = z
  .string()
  .regex(/^[A-Za-z0-9]{1,15}$/)
  .transform((value) => value.toUpperCase());

export async function registerAnnotateRoutes(
  app: FastifyInstance,
  deps: ServerDeps,
): Promise<void> {
  /**
   * Regenerates one annotation card on demand, then re-embeds that entry so the
   * card and the passages that quote it never drift apart.
   */
  app.post('/annotate/:accession', async (request, reply) => {
    const parsed = accessionSchema.safeParse(
      (request.params as { accession?: string }).accession ?? '',
    );
    if (!parsed.success) {
      return reply.code(400).send({ error: 'bad_request', message: parsed.error.message });
    }
    const accession = parsed.data;

    const exists = await deps.db.one<{ n: number }>(
      'SELECT count(*) AS n FROM proteins WHERE accession = ?',
      [accession],
    );
    if ((exists?.n ?? 0) === 0) {
      return reply.code(404).send({ error: 'not_found', message: `${accession} is not ingested` });
    }

    const report = await annotateAccession(accession, {
      db: deps.db,
      provider: deps.provider,
      force: true,
    });

    if (report.outcome !== 'annotated') {
      return reply
        .code(502)
        .send({ error: 'annotation_failed', message: report.error ?? 'unknown', accession });
    }

    let reembedded = false;
    try {
      await embedAccession(deps.db, deps.provider, accession);
      reembedded = true;
    } catch (error) {
      request.log.warn({ error: String(error) }, 're-embedding failed after annotation');
    }

    const row = await deps.db.one<{ card: string | null; model: string; generated_at: string }>(
      'SELECT card, model, generated_at FROM annotations WHERE accession = ?',
      [accession],
    );

    return reply.send({
      accession,
      attempts: report.attempts,
      model: row?.model,
      generated_at: row?.generated_at,
      card: row?.card ? JSON.parse(row.card) : null,
      reembedded,
    });
  });
}

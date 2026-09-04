import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { ServerDeps } from '../server.ts';

const listQuerySchema = z.object({
  q: z.string().max(100).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
  sort: z
    .enum(['accession', 'gene', 'mean_plddt', 'sequence_length', 'pct_very_low'])
    .default('accession'),
  order: z.enum(['asc', 'desc']).default('asc'),
});

const accessionSchema = z
  .string()
  .regex(/^[A-Za-z0-9]{1,15}$/, 'accession must be alphanumeric')
  .transform((value) => value.toUpperCase());

export async function registerProteinRoutes(
  app: FastifyInstance,
  deps: ServerDeps,
): Promise<void> {
  app.get('/proteins', async (request, reply) => {
    const parsed = listQuerySchema.safeParse(request.query);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'bad_request', message: parsed.error.message });
    }
    const { q, limit, offset, sort, order } = parsed.data;

    // The search term is bound three times; sort/order come from closed enums, so
    // interpolating those two cannot inject.
    const where = q
      ? 'WHERE accession ILIKE ? OR gene ILIKE ? OR protein_name ILIKE ?'
      : '';
    const like = `%${q ?? ''}%`;
    const searchParams = q ? [like, like, like] : [];

    const rows = await deps.db.all(
      `SELECT accession, entry_id, protein_name, gene, organism, sequence_length,
              mean_plddt, pct_very_high, pct_confident, pct_low, pct_very_low,
              longest_low_run, annotation_status
         FROM v_protein_overview
         ${where}
        ORDER BY ${sort} ${order.toUpperCase()} NULLS LAST
        LIMIT ? OFFSET ?`,
      [...searchParams, limit, offset],
    );
    const total = await deps.db.one<{ n: number }>(
      `SELECT count(*) AS n FROM v_protein_overview ${where}`,
      searchParams,
    );

    return reply.send({ total: total?.n ?? rows.length, limit, offset, proteins: rows });
  });

  app.get('/proteins/:accession', async (request, reply) => {
    const parsed = accessionSchema.safeParse(
      (request.params as { accession?: string }).accession ?? '',
    );
    if (!parsed.success) {
      return reply.code(400).send({ error: 'bad_request', message: parsed.error.message });
    }
    const accession = parsed.data;

    const protein = await deps.db.one(
      `SELECT p.*, c.mean_plddt, c.median_plddt, c.min_plddt, c.max_plddt,
              c.pct_very_high, c.pct_confident, c.pct_low, c.pct_very_low, c.longest_low_run
         FROM proteins p
         LEFT JOIN confidence_summary c USING (accession)
        WHERE p.accession = ?`,
      [accession],
    );
    if (!protein) {
      return reply.code(404).send({ error: 'not_found', message: `${accession} is not ingested` });
    }

    const [segments, annotationRow] = await Promise.all([
      deps.db.all(
        'SELECT * FROM segments WHERE accession = ? ORDER BY start_residue',
        [accession],
      ),
      deps.db.one<{ status: string; card: string | null; model: string; generated_at: string; error: string | null }>(
        'SELECT status, card, model, generated_at, error FROM annotations WHERE accession = ?',
        [accession],
      ),
    ]);

    const annotation = annotationRow
      ? {
          status: annotationRow.status,
          model: annotationRow.model,
          generated_at: annotationRow.generated_at,
          error: annotationRow.error,
          card: annotationRow.card ? JSON.parse(annotationRow.card) : null,
        }
      : null;

    return reply.send({ protein, segments, annotation });
  });

  /** Per-residue pLDDT, for the confidence track under the 3D viewer. */
  app.get('/proteins/:accession/residues', async (request, reply) => {
    const parsed = accessionSchema.safeParse(
      (request.params as { accession?: string }).accession ?? '',
    );
    if (!parsed.success) {
      return reply.code(400).send({ error: 'bad_request', message: parsed.error.message });
    }
    const rows = await deps.db.all<{ residue_index: number; amino_acid: string; plddt: number }>(
      'SELECT residue_index, amino_acid, plddt FROM residues WHERE accession = ? ORDER BY residue_index',
      [parsed.data],
    );
    if (rows.length === 0) {
      return reply
        .code(404)
        .send({ error: 'not_found', message: `no residues stored for ${parsed.data}` });
    }
    return reply.send({ accession: parsed.data, residues: rows });
  });

  /**
   * Streams the model file. Served from our own object store rather than proxied from
   * EBI so the viewer keeps working offline and we stay off a public service's rate limit.
   */
  app.get('/proteins/:accession/structure', async (request, reply) => {
    const parsed = accessionSchema.safeParse(
      (request.params as { accession?: string }).accession ?? '',
    );
    if (!parsed.success) {
      return reply.code(400).send({ error: 'bad_request', message: parsed.error.message });
    }
    const accession = parsed.data;

    const row = await deps.db.one<{ cif_object_key: string | null; cif_url: string }>(
      'SELECT cif_object_key, cif_url FROM proteins WHERE accession = ?',
      [accession],
    );
    if (!row) {
      return reply.code(404).send({ error: 'not_found', message: `${accession} is not ingested` });
    }
    if (!deps.store || !row.cif_object_key) {
      // Nothing stored locally: send the client to AlphaFold rather than pretend.
      return reply.redirect(row.cif_url, 302);
    }

    const cif = await deps.store.get(row.cif_object_key);
    if (cif === null) return reply.redirect(row.cif_url, 302);

    return reply
      .header('content-type', 'chemical/x-mmcif')
      .header('cache-control', 'public, max-age=86400')
      .send(cif);
  });
}

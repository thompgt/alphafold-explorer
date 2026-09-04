import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { runGuardedQuery, SqlGuardError } from '@afx/core';
import {
  ANSWER_SYSTEM,
  buildAnswerPrompt,
  buildNl2SqlPrompt,
  extractSql,
  NL2SQL_SYSTEM,
} from '@afx/llm';
import type { ServerDeps } from '../server.ts';

const askSchema = z.object({
  question: z.string().min(3).max(500),
  /** Skip the summarising second model call; useful for scripted use. */
  summarise: z.boolean().default(true),
});

export async function registerAskRoutes(app: FastifyInstance, deps: ServerDeps): Promise<void> {
  /**
   * Natural language to SQL.
   *
   * The generated SQL is always returned, whether it ran or not — the model is
   * auditable rather than trusted, and a user who can see the query can tell a
   * wrong answer from a wrong question.
   */
  app.post('/ask', async (request, reply) => {
    const parsed = askSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'bad_request', message: parsed.error.message });
    }
    const { question, summarise } = parsed.data;

    let sql: string;
    try {
      const raw = await deps.provider.chat(buildNl2SqlPrompt(question), {
        system: NL2SQL_SYSTEM,
        temperature: 0,
      });
      sql = extractSql(raw);
    } catch (error) {
      return reply
        .code(503)
        .send({ error: 'model_unavailable', message: String(error), question });
    }

    let result;
    try {
      result = await runGuardedQuery(deps.db, sql);
    } catch (error) {
      if (error instanceof SqlGuardError) {
        return reply.code(422).send({
          error: 'rejected_sql',
          reason: error.reason,
          message: error.message,
          question,
          sql,
        });
      }
      return reply
        .code(400)
        .send({ error: 'query_failed', message: String(error), question, sql });
    }

    let summary: string | null = null;
    if (summarise) {
      try {
        summary = (
          await deps.provider.chat(buildAnswerPrompt(question, result.sql, result.rows), {
            system: ANSWER_SYSTEM,
            temperature: 0.2,
          })
        ).trim();
      } catch {
        // The rows are the answer; a missing summary is not a failed request.
        summary = null;
      }
    }

    return reply.send({
      question,
      sql,
      executedSql: result.sql,
      relations: result.relations,
      limitApplied: result.limitApplied,
      rowCount: result.rows.length,
      rows: result.rows,
      summary,
    });
  });
}

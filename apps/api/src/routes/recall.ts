import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { buildRecallPrompt, extractCitations, RECALL_SYSTEM } from '@afx/llm';
import { retrieveChunks } from '@afx/ingest';
import type { ServerDeps } from '../server.ts';

const recallSchema = z.object({
  question: z.string().min(3).max(500),
  topK: z.number().int().min(1).max(20).default(6),
  minSimilarity: z.number().min(0).max(1).default(0.35),
});

export async function registerRecallRoutes(app: FastifyInstance, deps: ServerDeps): Promise<void> {
  /**
   * Retrieval-augmented answer over the annotation cards and structure summaries.
   *
   * When nothing clears the similarity floor the route says so and never calls the
   * model — an unanswerable question should come back unanswered, not confabulated.
   */
  app.post('/recall', async (request, reply) => {
    const parsed = recallSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'bad_request', message: parsed.error.message });
    }
    const { question, topK, minSimilarity } = parsed.data;

    let chunks;
    try {
      chunks = await retrieveChunks(deps.db, deps.provider, question, { topK, minSimilarity });
    } catch (error) {
      return reply.code(503).send({ error: 'model_unavailable', message: String(error), question });
    }

    if (chunks.length === 0) {
      return reply.send({
        question,
        answer:
          'Nothing in the ingested AlphaFold entries is close enough to this question to answer it.',
        citations: [],
        passages: [],
        grounded: false,
      });
    }

    let answer: string;
    try {
      answer = (
        await deps.provider.chat(buildRecallPrompt(question, chunks), {
          system: RECALL_SYSTEM,
          temperature: 0.2,
        })
      ).trim();
    } catch (error) {
      return reply.code(503).send({ error: 'model_unavailable', message: String(error), question });
    }

    const citations = extractCitations(
      answer,
      chunks.map((chunk) => chunk.accession),
    );

    return reply.send({
      question,
      answer,
      citations,
      passages: chunks.map((chunk) => ({
        accession: chunk.accession,
        source: chunk.source,
        similarity: Number(chunk.similarity.toFixed(4)),
        text: chunk.text,
      })),
      grounded: true,
    });
  });
}

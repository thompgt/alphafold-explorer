import { Ollama } from 'ollama';
import { config } from '@afx/core';
import type { ChatOptions, LlmProvider, ProviderHealth } from './provider.ts';

export interface OllamaProviderOptions {
  host?: string;
  chatModel?: string;
  embedModel?: string;
  embedDim?: number;
}

/**
 * Local Ollama provider. No API keys, no network egress — the whole point of the
 * project is that it runs on a laptop with nothing but `ollama serve`.
 */
export function ollamaProvider(options: OllamaProviderOptions = {}): LlmProvider {
  const host = options.host ?? config.ollamaHost;
  const chatModel = options.chatModel ?? config.chatModel;
  const embedModel = options.embedModel ?? config.embedModel;
  const embedDim = options.embedDim ?? config.embedDim;
  const client = new Ollama({ host });

  return {
    name: `ollama(${host})`,
    chatModel,
    embedModel,
    embedDim,

    async chat(prompt: string, chatOptions: ChatOptions = {}): Promise<string> {
      const response = await client.chat({
        model: chatModel,
        stream: false,
        ...(chatOptions.json ? { format: 'json' as const } : {}),
        options: {
          // These tasks want the same answer twice, not creativity.
          temperature: chatOptions.temperature ?? 0.1,
        },
        messages: [
          ...(chatOptions.system ? [{ role: 'system' as const, content: chatOptions.system }] : []),
          { role: 'user' as const, content: prompt },
        ],
      });
      return response.message.content;
    },

    async embed(texts: string[]): Promise<number[][]> {
      if (texts.length === 0) return [];
      const response = await client.embed({ model: embedModel, input: texts });
      const vectors = response.embeddings;
      for (const vector of vectors) {
        if (vector.length !== embedDim) {
          throw new Error(
            `embedding model ${embedModel} returned ${vector.length} dimensions but the ` +
              `chunks table is FLOAT[${embedDim}]. Set AFX_EMBED_DIM and re-run the migration.`,
          );
        }
      }
      return vectors;
    },

    async health(): Promise<ProviderHealth> {
      try {
        const { models } = await client.list();
        const available = new Set(models.map((m) => m.name));
        const missing = [chatModel, embedModel].filter(
          (needed) => !available.has(needed) && !available.has(`${needed}:latest`),
        );
        if (missing.length > 0) {
          return {
            ok: false,
            detail: `ollama is up but missing model(s): ${missing.join(', ')} — run \`ollama pull ${missing[0]}\``,
          };
        }
        return { ok: true, detail: `ollama at ${host}: ${models.length} models` };
      } catch (error) {
        return { ok: false, detail: `ollama unreachable at ${host}: ${String(error)}` };
      }
    },
  };
}

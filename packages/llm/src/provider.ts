export interface ChatOptions {
  system?: string;
  /** Ask the model for strict JSON output. */
  json?: boolean;
  temperature?: number;
}

export interface ProviderHealth {
  ok: boolean;
  detail: string;
}

/**
 * Everything the app needs from a language model. Kept deliberately small so the
 * Ollama implementation and the deterministic test stub stay interchangeable —
 * no test in this repo talks to a real model.
 */
export interface LlmProvider {
  readonly name: string;
  readonly chatModel: string;
  readonly embedModel: string;
  readonly embedDim: number;
  chat(prompt: string, options?: ChatOptions): Promise<string>;
  embed(texts: string[]): Promise<number[][]>;
  health(): Promise<ProviderHealth>;
}

export interface StubBehaviour {
  /** Called for each chat request; return the raw model text. */
  chat?: (prompt: string, options?: ChatOptions) => string | Promise<string>;
  /** Called for each embed request; defaults to a deterministic hash embedding. */
  embed?: (texts: string[]) => number[][] | Promise<number[][]>;
}

/**
 * Deterministic in-process provider for tests. The default embedding is a
 * character-hash projection: meaningless as semantics, but stable and it puts
 * near-identical strings near each other, which is all retrieval tests need.
 */
export function stubProvider(behaviour: StubBehaviour = {}, embedDim = 768): LlmProvider {
  return {
    name: 'stub',
    chatModel: 'stub-chat',
    embedModel: 'stub-embed',
    embedDim,
    async chat(prompt, options) {
      return behaviour.chat ? behaviour.chat(prompt, options) : '';
    },
    async embed(texts) {
      if (behaviour.embed) return behaviour.embed(texts);
      return texts.map((text) => hashEmbedding(text, embedDim));
    },
    async health() {
      return { ok: true, detail: 'stub provider' };
    },
  };
}

export function hashEmbedding(text: string, dim: number): number[] {
  const vector = new Array<number>(dim).fill(0);
  const tokens = text.toLowerCase().match(/[a-z0-9]+/g) ?? [];
  for (const token of tokens) {
    let hash = 2166136261;
    for (let i = 0; i < token.length; i += 1) {
      hash ^= token.charCodeAt(i);
      hash = Math.imul(hash, 16777619);
    }
    vector[Math.abs(hash) % dim]! += 1;
  }
  const norm = Math.hypot(...vector) || 1;
  return vector.map((v) => v / norm);
}

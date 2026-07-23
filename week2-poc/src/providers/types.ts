/**
 * providers/types.ts
 * -----------------------------------------------------------------------------
 * Swappable AI-provider interfaces (Principle V — provider independence).
 *
 * Core logic (retrieval, rag, eval) depends ONLY on these interfaces; concrete
 * vendor code lives exclusively under src/providers/ (contracts/providers.md).
 */

export interface EmbeddingProvider {
  /** Embed one or many texts. Returns one vector per input, same order. */
  embed(texts: string[]): Promise<number[][]>;
  /** Model/deployment id, for logging & index metadata. */
  readonly model: string;
}

/** Cumulative call/token accounting for cost reporting (optional capability). */
export interface LLMUsageStats {
  calls: number;
  promptTokens: number;
  completionTokens: number;
}

export interface LLMProvider {
  /** Single-turn completion for answer synthesis and judging. */
  complete(input: {
    system: string;
    user: string;
    temperature?: number; // default 0 for determinism
    responseFormat?: "text" | "json";
  }): Promise<string>;
  readonly model: string;
  /** Present when the implementation tracks usage; mutated in place per call. */
  readonly stats?: LLMUsageStats;
}

/**
 * Typed provider failure (auth, rate limit, timeout, malformed response).
 * Callers handle it explicitly; the assistant never invents an answer to mask
 * a provider error (contracts/providers.md).
 */
export class ProviderError extends Error {
  constructor(
    message: string,
    readonly cause?: unknown,
  ) {
    super(message);
    this.name = "ProviderError";
  }
}

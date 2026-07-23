/**
 * providers/dial.ts
 * -----------------------------------------------------------------------------
 * EPAM Dial implementation of the provider interfaces (Principle V).
 *
 * Dial exposes an OpenAI-compatible endpoint, so a single `openai` SDK client
 * (pointed at DIAL_BASE_URL) backs both chat completion and embeddings. This is
 * the ONLY module allowed to import the vendor SDK (contracts/providers.md).
 */

import OpenAI from "openai";
import type { Config } from "../config.js";
import { type EmbeddingProvider, type LLMProvider, type LLMUsageStats, ProviderError } from "./types.js";

/**
 * Some Dial routes (e.g. Vertex-hosted Claude) ignore `response_format` and
 * return JSON wrapped in a markdown code fence. Callers JSON.parse the result,
 * so unwrap the fence here — plain JSON passes through untouched.
 */
export function stripJsonFence(raw: string): string {
  const m = raw.trim().match(/^```(?:json)?\s*([\s\S]*?)\s*```$/);
  return m ? m[1] : raw;
}

class DialLLMProvider implements LLMProvider {
  readonly stats: LLMUsageStats = { calls: 0, promptTokens: 0, completionTokens: 0 };

  constructor(
    private readonly client: OpenAI,
    readonly model: string,
  ) {}

  async complete(input: {
    system: string;
    user: string;
    temperature?: number;
    responseFormat?: "text" | "json";
  }): Promise<string> {
    try {
      const res = await this.client.chat.completions.create({
        model: this.model,
        temperature: input.temperature ?? 0,
        ...(input.responseFormat === "json"
          ? { response_format: { type: "json_object" as const } }
          : {}),
        messages: [
          { role: "system", content: input.system },
          { role: "user", content: input.user },
        ],
      });
      this.stats.calls += 1;
      this.stats.promptTokens += res.usage?.prompt_tokens ?? 0;
      this.stats.completionTokens += res.usage?.completion_tokens ?? 0;
      const content = res.choices[0]?.message?.content;
      if (!content) {
        throw new ProviderError(`Dial chat completion returned no content (model ${this.model})`);
      }
      return input.responseFormat === "json" ? stripJsonFence(content) : content;
    } catch (err) {
      if (err instanceof ProviderError) throw err;
      throw new ProviderError(`Dial chat completion failed (model ${this.model})`, err);
    }
  }
}

class DialEmbeddingProvider implements EmbeddingProvider {
  constructor(
    private readonly client: OpenAI,
    readonly model: string,
  ) {}

  async embed(texts: string[]): Promise<number[][]> {
    try {
      const res = await this.client.embeddings.create({ model: this.model, input: texts });
      if (res.data.length !== texts.length) {
        throw new ProviderError(
          `Dial embeddings returned ${res.data.length} vectors for ${texts.length} inputs (model ${this.model})`,
        );
      }
      // The API documents `index` for ordering; sort defensively.
      return [...res.data].sort((a, b) => a.index - b.index).map((d) => d.embedding);
    } catch (err) {
      if (err instanceof ProviderError) throw err;
      throw new ProviderError(`Dial embeddings failed (model ${this.model})`, err);
    }
  }
}

/**
 * Dial routes requests Azure-style — per-deployment paths with an api-version
 * query and an Api-Key header — so each provider gets a client whose baseURL
 * targets its own deployment.
 */
const DIAL_API_VERSION = "2025-04-01-preview";

function dialClient(cfg: Config, deployment: string): OpenAI {
  return new OpenAI({
    baseURL: `${cfg.dialBaseUrl.replace(/\/$/, "")}/openai/deployments/${deployment}`,
    apiKey: cfg.dialApiKey,
    defaultQuery: { "api-version": DIAL_API_VERSION },
    defaultHeaders: { "Api-Key": cfg.dialApiKey },
    // Some Dial deployments occasionally leave a connection hanging without a
    // response; the SDK default (10 min/attempt) turns that into a zombie eval.
    // Fail fast and let the SDK retry instead.
    timeout: 120_000,
    maxRetries: 3,
  });
}

/** Construct all providers from config only — no other inputs (contract rule). */
export function createDialProviders(cfg: Config): {
  llm: LLMProvider;
  judgeLlm: LLMProvider;
  embedder: EmbeddingProvider;
} {
  // judgeLlm is always a distinct instance (even for the same deployment) so
  // its usage stats never pollute the synthesis LLM's cost accounting.
  return {
    llm: new DialLLMProvider(dialClient(cfg, cfg.chatModel), cfg.chatModel),
    judgeLlm: new DialLLMProvider(dialClient(cfg, cfg.judgeModel), cfg.judgeModel),
    embedder: new DialEmbeddingProvider(dialClient(cfg, cfg.embeddingModel), cfg.embeddingModel),
  };
}

/**
 * providers/ollama.ts
 * -----------------------------------------------------------------------------
 * Local-LLM implementation of LLMProvider via Ollama's OpenAI-compatible API
 * (assignment worst-case: no cloud access at all). Chat only — embeddings keep
 * their configured provider, since the index and the refusal floor are
 * calibrated to that embedding space.
 *
 * Like providers/dial.ts, this is vendor-aware code allowed to import the
 * OpenAI SDK (contracts/providers.md).
 */

import OpenAI from "openai";
import type { Config } from "../config.js";
import { type LLMProvider, type LLMUsageStats, ProviderError } from "./types.js";
import { stripJsonFence } from "./dial.js";

/**
 * Small local models leak reasoning even when asked for bare JSON: qwen3-style
 * `<think>…</think>` blocks and markdown fences. Strip both before parsing.
 */
export function stripLocalNoise(raw: string): string {
  return stripJsonFence(raw.replace(/<think>[\s\S]*?<\/think>/g, "").trim());
}

class OllamaLLMProvider implements LLMProvider {
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
      // Qwen3's official soft switch: thinking mode multiplies latency several
      // times over on CPU and adds nothing to short grounded synthesis.
      const system = this.model.startsWith("qwen3")
        ? `${input.system}\n/no_think`
        : input.system;
      const res = await this.client.chat.completions.create({
        model: this.model,
        temperature: input.temperature ?? 0,
        ...(input.responseFormat === "json"
          ? { response_format: { type: "json_object" as const } }
          : {}),
        messages: [
          { role: "system", content: system },
          { role: "user", content: input.user },
        ],
      });
      this.stats.calls += 1;
      this.stats.promptTokens += res.usage?.prompt_tokens ?? 0;
      this.stats.completionTokens += res.usage?.completion_tokens ?? 0;
      const content = res.choices[0]?.message?.content;
      if (!content) {
        throw new ProviderError(`Ollama completion returned no content (model ${this.model})`);
      }
      return input.responseFormat === "json" ? stripLocalNoise(content) : content;
    } catch (err) {
      if (err instanceof ProviderError) throw err;
      throw new ProviderError(
        `Ollama completion failed (model ${this.model}) — is \`ollama serve\` running?`,
        err,
      );
    }
  }
}

/** Chat provider against a local Ollama server; config-only inputs (contract rule). */
export function createOllamaLLM(cfg: Config): LLMProvider {
  const client = new OpenAI({
    baseURL: `${cfg.ollamaBaseUrl.replace(/\/$/, "")}/v1`,
    apiKey: "ollama", // required by the SDK, ignored by Ollama
    // Local CPU inference is slow; give a single long generation room.
    timeout: 600_000,
    maxRetries: 1,
  });
  return new OllamaLLMProvider(client, cfg.ollamaChatModel);
}

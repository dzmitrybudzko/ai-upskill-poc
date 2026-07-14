/**
 * tests/fakes.ts
 * -----------------------------------------------------------------------------
 * In-memory provider fakes proving the Principle V contract: core modules can
 * run against ANY implementation of the interfaces, no vendor SDK involved.
 */

import type { EmbeddingProvider, LLMProvider } from "../src/providers/types.js";

/** Deterministic pseudo-embedding: cheap character-histogram vector. */
export class FakeEmbeddingProvider implements EmbeddingProvider {
  readonly model = "fake-embedding";

  async embed(texts: string[]): Promise<number[][]> {
    return texts.map((text) => {
      const v = new Array(8).fill(0);
      for (let i = 0; i < text.length; i++) v[text.charCodeAt(i) % 8] += 1;
      const norm = Math.hypot(...v) || 1;
      return v.map((x) => x / norm);
    });
  }
}

/**
 * Synthesizes a fake grounded answer citing EVERY passage listed in the user
 * prompt (ids parsed from the "[id] label — text" lines). Lets integration
 * tests exercise the retrieve → answer → citation pipeline deterministically.
 */
export class EchoCitingLLMProvider implements LLMProvider {
  readonly model = "fake-echo-llm";

  async complete(input: { system: string; user: string }): Promise<string> {
    const ids = [...input.user.matchAll(/^\[([^\]\s]+)\]/gm)].map((m) => m[1]);
    return JSON.stringify({
      mode: "answer",
      answer: `Everything the passages say ${ids.map((id) => `[${id}]`).join(" ")}.`,
      cited_ids: ids,
    });
  }
}

/** Replays canned responses in order (or a fixed one). */
export class FakeLLMProvider implements LLMProvider {
  readonly model = "fake-llm";
  private calls = 0;

  constructor(private readonly responses: string[]) {}

  get callCount(): number {
    return this.calls;
  }

  async complete(): Promise<string> {
    const res = this.responses[Math.min(this.calls, this.responses.length - 1)];
    this.calls += 1;
    return res;
  }
}

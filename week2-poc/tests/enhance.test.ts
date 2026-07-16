/**
 * tests/enhance.test.ts
 * -----------------------------------------------------------------------------
 * US7 query rewriting: the enhanced retriever embeds the REWRITTEN query while
 * the caller keeps the original question, and degenerate rewrites fall back.
 */

import { describe, expect, it } from "vitest";
import { makeEnhancedRetriever, rewriteQuery } from "../src/retrieval/enhance.js";
import type { Retriever } from "../src/rag/answer.js";
import { FakeEmbeddingProvider, FakeLLMProvider } from "./fakes.js";

const embedder = new FakeEmbeddingProvider();

describe("rewriteQuery", () => {
  it("returns the model's rewritten query, trimmed", async () => {
    const llm = new FakeLLMProvider(["  direct marketing, consent, legitimate interests  "]);
    await expect(rewriteQuery("can we email ads?", llm)).resolves.toBe(
      "direct marketing, consent, legitimate interests",
    );
  });

  it("falls back to the original question on a degenerate rewrite", async () => {
    const llm = new FakeLLMProvider([" "]);
    await expect(rewriteQuery("can we email ads?", llm)).resolves.toBe("can we email ads?");
  });
});

describe("makeEnhancedRetriever", () => {
  it("passes the rewritten query to the base retriever, preserving opts", async () => {
    const seen: { question: string; k?: number }[] = [];
    const base: Retriever = async (question, opts) => {
      seen.push({ question, k: opts.k });
      return [];
    };
    const llm = new FakeLLMProvider(["profiling, automated decision-making, Article 22"]);
    const retriever = makeEnhancedRetriever(llm, base);
    await retriever("what about computer-made decisions?", { k: 7 }, embedder);
    expect(seen).toEqual([{ question: "profiling, automated decision-making, Article 22", k: 7 }]);
  });
});

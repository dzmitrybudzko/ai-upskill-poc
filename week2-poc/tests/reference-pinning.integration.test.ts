/**
 * tests/reference-pinning.integration.test.ts
 * -----------------------------------------------------------------------------
 * Exact-reference lookups: an explicitly named article is pinned to rank 1 by
 * metadata even when vector similarity would miss it (the fake embedder is
 * non-semantic, so vector search alone essentially never finds the right
 * chunk — exactly the failure mode being fixed).
 */

import { beforeAll, describe, expect, it } from "vitest";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { loadCorpus } from "../src/corpus/corpus.js";
import { buildIndex } from "../src/retrieval/build-index.js";
import { retrieve } from "../src/retrieval/retriever.js";
import { FakeEmbeddingProvider } from "./fakes.js";

const embedder = new FakeEmbeddingProvider();
let indexPath: string;

beforeAll(async () => {
  const corpus = loadCorpus();
  const subset = corpus.filter(
    (c) =>
      (c.regulation === "GDPR" && c.type === "article") ||
      (c.regulation === "AI_ACT" && c.type === "annex" && c.annex_number === "III"),
  );
  indexPath = join(tmpdir(), `lance-pin-${process.pid}`);
  await buildIndex(subset, embedder, { indexPath });
}, 120_000);

describe("explicit reference pinning", () => {
  it("pins GDPR Article 22 to rank 1 for an article-number question", async () => {
    const res = await retrieve("What does GDPR Article 22 say?", { k: 5 }, embedder, indexPath);
    expect(res[0].chunk.article_number).toBe("22");
    expect(res[0].chunk.regulation).toBe("GDPR");
    expect(res[0].score).toBe(1);
    expect(res.map((r) => r.rank)).toEqual([1, 2, 3, 4, 5]);
  });

  it("pins AI Act Annex III chunks for an annex question", async () => {
    const res = await retrieve("Which AI uses are in AI Act Annex III?", { k: 5 }, embedder, indexPath);
    expect(res[0].chunk.type).toBe("annex");
    expect(res[0].chunk.annex_number).toBe("III");
  });

  it("respects user filters — a pinned article never overrides --reg", async () => {
    const res = await retrieve(
      "What does GDPR Article 22 say?",
      { k: 5, filters: { regulation: "AI_ACT" } },
      embedder,
      indexPath,
    );
    expect(res.every((r) => r.chunk.regulation === "AI_ACT")).toBe(true);
  });
});

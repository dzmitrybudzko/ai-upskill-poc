/**
 * tests/metrics.test.ts
 * -----------------------------------------------------------------------------
 * Deterministic eval metrics (T021): article/annex-level source matching,
 * hit-rate@k, MRR, and the fabricated-citation counter.
 */

import { describe, expect, it } from "vitest";
import type { Chunk } from "../src/corpus/corpus.js";
import type { Answer } from "../src/rag/answer.js";
import type { RetrievedChunk } from "../src/retrieval/retriever.js";
import { NOT_LEGAL_ADVICE_NOTICE } from "../src/rag/notice.js";
import {
  citesExpectedSource,
  fabricatedCitationCount,
  hitAtK,
  reciprocalRank,
  sourceKey,
} from "../src/eval/metrics.js";

const article = (id: string, n: string, reg: "GDPR" | "AI_ACT" = "GDPR"): Chunk => ({
  id,
  regulation: reg,
  type: "article",
  article_number: n,
  text: "…",
  url: "https://x",
});

const annex = (id: string, n: string): Chunk => ({
  id,
  regulation: "AI_ACT",
  type: "annex",
  annex_number: n,
  text: "…",
  url: "https://x",
});

const ranked = (...chunks: Chunk[]): RetrievedChunk[] =>
  chunks.map((chunk, i) => ({ chunk, score: 0.9 - i * 0.1, rank: i + 1 }));

describe("sourceKey", () => {
  it("maps paragraph-split article chunks to the article-level key", () => {
    expect(sourceKey(article("gdpr-art-6-1", "6"))).toBe("gdpr-art-6");
    expect(sourceKey(article("aiact-art-6", "6", "AI_ACT"))).toBe("aiact-art-6");
  });

  it("maps annex chunks to the annex-level key", () => {
    expect(sourceKey(annex("aiact-anx-III-4", "III"))).toBe("aiact-anx-III");
  });
});

describe("hitAtK / reciprocalRank (SC-002)", () => {
  const retrieved = ranked(article("gdpr-art-5-1", "5"), article("gdpr-art-6-2", "6"), annex("aiact-anx-III-1", "III"));

  it("hit when any expected source appears in the retrieved set", () => {
    expect(hitAtK(["gdpr-art-6"], retrieved)).toBe(true);
    expect(hitAtK(["aiact-anx-III", "gdpr-art-99"], retrieved)).toBe(true);
    expect(hitAtK(["gdpr-art-99"], retrieved)).toBe(false);
    expect(hitAtK([], retrieved)).toBe(false);
  });

  it("reciprocal rank of the first match", () => {
    expect(reciprocalRank(["gdpr-art-5"], retrieved)).toBe(1);
    expect(reciprocalRank(["gdpr-art-6"], retrieved)).toBe(1 / 2);
    expect(reciprocalRank(["aiact-anx-III"], retrieved)).toBe(1 / 3);
    expect(reciprocalRank(["gdpr-art-99"], retrieved)).toBe(0);
  });
});

describe("citesExpectedSource (SC-004) & fabricatedCitationCount (SC-005)", () => {
  const retrieved = ranked(article("gdpr-art-6-1", "6"), article("gdpr-art-7", "7"));
  const grounded = (citedIds: string[]): Answer => ({
    mode: "grounded",
    text: "…",
    citations: citedIds.map((id) => ({ chunk_id: id, label: "…", url: "https://x" })),
    retrieved,
    not_legal_advice_notice: NOT_LEGAL_ADVICE_NOTICE,
  });

  it("correct when a cited chunk matches an expected article-level source", () => {
    expect(citesExpectedSource(grounded(["gdpr-art-6-1"]), ["gdpr-art-6"])).toBe(true);
    expect(citesExpectedSource(grounded(["gdpr-art-7"]), ["gdpr-art-6"])).toBe(false);
  });

  it("counts citations outside the retrieved set (must stay 0 in practice)", () => {
    expect(fabricatedCitationCount(grounded(["gdpr-art-6-1", "gdpr-art-7"]))).toBe(0);
    expect(fabricatedCitationCount(grounded(["gdpr-art-6-1", "gdpr-art-99"]))).toBe(1);
  });
});

/**
 * tests/citation-validator.test.ts
 * -----------------------------------------------------------------------------
 * The no-fabrication guarantee (FR-002/FR-003, SC-005): a citation to a
 * non-retrieved id is dropped, and a grounded answer left with zero valid
 * citations is converted to a refusal.
 */

import { describe, expect, it } from "vitest";
import type { Chunk } from "../src/corpus/corpus.js";
import type { RetrievedChunk } from "../src/retrieval/retriever.js";
import {
  answer,
  renderInlineCitations,
  validateCitations,
} from "../src/rag/answer.js";
import { NOT_LEGAL_ADVICE_NOTICE } from "../src/rag/notice.js";
import { FakeEmbeddingProvider, FakeLLMProvider } from "./fakes.js";

const chunk = (id: string, article: string): Chunk => ({
  id,
  regulation: "GDPR",
  type: "article",
  article_number: article,
  article_title: "Lawfulness of processing",
  text: "Processing shall be lawful only if…",
  url: `https://eur-lex.europa.eu/x#art_${article}`,
});

const retrieved: RetrievedChunk[] = [
  { chunk: chunk("gdpr-art-6-1", "6"), score: 0.82, rank: 1 },
  { chunk: chunk("gdpr-art-7", "7"), score: 0.74, rank: 2 },
];

const fakeRetriever = (result: RetrievedChunk[]) => async () => result;
const embedder = new FakeEmbeddingProvider();

describe("validateCitations (T015)", () => {
  it("keeps retrieved ids, drops fabricated/non-retrieved ids, dedupes", () => {
    const { citations, rejected } = validateCitations(
      ["gdpr-art-6-1", "gdpr-art-6-1", "gdpr-art-99", "aiact-art-5"],
      retrieved,
    );
    expect(citations.map((c) => c.chunk_id)).toEqual(["gdpr-art-6-1"]);
    expect(citations[0].label).toBe("GDPR Art. 6");
    expect(citations[0].url).toContain("art_6");
    expect(rejected).toEqual(["gdpr-art-99", "aiact-art-5"]);
  });
});

describe("renderInlineCitations", () => {
  it("replaces valid markers with labels and strips rejected markers", () => {
    const { citations, rejected } = validateCitations(["gdpr-art-6-1", "gdpr-art-99"], retrieved);
    const text = renderInlineCitations(
      "Lawful bases are listed [gdpr-art-6-1]. Something invented [gdpr-art-99].",
      citations,
      rejected,
    );
    expect(text).toContain("[GDPR Art. 6]");
    expect(text).not.toContain("gdpr-art-99");
  });

  it("handles several ids grouped in one bracket, dropping rejected ones", () => {
    const { citations, rejected } = validateCitations(
      ["gdpr-art-6-1", "gdpr-art-7", "gdpr-art-99"],
      retrieved,
    );
    const text = renderInlineCitations(
      "Both bases are defined [gdpr-art-6-1, gdpr-art-7, gdpr-art-99]. See [note 1].",
      citations,
      rejected,
    );
    expect(text).toContain("[GDPR Art. 6; GDPR Art. 7]");
    expect(text).not.toContain("gdpr-art-99");
    expect(text).toContain("[note 1]"); // non-citation brackets untouched
  });

  it("handles semicolon-separated id groups", () => {
    const { citations, rejected } = validateCitations(["gdpr-art-6-1", "gdpr-art-7"], retrieved);
    const text = renderInlineCitations(
      "Both bases are defined [gdpr-art-6-1; gdpr-art-7].",
      citations,
      rejected,
    );
    expect(text).toContain("[GDPR Art. 6; GDPR Art. 7]");
    expect(text).not.toContain("gdpr-art-6-1");
  });
});

describe("answer() grounding invariant", () => {
  it("keeps only valid citations when the model cites a fabricated id", async () => {
    const llm = new FakeLLMProvider([
      JSON.stringify({
        mode: "answer",
        answer: "Lawful bases are defined [gdpr-art-6-1] and elsewhere [gdpr-art-99].",
        cited_ids: ["gdpr-art-6-1", "gdpr-art-99"],
      }),
    ]);
    const res = await answer(
      { question: "lawful bases?" },
      { retriever: fakeRetriever(retrieved), llm, embedder },
    );
    expect(res.mode).toBe("grounded");
    expect(res.citations.map((c) => c.chunk_id)).toEqual(["gdpr-art-6-1"]);
    expect(res.text).not.toContain("gdpr-art-99");
    expect(res.not_legal_advice_notice).toBe(NOT_LEGAL_ADVICE_NOTICE);
  });

  it("converts a zero-valid-citation answer to a refusal", async () => {
    const llm = new FakeLLMProvider([
      JSON.stringify({
        mode: "answer",
        answer: "Confident claim with no basis [gdpr-art-99].",
        cited_ids: ["gdpr-art-99"],
      }),
    ]);
    const res = await answer(
      { question: "anything" },
      { retriever: fakeRetriever(retrieved), llm, embedder },
    );
    expect(res.mode).toBe("refused");
    expect(res.citations).toEqual([]);
    expect(res.text).toContain("GDPR");
    expect(res.not_legal_advice_notice).toBe(NOT_LEGAL_ADVICE_NOTICE);
  });

  it("refuses on empty retrieval without calling the model", async () => {
    const llm = new FakeLLMProvider(["should never be used"]);
    const res = await answer(
      { question: "CCPA rights?" },
      { retriever: fakeRetriever([]), llm, embedder },
    );
    expect(res.mode).toBe("refused");
    expect(llm.callCount).toBe(0);
    expect(res.text).toContain("GDPR");
  });
});

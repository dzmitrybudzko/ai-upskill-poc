/**
 * tests/refusal.test.ts
 * -----------------------------------------------------------------------------
 * Refusal paths (FR-004/FR-005, Principle III): empty retrieval, sub-threshold
 * top score, and advice-framed questions — all refuse, all state coverage, none
 * fabricate.
 */

import { describe, expect, it } from "vitest";
import type { Chunk } from "../src/corpus/corpus.js";
import type { RetrievedChunk } from "../src/retrieval/retriever.js";
import { answer } from "../src/rag/answer.js";
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

const retrievedWithTopScore = (score: number): RetrievedChunk[] => [
  { chunk: chunk("gdpr-art-6-1", "6"), score, rank: 1 },
  { chunk: chunk("gdpr-art-7", "7"), score: score - 0.05, rank: 2 },
];

const fakeRetriever = (result: RetrievedChunk[]) => async () => result;
const embedder = new FakeEmbeddingProvider();

describe("refusal on weak retrieval (T018, FR-004)", () => {
  it("refuses on empty retrieval, stating coverage, without calling the model", async () => {
    const llm = new FakeLLMProvider(["never used"]);
    const res = await answer(
      { question: "CCPA rights?", refusalMinScore: 0.25 },
      { retriever: fakeRetriever([]), llm, embedder },
    );
    expect(res.mode).toBe("refused");
    expect(res.text).toContain("GDPR (Regulation (EU) 2016/679)");
    expect(res.text).toContain("EU AI Act (Regulation (EU) 2024/1689)");
    expect(llm.callCount).toBe(0);
  });

  it("refuses when the top score is below the configured floor", async () => {
    const llm = new FakeLLMProvider(["never used"]);
    const res = await answer(
      { question: "something barely related", refusalMinScore: 0.25 },
      { retriever: fakeRetriever(retrievedWithTopScore(0.1)), llm, embedder },
    );
    expect(res.mode).toBe("refused");
    expect(res.citations).toEqual([]);
    expect(res.text).toContain("weakly related");
    expect(llm.callCount).toBe(0);
    expect(res.not_legal_advice_notice).toBe(NOT_LEGAL_ADVICE_NOTICE);
  });

  it("proceeds to synthesis when the top score meets the floor", async () => {
    const llm = new FakeLLMProvider([
      JSON.stringify({ mode: "answer", answer: "Lawful [gdpr-art-6-1].", cited_ids: ["gdpr-art-6-1"] }),
    ]);
    const res = await answer(
      { question: "lawful bases?", refusalMinScore: 0.25 },
      { retriever: fakeRetriever(retrievedWithTopScore(0.8)), llm, embedder },
    );
    expect(res.mode).toBe("grounded");
    expect(llm.callCount).toBe(1);
  });
});

describe("advice-framed handling (T019, FR-005)", () => {
  it("states what the text says, marked as refusal, sources inline, no Citation entries", async () => {
    const llm = new FakeLLMProvider([
      JSON.stringify({
        mode: "advice",
        answer:
          "Art. 6 lists consent and legitimate interests as available bases [gdpr-art-6-1]. I can't recommend which one you should use.",
        cited_ids: ["gdpr-art-6-1"],
      }),
    ]);
    const res = await answer(
      { question: "Should we use consent or legitimate interest for marketing?", refusalMinScore: 0.25 },
      { retriever: fakeRetriever(retrievedWithTopScore(0.8)), llm, embedder },
    );
    expect(res.mode).toBe("refused"); // treated as refusal (FR-005)
    expect(res.text).toContain("[GDPR Art. 6]"); // grounded statement of the text, label rendered
    expect(res.text).toContain("can't recommend");
    expect(res.citations).toEqual([]); // refusals carry no Citation entries (data-model)
    expect(res.not_legal_advice_notice).toBe(NOT_LEGAL_ADVICE_NOTICE);
  });
});

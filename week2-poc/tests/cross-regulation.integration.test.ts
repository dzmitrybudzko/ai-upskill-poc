/**
 * tests/cross-regulation.integration.test.ts
 * -----------------------------------------------------------------------------
 * US5 (FR-008): with no regulation filter, retrieval spans both regulations and
 * the answer path produces citations from both. Real LanceDB over a temp index,
 * fake providers (live cross-regulation quality is measured by `rag eval` on
 * the cross_regulation golden group).
 */

import { beforeAll, describe, expect, it } from "vitest";
import { answer } from "../src/rag/answer.js";
import { buildSystemPrompt } from "../src/rag/prompt.js";
import { EchoCitingLLMProvider } from "./fakes.js";
import { buildTestIndex } from "./integration-helpers.js";

let ctx: Awaited<ReturnType<typeof buildTestIndex>>;

beforeAll(async () => {
  ctx = await buildTestIndex("crossreg");
}, 60_000);

describe("US5 — cross-regulation synthesis path", () => {
  it("no-filter retrieval can span both regulations and citations follow", async () => {
    // The fake embedder is not semantic, so ask with a large k to guarantee the
    // top-k crosses regulation boundaries — the property under test is that no
    // filter excludes either regulation and citations render from both.
    const res = await answer(
      { question: "personal data in AI systems", k: 40 },
      { retriever: ctx.retriever, llm: new EchoCitingLLMProvider(), embedder: ctx.embedder },
    );
    expect(res.mode).toBe("grounded");
    const regs = new Set(res.retrieved.map((r) => r.chunk.regulation));
    expect(regs).toEqual(new Set(["GDPR", "AI_ACT"]));
    expect(res.citations.some((c) => c.label.startsWith("GDPR"))).toBe(true);
    expect(res.citations.some((c) => c.label.startsWith("AI Act"))).toBe(true);
  });

  it("the synthesis prompt instructs multi-source synthesis across regulations", () => {
    expect(buildSystemPrompt()).toContain("CROSS-REGULATION");
  });

  it("a 'both regulations' question gets balanced retrieval even at small k", async () => {
    // Without balancing, the fake embedder's ranking routinely fills k=4 from
    // one regulation; the trigger phrase must force a split across both.
    const res = await answer(
      { question: "What do both regulations require about personal data?", k: 4 },
      { retriever: ctx.retriever, llm: new EchoCitingLLMProvider(), embedder: ctx.embedder },
    );
    const regs = new Set(res.retrieved.map((r) => r.chunk.regulation));
    expect(regs).toEqual(new Set(["GDPR", "AI_ACT"]));
  });
});

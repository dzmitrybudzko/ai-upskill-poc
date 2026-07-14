/**
 * tests/filters.integration.test.ts
 * -----------------------------------------------------------------------------
 * US4 (FR-007): filtered ask returns citations only from the selected
 * regulation/type. Real LanceDB retrieval over a temp index, fake providers.
 */

import { beforeAll, describe, expect, it } from "vitest";
import { answer } from "../src/rag/answer.js";
import { EchoCitingLLMProvider } from "./fakes.js";
import { buildTestIndex } from "./integration-helpers.js";

let ctx: Awaited<ReturnType<typeof buildTestIndex>>;
const llm = new EchoCitingLLMProvider();

beforeAll(async () => {
  ctx = await buildTestIndex("filters");
}, 60_000);

const ask = (filters: Parameters<typeof answer>[0]["filters"]) =>
  answer(
    { question: "obligations for data processing systems", k: 5, filters },
    { retriever: ctx.retriever, llm, embedder: ctx.embedder },
  );

describe("US4 — metadata filters end-to-end", () => {
  it("--reg AI_ACT: every retrieved and cited source is AI Act", async () => {
    const res = await ask({ regulation: "AI_ACT" });
    expect(res.mode).toBe("grounded");
    expect(res.retrieved.length).toBeGreaterThan(0);
    expect(res.retrieved.every((r) => r.chunk.regulation === "AI_ACT")).toBe(true);
    expect(res.citations.every((c) => c.label.startsWith("AI Act"))).toBe(true);
  });

  it("--reg GDPR: every retrieved and cited source is GDPR", async () => {
    const res = await ask({ regulation: "GDPR" });
    expect(res.retrieved.every((r) => r.chunk.regulation === "GDPR")).toBe(true);
    expect(res.citations.every((c) => c.label.startsWith("GDPR"))).toBe(true);
  });

  it("default scope excludes recitals; opting in can include them", async () => {
    const byDefault = await ask({});
    expect(byDefault.retrieved.every((r) => r.chunk.type !== "recital")).toBe(true);

    // With recitals on and annexes off, only articles+recitals are eligible.
    const withRecitals = await ask({ includeRecitals: true, includeAnnexes: false });
    expect(withRecitals.retrieved.every((r) => r.chunk.type !== "annex")).toBe(true);
  });
});

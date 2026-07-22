/**
 * tests/rejudge.test.ts
 * -----------------------------------------------------------------------------
 * Judge-agreement harness (rejudge.ts): answer rebuilding from a saved report
 * and the pure agreement stats. Offline — no providers involved.
 */

import { describe, expect, it } from "vitest";
import { agreementSummary, rebuildAnswer, type JudgeRun } from "../src/eval/rejudge.js";
import type { Chunk } from "../src/corpus/corpus.js";
import type { JudgeVerdict } from "../src/eval/judge.js";

const chunk = (id: string): Chunk =>
  ({
    id,
    regulation: "GDPR",
    kind: "article",
    article: "1",
    title: "t",
    text: `text of ${id}`,
    url: `https://example.test/${id}`,
  }) as unknown as Chunk;

const verdict = (fullyGrounded: boolean, groundedness = fullyGrounded ? 1 : 0.5): JudgeVerdict => ({
  groundedness,
  fullyGrounded,
  citationCorrectness: 1,
  relevance: 1,
  unsupportedClaims: [],
  incorrectCitations: [],
  notes: "",
});

describe("rebuildAnswer", () => {
  it("rebuilds the judge's view from saved text + retrieved ids", () => {
    const byId = new Map([chunk("a"), chunk("b")].map((c) => [c.id, c]));
    const answer = rebuildAnswer("the answer [a]", ["a", "b"], byId);
    expect(answer.text).toBe("the answer [a]");
    expect(answer.retrieved.map((r) => r.chunk.id)).toEqual(["a", "b"]);
  });

  it("fails loudly when a saved id is missing from the corpus", () => {
    expect(() => rebuildAnswer("x", ["ghost"], new Map())).toThrow(/not in the corpus/);
  });
});

describe("agreementSummary", () => {
  const runs: JudgeRun[] = [
    { judge: "j1", verdicts: { q1: verdict(true), q2: verdict(true), q3: verdict(false) } },
    { judge: "j2", verdicts: { q1: verdict(true), q2: verdict(false), q3: verdict(false) } },
    { judge: "j3", verdicts: { q1: verdict(true), q2: verdict(true), q3: verdict(false) } },
  ];

  it("computes per-judge SC-003 over the same answers", () => {
    const s = agreementSummary(runs);
    expect(s.perJudge.find((j) => j.judge === "j1")?.sc003).toBeCloseTo(2 / 3);
    expect(s.perJudge.find((j) => j.judge === "j2")?.sc003).toBeCloseTo(1 / 3);
  });

  it("flags split cases and counts unanimity", () => {
    const s = agreementSummary(runs);
    expect(s.cases.find((c) => c.question_id === "q2")?.unanimous).toBe(false);
    expect(s.cases.filter((c) => c.unanimous).map((c) => c.question_id)).toEqual(["q1", "q3"]);
    expect(s.unanimousShare).toBeCloseTo(2 / 3);
  });

  it("scores SC-003 by majority vote with 3+ judges", () => {
    const s = agreementSummary(runs);
    // q1: 3/3 grounded, q2: 2/3 grounded, q3: 0/3 → majority SC-003 = 2/3.
    expect(s.majoritySc003).toBeCloseTo(2 / 3);
  });

  it("returns null majority with fewer than 3 judges", () => {
    expect(agreementSummary(runs.slice(0, 2)).majoritySc003).toBeNull();
  });
});

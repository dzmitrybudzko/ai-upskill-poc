/**
 * tests/retriever.test.ts
 * -----------------------------------------------------------------------------
 * Retrieval filter semantics (FR-007, contracts/retrieval.md) — pure logic,
 * no index or network required.
 */

import { describe, expect, it } from "vitest";
import { buildWhereClause, rowToChunk } from "../src/retrieval/retriever.js";

describe("buildWhereClause (FR-007)", () => {
  it("default scope is articles + annexes, recitals excluded", () => {
    const where = buildWhereClause();
    expect(where).toContain("'article'");
    expect(where).toContain("'annex'");
    expect(where).not.toContain("'recital'");
    expect(where).not.toContain("regulation =");
  });

  it("recitals are included only on explicit opt-in", () => {
    expect(buildWhereClause({ includeRecitals: true })).toContain("'recital'");
    expect(buildWhereClause({ includeRecitals: false })).not.toContain("'recital'");
  });

  it("annexes can be excluded", () => {
    expect(buildWhereClause({ includeAnnexes: false })).not.toContain("'annex'");
    // Articles are always searched.
    expect(buildWhereClause({ includeAnnexes: false })).toContain("'article'");
  });

  it("--reg restricts to a single regulation", () => {
    expect(buildWhereClause({ regulation: "AI_ACT" })).toContain("regulation = 'AI_ACT'");
    expect(buildWhereClause({ regulation: "GDPR" })).toContain("regulation = 'GDPR'");
  });
});

describe("rowToChunk", () => {
  it("maps '' placeholders back to undefined and keeps real values", () => {
    const chunk = rowToChunk({
      id: "gdpr-art-6-1",
      regulation: "GDPR",
      type: "article",
      chapter: "CHAPTER II — Principles",
      article_number: "6",
      article_title: "Lawfulness of processing",
      annex_number: "",
      annex_title: "",
      paragraph: "1",
      text: "Processing shall be lawful only if…",
      url: "https://eur-lex.europa.eu/…#art_6",
      _distance: 0.12,
    });
    expect(chunk.annex_number).toBeUndefined();
    expect(chunk.annex_title).toBeUndefined();
    expect(chunk.article_number).toBe("6");
    expect(chunk.paragraph).toBe("1");
    expect(chunk).not.toHaveProperty("_distance");
  });
});

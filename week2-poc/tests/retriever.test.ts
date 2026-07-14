/**
 * tests/retriever.test.ts
 * -----------------------------------------------------------------------------
 * Retrieval filter semantics (FR-007, contracts/retrieval.md) — pure logic,
 * no index or network required.
 */

import { describe, expect, it } from "vitest";
import {
  asksBothRegulations,
  buildWhereClause,
  parseExplicitReferences,
  rowToChunk,
} from "../src/retrieval/retriever.js";

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

describe("parseExplicitReferences (exact-reference lookups)", () => {
  it("parses 'GDPR Article 22'", () => {
    expect(parseExplicitReferences("What does GDPR Article 22 say?")).toEqual([
      { regulation: "GDPR", article: "22" },
    ]);
  });

  it("parses 'Art. 10 of the AI Act'", () => {
    expect(parseExplicitReferences("Summarize Art. 10 of the AI Act")).toEqual([
      { regulation: "AI_ACT", article: "10" },
    ]);
  });

  it("parses annexes with roman numerals", () => {
    expect(parseExplicitReferences("Which uses are listed in AI Act Annex III?")).toEqual([
      { regulation: "AI_ACT", annex: "III" },
    ]);
  });

  it("leaves regulation open when both or neither are named", () => {
    expect(parseExplicitReferences("Compare Article 6 in the GDPR and the AI Act")).toEqual([
      { regulation: undefined, article: "6" },
    ]);
    expect(parseExplicitReferences("What does Article 22 say?")).toEqual([
      { regulation: undefined, article: "22" },
    ]);
  });

  it("returns nothing for topical questions", () => {
    expect(parseExplicitReferences("What are the lawful bases for processing?")).toEqual([]);
  });
});

describe("asksBothRegulations (US5 balanced retrieval trigger)", () => {
  it("detects questions naming both regulations", () => {
    expect(asksBothRegulations("What do the GDPR and the AI Act require?")).toBe(true);
    expect(asksBothRegulations("what do both regulations require?")).toBe(true);
    expect(asksBothRegulations("transparency duties under both regimes")).toBe(true);
    expect(asksBothRegulations("what do the two regulations require regarding the data?")).toBe(true);
  });

  it("stays off for single-regulation or topical questions", () => {
    expect(asksBothRegulations("What are the lawful bases under the GDPR?")).toBe(false);
    expect(asksBothRegulations("Which AI uses are high-risk?")).toBe(false);
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

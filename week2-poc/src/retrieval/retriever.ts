/**
 * retrieval/retriever.ts
 * -----------------------------------------------------------------------------
 * Top-k cosine search with metadata filtering (contracts/retrieval.md, FR-007).
 *
 * Default scope: articles + annexes; recitals only when opted in. Empty results
 * are the caller's grounds for refusal (Principle III) — never an error here.
 */

import * as lancedb from "@lancedb/lancedb";
import type { Chunk, ChunkType, Regulation } from "../corpus/corpus.js";
import type { EmbeddingProvider } from "../providers/types.js";
import { INDEX_PATH, TABLE_NAME } from "./build-index.js";

export interface RetrievalFilters {
  regulation?: Regulation;
  includeRecitals?: boolean; // default false (FR-007)
  includeAnnexes?: boolean; // default true
}

export interface RetrievedChunk {
  chunk: Chunk;
  score: number; // cosine similarity, higher is better
  rank: number; // 1-based
}

export type Retriever = (
  question: string,
  opts?: { k?: number; filters?: RetrievalFilters },
) => Promise<RetrievedChunk[]>;

/**
 * SQL-like predicate for LanceDB from the retrieval flags. Exported pure so
 * the filter semantics are unit-testable without an index (T011).
 */
export function buildWhereClause(filters: RetrievalFilters = {}): string {
  const types: ChunkType[] = ["article"];
  if (filters.includeAnnexes !== false) types.push("annex");
  if (filters.includeRecitals === true) types.push("recital");
  const parts = [`type IN (${types.map((t) => `'${t}'`).join(", ")})`];
  if (filters.regulation) parts.push(`regulation = '${filters.regulation}'`);
  return parts.join(" AND ");
}

export interface ExplicitReference {
  regulation?: Regulation;
  article?: string;
  annex?: string;
}

/**
 * Parse explicit article/annex references from a question, e.g. "What does
 * GDPR Article 22 say?", "AI Act Annex III". Exact-reference lookups carry
 * little topical signal, so pure vector search ranks neighbouring articles
 * above the named one; these references are resolved by metadata instead and
 * pinned ahead of the vector results. Exported pure for unit testing.
 */
export function parseExplicitReferences(question: string): ExplicitReference[] {
  const mentionsGdpr = /\bgdpr\b/i.test(question);
  const mentionsAiAct = /\bai[\s-]?act\b/i.test(question);
  // Attribute references only when exactly one regulation is named.
  const regulation: Regulation | undefined =
    mentionsGdpr && !mentionsAiAct ? "GDPR" : mentionsAiAct && !mentionsGdpr ? "AI_ACT" : undefined;

  const refs: ExplicitReference[] = [];
  for (const m of question.matchAll(/\bart(?:icle|\.)?\s*(\d+[a-z]?)\b/gi)) {
    refs.push({ regulation, article: m[1] });
  }
  for (const m of question.matchAll(/\bannex\s+([ivxlcdm]+|\d+)\b/gi)) {
    refs.push({ regulation, annex: m[1].toUpperCase() });
  }
  return refs;
}

/** Map a LanceDB row back to a Chunk ("" placeholders → undefined). */
export function rowToChunk(row: Record<string, unknown>): Chunk {
  const opt = (v: unknown) => (v === "" || v == null ? undefined : (v as string));
  return {
    id: row.id as string,
    regulation: row.regulation as Regulation,
    type: row.type as ChunkType,
    chapter: opt(row.chapter),
    article_number: opt(row.article_number),
    article_title: opt(row.article_title),
    annex_number: opt(row.annex_number),
    annex_title: opt(row.annex_title),
    paragraph: opt(row.paragraph),
    text: row.text as string,
    url: row.url as string,
  };
}

export async function retrieve(
  question: string,
  opts: { k?: number; filters?: RetrievalFilters },
  embedder: EmbeddingProvider,
  indexPath: string = INDEX_PATH,
): Promise<RetrievedChunk[]> {
  const k = opts.k ?? 5;
  const [vector] = await embedder.embed([question]);

  const db = await lancedb.connect(indexPath);
  const table = await db.openTable(TABLE_NAME);

  // Explicitly referenced articles/annexes are resolved by metadata and pinned
  // first (score 1 = exact reference). User filters still apply, so a pinned
  // lookup can never smuggle in an excluded type/regulation.
  const pinned: Record<string, unknown>[] = [];
  for (const ref of parseExplicitReferences(question).slice(0, 3)) {
    const clauses = [buildWhereClause(opts.filters)];
    if (ref.article) clauses.push(`type = 'article' AND article_number = '${ref.article}'`);
    if (ref.annex) clauses.push(`type = 'annex' AND annex_number = '${ref.annex}'`);
    if (ref.regulation) clauses.push(`regulation = '${ref.regulation}'`);
    const rows = (await table
      .query()
      .where(clauses.join(" AND "))
      .limit(4)
      .toArray()) as Record<string, unknown>[];
    pinned.push(...rows);
  }
  const pinnedIds = new Set(pinned.map((r) => r.id as string));

  const vectorRows = (await table
    .vectorSearch(vector)
    .distanceType("cosine")
    .where(buildWhereClause(opts.filters))
    .limit(k)
    .toArray()) as Record<string, unknown>[];

  const results: RetrievedChunk[] = [
    ...pinned.map((row) => ({ chunk: rowToChunk(row), score: 1 })),
    ...vectorRows
      .filter((row) => !pinnedIds.has(row.id as string))
      // LanceDB reports cosine DISTANCE; similarity = 1 - distance.
      .map((row) => ({ chunk: rowToChunk(row), score: 1 - (row._distance as number) })),
  ];
  return results.slice(0, Math.max(k, pinned.length)).map((r, i) => ({ ...r, rank: i + 1 }));
}

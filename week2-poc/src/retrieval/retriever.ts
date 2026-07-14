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
  const rows = (await table
    .vectorSearch(vector)
    .distanceType("cosine")
    .where(buildWhereClause(opts.filters))
    .limit(k)
    .toArray()) as Record<string, unknown>[];

  return rows.map((row, i) => ({
    chunk: rowToChunk(row),
    // LanceDB reports cosine DISTANCE; similarity = 1 - distance.
    score: 1 - (row._distance as number),
    rank: i + 1,
  }));
}

/**
 * eval/metrics.ts
 * -----------------------------------------------------------------------------
 * Deterministic retrieval & citation metrics (FR-009, research.md §6).
 *
 * Matching is metadata-based at article/annex level: a chunk matches an
 * expected source key ("gdpr-art-6", "aiact-anx-III") when regulation and
 * article/annex number agree — robust to paragraph-level chunk splitting.
 */

import type { Chunk } from "../corpus/corpus.js";
import type { Answer } from "../rag/answer.js";
import type { RetrievedChunk } from "../retrieval/retriever.js";

/** Article/annex-level key for a chunk, the golden set's expected_sources unit. */
export function sourceKey(chunk: Chunk): string {
  const prefix = chunk.regulation === "GDPR" ? "gdpr" : "aiact";
  if (chunk.type === "annex") return `${prefix}-anx-${chunk.annex_number}`;
  if (chunk.type === "article") return `${prefix}-art-${chunk.article_number}`;
  return chunk.id; // recitals: one chunk per recital, id is already the key
}

/** SC-002: any expected source present in the top-k retrieved set. */
export function hitAtK(expectedSources: string[], retrieved: RetrievedChunk[]): boolean {
  if (expectedSources.length === 0) return false;
  const keys = new Set(retrieved.map((r) => sourceKey(r.chunk)));
  return expectedSources.some((e) => keys.has(e));
}

/** Reciprocal rank of the first retrieved chunk matching any expected source (for MRR). */
export function reciprocalRank(expectedSources: string[], retrieved: RetrievedChunk[]): number {
  for (const r of retrieved) {
    if (expectedSources.includes(sourceKey(r.chunk))) return 1 / r.rank;
  }
  return 0;
}

/** SC-004: does the answer cite (at least one of) the expected primary source(s)? */
export function citesExpectedSource(answer: Answer, expectedSources: string[]): boolean {
  if (expectedSources.length === 0) return false;
  const byId = new Map(answer.retrieved.map((r) => [r.chunk.id, r.chunk]));
  return answer.citations.some((c) => {
    const chunk = byId.get(c.chunk_id);
    return chunk !== undefined && expectedSources.includes(sourceKey(chunk));
  });
}

/**
 * SC-005: citations pointing outside the retrieved set. The validator makes
 * this structurally impossible; the eval still counts it independently so the
 * guarantee is measured, not assumed.
 */
export function fabricatedCitationCount(answer: Answer): number {
  const retrievedIds = new Set(answer.retrieved.map((r) => r.chunk.id));
  return answer.citations.filter((c) => !retrievedIds.has(c.chunk_id)).length;
}

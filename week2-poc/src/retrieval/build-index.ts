/**
 * retrieval/build-index.ts
 * -----------------------------------------------------------------------------
 * Embed every corpus chunk and (re)build the LanceDB dataset at data/index/
 * (contracts/retrieval.md). Idempotent: the index is disposable and rebuilt
 * from data/corpus.json (Principle VII).
 */

import * as lancedb from "@lancedb/lancedb";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { type Chunk, embeddingText } from "../corpus/corpus.js";
import type { EmbeddingProvider } from "../providers/types.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
export const INDEX_PATH = join(__dirname, "..", "..", "data", "index");
export const TABLE_NAME = "chunks";

/** Embedding API batch size — 1,354 chunks → ~22 calls. */
const BATCH_SIZE = 64;

/**
 * LanceDB rows need a uniform schema, so optional metadata is stored as ""
 * and mapped back to undefined on read (retriever.ts).
 */
export function chunkToRow(chunk: Chunk, vector: number[]): Record<string, unknown> {
  return {
    vector,
    id: chunk.id,
    regulation: chunk.regulation,
    type: chunk.type,
    chapter: chunk.chapter ?? "",
    article_number: chunk.article_number ?? "",
    article_title: chunk.article_title ?? "",
    annex_number: chunk.annex_number ?? "",
    annex_title: chunk.annex_title ?? "",
    paragraph: chunk.paragraph ?? "",
    text: chunk.text,
    url: chunk.url,
  };
}

export async function buildIndex(
  corpus: Chunk[],
  embedder: EmbeddingProvider,
  opts: { indexPath?: string; onProgress?: (done: number, total: number) => void } = {},
): Promise<{ count: number }> {
  const indexPath = opts.indexPath ?? INDEX_PATH;
  const rows: Record<string, unknown>[] = [];

  for (let i = 0; i < corpus.length; i += BATCH_SIZE) {
    const batch = corpus.slice(i, i + BATCH_SIZE);
    const vectors = await embedder.embed(batch.map(embeddingText));
    batch.forEach((chunk, j) => rows.push(chunkToRow(chunk, vectors[j])));
    opts.onProgress?.(Math.min(i + BATCH_SIZE, corpus.length), corpus.length);
  }

  const db = await lancedb.connect(indexPath);
  await db.createTable(TABLE_NAME, rows, { mode: "overwrite" });
  return { count: rows.length };
}

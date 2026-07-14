/**
 * tests/integration-helpers.ts
 * -----------------------------------------------------------------------------
 * Shared setup for integration tests: a real LanceDB index over a mixed corpus
 * subset (both regulations, all three chunk types), embedded with the fake
 * embedder — deterministic, offline, no Dial.
 */

import { join } from "node:path";
import { tmpdir } from "node:os";
import { loadCorpus, type Chunk } from "../src/corpus/corpus.js";
import { buildIndex } from "../src/retrieval/build-index.js";
import { retrieve, type RetrievalFilters, type RetrievedChunk } from "../src/retrieval/retriever.js";
import type { EmbeddingProvider } from "../src/providers/types.js";
import { FakeEmbeddingProvider } from "./fakes.js";

const take = (chunks: Chunk[], pred: (c: Chunk) => boolean, n: number) =>
  chunks.filter(pred).slice(0, n);

/** Build a small mixed-regulation index in a temp dir; returns a bound retriever. */
export async function buildTestIndex(name: string): Promise<{
  indexPath: string;
  embedder: EmbeddingProvider;
  retriever: (
    question: string,
    opts: { k?: number; filters?: RetrievalFilters },
    embedder: EmbeddingProvider,
  ) => Promise<RetrievedChunk[]>;
}> {
  const corpus = loadCorpus();
  const subset = [
    ...take(corpus, (c) => c.regulation === "GDPR" && c.type === "article", 25),
    ...take(corpus, (c) => c.regulation === "GDPR" && c.type === "recital", 10),
    ...take(corpus, (c) => c.regulation === "AI_ACT" && c.type === "article", 25),
    ...take(corpus, (c) => c.regulation === "AI_ACT" && c.type === "annex", 10),
  ];
  const embedder = new FakeEmbeddingProvider();
  const indexPath = join(tmpdir(), `lance-it-${name}-${process.pid}`);
  await buildIndex(subset, embedder, { indexPath });
  return {
    indexPath,
    embedder,
    retriever: (question, opts, emb) => retrieve(question, opts, emb, indexPath),
  };
}

# Contract: Indexing & Retrieval

## Index build

```ts
/** Embed every corpus chunk and (re)build the LanceDB dataset at data/index/. */
buildIndex(corpus: Chunk[], embedder: EmbeddingProvider): Promise<{ count: number }>;
```

- Idempotent: rebuilds from `data/corpus.json`; `data/index/` is disposable.
- Each row = chunk metadata columns + `vector`. The embedded text is the chunk
  `text` prefixed with a short metadata header (regulation + citation label) to
  improve retrieval precision.

## Retrieve

```ts
interface RetrievalFilters {
  regulation?: "GDPR" | "AI_ACT";
  includeRecitals?: boolean;   // default false
  includeAnnexes?: boolean;    // default true
}

/** Top-k cosine search with metadata filtering. */
retrieve(
  question: string,
  opts: { k?: number; filters?: RetrievalFilters },
  embedder: EmbeddingProvider,
): Promise<RetrievedChunk[]>;
```

## Contract rules

- Default `k = 5`. Results sorted by descending cosine similarity, `rank` 1-based.
- `type` filter derived from flags: always include `article`; include `annex`
  unless `includeAnnexes === false`; include `recital` only if
  `includeRecitals === true` (FR-007).
- `regulation` filter, when set, restricts results to that regulation (FR-007;
  supports single-regulation stories). Cross-regulation queries pass no
  regulation filter so both are searched (User Story 5).
- Returns `[]` when nothing passes filters; the caller treats empty/low-score
  results as grounds for refusal (Principle III).

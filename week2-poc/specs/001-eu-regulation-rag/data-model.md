# Phase 1 Data Model

Entities derived from the spec. Types shown for clarity; these are design
contracts, not final code.

## Chunk *(existing — produced by ingestion)*

The corpus unit in `data/corpus.json`. Source of truth for retrieval and citations.

| Field | Type | Notes |
|-------|------|-------|
| `id` | string | unique, e.g. `gdpr-art-6-1`, `aiact-anx-III-1` |
| `regulation` | `"GDPR" \| "AI_ACT"` | filter key |
| `type` | `"article" \| "recital" \| "annex"` | filter key; recitals opt-in |
| `chapter` | string? | e.g. "CHAPTER II — Principles" |
| `article_number` | string? | e.g. "6" (articles) |
| `article_title` | string? | e.g. "Lawfulness of processing" |
| `annex_number` | string? | e.g. "III" (annex chunks) |
| `annex_title` | string? | annex chunks |
| `paragraph` | string? | point label, e.g. "1", "f" |
| `text` | string | the passage that gets embedded and cited |
| `url` | string | EUR-Lex deep link |

**Validation**: `id` unique; `regulation`+`type` always present; article chunks have `article_number`, annex chunks have `annex_number`.

## IndexedChunk

A `Chunk` plus its embedding, stored in LanceDB.

| Field | Type | Notes |
|-------|------|-------|
| `vector` | number[] | embedding of the metadata-headed `text` |
| ...all `Chunk` fields | | stored as columns for filtering + citation rendering |

**Derived**: `citation_label` — rendered from metadata (`"GDPR Art. 6(1)"`, `"AI Act Art. 16"`, `"AI Act Annex III"`). Relationship: 1 Chunk → 1 IndexedChunk.

## QuestionRequest

A user question plus optional retrieval scoping.

| Field | Type | Notes |
|-------|------|-------|
| `question` | string | natural language |
| `filters.regulation` | `"GDPR" \| "AI_ACT"`? | optional restrict |
| `filters.includeRecitals` | boolean | default `false` (FR-007) |
| `filters.includeAnnexes` | boolean | default `true` |
| `k` | number | default 5 |

Single-turn: no conversation history (FR-015).

## RetrievedChunk

Result of a retrieval query.

| Field | Type | Notes |
|-------|------|-------|
| `chunk` | Chunk | the matched chunk |
| `score` | number | cosine similarity |
| `rank` | number | 1-based |

## Answer

The assistant's response to a `QuestionRequest`.

| Field | Type | Notes |
|-------|------|-------|
| `mode` | `"grounded" \| "refused"` | refusal is a first-class outcome |
| `text` | string | answer prose, or the refusal message + coverage statement |
| `citations` | Citation[] | empty when refused |
| `retrieved` | RetrievedChunk[] | evidence considered (for transparency/eval) |
| `not_legal_advice_notice` | string | always present (FR-005/FR-014) |

**Invariant**: every substantive claim maps to a `Citation`; a `grounded` answer with zero valid citations is invalid and MUST be converted to `refused` (Principle I/II).

## Citation

Link between an answer and its supporting chunk.

| Field | Type | Notes |
|-------|------|-------|
| `chunk_id` | string | MUST exist in the retrieved set (validator enforces) |
| `label` | string | human citation, e.g. "GDPR Art. 6(1)(f)" |
| `url` | string | from chunk metadata |

## GoldenQuestion *(existing — `evals/golden-set.json`)*

| Field | Type | Notes |
|-------|------|-------|
| `id` | string | e.g. `g-001` |
| `group` | `"gdpr_factual" \| "aiact_factual" \| "cross_regulation" \| "refusal"` | |
| `question` | string | |
| `expected_sources` | string[] | article/annex-level ids; empty for refusal |
| `expected_behavior` | `"answer" \| "refuse"` | |
| `notes` | string | |

## EvalResult

Per-question and aggregate scoring.

| Field | Type | Notes |
|-------|------|-------|
| `question_id` | string | |
| `retrieval.hit_at_k` | boolean | expected source present in top-k |
| `retrieval.reciprocal_rank` | number | for MRR |
| `judge.groundedness` | 0..1 | |
| `judge.citation_correctness` | 0..1 | matches expected sources |
| `judge.relevance` | 0..1 | |
| `judge.refusal_correct` | boolean | for refusal-group / advice items |
| `behavior_match` | boolean | produced behavior == expected_behavior |

**Aggregate**: hit-rate@k, MRR, mean judge scores per group, refusal accuracy, count of fabricated citations (MUST be 0). Compared against Success Criteria thresholds.

## Relationships

`QuestionRequest → (retriever) → RetrievedChunk[] → (synthesis+validator) → Answer(+Citation[])`.
`GoldenQuestion → (pipeline) → Answer → (metrics+judge) → EvalResult → aggregate → gate`.

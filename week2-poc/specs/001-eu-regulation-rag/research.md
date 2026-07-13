# Phase 0 Research: Grounded RAG Assistant

All Technical Context unknowns resolved. Each decision: what, why, alternatives.

## 1. Vector store — LanceDB *(decided with user)*

- **Decision**: `@lancedb/lancedb`, embedded, persisted to `data/index/` (a Lance dataset directory), rebuildable from `corpus.json`.
- **Rationale**: Satisfies "no Docker, in-process, file-persisted". Ships prebuilt native binaries (smooth on Windows + Node 24), TypeScript-first API, native vector search plus SQL-like metadata filtering for the required regulation/type filters. Comfortably handles 1,354 vectors with headroom.
- **Alternatives considered**: `sqlite-vec` via `better-sqlite3` — lighter, single-file, SQL-native filters, but better-sqlite3 native compilation and loading the sqlite-vec extension can be fiddly on Windows/Node 24. Rejected for install-friction risk on this environment. (Both were presented to the user; LanceDB chosen.)

## 2. Embeddings & LLM access — EPAM Dial behind provider interfaces

- **Decision**: Use the official `openai` SDK configured with `baseURL = DIAL_BASE_URL` and `apiKey = DIAL_API_KEY`, wrapped by `EmbeddingProvider` and `LLMProvider` interfaces (`src/providers/`). EPAM Dial is OpenAI-compatible, so one implementation (`dial.ts`) covers chat + embeddings. Model/deployment names come from env: `DIAL_EMBEDDING_MODEL`, `DIAL_CHAT_MODEL`.
- **Rationale**: Directly satisfies Principle V (provider independence) with zero hardcoded vendor calls in core logic; swapping providers means a new implementation of the two interfaces, not edits at call sites. Using the OpenAI SDK against Dial's compatible endpoint avoids bespoke HTTP code.
- **Alternatives considered**: Raw `fetch` to Dial — more code, no real benefit. A heavyweight framework (LangChain/LlamaIndex) — too much abstraction for a PoC and would obscure the grounding/citation logic we must control explicitly. Rejected.
- **Open config (not architecture)**: exact Dial deployment names are environment-specific; documented in `.env.example`, defaults suggested (`text-embedding-3-small`, a capable chat model) but the user confirms what their Dial exposes.

## 3. Retrieval — cosine similarity, top-k, metadata filters

- **Decision**: Embed each chunk's `text` (prefixed with a short metadata header, e.g. regulation + citation label, to sharpen matching); store vector + metadata in LanceDB. Query embeds the question and retrieves top **k = 5** by cosine similarity. Metadata filters (regulation, type) applied as LanceDB `where` predicates. **Default retrieval covers `type` ∈ {article, annex}; recitals excluded unless opted in** (FR-007). Resolves the deferred `k`: **k = 5**, and hit-rate/MRR reported at k = 5 (also @3 for insight).
- **Rationale**: Cosine top-k over ~1,354 chunks is instant and standard. k=5 balances recall (expected source usually present) against prompt size for grounded synthesis. Embedding a metadata header improves retrieval of the right article.
- **Alternatives considered**: Hybrid lexical+vector (BM25 + embeddings) — deferred to the P3 rerank/rewrite story with a measured delta, not baseline. Larger k (10+) — dilutes the synthesis context and slows the judge; rejected as default.

## 4. Grounded synthesis, citation, and no-fabrication guarantee

- **Decision**: Build a system prompt encoding Principles I–IV (answer only from provided passages; cite the passages used; refuse if insufficient; not legal advice + advice-framing rule). The user prompt lists each retrieved chunk as `[id] <citation label> — <text> (url)`. The model returns an answer plus the chunk ids it used. A **citation validator** then (a) confirms every cited id was in the retrieved set (else the citation is rejected → answer fails grounding and is downgraded to a refusal), and (b) renders citations as human labels ("GDPR Art. 6(1)(f)", "AI Act Annex III") with links from chunk metadata.
- **Rationale**: Makes FR-002/FR-003 enforceable in code, not just by prompt — a fabricated or non-retrieved citation cannot survive. Directly serves the "zero fabricated citations" success criterion (SC-005).
- **Alternatives considered**: Trusting the model to self-cite without validation — rejected; that is exactly the failure mode this project exists to prevent.

## 5. Refusal strategy

- **Decision**: Refuse when (a) top-1 similarity is below a configurable floor (`REFUSAL_MIN_SCORE`), or (b) the model, per its instructions, judges the retrieved passages insufficient, or (c) the request is advice-framed (state text, decline to recommend — counts as refusal). Refusals state the assistant's coverage (GDPR + EU AI Act text, English).
- **Rationale**: Combines a cheap deterministic guard (similarity floor) with model judgment; tuned against the refusal group of the golden set. Serves Principle III and SC-001.
- **Alternatives considered**: Pure threshold (brittle) or pure model judgment (misses obvious out-of-corpus) — the combination is more robust. Floor default set provisionally and calibrated during eval.

## 6. Evaluation harness

- **Decision**: `npm run eval` runs the 40 golden questions end-to-end. **Retrieval metrics** — hit-rate@k and MRR — computed by matching each retrieved chunk's `regulation`+`article_number`/`annex_number` against the question's article/annex-level `expected_sources` (the metadata-based semantics documented in the golden set). **Answer-quality metrics** — an LLM-as-judge (Dial chat model, structured output validated by `zod`) scores groundedness, citation correctness, relevance, and refusal accuracy per question. Report is per-question + aggregate, written to `evals/results/` (gitignored) and printed. Thresholds = the spec's Success Criteria (SC-001…SC-006).
- **Rationale**: Directly implements Principle VI and User Story 3; metadata-based matching is robust to paragraph-level chunking. Judge with structured output makes scoring machine-checkable and regressions visible (FR-010).
- **Alternatives considered**: Exact-string source matching — brittle under chunk splitting; rejected in favor of metadata match. Human-only eval — not repeatable; rejected.

## 7. Baseline comparator (RAG vs no-RAG)

- **Decision**: `npm run baseline "<question>"` (and a golden-set mode) answers with retrieval and, separately, with the same model and no retrieved context, presenting both. The no-RAG path is expected to produce ungrounded/possibly fabricated article numbers, made visible next to the grounded, validated citations.
- **Rationale**: Implements User Story 6 / SC-006 and is the demo's core "why this matters" moment.

## 8. Supporting choices

- **CLI**: `commander` — clean subcommands (`index`, `ask`, `baseline`, `eval`); low overhead. Alternative `node:util.parseArgs` (zero-dep) rejected for multi-subcommand ergonomics.
- **Config & validation**: `zod` — one schema validates env config and the judge's structured output. Fails fast on missing `DIAL_*` vars.
- **Tests**: `vitest` — TS/ESM-native, fast; covers provider contract (mockable), retriever filters, citation validator, and metric functions.
- **Secrets/reproducibility**: `.env` (gitignored) with `.env.example` committed; `data/index/` and `evals/results/` gitignored and rebuildable; documented `npm run` scripts (Principle VII, SC-007).

## Resolved deferrals from clarify

- Retrieval `k` → **5** (metrics @5, also @3). | Eval thresholds → **the spec Success Criteria numbers**. | Vector store → **LanceDB**. | Provider config → env-driven, `.env.example` documents it.

**All NEEDS CLARIFICATION resolved. Ready for Phase 1.**

---
description: "Task list for feature 001 — Grounded RAG Assistant over GDPR & the EU AI Act"
---

# Tasks: Grounded RAG Assistant over GDPR & the EU AI Act

**Input**: Design documents from `specs/001-eu-regulation-rag/`

**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/, quickstart.md

**Tests**: Included selectively — the eval harness (US3) is a required deliverable, and a few high-value unit/contract tests are included where the constitution's quality gate (Principle VI) and provider-independence (Principle V) demand verification. Not full TDD.

**Organization**: Grouped by user story (priorities from spec.md). Paths are relative to `week2-poc/` (the feature repo root per plan.md).

## Format: `[ID] [P?] [Story] Description`

- **[P]**: parallelizable (different files, no dependency on an incomplete task)
- **[Story]**: US1–US8 (user-story phases only)

---

## Phase 1: Setup (Shared Infrastructure)

- [X] T001 Add runtime dependencies (`@lancedb/lancedb`, `openai`, `zod`, `commander`) and dev deps (`vitest`) to `package.json`; run `npm install`
- [X] T002 [P] Add npm scripts (`index`, `ask`, `baseline`, `eval`, `test`) to `package.json`
- [X] T003 [P] Create `.env.example` documenting `DIAL_BASE_URL`, `DIAL_API_KEY`, `DIAL_CHAT_MODEL`, `DIAL_EMBEDDING_MODEL`, optional `RAG_K`, `REFUSAL_MIN_SCORE` (no secrets)
- [X] T004 [P] Create `src/config.ts` — zod-validated env config loader (fails fast on missing `DIAL_*`; defaults `RAG_K=5`)

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Core infrastructure required before any answering/eval story. Blocks Phases 3+.

- [X] T005 Define provider interfaces `LLMProvider` and `EmbeddingProvider` in `src/providers/types.ts` (per contracts/providers.md)
- [X] T006 Implement `DialProvider` (chat + embeddings via `openai` SDK pointed at Dial) in `src/providers/dial.ts`, constructed from config only
- [X] T007 [P] Create corpus loader, `Chunk` type, and `citationLabel(chunk)` helper (metadata → "GDPR Art. 6(1)(f)" / "AI Act Annex III") in `src/corpus/corpus.ts`
- [X] T008 [P] Contract test: a fake in-memory provider satisfies the interfaces and core modules import only interfaces (no vendor SDK) in `tests/providers.contract.test.ts`
- [X] T009 Implement index build (embed each chunk's metadata-headed text → LanceDB dataset at `data/index/`) in `src/retrieval/build-index.ts` (per contracts/retrieval.md)
- [X] T010 Implement `retrieve()` — top-k cosine + metadata filters (default articles+annexes, recitals opt-in, optional regulation) in `src/retrieval/retriever.ts`
- [X] T011 [P] Unit test retriever filter logic (default scope excludes recitals; `--reg` restricts) in `tests/retriever.test.ts`

**Checkpoint**: index builds from `data/corpus.json`; `retrieve()` returns ranked, filtered chunks.

---

## Phase 3: User Story 1 — Grounded, cited answer (Priority: P1) 🎯 MVP

**Goal**: A question in → a grounded answer citing exact articles/annexes with links, or nothing fabricated.

**Independent test**: `rag ask "What are the lawful bases for processing personal data?"` cites GDPR Art. 6 with a link; every claim is cited; no citation to a non-retrieved id.

- [X] T012 [US1] Define `not_legal_advice_notice` constant wording and coverage statement in `src/rag/notice.ts` (resolves CHK003)
- [X] T013 [US1] Build synthesis prompt (system encodes Principles I–IV; user lists retrieved chunks as `[id] <label> — <text> (url)`) in `src/rag/prompt.ts`
- [X] T014 [US1] Implement `answer()` — retrieve → synthesize → parse cited ids in `src/rag/answer.ts` (per contracts/answer.md)
- [X] T015 [US1] Implement citation validator: reject any cited id not in the retrieved set; render valid ids → `Citation{label,url}`; zero valid citations ⇒ convert to refusal in `src/rag/answer.ts`
- [X] T016 [P] [US1] Unit test citation validator: fabricated/non-retrieved id is dropped and a zero-citation answer becomes a refusal in `tests/citation-validator.test.ts`
- [X] T017 [US1] Implement `rag ask "<question>"` CLI command (renders answer + citations + notice) in `src/cli/main.ts`

**Checkpoint**: MVP — grounded, cited answers with the no-fabrication guarantee.

---

## Phase 4: User Story 2 — Honest refusal outside the corpus (Priority: P1)

**Goal**: Decline out-of-corpus / weak-retrieval / advice-framed questions, stating coverage.

**Independent test**: the refusal group of the golden set is declined with a coverage statement and no fabricated citation.

- [X] T018 [US2] Add refusal branch to `answer()`: refuse when no results or top score < `REFUSAL_MIN_SCORE`, with a coverage statement (GDPR + EU AI Act, English) in `src/rag/answer.ts`
- [X] T019 [US2] Implement advice-framing handling: when text is in-corpus, state what the text says but decline to recommend, marked as refusal (FR-005, MUST) in `src/rag/answer.ts`
- [X] T020 [P] [US2] Unit test refusal paths (empty retrieval, sub-threshold score, advice-framed) in `tests/refusal.test.ts`

**Checkpoint**: refusals are explicit, scoped, and fabrication-free.

---

## Phase 5: User Story 3 — Automated eval harness (Priority: P1)

**Goal**: Score the assistant against the 40-question golden set; report metrics; gate on thresholds.

**Independent test**: `rag eval` prints per-group + aggregate metrics and exits non-zero if any Success Criterion fails.

- [X] T021 [P] [US3] Implement retrieval metrics (hit-rate@k, MRR) via article/annex-level metadata match to `expected_sources` in `src/eval/metrics.ts`
- [X] T022 [US3] Define judge rubrics (objective criteria for groundedness, citation correctness, relevance, refusal accuracy) and implement LLM judge with zod-structured output in `src/eval/judge.ts` (resolves CHK016)
- [X] T023 [US3] Implement `runEval()` — run golden set end-to-end, aggregate per group, compare to Success Criteria thresholds, write `evals/results/`, non-zero exit on failure in `src/eval/run-eval.ts`
- [X] T024 [P] [US3] Unit test metric functions (hit-rate@k, MRR, fabricated-citation counter) in `tests/metrics.test.ts`
- [X] T025 [US3] Implement `rag eval [--group]` CLI command in `src/cli/main.ts`

**Checkpoint**: the acceptance gate runs and reports; Principle VI enforceable.

---

## Phase 6: User Story 4 — Metadata filters (Priority: P2)

**Goal**: Scope queries by regulation and source type from the CLI.

**Independent test**: `rag ask "..." --reg AI_ACT` cites only AI Act sources; `--recitals` includes recitals.

- [X] T026 [US4] Wire CLI flags `--reg`, `--recitals`, `--no-annexes`, `-k` to `RetrievalFilters`/`k` in `src/cli/main.ts`
- [X] T027 [P] [US4] Integration test: filtered `ask` returns citations only from the selected regulation/type in `tests/filters.integration.test.ts`

---

## Phase 7: User Story 5 — Cross-regulation synthesis (Priority: P2)

**Goal**: Answer questions needing both regulations, citing each.

**Independent test**: the cross-regulation golden group yields answers citing both GDPR and AI Act sources.

- [X] T028 [US5] Ensure no-regulation-filter path retrieves from both regulations and the prompt instructs multi-source synthesis across regulations in `src/rag/prompt.ts` / `src/rag/answer.ts`
- [X] T029 [P] [US5] Integration test on the cross_regulation golden group (citations from both regulations) in `tests/cross-regulation.integration.test.ts`

---

## Phase 8: User Story 6 — Baseline comparator (Priority: P2)

**Goal**: Same question answered with and without retrieval, side by side.

**Independent test**: `rag baseline "What does GDPR Article 22 say?"` shows both; no-RAG may cite wrong/invented article numbers, RAG cites verifiably.

- [X] T030 [US6] Implement `baseline()` (same model, no retrieved context) in `src/rag/baseline.ts` (per contracts/answer.md)
- [X] T031 [US6] Implement `rag baseline "<question>"` CLI command with side-by-side rendering + notice in `src/cli/main.ts`
- [X] T032 [P] [US6] Add a baseline-vs-RAG check to the eval report demonstrating SC-006 in `src/eval/run-eval.ts`

---

## Phase 9: User Story 7 — Query rewriting / reranking with measured delta (Priority: P3, Stretch)

**Goal**: Optional retrieval enhancement with a before/after eval delta.

**Independent test**: eval report shows the metric delta attributable to the enhancement.

- [X] T033 [US7] Implement optional query rewrite and/or reranking behind a config flag in `src/retrieval/enhance.ts`
- [X] T034 [US7] Add before/after eval comparison mode reporting the metric delta in `src/eval/run-eval.ts` (measured 2026-07-16: rewriting hurts hit-rate −12.9 pts overall → RAG_ENHANCE stays off, per "keep only what improves the numbers")

---

## Phase 10: User Story 8 — Minimal web UI (Priority: P3, Stretch)

**Goal**: Minimal web surface over the same `answer()` path.

**Independent test**: submitting a question in the UI renders answer/citations/refusal + notice.

- [X] T035 [US8] Implement a minimal local web form calling `answer()` and rendering answer/citations/refusal + notice in `src/web/`

---

## Phase 11: Polish & Cross-Cutting Concerns

- [X] T036 Decide and document citation granularity (article-level vs. paragraph/point-level) and apply consistently in `citationLabel` + judge (resolves CHK007) in `src/corpus/corpus.ts`
- [X] T037 Calibrate `REFUSAL_MIN_SCORE` against the refusal group of the golden set; record chosen value in `.env.example` + research.md
- [X] T038 [P] Write `week2-poc/README.md` — clean-machine reproduction (install → parse-corpus → index → ask/eval), no Docker (SC-007)
- [X] T039 Run `rag eval` and confirm all Success Criteria thresholds pass (SC-001…SC-006); record results
- [X] T040 [P] Quickstart pass: execute each command in quickstart.md and confirm expected outcomes

---

## Phase 12: Convergence

- [ ] T041 Refuse non-English questions and requests for non-English answers, stating coverage of the English texts only (add a language rule to the synthesis prompt in `src/rag/prompt.ts` and a refusal-path test; verified live 2026-07-16: a French question is currently answered fluently in French) per Edge Cases (non-English) / Out of Scope (contradicts)
- [ ] T042 When a question asks about a GDPR annex, state that the GDPR has no annexes (only the AI Act does) instead of implying the annex merely wasn't retrieved (prompt note or deterministic branch on a GDPR-attributed annex reference in `src/rag/answer.ts`; verified live 2026-07-16) per Edge Cases (GDPR annex) (partial)

---

## Dependencies & Story Completion Order

- **Setup (P1-phase1)** → **Foundational (P2-phase2)** block everything.
- **US1 (P1)** is the MVP and depends only on Foundational.
- **US2 (P1)** extends US1's `answer()` (refusal branch) — do after US1.
- **US3 (P1)** depends on US1/US2 (needs the answer path to score).
- **US4, US5, US6 (P2)** depend on US1 (and US3 for their eval checks); independent of each other.
- **US7, US8 (P3)** depend on US3 (delta) / US1 (UI) respectively; optional.
- **Polish** last; T039 (eval gate) is the definition of done.

## Parallel Opportunities

- Setup: T002, T003, T004 in parallel after T001.
- Foundational: T007, T008 parallel; T011 parallel after T010.
- Within stories, `[P]` test tasks run alongside their implementation once the module exists.

## Implementation Strategy

- **MVP = Phases 1–3 (US1)**: grounded, cited answers with the no-fabrication guarantee.
- Then **US2 + US3** to complete the P1 core and stand up the acceptance gate (do not consider the build "done" until T039 passes — Principle VI).
- Then P2 stories (filters, cross-reg, baseline) for the demo, and P3 only if time remains.

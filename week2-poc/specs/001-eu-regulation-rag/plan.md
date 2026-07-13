# Implementation Plan: Grounded RAG Assistant over GDPR & the EU AI Act

**Branch**: `001-eu-regulation-rag` | **Date**: 2026-07-13 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `specs/001-eu-regulation-rag/spec.md`

## Summary

A single-turn, grounded RAG assistant answering compliance questions over the
GDPR and EU AI Act corpus (already built: 1,354 metadata-rich chunks). Retrieval
runs over an embedded, file-persisted **LanceDB** index; answer synthesis and the
LLM-as-judge run through **EPAM Dial** (OpenAI-compatible) behind swappable
`LLMProvider` / `EmbeddingProvider` interfaces. Every answer is grounded only in
retrieved chunks, cites exact articles/annexes with links, and refuses when the
corpus can't support an answer. An eval harness scores the assistant against the
40-question golden set (retrieval metrics + judged answer quality) and is the
acceptance gate. All TypeScript/Node, no Docker.

## Technical Context

**Language/Version**: TypeScript 5.7 on Node.js 24 (ESM, `"type": "module"`), run via `tsx`.

**Primary Dependencies**: `@lancedb/lancedb` (embedded vector store); `openai` SDK pointed at the EPAM Dial base URL (behind provider interfaces); `zod` (config + structured judge output validation); `vitest` (unit/contract tests); `commander` (CLI subcommands). `cheerio` remains for the completed ingestion script.

**Storage**: `data/corpus.json` is the source of truth (already produced). The search index is a LanceDB dataset directory at `data/index/` (embedded, file-persisted, gitignored, rebuildable from `corpus.json`).

**Testing**: `vitest` for unit/contract tests; the eval harness (`npm run eval`) is a standalone runnable that reports metrics against the golden set.

**Target Platform**: Node 24 CLI on a single machine (Windows/macOS/Linux). No containers.

**Project Type**: Single project — a CLI application over library modules.

**Performance Goals**: Interactive use. Retrieval over ~1,354 chunks is sub-second; end-to-end answer latency is dominated by the Dial LLM call (target < ~10 s per question). No throughput/concurrency target (single user).

**Constraints**: No Docker; embedded file-persisted vector store; all LLM/embedding access behind provider interfaces (no hardcoded vendor calls); secrets via `.env` (never committed); English-only corpus; every answer grounded + cited or an explicit refusal.

**Scale/Scope**: 1,354 corpus chunks (GDPR + AI Act, articles/recitals/annexes); 40 golden questions; single-user PoC.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| # | Principle | How the design satisfies it | Status |
|---|-----------|------------------------------|--------|
| I | Grounding (NON-NEGOTIABLE) | Synthesis receives ONLY retrieved chunks; system prompt forbids outside knowledge; empty/weak retrieval → refuse (never fabricate). | ✅ PASS |
| II | Citation | Prompt requires citing chunk ids → rendered as "GDPR Art. 6(1)(f)" / "AI Act Annex III" + link from chunk metadata; a post-synthesis validator drops/rejects any citation not in the retrieved set. | ✅ PASS |
| III | Explicit Refusal | Similarity floor + "insufficient evidence → refuse" instruction; refusal states coverage; judged by refusal-accuracy metric. | ✅ PASS |
| IV | Not Legal Advice | Fixed notice in system prompt AND on every surface; advice-framing → state text, decline to recommend (FR-005). | ✅ PASS |
| V | Provider Independence | `LLMProvider` / `EmbeddingProvider` interfaces; EPAM Dial is one implementation selected via config; no vendor calls in core logic. | ✅ PASS |
| VI | Evals Gate Quality (NON-NEGOTIABLE) | `npm run eval` scores golden set (hit-rate@k, MRR + judged groundedness/citation/relevance/refusal); thresholds = Success Criteria; regressions block merge. | ✅ PASS |
| VII | Reproducibility | `npm install` + documented commands rebuild corpus, index, and eval on a clean machine; LanceDB embedded; `.env` gitignored; no Docker. | ✅ PASS |

**Result: PASS — no violations.** Complexity Tracking left empty.

## Project Structure

### Documentation (this feature)

```text
specs/001-eu-regulation-rag/
├── plan.md              # This file
├── research.md          # Phase 0 output (tech decisions + rationale)
├── data-model.md        # Phase 1 output (entities)
├── quickstart.md        # Phase 1 output (runnable validation guide)
├── contracts/           # Phase 1 output (interface & CLI contracts)
│   ├── providers.md
│   ├── retrieval.md
│   ├── answer.md
│   ├── eval.md
│   └── cli.md
└── tasks.md             # Phase 2 (/speckit-tasks — NOT created here)
```

### Source Code (repository root = week2-poc/)

```text
week2-poc/
├── src/
│   ├── config.ts             # env-driven config (Dial base URL, model names, k, thresholds) via zod
│   ├── providers/            # Principle V — swappable AI access
│   │   ├── types.ts          # LLMProvider, EmbeddingProvider interfaces
│   │   └── dial.ts           # EPAM Dial (OpenAI-compatible) implementation
│   ├── corpus/
│   │   └── corpus.ts         # load & type corpus.json, citation-label helpers
│   ├── retrieval/
│   │   ├── build-index.ts    # embed chunks → LanceDB dataset
│   │   └── retriever.ts      # query + metadata filters (regulation, type)
│   ├── rag/
│   │   ├── prompt.ts         # system/user prompt construction (grounding, citation, not-advice)
│   │   ├── answer.ts         # synthesis + citation validation + refusal
│   │   └── baseline.ts       # no-RAG comparator
│   ├── eval/
│   │   ├── metrics.ts        # hit-rate@k, MRR from expected_sources vs retrieved metadata
│   │   ├── judge.ts          # LLM-as-judge (groundedness, citation, relevance, refusal)
│   │   └── run-eval.ts       # orchestrate golden-set run + report
│   └── cli/
│       └── main.ts           # commander CLI: index | ask | baseline | eval
├── scripts/parse-corpus.ts   # (existing) ingestion
├── data/corpus.json          # (existing) source of truth
├── data/index/               # LanceDB dataset (gitignored, rebuildable)
├── evals/golden-set.json     # (existing) acceptance gate
├── tests/                    # vitest unit/contract tests
├── .env.example              # documents required env vars (no secrets)
└── package.json
```

**Structure Decision**: Single project (Option 1). The feature is a CLI application composed of small library modules (`providers`, `retrieval`, `rag`, `eval`), which keeps the provider-independence and eval-gate boundaries explicit and independently testable. No web/mobile split (web UI is a P3 stretch and would attach to the same `rag` modules).

## Complexity Tracking

> No Constitution Check violations — this section is intentionally empty.

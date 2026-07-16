# Grounded RAG Assistant over the GDPR & the EU AI Act (PoC)

A single-turn assistant that answers compliance questions using **only** retrieved
passages from the official English texts of the GDPR (2016/679) and the EU AI Act
(2024/1689). Every substantive claim is cited to the exact article/annex with a
EUR-Lex deep link; questions the corpus can't support are **refused explicitly**;
advice-framed questions get "what the text says" but never a recommendation.
It is an information tool over regulation text, **not legal advice**.

Built spec-first with [Spec Kit](https://github.com/github/spec-kit) — see
`specs/001-eu-regulation-rag/` (spec → plan → tasks) and `.specify/memory/constitution.md`
for the seven governing principles.

## How it works

```text
question ──► retrieve (LanceDB, top-k cosine + metadata filters,
             explicit "Article N"/"Annex X" references pinned by metadata)
         ──► synthesize (Dial chat model; passages-only prompt)
         ──► validate citations (any id outside the retrieved set is dropped;
             zero valid citations ⇒ refusal)                      ──► answer/refusal
```

- **No fabrication by construction**: the citation validator makes a citation to a
  non-retrieved chunk impossible to emit (eval criterion SC-005 = 0, measured).
- **Provider independence**: all AI access goes through `LLMProvider` /
  `EmbeddingProvider` interfaces (`src/providers/`); EPAM Dial is the only
  vendor-aware module, selected via env config.
- **Evals gate quality**: `npm run eval` scores the 40-question golden set and
  exits non-zero unless every Success Criterion passes.

## Prerequisites

- Node.js 20.19+ / 22.x / 24.x (validated on Node 24).
- EPAM Dial API key. **Dial works under EPAM VPN only.** List the deployments
  your key can see: `curl -s "https://ai-proxy.lab.epam.com/openai/models" -H "Api-Key: $KEY"`.

## Setup (clean machine → working assistant)

```bash
cd week2-poc
npm install
cp .env.example .env        # fill in DIAL_* (see comments in the file)
npm run parse-corpus        # data/raw/*.xhtml → data/corpus.json (1,354 chunks)
npm run index               # embed corpus → LanceDB at data/index/
```

No Docker, no external database — the vector store is embedded and file-persisted;
`data/index/` and `evals/results/` are gitignored and rebuildable (Principle VII).

## Usage

```bash
# Grounded, cited answer (or explicit refusal)
npm run ask -- "What are the lawful bases for processing personal data?"

# Scope retrieval (FR-007): one regulation, recitals opt-in, annexes opt-out, depth
npm run ask -- "high-risk AI obligations" --reg AI_ACT
npm run ask -- "why does purpose limitation exist?" --recitals
npm run ask -- "prohibited practices" --no-annexes -k 8

# Same question with and without retrieval, side by side (US6)
npm run baseline -- "What does GDPR Article 22 say?"

# Minimal local web UI over the same answer() path (US8)
npm run web                 # http://localhost:3000

# The acceptance gate: golden set → per-group metrics + Success Criteria
npm run eval                # exits non-zero on failure
npm run eval -- --group refusal

# Optional query rewriting (US7): measure its metric delta, adopt via RAG_ENHANCE=true
npm run eval -- --compare

# Unit & integration tests (offline: fake providers + temp LanceDB indexes)
npm test
```

## Quality gate (Success Criteria, measured 2026-07-14)

| Criterion | Threshold | Result |
|-----------|-----------|--------|
| SC-001 Refusal accuracy (refusal group) | ≥ 90% | **100%** |
| SC-002 Hit-rate@5 (factual groups) | ≥ 85% | **100%** |
| SC-003 Fully grounded answers | ≥ 90% | **93.8%** (LLM-judge variance ≈ ±5 pts across runs) |
| SC-004 Cites expected primary source | ≥ 90% | **100%** |
| SC-005 Fabricated citations | = 0 | **0** |
| SC-006 Baseline hallucination demonstrated | yes | **yes** (memory cites the draft's "Art. 29" for deployer obligations; the enacted Act moved them to Art. 26) |

Behavior match (answer vs. refuse) is 100% on all four golden groups. Known
limit: SC-003 is judged by an LLM and moves a few points between runs.

**Query rewriting (US7) was built, measured, and left OFF.** `npm run eval --
--compare` (2026-07-16): rewriting the question before embedding *hurt*
retrieval — hit-rate@5 dropped 27.3 points on `aiact_factual` and 12.5 on
`cross_regulation` (SC-002 100% → 87.1%), with no meaningful gain elsewhere.
The regulation texts match the user's original phrasing (plus the metadata
header) better than LLM-expanded terminology, and rewriting dilutes the exact
words that reference pinning and the both-regulations heuristic key on. Per the
spec ("keep only what improves the numbers"), `RAG_ENHANCE` stays off by
default; the flag and the `--compare` harness remain for future experiments
(e.g. reranking instead of rewriting).

## Project structure

```text
src/
├── config.ts             # zod-validated env config (fails fast on missing DIAL_*)
├── providers/            # Principle V: types.ts (interfaces) + dial.ts (only vendor code)
├── corpus/corpus.ts      # corpus loading, Chunk type, citation labels
├── retrieval/            # build-index.ts (embed → LanceDB), retriever.ts (top-k + filters + reference pinning), enhance.ts (optional query rewriting)
├── rag/                  # prompt.ts, answer.ts (synthesis + citation validator + refusal), baseline.ts, notice.ts
├── eval/                 # metrics.ts (deterministic), judge.ts (enumeration rubric + verify pass), run-eval.ts (gate + --compare)
├── web/server.ts         # minimal local UI (node:http, no extra deps)
└── cli/main.ts           # rag index | ask | baseline | eval | web
scripts/parse-corpus.ts   # structure-aware ingestion (articles/recitals/annexes + EUR-Lex links)
data/corpus.json          # source of truth (committed); data/index/ is derived (gitignored)
evals/golden-set.json     # 40 labelled questions: the acceptance gate (committed)
tests/                    # vitest; contract/unit/integration — all offline
```

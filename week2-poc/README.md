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

## Model comparison (2026-07-21)

The chat model is swappable per run (`DIAL_CHAT_MODEL`); to compare models fairly
the eval judge is pinned separately via `DIAL_JUDGE_MODEL` (defaults to the chat
model), so SC-003/SC-006 are scored by one referee instead of each model judging
itself. Three full golden-set runs, judge = `gemini-2.5-pro` (strong and neutral
to both compared families):

| Model | Tier | SC-001 Refusal | SC-003 Grounded | Result |
|-------|------|----------------|-----------------|--------|
| claude-sonnet-4-5@20250929 | flagship | 100% | **100%** | **PASS** |
| gpt-4o (shipping default) | flagship | 100% | 90.6% | PASS |
| gpt-chat-latest | flagship | 75% | 100% | **FAIL** |
| gemini-2.5-flash | budget | 100% | **100%** | **PASS** ¹ |
| claude-haiku-4-5@20251001 | budget | 100% | 93.8% | **PASS** |
| gpt-4.1-mini-2025-04-14 | budget | 87.5% | 93.9% | **FAIL** |
| deepseek.v3.2 | budget | — | — | n/a ² |

All models that finished score 100% on SC-002 (hit-rate@5), SC-004 (cites
expected source), 0 on SC-005 (fabricated citations) and demonstrate SC-006.

¹ Same family as the judge (Gemini) — a same-family-leniency caveat applies.
² The `deepseek.v3.2` deployment consistently hangs on long synthesis requests
  (two attempts; short probes respond in ~3 s) — excluded as a Dial-side issue.

Findings:

- **`claude-sonnet-4-5@20250929` scores best** — the only model at 100% across
  all criteria. `gpt-4o` (shipping default) also passes, though under the
  stricter Gemini judge its groundedness reads 90.6% vs the 93.8% self-judged
  figure above — right at the threshold.
- **`claude-haiku-4-5` is the budget find**: a budget-tier model passing the
  full gate, including 100% refusals — the cost per answer can drop an order
  of magnitude without losing gate quality.
- **Both OpenAI non-flagship variants fail on refusals** (`gpt-chat-latest`
  answered 2 of 8 out-of-corpus questions — German BDSG, EDPB cookie-consent
  guidelines — from memory; `gpt-4.1-mini` missed 1 of 8). The
  answer-from-memory-instead-of-refusing tendency tracks the model family, not
  the size. Disqualifying for a grounded-answers-only assistant.
- Retrieval metrics are identical across all models (same embedding model), as
  expected: the chat model only affects synthesis and refusal judgment — which
  is exactly where the system's quality ceiling lives.
- Caveats: the personal Dial key can invoke only a small subset of the listed
  deployments (GPT-5.x and Sonnet 5 return 403, hence `gpt-chat-latest` and
  Sonnet 4.5 as stand-ins), and Vertex-hosted Claude routes ignore
  `response_format` and fence JSON in markdown — handled by `stripJsonFence`
  in `src/providers/dial.ts`.

Full reports live in `evals/results/`. To adopt Sonnet 4.5, set
`DIAL_CHAT_MODEL=claude-sonnet-4-5@20250929` — no other change needed.

### Judge agreement (2026-07-22)

SC-003 is scored by an LLM, so the judge itself is a variable worth measuring.
Eval reports save every answer verbatim (`answer_text` + `retrieved_ids`), and
`npm run rejudge -- --judges <a,b,c>` re-scores those exact answers with other
judges — no regeneration, so judge disagreement is isolated from answer
variance. A three-family panel over one gpt-4o run (31 answered cases):

| Judge | SC-003 | Mean groundedness |
|-------|--------|-------------------|
| gemini-2.5-pro | 96.8% | 0.995 |
| gpt-4o | 96.8% | 0.989 |
| claude-sonnet-4-5@20250929 | 90.3% | 0.986 |

Unanimous verdicts on 93.5% of cases; SC-003 under majority vote: **96.8%**.

- The judge-to-judge spread (90.3–96.8 pts) is comparable to the run-to-run
  spread of a single judge (90.6% → 93.5% for gemini-2.5-pro across two runs of
  the same config). The metric is stable, but **the 90% threshold sits inside
  the noise band** — a single run near the line is not a verdict; use the
  majority vote or a judge panel for report-grade numbers.
- Both disagreements were Sonnet flagging alone, and both flags are defensible
  under the rubric: one caught a definition imported from model memory (a real
  unsupported claim the other judges missed), one a dropped "sufficiently"
  qualifier. **Sonnet is the strictest, most rubric-literal judge available** —
  the right single judge when a conservative bound is wanted.

Full per-judge verdicts: `evals/results/rejudge-*.json`.

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

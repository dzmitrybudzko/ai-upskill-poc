# Quickstart & Validation Guide

Proves the feature works end-to-end on a clean machine (Principle VII, SC-007).
No Docker. See [contracts/](./contracts/) and [data-model.md](./data-model.md)
for details; this is a run guide, not implementation.

## Prerequisites

- Node.js 20.19+ or 22.x or 24.x (validated on Node 24).
- EPAM Dial access: base URL, API key, and the chat + embedding deployment names.

## Setup

```bash
cd week2-poc
npm install
cp .env.example .env      # then fill in the values below
```

`.env` (never committed):

```
DIAL_BASE_URL=...            # EPAM Dial OpenAI-compatible endpoint
DIAL_API_KEY=...
DIAL_CHAT_MODEL=...          # e.g. a Dial chat deployment
DIAL_EMBEDDING_MODEL=...     # e.g. text-embedding-3-small
# optional overrides: RAG_K=5, REFUSAL_MIN_SCORE=...
```

## Build the corpus & index

```bash
npm run parse-corpus        # (already done) → data/corpus.json (1,354 chunks)
npm run index               # embed chunks → data/index/ (LanceDB)
```
**Expected**: index reports ~1,354 chunks embedded with the configured model.

## Validate each user story

| Story | Command | Expected outcome |
|-------|---------|------------------|
| US1 Grounded answer | `npm run ask -- "What are the lawful bases for processing personal data?"` | Answer citing **GDPR Art. 6** with a link; every claim cited; + not-legal-advice notice. |
| US2 Refusal | `npm run ask -- "What are the CCPA consumer rights?"` | Explicit refusal stating coverage is GDPR + EU AI Act only; no fabricated citation. |
| US2 Advice-framing | `npm run ask -- "Should we use consent or legitimate interest for marketing?"` | States what Art 6/7 say about the options but declines to recommend; marked as refusal. |
| US4 Filter | `npm run ask -- "high-risk AI obligations" --reg AI_ACT` | All citations from the AI Act only. |
| US1 Annex | `npm run ask -- "Which AI uses are high-risk?"` | Cites **AI Act Annex III** (annexes on by default). |
| US5 Cross-reg | `npm run ask -- "We build an AI that scores people using personal data — what do both regulations require?"` | Cites articles from **both** GDPR and the AI Act. |
| US6 Baseline | `npm run baseline -- "What does GDPR Article 22 say?"` | Two answers side by side; no-RAG one may cite wrong/invented article numbers, RAG one cites verifiably. |
| US3 Eval gate | `npm run eval` | Per-group + aggregate metrics vs. thresholds; **exit 0** only if all Success Criteria pass. |

## Acceptance (maps to Success Criteria)

Running `npm run eval` reports and gates on:

- Refusal accuracy ≥ 90% (SC-001)
- Hit-rate@5 ≥ 85% (SC-002)
- Groundedness ≥ 90% (SC-003)
- Correct citation ≥ 90% (SC-004)
- Fabricated citations = 0 (SC-005)
- Baseline demonstrates the RAG advantage (SC-006)

A clean checkout + the commands above reproduces corpus, index, and eval with no
container tooling (SC-007).

## Reproducibility notes

- `data/index/` and `evals/results/` are gitignored and rebuildable; only
  `data/corpus.json`, `evals/golden-set.json`, and source are tracked.
- All AI access goes through `DIAL_*` config; swapping providers needs no code
  changes at call sites (Principle V).

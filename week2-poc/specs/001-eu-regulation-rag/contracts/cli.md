# Contract: CLI (commander)

Primary demo surface (FR-013). Single binary `rag` (via `npm run` / `tsx src/cli/main.ts`).

## Commands

```text
rag index [--force]
    Build/rebuild the LanceDB index from data/corpus.json.
    Output: chunk count indexed, embedding model used, index path.

rag ask "<question>" [--reg GDPR|AI_ACT] [--recitals] [--no-annexes] [-k <n>]
    Answer one question (single-turn). Prints the grounded answer with citations
    (label + link) OR an explicit refusal, always followed by the not-legal-advice
    notice.

rag baseline "<question>"
    Print two answers side by side: with retrieval (grounded, validated citations)
    and without retrieval (ungrounded). Demonstrates hallucinated vs. cited refs.

rag eval [-k <n>] [--group <name>]
    Run the golden set (or one group). Prints per-group + aggregate metrics and
    pass/fail vs. Success Criteria thresholds. Exits non-zero on failure.
```

## Contract rules

- Every `ask`/`baseline` output includes the not-legal-advice notice (FR-005/FR-014).
- Refusals render distinctly from answers and state coverage (Principle III).
- `--reg`, `--recitals`, `--no-annexes`, `-k` map to `RetrievalFilters` / `k`
  (default: annexes on, recitals off, k=5).
- Missing/invalid `DIAL_*` env → fail fast with a clear message (never a silent
  ungrounded fallback).
- Exit codes: `0` success; `eval` returns non-zero when a threshold fails.

## Optional web UI (P3 stretch, FR-013)

If built, a minimal single-page form calling the same `answer()` path; renders
answer/citations/refusal + notice. Not required; CLI is the acceptable surface.

# Contract: Evaluation Harness (Principle VI — the gate)

```ts
runEval(
  golden: GoldenQuestion[],
  deps: { answerFn; retriever; llm; embedder },
  opts?: { k?: number },
): Promise<EvalReport>;
```

## Metrics

**Retrieval** (from retrieved chunks vs `expected_sources`, matched at
article/annex granularity via chunk metadata):
- `hit_rate@k` — fraction of answerable questions whose expected source appears in top-k.
- `MRR` — mean reciprocal rank of the first expected source.
- Reported at k=5 (and k=3 for insight).

**Answer quality** (LLM-as-judge, Dial chat model, structured output validated by zod):
- `groundedness` — is every claim supported by the cited passages?
- `citation_correctness` — do citations match the expected article(s)/annex?
- `relevance` — does the answer address the question?
- `refusal_correct` — for refusal/advice items, did it correctly decline?

**Behavioral**: `behavior_match` = produced mode vs `expected_behavior`.
**Safety counter**: `fabricated_citations` across the run (MUST be 0).

## Report & gate

- Output: per-question rows + aggregate by group, written to `evals/results/`
  (gitignored, timestamped) and printed as a table.
- **Pass thresholds** (= spec Success Criteria):
  SC-001 refusal accuracy ≥ 90% · SC-002 hit-rate@k ≥ 85% · SC-003 groundedness
  ≥ 90% · SC-004 correct-citation ≥ 90% · SC-005 fabricated citations = 0 ·
  SC-006 baseline shows ≥1 ungrounded/incorrect ref that RAG avoids.
- Exit non-zero when any threshold fails, so it can gate a merge (FR-010).
- Deterministic where possible: temperature 0 for judge; retrieval is
  deterministic given a fixed index.

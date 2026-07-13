# Contract: Grounded Answer Synthesis

```ts
answer(
  req: QuestionRequest,
  deps: { retriever: Retriever; llm: LLMProvider; embedder: EmbeddingProvider },
): Promise<Answer>;   // Answer.mode ∈ {"grounded","refused"}

/** No-RAG comparator: same model, no retrieved context. */
baseline(question: string, llm: LLMProvider): Promise<Answer>;
```

## Synthesis flow (grounded)

1. Retrieve top-k (contract: retrieval.md).
2. If no results or top score < `REFUSAL_MIN_SCORE` → return `refused` with a
   coverage statement.
3. Build prompt: system encodes Principles I–IV; user lists each retrieved chunk
   as `[id] <label> — <text> (url)`.
4. LLM returns answer text + the list of chunk ids it relied on.
5. **Citation validator**:
   - Every returned id MUST be in the retrieved set; unknown ids are rejected.
   - If, after rejection, no valid citation remains → convert to `refused`.
   - Render each valid id → `Citation { chunk_id, label, url }`.
6. Attach the fixed `not_legal_advice_notice`. Return `Answer`.

## Contract rules (map to requirements)

- **FR-001 Grounding**: the LLM is given ONLY retrieved chunks; system prompt
  forbids outside knowledge.
- **FR-002/FR-003 Citation**: no uncited substantive claim; every citation
  resolves to a retrieved chunk; a citation to a non-retrieved/non-existent id is
  impossible to emit (validator drops it). Target SC-005 = 0 fabricated citations.
- **FR-004/FR-005 Refusal & advice**: weak retrieval → refuse; advice-framed
  request with in-corpus text → state what the text says, decline to recommend,
  mark `refused`.
- **FR-011 Baseline**: `baseline()` produces an ungrounded answer for side-by-side
  contrast; its citations (if any) are not validated against a corpus.
- `not_legal_advice_notice` present on every `Answer` (FR-014).

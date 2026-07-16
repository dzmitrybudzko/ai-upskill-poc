/**
 * retrieval/enhance.ts
 * -----------------------------------------------------------------------------
 * Optional retrieval enhancement (US7, FR-012): LLM query rewriting.
 *
 * The user's question is rewritten into a retrieval-optimized search query —
 * expanded with the regulation terminology the corpus actually uses — before
 * embedding. Behind the RAG_ENHANCE config flag, OFF by default; adopt only if
 * `rag eval --compare` shows a positive metric delta (Principle VI: measure,
 * don't assume).
 */

import type { LLMProvider } from "../providers/types.js";
// Type-only import — no runtime dependency from retrieval/ back onto rag/.
import type { Retriever } from "../rag/answer.js";
import { retrieve } from "./retriever.js";

const REWRITE_SYSTEM = `You rewrite user questions into search queries for semantic retrieval over the official English texts of the GDPR and the EU AI Act (articles, recitals, annexes).

Rules:
- Expand the question with the legal terminology the regulation texts themselves use (e.g. "can we email ads" -> "direct marketing, consent, legitimate interests, right to object").
- Keep every explicit reference verbatim: regulation names (GDPR, AI Act), article numbers ("Article 22"), annex numbers ("Annex III"), and phrases like "both regulations".
- Do not answer the question, do not add regulation content from memory beyond terminology, and do not drop any concept the user asked about.
- Output ONLY the rewritten query text, nothing else.`;

export async function rewriteQuery(question: string, llm: LLMProvider): Promise<string> {
  const rewritten = (
    await llm.complete({ system: REWRITE_SYSTEM, user: question, temperature: 0 })
  ).trim();
  // A degenerate rewrite must never sabotage retrieval — fall back to the original.
  return rewritten.length >= 3 ? rewritten : question;
}

/**
 * Wrap the standard retriever with query rewriting. The rewritten text is used
 * for embedding/pinning/balancing; the caller keeps the ORIGINAL question for
 * synthesis, so the model still answers what the user actually asked.
 */
export function makeEnhancedRetriever(llm: LLMProvider, base: Retriever = retrieve): Retriever {
  return async (question, opts, embedder) => base(await rewriteQuery(question, llm), opts, embedder);
}

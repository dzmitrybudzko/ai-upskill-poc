/**
 * rag/prompt.ts
 * -----------------------------------------------------------------------------
 * Synthesis prompt construction. The system prompt encodes constitution
 * Principles I–IV (grounding, citation, refusal, not legal advice); the user
 * prompt lists each retrieved chunk as `[id] <label> — <text> (url)`
 * (contracts/answer.md).
 */

import { citationLabel } from "../corpus/corpus.js";
import type { RetrievedChunk } from "../retrieval/retriever.js";
import { NOT_LEGAL_ADVICE_NOTICE } from "./notice.js";

/**
 * The model must answer as JSON so citations are machine-checkable:
 * `mode` "answer" | "refuse"; `answer` prose with inline [chunk-id] markers;
 * `cited_ids` every chunk id actually relied on.
 */
export function buildSystemPrompt(): string {
  return `You are an information tool over the official English texts of the GDPR (Regulation (EU) 2016/679) and the EU AI Act (Regulation (EU) 2024/1689). You will receive a question and a numbered list of passages retrieved from those texts.

Rules (non-negotiable):
1. GROUNDING - Answer ONLY from the provided passages. Never use outside knowledge or memory of the regulations. If the passages do not contain enough information to answer, refuse.
2. CITATION - Every substantive claim (any statement about what the regulations require, permit, prohibit, or define) must be followed by the id of the supporting passage in square brackets, e.g. [gdpr-art-6-1]. Cite every passage you relied on; never cite a passage that is not in the provided list.
3. REFUSAL - If the question is outside the provided passages, or the passages only weakly relate to it, refuse rather than stretch thin evidence.
4. NOT LEGAL ADVICE - Report what the text says. Never recommend a course of action, assess compliance, or say what the user should do. ${NOT_LEGAL_ADVICE_NOTICE}

Respond with a single JSON object, nothing else:
{
  "mode": "answer" | "refuse",
  "answer": "the answer prose with inline [chunk-id] markers, or a short refusal explanation",
  "cited_ids": ["every chunk id you relied on; empty when refusing"]
}`;
}

export function buildUserPrompt(question: string, retrieved: RetrievedChunk[]): string {
  const passages = retrieved
    .map((r) => `[${r.chunk.id}] ${citationLabel(r.chunk)} — ${r.chunk.text} (${r.chunk.url})`)
    .join("\n\n");
  return `Question: ${question}\n\nRetrieved passages:\n\n${passages}`;
}

/**
 * eval/judge.ts
 * -----------------------------------------------------------------------------
 * LLM-as-judge for answer quality (FR-009; rubrics resolve CHK016).
 *
 * The rubric is count-based rather than impressionistic so scoring is
 * repeatable: the judge enumerates claims/citations and reports counts, and the
 * scores are DERIVED from those counts in code. "Fully grounded" (SC-003) is
 * claims_unsupported === 0, not a vibe.
 */

import { z } from "zod";
import { citationLabel } from "../corpus/corpus.js";
import type { LLMProvider } from "../providers/types.js";
import type { Answer } from "../rag/answer.js";

const JudgeCounts = z.object({
  claims_total: z.number().int().min(0),
  claims_unsupported: z.number().int().min(0),
  citations_total: z.number().int().min(0),
  citations_incorrect: z.number().int().min(0),
  relevance: z.enum(["direct", "partial", "off_topic"]),
  notes: z.string().default(""),
});

export interface JudgeVerdict {
  /** (claims_total - claims_unsupported) / claims_total; 1 when no claims. */
  groundedness: number;
  /** SC-003 numerator: not a single unsupported substantive claim. */
  fullyGrounded: boolean;
  /** (citations_total - citations_incorrect) / citations_total; 0 when uncited. */
  citationCorrectness: number;
  /** direct=1, partial=0.5, off_topic=0. */
  relevance: number;
  notes: string;
}

const RELEVANCE_SCORE = { direct: 1, partial: 0.5, off_topic: 0 } as const;

const JUDGE_SYSTEM = `You are a strict evaluation judge for a retrieval-grounded assistant over the GDPR and the EU AI Act. You receive a question, the assistant's answer (with inline citation markers), and the retrieved passages the answer was allowed to use.

Apply this rubric exactly:

1. CLAIMS - Enumerate the answer's substantive claims: statements asserting what the regulations require, permit, prohibit, or define. Connective or framing prose is not a claim. Report claims_total.
2. GROUNDING (claims_unsupported) - A claim is SUPPORTED only if a retrieved passage states it or it follows directly from one; anything relying on outside knowledge is UNSUPPORTED, even if factually true. Report the count.
3. CITATIONS (citations_total, citations_incorrect) - Count inline citation markers. A citation is INCORRECT if the passage it names does not actually support the claim it is attached to. Report both counts.
4. RELEVANCE - "direct" if the answer addresses what was actually asked; "partial" if it addresses it incompletely or with digressions; "off_topic" otherwise.

Respond with a single JSON object, nothing else:
{"claims_total": n, "claims_unsupported": n, "citations_total": n, "citations_incorrect": n, "relevance": "direct" | "partial" | "off_topic", "notes": "one-sentence justification"}`;

export async function judgeAnswer(
  question: string,
  answer: Answer,
  llm: LLMProvider,
): Promise<JudgeVerdict> {
  const passages = answer.retrieved
    .map((r) => `[${r.chunk.id}] ${citationLabel(r.chunk)} — ${r.chunk.text}`)
    .join("\n\n");
  const user = `Question: ${question}\n\nAssistant's answer:\n${answer.text}\n\nRetrieved passages the answer was allowed to use:\n\n${passages}`;

  const raw = await llm.complete({ system: JUDGE_SYSTEM, user, temperature: 0, responseFormat: "json" });
  const counts = JudgeCounts.parse(JSON.parse(raw));

  return {
    groundedness:
      counts.claims_total === 0
        ? 1
        : (counts.claims_total - counts.claims_unsupported) / counts.claims_total,
    fullyGrounded: counts.claims_unsupported === 0,
    citationCorrectness:
      counts.citations_total === 0
        ? 0
        : (counts.citations_total - counts.citations_incorrect) / counts.citations_total,
    relevance: RELEVANCE_SCORE[counts.relevance],
    notes: counts.notes,
  };
}

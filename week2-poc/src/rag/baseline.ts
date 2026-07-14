/**
 * rag/baseline.ts
 * -----------------------------------------------------------------------------
 * No-RAG comparator (US6, FR-011, contracts/answer.md): the same model with NO
 * retrieved context, answering from its own memory of the regulations. Its
 * article references are deliberately unvalidated — the point is to make
 * hallucinated references visible next to the grounded mode's verified
 * citations (SC-006).
 */

import type { LLMProvider } from "../providers/types.js";
import type { Answer } from "./answer.js";
import { NOT_LEGAL_ADVICE_NOTICE } from "./notice.js";

const BASELINE_SYSTEM = `You are a knowledgeable assistant answering questions about the GDPR (Regulation (EU) 2016/679) and the EU AI Act (Regulation (EU) 2024/1689) purely from memory. You have NO access to the regulation texts. Answer concisely and name the specific articles or annexes you believe apply (e.g. "GDPR Art. 6", "AI Act Annex III"). Do not refuse for lack of sources; this is a comparison baseline.`;

export async function baseline(question: string, llm: LLMProvider): Promise<Answer> {
  const text = await llm.complete({ system: BASELINE_SYSTEM, user: question, temperature: 0 });
  return {
    mode: "grounded", // an (ungrounded) answer, not a refusal — citations stay unvalidated & empty
    text,
    citations: [],
    retrieved: [],
    not_legal_advice_notice: NOT_LEGAL_ADVICE_NOTICE,
  };
}

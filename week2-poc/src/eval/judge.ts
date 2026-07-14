/**
 * eval/judge.ts
 * -----------------------------------------------------------------------------
 * LLM-as-judge for answer quality (FR-009; rubrics resolve CHK016).
 *
 * The rubric is enumeration-based rather than impressionistic so scoring is
 * repeatable AND auditable: the judge must list each unsupported claim and each
 * incorrect citation verbatim with a reason; the scores are DERIVED from those
 * lists in code. Forcing enumeration also suppresses false flags — the judge
 * must re-scan every passage before it may list a claim as unsupported.
 * "Fully grounded" (SC-003) is an empty unsupported-claims list, not a vibe.
 */

import { z } from "zod";
import { citationLabel } from "../corpus/corpus.js";
import type { LLMProvider } from "../providers/types.js";
import type { Answer } from "../rag/answer.js";

const JudgeFindings = z.object({
  claims_total: z.number().int().min(0),
  unsupported_claims: z.array(z.object({ claim: z.string(), reason: z.string() })).default([]),
  citations_total: z.number().int().min(0),
  incorrect_citations: z.array(z.object({ citation: z.string(), reason: z.string() })).default([]),
  relevance: z.enum(["direct", "partial", "off_topic"]),
  notes: z.string().default(""),
});

export interface JudgeVerdict {
  /** (claims_total - unsupported) / claims_total; 1 when no claims. */
  groundedness: number;
  /** SC-003 numerator: the unsupported-claims list is empty. */
  fullyGrounded: boolean;
  /** (citations_total - incorrect) / citations_total; 0 when uncited. */
  citationCorrectness: number;
  /** direct=1, partial=0.5, off_topic=0. */
  relevance: number;
  unsupportedClaims: { claim: string; reason: string }[];
  incorrectCitations: { citation: string; reason: string }[];
  notes: string;
}

const RELEVANCE_SCORE = { direct: 1, partial: 0.5, off_topic: 0 } as const;

const JUDGE_SYSTEM = `You are a strict but FAIR evaluation judge for a retrieval-grounded assistant over the GDPR and the EU AI Act. You receive a question, the assistant's answer (with inline citation markers), and the retrieved passages the answer was allowed to use.

Apply this rubric exactly:

1. CLAIMS (claims_total) - Enumerate the answer's substantive claims: statements asserting what the regulations require, permit, prohibit, or define. Connective or framing prose is not a claim. Meta-statements about the provided passages themselves ("the provided passages do not cover X", "based on the retrieved passages…") are boundary declarations, not substantive claims — never count or flag them.
2. UNSUPPORTED CLAIMS (unsupported_claims) - A claim is SUPPORTED if ANY provided passage states it or it follows directly from one — including passages the claim does not cite; citation problems are counted separately in step 3, never here. If your reason mentions a citation being wrong, irrelevant, or misattached, the finding belongs in incorrect_citations and the claim is NOT unsupported. Faithful paraphrase counts as support. Before listing a claim as unsupported you MUST re-scan every passage for it; list it only if no passage supports it, quoting the claim and naming what is missing. A claim relying on outside knowledge (a number, deadline, or detail stated in no passage) is unsupported even if factually true. A claim that overstates a passage (broadening its scope, dropping a qualifier, turning "may" into "must") is unsupported.
3. INCORRECT CITATIONS (citations_total, incorrect_citations) - Count inline citation markers. A citation is INCORRECT only if the passage it names does not support the claim it is attached to. If the same claim is also supported by another passage, the citation is still incorrect, but the claim stays supported.
4. RELEVANCE - "direct" if the answer addresses what was actually asked; "partial" if it addresses it incompletely or with digressions; "off_topic" otherwise.

Respond with a single JSON object, nothing else:
{
  "claims_total": n,
  "unsupported_claims": [{"claim": "verbatim claim", "reason": "what no passage states"}],
  "citations_total": n,
  "incorrect_citations": [{"citation": "the marker", "reason": "why the named passage does not support the attached claim"}],
  "relevance": "direct" | "partial" | "off_topic",
  "notes": "one-sentence overall justification"
}`;

const VerifyVerdicts = z.object({
  verdicts: z.array(
    z.object({
      index: z.number().int().min(0),
      truly_unsupported: z.boolean(),
      reason: z.string(),
    }),
  ),
});

const VERIFY_SYSTEM = `You are double-checking an evaluation judge's findings. Each finding below flags a claim as "unsupported by the retrieved passages". Judges over-flag, so verify each one skeptically:

- Search EVERY passage for support of the claim, including faithful paraphrase and statements the claim follows from directly.
- A wrong, irrelevant, or misattached citation does NOT make a claim unsupported — only the absence of support in all passages does.
- truly_unsupported = true ONLY if, after checking every passage, none supports the claim (e.g. the claim adds a number/detail no passage states, broadens a passage's scope, or drops a qualifier).

Respond with a single JSON object, nothing else:
{"verdicts": [{"index": n, "truly_unsupported": true|false, "reason": "quote the supporting passage text, or name what is missing"}]}`;

/** Second-pass verification of flagged claims — kills judge false flags. */
async function verifyUnsupported(
  flagged: { claim: string; reason: string }[],
  passages: string,
  llm: LLMProvider,
): Promise<{ claim: string; reason: string }[]> {
  if (flagged.length === 0) return flagged;
  const user = `Retrieved passages:\n\n${passages}\n\nFlagged claims:\n${flagged
    .map((u, i) => `${i}. ${u.claim}\n   (judge's reason: ${u.reason})`)
    .join("\n")}`;
  const raw = await llm.complete({ system: VERIFY_SYSTEM, user, temperature: 0, responseFormat: "json" });
  const { verdicts } = VerifyVerdicts.parse(JSON.parse(raw));
  return flagged.filter((_, i) => verdicts.find((v) => v.index === i)?.truly_unsupported !== false);
}

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
  const f = JudgeFindings.parse(JSON.parse(raw));
  const confirmedUnsupported = await verifyUnsupported(f.unsupported_claims, passages, llm);
  const unsupported = confirmedUnsupported.length;
  const incorrect = f.incorrect_citations.length;

  return {
    groundedness: f.claims_total === 0 ? 1 : Math.max(0, (f.claims_total - unsupported) / f.claims_total),
    fullyGrounded: unsupported === 0,
    citationCorrectness:
      f.citations_total === 0 ? 0 : Math.max(0, (f.citations_total - incorrect) / f.citations_total),
    relevance: RELEVANCE_SCORE[f.relevance],
    unsupportedClaims: confirmedUnsupported,
    incorrectCitations: f.incorrect_citations,
    notes: f.notes,
  };
}

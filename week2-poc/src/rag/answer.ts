/**
 * rag/answer.ts
 * -----------------------------------------------------------------------------
 * Grounded answer synthesis (contracts/answer.md): retrieve → synthesize →
 * validate citations. The citation validator makes FR-002/FR-003 enforceable in
 * code, not just by prompt — a citation to a non-retrieved id cannot survive,
 * and a grounded answer with zero valid citations is converted to a refusal
 * (SC-005: zero fabricated citations).
 */

import { z } from "zod";
import { citationLabel } from "../corpus/corpus.js";
import type { EmbeddingProvider, LLMProvider } from "../providers/types.js";
import type { RetrievalFilters, RetrievedChunk } from "../retrieval/retriever.js";
import { COVERAGE_STATEMENT, NOT_LEGAL_ADVICE_NOTICE } from "./notice.js";
import { buildSystemPrompt, buildUserPrompt } from "./prompt.js";

export interface QuestionRequest {
  question: string;
  filters?: RetrievalFilters;
  k?: number;
  /**
   * Cosine-similarity floor below which retrieval counts as "too weak" and the
   * assistant refuses (FR-004). Injected from config; 0 disables the floor.
   */
  refusalMinScore?: number;
}

export interface Citation {
  chunk_id: string;
  label: string; // e.g. "GDPR Art. 6(1)(f)"
  url: string;
}

export interface Answer {
  mode: "grounded" | "refused";
  text: string;
  citations: Citation[]; // empty when refused
  retrieved: RetrievedChunk[]; // evidence considered (transparency/eval)
  not_legal_advice_notice: string; // always present (FR-005/FR-014)
}

export type Retriever = (
  question: string,
  opts: { k?: number; filters?: RetrievalFilters },
  embedder: EmbeddingProvider,
) => Promise<RetrievedChunk[]>;

export interface AnswerDeps {
  retriever: Retriever;
  llm: LLMProvider;
  embedder: EmbeddingProvider;
}

const SynthesisResponse = z.object({
  mode: z.enum(["answer", "refuse", "advice"]),
  answer: z.string(),
  cited_ids: z.array(z.string()).default([]),
});

/**
 * Citation validator (T015): keep only ids present in the retrieved set,
 * deduplicated, rendered as human citations. Rejected ids are reported so the
 * caller can strip their inline markers.
 */
export function validateCitations(
  citedIds: string[],
  retrieved: RetrievedChunk[],
): { citations: Citation[]; rejected: string[] } {
  const byId = new Map(retrieved.map((r) => [r.chunk.id, r.chunk]));
  const citations: Citation[] = [];
  const rejected: string[] = [];
  for (const id of [...new Set(citedIds)]) {
    const chunk = byId.get(id);
    if (chunk) {
      citations.push({ chunk_id: id, label: citationLabel(chunk), url: chunk.url });
    } else {
      rejected.push(id);
    }
  }
  return { citations, rejected };
}

/**
 * Replace inline [id] markers with [label]; strip rejected ids. Models may
 * group several ids in one bracket ("[id-a, id-b]"), so brackets are rewritten
 * token-wise; brackets that reference no known id are left untouched.
 */
export function renderInlineCitations(
  text: string,
  citations: Citation[],
  rejected: string[],
): string {
  const labelById = new Map(citations.map((c) => [c.chunk_id, c.label]));
  const rejectedIds = new Set(rejected);
  const out = text.replace(/\[([^\[\]]+)\]/g, (match, inner: string) => {
    const tokens = inner.split(",").map((t) => t.trim());
    if (!tokens.some((t) => labelById.has(t) || rejectedIds.has(t))) return match;
    const labels = tokens
      .filter((t) => !rejectedIds.has(t))
      .map((t) => labelById.get(t) ?? t);
    return labels.length ? `[${[...new Set(labels)].join("; ")}]` : "";
  });
  return out.replace(/ {2,}/g, " ").replace(/ +([.,;:])/g, "$1");
}

function refusal(text: string, retrieved: RetrievedChunk[]): Answer {
  return {
    mode: "refused",
    text,
    citations: [],
    retrieved,
    not_legal_advice_notice: NOT_LEGAL_ADVICE_NOTICE,
  };
}

export async function answer(req: QuestionRequest, deps: AnswerDeps): Promise<Answer> {
  const retrieved = await deps.retriever(
    req.question,
    { k: req.k, filters: req.filters },
    deps.embedder,
  );

  // FR-004: refuse when retrieval is too weak — nothing retrieved, or the
  // top-ranked score is below the configured floor. Never fabricate.
  if (retrieved.length === 0) {
    return refusal(
      `I can't answer this from the corpus — nothing relevant was retrieved. ${COVERAGE_STATEMENT}`,
      retrieved,
    );
  }
  if (retrieved[0].score < (req.refusalMinScore ?? 0)) {
    return refusal(
      `I can't answer this from the corpus — the retrieved passages are only weakly related to the question. ${COVERAGE_STATEMENT}`,
      retrieved,
    );
  }

  const raw = await deps.llm.complete({
    system: buildSystemPrompt(),
    user: buildUserPrompt(req.question, retrieved),
    temperature: 0,
    responseFormat: "json",
  });

  let parsed: z.infer<typeof SynthesisResponse>;
  try {
    parsed = SynthesisResponse.parse(JSON.parse(raw));
  } catch (err) {
    // A provider/format failure must never turn into an ungrounded answer.
    throw new Error(`Synthesis returned malformed output: ${String(err)}\nRaw: ${raw.slice(0, 300)}`);
  }

  if (parsed.mode === "refuse") {
    const explanation = parsed.answer.trim();
    return refusal(explanation ? `${explanation} ${COVERAGE_STATEMENT}` : COVERAGE_STATEMENT, retrieved);
  }

  // FR-005: advice-framed with in-corpus text — state what the text says,
  // decline to recommend; treated as a refusal, not an answer. Sources are
  // rendered inline as labels; the citations list stays empty (data-model.md:
  // refusals carry no Citation entries).
  if (parsed.mode === "advice") {
    const { citations, rejected } = validateCitations(parsed.cited_ids, retrieved);
    return refusal(renderInlineCitations(parsed.answer, citations, rejected), retrieved);
  }

  const { citations, rejected } = validateCitations(parsed.cited_ids, retrieved);

  // Invariant (data-model.md): grounded with zero valid citations is invalid → refuse.
  if (citations.length === 0) {
    return refusal(
      `I can't give a grounded answer to this — no retrieved passage supports one. ${COVERAGE_STATEMENT}`,
      retrieved,
    );
  }

  return {
    mode: "grounded",
    text: renderInlineCitations(parsed.answer, citations, rejected),
    citations,
    retrieved,
    not_legal_advice_notice: NOT_LEGAL_ADVICE_NOTICE,
  };
}

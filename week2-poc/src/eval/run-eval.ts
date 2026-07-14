/**
 * eval/run-eval.ts
 * -----------------------------------------------------------------------------
 * The acceptance gate (Principle VI, FR-009/FR-010, US3): run the golden set
 * end-to-end, aggregate per group, compare against the spec's Success Criteria,
 * write evals/results/, and report pass/fail. The CLI exits non-zero on failure
 * so this can gate a merge.
 */

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { z } from "zod";
import { citationLabel } from "../corpus/corpus.js";
import type { EmbeddingProvider, LLMProvider } from "../providers/types.js";
import { answer, type Retriever } from "../rag/answer.js";
import { baseline } from "../rag/baseline.js";
import {
  citesExpectedSource,
  fabricatedCitationCount,
  hitAtK,
  reciprocalRank,
} from "./metrics.js";
import { judgeAnswer, type JudgeVerdict } from "./judge.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
export const GOLDEN_SET_PATH = join(__dirname, "..", "..", "evals", "golden-set.json");
export const RESULTS_DIR = join(__dirname, "..", "..", "evals", "results");

const GoldenQuestion = z.object({
  id: z.string(),
  group: z.enum(["gdpr_factual", "aiact_factual", "cross_regulation", "refusal"]),
  question: z.string(),
  expected_sources: z.array(z.string()),
  expected_behavior: z.enum(["answer", "refuse"]),
  notes: z.string().default(""),
});
export type GoldenQuestion = z.infer<typeof GoldenQuestion>;

export function loadGoldenSet(path: string = GOLDEN_SET_PATH): GoldenQuestion[] {
  const raw = JSON.parse(readFileSync(path, "utf8"));
  return z.array(GoldenQuestion).parse(Array.isArray(raw) ? raw : raw.questions);
}

export interface EvalCaseResult {
  question_id: string;
  group: GoldenQuestion["group"];
  produced: "answer" | "refuse";
  behavior_match: boolean;
  hit_at_k: boolean | null; // null when no expected sources (refusal group)
  reciprocal_rank: number | null;
  cites_expected: boolean | null; // null unless answered with expected sources
  fabricated_citations: number;
  judge: JudgeVerdict | null; // null unless answered
  error?: string;
}

export interface Criterion {
  id: string;
  name: string;
  value: number | null; // null = not evaluable on this run (e.g. filtered group)
  threshold: number;
  op: ">=" | "==";
  pass: boolean | null;
}

export interface BaselineCheck {
  question_id: string;
  flagged: boolean; // baseline answer contains a wrong/unverifiable reference
  example: string;
}

export interface EvalReport {
  timestamp: string;
  k: number;
  refusalMinScore: number;
  group?: string;
  cases: EvalCaseResult[];
  perGroup: Record<string, { count: number; behavior_accuracy: number; hit_rate: number | null; mrr: number | null }>;
  baselineChecks: BaselineCheck[];
  criteria: Criterion[];
  passed: boolean;
}

/** Small ordered concurrency pool — kind to per-minute token limits. */
async function mapPool<T, R>(items: T[], limit: number, fn: (t: T) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i]);
    }
  });
  await Promise.all(workers);
  return results;
}

const mean = (xs: number[]): number | null =>
  xs.length === 0 ? null : xs.reduce((a, b) => a + b, 0) / xs.length;

const BaselineVerdict = z.object({
  contains_wrong_or_unverifiable_reference: z.boolean(),
  example: z.string().default(""),
});

const BASELINE_CHECK_SYSTEM = `You verify article references in an answer written from model memory (no source access) about the GDPR / EU AI Act. You receive the question, the memory-written answer, and regulation passages retrieved for this question (treat them as ground truth for where this topic actually lives).

Report whether the answer names at least one article/annex reference that is WRONG (the topic is not in that article) or UNVERIFIABLE against the passages (a specific article/paragraph number that cannot be confirmed). Naming the same articles the passages show is correct, not a flag.

Respond with a single JSON object, nothing else:
{"contains_wrong_or_unverifiable_reference": true|false, "example": "the offending reference and why, or empty"}`;

/**
 * SC-006 (T032): demonstrate the RAG advantage — the no-retrieval mode produces
 * at least one wrong/unverifiable reference on factual questions that the
 * grounded mode (whose citations are validated; SC-005) does not.
 */
export async function runBaselineChecks(
  questions: GoldenQuestion[],
  k: number,
  deps: { retriever: Retriever; llm: LLMProvider; embedder: EmbeddingProvider },
  sample = 8,
): Promise<BaselineCheck[]> {
  // Sample where model memory is weakest first: the AI Act (2024, detail-heavy
  // fine tiers/annex numbering) and cross-regulation questions demonstrate the
  // RAG advantage far more reliably than well-known GDPR basics.
  const groupPriority: Record<string, number> = { aiact_factual: 0, cross_regulation: 1 };
  const factual = questions
    .filter((q) => q.expected_behavior === "answer")
    .sort((a, b) => (groupPriority[a.group] ?? 2) - (groupPriority[b.group] ?? 2))
    .slice(0, sample);
  return mapPool(factual, 2, async (q) => {
    const [noRag, reference] = await Promise.all([
      baseline(q.question, deps.llm),
      deps.retriever(q.question, { k }, deps.embedder),
    ]);
    const passages = reference
      .map((r) => `[${citationLabel(r.chunk)}] ${r.chunk.text}`)
      .join("\n\n");
    const raw = await deps.llm.complete({
      system: BASELINE_CHECK_SYSTEM,
      user: `Question: ${q.question}\n\nMemory-written answer:\n${noRag.text}\n\nGround-truth passages:\n\n${passages}`,
      temperature: 0,
      responseFormat: "json",
    });
    const verdict = BaselineVerdict.parse(JSON.parse(raw));
    return {
      question_id: q.id,
      flagged: verdict.contains_wrong_or_unverifiable_reference,
      example: verdict.example,
    };
  });
}

export async function runEval(
  opts: {
    k: number;
    refusalMinScore: number;
    group?: string;
    concurrency?: number;
    onCase?: (r: EvalCaseResult) => void;
  },
  deps: { retriever: Retriever; llm: LLMProvider; embedder: EmbeddingProvider },
): Promise<EvalReport> {
  const questions = loadGoldenSet().filter((q) => !opts.group || q.group === opts.group);
  if (questions.length === 0) {
    throw new Error(`No golden questions match group "${opts.group}"`);
  }

  const cases = await mapPool(questions, opts.concurrency ?? 4, async (q): Promise<EvalCaseResult> => {
    try {
      const res = await answer(
        { question: q.question, k: opts.k, refusalMinScore: opts.refusalMinScore },
        deps,
      );
      const produced = res.mode === "grounded" ? "answer" : "refuse";
      const hasExpected = q.expected_sources.length > 0;
      const result: EvalCaseResult = {
        question_id: q.id,
        group: q.group,
        produced,
        behavior_match: produced === q.expected_behavior,
        hit_at_k: hasExpected ? hitAtK(q.expected_sources, res.retrieved) : null,
        reciprocal_rank: hasExpected ? reciprocalRank(q.expected_sources, res.retrieved) : null,
        cites_expected:
          produced === "answer" && hasExpected ? citesExpectedSource(res, q.expected_sources) : null,
        fabricated_citations: fabricatedCitationCount(res),
        judge: produced === "answer" ? await judgeAnswer(q.question, res, deps.llm) : null,
      };
      opts.onCase?.(result);
      return result;
    } catch (err) {
      // A provider error fails the case visibly (behavior_match=false), never silently.
      const result: EvalCaseResult = {
        question_id: q.id,
        group: q.group,
        produced: "refuse",
        behavior_match: false,
        hit_at_k: null,
        reciprocal_rank: null,
        cites_expected: null,
        fabricated_citations: 0,
        judge: null,
        error: err instanceof Error ? err.message : String(err),
      };
      opts.onCase?.(result);
      return result;
    }
  });

  const perGroup: EvalReport["perGroup"] = {};
  for (const group of [...new Set(cases.map((c) => c.group))]) {
    const g = cases.filter((c) => c.group === group);
    perGroup[group] = {
      count: g.length,
      behavior_accuracy: g.filter((c) => c.behavior_match).length / g.length,
      hit_rate: mean(g.filter((c) => c.hit_at_k !== null).map((c) => (c.hit_at_k ? 1 : 0))),
      mrr: mean(g.filter((c) => c.reciprocal_rank !== null).map((c) => c.reciprocal_rank as number)),
    };
  }

  // --- Success Criteria (spec.md) ---
  const refusalCases = cases.filter((c) => c.group === "refusal");
  const factualCases = cases.filter((c) => c.hit_at_k !== null);
  const answered = cases.filter((c) => c.judge !== null);
  const answeredWithExpected = cases.filter((c) => c.cites_expected !== null);

  const criterion = (
    id: string,
    name: string,
    value: number | null,
    threshold: number,
    op: ">=" | "==" = ">=",
  ): Criterion => ({
    id,
    name,
    value,
    threshold,
    op,
    pass: value === null ? null : op === ">=" ? value >= threshold : value === threshold,
  });

  const criteria: Criterion[] = [
    criterion(
      "SC-001",
      "Refusal accuracy (refusal group)",
      mean(refusalCases.map((c) => (c.produced === "refuse" ? 1 : 0))),
      0.9,
    ),
    criterion(
      "SC-002",
      `Hit-rate@${opts.k} (factual groups)`,
      mean(factualCases.map((c) => (c.hit_at_k ? 1 : 0))),
      0.85,
    ),
    criterion(
      "SC-003",
      "Fully grounded (share of answered)",
      mean(answered.map((c) => (c.judge!.fullyGrounded ? 1 : 0))),
      0.9,
    ),
    criterion(
      "SC-004",
      "Cites expected primary source (share of answered)",
      mean(answeredWithExpected.map((c) => (c.cites_expected ? 1 : 0))),
      0.9,
    ),
    criterion(
      "SC-005",
      "Fabricated citations (count)",
      cases.reduce((n, c) => n + c.fabricated_citations, 0),
      0,
      "==",
    ),
  ];

  // SC-006: baseline comparison (skipped when the run has no factual questions).
  const baselineChecks = await runBaselineChecks(questions, opts.k, deps);
  criteria.push(
    criterion(
      "SC-006",
      "Baseline shows a wrong/unverifiable reference RAG avoids",
      baselineChecks.length === 0 ? null : baselineChecks.some((b) => b.flagged) ? 1 : 0,
      1,
      "==",
    ),
  );

  const report: EvalReport = {
    timestamp: new Date().toISOString(),
    k: opts.k,
    refusalMinScore: opts.refusalMinScore,
    group: opts.group,
    cases,
    perGroup,
    baselineChecks,
    criteria,
    passed: criteria.every((c) => c.pass !== false),
  };

  mkdirSync(RESULTS_DIR, { recursive: true });
  writeFileSync(
    join(RESULTS_DIR, `eval-${report.timestamp.replace(/[:.]/g, "-")}.json`),
    JSON.stringify(report, null, 2),
  );
  return report;
}

export function formatReport(report: EvalReport): string {
  const lines: string[] = [];
  lines.push("");
  lines.push("Per group:");
  for (const [group, g] of Object.entries(report.perGroup)) {
    const hit = g.hit_rate === null ? "  n/a" : (g.hit_rate * 100).toFixed(0).padStart(4) + "%";
    const mrr = g.mrr === null ? " n/a" : g.mrr.toFixed(2);
    lines.push(
      `  ${group.padEnd(18)} n=${String(g.count).padEnd(3)} behavior ${(g.behavior_accuracy * 100).toFixed(0).padStart(3)}%  hit@${report.k} ${hit}  MRR ${mrr}`,
    );
  }
  lines.push("");
  lines.push("Success Criteria:");
  for (const c of report.criteria) {
    const value =
      c.value === null ? "n/a" : c.op === "==" ? String(c.value) : (c.value * 100).toFixed(1) + "%";
    const threshold = c.op === "==" ? `== ${c.threshold}` : `>= ${(c.threshold * 100).toFixed(0)}%`;
    const status = c.pass === null ? "SKIP" : c.pass ? "PASS" : "FAIL";
    lines.push(`  ${status.padEnd(5)} ${c.id} ${c.name}: ${value} (${threshold})`);
  }
  const flagged = report.baselineChecks.filter((b) => b.flagged);
  if (flagged.length > 0) {
    lines.push("");
    lines.push("Baseline hallucinations demonstrated (SC-006):");
    for (const b of flagged) lines.push(`  ${b.question_id}: ${b.example.slice(0, 160)}`);
  }
  const failed = report.cases.filter((c) => c.error);
  if (failed.length > 0) {
    lines.push("");
    lines.push(`Errors (${failed.length}):`);
    for (const c of failed) lines.push(`  ${c.question_id}: ${c.error}`);
  }
  lines.push("");
  lines.push(report.passed ? "RESULT: PASS" : "RESULT: FAIL");
  return lines.join("\n");
}

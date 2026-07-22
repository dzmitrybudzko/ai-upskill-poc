/**
 * eval/rejudge.ts
 * -----------------------------------------------------------------------------
 * Judge-agreement harness: re-score the answers SAVED in an eval report with
 * one or more judge models, without regenerating anything. Regenerating would
 * confound judge disagreement with answer variance; here every judge sees the
 * exact same answers, rebuilt from the report (answer_text + retrieved_ids)
 * and the committed corpus.
 */

import { readdirSync, readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { loadCorpus, type Chunk } from "../corpus/corpus.js";
import type { LLMProvider } from "../providers/types.js";
import type { Answer } from "../rag/answer.js";
import { judgeAnswer, type JudgeVerdict } from "./judge.js";
import { loadGoldenSet, RESULTS_DIR, type EvalReport } from "./run-eval.js";

export interface JudgeRun {
  judge: string;
  /** question_id → verdict (answered cases only). */
  verdicts: Record<string, JudgeVerdict>;
}

export interface AgreementSummary {
  perJudge: { judge: string; sc003: number; meanGroundedness: number }[];
  /** One row per answered case; unanimous = all judges agree on fullyGrounded. */
  cases: { question_id: string; fullyGrounded: Record<string, boolean>; unanimous: boolean }[];
  unanimousShare: number;
  /** SC-003 under a majority vote across judges (null with fewer than 3). */
  majoritySc003: number | null;
}

/** Newest eval-*.json in evals/results — the default rejudge input. */
export function latestReportPath(dir: string = RESULTS_DIR): string {
  const files = readdirSync(dir)
    .filter((f) => f.startsWith("eval-") && f.endsWith(".json"))
    .sort();
  if (files.length === 0) throw new Error(`No eval-*.json reports in ${dir}`);
  return join(dir, files[files.length - 1]);
}

export function loadReport(path: string): EvalReport {
  return JSON.parse(readFileSync(path, "utf8")) as EvalReport;
}

/** Rebuild the judge's view of one answered case from the saved report. */
export function rebuildAnswer(
  answerText: string,
  retrievedIds: string[],
  chunkById: Map<string, Chunk>,
): Answer {
  const retrieved = retrievedIds.map((id) => {
    const chunk = chunkById.get(id);
    if (!chunk) throw new Error(`Chunk "${id}" from the report is not in the corpus`);
    return { chunk, score: 0 };
  });
  return {
    mode: "grounded",
    text: answerText,
    citations: [],
    retrieved,
    not_legal_advice_notice: "",
  };
}

/** Small ordered concurrency pool (mirrors run-eval's, kind to rate limits). */
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

/** Re-score every answered case in the report with one judge. */
export async function rejudgeReport(
  report: EvalReport,
  judge: LLMProvider,
  opts: { concurrency?: number; onCase?: (id: string) => void } = {},
): Promise<JudgeRun> {
  const questionById = new Map(loadGoldenSet().map((q) => [q.id, q.question]));
  const chunkById = new Map(loadCorpus().map((c) => [c.id, c]));

  const answered = report.cases.filter((c) => c.produced === "answer");
  const stale = answered.filter((c) => c.answer_text == null);
  if (stale.length > 0) {
    throw new Error(
      `Report predates saved answers (${stale.length} answered cases lack answer_text) — re-run \`npm run eval\` first`,
    );
  }

  const verdicts: Record<string, JudgeVerdict> = {};
  await mapPool(answered, opts.concurrency ?? 4, async (c) => {
    const question = questionById.get(c.question_id);
    if (!question) throw new Error(`Question "${c.question_id}" not in the golden set`);
    const answer = rebuildAnswer(c.answer_text!, c.retrieved_ids, chunkById);
    verdicts[c.question_id] = await judgeAnswer(question, answer, judge);
    opts.onCase?.(c.question_id);
  });
  return { judge: judge.model, verdicts };
}

const mean = (xs: number[]): number =>
  xs.length === 0 ? 0 : xs.reduce((a, b) => a + b, 0) / xs.length;

/** Pure agreement stats over N judge runs of the same answer set. */
export function agreementSummary(runs: JudgeRun[]): AgreementSummary {
  const ids = [...new Set(runs.flatMap((r) => Object.keys(r.verdicts)))].sort();

  const cases = ids.map((question_id) => {
    const fullyGrounded: Record<string, boolean> = {};
    for (const run of runs) {
      const v = run.verdicts[question_id];
      if (v) fullyGrounded[run.judge] = v.fullyGrounded;
    }
    const votes = Object.values(fullyGrounded);
    return { question_id, fullyGrounded, unanimous: votes.every((x) => x === votes[0]) };
  });

  const perJudge = runs.map((run) => {
    const vs = Object.values(run.verdicts);
    return {
      judge: run.judge,
      sc003: mean(vs.map((v) => (v.fullyGrounded ? 1 : 0))),
      meanGroundedness: mean(vs.map((v) => v.groundedness)),
    };
  });

  const majoritySc003 =
    runs.length < 3
      ? null
      : mean(
          cases.map((c) => {
            const votes = Object.values(c.fullyGrounded);
            return votes.filter(Boolean).length > votes.length / 2 ? 1 : 0;
          }),
        );

  return {
    perJudge,
    cases,
    unanimousShare: mean(cases.map((c) => (c.unanimous ? 1 : 0))),
    majoritySc003,
  };
}

export function formatAgreement(summary: AgreementSummary, sourceReport: string): string {
  const pct = (v: number) => `${(v * 100).toFixed(1)}%`;
  const lines: string[] = [];
  lines.push("");
  lines.push(`=== Judge agreement over ${sourceReport} ===`);
  lines.push("");
  lines.push("Per judge (same answers, no regeneration):");
  for (const j of summary.perJudge) {
    lines.push(
      `  ${j.judge.padEnd(32)} SC-003 ${pct(j.sc003)}  mean groundedness ${j.meanGroundedness.toFixed(3)}`,
    );
  }
  lines.push("");
  lines.push(
    `Unanimous fully-grounded verdicts: ${pct(summary.unanimousShare)} of ${summary.cases.length} answered cases`,
  );
  if (summary.majoritySc003 !== null) {
    lines.push(`SC-003 under majority vote: ${pct(summary.majoritySc003)}`);
  }
  const split = summary.cases.filter((c) => !c.unanimous);
  if (split.length > 0) {
    lines.push("");
    lines.push("Disagreements:");
    for (const c of split) {
      const votes = Object.entries(c.fullyGrounded)
        .map(([judge, ok]) => `${judge}=${ok ? "grounded" : "flagged"}`)
        .join(", ");
      lines.push(`  ${c.question_id}: ${votes}`);
    }
  }
  return lines.join("\n");
}

/** Persist the full rejudge output next to the eval reports. */
export function saveRejudgeReport(
  sourceReport: string,
  runs: JudgeRun[],
  summary: AgreementSummary,
): string {
  mkdirSync(RESULTS_DIR, { recursive: true });
  const timestamp = new Date().toISOString();
  const path = join(RESULTS_DIR, `rejudge-${timestamp.replace(/[:.]/g, "-")}.json`);
  writeFileSync(path, JSON.stringify({ timestamp, sourceReport, runs, summary }, null, 2));
  return path;
}

/**
 * cli/main.ts
 * -----------------------------------------------------------------------------
 * `rag` CLI — the primary demo surface (FR-013, contracts/cli.md).
 * Composition root: the ONLY place (besides providers/) aware of Dial.
 *
 * Commands here follow tasks.md phases: `index` and `ask` (US1). `baseline`
 * and `eval` arrive with US3/US6.
 */

import { Command } from "commander";
import { loadConfig, type Config } from "../config.js";
import { createDialProviders } from "../providers/dial.js";
import { loadCorpus } from "../corpus/corpus.js";
import { buildIndex, INDEX_PATH } from "../retrieval/build-index.js";
import { retrieve } from "../retrieval/retriever.js";
import { answer } from "../rag/answer.js";
import { baseline } from "../rag/baseline.js";
import { formatReport, runEval } from "../eval/run-eval.js";

/** Missing/invalid DIAL_* env → fail fast, never a silent fallback (cli.md). */
function requireConfig(): Config {
  try {
    return loadConfig();
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  }
}

const program = new Command()
  .name("rag")
  .description("Grounded RAG assistant over the GDPR and the EU AI Act");

program
  .command("index")
  .description("Build/rebuild the LanceDB index from data/corpus.json")
  .option("--force", "rebuild even if an index already exists (build always overwrites)")
  .action(async () => {
    const cfg = requireConfig();
    const { embedder } = createDialProviders(cfg);
    const corpus = loadCorpus();
    console.log(`Embedding ${corpus.length} chunks with ${embedder.model}…`);
    const { count } = await buildIndex(corpus, embedder, {
      onProgress: (done, total) => process.stdout.write(`\r  ${done}/${total}`),
    });
    console.log(`\nIndexed ${count} chunks → ${INDEX_PATH} (model: ${embedder.model})`);
  });

program
  .command("ask")
  .description("Answer one question (single-turn), grounded and cited — or refuse")
  .argument("<question>", "natural-language question about the GDPR or the EU AI Act")
  .option("--reg <regulation>", "restrict retrieval to one regulation (GDPR | AI_ACT)")
  .option("--recitals", "include recitals in retrieval (off by default, FR-007)")
  .option("--no-annexes", "exclude annexes from retrieval")
  .option("-k <n>", "retrieval depth", (v) => parseInt(v, 10))
  .action(async (question: string, opts: { reg?: string; recitals?: boolean; annexes: boolean; k?: number }) => {
    const cfg = requireConfig();
    if (opts.reg !== undefined && opts.reg !== "GDPR" && opts.reg !== "AI_ACT") {
      console.error(`--reg must be GDPR or AI_ACT (got "${opts.reg}")`);
      process.exit(1);
    }
    const { llm, embedder } = createDialProviders(cfg);
    const res = await answer(
      {
        question,
        k: opts.k ?? cfg.k,
        refusalMinScore: cfg.refusalMinScore,
        filters: {
          regulation: opts.reg as "GDPR" | "AI_ACT" | undefined,
          includeRecitals: opts.recitals === true,
          includeAnnexes: opts.annexes,
        },
      },
      { retriever: retrieve, llm, embedder },
    );

    if (res.mode === "refused") {
      console.log("REFUSED");
      console.log(res.text);
    } else {
      console.log(res.text);
      console.log("\nSources:");
      for (const c of res.citations) {
        console.log(`  - ${c.label} — ${c.url}`);
      }
    }
    console.log(`\n${res.not_legal_advice_notice}`);
  });

program
  .command("baseline")
  .description("Answer the same question with and without retrieval, side by side (US6)")
  .argument("<question>", "natural-language question about the GDPR or the EU AI Act")
  .action(async (question: string) => {
    const cfg = requireConfig();
    const { llm, embedder } = createDialProviders(cfg);
    const [rag, noRag] = await Promise.all([
      answer(
        { question, k: cfg.k, refusalMinScore: cfg.refusalMinScore },
        { retriever: retrieve, llm, embedder },
      ),
      baseline(question, llm),
    ]);

    console.log("=== WITH RETRIEVAL (grounded, citations validated) ===\n");
    if (rag.mode === "refused") {
      console.log("REFUSED");
      console.log(rag.text);
    } else {
      console.log(rag.text);
      console.log("\nSources:");
      for (const c of rag.citations) console.log(`  - ${c.label} — ${c.url}`);
    }
    console.log("\n=== WITHOUT RETRIEVAL (model memory, references NOT verified) ===\n");
    console.log(noRag.text);
    console.log(`\n${rag.not_legal_advice_notice}`);
  });

program
  .command("eval")
  .description("Run the golden set and gate on the Success Criteria (exits non-zero on failure)")
  .option("--group <name>", "run one group only (gdpr_factual | aiact_factual | cross_regulation | refusal)")
  .option("-k <n>", "retrieval depth", (v) => parseInt(v, 10))
  .action(async (opts: { group?: string; k?: number }) => {
    const cfg = requireConfig();
    const { llm, embedder } = createDialProviders(cfg);
    const k = opts.k ?? cfg.k;
    let done = 0;
    const report = await runEval(
      {
        k,
        refusalMinScore: cfg.refusalMinScore,
        group: opts.group,
        onCase: (r) => {
          done += 1;
          const mark = r.error ? "✗ ERROR" : r.behavior_match ? "✓" : "✗";
          console.log(`  ${String(done).padStart(2)}. ${r.question_id} [${r.group}] ${mark}`);
        },
      },
      { retriever: retrieve, llm, embedder },
    );
    console.log(formatReport(report));
    process.exitCode = report.passed ? 0 : 1;
  });

program.parseAsync().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});

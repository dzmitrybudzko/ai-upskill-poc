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
  .action(async (question: string) => {
    const cfg = requireConfig();
    const { llm, embedder } = createDialProviders(cfg);
    const res = await answer(
      { question, k: cfg.k },
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

program.parseAsync().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});

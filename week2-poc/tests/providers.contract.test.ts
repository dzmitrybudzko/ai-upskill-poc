/**
 * tests/providers.contract.test.ts
 * -----------------------------------------------------------------------------
 * Principle V contract (contracts/providers.md):
 *  1. a fake in-memory provider satisfies the interfaces (swap = new class);
 *  2. no module under src/retrieval, src/rag, or src/eval imports the vendor
 *     SDK or the Dial implementation directly.
 */

import { describe, expect, it } from "vitest";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { EmbeddingProvider, LLMProvider } from "../src/providers/types.js";
import { FakeEmbeddingProvider, FakeLLMProvider } from "./fakes.js";

describe("provider interfaces (Principle V)", () => {
  it("a fake embedding provider satisfies EmbeddingProvider", async () => {
    const embedder: EmbeddingProvider = new FakeEmbeddingProvider();
    const vectors = await embedder.embed(["one", "two"]);
    expect(vectors).toHaveLength(2);
    expect(vectors[0].length).toBeGreaterThan(0);
    expect(embedder.model).toBeTruthy();
  });

  it("a fake LLM provider satisfies LLMProvider", async () => {
    const llm: LLMProvider = new FakeLLMProvider(["hello"]);
    await expect(llm.complete({ system: "s", user: "u" })).resolves.toBe("hello");
    expect(llm.model).toBeTruthy();
  });
});

describe("core modules stay vendor-free (contract rule)", () => {
  const SRC = join(dirname(fileURLToPath(import.meta.url)), "..", "src");
  const CORE_DIRS = ["retrieval", "rag", "eval"];
  const FORBIDDEN = [/from\s+["']openai["']/, /providers\/dial(\.js)?["']/];

  const tsFilesUnder = (dir: string): string[] =>
    readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
      entry.isDirectory()
        ? tsFilesUnder(join(dir, entry.name))
        : entry.name.endsWith(".ts")
          ? [join(dir, entry.name)]
          : [],
    );

  it("src/{retrieval,rag,eval} never import the OpenAI SDK or the Dial provider", () => {
    for (const dir of CORE_DIRS.map((d) => join(SRC, d)).filter(existsSync)) {
      for (const file of tsFilesUnder(dir)) {
        const source = readFileSync(file, "utf8");
        for (const pattern of FORBIDDEN) {
          expect(source, `${file} must not match ${pattern}`).not.toMatch(pattern);
        }
      }
    }
  });
});

/**
 * config.ts
 * -----------------------------------------------------------------------------
 * Env-driven configuration, validated with zod (Principles V & VII).
 *
 * All AI access is configured here (Dial base URL, key, deployment names) so
 * no vendor detail leaks into core logic. Missing/invalid DIAL_* values fail
 * fast with a clear message — never a silent ungrounded fallback (contracts/cli.md).
 */

import "dotenv/config";
import { z } from "zod";

const EnvSchema = z.object({
  DIAL_BASE_URL: z.url({ message: "DIAL_BASE_URL must be a valid URL" }),
  DIAL_API_KEY: z.string().min(1, "DIAL_API_KEY is required"),
  DIAL_CHAT_MODEL: z.string().min(1, "DIAL_CHAT_MODEL is required"),
  // Judge model for evals; defaults to DIAL_CHAT_MODEL. Pin it (e.g. to gpt-4o)
  // when comparing chat models so SC-003 is scored by the same judge across runs.
  DIAL_JUDGE_MODEL: z.string().min(1).optional(),
  DIAL_EMBEDDING_MODEL: z.string().min(1, "DIAL_EMBEDDING_MODEL is required"),
  RAG_K: z.coerce.number().int().positive().default(5),
  // Similarity floor for refusal (FR-004), calibrated on the golden set (T037):
  // catches clearly-off-topic questions; near-topic refusals and advice-framed
  // questions (top-1 ≈ 0.45–0.54) are left to synthesis-time model judgment.
  REFUSAL_MIN_SCORE: z.coerce.number().min(0).max(1).default(0.4),
  // Optional retrieval enhancement (US7/FR-012): LLM query rewriting before
  // embedding. Off by default; its metric effect is measured via `rag eval
  // --compare` before adopting. (z.coerce.boolean would treat "false" as true.)
  RAG_ENHANCE: z
    .string()
    .optional()
    .transform((v) => v === "true" || v === "1"),
});

export type Config = {
  dialBaseUrl: string;
  dialApiKey: string;
  chatModel: string;
  judgeModel: string;
  embeddingModel: string;
  k: number;
  refusalMinScore: number;
  enhance: boolean;
};

/** Load and validate configuration from the environment (.env supported). */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const parsed = EnvSchema.safeParse(env);
  if (!parsed.success) {
    const details = parsed.error.issues
      .map((i) => `  - ${i.path.join(".")}: ${i.message}`)
      .join("\n");
    throw new Error(
      `Invalid configuration. Set the required DIAL_* variables (see .env.example):\n${details}`,
    );
  }
  const e = parsed.data;
  return {
    dialBaseUrl: e.DIAL_BASE_URL,
    dialApiKey: e.DIAL_API_KEY,
    chatModel: e.DIAL_CHAT_MODEL,
    judgeModel: e.DIAL_JUDGE_MODEL ?? e.DIAL_CHAT_MODEL,
    embeddingModel: e.DIAL_EMBEDDING_MODEL,
    k: e.RAG_K,
    refusalMinScore: e.REFUSAL_MIN_SCORE,
    enhance: e.RAG_ENHANCE,
  };
}

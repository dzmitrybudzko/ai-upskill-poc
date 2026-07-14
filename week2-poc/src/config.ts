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
  DIAL_EMBEDDING_MODEL: z.string().min(1, "DIAL_EMBEDDING_MODEL is required"),
  RAG_K: z.coerce.number().int().positive().default(5),
  // Provisional similarity floor for refusal (FR-004); calibrated in T037.
  REFUSAL_MIN_SCORE: z.coerce.number().min(0).max(1).default(0.25),
});

export type Config = {
  dialBaseUrl: string;
  dialApiKey: string;
  chatModel: string;
  embeddingModel: string;
  k: number;
  refusalMinScore: number;
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
    embeddingModel: e.DIAL_EMBEDDING_MODEL,
    k: e.RAG_K,
    refusalMinScore: e.REFUSAL_MIN_SCORE,
  };
}

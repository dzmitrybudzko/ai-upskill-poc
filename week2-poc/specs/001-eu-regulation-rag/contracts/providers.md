# Contract: AI Providers (Principle V — provider independence)

The only place vendor-specific code may live. Core logic depends on these
interfaces, never on a concrete vendor.

```ts
export interface EmbeddingProvider {
  /** Embed one or many texts. Returns one vector per input, same order. */
  embed(texts: string[]): Promise<number[][]>;
  /** Model/deployment id, for logging & index metadata. */
  readonly model: string;
}

export interface LLMProvider {
  /** Single-turn completion for answer synthesis and judging. */
  complete(input: {
    system: string;
    user: string;
    temperature?: number;      // default low (e.g. 0) for determinism
    responseFormat?: "text" | "json";
  }): Promise<string>;
  readonly model: string;
}
```

## Contract rules

- A concrete implementation (`DialProvider`) is constructed from config only
  (`DIAL_BASE_URL`, `DIAL_API_KEY`, `DIAL_EMBEDDING_MODEL`, `DIAL_CHAT_MODEL`).
- No module under `src/retrieval`, `src/rag`, or `src/eval` imports the OpenAI
  SDK or references "dial"/"openai" directly — they receive a provider instance.
- Swapping providers = new class implementing these two interfaces; no call-site
  changes. (Verified by a contract test using a fake in-memory provider.)
- Errors (auth, rate limit, timeout) surface as typed failures the caller can
  handle; the assistant never invents an answer to mask a provider error.

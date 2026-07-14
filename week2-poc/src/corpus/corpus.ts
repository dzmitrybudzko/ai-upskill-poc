/**
 * corpus/corpus.ts
 * -----------------------------------------------------------------------------
 * Corpus loading, the Chunk type (mirrors what scripts/parse-corpus.ts emits),
 * and citation-label rendering (Principle II).
 *
 * `data/corpus.json` is the source of truth; the LanceDB index is derived from
 * it and disposable (plan.md).
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

export type Regulation = "GDPR" | "AI_ACT";
export type ChunkType = "article" | "recital" | "annex";

export type Chunk = {
  id: string; // e.g. "gdpr-art-6", "gdpr-art-6-1", "aiact-anx-III-1"
  regulation: Regulation;
  type: ChunkType;
  chapter?: string;
  article_number?: string;
  article_title?: string;
  annex_number?: string;
  annex_title?: string;
  paragraph?: string; // point label when the split is finer (e.g. "1", "f")
  text: string;
  url: string; // EUR-Lex deep link
};

const __dirname = dirname(fileURLToPath(import.meta.url));
export const CORPUS_PATH = join(__dirname, "..", "..", "data", "corpus.json");

/** Load and minimally validate the corpus produced by the ingestion step. */
export function loadCorpus(path: string = CORPUS_PATH): Chunk[] {
  const raw = JSON.parse(readFileSync(path, "utf8"));
  const chunks: Chunk[] = Array.isArray(raw) ? raw : raw.chunks;
  if (!Array.isArray(chunks) || chunks.length === 0) {
    throw new Error(`Corpus at ${path} is empty or malformed`);
  }
  for (const c of chunks) {
    if (!c.id || !c.regulation || !c.type || !c.text || !c.url) {
      throw new Error(`Corpus chunk missing required fields: ${JSON.stringify(c).slice(0, 120)}`);
    }
  }
  return chunks;
}

const REG_NAME: Record<Regulation, string> = { GDPR: "GDPR", AI_ACT: "AI Act" };

/**
 * Human citation label from chunk metadata, e.g. "GDPR Art. 6(1)", "AI Act
 * Annex III", "GDPR Recital 47".
 *
 * Citation granularity (decision, T036/CHK007): citations are as fine as the
 * ingestion chunking — paragraph-level ("GDPR Art. 6(1)") where a long article
 * was split per numbered paragraph, article-level otherwise, annex-level for
 * annexes. Rationale: a citation always points at exactly the chunk that
 * grounded the claim (never broader), while eval source-matching stays at
 * article/annex level (metrics.ts sourceKey), robust to the split. The judge
 * sees the same labels via this function, so rendering and judging agree.
 */
export function citationLabel(chunk: Chunk): string {
  const reg = REG_NAME[chunk.regulation];
  switch (chunk.type) {
    case "article": {
      const para = chunk.paragraph ? `(${chunk.paragraph})` : "";
      return `${reg} Art. ${chunk.article_number}${para}`;
    }
    case "annex":
      return `${reg} Annex ${chunk.annex_number}`;
    case "recital": {
      // Recital chunks carry no number field; it is encoded in the id ("gdpr-rct-47").
      const n = /-rct-(\d+)$/.exec(chunk.id)?.[1] ?? "?";
      return `${reg} Recital ${n}`;
    }
  }
}

/**
 * Article/annex-level key for a chunk (e.g. "gdpr-art-6", "aiact-anx-III") —
 * the unit of the golden set's expected_sources and of retrieval diversity.
 */
export function sourceKey(chunk: Chunk): string {
  const prefix = chunk.regulation === "GDPR" ? "gdpr" : "aiact";
  if (chunk.type === "annex") return `${prefix}-anx-${chunk.annex_number}`;
  if (chunk.type === "article") return `${prefix}-art-${chunk.article_number}`;
  return chunk.id; // recitals: one chunk per recital, id is already the key
}

/**
 * The text that gets embedded: the chunk text prefixed with a short metadata
 * header (regulation + citation label + title) to sharpen retrieval precision
 * (contracts/retrieval.md, research.md §3).
 */
export function embeddingText(chunk: Chunk): string {
  const title = chunk.article_title ?? chunk.annex_title;
  const header = title ? `${citationLabel(chunk)} — ${title}` : citationLabel(chunk);
  return `${header}\n${chunk.text}`;
}

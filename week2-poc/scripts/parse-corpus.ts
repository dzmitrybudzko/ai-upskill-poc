/**
 * parse-corpus.ts
 * -----------------------------------------------------------------------------
 * Structure-aware ingestion of GDPR (Reg. 2016/679) and the EU AI Act
 * (Reg. 2024/1689) into a chunked, metadata-rich JSON corpus.
 *
 * Source: official Publications Office XHTML rendering of the OJ-published text,
 * fetched via the cellar M2M endpoint (see data/raw/*.xhtml and README).
 *
 * Chunking follows the regulation's OWN legal hierarchy (never fixed-size
 * character windows):
 *   - one chunk per Article, OR one chunk per numbered paragraph when an
 *     Article is long (see SPLIT_MIN_CHARS);
 *   - one chunk per Recital (tagged type: "recital").
 *
 * Every chunk carries a working EUR-Lex deep link back to its source.
 *
 * This is ingestion/build tooling, not application (RAG) code.
 */

import { load, type CheerioAPI, type Cheerio } from "cheerio";
import type { AnyNode } from "domhandler";
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type Regulation = "GDPR" | "AI_ACT";

type Chunk = {
  id: string; // e.g. "gdpr-art-6", "gdpr-art-6-1", "aiact-anx-III-1"
  regulation: Regulation;
  type: "article" | "recital" | "annex";
  chapter?: string; // e.g. "CHAPTER II — Principles"
  article_number?: string; // e.g. "6"
  article_title?: string; // e.g. "Lawfulness of processing"
  annex_number?: string; // e.g. "III" (annex chunks only)
  annex_title?: string; // e.g. "High-risk AI systems referred to in Article 6(2)"
  paragraph?: string; // point label when the split is finer (e.g. "1", "a")
  text: string;
  url: string; // deep link back to the source
};

type Source = {
  regulation: Regulation;
  celex: string;
  file: string;
  idPrefix: string; // "gdpr" | "aiact"
};

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const RAW_DIR = join(ROOT, "data", "raw");
const OUT_FILE = join(ROOT, "data", "corpus.json");

const SOURCES: Source[] = [
  { regulation: "GDPR", celex: "32016R0679", file: "gdpr.xhtml", idPrefix: "gdpr" },
  { regulation: "AI_ACT", celex: "32024R1689", file: "aiact.xhtml", idPrefix: "aiact" },
];

/**
 * Only split an Article into per-paragraph chunks when it is genuinely long
 * (has >= 2 numbered paragraphs AND exceeds this character length). Short
 * articles stay intact as a single chunk. This keeps chunk granularity aligned
 * with the legal structure rather than an arbitrary window.
 */
const SPLIT_MIN_CHARS = 1500;

// EUR-Lex HTML view supports #art_N / #rct_N fragment anchors.
const eurlexUrl = (celex: string, anchor: string) =>
  `https://eur-lex.europa.eu/legal-content/EN/TXT/HTML/?uri=CELEX:${celex}#${anchor}`;

// ---------------------------------------------------------------------------
// Text extraction helpers
// ---------------------------------------------------------------------------

/** Normalize whitespace: nbsp -> space, collapse runs, trim. */
function normalize(s: string): string {
  return s
    .replace(/ /g, " ")
    .replace(/[  ]/g, " ") // other fixed-width spaces
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Extract clean, readable text from a container element. Footnote reference
 * superscripts and footnote definitions are removed. Paragraph <p> blocks
 * (including sub-point table cells, which are themselves <p>) are joined in
 * document order so enumerated points read inline, e.g.
 *   "1. Processing shall be lawful ... (a) the data subject has given consent ...".
 */
function extractText($: CheerioAPI, $container: Cheerio<AnyNode>): string {
  const $clone = $container.clone();
  // Drop footnote reference markers and footnote definitions.
  $clone.find(".oj-note-tag, p.oj-note").remove();

  // Capture ALL descendant text (paragraphs, spans, table cells, links) in
  // document order. Content is not always in <p> — annex sub-points put text in
  // <span>. Insert a space after every element so adjacent nodes never merge
  // ("5.1." + "The purpose" -> "5.1. The purpose"); normalize collapses runs.
  $clone.find("*").each((_, e) => $(e).after(" "));
  return normalize($clone.text());
}

// ---------------------------------------------------------------------------
// Chapter resolution
// ---------------------------------------------------------------------------

/**
 * Resolve the enclosing chapter label for an article element, e.g.
 * "CHAPTER II — Principles". Articles are nested inside <div id="cpt_..">.
 * Uses direct children only, so nested Section titles are not mistaken for the
 * chapter title.
 */
function resolveChapter($: CheerioAPI, $art: Cheerio<AnyNode>): string | undefined {
  const $cpt = $art
    .parents("div[id]")
    .filter((_, el) => /^cpt_[^.]+$/.test($(el).attr("id") ?? ""))
    .first();
  if ($cpt.length === 0) return undefined;

  const label = normalize($cpt.children("p.oj-ti-section-1").first().text());
  const name = normalize(
    $cpt.children("div.eli-title").first().find("p.oj-ti-section-2").first().text(),
  );

  if (label && name) return `${label} — ${name}`;
  return label || name || undefined;
}

// ---------------------------------------------------------------------------
// Article & recital parsing
// ---------------------------------------------------------------------------

/** "Article 6" -> "6", "Article 6a" -> "6a". */
function parseArticleNumber(raw: string): string {
  return normalize(raw).replace(/^Article\s+/i, "").trim();
}

/** paragraph container id "006.001" -> "1". */
function parseParagraphNumber(id: string): string {
  const m = id.match(/^\d{3}\.(\d{3})$/);
  return m ? String(parseInt(m[1], 10)) : id;
}

function parseArticles($: CheerioAPI, src: Source): Chunk[] {
  const chunks: Chunk[] = [];

  $("div.eli-subdivision[id]").each((_, el) => {
    const $art = $(el);
    const id = $art.attr("id") ?? "";
    if (!/^art_\d+[a-z]?$/.test(id)) return; // articles only

    const articleNumber = parseArticleNumber($art.children("p.oj-ti-art").first().text());
    const articleTitle =
      normalize($art.children("div.eli-title").first().find("p.oj-sti-art").first().text()) ||
      undefined;
    const chapter = resolveChapter($, $art);
    const anchor = id; // art_6
    const url = eurlexUrl(src.celex, anchor);

    // Numbered paragraph containers, e.g. <div id="006.001">.
    const $paras = $art.children("div[id]").filter((_, d) => /^\d{3}\.\d{3}$/.test($(d).attr("id") ?? ""));
    // Full article body text = article minus its number line and title block.
    const $body = $art.clone();
    $body.children("p.oj-ti-art, div.eli-title").remove();
    const fullText = extractText($, $body);

    // Point-list articles (e.g. Definitions): a sequence of direct-child
    // <table> rows each labelled "(1)", "(2)"/"(a)"... with NO numbered
    // paragraph divs. Split per point so each definition is its own chunk.
    const $points = $art.children("table").filter((_, t) => {
      const first = normalize($(t).find("tr").first().children("td").first().find("p").first().text());
      return /^\(\w+\)$/.test(first);
    });

    const splitByParas = $paras.length >= 2 && fullText.length > SPLIT_MIN_CHARS;
    const splitByPoints = !splitByParas && $points.length >= 2 && fullText.length > SPLIT_MIN_CHARS;

    if (splitByParas) {
      $paras.each((_, d) => {
        const $p = $(d);
        const pid = $p.attr("id") ?? "";
        const paragraph = parseParagraphNumber(pid);
        const text = extractText($, $p);
        if (!text) return;
        chunks.push({
          id: `${src.idPrefix}-art-${articleNumber}-${paragraph}`,
          regulation: src.regulation,
          type: "article",
          chapter,
          article_number: articleNumber,
          article_title: articleTitle,
          paragraph,
          text,
          url,
        });
      });
    } else if (splitByPoints) {
      // Chapeau: lead-in <p>(s) before the first point table (e.g.
      // "For the purposes of this Regulation:"). Kept short and prepended so
      // each point chunk reads as self-contained legal text.
      const chapeau = normalize(
        $art
          .children("p.oj-normal")
          .toArray()
          .map((p) => $(p).text())
          .join(" "),
      );
      $points.each((_, t) => {
        const $cells = $(t).find("tr").first().children("td");
        const label = normalize($cells.eq(0).find("p").first().text()).replace(/[()]/g, "");
        const content = extractText($, $cells.eq(1));
        if (!content || !label) return;
        const text = chapeau && chapeau.length <= 200 ? `${chapeau} (${label}) ${content}` : `(${label}) ${content}`;
        chunks.push({
          id: `${src.idPrefix}-art-${articleNumber}-${label}`,
          regulation: src.regulation,
          type: "article",
          chapter,
          article_number: articleNumber,
          article_title: articleTitle,
          paragraph: label,
          text,
          url,
        });
      });
    } else {
      if (!fullText) return;
      chunks.push({
        id: `${src.idPrefix}-art-${articleNumber}`,
        regulation: src.regulation,
        type: "article",
        chapter,
        article_number: articleNumber,
        article_title: articleTitle,
        text: fullText,
        url,
      });
    }
  });

  return chunks;
}

function parseRecitals($: CheerioAPI, src: Source): Chunk[] {
  const chunks: Chunk[] = [];

  $("div.eli-subdivision[id]").each((_, el) => {
    const $rct = $(el);
    const id = $rct.attr("id") ?? "";
    const m = id.match(/^rct_(\d+)$/);
    if (!m) return;
    const num = m[1];

    // First <p> is the "(N)" number cell; strip a leading "(N)" from the text.
    let text = extractText($, $rct);
    text = text.replace(/^\(\d+\)\s*/, "").trim();
    if (!text) return;

    chunks.push({
      id: `${src.idPrefix}-rct-${num}`,
      regulation: src.regulation,
      type: "recital",
      article_number: undefined,
      text,
      url: eurlexUrl(src.celex, id),
    });
  });

  return chunks;
}

// ---------------------------------------------------------------------------
// Annex parsing
// ---------------------------------------------------------------------------

/** Roman numeral from "ANNEX III" -> "III". */
function parseAnnexNumber(raw: string): string {
  return normalize(raw).replace(/^ANNEX\s+/i, "").trim();
}

/**
 * A "point table" is a direct-child annex table whose flattened text starts
 * with a numbered/lettered label, e.g. "1. Biometrics ..." or "(a) ...".
 * Returns {label, content} (label without the delimiter, content = the rest),
 * or null if the table is not a labelled point. Works for 2- and 3-column
 * layouts because it reads the table's whole text, not a specific cell.
 */
function tablePoint($: CheerioAPI, table: AnyNode): { label: string; content: string } | null {
  const full = extractText($, $(table));
  const m = full.match(/^\(?([0-9]{1,3}|[a-z]{1,3})[.)]\s+(\S.*)$/is);
  if (!m) return null;
  return { label: m[1], content: m[2].trim() };
}

/**
 * Parse AI Act annexes (GDPR has none). Annexes are heterogeneous, so chunk by
 * their own structure:
 *   - point-list annexes (III, IV, V, VIII, I, ...) -> one chunk per top-level
 *     numbered point, with the annex chapeau + current Section header prepended
 *     for grounding;
 *   - section-only annexes (VII, X) -> one chunk per Section;
 *   - short/narrative annexes (II, VI, XIII) -> one whole-annex chunk.
 * Chunk ids use a running index for uniqueness (labels restart across sections);
 * the human label is preserved in `paragraph`.
 */
function parseAnnexes($: CheerioAPI, src: Source): Chunk[] {
  const chunks: Chunk[] = [];

  $("div.eli-container[id]").each((_, el) => {
    const $anx = $(el);
    const id = $anx.attr("id") ?? "";
    const rm = id.match(/^anx_([IVXLC]+)$/);
    if (!rm) return;
    const roman = rm[1];

    const $titles = $anx.children("p.oj-doc-ti");
    const annexNumber = parseAnnexNumber($titles.eq(0).text()) || roman;
    const annexTitle = normalize($titles.eq(1).text()) || undefined;
    const url = eurlexUrl(src.celex, id);

    const base = {
      regulation: src.regulation,
      type: "annex" as const,
      annex_number: annexNumber,
      annex_title: annexTitle,
      url,
    };

    // Classify direct children in document order.
    const $children = $anx.children();
    const pointTables: AnyNode[] = [];
    const sectionHeaders: AnyNode[] = [];
    $children.each((_, ch) => {
      if (ch.type !== "tag") return;
      const tag = ch.name;
      const cls = $(ch).attr("class") ?? "";
      if (tag === "table" && tablePoint($, ch)) pointTables.push(ch);
      else if (tag === "p" && /oj-ti-grseq/.test(cls)) sectionHeaders.push(ch);
    });

    // Chapeau: leading oj-normal paragraphs (intro before first point/section).
    const chapeau = normalize(
      $anx.children("p.oj-normal").toArray().map((p) => $(p).text()).join(" "),
    );
    const chapeauPrefix = chapeau && chapeau.length <= 260 ? `${chapeau} ` : "";

    let idx = 0;

    if (pointTables.length >= 2) {
      // Point-split, tracking the most recent Section header for context.
      let currentSection = "";
      $children.each((_, ch) => {
        if (ch.type !== "tag") return;
        const cls = $(ch).attr("class") ?? "";
        if (ch.name === "p" && /oj-ti-grseq/.test(cls)) {
          currentSection = normalize($(ch).text());
          return;
        }
        if (ch.name !== "table") return;
        const pt = tablePoint($, ch);
        if (!pt) return;
        idx += 1;
        const secPrefix = currentSection ? `${currentSection} ` : "";
        chunks.push({
          ...base,
          id: `${src.idPrefix}-anx-${roman}-${idx}`,
          paragraph: pt.label,
          text: `${chapeauPrefix}${secPrefix}(${pt.label}) ${pt.content}`.trim(),
        });
      });
    } else if (sectionHeaders.length >= 2) {
      // Section-split: accumulate content between section headers.
      let section = "";
      let buf: string[] = [];
      const flush = () => {
        const body = normalize(buf.join(" "));
        buf = [];
        if (!section && !body) return;
        idx += 1;
        chunks.push({
          ...base,
          id: `${src.idPrefix}-anx-${roman}-${idx}`,
          paragraph: undefined,
          text: normalize(`${section} ${body}`),
        });
      };
      $children.each((_, ch) => {
        if (ch.type !== "tag") return;
        const cls = $(ch).attr("class") ?? "";
        if (ch.name === "p" && /oj-doc-ti/.test(cls)) return; // annex number/title
        if (ch.name === "p" && /oj-ti-grseq/.test(cls)) {
          if (section || buf.length) flush();
          section = normalize($(ch).text());
          return;
        }
        buf.push(extractText($, $(ch)));
      });
      flush();
    } else {
      // Whole annex.
      const $body = $anx.clone();
      $body.children("p.oj-doc-ti").remove();
      const text = extractText($, $body);
      if (text) {
        chunks.push({ ...base, id: `${src.idPrefix}-anx-${roman}`, text });
      }
    }
  });

  return chunks;
}

// ---------------------------------------------------------------------------
// Reporting
// ---------------------------------------------------------------------------

function median(nums: number[]): number {
  const s = [...nums].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : Math.round((s[mid - 1] + s[mid]) / 2);
}

function report(chunks: Chunk[]): void {
  const lens = chunks.map((c) => c.text.length);
  const by = (pred: (c: Chunk) => boolean) => chunks.filter(pred).length;

  console.log("\n============================================================");
  console.log(" CORPUS BUILD REPORT");
  console.log("============================================================");
  console.log(`Total chunks: ${chunks.length}`);
  console.log("\nBy regulation:");
  console.log(`  GDPR   : ${by((c) => c.regulation === "GDPR")}`);
  console.log(`  AI_ACT : ${by((c) => c.regulation === "AI_ACT")}`);
  console.log("\nBy type:");
  console.log(`  article: ${by((c) => c.type === "article")}`);
  console.log(`  recital: ${by((c) => c.type === "recital")}`);
  console.log(`  annex  : ${by((c) => c.type === "annex")}`);
  console.log("\nBy regulation x type:");
  for (const reg of ["GDPR", "AI_ACT"] as const) {
    for (const t of ["article", "recital", "annex"] as const) {
      console.log(`  ${reg.padEnd(6)} ${t.padEnd(7)}: ${by((c) => c.regulation === reg && c.type === t)}`);
    }
  }
  const annexNums = [...new Set(chunks.filter((c) => c.type === "annex").map((c) => c.annex_number))];
  console.log(`\nAnnexes present (${annexNums.length}): ${annexNums.join(", ")}`);
  console.log("\nChunk length (chars):");
  console.log(`  min   : ${Math.min(...lens)}`);
  console.log(`  median: ${median(lens)}`);
  console.log(`  max   : ${Math.max(...lens)}`);

  const shortest = [...chunks].sort((a, b) => a.text.length - b.text.length).slice(0, 5);
  const longest = [...chunks].sort((a, b) => b.text.length - a.text.length).slice(0, 5);
  console.log("\n5 shortest chunks (id | len | text preview):");
  for (const c of shortest) console.log(`  ${c.id.padEnd(18)} ${String(c.text.length).padStart(5)}  ${c.text.slice(0, 70)}`);
  console.log("\n5 longest chunks (id | len):");
  for (const c of longest) console.log(`  ${c.id.padEnd(18)} ${String(c.text.length).padStart(6)}  ${c.text.slice(0, 60)}`);
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

function main(): void {
  const all: Chunk[] = [];

  for (const src of SOURCES) {
    const path = join(RAW_DIR, src.file);
    const html = readFileSync(path, "utf-8");
    const $ = load(html, { xml: { xmlMode: false } });

    const articles = parseArticles($, src);
    const recitals = parseRecitals($, src);
    const annexes = parseAnnexes($, src);
    console.log(
      `${src.regulation}: ${articles.length} article-chunks, ${recitals.length} recital-chunks, ${annexes.length} annex-chunks`,
    );
    all.push(...recitals, ...articles, ...annexes);
  }

  // Sanity: unique ids
  const seen = new Set<string>();
  const dupes: string[] = [];
  for (const c of all) {
    if (seen.has(c.id)) dupes.push(c.id);
    seen.add(c.id);
  }
  if (dupes.length) {
    console.warn(`\n[WARN] duplicate chunk ids: ${dupes.slice(0, 20).join(", ")}${dupes.length > 20 ? " ..." : ""}`);
  }

  writeFileSync(OUT_FILE, JSON.stringify(all, null, 2), "utf-8");
  console.log(`\nWrote ${all.length} chunks -> ${OUT_FILE}`);
  report(all);
}

main();

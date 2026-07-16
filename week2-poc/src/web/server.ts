/**
 * web/server.ts
 * -----------------------------------------------------------------------------
 * Minimal local web UI (US8, FR-013 optional surface): a single form calling
 * the same `answer()` path as the CLI and rendering the grounded answer,
 * citations with links, refusals, and the not-legal-advice notice. Plain
 * node:http — no new dependencies, local use only.
 */

import { createServer } from "node:http";
import type { Config } from "../config.js";
import type { EmbeddingProvider, LLMProvider } from "../providers/types.js";
import { answer, type Retriever } from "../rag/answer.js";

const PAGE = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>EU Regulation Assistant (PoC)</title>
<style>
  body { font-family: system-ui, sans-serif; max-width: 46rem; margin: 2rem auto; padding: 0 1rem; line-height: 1.5; }
  h1 { font-size: 1.3rem; }
  form { display: flex; flex-wrap: wrap; gap: .5rem; margin-bottom: 1rem; }
  input[type=text] { flex: 1 1 100%; padding: .6rem; font-size: 1rem; }
  select, label { font-size: .9rem; }
  button { padding: .5rem 1.2rem; font-size: 1rem; cursor: pointer; }
  #out { border: 1px solid #ccc; border-radius: 6px; padding: 1rem; white-space: pre-wrap; }
  #out.refused { border-color: #c00; background: #fff5f5; }
  .badge { display: inline-block; font-size: .75rem; font-weight: 700; padding: .1rem .5rem; border-radius: 4px; margin-bottom: .5rem; }
  .badge.refused { background: #c00; color: #fff; }
  .badge.grounded { background: #2a7; color: #fff; }
  ul { margin: .5rem 0; }
  .notice { font-size: .85rem; color: #555; border-top: 1px solid #ddd; margin-top: 1rem; padding-top: .5rem; }
  .hidden { display: none; }
</style>
</head>
<body>
<h1>Grounded Q&amp;A over the GDPR &amp; the EU AI Act (PoC)</h1>
<form id="f">
  <input type="text" id="q" placeholder="e.g. What are the lawful bases for processing personal data?" required>
  <select id="reg">
    <option value="">Both regulations</option>
    <option value="GDPR">GDPR only</option>
    <option value="AI_ACT">AI Act only</option>
  </select>
  <label><input type="checkbox" id="recitals"> include recitals</label>
  <button type="submit" id="go">Ask</button>
</form>
<div id="out" class="hidden"></div>
<script>
const f = document.getElementById("f"), out = document.getElementById("out"), go = document.getElementById("go");
f.addEventListener("submit", async (e) => {
  e.preventDefault();
  go.disabled = true; go.textContent = "Asking…";
  out.className = ""; out.textContent = "Retrieving and synthesizing…";
  try {
    const res = await fetch("/api/ask", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        question: document.getElementById("q").value,
        regulation: document.getElementById("reg").value || undefined,
        includeRecitals: document.getElementById("recitals").checked,
      }),
    });
    if (!res.ok) throw new Error(await res.text());
    const a = await res.json();
    out.className = a.mode === "refused" ? "refused" : "";
    out.innerHTML = "";
    const badge = document.createElement("div");
    badge.className = "badge " + a.mode;
    badge.textContent = a.mode === "refused" ? "REFUSED" : "GROUNDED";
    out.appendChild(badge);
    out.appendChild(document.createElement("div")).textContent = a.text;
    if (a.citations.length) {
      const h = out.appendChild(document.createElement("div"));
      h.textContent = "Sources:";
      const ul = out.appendChild(document.createElement("ul"));
      for (const c of a.citations) {
        const li = ul.appendChild(document.createElement("li"));
        const link = li.appendChild(document.createElement("a"));
        link.href = c.url; link.target = "_blank"; link.rel = "noopener";
        link.textContent = c.label;
      }
    }
    const n = out.appendChild(document.createElement("div"));
    n.className = "notice";
    n.textContent = a.not_legal_advice_notice;
  } catch (err) {
    out.className = "refused";
    out.textContent = "Error: " + err.message;
  } finally {
    go.disabled = false; go.textContent = "Ask";
  }
});
</script>
</body>
</html>`;

export function startWebServer(
  cfg: Config,
  deps: { retriever: Retriever; llm: LLMProvider; embedder: EmbeddingProvider },
  port: number,
): Promise<void> {
  const server = createServer(async (req, res) => {
    if (req.method === "GET" && (req.url === "/" || req.url === "/index.html")) {
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" }).end(PAGE);
      return;
    }
    if (req.method === "POST" && req.url === "/api/ask") {
      let body = "";
      for await (const chunk of req) body += chunk;
      try {
        const { question, regulation, includeRecitals } = JSON.parse(body);
        if (typeof question !== "string" || question.trim() === "") {
          res.writeHead(400).end("question is required");
          return;
        }
        const a = await answer(
          {
            question,
            k: cfg.k,
            refusalMinScore: cfg.refusalMinScore,
            filters: { regulation, includeRecitals: includeRecitals === true },
          },
          deps,
        );
        // The retrieved evidence stays server-side; the page needs only the rendered result.
        res.writeHead(200, { "Content-Type": "application/json" }).end(
          JSON.stringify({
            mode: a.mode,
            text: a.text,
            citations: a.citations,
            not_legal_advice_notice: a.not_legal_advice_notice,
          }),
        );
      } catch (err) {
        res.writeHead(500).end(err instanceof Error ? err.message : String(err));
      }
      return;
    }
    res.writeHead(404).end("not found");
  });

  return new Promise((resolve) => {
    server.listen(port, "127.0.0.1", () => {
      console.log(`Web UI: http://localhost:${port} (Ctrl+C to stop)`);
      resolve();
    });
  });
}

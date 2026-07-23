# Demo Script — Grounded RAG PoC (GDPR + EU AI Act) — 5 minutes

Audience: technical. One idea carries the demo: **a confident wrong answer
about the law is worse than no answer** — everything else follows from it.

## Pre-demo checklist (do BEFORE the call)

- [ ] EPAM VPN connected (Dial won't work without it)
- [ ] `cd week2-poc && npm run web` → http://localhost:3000 opens
- [ ] **Pre-run the baseline command** in a terminal and keep the output on
      screen (it takes ~30 s live — don't burn demo time):
      `npm run baseline -- "What are the obligations of deployers of high-risk AI systems?"`
- [ ] README open in the editor, scrolled to the Model comparison table

---

## 0:00–0:30 — Opening

> "This is a compliance Q&A assistant over the GDPR and the EU AI Act. The
> interesting part is not that it answers questions — any chatbot does that.
> It answers ONLY from the regulation text, cites the exact article with a
> EUR-Lex link, and openly refuses when the answer isn't in the corpus."

## 0:30–2:30 — Live demo (web UI, 2 clicks + pre-run terminal)

1. `What are the lawful bases for processing personal data?`
   > "Grounded answer; every claim traces to GDPR Article 6(1); the citation
   > is a deep link — you can check me."
2. `What are the CCPA consumer rights?`
   > "California law is not in the corpus → it refuses and says what it does
   > cover. Refusal is a first-class outcome, not an error."

Switch to the pre-run terminal — the money shot:

> "Same model, same question, with and without retrieval. Without, GPT-4o
> cites Article 29 — the DRAFT numbering; the enacted AI Act moved deployer
> obligations to Article 26. That's a hallucination you'd take into a
> compliance meeting. With retrieval, citations are validated in code against
> what was actually retrieved — a fabricated citation is structurally
> impossible, and it's been zero in every eval run of every model."

## 2:30–3:30 — How it's built (one breath)

> "Spec-first with GitHub Spec Kit, Claude Code as the implementing agent:
> constitution → spec → plan → 40+ tasks, all in the repo. Two principles are
> non-negotiable: every claim grounded in a retrieved chunk, and 'done' is
> defined by an eval gate — 50 golden questions written before the code, with
> thresholds that block a merge on failure. All AI access goes through two
> provider interfaces; a contract test fails if core modules import a vendor
> SDK — that's what made the experiments on the next slide cheap."

## 3:30–4:30 — The evidence (README tables)

> "Because the gate is automated, I could afford real experiments:
>
> - **Seven models through the same gate**: Sonnet 4.5 — the only 100% across
>   the board; budget-tier Haiku passes the full gate — cost per answer drops
>   an order of magnitude; both OpenAI non-flagships fail on refusals —
>   they answer from memory where they must refuse.
> - **The LLM-judge itself is measured**: a three-family judge panel re-scored
>   identical answers; 93.5% unanimous, so the metric is stable — and the
>   90% groundedness threshold sits inside the noise band, which is exactly
>   why report-grade numbers use the panel's majority vote.
> - **Adversarial pack**: jailbreaks, fake articles, injections — nobody
>   fabricated law; failures split into safe over-refusals vs one model
>   giving definitive legal determinations.
> - **Worst case, fully local model via Ollama**: refusal discipline collapses
>   to 25% — but fabricated citations stay at ZERO, because that guarantee
>   lives in code, not in the model. Best argument for the architecture."

## 4:30–5:00 — Close

> "So: grounding enforced by construction, refusal as a feature, quality as a
> measured gate — and the whole path from constitution to experiments is
> traceable in the repo. Questions?"

---

## If asked — short answers

- **Why LanceDB, not pgvector/Pinecone?** Embedded, file-persisted, zero
  infrastructure; reproducibility is a constitutional constraint.
- **Why no LangChain?** The grounding/citation/refusal logic IS the product;
  a framework would hide exactly the code I need to control and test.
- **Judge bias?** The judge is pinned to a neutral third-family model
  (`DIAL_JUDGE_MODEL=gemini-2.5-pro`), and `npm run rejudge` re-scores saved
  answers with a 3-judge panel — the README documents agreement (93.5%
  unanimous) and the two disagreements. Deterministic metrics (hit-rate,
  source match, fabricated count) don't depend on the judge at all.
- **Recitals / structure?** The corpus is structure-aware (articles, annexes,
  recitals as typed chunks); recitals are opt-in — happy to show the checkbox
  live if there's time.
- **Cost & latency?** Every eval report records both: gpt-4o ≈ 2.2k tokens
  and ~3 s per question; the local 4B model is 45–75× slower on CPU.
- **What's deliberately not handled?** Known edge cases live as Phase 12
  backlog in tasks.md (non-English questions answered in-language instead of
  refused; "GDPR annex" should say the GDPR has none). Found by the converge
  step, documented, consciously deferred.

## Cut material (if the slot stretches to 10–15 min)

- Recitals checkbox demo: `Why is the protection of personal data considered a
  fundamental right?` — run with and without **include recitals**.
- Advice-framed question: `Should we use consent or legitimate interest for
  marketing?` — explains both options with citations, declines to recommend.
- War stories (each ~40 s): Article-22 reference pinning; balanced
  cross-regulation retrieval; query rewriting built → measured → rejected
  (hit-rate −27 pts) — "I rejected my own feature with data."
- Five architecture decisions in detail — see README / previous script in git
  history.

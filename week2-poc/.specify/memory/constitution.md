<!--
SYNC IMPACT REPORT
==================
Version change: (none) → 1.0.0   [initial ratification]
Bump rationale: First adoption of the project constitution. MAJOR baseline.

Principles defined (7):
  I.   Grounding (NON-NEGOTIABLE)
  II.  Citation
  III. Explicit Refusal
  IV.  Not Legal Advice
  V.   Provider Independence
  VI.  Evals Gate Quality (NON-NEGOTIABLE)
  VII. Reproducibility

Added sections:
  - Core Principles (7 principles)
  - Additional Constraints & Scope
  - Development Workflow & Quality Gates
  - Governance

Removed sections: none (initial version).

Templates alignment:
  ✅ .specify/templates/plan-template.md  — has dynamic "Constitution Check" gate
     ("Gates determined based on constitution file"); no edit needed.
  ✅ .specify/templates/spec-template.md  — no hardcoded principle references; no edit needed.
  ✅ .specify/templates/tasks-template.md — no hardcoded principle references; no edit needed.

Deferred / TODO: none.
-->

# EU Regulation Grounded RAG Assistant — Constitution

An information tool that answers compliance questions over the text of the GDPR
(Regulation (EU) 2016/679) and the EU AI Act (Regulation (EU) 2024/1689), using
only retrieved passages from the actual regulation texts. It is an information
tool over regulation text, **not** legal advice.

## Core Principles

### I. Grounding (NON-NEGOTIABLE)

Every substantive claim in an answer MUST be supported by a chunk retrieved from
the corpus. The assistant MUST NOT answer from model memory or general knowledge.
If retrieval returns nothing relevant, the assistant MUST NOT fabricate an answer
(see Principle III). Answer synthesis operates strictly over the retrieved
passages provided to it.

**Rationale:** The entire value of the tool is that it reflects the regulation
text, not a language model's recollection of it. Ungrounded output is the primary
failure mode this project exists to prevent.

### II. Citation

Every answer MUST cite the specific source(s) it relied on — the exact article,
paragraph, or annex (e.g. "GDPR Art. 6(1)(f)", "AI Act Art. 16", "AI Act Annex
III") — together with a working link back to the source. No citation → no claim:
any sentence asserting what the law says MUST be traceable to a cited chunk.

**Rationale:** Citations make the answer verifiable by the user and are the visible
proof of grounding. An uncited claim is indistinguishable from a hallucination.

### III. Explicit Refusal

When retrieval is weak or empty, or the question falls outside the corpus, the
assistant MUST decline explicitly and state what it does cover (the text of the
GDPR and the EU AI Act, in English). It MUST NOT guess, improvise, or answer from
outside knowledge to fill the gap. A confident wrong answer is worse than a refusal.

**Rationale:** Knowing the boundary of the corpus and honestly signalling it is a
correctness requirement, not a UX nicety — it prevents the tool from being trusted
where it has no basis to answer.

### IV. Not Legal Advice

The assistant reports what the regulation text says. It MUST NOT tell the user what
they should do, nor provide recommendations, risk assessments, or compliance
verdicts. Questions framed as "should we…?", "are we compliant?", or "which is
better for us?" MUST be declined as advice even when relevant text is retrievable.
This limitation MUST be stated in the system prompt AND surfaced in the
user-facing interface.

**Rationale:** The tool is an information layer over primary legal text; giving
advice would exceed its competence and mislead users about the nature of its output.

### V. Provider Independence

All LLM and embedding access MUST sit behind a swappable interface (e.g.
`LLMProvider`, `EmbeddingProvider`). Application logic MUST NOT contain hardcoded
vendor calls. The default provider is EPAM Dial (OpenAI-compatible endpoint),
selected and configured via environment/config, and replaceable without changing
call sites.

**Rationale:** Decoupling from a single vendor keeps the PoC portable and testable,
and prevents provider-specific assumptions from leaking into core logic.

### VI. Evals Gate Quality (NON-NEGOTIABLE)

The golden evaluation set (`evals/golden-set.json`) is the acceptance gate. The
build is not "done" until it passes the thresholds defined in the plan. Metrics
MUST cover retrieval quality (hit-rate@k, MRR) and LLM-as-judge dimensions
(groundedness, citation correctness, relevance, refusal accuracy). A change that
regresses the eval numbers MUST NOT be merged.

**Rationale:** Written before the code, the golden set is the objective definition
of success; without a hard gate, "grounded" and "refuses correctly" become claims
no one checks.

### VII. Reproducibility

`npm install` plus documented commands MUST reproduce the entire system on a clean
machine. No Docker. The vector store MUST be embedded/in-process and persisted to a
file. Secrets live in `.env` and are NEVER committed (`.env` MUST be gitignored).

**Rationale:** A PoC that only runs on its author's machine cannot be reviewed,
handed over, or trusted. Reproducibility is what makes the results and the demo real.

## Additional Constraints & Scope

**Technology constraints (binding):**
- All application code is TypeScript / Node (Spec Kit's own CLI being Python is expected and out of this scope).
- The vector store is embedded/in-process and file-persisted (LanceDB or sqlite-vec — chosen in the plan phase, not before). No external database, no Docker.
- LLM + embeddings via EPAM Dial (OpenAI-compatible) behind the Principle V interface.
- Corpus: the OJ-published English text of GDPR (2016/679) and the EU AI Act (2024/1689), chunked structure-aware into articles, recitals, and annexes with metadata and source links.

**Explicitly out of scope (the assistant does NOT do these):**
- Legal advice, recommendations, or risk/compliance assessments.
- National implementing laws, case law, guidelines, or opinions.
- Languages other than English.
- Authentication, multi-tenancy, deployment, or scaling concerns.
- Fine-tuning or model training.

## Development Workflow & Quality Gates

- **Spec-driven:** work follows the Spec Kit flow — constitution → specify →
  (clarify) → plan → (checklist) → tasks → (analyze) → implement → converge. Every
  feature traces to a spec requirement.
- **Constitution Check gate:** the plan's Constitution Check MUST pass before design
  and be re-checked after design; violations MUST be justified or removed.
- **Eval gate (Principle VI):** the golden-set harness (retrieval metrics +
  LLM-as-judge) MUST be run before a change is considered complete; regressions
  block merge.
- **Review:** changes touching answer generation are reviewed against Principles
  I–IV; provider code against Principle V; every merge against Principle VI.

## Governance

This constitution supersedes other practices for this project. Amendments MUST be
documented in the Sync Impact Report at the top of this file, carry a version bump,
and state their rationale.

**Versioning policy (semantic):**
- MAJOR — backward-incompatible governance/principle removal or redefinition.
- MINOR — a new principle/section or materially expanded guidance.
- PATCH — clarifications, wording, or non-semantic refinements.

**Compliance review:** every plan, task set, and implementation is expected to
demonstrate compliance with the principles above; unavoidable deviations MUST be
recorded and justified. Runtime development guidance lives in `README.md`.

**Version**: 1.0.0 | **Ratified**: 2026-07-13 | **Last Amended**: 2026-07-13

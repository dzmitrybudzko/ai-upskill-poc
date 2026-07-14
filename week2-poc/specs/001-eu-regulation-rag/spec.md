# Feature Specification: Grounded RAG Assistant over GDPR & the EU AI Act

**Feature Branch**: `001-eu-regulation-rag`

**Created**: 2026-07-13

**Status**: Draft

**Input**: User description: "A grounded RAG chatbot over EU regulations — GDPR (2016/679) and the EU AI Act (2024/1689). It answers compliance questions using only retrieved passages from the actual regulation texts, cites the exact article it relied on, and refuses when the answer is not in the corpus. It is an information tool over regulation text, not legal advice. Core: structure-aware ingestion (done), semantic retrieval, grounded cited synthesis, out-of-corpus refusal, automated eval harness. High value: metadata filtering, cross-regulation synthesis, baseline comparator. Stretch: query rewriting/reranking, minimal web UI."

## Clarifications

### Session 2026-07-13

- Q: Should the assistant be single-turn Q&A or multi-turn conversational? → A: Single-turn Q&A — each question is answered independently, no chat history; multi-turn memory is out of scope.
- Q: Which source types does retrieval search by default (before any user filter)? → A: Articles + annexes by default; recitals are opt-in via filter.
- Q: For an advice-framed question whose underlying text IS in the corpus, what should the assistant do? → A: State what the regulation text says about the options but explicitly decline to recommend one; this is treated as a correct refusal.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Grounded, cited answer to a compliance question (Priority: P1)

A user asks a natural-language question about the GDPR or the EU AI Act (e.g. "What are the lawful bases for processing personal data?"). The assistant retrieves the relevant passages from the regulation corpus, composes an answer using only those passages, and cites the exact article(s)/annex it relied on (e.g. "GDPR Art. 6") with a link back to the source.

**Why this priority**: This is the core value of the product and the minimum viable slice — a question in, a grounded and cited answer out. Without it there is no product.

**Independent Test**: Ask a question whose answer is in the corpus; verify the answer's claims are supported by the cited passages and that every cited article/annex exists and matches the golden-set expectation.

**Acceptance Scenarios**:

1. **Given** a question answerable from the corpus, **When** the user asks it, **Then** the assistant returns an answer whose every substantive claim is supported by a retrieved passage, and cites the specific article(s)/annex with a working link.
2. **Given** an answer is produced, **When** it is inspected, **Then** it contains no claim that lacks a supporting citation, and no citation to an article/annex absent from the corpus.
3. **Given** a question about an AI Act annex topic (e.g. high-risk use cases), **When** asked, **Then** the assistant retrieves and cites the relevant annex (e.g. "AI Act Annex III").

---

### User Story 2 - Honest refusal outside the corpus (Priority: P1)

A user asks something the corpus cannot answer — a different law (CCPA, national implementing law), case law, guidelines, an unrelated topic, or a request for advice ("should we…?", "are we compliant?"). The assistant declines explicitly and states what it does cover, instead of guessing.

**Why this priority**: A confident wrong answer is worse than no answer; refusal is a non-negotiable correctness property, not a nicety. Equal priority to Story 1.

**Independent Test**: Run the refusal group of the golden set; verify each is declined with an explanation of scope and produces no fabricated substantive legal claim or citation.

**Acceptance Scenarios**:

1. **Given** a question about a regulation/topic outside the corpus, **When** asked, **Then** the assistant declines and states it only covers the GDPR and the EU AI Act text.
2. **Given** a request framed as legal advice or a compliance verdict, **When** asked, **Then** the assistant declines to advise and explains it reports what the regulation text says, not what the user should do — even when relevant text exists in the corpus.
3. **Given** retrieval returns only weakly relevant passages, **When** synthesizing, **Then** the assistant refuses rather than stretching thin evidence into an answer.

---

### User Story 3 - Automated quality evaluation against the golden set (Priority: P1)

A developer runs an evaluation harness that scores the assistant against the hand-authored golden set, reporting retrieval quality and answer-quality metrics, so quality is measured objectively and regressions are caught before merge.

**Why this priority**: The golden set is the acceptance gate defined by the constitution; the build is not "done" until it passes. Measuring quality is itself a P1 deliverable.

**Independent Test**: Run the harness against the golden set and confirm it emits per-question and aggregate scores for retrieval (hit-rate@k, MRR) and answer quality (groundedness, citation correctness, relevance, refusal accuracy).

**Acceptance Scenarios**:

1. **Given** the golden set, **When** the harness runs, **Then** it produces retrieval metrics (hit-rate@k, MRR) computed against each question's expected sources.
2. **Given** the golden set, **When** the harness runs, **Then** an automated judge scores each answer on groundedness, citation correctness, relevance, and refusal accuracy, with an aggregate summary.
3. **Given** a change that lowers the aggregate scores, **When** the harness is re-run, **Then** the regression is visible in the report and flagged as failing the gate.

---

### User Story 4 - Scope a query with metadata filters (Priority: P2)

A user narrows the search — e.g. only the GDPR, or only the AI Act; articles only, or including recitals and/or annexes — so answers can be constrained to a chosen slice of the corpus.

**Why this priority**: The structured metadata layer over unstructured text is a differentiator, but the assistant is usable without it. High value, not MVP.

**Independent Test**: Ask a question with a filter (e.g. "GDPR only") and verify the cited sources all come from the selected regulation/type; toggle recitals/annexes and verify inclusion/exclusion.

**Acceptance Scenarios**:

1. **Given** a filter restricting to one regulation, **When** the user asks a question, **Then** all retrieved and cited sources belong to that regulation.
2. **Given** an "articles only" filter, **When** asked, **Then** recitals and annexes are excluded from retrieval; with recitals/annexes enabled, they may be included.

---

### User Story 5 - Cross-regulation synthesis (Priority: P2)

A user asks a question that only both regulations together can answer well (e.g. "We're building an AI that scores individuals using personal data — what do both regulations require?"). The assistant retrieves from both and synthesizes the intersection, citing articles from each.

**Why this priority**: Demonstrates reasoning across the two corpora and reflects real compliance questions, but depends on the core answer path being in place first.

**Independent Test**: Run the cross-regulation golden group; verify answers cite at least one source from each regulation where the golden entry expects both.

**Acceptance Scenarios**:

1. **Given** a cross-regulation question, **When** asked, **Then** the answer cites relevant articles from both the GDPR and the EU AI Act and explains how they relate.

---

### User Story 6 - Baseline comparator (RAG vs. no-RAG) (Priority: P2)

A user (or reviewer) asks the same question with and without retrieval and sees the two answers side by side, making the difference between grounded citations and hallucinated article numbers visible.

**Why this priority**: A powerful demonstration of the product's value and a diagnostic tool, but not required for the assistant to function.

**Independent Test**: Pick factual questions; compare RAG vs. no-RAG answers; verify the no-RAG mode produces at least one incorrect/fabricated article reference that the RAG mode avoids.

**Acceptance Scenarios**:

1. **Given** a factual question, **When** answered in both modes, **Then** the two answers are shown together and the grounded mode's citations are verifiable while the ungrounded mode's are not guaranteed to be.

---

### User Story 7 - Retrieval quality improvement with measured delta (Priority: P3)

A developer adds query rewriting and/or reranking and measures the before/after effect on the golden set, keeping only what improves the numbers.

**Why this priority**: Optimization, valuable only after the measured baseline exists. Stretch.

**Independent Test**: Record eval metrics before and after the change; verify a measurable delta is reported.

**Acceptance Scenarios**:

1. **Given** a retrieval enhancement, **When** the harness is run before and after, **Then** the report shows the metric delta attributable to the change.

---

### User Story 8 - Minimal web interface (Priority: P3)

A user interacts with the assistant through a minimal web UI instead of the command line.

**Why this priority**: Nice demo surface; the CLI is an acceptable demo surface otherwise. Stretch.

**Independent Test**: Submit a question through the UI and confirm the grounded, cited answer (and refusals) render, including the not-legal-advice notice.

**Acceptance Scenarios**:

1. **Given** the web UI, **When** the user submits a question, **Then** the answer, its citations/links, and the not-legal-advice notice are displayed; refusals render clearly.

---

### Edge Cases

- A question partially in scope (e.g. covered by one regulation but referencing another that is out of corpus): the assistant answers the in-corpus part and is explicit about the boundary of what it did not cover.
- A question that maps to several articles/annexes: the assistant cites all the sources its claims rely on, not just one.
- A request that is advice-shaped but whose underlying text exists (e.g. "which lawful basis should we use?"): the assistant reports what the text says about the options and declines to recommend one.
- Retrieval returns only low-relevance passages: the assistant refuses rather than answering weakly.
- A non-English question or a request for a non-English answer: out of scope; the assistant states it covers the English text only.
- A question about a GDPR "annex": the assistant notes the GDPR has no annexes (only the AI Act does).

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The system MUST answer questions using only passages retrieved from the regulation corpus; it MUST NOT introduce claims from model memory or outside knowledge.
- **FR-002**: The system MUST cite, for every answer, the specific article/paragraph/annex each claim relies on, with a working link to the source. An uncited substantive claim MUST NOT appear. A **substantive claim** is any statement asserting what the regulations require, permit, prohibit, or define; connective, framing, or meta language (e.g. "the regulation addresses this in two places") is not a substantive claim and needs no citation.
- **FR-003**: The system MUST NOT cite an article/annex that does not exist in the corpus.
- **FR-004**: The system MUST decline to answer when the question is outside the corpus or when retrieval is too weak to support an answer, and MUST state what it does cover (the English text of the GDPR and the EU AI Act). Retrieval is **too weak** when (a) retrieval returns no passages, or (b) the top-ranked passage's relevance score is below a single configured refusal threshold, whose value is calibrated against the refusal group of the golden set and recorded in the project configuration. Independently of the threshold, the system MUST also refuse when the retrieved passages, once inspected during answer synthesis, do not actually support an answer to the question — thin evidence MUST NOT be stretched into an answer.
- **FR-005**: The system MUST decline requests for legal advice, recommendations, risk assessments, or compliance verdicts, and MUST display a "not legal advice" notice in both the system behaviour and the user-facing surface. A request is **advice-framed** when it asks which option to choose, whether a specific course of action is compliant or permitted, or what the user should do (e.g. "should we…", "are we compliant", "which basis is better for us", "can we legally…"). When such a request's underlying text IS in the corpus, the system MUST state what the regulation text says about the available options but MUST NOT recommend one; this is treated as a refusal, not an answer.
- **FR-006**: The system MUST retrieve relevant passages for a user question from the corpus of GDPR and EU AI Act articles, recitals, and annexes.
- **FR-007**: The system MUST search articles and annexes by default; recitals MUST be excluded unless the user opts in. The system MUST support restricting retrieval by metadata — at minimum by regulation, and by source type (articles only, or including recitals and/or annexes).
- **FR-008**: The system MUST support questions that require both regulations, retrieving from each and synthesizing an answer that cites sources from both.
- **FR-009**: The system MUST provide an evaluation harness that scores the assistant against the golden set and reports retrieval metrics (hit-rate@k, MRR) and judged answer-quality metrics (groundedness, citation correctness, relevance, refusal accuracy), both per-question and aggregate.
- **FR-010**: The evaluation harness MUST make regressions in the aggregate metrics visible so a change that lowers quality can be identified and blocked from merge.
- **FR-011**: The system SHOULD offer a baseline comparison that answers the same question with and without retrieval, presented side by side.
- **FR-012**: The system MAY provide optional retrieval enhancements (query rewriting and/or reranking) whose effect on the golden-set metrics is measured before/after.
- **FR-013**: The system MUST expose a usable demo surface; a command-line interface is sufficient, with a minimal web interface as an optional enhancement.
- **FR-014**: Answers, citations, refusals, and the not-legal-advice notice MUST be rendered clearly on whichever surface is used. The notice MUST read exactly: "Not legal advice. This tool reports what the official English texts of the GDPR and the EU AI Act say; consult a qualified legal professional for advice on your specific situation." It MUST appear verbatim on every response — grounded answers and refusals alike, including baseline-comparison output — on every surface offered (command line, and the web interface if built).
- **FR-015**: The system MUST treat each question independently (single-turn). Maintaining multi-turn conversational context or chat history is out of scope.

### Key Entities *(include if feature involves data)*

- **Question**: a user's natural-language query; may carry optional metadata filters (regulation, source type).
- **Source Chunk**: a retrievable unit of regulation text with metadata — regulation (GDPR / AI Act), type (article / recital / annex), article or annex identifier, paragraph, text, and a source link. (Produced by the completed ingestion step.)
- **Answer**: the assistant's response — either a grounded, cited answer or an explicit refusal — always accompanied by the not-legal-advice notice.
- **Citation**: a link between a claim in the answer and the specific source chunk(s) supporting it, identifying the article/annex and providing a link.
- **Golden Question**: a labelled evaluation item — question, group, expected sources, expected behaviour (answer/refuse) — used as the acceptance gate.
- **Evaluation Result**: per-question and aggregate scores across retrieval and answer-quality metrics.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: On the refusal group of the golden set, at least 90% of questions are correctly declined (no fabricated substantive answer or citation).
- **SC-002**: On the factual groups, the expected source appears in the retrieved set (hit-rate@k) for at least 85% of questions.
- **SC-003**: At least 90% of answered questions are judged fully grounded — every claim supported by a cited source.
- **SC-004**: At least 90% of answers cite the correct primary source expected by the golden set.
- **SC-005**: Zero answers cite an article/annex that does not exist in the corpus (no fabricated citations).
- **SC-006**: In the baseline comparison on factual questions, the without-retrieval mode produces at least one incorrect or fabricated article reference that the with-retrieval mode does not — demonstrating the value of grounding.
- **SC-007**: A reviewer can reproduce the corpus, the search index, and an evaluation run on a clean machine using the documented setup and commands, without container tooling.

*Note: the exact numeric thresholds above are the PoC acceptance bar and are confirmed/adjusted in the planning phase; they remain the objective gate per the constitution.*

## Out of Scope

The following are explicitly excluded from this feature:

- Legal advice, recommendations, or risk/compliance assessments.
- National implementing laws, case law, guidelines, or opinions.
- Languages other than English.
- Authentication, multi-tenancy, deployment, or scaling.
- Fine-tuning or model training.
- Multi-turn conversational memory / chat history (the assistant is single-turn).

## Assumptions

- The regulation corpus is already built (prior ingestion step): structure-aware chunks of the OJ-published English text of the GDPR (2016/679) and the EU AI Act (2024/1689) — articles, recitals, and all AI Act annexes — each with metadata and a source link.
- The golden evaluation set already exists and serves as the acceptance gate; it defines expected sources and expected behaviour (answer/refuse) per question.
- An AI language-generation and text-embedding capability is available to the system through a swappable interface; no specific vendor is assumed at the specification level (the provider is a configuration choice).
- A single-machine, non-containerized runtime is the target; configuration and secrets are supplied via the environment and are never committed.
- By default, retrieval considers articles and annexes; inclusion of recitals is a user-selectable option (recitals are interpretive context).
- The command line is an acceptable primary demo surface; a web interface is an optional enhancement.

# Grounding, Citation & Refusal — Requirements Quality Checklist: Grounded RAG Assistant

**Purpose**: Unit-test the *requirements* (spec.md) for the product's core promise — grounding, exact citation, no fabrication, refusal, and not-legal-advice — for completeness, clarity, consistency, and measurability. This validates the requirements are well-written, NOT that any code works.
**Created**: 2026-07-13
**Feature**: [spec.md](../spec.md)
**Depth**: Standard review

## Requirement Completeness

- [ ] CHK001 - Is the rule "a grounded answer with zero valid citations must become a refusal" stated at the requirements level, not only in the design/contracts? [Gap, Spec §FR-002/§FR-004]
- [ ] CHK002 - Are requirements defined for how many sources an answer must cite when several articles support it (cite all relied-upon, not just one)? [Completeness, Spec §FR-002]
- [ ] CHK003 - Is the exact content and mandatory placement of the "not legal advice" notice specified (wording, on every answer AND refusal, on each surface)? [Gap, Spec §FR-005/§FR-014]
- [ ] CHK004 - Is a non-English question handled by a stated requirement, or only mentioned as an edge case without a corresponding FR? [Completeness, Spec §Edge Cases]
- [ ] CHK005 - Are requirements defined for citing recitals when opted in (may be cited, flagged as interpretive vs. operative text)? [Gap, Spec §FR-007]

## Requirement Clarity

- [ ] CHK006 - Is "substantive claim" defined so it is unambiguous which sentences require a citation versus connective/framing prose? [Ambiguity, Spec §FR-001/§FR-002]
- [ ] CHK007 - Is the required citation granularity specified (article-level vs. paragraph/point-level, e.g. must it reach "Art. 6(1)(f)" or is "Art. 6" sufficient)? [Clarity, Spec §FR-002]
- [ ] CHK008 - Is "retrieval too weak to support an answer" quantified or given an objective criterion at the requirements level, rather than left to implementation? [Ambiguity, Spec §FR-004]
- [ ] CHK009 - Are the criteria that classify a question as "advice-framed" specified, so the decline-to-recommend rule can be applied consistently? [Ambiguity, Spec §FR-005]
- [ ] CHK010 - Is the required content of a refusal message specified (must name the covered corpus: GDPR + EU AI Act, English)? [Clarity, Spec §FR-004]
- [ ] CHK011 - Is "working link" defined measurably (what makes a citation link valid/verifiable)? [Measurability, Spec §FR-002]

## Requirement Consistency

- [x] CHK012 - Is FR-005's normative strength consistent with the clarified decision? RESOLVED 2026-07-13: FR-005 changed MAY→MUST ("MUST state what the text says … MUST NOT recommend"), now consistent with the clarification. [Conflict, Spec §FR-005 / §Clarifications]
- [ ] CHK013 - Do the metrics treat the advice-framing case consistently: FR-005 counts "state text, decline to recommend" as a refusal, but groundedness (SC-003) is measured over "answered" questions — is the classification of that case consistent across both? [Consistency, Spec §FR-005/§SC-003]
- [ ] CHK014 - Is the article/annex-level source-matching rule (used for hit-rate and citation correctness) stated in the spec, or only implicit in the golden set? [Consistency, Spec §SC-002/§SC-004]
- [ ] CHK015 - Are the grounding/citation requirements consistent between single-regulation answers and cross-regulation answers (both require every claim cited)? [Consistency, Spec §FR-002/§FR-008]

## Acceptance Criteria Quality (Measurability)

- [ ] CHK016 - Are the judged dimensions (groundedness, citation correctness, relevance, refusal accuracy) each defined with an objective rubric so scoring is repeatable, not left to judge discretion? [Measurability, Spec §FR-009/§SC-003/§SC-004]
- [ ] CHK017 - Is "citation correctness" distinguished from mere source presence — does it require the cited article to actually support the claim (precision), not just appear in retrieval? [Clarity, Spec §SC-004]
- [ ] CHK018 - Is the "zero fabricated citations" criterion defined precisely (a citation to any id not in the retrieved set, or to a non-existent article/annex)? [Measurability, Spec §SC-005]

## Scenario & Edge-Case Coverage

- [ ] CHK019 - Are requirements defined for partial-scope questions (part answerable, part out of corpus) specifying how much to answer and how to state the boundary? [Coverage, Spec §Edge Cases]
- [ ] CHK020 - Are requirements defined for topically-similar false positives — retrieval returns a plausible but wrong article — so citation correctness addresses precision, not just recall? [Coverage, Gap]
- [ ] CHK021 - Is the refusal behavior specified for a question that is in-domain but simply absent from the corpus (e.g. a detail the text does not state), distinct from an out-of-corpus topic? [Coverage, Spec §FR-004]

## Dependencies & Assumptions

- [ ] CHK022 - Is the assumption that every corpus chunk carries a valid deep link (required for FR-002 citations) stated and validated? [Assumption, Spec §FR-002/§Assumptions]

## Notes

- These items test the **requirements' quality**, not implementation. An item "fails" if the spec does not clearly/completely/consistently/measurably specify the thing asked about.
- Several items intentionally surface genuine gaps in the current spec (e.g. CHK003 notice wording, CHK006 "substantive claim", CHK008 refusal threshold, CHK016 judge rubrics). These are candidates to tighten in the spec before or during `/speckit-tasks`, or to accept explicitly as PoC-level looseness.
- Check items off as the requirement is confirmed adequate (`[x]`) or record the gap inline.

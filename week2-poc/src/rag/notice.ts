/**
 * rag/notice.ts
 * -----------------------------------------------------------------------------
 * Fixed user-facing wording (FR-004, FR-005, FR-014 — exact text mandated by
 * the spec; resolves CHK003/CHK010). Rendered verbatim on every response,
 * grounded or refused, on every surface.
 */

/** FR-014: exact notice wording, verbatim on every answer and refusal. */
export const NOT_LEGAL_ADVICE_NOTICE =
  "Not legal advice. This tool reports what the official English texts of the GDPR and the EU AI Act say; consult a qualified legal professional for advice on your specific situation.";

/** FR-004: refusals state what the assistant does cover. */
export const COVERAGE_STATEMENT =
  "I can only answer from the English text of the GDPR (Regulation (EU) 2016/679) and the EU AI Act (Regulation (EU) 2024/1689).";

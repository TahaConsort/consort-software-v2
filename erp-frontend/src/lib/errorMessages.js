import { DOC_TYPE_LABELS } from "@/services/documentService";

// Backend messages that should never reach users verbatim.
const TECHNICAL_RE = /^Request failed|^timeout of|^Network Error|prisma\.|^Cannot read|npm i /i;
// Optimistic-concurrency / stale-data phrasing from the API.
const STALE_RE = /rowVersion|If-Match|modified by someone else|changed since you loaded|needs a refresh/i;
// Internal rule identifiers appended to messages — both three-segment forms
// like "(RULE-SH-04)"/"(EDGE-FI-01)" and two-segment invariants like "(INV-06)".
const RULE_ID_RE = /\s*\((RULE|INV|EDGE)(-[A-Z]{2,5})?-\d+\)/g;

const STALE_MSG = "Someone else updated this while you had it open. Refresh the page and try again.";
const GENERIC_MSG = "Something went wrong on our side — please try again. Nothing was saved.";

/** "containerTypeCode" → "Container type code" */
const humanizeField = (field) => {
  const spaced = field.replace(/([a-z0-9])([A-Z])/g, "$1 $2").toLowerCase();
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
};

/**
 * Translate a normalized API error into a message safe to show end users.
 *
 * Resolution order: known sentinel strings → stale-data (412/428/rowVersion)
 * → missing-document enrichment → Zod validation reshaping → rule-ID cleanup
 * → per-status fallbacks for empty/technical text → cleaned backend text.
 *
 * @param {number|undefined} status HTTP status code, if any.
 * @param {string|undefined} raw    Raw backend/axios message.
 * @returns {string} A user-friendly error message.
 */
export function friendlyError(status, raw) {
  const text = typeof raw === "string" ? raw : "";

  // 1. Exact sentinels.
  if (text.includes("SHIPMENT_ON_HOLD")) {
    return "This shipment is on hold — resume it before recording progress.";
  }
  if (text.includes("Refresh reuse detected")) {
    return "Your session was reset for security — please sign in again.";
  }

  // 2. Stale-data family (optimistic concurrency).
  if (status === 412 || status === 428 || STALE_RE.test(text)) {
    return STALE_MSG;
  }

  // 3. Missing-documents enrichment — map codes to human labels.
  const docsMatch = text.match(/Required document\(s\) not attached for this step: ([^(]+)/);
  if (docsMatch) {
    const names = docsMatch[1]
      .trim()
      .replace(/[.\s]+$/, "")
      .split(", ")
      .map((code) => DOC_TYPE_LABELS[code] ?? code)
      .join(", ");
    return `Attach these documents first: ${names}.`;
  }

  // 4. Zod validation reshaping.
  if (text.startsWith("Validation Error:")) {
    const issues = text
      .slice("Validation Error:".length)
      .trim()
      .split(", ")
      .filter(Boolean)
      .map((issue) => {
        const clean = issue.replace(/^path:\s*/, "");
        const colon = clean.indexOf(":");
        if (colon === -1) return clean;
        // Drop the object path, keep only the leaf field name.
        const field = clean.slice(0, colon).split(".").pop().trim();
        const detail = clean.slice(colon + 1).trim();
        return `${humanizeField(field)}: ${detail}`;
      });
    const shown = issues.slice(0, 3);
    const more = issues.length - shown.length;
    return `Please check: ${shown.join(", ")}${more > 0 ? ` and ${more} more` : ""}`;
  }

  // 5. Always strip internal rule IDs before showing backend text.
  const cleaned = text.replace(RULE_ID_RE, "").trim();

  // 6. Per-status fallbacks when there's nothing usable to show.
  if (!cleaned || TECHNICAL_RE.test(cleaned)) {
    if (status === 401) return "Your session has expired — please sign in again.";
    if (status === 403) return "You don't have permission to do this.";
    if (status === 404) return "That record no longer exists or isn't available to you.";
    if (status === 409) return "This action conflicts with the current state — refresh and try again.";
    if (status === 429) return "Too many requests — please wait a moment and try again.";
    return GENERIC_MSG; // >= 500, no status, or otherwise unusable
  }

  // 7. Backend text is presentable — return it (rule IDs already stripped).
  return cleaned;
}

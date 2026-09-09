import api from "@/lib/axios";

/**
 * One-time customer approval links (ADR-055).
 *
 * The internal half issues and revokes; the public half is what the customer's browser
 * calls, with no account and no token beyond the one in the URL. `/public/` is already
 * on the axios NO_REFRESH list, so a 401/404 there never force-logs-out a visitor.
 */

/** Where the customer lands. Built against the app's own origin — no config needed. */
export const approvalUrlFor = (token) =>
  `${typeof window === "undefined" ? "" : window.location.origin}/approve/${token}`;

/**
 * Mint a link. The plaintext token comes back exactly once, so the caller must use it
 * immediately (copy it / show it) — asking again only ever returns the status.
 */
export const issueApprovalLink = async (quotationId, expiresInDays) => {
  const res = await api.post(`/quotations/${quotationId}/approval-link`,
    expiresInDays ? { expiresInDays } : {});
  return res.data;
};

/**
 * Sales records the customer's verbal yes and gets a fresh link to relay in the same
 * call (ADR-056). Same one-time-token contract as issueApprovalLink.
 * @param payload { via: "email"|"phone"|"whatsapp"|"in_person", note?, expiresInDays? }
 */
export const recordAcceptance = async (quotationId, payload) => {
  const res = await api.post(`/quotations/${quotationId}/acceptance`, payload);
  return res.data;
};

/** → { active, lastDecision } — status only; the token is never returned again. */
export const getApprovalLink = async (quotationId) => {
  const res = await api.get(`/quotations/${quotationId}/approval-link`);
  return res.data;
};

export const revokeApprovalLink = async (quotationId) => {
  const res = await api.delete(`/quotations/${quotationId}/approval-link`);
  return res.data;
};

/* ── The customer's side — anonymous ── */

export const viewApproval = async (token) => {
  const res = await api.get(`/public/approvals/${token}`);
  return res.data;
};

export const submitApproval = async (token, payload) => {
  const res = await api.post(`/public/approvals/${token}/decision`, payload);
  return res.data;
};

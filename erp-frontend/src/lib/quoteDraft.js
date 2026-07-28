/**
 * Pending quote draft (CRM_MASTER §5.20).
 *
 * The storefront's "Get a quote" requires an account. When an anonymous visitor
 * has configured the rate calculator and hits the signup gate, their selection
 * is parked here so it survives the redirect and is submitted as a real Query
 * the moment their portal exists — they never retype it.
 *
 * sessionStorage (not localStorage): a draft is scoped to this tab/visit and
 * must not linger on a shared machine.
 */
const KEY = "consort.pendingQuote";

export const saveQuoteDraft = (draft) => {
  try {
    sessionStorage.setItem(KEY, JSON.stringify({ ...draft, savedAt: Date.now() }));
  } catch {
    /* private mode / quota — the form simply starts empty after signup */
  }
};

export const readQuoteDraft = () => {
  try {
    const raw = sessionStorage.getItem(KEY);
    if (!raw) return null;
    const draft = JSON.parse(raw);
    // Stale drafts (>2h) are dropped rather than silently quoting old input.
    if (!draft?.services?.length || Date.now() - (draft.savedAt ?? 0) > 2 * 60 * 60 * 1000) {
      sessionStorage.removeItem(KEY);
      return null;
    }
    return draft;
  } catch {
    return null;
  }
};

export const clearQuoteDraft = () => {
  try {
    sessionStorage.removeItem(KEY);
  } catch {
    /* no-op */
  }
};

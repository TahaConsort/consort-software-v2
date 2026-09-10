/**
 * Labels and chip tones for the lead machine (WORKFLOW §2) and sources (ADR-042).
 *
 * Deliberately a plain `.js` module with no components in it: `leadBadges.jsx` next door
 * exports the badges. Mixing the two in one file breaks React Fast Refresh, which is what
 * `react-refresh/only-export-components` was reporting on the combined version.
 */

export const LEAD_STATUS_LABELS = {
  new: "New",
  contacted: "Contacted",
  qualified: "Qualified",
  converted: "Converted",
  lost: "Lost",
};

export const LEAD_SOURCE_LABELS = {
  bdo: "BDO",
  bank_lc: "Bank LC",
  direct: "Direct",
};

export const OUTREACH_TYPE_LABELS = {
  call: "Call",
  email: "Email",
  meeting: "Meeting",
  whatsapp: "WhatsApp",
  linkedin: "LinkedIn",
  site_visit: "Site Visit",
};

export const OUTREACH_OUTCOME_LABELS = {
  positive: "Positive",
  neutral: "Neutral",
  negative: "Negative",
  no_response: "No Response",
};

/**
 * One chip recipe for every badge on the BDO screens — `/10` fill, `/30` hairline,
 * nowrap — so a row reads as a single family. Badge's own `soft` variant paints
 * `bg-primary/10 text-primary`; these classes are merged in last (the component runs
 * them through tailwind-merge), so they replace it cleanly rather than fighting it.
 */
export const CHIP = "whitespace-nowrap border text-xs";

/** Neutral chip for facts that carry no state of their own. */
export const NEUTRAL_CHIP = "border-border bg-muted text-muted-foreground";

/**
 * The five lead statuses map onto the semantic tokens by what the row MEANS: `new` is a
 * notice, `contacted` is in flight, `qualified` is the brand's own "worth pursuing",
 * `converted` is the win and `lost` is the dead end. No `dark:` variants — the tokens
 * carry both themes.
 */
export const LEAD_STATUS_STYLES = {
  new: "border-info/30 bg-info/10 text-info",
  contacted: "border-warning/30 bg-warning/10 text-warning",
  qualified: "border-primary/30 bg-primary/10 text-primary",
  converted: "border-success/30 bg-success/10 text-success",
  lost: "border-destructive/30 bg-destructive/10 text-destructive",
};

/**
 * Outreach outcomes: did the conversation go anywhere. `no_response` shares the warning
 * ramp with nothing else here, and separates itself with a dashed border rather than
 * inventing a fifth hue.
 */
export const OUTREACH_OUTCOME_STYLES = {
  positive: "border-success/30 bg-success/10 text-success",
  neutral: NEUTRAL_CHIP,
  negative: "border-destructive/30 bg-destructive/10 text-destructive",
  no_response: "border-dashed border-warning/50 bg-warning/10 text-warning",
};

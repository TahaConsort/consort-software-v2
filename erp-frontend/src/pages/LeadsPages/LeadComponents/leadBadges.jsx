import { Badge } from "@neuctra/ui";
import {
  CHIP,
  NEUTRAL_CHIP,
  LEAD_STATUS_LABELS,
  LEAD_STATUS_STYLES,
  LEAD_SOURCE_LABELS,
  OUTREACH_OUTCOME_LABELS,
  OUTREACH_OUTCOME_STYLES,
} from "./leadLabels";

/**
 * The badges for the lead machine. Components only — the labels and tone maps live in
 * `leadLabels.js` so Fast Refresh keeps working on this file.
 */

export const LeadStatusBadge = ({ status }) => (
  <Badge
    variant="soft"
    size="sm"
    text={LEAD_STATUS_LABELS[status] ?? status}
    className={`${CHIP} ${LEAD_STATUS_STYLES[status] ?? NEUTRAL_CHIP}`}
  />
);

export const LeadSourceBadge = ({ source }) => (
  <Badge
    variant="soft"
    size="sm"
    text={LEAD_SOURCE_LABELS[source] ?? source}
    className={`${CHIP} ${NEUTRAL_CHIP}`}
  />
);

/** Outcome of one logged touch — used by the outreach log and the visit debrief. */
export const OutreachOutcomeBadge = ({ outcome }) => (
  <Badge
    variant="soft"
    size="sm"
    text={OUTREACH_OUTCOME_LABELS[outcome] ?? outcome}
    className={`${CHIP} ${OUTREACH_OUTCOME_STYLES[outcome] ?? NEUTRAL_CHIP}`}
  />
);

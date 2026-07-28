import { Badge } from "@/components/ui/badge";

/** Shared labels + badges for the lead machine (WORKFLOW §2) and sources (ADR-042). */

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

const STATUS_STYLES = {
  new: "bg-blue-50 text-blue-700 border-blue-300 dark:bg-blue-950/30 dark:text-blue-300",
  contacted: "bg-amber-50 text-amber-700 border-amber-300 dark:bg-amber-950/30 dark:text-amber-300",
  qualified: "bg-violet-50 text-violet-700 border-violet-300 dark:bg-violet-950/30 dark:text-violet-300",
  converted: "bg-green-50 text-green-700 border-green-400 dark:bg-green-950/30 dark:text-green-300",
  lost: "bg-red-50 text-red-700 border-red-300 dark:bg-red-950/30 dark:text-red-300",
};

export const LeadStatusBadge = ({ status }) => (
  <Badge variant="outline" className={`text-xs ${STATUS_STYLES[status] ?? ""}`}>
    {LEAD_STATUS_LABELS[status] ?? status}
  </Badge>
);

export const LeadSourceBadge = ({ source }) => (
  <Badge variant="secondary" className="text-xs">
    {LEAD_SOURCE_LABELS[source] ?? source}
  </Badge>
);

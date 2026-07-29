/**
 * The trading currency of the business. Every place that has to invent a currency
 * — a quotation with none supplied, a manual invoice, a load-board posting, the
 * indicative rate calculator — reads it from here rather than hard-coding one, so
 * switching it is a one-line change instead of a hunt through twenty files.
 *
 * This is the DEFAULT for new records only. Currency is stored per row, so a job
 * priced in another currency (an ocean carrier billing USD, say) still works — the
 * caller just supplies it explicitly.
 */
export const DEFAULT_CURRENCY = "PKR";

/**
 * The rate used to restate this repo's original USD-denominated seed and fallback
 * figures into PKR. It is a static convenience for indicative pricing ONLY — it is
 * not a live FX feed and nothing financial is computed through it. Invoices and
 * quotations carry their own `fxRate` captured at commit (ADR-006).
 */
export const USD_TO_PKR = 280;

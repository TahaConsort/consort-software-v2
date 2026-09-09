/**
 * Superseded by scripts/applyRoadmapWorkflow.js (ADR-057): the roadmap path is now THE
 * shipment workflow, not a trade-only one. Kept so the docs and runbooks that cite this
 * name still work — it runs the new script with the same flags.
 *
 *   node scripts/applyTradeWorkflow.js [--apply] [--recompose-untouched]
 */
import "./applyRoadmapWorkflow.js";

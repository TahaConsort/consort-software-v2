import express from "express";
import { protect, requirePermission } from "../auth/auth.middleware.js";
import { validate } from "../../middleware/validate.middleware.js";
import {
  createContractSchema,
  updateContractSchema,
  createFiSchema,
  updateFiSchema,
  drawdownSchema,
  closeFiSchema,
  createContainerSchema,
  updateContainerSchema,
  upsertPackingListSchema,
  packingListItemsSchema,
  createTradeInvoiceSchema,
  updateTradeInvoiceSchema,
  tradeInvoiceLinesSchema,
  voidTradeInvoiceSchema,
  upsertBolSchema,
  upsertGdSchema,
  gdLinesSchema,
} from "./trade.validation.js";
import {
  listContracts,
  getContract,
  createContract,
  updateContract,
  listFis,
  getFi,
  createFi,
  updateFi,
  addDrawdown,
  closeFi,
  listContainers,
  addContainer,
  updateContainer,
  removeContainer,
  getPackingList,
  upsertPackingList,
  replacePackingListItems,
  confirmPackingList,
  listTradeInvoices,
  createTradeInvoice,
  updateTradeInvoice,
  replaceTradeInvoiceLines,
  seedLinesFromPackingList,
  issueTradeInvoice,
  voidTradeInvoice,
  getBol,
  upsertBol,
  getGd,
  upsertGd,
  replaceGdLines,
  getTradeOverview,
  getTradeAlerts,
  generatePackingListPdf,
  generateCommercialInvoicePdf,
} from "./trade.controllers.js";

/**
 * Export trade documents (Export Shipment Workflow roadmap §4), mounted at /api/trade.
 *
 * Permissions follow the department that owns the corresponding OTD step, so the trade
 * layer never contradicts the operational one:
 *
 *   trade.read              every role that can already see the shipment
 *   trade.contract.manage   Operations + Sales — the order behind the shipment
 *   fi.manage / fi.close    Accounts — a bank instrument with a ceiling and a balance
 *   trade.cargo.manage      Operations — containers and the packing list
 *   trade.invoice.manage    Operations (purchase side) and Accounts (sale side)
 *   trade.invoice.issue     Accounts only — four-eyes against whoever drafted it
 *   trade.transport.manage  Operations — the Bill of Lading
 *   trade.customs.manage    Compliance — the Goods Declaration (mirrors step 95)
 *
 * Shipment-scoped routes additionally inherit the shipment's row scope inside the
 * controller (loadTradeShipment): out of scope reads 404, never 403.
 */
const router = express.Router();

router.use(protect);

// ── Registers that exist BEFORE a shipment does (roadmap Step 1) ─────────────
router.get("/contracts", requirePermission("trade.read"), listContracts);
router.get("/contracts/:id", requirePermission("trade.read"), getContract);
router.post("/contracts", requirePermission("trade.contract.manage"), validate(createContractSchema), createContract);
router.patch("/contracts/:id", requirePermission("trade.contract.manage"), validate(updateContractSchema), updateContract);

router.get("/instruments", requirePermission("trade.read"), listFis);
router.get("/instruments/:id", requirePermission("trade.read"), getFi);
router.post("/instruments", requirePermission("fi.manage"), validate(createFiSchema), createFi);
router.patch("/instruments/:id", requirePermission("fi.manage"), validate(updateFiSchema), updateFi);
router.post("/instruments/:id/drawdowns", requirePermission("fi.manage"), validate(drawdownSchema), addDrawdown);
router.post("/instruments/:id/close", requirePermission("fi.close"), validate(closeFiSchema), closeFi);

// ── Everything below hangs off one shipment ─────────────────────────────────
router.get("/shipments/:shipmentId/overview", requirePermission("trade.read"), getTradeOverview);
router.get("/shipments/:shipmentId/alerts", requirePermission("trade.read"), getTradeAlerts);

// Containers + packing list — Operations (roadmap §4.3, §7)
router.get("/shipments/:shipmentId/containers", requirePermission("trade.read"), listContainers);
router.post("/shipments/:shipmentId/containers", requirePermission("trade.cargo.manage"), validate(createContainerSchema), addContainer);
router.patch("/shipments/:shipmentId/containers/:containerId", requirePermission("trade.cargo.manage"), validate(updateContainerSchema), updateContainer);
router.delete("/shipments/:shipmentId/containers/:containerId", requirePermission("trade.cargo.manage"), removeContainer);

router.get("/shipments/:shipmentId/packing-list", requirePermission("trade.read"), getPackingList);
router.put("/shipments/:shipmentId/packing-list", requirePermission("trade.cargo.manage"), validate(upsertPackingListSchema), upsertPackingList);
router.put("/shipments/:shipmentId/packing-list/items", requirePermission("trade.cargo.manage"), validate(packingListItemsSchema), replacePackingListItems);
router.post("/shipments/:shipmentId/packing-list/confirm", requirePermission("trade.cargo.manage"), confirmPackingList);
// Render the packing list from its own line items and attach it as a shipment
// document, which also ticks the matching order_confirmed checklist item (ADR-048).
router.post("/shipments/:shipmentId/packing-list/pdf", requirePermission("trade.cargo.manage"), generatePackingListPdf);

// Commercial invoices — the `side` guard inside the controller decides purchase vs sale
// (roadmap §4.4). `trade.invoice.manage` gets you as far as a draft; issuing needs
// `trade.invoice.issue`, which only Accounts and Management hold.
router.get("/shipments/:shipmentId/invoices", requirePermission("trade.read"), listTradeInvoices);
router.post("/shipments/:shipmentId/invoices", requirePermission("trade.invoice.manage"), validate(createTradeInvoiceSchema), createTradeInvoice);
router.patch("/shipments/:shipmentId/invoices/:invoiceId", requirePermission("trade.invoice.manage"), validate(updateTradeInvoiceSchema), updateTradeInvoice);
router.put("/shipments/:shipmentId/invoices/:invoiceId/lines", requirePermission("trade.invoice.manage"), validate(tradeInvoiceLinesSchema), replaceTradeInvoiceLines);
router.post("/shipments/:shipmentId/invoices/:invoiceId/lines/from-packing-list", requirePermission("trade.invoice.manage"), seedLinesFromPackingList);
router.post("/shipments/:shipmentId/invoices/:invoiceId/issue", requirePermission("trade.invoice.issue"), issueTradeInvoice);
router.post("/shipments/:shipmentId/invoices/:invoiceId/void", requirePermission("trade.invoice.issue"), validate(voidTradeInvoiceSchema), voidTradeInvoice);
router.post("/shipments/:shipmentId/invoices/:invoiceId/pdf", requirePermission("trade.invoice.manage"), generateCommercialInvoicePdf);

// Bill of Lading — Operations (§4.5)
router.get("/shipments/:shipmentId/bill-of-lading", requirePermission("trade.read"), getBol);
router.put("/shipments/:shipmentId/bill-of-lading", requirePermission("trade.transport.manage"), validate(upsertBolSchema), upsertBol);

// Goods Declaration — Compliance (§4.6)
router.get("/shipments/:shipmentId/goods-declaration", requirePermission("trade.read"), getGd);
router.put("/shipments/:shipmentId/goods-declaration", requirePermission("trade.customs.manage"), validate(upsertGdSchema), upsertGd);
router.put("/shipments/:shipmentId/goods-declaration/lines", requirePermission("trade.customs.manage"), validate(gdLinesSchema), replaceGdLines);

export default router;

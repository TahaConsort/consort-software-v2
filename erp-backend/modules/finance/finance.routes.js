import express from "express";
import {
  listInvoices,
  getInvoice,
  createInvoice,
  issueInvoice,
  recordPayment,
  voidInvoice,
} from "./finance.controllers.js";
import { protect, requirePermission } from "../auth/auth.middleware.js";
import { requireFinanceAccess, attachInvoiceScope } from "./finance.middleware.js";
import { validate } from "../../middleware/validate.middleware.js";
import { createInvoiceSchema, recordPaymentSchema, voidInvoiceSchema } from "./finance.validation.js";

const router = express.Router();

router.use(protect);

// Create a manual invoice (payable/receivable) from a step. Held by a broader set
// than the finance desk (Accounts + Ops/Compliance/Transport managers + Management),
// so it sits BEFORE the finance-access gate and is guarded purely by the permission.
router.post("/invoices", requirePermission("invoice.create"), validate(createInvoiceSchema), createInvoice);

// Everything below is the finance desk + customers, with row scope.
router.use(requireFinanceAccess, attachInvoiceScope);

// Read is gated by the role (requireFinanceAccess) + row scope; customers see
// only their own invoices (§2.2 "C (read)"), so no extra permission is needed.
router.get("/invoices", listInvoices);
router.get("/invoices/:id", getInvoice);

// Accounts-only mutations (RULE-FI).
router.post("/invoices/:id/issue", requirePermission("invoice.issue"), issueInvoice);
router.post("/invoices/:id/payments", requirePermission("payment.record"), validate(recordPaymentSchema), recordPayment);
router.post("/invoices/:id/void", requirePermission("invoice.void"), validate(voidInvoiceSchema), voidInvoice);

export default router;

import prisma from "../../config/prisma.js";
import { requireRole, isManagement, hasRole } from "../auth/auth.middleware.js";

/**
 * Finance access + scope (BUSINESS_RULES §2.2).
 *   Accounts     issue/void invoices, record payments, OTC 3–5 (D = finance)
 *   Management   read (A)
 *   Customer     read own (C)
 */
export const requireFinanceAccess = requireRole(
  "ceo",
  "project_director",
  "director",
  "cfo",
  "gm",
  "accounts",
  "customer",
);

export const attachInvoiceScope = async (req, res, next) => {
  try {
    if (isManagement(req.user) || hasRole(req.user, "accounts")) {
      req.invoiceScope = null;
    } else {
      // customer — invoices belonging to their own shipments
      const shipments = await prisma.shipment.findMany({
        where: { customerId: req.user.customerId },
        select: { id: true },
      });
      req.invoiceScope = { shipmentIds: shipments.map((s) => s.id) };
    }
    next();
  } catch (err) {
    next(err);
  }
};

export const invoiceInScope = (req, invoice) =>
  !req.invoiceScope || req.invoiceScope.shipmentIds.includes(invoice.shipmentId);

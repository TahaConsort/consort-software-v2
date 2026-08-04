import crypto from "crypto";
import prisma from "../../config/prisma.js";
import { AppError } from "../../utils/AppError.js";
import { catchAsync } from "../../utils/catchAsync.js";
import { allocateRef } from "../../utils/referenceNumber.js";
import { DEFAULT_CURRENCY } from "../../utils/currency.js";
import { RFQ_SERVICES } from "../../utils/serviceVendorTypes.js";
import { renderVendorRcPdf } from "../../utils/rcPdf.js";
import { buildDocumentFileName } from "../document/document.service.js";

/**
 * Vendor RFQ — the buy side of a query.
 *
 * Consort is a one-window forwarder with no vessels, trucks or line of its own,
 * so a customer quote is only ever a resale. The path is:
 *   query → RFQ per service → N vendors asked → ops types the replies in →
 *   one winner per service → those lines seed the quotation's cost sheet.
 *
 *   RFQ:          open → awarded | cancelled
 *   Vendor quote: pending → quoted | declined      (winner = isSelected)
 *
 * Vendors answer by phone or WhatsApp — there is no vendor portal and no mail
 * transport in this system — so every quote is keyed in by an ops user, and
 * `enteredById` records who to ask when a rate looks wrong.
 */

const emitEvent = (tx, eventType, payload) =>
  tx.outboxEvent.create({ data: { eventType, payload, correlationId: crypto.randomUUID() } });

const QUOTABLE_QUERY_STATUSES = ["open", "quoted", "revision_requested"];

// Server-side line + total computation — client-sent amounts are ignored.
const priceLines = (lines) =>
  lines.map((l, i) => {
    const quantity = Number(l.quantity ?? 1);
    const unitPrice = Number(l.unitPrice);
    return {
      chargeCode: l.chargeCode || null,
      description: l.description,
      quantity,
      unitPrice,
      amount: Math.round(quantity * unitPrice * 100) / 100,
      sortOrder: l.sortOrder ?? i,
    };
  });

const totalOf = (lines) => Math.round(lines.reduce((s, l) => s + l.amount, 0) * 100) / 100;

const QUOTE_INCLUDE = {
  quotes: {
    include: {
      vendor: { select: { id: true, name: true, type: true, phone: true, email: true, contactName: true } },
      lines: { orderBy: { sortOrder: "asc" } },
    },
    orderBy: { createdAt: "asc" },
  },
};

// Join the customer-facing identity of the query each RFQ hangs off, so the
// board reads as work items rather than as opaque ids.
const hydrate = async (rfqs) => {
  if (!rfqs.length) return [];
  const queries = await prisma.query.findMany({
    where: { id: { in: [...new Set(rfqs.map((r) => r.queryId))] } },
    select: {
      id: true,
      referenceNo: true,
      status: true,
      customerId: true,
      services: true,
      servicePackage: true,
      originPort: true,
      destinationPort: true,
      pickupAddress: true,
      deliveryAddress: true,
      senderName: true,
      senderPhone: true,
      senderAddress: true,
      receiverName: true,
      receiverPhone: true,
      receiverAddress: true,
      inlandMode: true,
      originRailTerminal: true,
      destinationRailTerminal: true,
      containerTypeCode: true,
      incoterm: true,
      cargoDescription: true,
      weightKg: true,
      isHazardous: true,
      isReefer: true,
    },
  });
  const customers = await prisma.customer.findMany({
    where: { id: { in: [...new Set(queries.map((q) => q.customerId))] } },
    select: { id: true, referenceNo: true, companyId: true },
  });
  const companies = await prisma.company.findMany({
    where: { id: { in: customers.map((c) => c.companyId) } },
    select: { id: true, name: true },
  });
  const companyName = new Map(companies.map((c) => [c.id, c.name]));
  const custById = new Map(customers.map((c) => [c.id, c]));
  const qById = new Map(queries.map((q) => [q.id, q]));

  return rfqs.map((rfq) => {
    const query = qById.get(rfq.queryId) ?? null;
    const customer = query ? custById.get(query.customerId) : null;
    const live = (rfq.quotes ?? []).filter((q) => q.status !== "declined");
    const quoted = (rfq.quotes ?? []).filter((q) => q.status === "quoted");
    return {
      ...rfq,
      query, // the shipment facts a vendor needs in order to price
      queryRef: query?.referenceNo ?? "—",
      queryStatus: query?.status ?? null,
      customerRef: customer?.referenceNo ?? "—",
      customerCompany: customer ? companyName.get(customer.companyId) ?? "—" : "—",
      quotesTotal: live.length,
      quotesIn: quoted.length,
      // Cheapest response so far, for the board's at-a-glance column. Null until
      // someone quotes; meaningless across mixed currencies, so carry that too.
      bestTotal: quoted.length ? Math.min(...quoted.map((q) => Number(q.totalAmount))) : null,
      mixedCurrency: new Set(quoted.map((q) => q.currency)).size > 1,
    };
  });
};

/* ── GET /api/rfqs?queryId=&status=&service= ── */
export const listRfqs = catchAsync(async (req, res) => {
  const where = {};
  if (req.query.queryId) where.queryId = req.query.queryId;
  if (req.query.status) where.status = req.query.status;
  if (req.query.service) where.service = req.query.service;

  const rfqs = await prisma.vendorRfq.findMany({
    where,
    orderBy: [{ createdAt: "desc" }],
    include: QUOTE_INCLUDE,
  });
  res.json({ success: true, data: await hydrate(rfqs) });
});

/* ── GET /api/rfqs/cost-sheet?queryId= ── (declared before /:id)
   The handoff to the sell side: the awarded buy price per service, shaped so the
   quote builder can drop it straight into charge lines with a margin on top. */
export const getCostSheet = catchAsync(async (req, res, next) => {
  const { queryId } = req.query;
  if (!queryId) return next(new AppError("queryId is required", 400));

  const rfqs = await prisma.vendorRfq.findMany({
    where: { queryId, status: "awarded" },
    include: {
      quotes: {
        where: { isSelected: true },
        include: {
          vendor: { select: { id: true, name: true, type: true } },
          lines: { orderBy: { sortOrder: "asc" } },
        },
      },
    },
    orderBy: { createdAt: "asc" },
  });

  const groups = rfqs
    .map((rfq) => {
      const won = rfq.quotes[0];
      if (!won) return null; // awarded but the winner was since un-selected
      return {
        rfqId: rfq.id,
        rfqRef: rfq.referenceNo,
        service: rfq.service,
        leg: rfq.leg,
        vendorId: won.vendor.id,
        vendorName: won.vendor.name,
        vendorType: won.vendor.type,
        currency: won.currency,
        totalAmount: won.totalAmount,
        lines: won.lines.map((l) => ({
          chargeCode: l.chargeCode,
          description: l.description,
          quantity: l.quantity,
          unitPrice: l.unitPrice,
          amount: l.amount,
        })),
      };
    })
    .filter(Boolean);

  res.json({
    success: true,
    data: {
      queryId,
      groups,
      costTotal: Math.round(groups.reduce((s, g) => s + Number(g.totalAmount), 0) * 100) / 100,
      // A quote priced off two currencies needs a human to convert before it is sent.
      mixedCurrency: new Set(groups.map((g) => g.currency)).size > 1,
    },
  });
});

/* ── GET /api/rfqs/:id ── */
export const getRfq = catchAsync(async (req, res, next) => {
  const rfq = await prisma.vendorRfq.findUnique({
    where: { id: req.params.id },
    include: QUOTE_INCLUDE,
  });
  if (!rfq) return next(new AppError("Rate request not found", 404));
  const [hydrated] = await hydrate([rfq]);
  res.json({ success: true, data: hydrated });
});

/* ── POST /api/rfqs ── (batch: one RFQ per requested service) */
export const createRfqs = catchAsync(async (req, res, next) => {
  const { queryId, requests, neededBy, notes } = req.body;

  const query = await prisma.query.findUnique({ where: { id: queryId } });
  if (!query) return next(new AppError("Query not found", 404));
  if (!QUOTABLE_QUERY_STATUSES.includes(query.status)) {
    return next(new AppError(`Cannot request rates for a query that is ${query.status}`, 409));
  }

  // Every requested service must actually be sold on this query, and must be one
  // a vendor can price (lc_finance is a bank instrument, not a buy). Legs exist only
  // on the transport service of a rail-mode query — and there they are mandatory,
  // because a rail journey has three different vendors carrying three different prices.
  const isRailTransport = (r) => r.service === "local_transport" && query.inlandMode === "rail";
  for (const r of requests) {
    if (!query.services.includes(r.service)) {
      return next(new AppError(`This query does not include the ${r.service} service`, 400));
    }
    if (!RFQ_SERVICES.includes(r.service)) {
      return next(new AppError(`${r.service} cannot be sent to vendors for a rate`, 400));
    }
    if (r.leg && !isRailTransport(r)) {
      return next(new AppError("Legs only apply to the transport service of a rail-mode query", 400));
    }
    if (!r.leg && isRailTransport(r)) {
      return next(
        new AppError("This query moves inland by rail — request transport rates per leg (first mile, rail, last mile)", 400),
      );
    }
  }
  const dupKey = (r) => `${r.service}:${r.leg ?? ""}`;
  if (new Set(requests.map(dupKey)).size !== requests.length) {
    return next(new AppError("One rate request per service leg, please", 400));
  }

  const vendorIds = [...new Set(requests.flatMap((r) => r.vendorIds))];
  const vendors = await prisma.vendor.findMany({ where: { id: { in: vendorIds } } });
  if (vendors.length !== vendorIds.length) return next(new AppError("One or more vendors not found", 400));
  const inactive = vendors.filter((v) => !v.isActive);
  if (inactive.length) {
    return next(new AppError(`Vendor ${inactive[0].name} is deactivated and cannot be asked for rates`, 400));
  }

  // Fail before writing when a live request already covers a (service, leg), so the
  // batch is all-or-nothing rather than half-created.
  const existing = await prisma.vendorRfq.findMany({
    where: { queryId, status: "open", service: { in: requests.map((r) => r.service) } },
    select: { service: true, leg: true, referenceNo: true },
  });
  const clash = existing.find((e) => requests.some((r) => r.service === e.service && (r.leg ?? null) === e.leg));
  if (clash) {
    return next(
      new AppError(
        `An open rate request already covers ${clash.service}${clash.leg ? ` (${clash.leg})` : ""} (${clash.referenceNo}). Cancel it first, or add vendors to it.`,
        409,
      ),
    );
  }

  try {
    const created = await prisma.$transaction(async (tx) => {
      const out = [];
      for (const r of requests) {
        const referenceNo = await allocateRef(tx, "rfq");
        const rfq = await tx.vendorRfq.create({
          data: {
            referenceNo,
            queryId,
            service: r.service,
            leg: r.leg ?? null,
            neededBy: neededBy ?? undefined,
            notes: notes ?? undefined,
            createdById: req.user.id,
            // Pending from the moment the vendor is asked, so the board shows who owes a reply.
            quotes: { create: r.vendorIds.map((vendorId) => ({ vendorId })) },
          },
          include: QUOTE_INCLUDE,
        });
        await emitEvent(tx, "rfq.created", {
          rfqId: rfq.id,
          referenceNo,
          queryId,
          queryRef: query.referenceNo,
          service: r.service,
          leg: r.leg ?? null,
          vendorCount: r.vendorIds.length,
        });
        out.push(rfq);
      }
      return out;
    });

    res.status(201).json({
      success: true,
      message: `${created.length} rate request${created.length === 1 ? "" : "s"} created`,
      data: await hydrate(created),
    });
  } catch (err) {
    if (err.code === "P2002") {
      return next(new AppError("An open rate request already exists for that service", 409));
    }
    throw err;
  }
});

/* ── POST /api/rfqs/:id/vendors ── (widen the ask) */
export const addVendors = catchAsync(async (req, res, next) => {
  const rfq = await prisma.vendorRfq.findUnique({ where: { id: req.params.id }, select: { id: true, status: true, referenceNo: true } });
  if (!rfq) return next(new AppError("Rate request not found", 404));
  if (rfq.status !== "open") {
    return next(new AppError(`Cannot add vendors to a rate request that is already ${rfq.status}`, 409));
  }

  const vendors = await prisma.vendor.findMany({ where: { id: { in: req.body.vendorIds } } });
  if (vendors.length !== new Set(req.body.vendorIds).size) return next(new AppError("One or more vendors not found", 400));
  if (vendors.some((v) => !v.isActive)) return next(new AppError("Deactivated vendors cannot be asked for rates", 400));

  const already = await prisma.vendorQuote.findMany({
    where: { rfqId: rfq.id, vendorId: { in: req.body.vendorIds } },
    select: { vendorId: true },
  });
  const skip = new Set(already.map((q) => q.vendorId));
  const toAdd = [...new Set(req.body.vendorIds)].filter((id) => !skip.has(id));
  if (!toAdd.length) return next(new AppError("Those vendors have already been asked", 409));

  const updated = await prisma.$transaction(async (tx) => {
    await tx.vendorQuote.createMany({ data: toAdd.map((vendorId) => ({ rfqId: rfq.id, vendorId })) });
    await emitEvent(tx, "rfq.updated", { rfqId: rfq.id, referenceNo: rfq.referenceNo, added: toAdd.length });
    return tx.vendorRfq.findUnique({ where: { id: rfq.id }, include: QUOTE_INCLUDE });
  });

  const [hydrated] = await hydrate([updated]);
  res.json({ success: true, message: `${toAdd.length} vendor(s) added`, data: hydrated });
});

/* ── PUT /api/rfqs/:id/quotes/:quoteId ── (ops types in what the vendor said) */
export const enterQuote = catchAsync(async (req, res, next) => {
  const quote = await prisma.vendorQuote.findUnique({
    where: { id: req.params.quoteId },
    include: { rfq: { select: { id: true, status: true, referenceNo: true, queryId: true, service: true, leg: true } } },
  });
  if (!quote || quote.rfq.id !== req.params.id) return next(new AppError("Vendor quote not found", 404));
  if (quote.rfq.status === "cancelled") return next(new AppError("This rate request was cancelled", 409));

  const lines = priceLines(req.body.lines);
  const wasPending = quote.status !== "quoted";

  const updated = await prisma.$transaction(async (tx) => {
    // Lines are replaced wholesale — a re-quote is the vendor's new price, not a delta.
    await tx.vendorQuoteLine.deleteMany({ where: { quoteId: quote.id } });
    const q = await tx.vendorQuote.update({
      where: { id: quote.id },
      data: {
        status: "quoted",
        currency: req.body.currency ?? quote.currency ?? DEFAULT_CURRENCY,
        validityDate: req.body.validityDate ?? null,
        notes: req.body.notes ?? null,
        receivedAt: req.body.receivedAt ?? quote.receivedAt ?? new Date(),
        enteredById: req.user.id,
        totalAmount: totalOf(lines),
        lines: { create: lines },
      },
      include: { vendor: { select: { id: true, name: true } }, lines: { orderBy: { sortOrder: "asc" } } },
    });
    const payload = {
      rfqId: quote.rfq.id,
      referenceNo: quote.rfq.referenceNo,
      queryId: quote.rfq.queryId,
      service: quote.rfq.service,
      leg: quote.rfq.leg,
      quoteId: quote.id,
      vendorId: quote.vendorId,
      vendorName: q.vendor.name,
      totalAmount: Number(q.totalAmount),
      currency: q.currency,
    };
    // A first reply is news worth a notification; correcting a typo in a rate
    // already captured is not.
    if (wasPending) await emitEvent(tx, "rfq.quote_received", payload);
    else await emitEvent(tx, "rfq.updated", payload);
    return q;
  });

  res.json({ success: true, message: "Vendor quote saved", data: updated });
});

/* ── POST /api/rfqs/:id/quotes/:quoteId/decline ── */
export const declineQuote = catchAsync(async (req, res, next) => {
  const quote = await prisma.vendorQuote.findUnique({
    where: { id: req.params.quoteId },
    include: { rfq: { select: { id: true, status: true, referenceNo: true } } },
  });
  if (!quote || quote.rfq.id !== req.params.id) return next(new AppError("Vendor quote not found", 404));
  if (quote.isSelected) {
    return next(new AppError("This vendor won the rate request — pick a different winner before declining them", 409));
  }
  if (quote.status === "declined") return next(new AppError("Already marked declined", 409));

  const updated = await prisma.$transaction(async (tx) => {
    const q = await tx.vendorQuote.update({
      where: { id: quote.id },
      data: { status: "declined", notes: req.body?.reason ?? quote.notes },
      include: { vendor: { select: { id: true, name: true } }, lines: true },
    });
    await emitEvent(tx, "rfq.updated", {
      rfqId: quote.rfq.id,
      referenceNo: quote.rfq.referenceNo,
      quoteId: quote.id,
      declined: true,
    });
    return q;
  });

  res.json({ success: true, message: "Marked as declined", data: updated });
});

/* ── POST /api/rfqs/:id/quotes/:quoteId/select ── (pick the winner) */
export const selectQuote = catchAsync(async (req, res, next) => {
  const quote = await prisma.vendorQuote.findUnique({
    where: { id: req.params.quoteId },
    include: { rfq: { select: { id: true, status: true, referenceNo: true, queryId: true, service: true, leg: true } } },
  });
  if (!quote || quote.rfq.id !== req.params.id) return next(new AppError("Vendor quote not found", 404));
  if (quote.rfq.status === "cancelled") return next(new AppError("This rate request was cancelled", 409));
  if (quote.status !== "quoted") {
    return next(new AppError("Only a vendor who has actually quoted can be awarded the job", 409));
  }

  const updated = await prisma.$transaction(async (tx) => {
    // Re-awarding is allowed while the customer quote is still being built, so
    // clear any previous winner first — the partial unique index depends on it.
    await tx.vendorQuote.updateMany({
      where: { rfqId: quote.rfq.id, isSelected: true },
      data: { isSelected: false, awardedAt: null, awardedById: null },
    });
    const q = await tx.vendorQuote.update({
      where: { id: quote.id },
      data: { isSelected: true, awardedAt: new Date(), awardedById: req.user.id },
      include: { vendor: { select: { id: true, name: true } }, lines: { orderBy: { sortOrder: "asc" } } },
    });
    await tx.vendorRfq.update({ where: { id: quote.rfq.id }, data: { status: "awarded" } });
    await emitEvent(tx, "rfq.awarded", {
      rfqId: quote.rfq.id,
      referenceNo: quote.rfq.referenceNo,
      queryId: quote.rfq.queryId,
      service: quote.rfq.service,
      leg: quote.rfq.leg,
      quoteId: quote.id,
      vendorId: quote.vendorId,
      vendorName: q.vendor.name,
      totalAmount: Number(q.totalAmount),
      currency: q.currency,
    });
    return q;
  });

  res.json({ success: true, message: `${updated.vendor.name} awarded`, data: updated });
});

/* ── POST /api/rfqs/:id/quotes/:quoteId/rc ── (Rate Confirmation for the winner)
   The buy-side RC: the document ops WhatsApps to the awarded vendor confirming what
   Consort will pay. Only an awarded rate can be confirmed — an RC for a losing bid
   is a contract nobody made. Lands on the VENDOR's documents (master-data owner:
   internal-only by rule, publish is refused) and the response hands back the
   document id so the client can download it immediately. */
export const generateVendorRc = catchAsync(async (req, res, next) => {
  const quote = await prisma.vendorQuote.findUnique({
    where: { id: req.params.quoteId },
    include: {
      vendor: true,
      lines: { orderBy: { sortOrder: "asc" } },
      rfq: true,
    },
  });
  if (!quote || quote.rfq.id !== req.params.id) return next(new AppError("Vendor quote not found", 404));
  if (!quote.isSelected) {
    return next(new AppError("Only the awarded vendor's rate can be confirmed — pick a winner first", 409));
  }

  const query = await prisma.query.findUnique({ where: { id: quote.rfq.queryId } });

  // On-demand generation surfaces failure, unlike the best-effort approval path.
  const file = await renderVendorRcPdf({ rfq: quote.rfq, quote, vendor: quote.vendor, query });
  if (!file) return next(new AppError("PDF generation is unavailable on this server", 503));

  const doc = await prisma.$transaction(async (tx) => {
    const fileName = await buildDocumentFileName({
      ownerType: "vendor",
      ownerId: quote.vendorId,
      docType: "rate_confirmation",
      originalName: file.fileName,
      mimeType: file.mimeType,
      db: tx,
    });
    const d = await tx.document.create({
      data: {
        ownerType: "vendor",
        ownerId: quote.vendorId,
        ...file,
        fileName,
        docType: "rate_confirmation",
        scanStatus: "clean", // generated by us — never touched an upload path
        uploadedById: req.user.id,
      },
    });
    // Same payload shape the document module emits, so any open vendor-documents
    // panel refreshes. Vendor docs never reach a customer room (no customerId).
    await emitEvent(tx, "shipment.documents.changed", {
      ownerType: "vendor",
      ownerId: quote.vendorId,
      change: "upload",
      docType: "rate_confirmation",
      documentId: d.id,
      shipmentId: null,
      customerId: null,
    });
    return d;
  });

  res.status(201).json({
    success: true,
    message: "Rate confirmation generated",
    data: { documentId: doc.id, fileName: doc.fileName },
  });
});

/* ── POST /api/rfqs/:id/cancel ── */
export const cancelRfq = catchAsync(async (req, res, next) => {
  const rfq = await prisma.vendorRfq.findUnique({ where: { id: req.params.id } });
  if (!rfq) return next(new AppError("Rate request not found", 404));
  if (rfq.status !== "open") {
    return next(new AppError(`Cannot cancel a rate request that is already ${rfq.status}`, 409));
  }

  const updated = await prisma.$transaction(async (tx) => {
    const r = await tx.vendorRfq.update({
      where: { id: rfq.id },
      data: {
        status: "cancelled",
        notes: req.body?.reason ? [rfq.notes, `Cancelled: ${req.body.reason}`].filter(Boolean).join("\n") : rfq.notes,
      },
      include: QUOTE_INCLUDE,
    });
    await emitEvent(tx, "rfq.updated", {
      rfqId: rfq.id,
      referenceNo: rfq.referenceNo,
      queryId: rfq.queryId,
      cancelled: true,
    });
    return r;
  });

  const [hydrated] = await hydrate([updated]);
  res.json({ success: true, message: "Rate request cancelled", data: hydrated });
});

import crypto from "crypto";
import prisma from "../../config/prisma.js";
import { AppError } from "../../utils/AppError.js";
import { catchAsync } from "../../utils/catchAsync.js";
import { allocateRef } from "../../utils/referenceNumber.js";
import { scopedQueryWhere, queryInScope, salesOwnsCustomer } from "./query.middleware.js";
import { normalizeName } from "../intake/intake.service.js";

/**
 * Query Management (CRM_MASTER §5.6/§5.6a, WORKFLOW §3).
 *
 * A query is a plain enquiry: who is asking, where the goods move from and to, and
 * which services they want. The service package / CRO / LC dimension, the port and
 * container reference checks and the whole cargo block are gone — the quotation and
 * shipment carry the operational detail now.
 *
 * Machine: open → cancelled | expired (quoted/approved arrive with the Quotation module).
 */

const emitEvent = (tx, eventType, payload) =>
  tx.outboxEvent.create({ data: { eventType, payload, correlationId: crypto.randomUUID() } });

/**
 * The contact snapshot stored on the query. Whatever the caller sent wins; anything it
 * omitted falls back to the customer's primary contact, then the company name. The
 * portal and the storefront lean on this — they know the customer, not the person.
 */
const resolveContact = async (customerId, body) => {
  const customer = await prisma.customer.findUnique({
    where: { id: customerId },
    select: { companyId: true },
  });
  const companyId = customer?.companyId ?? "";
  const [company, contact] = await Promise.all([
    prisma.company.findUnique({ where: { id: companyId }, select: { name: true } }),
    prisma.contact.findFirst({
      where: { companyId, isPrimary: true },
      select: { name: true, email: true, phone: true },
    }),
  ]);

  return {
    customerName: body.customerName ?? contact?.name ?? company?.name ?? null,
    customerEmail: body.customerEmail ?? contact?.email ?? null,
    customerPhone: body.customerPhone ?? contact?.phone ?? null,
  };
};

/**
 * Mint a customer from the query form. Same invariants the intake conversion keeps:
 * a company is deduped on its normalized name, INV-06 allows exactly one customer per
 * company (so an existing one is REUSED rather than duplicated), and the first contact
 * on a company becomes its primary.
 *
 * No Lead is created. A lead is the pre-customer stage; a BDO typing a company straight
 * into a query has already skipped it, and `convertedFromLeadId` is nullable for exactly
 * that case.
 */
const createCustomerInline = async (tx, { companyName, country, contact, ownerId }) => {
  const displayName = companyName.trim();
  const normalized = normalizeName(displayName);

  let company = await tx.company.findFirst({ where: { normalizedName: normalized } });
  if (!company) {
    company = await tx.company.create({
      data: { name: displayName, normalizedName: normalized, country: country ?? null },
    });
  }

  // INV-06 — one customer per company. A second query for a company we already serve
  // attaches to the existing customer instead of failing on the unique constraint.
  let customer = await tx.customer.findUnique({ where: { companyId: company.id } });
  if (!customer) {
    customer = await tx.customer.create({
      data: {
        referenceNo: await allocateRef(tx, "customer"),
        companyId: company.id,
        source: "bdo",
        // The raiser owns what they create, which is also what keeps the query inside
        // their own scope on the next read (RULE-QRY-01).
        assignedBdoId: ownerId,
      },
    });
  }

  const contactCount = await tx.contact.count({ where: { companyId: company.id } });
  await tx.contact.create({
    data: {
      companyId: company.id,
      name: contact.customerName,
      email: contact.customerEmail,
      phone: contact.customerPhone,
      isPrimary: contactCount === 0,
    },
  });

  return customer;
};

// `includeRfq` carries the buy-side progress chip (how many vendors have come
// back with rates). Counts only — no amounts — but it is still internal, so it
// is withheld from portal customers. Every call site passes `!req.user.customerId`,
// so it doubles as "is the viewer internal" — which is what `includeOwner` (who on
// the sales floor owns this) defaults to. A customer is not told which BDO holds
// their account, or that nobody does yet.
const hydrateQueries = async (queries, { includeRfq = true, includeOwner = includeRfq } = {}) => {
  const customerIds = [...new Set(queries.map((q) => q.customerId))];
  const userIds = [...new Set(queries.map((q) => q.raisedById))];

  const [customers, users] = await Promise.all([
    prisma.customer.findMany({
      where: { id: { in: customerIds } },
      select: { id: true, referenceNo: true, companyId: true, source: true, assignedBdoId: true },
    }),
    prisma.user.findMany({
      where: { id: { in: userIds } },
      select: { id: true, email: true, employee: { select: { firstName: true, lastName: true } } },
    }),
  ]);

  const companies = await prisma.company.findMany({
    where: { id: { in: customers.map((c) => c.companyId) } },
    select: { id: true, name: true },
  });

  const companyName = new Map(companies.map((c) => [c.id, c.name]));
  const customerById = new Map(customers.map((c) => [c.id, c]));

  // The owning BDO is rarely the raiser (a storefront query is raised by the portal
  // user), so their names need a second lookup before the rows can be labelled.
  const bdoIds = includeOwner
    ? [...new Set(customers.map((c) => c.assignedBdoId).filter(Boolean))].filter(
        (id) => !userIds.includes(id),
      )
    : [];
  const bdos = bdoIds.length
    ? await prisma.user.findMany({
        where: { id: { in: bdoIds } },
        select: { id: true, email: true, employee: { select: { firstName: true, lastName: true } } },
      })
    : [];
  const userById = new Map([...users, ...bdos].map((u) => [u.id, u]));
  const nameOf = (u) =>
    u?.employee ? `${u.employee.firstName} ${u.employee.lastName}` : u?.email ?? "—";

  // One extra round-trip for the whole page rather than a per-row count.
  const rfqByQuery = new Map();
  if (includeRfq) {
    const rfqs = await prisma.vendorRfq.findMany({
      where: { queryId: { in: queries.map((q) => q.id) }, status: { not: "cancelled" } },
      select: { queryId: true, status: true, quotes: { select: { status: true } } },
    });
    for (const rfq of rfqs) {
      const acc = rfqByQuery.get(rfq.queryId) ?? { rfqs: 0, awarded: 0, quotesIn: 0, quotesTotal: 0 };
      acc.rfqs += 1;
      if (rfq.status === "awarded") acc.awarded += 1;
      for (const q of rfq.quotes) {
        if (q.status === "declined") continue; // a decline is an answer, not a pending ask
        acc.quotesTotal += 1;
        if (q.status === "quoted") acc.quotesIn += 1;
      }
      rfqByQuery.set(rfq.queryId, acc);
    }
  }

  /**
   * The Rate Confirmation generated when the quote was approved (ADR-055 / RULE-QT-07),
   * so Ops can pull it straight off the queries row instead of walking to the shipment.
   *
   * Two round-trips for the page, not per row. Internal-only: a portal customer gets
   * their copy from the portal, where the publish flag is the gate — this shortcut is
   * for the ops desk and rides on the same `includeRfq` internal-viewer signal.
   */
  const rcByQuery = new Map();
  if (includeRfq) {
    const approved = queries.filter((q) => q.status === "shipment_created").map((q) => q.id);
    if (approved.length) {
      const shipments = await prisma.shipment.findMany({
        where: { queryId: { in: approved } },
        select: { id: true, queryId: true, referenceNo: true },
      });
      if (shipments.length) {
        const docs = await prisma.document.findMany({
          where: {
            ownerType: "shipment",
            ownerId: { in: shipments.map((s) => s.id) },
            docType: "rate_confirmation",
            deletedAt: null,
          },
          orderBy: { createdAt: "desc" },
          select: { id: true, ownerId: true, fileName: true, verificationStatus: true, createdAt: true },
        });
        const queryOfShipment = new Map(shipments.map((s) => [s.id, s.queryId]));
        for (const d of docs) {
          const queryId = queryOfShipment.get(d.ownerId);
          // `orderBy desc` means the first one seen per query is the newest — a signed
          // copy uploaded later must not hide the one Ops is looking for.
          if (queryId && !rcByQuery.has(queryId)) {
            rcByQuery.set(queryId, {
              documentId: d.id,
              fileName: d.fileName,
              verificationStatus: d.verificationStatus,
              createdAt: d.createdAt,
            });
          }
        }
      }
    }
  }

  /**
   * Where the customer's acceptance stands (ADR-056), for the internal row chip:
   * sales' recorded claim, the live link, the signed copy and its verification, and —
   * once approved — which of the customer's acts did it. One round-trip for the page's
   * live quotations, one for their signed copies. Internal-only, like the RC above.
   */
  const acceptanceByQuery = new Map();
  if (includeRfq) {
    const liveQueries = queries.filter((q) => ["quoted", "shipment_created"].includes(q.status)).map((q) => q.id);
    if (liveQueries.length) {
      const quotations = await prisma.quotation.findMany({
        where: { queryId: { in: liveQueries }, status: { in: ["sent", "approved"] } },
        orderBy: { version: "desc" },
        select: {
          id: true, queryId: true, status: true, approvalChannel: true,
          acceptanceClaimedById: true, acceptanceClaimedAt: true, acceptanceClaimedVia: true, acceptanceClaimNote: true,
          acceptanceDocumentId: true,
          approvalLinks: {
            orderBy: { createdAt: "desc" },
            take: 1,
            select: { expiresAt: true, revokedAt: true, decision: true, decidedAt: true, approverName: true },
          },
        },
      });
      const claimerIds = [...new Set(quotations.map((q) => q.acceptanceClaimedById).filter(Boolean))];
      const [claimers, signedCopies] = await Promise.all([
        claimerIds.length
          ? prisma.user.findMany({
              where: { id: { in: claimerIds } },
              select: { id: true, email: true, employee: { select: { firstName: true, lastName: true } } },
            })
          : [],
        prisma.document.findMany({
          where: {
            ownerType: "quotation",
            ownerId: { in: quotations.map((q) => q.id) },
            docType: "quotation_acceptance",
            deletedAt: null,
          },
          orderBy: { createdAt: "desc" },
          select: { id: true, ownerId: true, fileName: true, verificationStatus: true, verificationNote: true, uploadedById: true, createdAt: true },
        }),
      ]);
      const claimerById = new Map(claimers.map((u) => [u.id, u]));
      const now = new Date();
      for (const qt of quotations) {
        if (acceptanceByQuery.has(qt.queryId)) continue; // newest version wins
        const link = qt.approvalLinks[0] ?? null;
        const linkStatus = !link ? null
          : link.revokedAt ? "revoked"
          : link.decidedAt ? "used"
          : new Date(link.expiresAt) <= now ? "expired"
          : "open";
        // Newest first; a verified copy is the one that counts once one exists.
        const copies = signedCopies.filter((d) => d.ownerId === qt.id);
        const evidence = copies.find((d) => d.verificationStatus === "verified") ?? copies[0] ?? null;
        acceptanceByQuery.set(qt.queryId, {
          quotationId: qt.id,
          quotationStatus: qt.status,
          claimedAt: qt.acceptanceClaimedAt,
          claimedVia: qt.acceptanceClaimedVia,
          claimedByName: qt.acceptanceClaimedById ? nameOf(claimerById.get(qt.acceptanceClaimedById)) : null,
          claimNote: qt.acceptanceClaimNote,
          link: link ? { status: linkStatus, expiresAt: link.expiresAt, decision: link.decision, approverName: link.approverName } : null,
          evidence: evidence
            ? {
                documentId: evidence.id,
                fileName: evidence.fileName,
                verificationStatus: evidence.verificationStatus,
                verificationNote: evidence.verificationNote,
                uploadedById: evidence.uploadedById,
                createdAt: evidence.createdAt,
              }
            : null,
          approvalChannel: qt.approvalChannel,
        });
      }
    }
  }

  return queries.map((q) => {
    const customer = customerById.get(q.customerId);
    const raisedBy = userById.get(q.raisedById);
    return {
      ...q,
      customerRef: customer?.referenceNo ?? "—",
      customerCompany: companyName.get(customer?.companyId) ?? "—",
      raisedByName: nameOf(raisedBy),
      // Sales ownership — internal only. `null` means the unclaimed pool: every
      // BDO/ASM can see it and any of them can claim it (POST /queries/:id/claim).
      ...(includeOwner
        ? {
            assignedBdoId: customer?.assignedBdoId ?? null,
            assignedBdoName: customer?.assignedBdoId
              ? nameOf(userById.get(customer.assignedBdoId))
              : null,
          }
        : {}),
      rfqSummary: rfqByQuery.get(q.id) ?? null,
      rateConfirmation: rcByQuery.get(q.id) ?? null,
      acceptance: acceptanceByQuery.get(q.id) ?? null,
    };
  });
};

/* ── GET /api/queries ── */
// The three channel buckets on the Queries screen → the raisedVia value behind each.
const CHANNEL_TO_RAISED_VIA = { bdo: "bdo", bank_lc: "bank_lc", website: "portal" };

export const listQueries = catchAsync(async (req, res) => {
  const { status, channel } = req.query;
  const extra = {};
  if (status) extra.status = status;
  // ?channel=bdo|bank_lc|website — an unknown value filters nothing rather than 500s.
  if (channel && CHANNEL_TO_RAISED_VIA[channel]) extra.raisedVia = CHANNEL_TO_RAISED_VIA[channel];
  const where = await scopedQueryWhere(req, extra);
  const queries = await prisma.query.findMany({ where, orderBy: { createdAt: "desc" } });
  res.json({ success: true, data: await hydrateQueries(queries, { includeRfq: !req.user?.customerId }) });
});

/* ── POST /api/queries ── */
// Raised by a BDO/ASM for their customer, or self-served by a portal customer
// (RULE-QRY-01).
export const createQuery = catchAsync(async (req, res, next) => {
  const isPortal = req.user.role === "customer";
  const { newCustomer, services } = req.body;

  // Minting a customer is an internal act. A portal user is pinned to their own.
  if (newCustomer && isPortal) {
    return next(new AppError("Pick your own customer — a portal account cannot add one", 403));
  }

  // A portal user is always scoped to their own customer, so the client need not send
  // it (and the portal does not). Internal callers name one, or add one inline.
  let customerId = req.body.customerId ?? (isPortal ? req.user.customerId : null);
  if (!customerId && !newCustomer) return next(new AppError("Customer is required", 422));

  // ── Existing customer: it must exist, be active, and sit in the caller’s scope. ──
  if (customerId) {
    const customer = await prisma.customer.findUnique({ where: { id: customerId } });
    if (!customer || !customer.isActive) return next(new AppError("Customer not found", 404));

    // A portal user may only raise queries for their own customer (scope C).
    if (isPortal && req.user.customerId !== customerId) {
      return next(new AppError("Customer not found", 404));
    }

    // RULE-QRY-01 — a BDO/ASM raises queries for THEIR customer: the customer must be
    // assigned within the caller’s sales scope, or still unclaimed (out-of-scope → 404).
    // Same predicate as the read path, so a BDO can always raise the next query for a
    // customer whose queries they can already see.
    if (req.queryScope?.ownerIds && !salesOwnsCustomer(req.queryScope, customer)) {
      return next(new AppError("Customer not found", 404));
    }
  }

  // A new customer has no primary contact to fall back on, so the form must carry the
  // three contact fields itself; an existing one fills the gaps from its own record.
  const contact = customerId
    ? await resolveContact(customerId, req.body)
    : {
        customerName: req.body.customerName ?? null,
        customerEmail: req.body.customerEmail ?? null,
        customerPhone: req.body.customerPhone ?? null,
      };
  if (!contact.customerName) return next(new AppError("A customer name is required", 422));
  if (!contact.customerEmail) return next(new AppError("A customer email is required", 422));
  if (!contact.customerPhone) return next(new AppError("A customer phone number is required", 422));

  const { query, createdCustomer } = await prisma.$transaction(async (tx) => {
    // The customer and the query it was raised for land together or not at all.
    let minted = null;
    if (!customerId) {
      minted = await createCustomerInline(tx, {
        companyName: newCustomer.companyName,
        country: newCustomer.country,
        contact,
        ownerId: req.user.id,
      });
      customerId = minted.id;
    }

    const referenceNo = await allocateRef(tx, "query");
    const created = await tx.query.create({
      data: {
        referenceNo,
        customerId,
        raisedById: req.user.id,
        raisedVia: isPortal ? "portal" : "bdo",
        ...contact,
        pickupAddress: req.body.pickupAddress,
        destinationAddress: req.body.destinationAddress,
        services,
      },
    });

    await emitEvent(tx, "query.created", {
      queryId: created.id,
      referenceNo,
      services,
      customerId,
      raisedVia: created.raisedVia,
    });
    return { query: created, createdCustomer: minted };
  });

  const [hydrated] = await hydrateQueries([query], { includeRfq: !req.user?.customerId });
  res.status(201).json({
    success: true,
    message: createdCustomer
      ? "Query created — customer " + createdCustomer.referenceNo + " was added"
      : "Query created",
    data: hydrated,
  });
});

/* ── GET /api/queries/:id ── */
export const getQuery = catchAsync(async (req, res, next) => {
  const query = await prisma.query.findUnique({ where: { id: req.params.id } });
  // Out-of-scope reads 404, never 403 (BUSINESS_RULES §2.3).
  if (!query || !(await queryInScope(req, query))) return next(new AppError("Query not found", 404));

  const [hydrated] = await hydrateQueries([query], { includeRfq: !req.user?.customerId });
  res.json({ success: true, data: hydrated });
});

/* ── PUT /api/queries/:id ── */
export const updateQuery = catchAsync(async (req, res, next) => {
  const query = await prisma.query.findUnique({ where: { id: req.params.id } });
  if (!query || !(await queryInScope(req, query))) return next(new AppError("Query not found", 404));
  if (query.status !== "open") {
    return next(new AppError(`Only an open query can be edited (this one is ${query.status})`, 409));
  }

  // Zod has already stripped anything not on the schema, and every field it does allow
  // is directly writable — there is nothing left to re-resolve or cross-check.
  const data = { ...req.body };

  const updated = await prisma.$transaction(async (tx) => {
    const u = await tx.query.update({ where: { id: query.id }, data });
    await emitEvent(tx, "query.updated", { queryId: u.id, referenceNo: u.referenceNo });
    return u;
  });

  const [hydrated] = await hydrateQueries([updated], { includeRfq: !req.user?.customerId });
  res.json({ success: true, message: "Query updated", data: hydrated });
});

/* ── POST /api/queries/:id/cancel ── */
// open / quoted / revision_requested → cancelled with a mandatory reason — feeds
// the unserved-demand report (RULE-QRY-03, WORKFLOW §3).
export const cancelQuery = catchAsync(async (req, res, next) => {
  const query = await prisma.query.findUnique({ where: { id: req.params.id } });
  if (!query || !(await queryInScope(req, query))) return next(new AppError("Query not found", 404));
  if (!["open", "quoted", "revision_requested"].includes(query.status)) {
    return next(new AppError(`A ${query.status} query cannot be cancelled`, 409));
  }

  const updated = await prisma.$transaction(async (tx) => {
    const u = await tx.query.update({
      where: { id: query.id },
      data: { status: "cancelled", cancelReason: req.body.reason },
    });
    // Cancelling a query invalidates any quotation raised from it — a `sent` quote
    // on a dead enquiry must never be approvable into a shipment. `rejected`, not
    // `expired`: the scheduler reserves `expired` for a validity date lapsing.
    // No `quotation.rejected` event — its handler tells Ops the customer asked
    // for a revision, which is not what happened; `query.cancelled` already
    // refreshes the quotation screens.
    await tx.quotation.updateMany({
      where: { queryId: u.id, status: { in: ["draft", "sent"] } },
      data: {
        status: "rejected",
        decidedById: req.user.id,
        decidedAt: new Date(),
        rejectionReason: `Query cancelled — ${req.body.reason}`,
        rowVersion: { increment: 1 },
      },
    });
    await emitEvent(tx, "query.cancelled", { queryId: u.id, referenceNo: u.referenceNo });
    return u;
  });

  const [hydrated] = await hydrateQueries([updated], { includeRfq: !req.user?.customerId });
  res.json({ success: true, message: "Query cancelled", data: hydrated });
});

/* ── POST /api/queries/:id/claim ── */
/**
 * Take ownership of an unclaimed query (CRM_MASTER §5.16/§5.20, WORKFLOW §2b).
 *
 * A storefront self-signup arrives with no BDO (`assignedBdoId = null`), so its
 * queries sit in the pool every BDO/ASM can see. Claiming assigns the CUSTOMER —
 * not the query — to the caller, which is what the rest of the system already keys
 * sales ownership off (quotation routing, scope, the customers screen), and it
 * moves every query for that customer out of the pool at once.
 *
 * Deliberately narrow: it only ever fills a null, so it cannot be used to steal a
 * colleague's account. Re-assignment stays with Management/ASM on PUT /customers/:id.
 */
export const claimQuery = catchAsync(async (req, res, next) => {
  const query = await prisma.query.findUnique({ where: { id: req.params.id } });
  if (!query || !(await queryInScope(req, query))) return next(new AppError("Query not found", 404));

  const customer = await prisma.customer.findUnique({ where: { id: query.customerId } });
  if (!customer) return next(new AppError("Query not found", 404));
  if (customer.assignedBdoId) {
    const owner = await prisma.user.findUnique({
      where: { id: customer.assignedBdoId },
      select: { email: true, employee: { select: { firstName: true, lastName: true } } },
    });
    const who = owner?.employee
      ? `${owner.employee.firstName} ${owner.employee.lastName}`
      : owner?.email ?? "another BDO";
    return next(new AppError(`Already claimed by ${who}`, 409));
  }

  await prisma.$transaction(async (tx) => {
    await tx.customer.update({
      where: { id: customer.id },
      data: { assignedBdoId: req.user.id },
    });
    // The customers / leads / visits screens key off this event to refetch.
    await tx.outboxEvent.create({
      data: {
        eventType: "customer.updated",
        payload: { what: "customer", customerId: customer.id },
        correlationId: crypto.randomUUID(),
      },
    });
    await emitEvent(tx, "query.claimed", {
      queryId: query.id,
      referenceNo: query.referenceNo,
      customerId: customer.id,
      claimedById: req.user.id,
    });
  });

  const [hydrated] = await hydrateQueries([query], { includeRfq: !req.user?.customerId });
  res.json({ success: true, message: `Query ${query.referenceNo} is yours`, data: hydrated });
});

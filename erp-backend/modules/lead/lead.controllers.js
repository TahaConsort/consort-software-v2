import crypto from "crypto";
import prisma from "../../config/prisma.js";
import { AppError } from "../../utils/AppError.js";
import { catchAsync } from "../../utils/catchAsync.js";
import { allocateRef } from "../../utils/referenceNumber.js";
import { normalizeName } from "../company/company.controllers.js";
import { hasRole } from "../auth/auth.middleware.js";
import { inScope } from "./lead.middleware.js";

/* ─────────────────────────── helpers ─────────────────────────── */

// Write history + outbox inside the SAME transaction as the state change
// (ADR-021, RULE-LD-06 — every transition is historied).
const recordTransition = async (tx, lead, toStatus, actorId, notes) => {
  await tx.leadStatusHistory.create({
    data: { leadId: lead.id, fromStatus: lead.status, toStatus, actorId, notes: notes ?? null },
  });
};

const emitEvent = (tx, eventType, payload) =>
  tx.outboxEvent.create({
    data: { eventType, payload, correlationId: crypto.randomUUID() },
  });

// Manual joins — Lead FKs are scalars (DATABASE §4).
const hydrateLeads = async (leads) => {
  const companyIds = [...new Set(leads.map((l) => l.companyId))];
  const contactIds = [...new Set(leads.map((l) => l.contactId))];
  const ownerIds = [...new Set(leads.map((l) => l.ownerId))];

  const [companies, contacts, owners] = await Promise.all([
    prisma.company.findMany({ where: { id: { in: companyIds } } }),
    prisma.contact.findMany({ where: { id: { in: contactIds } } }),
    prisma.user.findMany({
      where: { id: { in: ownerIds } },
      select: { id: true, email: true, employee: { select: { firstName: true, lastName: true } } },
    }),
  ]);

  const companyById = new Map(companies.map((c) => [c.id, c]));
  const contactById = new Map(contacts.map((c) => [c.id, c]));
  const ownerById = new Map(owners.map((u) => [u.id, u]));

  return leads.map((l) => {
    const owner = ownerById.get(l.ownerId);
    return {
      ...l,
      company: companyById.get(l.companyId) ?? null,
      contact: contactById.get(l.contactId) ?? null,
      ownerName: owner?.employee
        ? `${owner.employee.firstName} ${owner.employee.lastName}`
        : owner?.email ?? "—",
    };
  });
};

const scopedWhere = (req, extra = {}) =>
  req.leadScope ? { ...extra, ownerId: { in: req.leadScope.ownerIds } } : extra;

/* ─────────────────────────── GET /api/leads ─────────────────────────── */
export const listLeads = catchAsync(async (req, res) => {
  const { status, source } = req.query;
  const where = scopedWhere(req, {
    ...(status ? { status } : {}),
    ...(source ? { source } : {}),
  });

  const leads = await prisma.lead.findMany({ where, orderBy: { createdAt: "desc" } });
  res.json({ success: true, data: await hydrateLeads(leads) });
});

/* ─────────────────────────── POST /api/leads ─────────────────────────── */
// Company and contact are created here, once (RULE-LD-01); conversion later
// only links them. Emits lead.created (WORKFLOW §6).
export const createLead = catchAsync(async (req, res, next) => {
  const { companyId, company, contactId, contact, ownerId } = req.body;

  // Source is not chosen manually — a lead created in the CRM is always `bdo`
  // (ADR-042/INV-13). The `direct` and `bank_lc` sources are set by their
  // intake flows (storefront inquiry / bank LC webhook), not here.
  const source = "bdo";

  // Only ASM/Management may assign someone else as owner; a BDO owns their own.
  const assigningOther = ownerId && ownerId !== req.user.id;
  const mayAssign = req.leadScope === null || hasRole(req.user, "asm"); // Management or ASM
  if (assigningOther && !mayAssign) {
    return next(new AppError("You cannot assign this lead to another user", 403));
  }
  const owner = ownerId || req.user.id;

  let duplicateWarning;

  const lead = await prisma.$transaction(async (tx) => {
    // Resolve / create the company (EDGE-LD-01 — warn, don't block).
    let resolvedCompanyId = companyId;
    if (!resolvedCompanyId) {
      const normalizedName = normalizeName(company.name);
      const dupes = await tx.company.findMany({
        where: { normalizedName },
        select: { id: true, name: true, city: true, country: true },
      });
      if (dupes.length) duplicateWarning = dupes;
      const created = await tx.company.create({ data: { ...company, normalizedName } });
      resolvedCompanyId = created.id;
    } else {
      const exists = await tx.company.findUnique({ where: { id: resolvedCompanyId } });
      if (!exists) throw new AppError("Company not found", 400);
    }

    // Resolve / create the contact (first contact becomes primary — INV-05).
    let resolvedContactId = contactId;
    if (!resolvedContactId) {
      const count = await tx.contact.count({ where: { companyId: resolvedCompanyId } });
      const created = await tx.contact.create({
        data: { ...contact, companyId: resolvedCompanyId, isPrimary: count === 0 },
      });
      resolvedContactId = created.id;
    } else {
      const exists = await tx.contact.findUnique({ where: { id: resolvedContactId } });
      if (!exists || exists.companyId !== resolvedCompanyId) {
        throw new AppError("Contact not found on that company", 400);
      }
    }

    const referenceNo = await allocateRef(tx, "lead");
    const created = await tx.lead.create({
      data: {
        referenceNo,
        companyId: resolvedCompanyId,
        contactId: resolvedContactId,
        source,
        status: "new",
        ownerId: owner,
        createdById: req.user.id,
      },
    });

    await tx.leadStatusHistory.create({
      data: { leadId: created.id, fromStatus: null, toStatus: "new", actorId: req.user.id, notes: "Lead created" },
    });
    await emitEvent(tx, "lead.created", { leadId: created.id, referenceNo, source });

    return created;
  });

  const [hydrated] = await hydrateLeads([lead]);
  res.status(201).json({
    success: true,
    message: "Lead created",
    data: hydrated,
    ...(duplicateWarning ? { duplicateWarning } : {}),
  });
});

/* ─────────────────────────── GET /api/leads/:id ─────────────────────────── */
export const getLead = catchAsync(async (req, res, next) => {
  const lead = await prisma.lead.findUnique({
    where: { id: req.params.id },
    include: { statusHistory: { orderBy: { createdAt: "asc" } } },
  });
  // Out-of-scope reads return 404, not 403 (BUSINESS_RULES §2.3).
  if (!lead || !inScope(req, lead)) return next(new AppError("Lead not found", 404));

  const outreach = await prisma.outreach.findMany({
    where: { leadId: lead.id },
    orderBy: { occurredAt: "desc" },
  });

  const [hydrated] = await hydrateLeads([lead]);
  res.json({ success: true, data: { ...hydrated, outreach } });
});

/* ─────────────────────────── PUT /api/leads/:id ─────────────────────────── */
export const updateLead = catchAsync(async (req, res, next) => {
  const lead = await prisma.lead.findUnique({ where: { id: req.params.id } });
  if (!lead || !inScope(req, lead)) return next(new AppError("Lead not found", 404));
  if (["converted"].includes(lead.status)) {
    return next(new AppError("A converted lead is read-only", 409));
  }

  if (req.body.contactId) {
    const contact = await prisma.contact.findUnique({ where: { id: req.body.contactId } });
    if (!contact || contact.companyId !== lead.companyId) {
      return next(new AppError("Contact not found on the lead's company", 400));
    }
  }

  const updated = await prisma.$transaction(async (tx) => {
    const u = await tx.lead.update({ where: { id: lead.id }, data: req.body });
    await emitEvent(tx, "lead.updated", { leadId: u.id, referenceNo: u.referenceNo });
    return u;
  });
  const [hydrated] = await hydrateLeads([updated]);
  res.json({ success: true, message: "Lead updated", data: hydrated });
});

/* ─────────────────────────── POST /api/leads/:id/outreach ─────────────────────────── */
// Logging outreach drives lead auto-advance (§5.5): first touch on a `new`
// lead moves it to `contacted` (WORKFLOW §2).
export const logOutreach = catchAsync(async (req, res, next) => {
  const lead = await prisma.lead.findUnique({ where: { id: req.params.id } });
  if (!lead || !inScope(req, lead)) return next(new AppError("Lead not found", 404));
  if (["converted", "lost"].includes(lead.status)) {
    return next(new AppError(`Cannot log outreach on a ${lead.status} lead`, 409));
  }

  const result = await prisma.$transaction(async (tx) => {
    const outreach = await tx.outreach.create({
      data: {
        leadId: lead.id,
        type: req.body.type,
        outcome: req.body.outcome,
        notes: req.body.notes ?? null,
        durationMin: req.body.durationMin ?? null,
        occurredAt: req.body.occurredAt ?? new Date(),
        followUpAt: req.body.followUpAt ?? null,
        actorId: req.user.id,
      },
    });

    let status = lead.status;
    if (lead.status === "new") {
      status = "contacted";
      await recordTransition(tx, lead, "contacted", req.user.id, "First outreach logged");
      await tx.lead.update({ where: { id: lead.id }, data: { status } });
    }

    // A touch belongs to the Outreach log as much as to this lead, and may have just
    // advanced the lead's status.
    await emitEvent(tx, "outreach.logged", {
      leadId: lead.id, referenceNo: lead.referenceNo, advanced: status !== lead.status,
    });

    return { outreach, status };
  });

  res.status(201).json({
    success: true,
    message: result.status !== lead.status ? "Outreach logged — lead moved to contacted" : "Outreach logged",
    data: result,
  });
});

/* ─────────────────────────── POST /api/leads/:id/status ─────────────────────────── */
// Manual transitions per the machine (WORKFLOW §2):
//   contacted → qualified   needs ≥1 non-negative outreach (RULE-LD-02)
//   qualified → contacted   de-qualify
//   new|contacted|qualified → lost   reason required (RULE-LD-03/06)
export const transitionLead = catchAsync(async (req, res, next) => {
  const { toStatus, reason, notes } = req.body;
  const lead = await prisma.lead.findUnique({ where: { id: req.params.id } });
  if (!lead || !inScope(req, lead)) return next(new AppError("Lead not found", 404));

  const allowed = {
    contacted: ["qualified"], // de-qualify; new→contacted happens via outreach
    qualified: ["contacted"],
    lost: ["new", "contacted", "qualified"],
  };
  if (!allowed[toStatus]?.includes(lead.status)) {
    return next(new AppError(`Cannot move a ${lead.status} lead to ${toStatus}`, 409));
  }

  if (toStatus === "qualified") {
    const positiveTouches = await prisma.outreach.count({
      where: { leadId: lead.id, outcome: { in: ["positive", "neutral"] } },
    });
    if (positiveTouches < 1) {
      return next(new AppError("Qualification requires at least one non-negative outreach (RULE-LD-02)", 409));
    }
  }

  const updated = await prisma.$transaction(async (tx) => {
    await recordTransition(tx, lead, toStatus, req.user.id, toStatus === "lost" ? reason : notes);
    const u = await tx.lead.update({
      where: { id: lead.id },
      data: { status: toStatus, lostReason: toStatus === "lost" ? reason : lead.lostReason },
    });
    await emitEvent(tx, "lead.status_changed", {
      leadId: u.id, referenceNo: u.referenceNo, fromStatus: lead.status, toStatus,
    });
    return u;
  });

  const [hydrated] = await hydrateLeads([updated]);
  res.json({ success: true, message: `Lead marked ${toStatus}`, data: hydrated });
});

/* ─────────────────────────── POST /api/leads/:id/reopen ─────────────────────────── */
// lost → contacted, reason required (RULE-LD-04) — leads come back from the dead.
export const reopenLead = catchAsync(async (req, res, next) => {
  const lead = await prisma.lead.findUnique({ where: { id: req.params.id } });
  if (!lead || !inScope(req, lead)) return next(new AppError("Lead not found", 404));
  if (lead.status !== "lost") return next(new AppError("Only a lost lead can be reopened", 409));

  const updated = await prisma.$transaction(async (tx) => {
    await recordTransition(tx, lead, "contacted", req.user.id, `Reopened: ${req.body.reason}`);
    const u = await tx.lead.update({ where: { id: lead.id }, data: { status: "contacted", lostReason: null } });
    await emitEvent(tx, "lead.status_changed", {
      leadId: u.id, referenceNo: u.referenceNo, fromStatus: "lost", toStatus: "contacted",
    });
    return u;
  });

  const [hydrated] = await hydrateLeads([updated]);
  res.json({ success: true, message: "Lead reopened", data: hydrated });
});

/* ─────────────────────────── POST /api/leads/:id/convert ─────────────────────────── */
// ONE transaction (RULE-LD-05): customer row + CST ref, link the company and
// contact created at lead time, stamp the lead, history, emit lead.converted.
export const convertLead = catchAsync(async (req, res, next) => {
  const lead = await prisma.lead.findUnique({ where: { id: req.params.id } });
  if (!lead || !inScope(req, lead)) return next(new AppError("Lead not found", 404));
  if (lead.status !== "qualified") {
    return next(new AppError("Only a qualified lead can be converted", 409));
  }

  const existingCustomer = await prisma.customer.findUnique({ where: { companyId: lead.companyId } });
  if (existingCustomer) {
    return next(new AppError("This company is already a customer (INV-06)", 409));
  }

  const customer = await prisma.$transaction(async (tx) => {
    const referenceNo = await allocateRef(tx, "customer");
    const created = await tx.customer.create({
      data: {
        referenceNo,
        companyId: lead.companyId, // link — never re-create (RULE-LD-01)
        source: lead.source, // carried onto the customer (ADR-042)
        assignedBdoId: lead.ownerId,
        convertedFromLeadId: lead.id,
      },
    });

    await tx.lead.update({
      where: { id: lead.id },
      data: { status: "converted", convertedAt: new Date(), convertedToCustomerId: created.id },
    });
    await recordTransition(tx, lead, "converted", req.user.id, `Converted to ${referenceNo}`);
    await emitEvent(tx, "lead.converted", {
      leadId: lead.id,
      leadRef: lead.referenceNo,
      customerId: created.id,
      customerRef: referenceNo,
    });

    return created;
  });

  res.status(201).json({
    success: true,
    message: `Converted — customer ${customer.referenceNo} created`,
    data: customer,
  });
});

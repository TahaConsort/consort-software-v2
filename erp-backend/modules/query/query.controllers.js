import crypto from "crypto";
import prisma from "../../config/prisma.js";
import { AppError } from "../../utils/AppError.js";
import { catchAsync } from "../../utils/catchAsync.js";
import { allocateRef } from "../../utils/referenceNumber.js";
import { packageUsesPorts, resolveCroMode, resolveLcMode, resolveServices } from "../../utils/servicePackage.js";
import { scopedQueryWhere, queryInScope } from "./query.middleware.js";

/**
 * Query Management (CRM_MASTER §5.6/§5.6a, WORKFLOW §3).
 * A query is the shipping request that carries the SELECTED SERVICES — the
 * set that composes the eventual shipment's OTD path (ADR-040/041).
 * Machine today: open → cancelled | expired (quoted/approved arrive with the
 * Quotation module).
 */

const emitEvent = (tx, eventType, payload) =>
  tx.outboxEvent.create({ data: { eventType, payload, correlationId: crypto.randomUUID() } });

const hydrateQueries = async (queries) => {
  const customerIds = [...new Set(queries.map((q) => q.customerId))];
  const userIds = [...new Set(queries.map((q) => q.raisedById))];

  const [customers, users] = await Promise.all([
    prisma.customer.findMany({
      where: { id: { in: customerIds } },
      select: { id: true, referenceNo: true, companyId: true, source: true },
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
  const userById = new Map(users.map((u) => [u.id, u]));

  return queries.map((q) => {
    const customer = customerById.get(q.customerId);
    const raisedBy = userById.get(q.raisedById);
    return {
      ...q,
      customerRef: customer?.referenceNo ?? "—",
      customerCompany: companyName.get(customer?.companyId) ?? "—",
      raisedByName: raisedBy?.employee
        ? `${raisedBy.employee.firstName} ${raisedBy.employee.lastName}`
        : raisedBy?.email ?? "—",
    };
  });
};

/* ── GET /api/queries ── */
export const listQueries = catchAsync(async (req, res) => {
  const { status } = req.query;
  const where = await scopedQueryWhere(req, status ? { status } : {});
  const queries = await prisma.query.findMany({ where, orderBy: { createdAt: "desc" } });
  res.json({ success: true, data: await hydrateQueries(queries) });
});

/* ── POST /api/queries ── */
// Raised by a BDO/ASM for their customer, or self-served by a portal customer
// (RULE-QRY-01). Hazardous/reefer emits query.hazardous → the relay creates
// the Compliance pre-check (RULE-QRY-02).
export const createQuery = catchAsync(async (req, res, next) => {
  // A portal user is always scoped to their own customer, so the client need not send
  // it (and the portal doesn't). Internal callers must name one explicitly.
  const customerId = req.body.customerId ?? (req.user.role === "customer" ? req.user.customerId : null);
  if (!customerId) return next(new AppError("Customer is required", 422));

  const customer = await prisma.customer.findUnique({ where: { id: customerId } });
  if (!customer || !customer.isActive) return next(new AppError("Customer not found", 404));

  // A portal user may only raise queries for their own customer (scope C).
  if (req.user.role === "customer" && req.user.customerId !== customerId) {
    return next(new AppError("Customer not found", 404));
  }

  // RULE-QRY-01 — a BDO/ASM raises queries for THEIR customer: the customer
  // must be assigned within the caller's sales scope (out-of-scope → 404).
  if (req.queryScope?.ownerIds && !req.queryScope.ownerIds.includes(customer.assignedBdoId)) {
    return next(new AppError("Customer not found", 404));
  }

  // The package presets the service set; Ops overrides are additive; bank-LC customers
  // imply LC / Trade Finance (RULE-SVC-04, EDGE-SVC-01). One helper, one rule — shared
  // with the intake-conversion path. The LC mode resolves FIRST (ADR-050) because the
  // service set depends on it: consort mode sells lc_finance, customer mode does not.
  const { servicePackage } = req.body;
  const lcHandledBy = resolveLcMode({
    servicePackage,
    lcHandledBy: req.body.lcHandledBy,
    customerSource: customer.source,
  });
  const services = resolveServices({
    servicePackage,
    services: req.body.services,
    customerSource: customer.source,
    lcHandledBy,
  });
  const croHandledBy = resolveCroMode({ servicePackage, croHandledBy: req.body.croHandledBy });

  // RULE-QRY-01 — validate ports & container type against reference data. A local
  // transport job has no ports at all (the schema rejects them), only addresses.
  const portCodes = packageUsesPorts(servicePackage)
    ? [req.body.originPort, req.body.destinationPort].filter(Boolean)
    : [];
  if (portCodes.length) {
    const found = await prisma.port.count({ where: { code: { in: portCodes } } });
    if (found !== new Set(portCodes).size) {
      return next(new AppError("Unknown origin/destination port code", 422));
    }
  }
  if (req.body.containerTypeCode) {
    const ct = await prisma.containerType.findUnique({ where: { code: req.body.containerTypeCode } });
    if (!ct) return next(new AppError("Unknown container type code", 422));
  }

  const isHazardous = !!req.body.isHazardous;
  const isReefer = !!req.body.isReefer;

  const query = await prisma.$transaction(async (tx) => {
    const referenceNo = await allocateRef(tx, "query");
    const created = await tx.query.create({
      data: {
        referenceNo,
        customerId,
        raisedById: req.user.id,
        raisedVia: req.user.role === "customer" ? "portal" : "bdo",
        services,
        servicePackage,
        croHandledBy,
        lcHandledBy,
        originPort: req.body.originPort ?? null,
        destinationPort: req.body.destinationPort ?? null,
        pickupAddress: req.body.pickupAddress ?? null,
        deliveryAddress: req.body.deliveryAddress ?? null,
        freeDays: req.body.freeDays ?? null,
        emptyReturnLocation: req.body.emptyReturnLocation ?? null,
        containerTypeCode: req.body.containerTypeCode ?? null,
        incoterm: req.body.incoterm ?? null,
        cargoDescription: req.body.cargoDescription ?? null,
        weightKg: req.body.weightKg ?? null,
        isHazardous,
        isReefer,
      },
    });

    await emitEvent(tx, "query.created", { queryId: created.id, referenceNo, services });
    if (isHazardous || isReefer) {
      await emitEvent(tx, "query.hazardous", { queryId: created.id, referenceNo });
    }
    return created;
  });

  const [hydrated] = await hydrateQueries([query]);
  res.status(201).json({
    success: true,
    message:
      customer.source === "bank_lc" && services.includes("lc_finance")
        ? "Query created — LC / Trade Finance was added automatically (Bank LC customer)"
        : "Query created",
    data: hydrated,
  });
});

/* ── GET /api/queries/:id ── */
export const getQuery = catchAsync(async (req, res, next) => {
  const query = await prisma.query.findUnique({ where: { id: req.params.id } });
  // Out-of-scope reads 404, never 403 (BUSINESS_RULES §2.3).
  if (!query || !(await queryInScope(req, query))) return next(new AppError("Query not found", 404));

  const [hydrated] = await hydrateQueries([query]);
  res.json({ success: true, data: hydrated });
});

/* ── PUT /api/queries/:id ── */
export const updateQuery = catchAsync(async (req, res, next) => {
  const query = await prisma.query.findUnique({ where: { id: req.params.id } });
  if (!query || !(await queryInScope(req, query))) return next(new AppError("Query not found", 404));
  if (query.status !== "open") {
    return next(new AppError(`Only an open query can be edited (this one is ${query.status})`, 409));
  }

  const wasFlagged = query.isHazardous || query.isReefer;

  // The effective package after this edit — the incoming one, else what's on the row.
  const servicePackage = req.body.servicePackage ?? query.servicePackage;

  // RULE-QRY-01 — the same reference-data validation `createQuery` does. This was
  // previously skipped entirely here, so a PUT could set an arbitrary port code.
  const portCodes = packageUsesPorts(servicePackage)
    ? [req.body.originPort, req.body.destinationPort].filter(Boolean)
    : [];
  if (portCodes.length) {
    const found = await prisma.port.count({ where: { code: { in: portCodes } } });
    if (found !== new Set(portCodes).size) {
      return next(new AppError("Unknown origin/destination port code", 422));
    }
  }
  if (req.body.containerTypeCode) {
    const ct = await prisma.containerType.findUnique({ where: { code: req.body.containerTypeCode } });
    if (!ct) return next(new AppError("Unknown container type code", 422));
  }

  // Re-resolve services and the CRO/LC modes whenever any of them changes, so the row
  // can never end up with a service set or a mode its package cannot serve.
  const data = { ...req.body };
  if (req.body.servicePackage || req.body.services || req.body.croHandledBy || req.body.lcHandledBy) {
    const customer = await prisma.customer.findUnique({ where: { id: query.customerId } });
    data.lcHandledBy = resolveLcMode({
      servicePackage,
      lcHandledBy: req.body.lcHandledBy ?? query.lcHandledBy,
      customerSource: customer?.source,
    });
    data.services = resolveServices({
      servicePackage,
      services: req.body.services ?? query.services,
      customerSource: customer?.source,
      lcHandledBy: data.lcHandledBy,
    });
    data.servicePackage = servicePackage;
    data.croHandledBy = resolveCroMode({
      servicePackage,
      croHandledBy: req.body.croHandledBy ?? query.croHandledBy,
    });
  }
  // Switching to a local job clears the ports it must not carry, and vice versa.
  if (servicePackage === "local_transport") {
    data.originPort = null;
    data.destinationPort = null;
  }

  const updated = await prisma.$transaction(async (tx) => {
    const u = await tx.query.update({ where: { id: query.id }, data });
    // Flag turned on after creation still triggers the pre-check.
    if (!wasFlagged && (u.isHazardous || u.isReefer)) {
      await emitEvent(tx, "query.hazardous", { queryId: u.id, referenceNo: u.referenceNo });
    }
    await emitEvent(tx, "query.updated", { queryId: u.id, referenceNo: u.referenceNo });
    return u;
  });

  const [hydrated] = await hydrateQueries([updated]);
  res.json({ success: true, message: "Query updated", data: hydrated });
});

/* ── POST /api/queries/:id/cancel ── */
// open → cancelled with a mandatory reason — feeds the unserved-demand
// report (RULE-QRY-03, WORKFLOW §3).
export const cancelQuery = catchAsync(async (req, res, next) => {
  const query = await prisma.query.findUnique({ where: { id: req.params.id } });
  if (!query || !(await queryInScope(req, query))) return next(new AppError("Query not found", 404));
  if (!["open", "quoted"].includes(query.status)) {
    return next(new AppError(`A ${query.status} query cannot be cancelled`, 409));
  }

  const updated = await prisma.$transaction(async (tx) => {
    const u = await tx.query.update({
      where: { id: query.id },
      data: { status: "cancelled", cancelReason: req.body.reason },
    });
    // Cancelling a query invalidates any quotation raised from it.
    await emitEvent(tx, "query.cancelled", { queryId: u.id, referenceNo: u.referenceNo });
    return u;
  });

  const [hydrated] = await hydrateQueries([updated]);
  res.json({ success: true, message: "Query cancelled", data: hydrated });
});

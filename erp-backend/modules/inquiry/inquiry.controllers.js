import crypto from "crypto";
import prisma from "../../config/prisma.js";
import { AppError } from "../../utils/AppError.js";
import { catchAsync } from "../../utils/catchAsync.js";
import { materializeCustomerAndQuery } from "../intake/intake.service.js";

const IS_PROD = process.env.NODE_ENV === "production";

/**
 * Public Inquiry triage (CRM_MASTER §5.20, WORKFLOW §2b) — the Sales-facing
 * inbox for the *direct* channel. A salesperson reviews an anonymous storefront
 * request and converts it into a customer + query, or marks it spam/closed.
 */

const emitEvent = (tx, eventType, payload) =>
  tx.outboxEvent.create({ data: { eventType, payload, correlationId: crypto.randomUUID() } });

const serialize = (i) => ({
  ...i,
  weightKg: i.weightKg != null ? Number(i.weightKg) : null,
  estimatedAmount: i.estimatedAmount != null ? Number(i.estimatedAmount) : null,
});

/* ── GET /api/inquiries ── */
export const listInquiries = catchAsync(async (req, res) => {
  const { status } = req.query;
  const inquiries = await prisma.publicInquiry.findMany({
    where: status ? { status } : {},
    orderBy: { createdAt: "desc" },
  });
  res.json({ success: true, data: inquiries.map(serialize) });
});

/* ── GET /api/inquiries/:id ── */
export const getInquiry = catchAsync(async (req, res, next) => {
  const inquiry = await prisma.publicInquiry.findUnique({ where: { id: req.params.id } });
  if (!inquiry) return next(new AppError("Inquiry not found", 404));
  res.json({ success: true, data: serialize(inquiry) });
});

/* ── PATCH /api/inquiries/:id/status ── (reviewing | spam | closed) */
export const updateInquiryStatus = catchAsync(async (req, res, next) => {
  const inquiry = await prisma.publicInquiry.findUnique({ where: { id: req.params.id } });
  if (!inquiry) return next(new AppError("Inquiry not found", 404));
  if (inquiry.status === "converted") {
    return next(new AppError("A converted inquiry cannot change status", 409));
  }

  const updated = await prisma.$transaction(async (tx) => {
    const row = await tx.publicInquiry.update({
      where: { id: inquiry.id },
      data: { status: req.body.status, reviewedById: req.user.id },
    });
    await emitEvent(tx, "inquiry.updated", { inquiryId: row.id, referenceNo: row.referenceNo, status: row.status });
    return row;
  });
  res.json({ success: true, message: `Inquiry marked ${req.body.status}`, data: serialize(updated) });
});

/* ── POST /api/inquiries/:id/convert ── (→ lead(direct) + customer + query) */
export const convertInquiry = catchAsync(async (req, res, next) => {
  const inquiry = await prisma.publicInquiry.findUnique({ where: { id: req.params.id } });
  if (!inquiry) return next(new AppError("Inquiry not found", 404));
  if (inquiry.status === "converted") {
    return next(new AppError("This inquiry has already been converted", 409));
  }
  if (inquiry.status === "spam") {
    return next(new AppError("A spam inquiry cannot be converted", 409));
  }
  if (!inquiry.services?.length) {
    return next(new AppError("This inquiry has no services to build a query from", 422));
  }

  const ownerId = req.body.ownerId || req.user.id;

  const result = await prisma.$transaction(async (tx) => {
    const materialized = await materializeCustomerAndQuery(tx, {
      source: "direct",
      ownerId,
      createdById: req.user.id,
      companyName: inquiry.companyName,
      contactName: inquiry.contactName,
      contactEmail: inquiry.contactEmail,
      contactPhone: inquiry.contactPhone,
      services: inquiry.services,
      originPort: inquiry.originPort,
      destinationPort: inquiry.destinationPort,
      containerTypeCode: inquiry.containerTypeCode,
      incoterm: inquiry.incoterm,
      cargoDescription: inquiry.cargoDescription,
      weightKg: inquiry.weightKg,
      isHazardous: inquiry.isHazardous,
      isReefer: inquiry.isReefer,
      note: `Converted from public inquiry ${inquiry.referenceNo}`,
    });

    await tx.publicInquiry.update({
      where: { id: inquiry.id },
      data: {
        status: "converted",
        reviewedById: req.user.id,
        convertedLeadId: materialized.lead.id,
        convertedQueryId: materialized.query.id,
      },
    });

    await emitEvent(tx, "inquiry.converted", {
      inquiryId: inquiry.id,
      referenceNo: inquiry.referenceNo,
      leadRef: materialized.lead.referenceNo,
      queryRef: materialized.query.referenceNo,
      customerRef: materialized.customer.referenceNo,
    });

    return materialized;
  });

  res.status(201).json({
    success: true,
    message: `Converted — customer ${result.customer.referenceNo}, query ${result.query.referenceNo}`,
    data: {
      customerId: result.customer.id,
      customerRef: result.customer.referenceNo,
      leadRef: result.lead.referenceNo,
      queryId: result.query.id,
      queryRef: result.query.referenceNo,
      portalInvited: !!result.portalInviteToken,
    },
    // The Notifications module would email the activation link; returned in
    // non-prod so the portal invite is testable without a mail server.
    ...(IS_PROD || !result.portalInviteToken ? {} : { devPortalInviteToken: result.portalInviteToken }),
  });
});

import crypto from "crypto";
import prisma from "../../config/prisma.js";
import { AppError } from "../../utils/AppError.js";
import { catchAsync } from "../../utils/catchAsync.js";
import { allocateRef } from "../../utils/referenceNumber.js";
import { DEFAULT_CURRENCY } from "../../utils/currency.js";
import { serializePosting } from "./loadboard.service.js";

/**
 * Load board — INTERNAL management (CRM_MASTER §5.20). Operations/Transport
 * curate the postings the public storefront shows. Public read lives in the
 * storefront module; this router requires the `loadboard.manage` permission.
 */

/* ── GET /api/loadboard ── (internal: sees all, incl. inactive/expired) */
export const listPostings = catchAsync(async (req, res) => {
  const { status, mode } = req.query;
  const where = {
    ...(status ? { status } : {}),
    ...(mode ? { mode } : {}),
  };
  const postings = await prisma.loadBoardPosting.findMany({
    where,
    orderBy: { createdAt: "desc" },
  });
  res.json({ success: true, data: postings.map(serializePosting) });
});

/* ── POST /api/loadboard ── */
export const createPosting = catchAsync(async (req, res) => {
  const b = req.body;

  const posting = await prisma.$transaction(async (tx) => {
    const referenceNo = await allocateRef(tx, "load_board");
    return tx.loadBoardPosting.create({
      data: {
        referenceNo,
        mode: b.mode,
        originPort: b.originPort,
        destinationPort: b.destinationPort,
        containerTypeCode: b.containerTypeCode ?? null,
        equipment: b.equipment ?? null,
        capacity: b.capacity ?? null,
        departureDate: b.departureDate ?? null,
        validUntil: b.validUntil ?? null,
        transitDays: b.transitDays ?? null,
        indicativeRate: b.indicativeRate ?? null,
        currency: b.currency ?? DEFAULT_CURRENCY,
        services: b.services ?? [],
        notes: b.notes ?? null,
        createdById: req.user.id,
      },
    });
  });

  res.status(201).json({ success: true, message: "Posting created", data: serializePosting(posting) });
});

/* ── PATCH /api/loadboard/:id ── */
export const updatePosting = catchAsync(async (req, res, next) => {
  const existing = await prisma.loadBoardPosting.findUnique({ where: { id: req.params.id } });
  if (!existing) return next(new AppError("Posting not found", 404));

  const updated = await prisma.$transaction(async (tx) => {
    const row = await tx.loadBoardPosting.update({ where: { id: existing.id }, data: req.body });
    await tx.outboxEvent.create({
      data: { eventType: "loadboard.changed", payload: { postingId: row.id }, correlationId: crypto.randomUUID() },
    });
    return row;
  });
  res.json({ success: true, message: "Posting updated", data: serializePosting(updated) });
});

/* ── DELETE /api/loadboard/:id ── (soft: deactivate; keeps history) */
export const deactivatePosting = catchAsync(async (req, res, next) => {
  const existing = await prisma.loadBoardPosting.findUnique({ where: { id: req.params.id } });
  if (!existing) return next(new AppError("Posting not found", 404));

  await prisma.$transaction(async (tx) => {
    await tx.loadBoardPosting.update({ where: { id: existing.id }, data: { isActive: false } });
    await tx.outboxEvent.create({
      data: { eventType: "loadboard.changed", payload: { postingId: existing.id }, correlationId: crypto.randomUUID() },
    });
  });
  res.json({ success: true, message: "Posting removed from the board" });
});

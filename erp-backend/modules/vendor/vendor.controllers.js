import prisma from "../../config/prisma.js";
import { AppError } from "../../utils/AppError.js";
import { catchAsync } from "../../utils/catchAsync.js";
import crypto from "crypto";
import { allocateRef } from "../../utils/referenceNumber.js";
import { isMailConfigured, sendMail } from "../../config/mailer.js";
import { buildQuoteRequestEmail } from "./vendor.mail.js";

/** Vendors feed the payable-invoice pickers on the Finance and shipment screens. */
const emitVendorChanged = (tx, vendorId) =>
  tx.outboxEvent.create({
    data: { eventType: "vendor.changed", payload: { vendorId }, correlationId: crypto.randomUUID() },
  });

/**
 * Vendor master — CRUD (freight-forwarding OTC upgrade). Read is broad
 * (`vendor.read`); writes require `vendor.manage`. Vendors are referenced by
 * payable Invoices.
 */

const normalize = (name) => name.trim().toLowerCase().replace(/\s+/g, " ");

/* ── GET /api/vendors ── */
export const listVendors = catchAsync(async (req, res) => {
  const { type, isActive, q } = req.query;
  const where = {
    ...(type ? { type } : {}),
    ...(isActive != null ? { isActive: isActive === "true" || isActive === true } : {}),
    ...(q ? { normalizedName: { contains: normalize(String(q)) } } : {}),
  };
  const vendors = await prisma.vendor.findMany({ where, orderBy: { name: "asc" } });
  res.json({ success: true, data: vendors });
});

/* ── GET /api/vendors/:id ── */
export const getVendor = catchAsync(async (req, res, next) => {
  const vendor = await prisma.vendor.findUnique({ where: { id: req.params.id } });
  if (!vendor) return next(new AppError("Vendor not found", 404));
  res.json({ success: true, data: vendor });
});

/* ── POST /api/vendors ── */
export const createVendor = catchAsync(async (req, res) => {
  const b = req.body;
  const vendor = await prisma.$transaction(async (tx) => {
    const referenceNo = await allocateRef(tx, "vendor");
    return tx.vendor.create({
      data: {
        referenceNo,
        name: b.name,
        normalizedName: normalize(b.name),
        type: b.type,
        contactName: b.contactName || null,
        email: b.email || null,
        phone: b.phone || null,
        address: b.address || null,
        country: b.country || null,
        city: b.city || null,
        taxId: b.taxId || null,
        paymentTermsDays: b.paymentTermsDays ?? null,
        currency: b.currency || null,
        strn: b.strn || null,
        rexNo: b.rexNo || null,
        vatNo: b.vatNo || null,
        bankName: b.bankName || null,
        bankBranch: b.bankBranch || null,
        iban: b.iban || null,
        swiftCode: b.swiftCode || null,
        accountTitle: b.accountTitle || null,
        website: b.website || null,
        notes: b.notes || null,
      },
    });
  });
  await emitVendorChanged(prisma, vendor.id);
  res.status(201).json({ success: true, message: "Vendor created", data: vendor });
});

/* ── PATCH /api/vendors/:id ── */
export const updateVendor = catchAsync(async (req, res, next) => {
  const existing = await prisma.vendor.findUnique({ where: { id: req.params.id } });
  if (!existing) return next(new AppError("Vendor not found", 404));

  const b = req.body;
  const data = { ...b };
  if (b.name) data.normalizedName = normalize(b.name);
  // Normalise empty strings to null for optional contact fields.
  for (const k of ["contactName", "email", "phone", "address", "country", "city", "taxId", "currency", "strn", "rexNo", "vatNo", "bankName", "bankBranch", "iban", "swiftCode", "accountTitle", "website"]) {
    if (data[k] === "") data[k] = null;
  }

  const updated = await prisma.$transaction(async (tx) => {
    const row = await tx.vendor.update({ where: { id: existing.id }, data });
    await emitVendorChanged(tx, row.id);
    return row;
  });
  res.json({ success: true, message: "Vendor updated", data: updated });
});

/* ── POST /api/vendors/:id/deactivate ── (soft) */
export const deactivateVendor = catchAsync(async (req, res, next) => {
  const existing = await prisma.vendor.findUnique({ where: { id: req.params.id } });
  if (!existing) return next(new AppError("Vendor not found", 404));
  await prisma.$transaction(async (tx) => {
    await tx.vendor.update({ where: { id: existing.id }, data: { isActive: false } });
    await emitVendorChanged(tx, existing.id);
  });
  res.json({ success: true, message: "Vendor deactivated" });
});

/* ── DELETE /api/vendors/:id ── (hard delete) */
export const deleteVendor = catchAsync(async (req, res, next) => {
  const existing = await prisma.vendor.findUnique({ where: { id: req.params.id } });
  if (!existing) return next(new AppError("Vendor not found", 404));
  
  await prisma.$transaction(async (tx) => {
    await tx.vendor.delete({ where: { id: existing.id } });
    await emitVendorChanged(tx, existing.id);
  });
  res.json({ success: true, message: "Vendor deleted" });
});

/* ── POST /api/vendors/:id/quote-request ── */
/**
 * Email a vendor asking for their rates — the "Quote" button on the vendor card.
 *
 * Deliberately NOT a VendorRfq: that record belongs to a query and carries the buy
 * side of a specific job. This is the directory's own lightweight nudge, so it writes
 * nothing and simply sends the mail. If it ever needs to be tracked, it becomes an RFQ.
 *
 * Replies go to the requester rather than the shared mailbox, because the person who
 * asked for the rate is the one who has to read it.
 */
export const requestVendorQuote = catchAsync(async (req, res, next) => {
  const vendor = await prisma.vendor.findUnique({ where: { id: req.params.id } });
  if (!vendor) return next(new AppError("Vendor not found", 404));
  if (!vendor.email) {
    return next(new AppError(`${vendor.name} has no email address on file — add one to request rates`, 422));
  }
  if (!isMailConfigured()) {
    return next(new AppError("Email is not configured on the server yet — set MAIL_USER and MAIL_PASSWORD", 503));
  }

  const { subject, text, html } = buildQuoteRequestEmail(vendor, req.user, req.body?.message);

  try {
    await sendMail({ to: vendor.email, subject, text, html, replyTo: req.user?.email });
  } catch (err) {
    // Gmail's SMTP errors name the account and the auth failure; that is server
    // config detail, so it is logged rather than returned to the browser.
    console.error("[vendor.quote-request] send failed:", err?.message);
    return next(new AppError("Could not send the email — check the mail settings and try again", 502));
  }

  res.json({ success: true, message: `Rate request emailed to ${vendor.email}` });
});

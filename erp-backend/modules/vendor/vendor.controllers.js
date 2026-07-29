import prisma from "../../config/prisma.js";
import { AppError } from "../../utils/AppError.js";
import { catchAsync } from "../../utils/catchAsync.js";
import { allocateRef } from "../../utils/referenceNumber.js";

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
        notes: b.notes || null,
      },
    });
  });
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
  for (const k of ["contactName", "email", "phone", "address", "country", "city", "taxId", "currency"]) {
    if (data[k] === "") data[k] = null;
  }

  const updated = await prisma.vendor.update({ where: { id: existing.id }, data });
  res.json({ success: true, message: "Vendor updated", data: updated });
});

/* ── POST /api/vendors/:id/deactivate ── (soft) */
export const deactivateVendor = catchAsync(async (req, res, next) => {
  const existing = await prisma.vendor.findUnique({ where: { id: req.params.id } });
  if (!existing) return next(new AppError("Vendor not found", 404));
  await prisma.vendor.update({ where: { id: existing.id }, data: { isActive: false } });
  res.json({ success: true, message: "Vendor deactivated" });
});

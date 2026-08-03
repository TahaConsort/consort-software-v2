import prisma from "../../config/prisma.js";
import { AppError } from "../../utils/AppError.js";
import { catchAsync } from "../../utils/catchAsync.js";
import { allocateRef } from "../../utils/referenceNumber.js";
import { normalizeCnic, normalizePlate } from "./fleet.validation.js";

/**
 * Own-fleet master — drivers and vehicles (CRUD). Read: `fleet.read`;
 * writes: `fleet.manage`. Both entities are soft-deactivated, never deleted,
 * because their documents and any historical reference must keep resolving.
 */

const blank = (v) => v === "" || v === undefined;

/**
 * Master data earns its keep only if one person is one row. CNIC and plate are
 * the natural keys, so a second row carrying either is refused rather than
 * silently created — an inactive row still counts, otherwise deactivating a
 * driver would quietly free their CNIC for a duplicate.
 */
const assertUniqueCnic = async (cnic, exceptId) => {
  if (!cnic) return;
  const clash = await prisma.driver.findFirst({
    where: { cnic, ...(exceptId ? { id: { not: exceptId } } : {}) },
    select: { referenceNo: true, name: true },
  });
  if (clash) throw new AppError(`CNIC already registered to ${clash.name} (${clash.referenceNo})`, 409);
};

const assertUniquePlate = async (plateNo, exceptId) => {
  if (!plateNo) return;
  const clash = await prisma.fleetVehicle.findFirst({
    where: { plateNo, ...(exceptId ? { id: { not: exceptId } } : {}) },
    select: { referenceNo: true, kind: true },
  });
  if (clash) throw new AppError(`Registration already on ${clash.kind} ${clash.referenceNo}`, 409);
};

// ── DRIVERS ───────────────────────────────────────────────────────────────────

/* ── GET /api/drivers ── */
export const listDrivers = catchAsync(async (req, res) => {
  const { isActive, q } = req.query;
  const search = String(q ?? "").trim();
  const where = {
    ...(isActive != null ? { isActive: isActive === "true" || isActive === true } : {}),
    ...(search
      ? {
          OR: [
            { name: { contains: search, mode: "insensitive" } },
            { phone: { contains: search } },
            { cnic: { contains: normalizeCnic(search) || search } },
            { licenseNo: { contains: search, mode: "insensitive" } },
          ],
        }
      : {}),
  };
  const drivers = await prisma.driver.findMany({ where, orderBy: { name: "asc" } });
  res.json({ success: true, data: drivers });
});

/* ── GET /api/drivers/:id ── */
export const getDriver = catchAsync(async (req, res, next) => {
  const driver = await prisma.driver.findUnique({ where: { id: req.params.id } });
  if (!driver) return next(new AppError("Driver not found", 404));
  res.json({ success: true, data: driver });
});

/* ── POST /api/drivers ── */
export const createDriver = catchAsync(async (req, res) => {
  const b = req.body;
  const cnic = blank(b.cnic) ? null : normalizeCnic(b.cnic);
  await assertUniqueCnic(cnic);

  const driver = await prisma.$transaction(async (tx) => {
    const referenceNo = await allocateRef(tx, "driver");
    return tx.driver.create({
      data: {
        referenceNo,
        name: b.name.trim(),
        phone: blank(b.phone) ? null : b.phone,
        cnic,
        licenseNo: blank(b.licenseNo) ? null : b.licenseNo,
      },
    });
  });
  res.status(201).json({ success: true, message: "Driver created", data: driver });
});

/* ── PATCH /api/drivers/:id ── */
export const updateDriver = catchAsync(async (req, res, next) => {
  const existing = await prisma.driver.findUnique({ where: { id: req.params.id } });
  if (!existing) return next(new AppError("Driver not found", 404));

  const b = req.body;
  const data = {};
  if (b.name !== undefined) data.name = b.name.trim();
  if (b.phone !== undefined) data.phone = blank(b.phone) ? null : b.phone;
  if (b.licenseNo !== undefined) data.licenseNo = blank(b.licenseNo) ? null : b.licenseNo;
  if (b.isActive !== undefined) data.isActive = b.isActive;
  if (b.cnic !== undefined) {
    data.cnic = blank(b.cnic) ? null : normalizeCnic(b.cnic);
    await assertUniqueCnic(data.cnic, existing.id);
  }

  const updated = await prisma.driver.update({ where: { id: existing.id }, data });
  res.json({ success: true, message: "Driver updated", data: updated });
});

/* ── POST /api/drivers/:id/deactivate ── (soft) */
export const deactivateDriver = catchAsync(async (req, res, next) => {
  const existing = await prisma.driver.findUnique({ where: { id: req.params.id } });
  if (!existing) return next(new AppError("Driver not found", 404));
  await prisma.driver.update({ where: { id: existing.id }, data: { isActive: false } });
  res.json({ success: true, message: "Driver deactivated" });
});

// ── VEHICLES (trucks & dumpers) ───────────────────────────────────────────────

/* ── GET /api/vehicles?kind=truck|dumper ── */
export const listVehicles = catchAsync(async (req, res) => {
  const { kind, isActive, q } = req.query;
  const search = String(q ?? "").trim();
  const where = {
    ...(kind ? { kind } : {}),
    ...(isActive != null ? { isActive: isActive === "true" || isActive === true } : {}),
    ...(search ? { plateNo: { contains: normalizePlate(search) } } : {}),
  };
  const vehicles = await prisma.fleetVehicle.findMany({ where, orderBy: { plateNo: "asc" } });
  res.json({ success: true, data: vehicles });
});

/* ── GET /api/vehicles/:id ── */
export const getVehicle = catchAsync(async (req, res, next) => {
  const vehicle = await prisma.fleetVehicle.findUnique({ where: { id: req.params.id } });
  if (!vehicle) return next(new AppError("Vehicle not found", 404));
  res.json({ success: true, data: vehicle });
});

/* ── POST /api/vehicles ── */
export const createVehicle = catchAsync(async (req, res) => {
  const b = req.body;
  const plateNo = normalizePlate(b.plateNo);
  await assertUniquePlate(plateNo);

  const vehicle = await prisma.$transaction(async (tx) => {
    const referenceNo = await allocateRef(tx, "vehicle");
    return tx.fleetVehicle.create({
      data: {
        referenceNo,
        kind: b.kind,
        plateNo,
        notes: blank(b.notes) ? null : b.notes,
      },
    });
  });
  res.status(201).json({ success: true, message: "Vehicle created", data: vehicle });
});

/* ── PATCH /api/vehicles/:id ── */
export const updateVehicle = catchAsync(async (req, res, next) => {
  const existing = await prisma.fleetVehicle.findUnique({ where: { id: req.params.id } });
  if (!existing) return next(new AppError("Vehicle not found", 404));

  const b = req.body;
  const data = {};
  if (b.kind !== undefined) data.kind = b.kind;
  if (b.notes !== undefined) data.notes = blank(b.notes) ? null : b.notes;
  if (b.isActive !== undefined) data.isActive = b.isActive;
  if (b.plateNo !== undefined) {
    data.plateNo = normalizePlate(b.plateNo);
    await assertUniquePlate(data.plateNo, existing.id);
  }

  const updated = await prisma.fleetVehicle.update({ where: { id: existing.id }, data });
  res.json({ success: true, message: "Vehicle updated", data: updated });
});

/* ── POST /api/vehicles/:id/deactivate ── (soft) */
export const deactivateVehicle = catchAsync(async (req, res, next) => {
  const existing = await prisma.fleetVehicle.findUnique({ where: { id: req.params.id } });
  if (!existing) return next(new AppError("Vehicle not found", 404));
  await prisma.fleetVehicle.update({ where: { id: existing.id }, data: { isActive: false } });
  res.json({ success: true, message: "Vehicle deactivated" });
});

import { z } from "zod";

/**
 * Own-fleet master data — drivers and vehicles (trucks/dumpers).
 *
 * Deliberately NOT vendors: a driver is our own operational record, never a
 * counterparty on a payable invoice. The fields are the minimum that identifies
 * a person or an asset legally; everything else that proves they may move cargo
 * (CNIC scan, licence, registration book) is an attached Document, not a column.
 */

export const VEHICLE_KINDS = ["truck", "dumper"];

/** CNIC is stored digits-only so "42101-1234567-1" and "4210112345671" match. */
export const normalizeCnic = (value) => String(value ?? "").replace(/\D/g, "");

/** Plates are compared case- and separator-insensitively ("LES-1234" = "les 1234"). */
export const normalizePlate = (value) =>
  String(value ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");

const cnicField = z
  .string()
  .max(20)
  .optional()
  .or(z.literal(""))
  .refine((v) => !v || normalizeCnic(v).length === 13, "CNIC must be 13 digits");

export const createDriverSchema = z.object({
  name: z.string().min(1, "Name is required").max(200),
  phone: z.string().max(50).optional().or(z.literal("")),
  cnic: cnicField,
  licenseNo: z.string().max(50).optional().or(z.literal("")),
});

export const updateDriverSchema = createDriverSchema.partial().extend({
  isActive: z.boolean().optional(),
});

export const createVehicleSchema = z.object({
  kind: z.enum(VEHICLE_KINDS),
  plateNo: z.string().min(1, "Registration number is required").max(30),
  notes: z.string().max(1000).optional().or(z.literal("")),
});

export const updateVehicleSchema = createVehicleSchema.partial().extend({
  isActive: z.boolean().optional(),
});

import { z } from "zod";

/**
 * Employee Management — request schemas (CRM_MASTER §5.2, RULE-EMP).
 * Role lives on the linked User; department on the Employee (INV-01).
 */

// Internal roles only — a customer is never an employee.
export const INTERNAL_ROLES = [
  "ceo",
  "project_director",
  "director",
  "cfo",
  "gm",
  "hr",
  "asm",
  "bdo",
  "ops_manager",
  "ops_exec",
  "compliance_manager",
  "compliance_exec",
  "transport_manager",
  "transport_exec",
  "accounts",
];

// The 5 Management roles are bootstrapped (POST /auth/bootstrap-admin), never
// handed out from the Employee screen — so they are NOT assignable here.
const MANAGEMENT_ROLES = ["ceo", "project_director", "director", "cfo", "gm"];
export const ASSIGNABLE_ROLES = INTERNAL_ROLES.filter((r) => !MANAGEMENT_ROLES.includes(r));

const email = z
  .string()
  .email("Invalid email address")
  .transform((v) => v.toLowerCase());

// One or more internal roles; deduped, at least one. A multi-role employee holds
// the union of every role's permissions.
const rolesArray = z
  .array(z.enum(ASSIGNABLE_ROLES))
  .min(1, "At least one role is required")
  .transform((rs) => [...new Set(rs)]);

export const createEmployeeSchema = z.object({
  firstName: z.string().min(1, "First name is required"),
  lastName: z.string().min(1, "Last name is required"),
  email,
  roles: rolesArray,
  departmentId: z.string().min(1, "Department is required"),
  phone: z.string().optional(),
  designation: z.string().optional(),
  cnic: z.string().optional(),
  managerId: z.string().min(1).optional().nullable(),
  joiningDate: z.coerce.date().optional(),
});

export const updateEmployeeSchema = z.object({
  firstName: z.string().min(1).optional(),
  lastName: z.string().min(1).optional(),
  roles: rolesArray.optional(),
  departmentId: z.string().min(1).optional(),
  phone: z.string().optional().nullable(),
  designation: z.string().optional().nullable(),
  cnic: z.string().optional().nullable(),
  managerId: z.string().min(1).optional().nullable(),
  joiningDate: z.coerce.date().optional().nullable(),
  reactivate: z.boolean().optional(), // set true to bring a deactivated employee back
});

export const reassignWorkSchema = z.object({
  toUserId: z.string().min(1, "A destination user is required"),
});

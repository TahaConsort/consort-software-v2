/**
 * Role helpers mirroring UserRole in the Prisma schema (CRM_MASTER §3, ADR-044).
 * Kept in one place so guards, redirects and menus never disagree.
 */

export const MANAGEMENT_ROLES = ["ceo", "project_director", "director", "cfo", "gm"];

export const INTERNAL_ROLES = [
  ...MANAGEMENT_ROLES,
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

// Roles that reach the internal admin/workspace area.
export const ADMIN_AREA_ROLES = [...MANAGEMENT_ROLES, "hr"];

// The full role set of a user, tolerating a legacy single `role`.
export const rolesOf = (user) =>
  user?.roles?.length ? user.roles : user?.role ? [user.role] : [];

// Polymorphic: accepts a role string OR a user object (checks every held role).
export const isManagement = (roleOrUser) => {
  if (!roleOrUser) return false;
  if (typeof roleOrUser === "string") return MANAGEMENT_ROLES.includes(roleOrUser);
  return rolesOf(roleOrUser).some((r) => MANAGEMENT_ROLES.includes(r));
};
export const isInternal = (roleOrUser) => {
  if (typeof roleOrUser === "string") return INTERNAL_ROLES.includes(roleOrUser);
  return rolesOf(roleOrUser).some((r) => INTERNAL_ROLES.includes(r));
};

// True when the user holds ANY of the given roles.
export const hasAnyRole = (user, roles = []) => rolesOf(user).some((r) => roles.includes(r));

// Human labels for the UserRole enum (CRM_MASTER §3).
export const ROLE_LABELS = {
  ceo: "CEO",
  project_director: "Project Director",
  director: "Director",
  cfo: "CFO",
  gm: "General Manager",
  hr: "HR Manager",
  asm: "Area Sales Manager",
  bdo: "Business Development Officer",
  ops_manager: "Operations Manager",
  ops_exec: "Operations Executive",
  compliance_manager: "Compliance Manager",
  compliance_exec: "Compliance Executive",
  transport_manager: "Transport Manager",
  transport_exec: "Transport Executive",
  accounts: "Accounts",
  customer: "Customer",
};

export const labelForRole = (role) => ROLE_LABELS[role] ?? role ?? "—";

// "Business Development Officer · Operations Manager" for a multi-role employee.
export const labelForRoles = (user) => {
  const rs = rolesOf(user);
  return rs.length ? rs.map(labelForRole).join(" · ") : "—";
};

// Assignable roles for the employee create/edit forms (internal only).
export const ROLE_OPTIONS = INTERNAL_ROLES.map((value) => ({
  value,
  label: ROLE_LABELS[value],
}));

// Management (ceo/…/gm) is bootstrapped, never assigned from the Employees
// screen — so it is excluded from the create/edit role pickers.
export const ASSIGNABLE_ROLES = INTERNAL_ROLES.filter((r) => !MANAGEMENT_ROLES.includes(r));
export const ASSIGNABLE_ROLE_OPTIONS = ASSIGNABLE_ROLES.map((value) => ({
  value,
  label: ROLE_LABELS[value],
}));

export const SALES_ROLES = ["asm", "bdo"];

/** Where a role lands right after login. */
export const homeRouteForRole = (role) => {
  if (role === "customer") return "/dashboard";
  if (isInternal(role)) return "/admin"; // every internal role gets a role-aware dashboard (§5.17)
  return "/dashboard";
};

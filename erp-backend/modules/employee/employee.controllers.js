import crypto from "crypto";
import prisma from "../../config/prisma.js";
import { AppError } from "../../utils/AppError.js";
import { catchAsync } from "../../utils/catchAsync.js";
import { forceDisconnectUser } from "../../realtime/io.js";
import { isManagement, rolesOf } from "../auth/auth.middleware.js";
import { buildActivationLink } from "../../utils/links.js";

const IS_PROD = process.env.NODE_ENV === "production";
const sha256 = (v) => crypto.createHash("sha256").update(v).digest("hex");

// Canonical departments (DATABASE §8) — the closed 7-code set.
const DEPARTMENT_SEED = [
  ["management", "Management"],
  ["sales", "Sales"],
  ["operations", "Operations"],
  ["compliance", "Compliance"],
  ["finance", "Finance"],
  ["hr", "HR"],
  ["transport", "Transport"],
];

/* ─────────────────────────── helpers ─────────────────────────── */

const serialize = (e) => ({
  id: e.id,
  userId: e.user?.id ?? null,
  firstName: e.firstName,
  lastName: e.lastName,
  fullName: `${e.firstName} ${e.lastName}`,
  email: e.email,
  phone: e.phone ?? null,
  designation: e.designation ?? null,
  cnic: e.cnic ?? null,
  role: e.user?.role ?? null, // primary (kept for anything still reading a single role)
  roles: e.user?.roles?.length ? e.user.roles : e.user?.role ? [e.user.role] : [],
  departmentId: e.departmentId,
  department: e.department ? { id: e.department.id, code: e.department.code, name: e.department.name } : null,
  managerId: e.managerId ?? null,
  managerName: e.manager ? `${e.manager.firstName} ${e.manager.lastName}` : null,
  isActive: e.isActive,
  activated: !!e.user?.passwordHash, // has set a password via the activation link
  joiningDate: e.joiningDate,
  createdAt: e.createdAt,
});

const EMPLOYEE_INCLUDE = {
  department: true,
  user: { select: { id: true, role: true, roles: true, passwordHash: true, isActive: true } },
  manager: { select: { firstName: true, lastName: true } },
};

// Open work owned by a user — the deactivation blocker (RULE-EMP-02).
const countOpenWork = async (userId) => {
  if (!userId) return { leads: 0, queries: 0, quotations: 0, tasks: 0, total: 0 };
  const [leads, queries, quotations, tasks] = await prisma.$transaction([
    prisma.lead.count({ where: { ownerId: userId, status: { in: ["new", "contacted", "qualified"] } } }),
    prisma.query.count({ where: { raisedById: userId, status: { in: ["open", "quoted", "revision_requested", "approved"] } } }),
    prisma.quotation.count({ where: { createdById: userId, status: { in: ["draft", "sent"] } } }),
    prisma.task.count({ where: { assigneeId: userId, status: { in: ["queued", "open", "in_progress", "on_hold"] } } }),
  ]);
  return { leads, queries, quotations, tasks, total: leads + queries + quotations + tasks };
};

// Walk the manager chain — reject if `managerId` would loop back (RULE-EMP-03).
const wouldCreateCycle = async (employeeId, managerId) => {
  let cursor = managerId;
  const seen = new Set([employeeId]);
  while (cursor) {
    if (seen.has(cursor)) return true;
    seen.add(cursor);
    const m = await prisma.employee.findUnique({ where: { id: cursor }, select: { managerId: true } });
    cursor = m?.managerId ?? null;
  }
  return false;
};

/* ─────────────────────────── GET /departments ─────────────────────────── */
// Idempotently ensures the 7 canonical departments exist, then lists them.
export const listDepartments = catchAsync(async (req, res) => {
  await prisma.department.createMany({
    data: DEPARTMENT_SEED.map(([code, name]) => ({ code, name })),
    skipDuplicates: true,
  });
  const departments = await prisma.department.findMany({
    orderBy: { name: "asc" },
    select: { id: true, code: true, name: true },
  });
  res.json({ success: true, data: departments });
});

/* ─────────────────────────── GET / ─────────────────────────── */
export const listEmployees = catchAsync(async (req, res) => {
  const employees = await prisma.employee.findMany({
    orderBy: { createdAt: "desc" },
    include: EMPLOYEE_INCLUDE,
  });
  res.json({ success: true, data: employees.map(serialize) });
});

/* ─────────────────────────── GET /:id ─────────────────────────── */
export const getEmployee = catchAsync(async (req, res, next) => {
  const employee = await prisma.employee.findUnique({
    where: { id: req.params.id },
    include: EMPLOYEE_INCLUDE,
  });
  if (!employee) return next(new AppError("Employee not found", 404));
  res.json({ success: true, data: serialize(employee) });
});

/* ─────────────────────────── POST / ─────────────────────────── */
// Create employee (+ login + activation token). Password is set by the invitee
// via POST /auth/activate (RULE-EMP-01).
export const createEmployee = catchAsync(async (req, res, next) => {
  const { firstName, lastName, email, roles, departmentId, phone, designation, cnic, managerId, joiningDate } = req.body;

  const department = await prisma.department.findUnique({ where: { id: departmentId } });
  if (!department) return next(new AppError("Department not found", 400));

  if (managerId) {
    const manager = await prisma.employee.findUnique({ where: { id: managerId } });
    if (!manager) return next(new AppError("Reporting manager not found", 400));
  }

  const emailTaken =
    (await prisma.user.findUnique({ where: { email } })) ||
    (await prisma.employee.findUnique({ where: { email } }));
  if (emailTaken) return next(new AppError("Email is already in use", 409));

  const rawToken = crypto.randomBytes(32).toString("base64url");

  const employee = await prisma.$transaction(async (tx) => {
    const emp = await tx.employee.create({
      data: { firstName, lastName, email, phone, designation, cnic, departmentId, managerId: managerId ?? null, joiningDate: joiningDate ?? null },
    });
    await tx.user.create({
      // Primary role = first of the set; `roles` carries the full multi-role union.
      data: { email, role: roles[0], roles, employeeId: emp.id, isActive: true }, // passwordHash null until activation
    });
    const user = await tx.user.findUnique({ where: { employeeId: emp.id } });
    await tx.activationToken.create({
      data: {
        userId: user.id,
        tokenHash: sha256(rawToken),
        purpose: "activation",
        expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      },
    });
    return tx.employee.findUnique({ where: { id: emp.id }, include: EMPLOYEE_INCLUDE });
  });

  res.status(201).json({
    success: true,
    message: "Employee created. Send them the activation link to set a password.",
    data: serialize(employee),
    // The Notifications module would email this link; returned here so the admin
    // can copy it straight from the create response. It lands on /activate, where
    // the invitee sets their own password (POST /auth/activate).
    ...(IS_PROD ? {} : { activationLink: buildActivationLink(rawToken) }),
  });
});

/* ─────────────────────────── PUT /:id ─────────────────────────── */
export const updateEmployee = catchAsync(async (req, res, next) => {
  const { id } = req.params;
  const { firstName, lastName, roles, departmentId, phone, designation, cnic, managerId, joiningDate, reactivate } = req.body;

  const employee = await prisma.employee.findUnique({ where: { id }, include: { user: true } });
  if (!employee) return next(new AppError("Employee not found", 404));

  // Role edits are gated: a Management account is not re-roled from this screen,
  // and you cannot change your own roles (self-lockout / self-escalation).
  if (roles) {
    if (employee.user && isManagement(employee.user)) {
      return next(new AppError("A Management account can't be re-roled from the Employees screen", 403));
    }
    if (employee.user && employee.user.id === req.user.id) {
      return next(new AppError("You cannot change your own roles", 403));
    }
  }

  if (departmentId) {
    const dept = await prisma.department.findUnique({ where: { id: departmentId } });
    if (!dept) return next(new AppError("Department not found", 400));
  }

  if (managerId) {
    if (managerId === id) return next(new AppError("An employee cannot report to themselves", 400));
    const manager = await prisma.employee.findUnique({ where: { id: managerId } });
    if (!manager) return next(new AppError("Reporting manager not found", 400));
    if (await wouldCreateCycle(id, managerId)) {
      return next(new AppError("That reporting line creates a cycle", 400));
    }
  }

  const empData = {};
  if (firstName !== undefined) empData.firstName = firstName;
  if (lastName !== undefined) empData.lastName = lastName;
  if (phone !== undefined) empData.phone = phone;
  if (designation !== undefined) empData.designation = designation;
  if (cnic !== undefined) empData.cnic = cnic;
  if (departmentId !== undefined) empData.departmentId = departmentId;
  if (managerId !== undefined) empData.managerId = managerId;
  if (joiningDate !== undefined) empData.joiningDate = joiningDate;
  if (reactivate) {
    empData.isActive = true;
    empData.exitDate = null;
  }

  // Compare as sets so order doesn't count as a change.
  const currentRoles = employee.user?.roles?.length
    ? employee.user.roles
    : employee.user?.role
      ? [employee.user.role]
      : [];
  const rolesChanged =
    roles && employee.user && (roles.length !== currentRoles.length || roles.some((r) => !currentRoles.includes(r)));

  await prisma.$transaction(async (tx) => {
    await tx.employee.update({ where: { id }, data: empData });

    if (employee.user) {
      const userData = {};
      if (rolesChanged) {
        // Re-scope immediately: bump token_version so the session re-auths into
        // the new role set (RULE-EMP-04, EDGE-A-03).
        userData.role = roles[0];
        userData.roles = roles;
        userData.tokenVersion = { increment: 1 };
      }
      if (reactivate) userData.isActive = true;
      if (Object.keys(userData).length) {
        await tx.user.update({ where: { id: employee.user.id }, data: userData });
      }
    }

    // A role change is a privilege change — record it (INV-15 audit trail).
    if (rolesChanged) {
      await tx.auditLog.create({
        data: {
          actorId: req.user.id,
          action: "employee.roles.update",
          resourceType: "employee",
          resourceId: id,
          diff: { roles: { from: currentRoles, to: roles } },
          correlationId: crypto.randomUUID(),
        },
      });
    }
  });

  const updated = await prisma.employee.findUnique({ where: { id }, include: EMPLOYEE_INCLUDE });
  res.json({ success: true, message: "Employee updated", data: serialize(updated) });
});

/* ─────────────────────────── GET /:id/open-work ─────────────────────────── */
export const getOpenWork = catchAsync(async (req, res, next) => {
  const employee = await prisma.employee.findUnique({ where: { id: req.params.id }, include: { user: true } });
  if (!employee) return next(new AppError("Employee not found", 404));
  const counts = await countOpenWork(employee.user?.id);
  res.json({ success: true, data: counts });
});

/* ─────────────────────────── POST /:id/reassign-work ─────────────────────────── */
// Move all open work to another user in one transaction (RULE-EMP-02).
export const reassignWork = catchAsync(async (req, res, next) => {
  const { toUserId } = req.body;

  const employee = await prisma.employee.findUnique({ where: { id: req.params.id }, include: { user: true } });
  if (!employee) return next(new AppError("Employee not found", 404));
  if (!employee.user) return next(new AppError("Employee has no login, so no owned work", 400));

  const fromUserId = employee.user.id;
  if (toUserId === fromUserId) return next(new AppError("Choose a different destination user", 400));

  const target = await prisma.user.findUnique({ where: { id: toUserId } });
  if (!target || !target.isActive || target.role === "customer") {
    return next(new AppError("Destination must be an active internal user", 400));
  }

  await prisma.$transaction([
    prisma.lead.updateMany({ where: { ownerId: fromUserId, status: { in: ["new", "contacted", "qualified"] } }, data: { ownerId: toUserId } }),
    prisma.query.updateMany({ where: { raisedById: fromUserId, status: { in: ["open", "quoted", "revision_requested", "approved"] } }, data: { raisedById: toUserId } }),
    prisma.quotation.updateMany({ where: { createdById: fromUserId, status: { in: ["draft", "sent"] } }, data: { createdById: toUserId } }),
    prisma.task.updateMany({ where: { assigneeId: fromUserId, status: { in: ["queued", "open", "in_progress", "on_hold"] } }, data: { assigneeId: toUserId } }),
  ]);

  const remaining = await countOpenWork(fromUserId);
  res.json({ success: true, message: "Open work reassigned", data: { remaining } });
});

/* ─────────────────────────── DELETE /:id ─────────────────────────── */
// Deactivate-and-reassign — never a hard delete (ADR-045, RULE-EMP-05).
export const deactivateEmployee = catchAsync(async (req, res, next) => {
  const employee = await prisma.employee.findUnique({ where: { id: req.params.id }, include: { user: true } });
  if (!employee) return next(new AppError("Employee not found", 404));

  if (employee.user && employee.user.id === req.user.id) {
    return next(new AppError("You cannot deactivate your own account", 400));
  }

  // The CEO is the top account — it can't be deactivated from this screen
  // (prevents locking the organisation's root user out).
  if (employee.user && rolesOf(employee.user).includes("ceo")) {
    return next(new AppError("The CEO account can't be deactivated here", 403));
  }

  const openWork = await countOpenWork(employee.user?.id);
  if (openWork.total > 0) {
    return res.status(409).json({
      success: false,
      code: "EMPLOYEE_HAS_OPEN_WORK",
      message: "Reassign this employee's open work before deactivating.",
      data: openWork,
    });
  }

  await prisma.$transaction(async (tx) => {
    await tx.employee.update({ where: { id: employee.id }, data: { isActive: false, exitDate: new Date() } });
    if (employee.user) {
      await tx.user.update({
        where: { id: employee.user.id },
        data: { isActive: false, tokenVersion: { increment: 1 } }, // kill access tokens
      });
      await tx.refreshToken.updateMany({
        where: { userId: employee.user.id, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      await tx.chatChannelMember.updateMany({
        where: { userId: employee.user.id, leftAt: null },
        data: { leftAt: new Date() },
      });
      // Domain event (WORKFLOW §6) — commits with the state change (ADR-021).
      await tx.outboxEvent.create({
        data: {
          eventType: "user.deactivated",
          payload: { userId: employee.user.id, employeeId: employee.id },
          correlationId: crypto.randomUUID(),
        },
      });
    }
  });

  // EDGE-A-04 — evict live sockets AFTER commit; tokens are already dead.
  if (employee.user) forceDisconnectUser(employee.user.id);

  res.json({ success: true, message: "Employee deactivated. Ownership history retained." });
});

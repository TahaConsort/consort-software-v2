import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import crypto from "crypto";
import prisma from "../../config/prisma.js";
import { AppError } from "../../utils/AppError.js";
import { catchAsync } from "../../utils/catchAsync.js";
import { allocateRef } from "../../utils/referenceNumber.js";
import { getPermissionsForRoles, isManagement, rolesOf } from "./auth.middleware.js";

/* ─────────────────────────── config ─────────────────────────── */

const ACCESS_TTL = process.env.JWT_ACCESS_EXPIRES || "15m"; // ADR-009 — short-lived
const REFRESH_TTL_DAYS = Number(process.env.REFRESH_EXPIRES_DAYS || 30);
const REFRESH_COOKIE = "consort_rt";
const MAX_FAILED = Number(process.env.LOGIN_MAX_FAILED || 5);
const LOCK_MINUTES = Number(process.env.LOGIN_LOCK_MINUTES || 15);
const IS_PROD = process.env.NODE_ENV === "production";

// Well-formed bcrypt hash used to keep the "user not found" path constant-time,
// so response timing never reveals whether an email exists (ADR-033, EDGE-A-01).
const DUMMY_HASH = "$2a$10$N9qo8uLOickgx2ZMRZoMyeIjZAgcfl7p92ldGxad68LJZdL17lhWy";

/* ─────────────────────────── helpers ─────────────────────────── */

const sha256 = (v) => crypto.createHash("sha256").update(v).digest("hex");

const signAccessToken = (user) =>
  jwt.sign(
    { sub: user.id, role: user.role, roles: rolesOf(user), tv: user.tokenVersion },
    process.env.JWT_SECRET,
    { expiresIn: ACCESS_TTL },
  );

const publicUser = (u) => ({
  id: u.id,
  email: u.email,
  role: u.role, // primary
  roles: rolesOf(u), // full set (multi-role employees)
  employeeId: u.employeeId ?? null,
  customerId: u.customerId ?? null,
});

// Read a single cookie without cookie-parser (not installed).
const readCookie = (req, name) => {
  const raw = req.headers.cookie;
  if (!raw) return null;
  for (const part of raw.split(";")) {
    const [k, ...v] = part.trim().split("=");
    if (k === name) return decodeURIComponent(v.join("="));
  }
  return null;
};

const cookieOptions = () => ({
  httpOnly: true,
  secure: IS_PROD, // must be false over plain http in dev
  sameSite: IS_PROD ? "none" : "lax",
  path: "/api/auth",
  maxAge: REFRESH_TTL_DAYS * 24 * 60 * 60 * 1000,
});

const setRefreshCookie = (res, token) => res.cookie(REFRESH_COOKIE, token, cookieOptions());
const clearRefreshCookie = (res) =>
  res.clearCookie(REFRESH_COOKIE, { ...cookieOptions(), maxAge: undefined });

// Mint a fresh opaque refresh token, persist its hash, set the cookie.
const issueRefreshSession = async (tx, res, userId, familyId, req) => {
  const raw = crypto.randomBytes(48).toString("base64url");
  const expiresAt = new Date(Date.now() + REFRESH_TTL_DAYS * 24 * 60 * 60 * 1000);
  const row = await tx.refreshToken.create({
    data: {
      userId,
      tokenHash: sha256(raw),
      familyId: familyId ?? crypto.randomUUID(),
      deviceLabel: (req.headers["user-agent"] || "unknown").slice(0, 255),
      ip: req.ip,
      userAgent: (req.headers["user-agent"] || "").slice(0, 255),
      expiresAt,
    },
  });
  setRefreshCookie(res, raw);
  return row;
};

const logLogin = (outcome, req, userId, emailAttempted) =>
  prisma.loginActivity.create({
    data: {
      userId: userId ?? null,
      emailAttempted,
      outcome,
      ip: req.ip,
      userAgent: (req.headers["user-agent"] || "").slice(0, 255),
    },
  });

/* ─────────────────────────── POST /login ─────────────────────────── */
// WORKFLOW §8. Generic failure shape + constant-time path prevents enumeration.
export const login = catchAsync(async (req, res, next) => {
  const { email, password } = req.body;
  const invalid = () => next(new AppError("Invalid email or password", 401));

  const user = await prisma.user.findUnique({ where: { email } });

  if (!user) {
    await bcrypt.compare(password, DUMMY_HASH); // keep timing constant
    await logLogin("invalid_credentials", req, null, email);
    return invalid();
  }

  if (user.lockedUntil && user.lockedUntil > new Date()) {
    await logLogin("locked", req, user.id, email);
    return invalid();
  }

  const ok = user.passwordHash ? await bcrypt.compare(password, user.passwordHash) : false;

  if (!ok || !user.isActive) {
    // Deactivated account returns the SAME shape as a bad password (EDGE-A-01).
    if (!ok) {
      const failed = user.failedLoginCount + 1;
      await prisma.user.update({
        where: { id: user.id },
        data: {
          failedLoginCount: failed,
          lockedUntil: failed >= MAX_FAILED ? new Date(Date.now() + LOCK_MINUTES * 60000) : null,
        },
      });
    }
    await logLogin(ok ? "inactive" : "invalid_credentials", req, user.id, email);
    return invalid();
  }

  await prisma.$transaction(async (tx) => {
    await issueRefreshSession(tx, res, user.id, null, req);
    await tx.user.update({
      where: { id: user.id },
      data: { lastLoginAt: new Date(), failedLoginCount: 0, lockedUntil: null },
    });
    await tx.loginActivity.create({
      data: {
        userId: user.id,
        emailAttempted: email,
        outcome: "success",
        ip: req.ip,
        userAgent: (req.headers["user-agent"] || "").slice(0, 255),
      },
    });
  });

  res.json({
    success: true,
    message: "Login successful",
    accessToken: signAccessToken(user),
    user: publicUser(user),
    permissions: getPermissionsForRoles(rolesOf(user)),
  });
});

/* ─────────────────────────── POST /register ─────────────────────────── */
/**
 * Customer self-registration (CRM_MASTER §5.16/§5.20) — the storefront's
 * "Get a quote" gate. One act creates the company, its primary contact, the
 * customer record (source `direct`) and the portal login, then signs the user
 * straight in so they can raise their request immediately.
 *
 * SECURITY: a self-signup NEVER attaches to an existing customer, even when the
 * company name matches — that would hand a stranger another company's shipments
 * and invoices. A duplicate name creates a separate record and raises a
 * `customer.registered` event carrying `possibleDuplicate` so Sales can verify
 * and merge deliberately.
 */
export const register = catchAsync(async (req, res, next) => {
  // Honeypot: a bot filling the hidden field gets a plausible success, no row.
  if (req.body.fax) {
    return res.status(201).json({ success: true, message: "Account created" });
  }

  const { email, password, contactName, phone, position, companyName } = req.body;

  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) {
    return next(new AppError("An account with this email already exists — please sign in instead", 409));
  }

  // Hash outside the transaction — bcrypt(12) is deliberately slow.
  const passwordHash = await bcrypt.hash(password, 12);
  const normalizedName = companyName.trim().toLowerCase().replace(/\s+/g, " ");

  // Flagged for Sales review; never auto-linked (see SECURITY note above).
  const duplicates = await prisma.company.findMany({
    where: { normalizedName },
    select: { id: true, name: true },
  });

  const { user, customer } = await prisma.$transaction(async (tx) => {
    const company = await tx.company.create({
      data: {
        name: companyName.trim(),
        normalizedName,
        country: req.body.country ?? null,
        city: req.body.city ?? null,
        address: req.body.address ?? null,
        industry: req.body.industry ?? null,
        website: req.body.website ?? null,
      },
    });

    const contact = await tx.contact.create({
      data: {
        companyId: company.id,
        name: contactName.trim(),
        email,
        phone,
        position: position ?? null,
        isPrimary: true, // first contact on a new company (INV-05)
      },
    });

    const referenceNo = await allocateRef(tx, "customer");
    const createdCustomer = await tx.customer.create({
      data: {
        referenceNo,
        companyId: company.id,
        source: "direct", // self-service front door (§5.4)
        // assignedBdoId stays null until Sales picks it up.
      },
    });

    const createdUser = await tx.user.create({
      data: {
        email,
        passwordHash,
        role: "customer",
        roles: ["customer"],
        customerId: createdCustomer.id,
        isActive: true, // self-set password — no activation round-trip needed
      },
    });

    await tx.outboxEvent.create({
      data: {
        eventType: "customer.registered",
        payload: {
          customerId: createdCustomer.id,
          customerRef: referenceNo,
          companyName: company.name,
          contactName: contact.name,
          email,
          phone,
          possibleDuplicate: duplicates.length ? duplicates.map((d) => d.name) : undefined,
        },
        correlationId: crypto.randomUUID(),
      },
    });

    // Sign in immediately — same session machinery as /login.
    await issueRefreshSession(tx, res, createdUser.id, null, req);
    await tx.loginActivity.create({
      data: {
        userId: createdUser.id,
        emailAttempted: email,
        outcome: "success",
        ip: req.ip,
        userAgent: (req.headers["user-agent"] || "").slice(0, 255),
      },
    });

    return { user: createdUser, customer: createdCustomer };
  });

  res.status(201).json({
    success: true,
    message: `Welcome to Consort — your account ${customer.referenceNo} is ready`,
    accessToken: signAccessToken(user),
    user: publicUser(user),
    permissions: getPermissionsForRoles(rolesOf(user)),
  });
});

/* ─────────────────────────── POST /refresh ─────────────────────────── */
// Rotation + reuse detection (ADR-009, EDGE-A-02).
export const refresh = catchAsync(async (req, res, next) => {
  const raw = readCookie(req, REFRESH_COOKIE);
  if (!raw) return next(new AppError("No refresh session", 401));

  const existing = await prisma.refreshToken.findUnique({ where: { tokenHash: sha256(raw) } });
  if (!existing) {
    clearRefreshCookie(res);
    return next(new AppError("Invalid refresh session", 401));
  }

  // A revoked-but-presented token means the token was replayed → kill the family.
  if (existing.revokedAt) {
    await prisma.refreshToken.updateMany({
      where: { familyId: existing.familyId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    clearRefreshCookie(res);
    return next(new AppError("Refresh reuse detected, sessions revoked", 401));
  }

  if (existing.expiresAt < new Date()) {
    clearRefreshCookie(res);
    return next(new AppError("Refresh session expired", 401));
  }

  const user = await prisma.user.findUnique({ where: { id: existing.userId } });
  if (!user || !user.isActive) {
    clearRefreshCookie(res);
    return next(new AppError("Account inactive", 401));
  }

  await prisma.$transaction(async (tx) => {
    const rotated = await issueRefreshSession(tx, res, user.id, existing.familyId, req);
    await tx.refreshToken.update({
      where: { id: existing.id },
      data: { revokedAt: new Date(), replacedById: rotated.id },
    });
  });

  res.json({
    success: true,
    accessToken: signAccessToken(user),
    user: publicUser(user),
    permissions: getPermissionsForRoles(rolesOf(user)),
  });
});

/* ─────────────────────────── POST /logout ─────────────────────────── */
export const logout = catchAsync(async (req, res) => {
  const raw = readCookie(req, REFRESH_COOKIE);
  if (raw) {
    await prisma.refreshToken.updateMany({
      where: { tokenHash: sha256(raw), revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }
  clearRefreshCookie(res);
  res.json({ success: true, message: "Logged out" });
});

/* ─────────────────────────── POST /logout-all ─────────────────────────── */
// Bumping token_version invalidates every access token instantly (ADR-009).
export const logoutAll = catchAsync(async (req, res) => {
  await prisma.$transaction([
    prisma.refreshToken.updateMany({
      where: { userId: req.user.id, revokedAt: null },
      data: { revokedAt: new Date() },
    }),
    prisma.user.update({
      where: { id: req.user.id },
      data: { tokenVersion: { increment: 1 } },
    }),
  ]);
  clearRefreshCookie(res);
  res.json({ success: true, message: "All sessions revoked" });
});

/* ─────────────────────────── GET /me ─────────────────────────── */
export const me = catchAsync(async (req, res) => {
  res.json({
    success: true,
    user: publicUser(req.user),
    permissions: req.user.permissions,
  });
});

/* ─────────────────────────── GET /sessions ─────────────────────────── */
// Multi-device visibility (ADR-033). The current device is flagged.
export const listSessions = catchAsync(async (req, res) => {
  const currentRaw = readCookie(req, REFRESH_COOKIE);
  const currentHash = currentRaw ? sha256(currentRaw) : null;

  const sessions = await prisma.refreshToken.findMany({
    where: { userId: req.user.id, revokedAt: null, expiresAt: { gt: new Date() } },
    orderBy: { createdAt: "desc" },
    select: { id: true, deviceLabel: true, ip: true, createdAt: true, expiresAt: true, tokenHash: true },
  });

  res.json({
    success: true,
    data: sessions.map((s) => ({
      id: s.id,
      deviceLabel: s.deviceLabel,
      ip: s.ip,
      createdAt: s.createdAt,
      expiresAt: s.expiresAt,
      current: s.tokenHash === currentHash,
    })),
  });
});

/* ─────────────────────────── DELETE /sessions/:id ─────────────────────────── */
export const revokeSession = catchAsync(async (req, res, next) => {
  const session = await prisma.refreshToken.findUnique({ where: { id: req.params.id } });
  if (!session || session.userId !== req.user.id) {
    return next(new AppError("Session not found", 404));
  }
  await prisma.refreshToken.update({
    where: { id: session.id },
    data: { revokedAt: new Date() },
  });
  res.json({ success: true, message: "Session revoked" });
});

/* ─────────────────────────── GET /login-activity ─────────────────────────── */
export const loginActivity = catchAsync(async (req, res) => {
  // Management sees everyone; everyone else sees their own trail.
  const where = isManagement(req.user) ? {} : { userId: req.user.id };
  const data = await prisma.loginActivity.findMany({
    where,
    orderBy: { createdAt: "desc" },
    take: 100,
    select: { id: true, userId: true, emailAttempted: true, outcome: true, ip: true, createdAt: true },
  });
  res.json({ success: true, data });
});

/* ─────────────────────────── POST /activate ─────────────────────────── */
// Account activation by hashed single-use token (CRM_MASTER §5.1, RULE-EMP-01).
export const activate = catchAsync(async (req, res, next) => {
  const { token, password } = req.body;
  const record = await prisma.activationToken.findUnique({ where: { tokenHash: sha256(token) } });

  if (!record || record.purpose !== "activation" || record.usedAt || record.expiresAt < new Date()) {
    return next(new AppError("Invalid or expired activation link", 400));
  }

  const hash = await bcrypt.hash(password, 12);
  await prisma.$transaction([
    prisma.user.update({
      where: { id: record.userId },
      data: { passwordHash: hash, isActive: true },
    }),
    prisma.activationToken.update({ where: { id: record.id }, data: { usedAt: new Date() } }),
  ]);

  res.json({ success: true, message: "Account activated. You can sign in now." });
});

/* ─────────────────────────── POST /forgot-password ─────────────────────────── */
// Always 200 — never reveal whether the email exists (no enumeration).
export const forgotPassword = catchAsync(async (req, res) => {
  const { email } = req.body;
  const user = await prisma.user.findUnique({ where: { email } });

  if (user) {
    const raw = crypto.randomBytes(32).toString("base64url");
    await prisma.activationToken.create({
      data: {
        userId: user.id,
        tokenHash: sha256(raw),
        purpose: "password_reset",
        expiresAt: new Date(Date.now() + 60 * 60 * 1000), // 1 hour
      },
    });
    // Notifications module (email) would deliver the link; token is returned in
    // non-production so the flow is testable end-to-end without a mail server.
    if (!IS_PROD) {
      return res.json({ success: true, message: "Reset link generated", devResetToken: raw });
    }
  }

  res.json({ success: true, message: "If that email exists, a reset link has been sent." });
});

/* ─────────────────────────── POST /reset-password ─────────────────────────── */
export const resetPassword = catchAsync(async (req, res, next) => {
  const { token, password } = req.body;
  const record = await prisma.activationToken.findUnique({ where: { tokenHash: sha256(token) } });

  if (!record || record.purpose !== "password_reset" || record.usedAt || record.expiresAt < new Date()) {
    return next(new AppError("Invalid or expired reset link", 400));
  }

  const hash = await bcrypt.hash(password, 12);
  await prisma.$transaction([
    prisma.user.update({
      where: { id: record.userId },
      // Bump token_version + kill refresh sessions so a reset logs out every device.
      data: { passwordHash: hash, tokenVersion: { increment: 1 } },
    }),
    prisma.activationToken.update({ where: { id: record.id }, data: { usedAt: new Date() } }),
    prisma.refreshToken.updateMany({
      where: { userId: record.userId, revokedAt: null },
      data: { revokedAt: new Date() },
    }),
  ]);

  res.json({ success: true, message: "Password reset. Please sign in." });
});

/* ─────────────────────────── POST /bootstrap-admin ─────────────────────────── */
// Convenience only: create the first Management/HR login so the system can be
// entered before the Employee Management module exists. Guarded by the shared
// secret, and refuses once any internal (non-customer) user is present.
export const bootstrapAdmin = catchAsync(async (req, res, next) => {
  const secret = req.headers["x-admin-secret"];
  if (!secret || secret !== process.env.SUPER_ADMIN_SECRET) {
    return next(new AppError("Unauthorized", 403));
  }

  const internalExists = await prisma.user.findFirst({ where: { role: { not: "customer" } } });
  if (internalExists) {
    return next(new AppError("Bootstrap already completed — use the app to add users", 409));
  }

  const { email, password, role } = req.body;
  if (!isManagement(role) && role !== "hr") {
    return next(new AppError("Bootstrap role must be Management or HR", 400));
  }

  const exists = await prisma.user.findUnique({ where: { email } });
  if (exists) return next(new AppError("User already exists", 409));

  const passwordHash = await bcrypt.hash(password, 12);
  const user = await prisma.user.create({
    data: { email, passwordHash, role, roles: [role], isActive: true },
  });

  res.status(201).json({
    success: true,
    message: "Bootstrap account created",
    user: publicUser(user),
  });
});

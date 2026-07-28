import express from "express";
import rateLimit, { ipKeyGenerator } from "express-rate-limit";
import {
  login,
  register,
  refresh,
  logout,
  logoutAll,
  me,
  listSessions,
  revokeSession,
  loginActivity,
  activate,
  forgotPassword,
  resetPassword,
  bootstrapAdmin,
} from "./auth.controllers.js";
import { protect } from "./auth.middleware.js";
import { validate } from "../../middleware/validate.middleware.js";
import {
  loginSchema,
  registerSchema,
  activateSchema,
  forgotPasswordSchema,
  resetPasswordSchema,
  bootstrapAdminSchema,
} from "./auth.validation.js";

const router = express.Router();

// Stricter brute-force guard on credential endpoints, keyed by IP + email
// (ADR-033). Complements the DB-level account lockout. Successful logins don't
// count toward the limit.
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  skipSuccessfulRequests: true,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => `${ipKeyGenerator(req.ip)}:${(req.body?.email ?? "").toLowerCase()}`,
  message: { success: false, message: "Too many attempts — try again in 15 minutes." },
});

// Self-registration creates real customer records, so it is capped per IP —
// stricter than login because there is no account to lock out (§5.20).
const registerLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => ipKeyGenerator(req.ip),
  message: { success: false, message: "Too many sign-up attempts — please try again later." },
});

/* ── Public ── */
router.post("/login", authLimiter, validate(loginSchema), login);
router.post("/register", registerLimiter, validate(registerSchema), register);
router.post("/refresh", refresh); // reads the HttpOnly cookie, not the body
router.post("/activate", validate(activateSchema), activate);
router.post("/forgot-password", authLimiter, validate(forgotPasswordSchema), forgotPassword);
router.post("/reset-password", authLimiter, validate(resetPasswordSchema), resetPassword);
router.post("/bootstrap-admin", validate(bootstrapAdminSchema), bootstrapAdmin);

/* ── Authenticated ── */
router.post("/logout", protect, logout);
router.post("/logout-all", protect, logoutAll);
router.get("/me", protect, me);
router.get("/sessions", protect, listSessions);
router.delete("/sessions/:id", protect, revokeSession);
router.get("/login-activity", protect, loginActivity);

export default router;

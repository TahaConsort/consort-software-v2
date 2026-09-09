import express from "express";
import rateLimit, { ipKeyGenerator } from "express-rate-limit";
import { validate } from "../../middleware/validate.middleware.js";
import { publicDecisionSchema } from "./approval.validation.js";
import { decideApproval, viewApproval } from "./approval.controllers.js";

/**
 * Anonymous customer approval (ADR-055). Mounted at /api/public alongside the
 * storefront — NO auth, the token in the path is the whole credential.
 *
 * Rate limited hard. The token is 256 bits so brute force is not a real threat, but a
 * limiter keeps a scripted hunt from costing anything and caps the damage if a token
 * ever does leak into a crawler.
 */
const router = express.Router();

const viewLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 60,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => ipKeyGenerator(req.ip),
  message: { success: false, message: "Too many requests — please wait a moment and try again." },
});

/**
 * Deciding is once-per-link by construction, so one customer needs exactly one call.
 * The cap is nonetheless well above that: a whole office, or everyone on one ISP's
 * CGNAT, shares a single source IP, and a tight limit would lock out real customers
 * approving legitimately. Token entropy (256 bits) is what actually stops guessing —
 * 30 attempts per quarter-hour is nowhere near it — so this only caps scripted noise.
 */
const decideLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => ipKeyGenerator(req.ip),
  message: { success: false, message: "Too many attempts — please wait a few minutes and try again." },
});

router.get("/approvals/:token", viewLimiter, viewApproval);
router.post("/approvals/:token/decision", decideLimiter, validate(publicDecisionSchema), decideApproval);

export default router;

import express from "express";
import rateLimit, { ipKeyGenerator } from "express-rate-limit";
import { validate } from "../../middleware/validate.middleware.js";
import { rateQuoteSchema, inquirySchema } from "./storefront.validation.js";
import { getLoadBoard, getReference, rateQuote, submitInquiry } from "./storefront.controllers.js";

/**
 * Public storefront (CRM_MASTER §5.20) — ANONYMOUS, no auth. Mounted at
 * /api/public. Write endpoints carry a dedicated per-IP limiter on top of the
 * global one so an abusive client cannot flood the inquiry inbox.
 */
const router = express.Router();

// Compute endpoint — a little looser (visitors iterate on the calculator).
const computeLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 60,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => ipKeyGenerator(req.ip),
  message: { success: false, message: "Too many rate calculations — please slow down." },
});

// Inquiry submission — strict (this creates rows a human must triage).
const inquiryLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => ipKeyGenerator(req.ip),
  message: { success: false, message: "Too many requests — please try again later." },
});

router.get("/loadboard", getLoadBoard);
router.get("/reference", getReference);
router.post("/rate-quote", computeLimiter, validate(rateQuoteSchema), rateQuote);
router.post("/inquiries", inquiryLimiter, validate(inquirySchema), submitInquiry);

export default router;

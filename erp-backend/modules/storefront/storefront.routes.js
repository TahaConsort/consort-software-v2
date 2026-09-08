import express from "express";
import rateLimit, { ipKeyGenerator } from "express-rate-limit";
import { validate } from "../../middleware/validate.middleware.js";
import { rateQuoteSchema } from "./storefront.validation.js";
import { getLoadBoard, getReference, rateQuote } from "./storefront.controllers.js";

/**
 * Public storefront (CRM_MASTER §5.20) — ANONYMOUS, no auth. Mounted at
 * /api/public. Read/compute only: the load board, the reference lists and the
 * rate calculator. Sending an actual request needs an account, so it goes
 * through POST /api/queries once the visitor has signed in or signed up.
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

router.get("/loadboard", getLoadBoard);
router.get("/reference", getReference);
router.post("/rate-quote", computeLimiter, validate(rateQuoteSchema), rateQuote);

export default router;

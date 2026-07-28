// app.js
import express from "express";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import cors from "cors";
import authRoutes from "./modules/auth/auth.routes.js";
import employeeRoutes from "./modules/employee/employee.routes.js";
import { companyRouter, customerRouter } from "./modules/company/company.routes.js";
import leadRoutes from "./modules/lead/lead.routes.js";
import outreachRoutes from "./modules/outreach/outreach.routes.js";
import visitRoutes from "./modules/visit/visit.routes.js";
import queryRoutes from "./modules/query/query.routes.js";
import serviceRoutes from "./modules/service/service.routes.js";
import quotationRoutes from "./modules/quotation/quotation.routes.js";
import shipmentRoutes from "./modules/shipment/shipment.routes.js";
import otdRoutes from "./modules/otd/otd.routes.js";
import otcRoutes from "./modules/otc/otc.routes.js";
import taskRoutes from "./modules/task/task.routes.js";
import financeRoutes from "./modules/finance/finance.routes.js";
import documentRoutes from "./modules/document/document.routes.js";
import chatRoutes from "./modules/chat/chat.routes.js";
import dashboardRoutes from "./modules/dashboard/dashboard.routes.js";
import notificationRoutes from "./modules/notification/notification.routes.js";
import actionRoutes from "./modules/action/action.routes.js";
import reportRoutes from "./modules/report/report.routes.js";
import auditRoutes from "./modules/audit/audit.routes.js";
import storefrontRoutes from "./modules/storefront/storefront.routes.js";
import loadboardRoutes from "./modules/loadboard/loadboard.routes.js";
import inquiryRoutes from "./modules/inquiry/inquiry.routes.js";
import lcInboxRoutes, { webhookRouter } from "./modules/lc/lc.routes.js";
import vendorRoutes from "./modules/vendor/vendor.routes.js";
import chargeRoutes from "./modules/charge/charge.routes.js";
import { globalErrorHandler } from "./utils/AppError.js";
import { AppError } from "./utils/AppError.js";

const app = express();

// Set security HTTP headers
app.use(helmet());

// Cors
app.use(
  cors({
    origin: [
      "https://consort-erp-client.vercel.app",
      "http://192.168.50.26:5173",
      "http://localhost:5173",
      "http://127.0.0.1:5173",
    ],
    methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS", "PATCH"],
    allowedHeaders: ["Content-Type", "Authorization", "x-admin-secret", "x-webhook-secret", "x-cron-secret", "If-Match"],
    credentials: true,
  }),
);

// Middleware
app.use(express.json());

// Bank LC intake webhook (CRM_MASTER §5.21) — mounted BEFORE the generic IP
// limiter so a partner bank posting from a single IP is not throttled; it is
// protected by its own shared-secret + idempotency instead.
app.use("/api/webhooks", webhookRouter);

// // Limit requests from same API
// const limiter = rateLimit({
//   max: 100, // Limit each IP to 100 requests per window (here, per 15 minutes)
//   windowMs: 15 * 60 * 1000,
//   // JSON shape so the client's error normaliser can surface a readable message.
//   message: { success: false, message: "Too many requests — please wait a moment and try again." },
// });
// app.use("/api", limiter);

// Serverless background-work drain (ADR-021): on Vercel the relay/scheduler have
// no resident process, so an external cron hits this with the CRON_SECRET to
// dispatch the outbox and run the sweeps. No-op guard when the secret is unset.
app.post("/api/internal/cron", async (req, res, next) => {
  try {
    if (!process.env.CRON_SECRET || req.headers["x-cron-secret"] !== process.env.CRON_SECRET) {
      return res.status(401).json({ success: false, message: "Unauthorized" });
    }
    const { drainOutboxOnce } = await import("./jobs/outboxRelay.js");
    const { runSweepsOnce } = await import("./jobs/scheduler.js");
    await drainOutboxOnce();
    await runSweepsOnce();
    res.json({ success: true, message: "Drained outbox and ran sweeps" });
  } catch (err) {
    next(err);
  }
});

// Module Routes
app.use("/api/auth", authRoutes);
app.use("/api/employees", employeeRoutes);
app.use("/api/companies", companyRouter);
app.use("/api/customers", customerRouter);
app.use("/api/leads", leadRoutes);
app.use("/api/outreach", outreachRoutes);
app.use("/api/visits", visitRoutes);
app.use("/api/queries", queryRoutes);
app.use("/api/services", serviceRoutes);
app.use("/api/quotations", quotationRoutes);
app.use("/api/shipments", shipmentRoutes);
app.use("/api/otd", otdRoutes);
app.use("/api/otc", otcRoutes);
app.use("/api/tasks", taskRoutes);
app.use("/api/finance", financeRoutes);
app.use("/api/vendors", vendorRoutes);
app.use("/api/charges", chargeRoutes);
app.use("/api/documents", documentRoutes);
app.use("/api/chat", chatRoutes);
app.use("/api/dashboard", dashboardRoutes);
app.use("/api/notifications", notificationRoutes);
app.use("/api/action-engine", actionRoutes);
app.use("/api/reports", reportRoutes);
app.use("/api/audit", auditRoutes);

// Intake channels & public storefront (CRM_MASTER §5.20/§5.21)
app.use("/api/public", storefrontRoutes); // anonymous: load board + rate calc + inquiry
app.use("/api/loadboard", loadboardRoutes); // internal: posting management
app.use("/api/inquiries", inquiryRoutes); // internal: direct-channel triage
app.use("/api/lc-referrals", lcInboxRoutes); // internal: bank-LC inbox

// Unhandled route fallback
app.use((req, res, next) => {
  next(new AppError(`Can't find ${req.originalUrl} on this server!`, 404));
});

// Global Error Handling Middleware
app.use(globalErrorHandler);

export default app;

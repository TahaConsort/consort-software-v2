import crypto from "crypto";
import prisma from "../../config/prisma.js";
import { catchAsync } from "../../utils/catchAsync.js";
import { allocateRef } from "../../utils/referenceNumber.js";
import { computeRateQuote } from "../rate/rate.service.js";
import { listPublicPostings } from "../loadboard/loadboard.service.js";

/**
 * Public storefront (CRM_MASTER §5.20) — the anonymous front door and the
 * concrete intake for the *direct* channel (§5.4). No authentication; the load
 * board and rate calculator are read/compute-only, and "request a quote"
 * creates a Public Inquiry for Sales to triage (WORKFLOW §2b/§8a).
 */

const emitEvent = (tx, eventType, payload) =>
  tx.outboxEvent.create({ data: { eventType, payload, correlationId: crypto.randomUUID() } });

const SERVICE_CATALOG = [
  { code: "local_transport", label: "Local Transport / Inland", department: "Transport" },
  { code: "customs_clearance", label: "Customs Clearance", department: "Compliance" },
  { code: "sea_freight", label: "Sea Freight (Ocean)", department: "Operations" },
  { code: "port_handling", label: "Port Handling / Terminal", department: "Operations / Transport" },
  { code: "lc_finance", label: "LC / Trade Finance", department: "Finance" },
  { code: "destination_services", label: "Destination Services / Agent", department: "Operations" },
];

/* ── GET /api/public/loadboard ── */
export const getLoadBoard = catchAsync(async (req, res) => {
  const { mode, originPort, destinationPort, service } = req.query;
  const data = await listPublicPostings({ mode, originPort, destinationPort, service });
  res.json({ success: true, data });
});

/* ── GET /api/public/reference ── (ports, container types, service catalog) */
export const getReference = catchAsync(async (req, res) => {
  const [ports, containerTypes] = await Promise.all([
    prisma.port.findMany({ orderBy: { name: "asc" } }),
    prisma.containerType.findMany({ orderBy: { code: "asc" } }),
  ]);
  res.json({ success: true, data: { ports, containerTypes, services: SERVICE_CATALOG } });
});

/* ── POST /api/public/rate-quote ── (indicative, nothing persisted) */
export const rateQuote = catchAsync(async (req, res) => {
  const estimate = await computeRateQuote(req.body);
  res.json({ success: true, data: estimate });
});

/* ── POST /api/public/inquiries ── (request a quote → Sales triage inbox) */
export const submitInquiry = catchAsync(async (req, res) => {
  // Honeypot: a bot filling the hidden field gets a fake-success and no row.
  if (req.body.website) {
    return res.status(201).json({ success: true, message: "Thanks — we'll be in touch shortly." });
  }

  const b = req.body;
  const sourceIp = (req.headers["x-forwarded-for"]?.split(",")[0] || req.ip || "").slice(0, 60);

  const inquiry = await prisma.$transaction(async (tx) => {
    const referenceNo = await allocateRef(tx, "inquiry");
    const created = await tx.publicInquiry.create({
      data: {
        referenceNo,
        contactName: b.contactName,
        contactEmail: b.contactEmail,
        contactPhone: b.contactPhone ?? null,
        companyName: b.companyName ?? null,
        message: b.message ?? null,
        services: b.services,
        originPort: b.originPort ?? null,
        destinationPort: b.destinationPort ?? null,
        containerTypeCode: b.containerTypeCode ?? null,
        incoterm: b.incoterm ?? null,
        cargoDescription: b.cargoDescription ?? null,
        weightKg: b.weightKg ?? null,
        isHazardous: !!b.isHazardous,
        isReefer: !!b.isReefer,
        estimatedAmount: b.estimatedAmount ?? null,
        estimateCurrency: b.estimateCurrency ?? null,
        loadBoardPostingId: b.loadBoardPostingId ?? null,
        sourceIp: sourceIp || null,
      },
    });
    await emitEvent(tx, "inquiry.received", {
      inquiryId: created.id,
      referenceNo,
      companyName: created.companyName,
      services: created.services,
    });
    return created;
  });

  res.status(201).json({
    success: true,
    message: "Thanks — your request has been received. Our team will be in touch shortly.",
    data: { referenceNo: inquiry.referenceNo },
  });
});

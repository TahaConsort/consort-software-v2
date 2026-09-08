import prisma from "../../config/prisma.js";
import { catchAsync } from "../../utils/catchAsync.js";
import { computeRateQuote } from "../rate/rate.service.js";
import { listPublicPostings } from "../loadboard/loadboard.service.js";

/**
 * Public storefront (CRM_MASTER §5.20) — the anonymous front door for the
 * *direct* channel (§5.4). No authentication and nothing is persisted here: the
 * load board and reference lists are reads, the rate calculator is a pure
 * computation. Actually sending a request needs a customer account behind it,
 * so it goes through POST /api/queries after the visitor signs in or signs up.
 */

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


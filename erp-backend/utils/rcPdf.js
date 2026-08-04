import fs from "fs";
import path from "path";
import crypto from "crypto";
import { UPLOAD_ROOT, ensureDir } from "../modules/document/document.service.js";
import { DEFAULT_CURRENCY } from "./currency.js";

/**
 * Rate Confirmation (RC) renderers — the document that locks a rate the way the
 * business actually locks it: one per side of the deal.
 *
 *   renderVendorRcPdf    the BUY side — "Consort confirms it will pay you X for this
 *                        job/leg". Generated on demand from an AWARDED vendor quote,
 *                        attached to the vendor's documents (master-data owner type,
 *                        internal-only by construction) and WhatsApped by ops.
 *
 *   renderCustomerRcPdf  the SELL side — "you confirmed our rate of Y". Generated at
 *                        quotation approval and attached to the shipment with docType
 *                        `rate_confirmation`, which satisfies the order_lock step's
 *                        RC requirement the same way the quotation PDF satisfies its
 *                        own checklist item.
 *
 * PRIVACY — same rule as lib/rfqMessage.js: the vendor RC never carries the customer
 * name or any sell price; the customer RC never carries a cost, a vendor, or a margin.
 * The customer RC prints only description/quantity/unitPrice/amount, so it stays safe
 * to publish (INV-10) by construction.
 */

const money = (n, ccy) =>
  `${ccy} ${Number(n ?? 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const fmtDate = (d) =>
  d ? new Date(d).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" }) : "—";

const LEG_LABELS = {
  first_mile: "First mile — pickup to rail terminal (by truck)",
  middle_mile: "Middle mile — rail, terminal to terminal",
  last_mile: "Last mile — rail terminal to delivery (by truck)",
};

// The stretch of road (or track) this RC pays for. Falls back through the query's
// address vocabulary the same way rfqMessage does.
const routeForLeg = (leg, query = {}) => {
  const pickup = query.pickupAddress || query.senderAddress;
  const delivery = query.deliveryAddress || query.receiverAddress;
  switch (leg) {
    case "first_mile":
      return [pickup, query.originRailTerminal].filter(Boolean).join("  →  ");
    case "middle_mile":
      return [query.originRailTerminal, query.destinationRailTerminal].filter(Boolean).join("  →  ");
    case "last_mile":
      return [query.destinationRailTerminal, delivery].filter(Boolean).join("  →  ");
    default:
      return (
        [query.originPort, query.destinationPort].filter(Boolean).join("  →  ") ||
        [pickup, delivery].filter(Boolean).join("  →  ")
      );
  }
};

const loadPdfKit = async () => {
  try {
    const { default: PDFDocument } = await import("pdfkit");
    return PDFDocument;
  } catch {
    return null; // dependency missing — callers fall back (best-effort or 503)
  }
};

const renderToFile = async (PDFDocument, storageKey, draw) => {
  ensureDir();
  const absPath = path.join(UPLOAD_ROOT, storageKey);
  await new Promise((resolve, reject) => {
    const doc = new PDFDocument({ margin: 48, size: "A4" });
    const out = fs.createWriteStream(absPath);
    out.on("finish", resolve);
    out.on("error", reject);
    doc.on("error", reject);
    doc.pipe(out);
    draw(doc);
    doc.end();
  });
  const buf = await fs.promises.readFile(absPath);
  return {
    storageKey,
    mimeType: "application/pdf",
    sizeBytes: buf.length,
    checksum: crypto.createHash("sha256").update(buf).digest("hex"),
  };
};

// Shared charge table (description / qty / unit / amount).
const drawChargeTable = (doc, left, lines, total, ccy) => {
  const cols = [left, left + 250, left + 320, left + 400];
  doc.font("Helvetica-Bold").fontSize(9);
  doc.text("Description", cols[0], doc.y, { continued: false });
  const headerY = doc.y - doc.currentLineHeight();
  doc.text("Qty", cols[1], headerY);
  doc.text("Unit", cols[2], headerY);
  doc.text("Amount", cols[3], headerY);
  doc.moveTo(left, doc.y + 2).lineTo(left + 470, doc.y + 2).strokeColor("#999").stroke();
  doc.moveDown(0.5);

  doc.font("Helvetica").fontSize(9);
  const sorted = [...(lines ?? [])].sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0));
  for (const l of sorted) {
    const y = doc.y;
    doc.text(String(l.description ?? ""), cols[0], y, { width: 240 });
    const rowBottom = doc.y;
    doc.text(String(Number(l.quantity ?? 1)), cols[1], y);
    doc.text(money(l.unitPrice, ccy), cols[2], y, { width: 70 });
    doc.text(money(l.amount, ccy), cols[3], y, { width: 90 });
    doc.y = Math.max(rowBottom, doc.y);
    doc.moveDown(0.2);
  }
  if (!sorted.length) doc.text("No charge lines.", cols[0], doc.y);

  doc.moveDown(0.4);
  doc.moveTo(left, doc.y).lineTo(left + 470, doc.y).strokeColor("#999").stroke();
  doc.moveDown(0.4);
  doc.font("Helvetica-Bold").fontSize(10);
  doc.text("Agreed total", cols[2], doc.y, { continued: true }).text(`   ${money(total, ccy)}`);
};

const cargoFacts = (query = {}) =>
  [
    query.containerTypeCode && `Container: ${query.containerTypeCode}`,
    query.cargoDescription && `Cargo: ${query.cargoDescription}`,
    query.weightKg != null && `Weight: ${Number(query.weightKg).toLocaleString()} kg`,
    query.incoterm && `Incoterm: ${query.incoterm}`,
  ].filter(Boolean);

/**
 * The buy-side RC: what Consort will pay the awarded vendor for this job/leg.
 * @returns { fileName, storageKey, mimeType, sizeBytes, checksum } or null when
 *          pdfkit is unavailable.
 */
export const renderVendorRcPdf = async ({ rfq, quote, vendor, query }) => {
  const PDFDocument = await loadPdfKit();
  if (!PDFDocument) return null;

  const file = await renderToFile(PDFDocument, `${crypto.randomUUID()}-vendor-rc.pdf`, (doc) => {
    const ccy = quote.currency ?? DEFAULT_CURRENCY;
    const left = doc.x;

    doc.fontSize(18).font("Helvetica-Bold").text("RATE CONFIRMATION", { align: "left" });
    doc.moveDown(0.2);
    doc.fontSize(10).font("Helvetica").fillColor("#555").text(rfq.referenceNo);
    if (rfq.leg) doc.text(LEG_LABELS[rfq.leg] ?? rfq.leg);
    doc.text(`Awarded: ${fmtDate(quote.awardedAt ?? new Date())}`);
    doc.fillColor("#000").moveDown(1);

    doc.fontSize(9).font("Helvetica-Bold").text("Carrier / Vendor");
    doc.font("Helvetica");
    doc.text(`${vendor.name}${vendor.referenceNo ? `  (${vendor.referenceNo})` : ""}`);
    if (vendor.contactName) doc.text(`Attn: ${vendor.contactName}`);
    if (vendor.phone) doc.text(`Phone: ${vendor.phone}`);
    if (vendor.address) doc.text(vendor.address);
    if (vendor.taxId) doc.text(`NTN/STRN: ${vendor.taxId}`);
    doc.moveDown(0.6);

    doc.font("Helvetica-Bold").text("Job");
    doc.font("Helvetica");
    const route = routeForLeg(rfq.leg, query);
    if (route) doc.text(`Route: ${route}`);
    for (const fact of cargoFacts(query)) doc.text(fact);
    // Door contacts, where this leg touches a door. Operational people only — the
    // paying customer's identity never appears on vendor paperwork.
    const touchesPickup = !rfq.leg || rfq.leg === "first_mile";
    const touchesDelivery = !rfq.leg || rfq.leg === "last_mile";
    if (touchesPickup && (query?.senderName || query?.senderPhone)) {
      doc.text(`Pickup contact: ${[query.senderName, query.senderPhone].filter(Boolean).join(" · ")}`);
    }
    if (touchesDelivery && (query?.receiverName || query?.receiverPhone)) {
      doc.text(`Delivery contact: ${[query.receiverName, query.receiverPhone].filter(Boolean).join(" · ")}`);
    }
    const flags = [query?.isHazardous && "HAZARDOUS / DG CARGO", query?.isReefer && "REEFER — TEMPERATURE CONTROLLED"].filter(Boolean);
    if (flags.length) doc.font("Helvetica-Bold").text(flags.join("   ·   ")).font("Helvetica");
    doc.moveDown(1);

    drawChargeTable(doc, left, quote.lines, quote.totalAmount, ccy);

    doc.moveDown(1);
    doc.font("Helvetica").fontSize(9);
    if (quote.validityDate) doc.text(`Rate valid to: ${fmtDate(quote.validityDate)}`, left, doc.y);
    doc.text(
      `Payment terms: ${vendor.paymentTermsDays != null ? `${vendor.paymentTermsDays} days from invoice` : "as agreed"}`,
      left,
      doc.y,
    );
    if (quote.notes) doc.text(`Notes: ${quote.notes}`, left, doc.y, { width: 470 });

    doc.moveDown(2);
    doc.fontSize(8).fillColor("#666")
      .text(
        "Consort Group confirms the above agreed buy rate for this job. Generated from Consort ERP.",
        left,
        doc.y,
        { width: 470 },
      );
  });

  return { fileName: `${rfq.referenceNo}${rfq.leg ? `-${rfq.leg}` : ""}-RC.pdf`, ...file };
};

/**
 * The sell-side RC: the rate the customer confirmed. Safe to publish by construction —
 * only description/quantity/unitPrice/amount are printed, never costAmount/costVendorId.
 * @returns { fileName, storageKey, mimeType, sizeBytes, checksum } or null.
 */
export const renderCustomerRcPdf = async ({ quotation, query, customer, shipmentRef }) => {
  const PDFDocument = await loadPdfKit();
  if (!PDFDocument) return null;

  const file = await renderToFile(PDFDocument, `${crypto.randomUUID()}-customer-rc.pdf`, (doc) => {
    const ccy = quotation.currency ?? DEFAULT_CURRENCY;
    const left = doc.x;

    doc.fontSize(18).font("Helvetica-Bold").text("RATE CONFIRMATION", { align: "left" });
    doc.moveDown(0.2);
    doc.fontSize(10).font("Helvetica").fillColor("#555")
      .text(`${quotation.referenceNo}${quotation.version > 1 ? `  ·  revision ${quotation.version}` : ""}`);
    if (shipmentRef) doc.text(`Shipment ${shipmentRef}`);
    doc.fillColor("#000").moveDown(1);

    doc.fontSize(9).font("Helvetica-Bold").text("Customer");
    doc.font("Helvetica").text(customer?.companyName ?? "—");
    doc.moveDown(0.6);

    // The doors, as the customer described them.
    if (query?.senderName || query?.senderAddress) {
      doc.font("Helvetica-Bold").text("Sender / Shipper");
      doc.font("Helvetica");
      const who = [query.senderName, query.senderPhone].filter(Boolean).join(" · ");
      if (who) doc.text(who);
      if (query.senderAddress) doc.text(query.senderAddress);
      doc.moveDown(0.6);
    }
    if (query?.receiverName || query?.receiverAddress) {
      doc.font("Helvetica-Bold").text("Receiver / Consignee");
      doc.font("Helvetica");
      const who = [query.receiverName, query.receiverPhone].filter(Boolean).join(" · ");
      if (who) doc.text(who);
      if (query.receiverAddress) doc.text(query.receiverAddress);
      doc.moveDown(0.6);
    }

    doc.font("Helvetica-Bold").text("Scope");
    doc.font("Helvetica");
    const lane = [query?.originPort, query?.destinationPort].filter(Boolean).join(" → ")
      || [query?.pickupAddress, query?.deliveryAddress].filter(Boolean).join(" → ");
    if (lane) doc.text(`Route: ${lane}`);
    if (query?.inlandMode === "rail") {
      doc.text(
        `Inland by rail${
          query.originRailTerminal || query.destinationRailTerminal
            ? ` via ${[query.originRailTerminal, query.destinationRailTerminal].filter(Boolean).join(" → ")}`
            : ""
        }`,
      );
    }
    for (const fact of cargoFacts(query)) doc.text(fact);
    doc.text(`Services: ${(quotation.services ?? []).join(", ") || "—"}`);
    doc.text(`Confirmed: ${fmtDate(quotation.decidedAt ?? new Date())}   ·   Valid to: ${fmtDate(quotation.validityDate)}`);
    doc.moveDown(1);

    drawChargeTable(doc, left, quotation.chargeLines, quotation.totalAmount, ccy);

    doc.moveDown(2);
    doc.font("Helvetica").fontSize(8).fillColor("#666")
      .text(
        "Agreed sell rates per the approved quotation — the order locks against this document. Generated from Consort ERP.",
        left,
        doc.y,
        { width: 470 },
      );
  });

  return { fileName: `${quotation.referenceNo}-RC.pdf`, ...file };
};

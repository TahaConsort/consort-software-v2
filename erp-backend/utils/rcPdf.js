import fs from "fs";
import path from "path";
import crypto from "crypto";
import { UPLOAD_ROOT, ensureDir } from "../modules/document/document.service.js";
import { DEFAULT_CURRENCY } from "./currency.js";

/**
 * Rate Confirmation (RC) renderer — the document that locks the rate the customer
 * confirmed.
 *
 *   renderCustomerRcPdf  the SELL side — "you confirmed our rate of Y". Generated at
 *                        quotation approval and attached to the shipment with docType
 *                        `rate_confirmation`, which satisfies the order_lock step's
 *                        RC requirement the same way the quotation PDF satisfies its
 *                        own checklist item.
 *
 * The buy-side counterpart (renderVendorRcPdf) went with the RFQ module.
 *
 * PRIVACY — the customer RC never carries a cost, a vendor, or a margin. It prints
 * only description/quantity/unitPrice/amount, so it stays safe to publish (INV-10)
 * by construction.
 */

const money = (n, ccy) =>
  `${ccy} ${Number(n ?? 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const fmtDate = (d) =>
  d ? new Date(d).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" }) : "—";

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
    if (query?.pickupAddress) {
      doc.font("Helvetica-Bold").text("Pickup");
      doc.font("Helvetica").text(query.pickupAddress);
      doc.moveDown(0.6);
    }
    if (query?.destinationAddress) {
      doc.font("Helvetica-Bold").text("Destination");
      doc.font("Helvetica").text(query.destinationAddress);
      doc.moveDown(0.6);
    }

    doc.font("Helvetica-Bold").text("Scope");
    doc.font("Helvetica");
    const lane = [query?.pickupAddress, query?.destinationAddress].filter(Boolean).join(" → ");
    if (lane) doc.text(`Route: ${lane}`);
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

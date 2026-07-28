import fs from "fs";
import path from "path";
import crypto from "crypto";
import { UPLOAD_ROOT, ensureDir } from "../modules/document/document.service.js";

/**
 * Renders the approved quotation to a PDF and stores it under `uploads/` so it can be
 * attached to the new shipment as a real document (ADR-048).
 *
 * WHY a file rather than a link: the international order-confirmation pack is a list of
 * documents, and "Quotation" is one of them. Making it a genuine `document` sub-action —
 * satisfied the same way as every other item on the checklist — means the gate has one
 * rule, not a special case. The customer is not asked to supply it: we already hold the
 * approved quote, so we render it ourselves and the item is ticked on arrival.
 *
 * SELL SIDE ONLY. `costAmount` / `costVendorId` are internal (scrubCost) and never
 * printed here — the file lands unpublished (INV-10), but it must stay safe to publish.
 */

const money = (n, ccy) =>
  `${ccy} ${Number(n ?? 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const fmtDate = (d) =>
  d ? new Date(d).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" }) : "—";

/**
 * @returns { fileName, storageKey, mimeType, sizeBytes, checksum } ready for a
 *          Document row, or null if pdfkit is unavailable (generation is best-effort —
 *          see the note at the call site).
 */
export const renderQuotationPdf = async ({ quotation, query, customer, shipmentRef }) => {
  let PDFDocument;
  try {
    ({ default: PDFDocument } = await import("pdfkit"));
  } catch {
    return null; // dependency missing — the caller falls back to a manual upload
  }

  ensureDir();
  const storageKey = `${crypto.randomUUID()}-quotation.pdf`;
  const absPath = path.join(UPLOAD_ROOT, storageKey);

  await new Promise((resolve, reject) => {
    const doc = new PDFDocument({ margin: 48, size: "A4" });
    const out = fs.createWriteStream(absPath);
    out.on("finish", resolve);
    out.on("error", reject);
    doc.on("error", reject);
    doc.pipe(out);

    const ccy = quotation.currency ?? "USD";

    doc.fontSize(18).font("Helvetica-Bold").text("QUOTATION", { align: "left" });
    doc.moveDown(0.2);
    doc.fontSize(10).font("Helvetica").fillColor("#555")
      .text(`${quotation.referenceNo}${quotation.version > 1 ? `  ·  revision ${quotation.version}` : ""}`);
    if (shipmentRef) doc.text(`Shipment ${shipmentRef}`);
    doc.fillColor("#000").moveDown(1);

    // Parties + lane
    const left = doc.x;
    doc.fontSize(9).font("Helvetica-Bold").text("Customer");
    doc.font("Helvetica").text(customer?.companyName ?? "—");
    if (query?.customerRef) doc.text(`Customer ref: ${query.customerRef}`);
    doc.moveDown(0.6);

    doc.font("Helvetica-Bold").text("Scope");
    doc.font("Helvetica");
    const lane = [query?.originPort, query?.destinationPort].filter(Boolean).join(" → ")
      || [query?.pickupAddress, query?.deliveryAddress].filter(Boolean).join(" → ");
    if (lane) doc.text(`Route: ${lane}`);
    if (query?.incoterm) doc.text(`Incoterm: ${query.incoterm}`);
    doc.text(`Services: ${(quotation.services ?? []).join(", ") || "—"}`);
    doc.text(`Approved: ${fmtDate(quotation.decidedAt ?? new Date())}   ·   Valid to: ${fmtDate(quotation.validityDate)}`);
    doc.moveDown(1);

    // Charge lines — sell side only.
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
    const lines = [...(quotation.chargeLines ?? [])].sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0));
    for (const l of lines) {
      const y = doc.y;
      doc.text(String(l.description ?? ""), cols[0], y, { width: 240 });
      const rowBottom = doc.y;
      doc.text(String(Number(l.quantity ?? 1)), cols[1], y);
      doc.text(money(l.unitPrice, ccy), cols[2], y, { width: 70 });
      doc.text(money(l.amount, ccy), cols[3], y, { width: 90 });
      doc.y = Math.max(rowBottom, doc.y);
      doc.moveDown(0.2);
    }
    if (!lines.length) doc.text("No charge lines.", cols[0], doc.y);

    doc.moveDown(0.4);
    doc.moveTo(left, doc.y).lineTo(left + 470, doc.y).strokeColor("#999").stroke();
    doc.moveDown(0.4);
    doc.font("Helvetica-Bold").fontSize(10);
    doc.text("Total", cols[2], doc.y, { continued: true }).text(`   ${money(quotation.totalAmount, ccy)}`);

    doc.moveDown(2);
    doc.font("Helvetica").fontSize(8).fillColor("#666")
      .text("Generated automatically from the approved quotation held in Consort ERP. Figures are the agreed sell-side charges.", left, doc.y, { width: 470 });

    doc.end();
  });

  const buf = await fs.promises.readFile(absPath);
  return {
    fileName: `${quotation.referenceNo}.pdf`,
    storageKey,
    mimeType: "application/pdf",
    sizeBytes: buf.length,
    checksum: crypto.createHash("sha256").update(buf).digest("hex"),
  };
};

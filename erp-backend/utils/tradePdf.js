import fs from "fs";
import path from "path";
import crypto from "crypto";
import { UPLOAD_ROOT, ensureDir } from "../modules/document/document.service.js";

/**
 * Renders the two trade documents Consort actually PRODUCES — the Packing List and the
 * Commercial Invoice — from their structured records (roadmap §4.3/§4.4).
 *
 * This is the point of holding the line items rather than a scan: the roadmap closes by
 * asking for a system that "removes both the duplicate data entry and the manual detail
 * retyping currently happening across these paper forms" (§8). Generating the PDF from
 * the record is what delivers that, and because ADR-048 derives a checklist item from
 * the presence of a document of that docType, the generated file also ticks the
 * `order_confirmed` pack on arrival.
 *
 * Best-effort, exactly like utils/quotationPdf.js: pdfkit is imported dynamically and a
 * failure returns null rather than rolling back the caller.
 */

const money = (n, ccy) =>
  `${ccy ?? ""} ${Number(n ?? 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`.trim();

const num = (n, dp = 2) =>
  n == null ? "—" : Number(n).toLocaleString("en-US", { minimumFractionDigits: dp, maximumFractionDigits: dp });

const fmtDate = (d) =>
  d ? new Date(d).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" }) : "—";

const loadPdfKit = async () => {
  try {
    const { default: PDFDocument } = await import("pdfkit");
    return PDFDocument;
  } catch {
    return null; // pdfkit not installed — the caller falls back to a manual upload
  }
};

/** Stream the document to `uploads/` and return the Document-row fields. */
const finish = (doc, fileName) =>
  new Promise((resolve, reject) => {
    const storageKey = `${crypto.randomUUID()}.pdf`;
    ensureDir(); // resolves under UPLOAD_ROOT itself — do not pass the root in
    const full = path.join(UPLOAD_ROOT, storageKey);
    const stream = fs.createWriteStream(full);
    doc.pipe(stream);
    stream.on("error", reject);
    stream.on("finish", () => {
      const buf = fs.readFileSync(full);
      resolve({
        fileName,
        storageKey,
        mimeType: "application/pdf",
        sizeBytes: buf.length,
        checksum: crypto.createHash("sha256").update(buf).digest("hex"),
      });
    });
    doc.end();
  });

/** A simple bordered table; returns the y position after the last row. */
const table = (doc, { x, y, widths, headers, rows, rowHeight = 16 }) => {
  const totalWidth = widths.reduce((a, b) => a + b, 0);
  doc.fontSize(7.5).font("Helvetica-Bold");
  let cx = x;
  headers.forEach((h, i) => {
    doc.text(String(h), cx + 2, y + 4, { width: widths[i] - 4, ellipsis: true });
    cx += widths[i];
  });
  doc.moveTo(x, y + rowHeight).lineTo(x + totalWidth, y + rowHeight).strokeColor("#999").stroke();

  let cy = y + rowHeight;
  doc.font("Helvetica").fontSize(7.5);
  for (const row of rows) {
    // Start a new page before the footer margin rather than overprinting it.
    if (cy > 720) {
      doc.addPage();
      cy = 60;
    }
    cx = x;
    row.forEach((cell, i) => {
      doc.text(String(cell ?? "—"), cx + 2, cy + 4, { width: widths[i] - 4, ellipsis: true });
      cx += widths[i];
    });
    cy += rowHeight;
    doc.moveTo(x, cy).lineTo(x + totalWidth, cy).strokeColor("#e5e5e5").stroke();
  }
  return cy;
};

const header = (doc, title, subtitle) => {
  doc.fontSize(15).font("Helvetica-Bold").fillColor("#111").text(title, 40, 40);
  if (subtitle) doc.fontSize(9).font("Helvetica").fillColor("#555").text(subtitle, 40, 60);
  doc.fillColor("#111");
};

/** Two-column key/value block; returns the y after the block. */
const facts = (doc, y, pairs) => {
  doc.fontSize(8).font("Helvetica");
  let cy = y;
  pairs.forEach(([k, v], i) => {
    const col = i % 2;
    const x = 40 + col * 270;
    if (col === 0 && i > 0) cy += 14;
    doc.font("Helvetica-Bold").fillColor("#555").text(`${k}: `, x, cy, { continued: true });
    doc.font("Helvetica").fillColor("#111").text(String(v ?? "—"));
  });
  return cy + 22;
};

/**
 * §4.3 Packing List — carton and piece level, per SKU, with the totals the Bill of
 * Lading and the Goods Declaration both restate.
 */
export const renderPackingListPdf = async ({ packingList, shipment, vendor, container }) => {
  const PDFDocument = await loadPdfKit();
  if (!PDFDocument) return null;

  const doc = new PDFDocument({ size: "A4", margin: 40 });
  header(doc, "PACKING LIST", `${packingList.referenceNo} · Shipment ${shipment.referenceNo}`);

  let y = facts(doc, 90, [
    ["Exporter", vendor?.name],
    ["Date", fmtDate(packingList.listDate ?? packingList.createdAt)],
    ["NTN", vendor?.taxId],
    ["REX No.", vendor?.rexNo],
    ["Container", container?.containerNo],
    ["Seal", container?.sealNo],
    ["Route", [shipment.originPort, shipment.destinationPort].filter(Boolean).join(" → ")],
    ["Incoterm", shipment.incoterm],
  ]);

  y = table(doc, {
    x: 40,
    y,
    widths: [52, 150, 52, 40, 38, 44, 58, 58],
    headers: ["SKU", "Description", "HS Code", "Qty/Box", "Boxes", "Pieces", "Net (kg)", "Gross (kg)"],
    rows: (packingList.items ?? []).map((i) => [
      i.skuRef,
      i.description,
      i.hsCode,
      i.qtyPerBox,
      i.boxes,
      i.pieces,
      num(i.netWeightKg, 2),
      num(i.grossWeightKg, 2),
    ]),
  });

  doc.font("Helvetica-Bold").fontSize(8.5);
  doc.text(
    `TOTAL — cartons ${packingList.totalCartons ?? 0} · pieces ${packingList.totalPieces ?? 0} · net ${num(packingList.totalNetWeightKg)} kg · gross ${num(packingList.totalGrossWeightKg)} kg`,
    40,
    y + 10,
  );

  if (packingList.notes) {
    doc.font("Helvetica").fontSize(7.5).fillColor("#555").text(packingList.notes, 40, y + 28, { width: 515 });
  }

  return finish(doc, `${packingList.referenceNo}.pdf`);
};

/**
 * §4.4 Commercial Invoice — HS codes, REX registration and the origin statement, which
 * are the fields the Goods Declaration and the bank collection both read off it.
 */
export const renderCommercialInvoicePdf = async ({ invoice, shipment, seller, buyer, bank, financialInstrument }) => {
  const PDFDocument = await loadPdfKit();
  if (!PDFDocument) return null;

  const doc = new PDFDocument({ size: "A4", margin: 40 });
  header(doc, "COMMERCIAL INVOICE", `${invoice.invoiceNo} · ${invoice.referenceNo} · Shipment ${shipment.referenceNo}`);

  let y = facts(doc, 90, [
    ["Seller", seller?.name],
    ["Buyer", buyer?.name],
    ["Invoice date", fmtDate(invoice.invoiceDate)],
    ["Terms", invoice.shipmentTerms ?? invoice.incoterm],
    ["REX No.", invoice.rexNo ?? seller?.rexNo],
    ["Financial Instrument", financialInstrument?.fiNumber],
    ["Bank", bank?.bankName ?? bank?.name],
    ["Route", [shipment.originPort, shipment.destinationPort].filter(Boolean).join(" → ")],
  ]);

  y = table(doc, {
    x: 40,
    y,
    widths: [178, 62, 52, 40, 68, 92],
    headers: ["Description", "HS Code", "Quantity", "UoM", "Unit price", "Amount"],
    rows: (invoice.lines ?? []).map((l) => [
      l.description,
      l.hsCode,
      num(l.quantity, 0),
      l.unitOfMeasure,
      num(l.unitPrice, 4),
      num(l.amount, 2),
    ]),
  });

  doc.font("Helvetica-Bold").fontSize(9).text(`TOTAL  ${money(invoice.totalValue, invoice.currency)}`, 40, y + 10, {
    width: 492,
    align: "right",
  });

  let cy = y + 34;
  if (invoice.originStatement) {
    doc.font("Helvetica").fontSize(7.5).fillColor("#555").text(invoice.originStatement, 40, cy, { width: 515 });
    cy += 22;
  }
  if (bank?.iban) {
    doc.font("Helvetica-Bold").fontSize(7.5).fillColor("#111").text("Bank details", 40, cy);
    doc
      .font("Helvetica")
      .fillColor("#555")
      .text(
        [bank.bankName, bank.bankBranch, bank.accountTitle, bank.iban, bank.swiftCode].filter(Boolean).join(" · "),
        40,
        cy + 11,
        { width: 515 },
      );
  }

  return finish(doc, `${invoice.referenceNo}.pdf`);
};

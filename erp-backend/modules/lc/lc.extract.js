import zlib from "zlib";

/**
 * Reading a bank's LC advice (CRM_MASTER §5.21).
 *
 * A referral that arrives by webhook carries structured JSON. One that arrives as
 * the SWIFT printout the bank actually emails carries nothing but a PDF — and
 * re-keying a 2-page MT700 by hand is how lanes, commodities and amounts get typed
 * wrong into a query. This module reads the PDF and returns the LC's own fields.
 *
 * NO PDF LIBRARY. Two reasons: this repo installs dependencies by hand, and the only
 * thing needed here is the text layer of a machine-generated SWIFT printout — Flate
 * content streams and the text-positioning operators, which is ~40 lines. What this
 * deliberately does NOT do is OCR: a scanned or image-only LC yields no text, and
 * `parseSwiftLc` will simply find no tags. Extraction is a convenience over the
 * operator's typing, never the system of record — the raw text is returned alongside
 * the fields so a human can check every value before a query is created from it.
 */

// ── PDF text layer ────────────────────────────────────────────────────────────

const unescapePdfString = (s) =>
  s
    .replace(/\\([nrtbf()\\])/g, (m, c) => ({ n: "\n", r: "\r", t: "\t", b: "", f: "" }[c] ?? c))
    .replace(/\\([0-7]{1,3})/g, (m, o) => String.fromCharCode(parseInt(o, 8)));

/** Inflate every Flate content stream that carries text operators. */
const contentStreams = (buf) => {
  const streams = [];
  let i = 0;
  while (true) {
    const s = buf.indexOf("stream", i);
    if (s < 0) break;
    let start = s + 6;
    if (buf[start] === 13) start++; // CR
    if (buf[start] === 10) start++; // LF
    const end = buf.indexOf("endstream", start);
    if (end < 0) break;
    try {
      const text = zlib.inflateSync(buf.subarray(start, end)).toString("latin1");
      if (/TJ|Tj/.test(text)) streams.push(text);
    } catch { /* not a flate stream (image, font, xref) — skip */ }
    i = end + 9;
  }
  return streams;
};

/**
 * Text with its layout preserved well enough to read: each stream is one page, and
 * within a page the runs are grouped into lines by their Tm y-coordinate and ordered
 * by x. Grouping across pages instead — the obvious first attempt — interleaves two
 * pages that share a coordinate space and produces confetti.
 */
export const extractPdfText = (buf) => {
  const pages = [];
  for (const stream of contentStreams(buf)) {
    const runs = [];
    let x = 0;
    let y = 0;
    // Either a text-matrix (Tm), a kerned array (TJ), or a plain string (Tj).
    const re = /(-?[\d.]+)\s+(-?[\d.]+)\s+(-?[\d.]+)\s+(-?[\d.]+)\s+(-?[\d.]+)\s+(-?[\d.]+)\s+Tm|\[((?:[^\][]|\\.)*)\]\s*TJ|\(((?:[^()\\]|\\.)*)\)\s*Tj/g;
    let m;
    while ((m = re.exec(stream))) {
      if (m[6] !== undefined) { x = parseFloat(m[5]); y = parseFloat(m[6]); continue; }
      let text = "";
      if (m[7] !== undefined) {
        const parts = /\(((?:[^()\\]|\\.)*)\)|(-?\d+)/g;
        let p;
        while ((p = parts.exec(m[7]))) {
          if (p[1] !== undefined) text += unescapePdfString(p[1]);
          // A wide negative kern is how these printouts space words — below this
          // threshold it is letter-spacing inside one word, not a gap.
          else if (Number(p[2]) < -180) text += " ";
        }
      } else {
        text = unescapePdfString(m[8]);
      }
      if (text.trim()) runs.push({ x, y, text });
    }
    if (!runs.length) continue;

    const byLine = new Map();
    for (const r of runs) {
      const key = Math.round(r.y * 2) / 2; // half-point tolerance
      if (!byLine.has(key)) byLine.set(key, []);
      byLine.get(key).push(r);
    }
    pages.push(
      [...byLine.entries()]
        .sort((a, b) => b[0] - a[0]) // PDF y grows upward
        .map(([, parts]) =>
          parts.sort((a, b) => a.x - b.x).map((p) => p.text).join("").replace(/\s+/g, " ").trim())
        .filter(Boolean),
    );
  }
  return { pages, text: pages.map((p) => p.join("\n")).join("\n") };
};

// ── SWIFT MT700 / MT710 field parsing ─────────────────────────────────────────

// The printout's own furniture. These appear between message blocks and must not be
// swallowed into whichever tag happened to precede them.
const FURNITURE = /^(-{3,}|Message (Header|Text|Trailer)|Instance Type|Priority\/Delivery|Swift Input|Message Input Reference|Sender\s*:|Receiver\s*:|SENT \d|=====)/i;

// "31C :Date of Issue" — the tag, then its human label on the same line.
const TAG_LINE = /^(\d{2}[A-Z]?)\s*:\s*(.*)$/;

/** Every SWIFT tag in the document as { tag, label, lines[] }, in order. */
export const parseSwiftTags = (text) => {
  const blocks = [];
  let current = null;
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    if (!line) continue;
    const m = TAG_LINE.exec(line);
    if (m) {
      current = { tag: m[1], label: m[2].replace(/^-\s*/, "").trim(), lines: [] };
      blocks.push(current);
      continue;
    }
    if (FURNITURE.test(line)) { current = null; continue; }
    if (current) current.lines.push(line);
  }
  return blocks;
};

/** YYMMDD → Date (SWIFT dates are always 6-digit, 20xx for our purposes). */
const swiftDate = (v) => {
  const m = /^(\d{2})(\d{2})(\d{2})$/.exec(String(v ?? "").trim());
  if (!m) return null;
  const d = new Date(Date.UTC(2000 + Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  return Number.isNaN(d.getTime()) ? null : d;
};

// "300000,00#300,000.00#" → 300000.00. SWIFT writes the decimal as a comma; the
// trailing #…# is the printout restating it, and taking THAT as the number is how
// a 300,000 LC would read as 300.
const swiftAmount = (v) => {
  const m = /^([\d.,]+)/.exec(String(v ?? "").trim());
  if (!m) return null;
  let s = m[1].replace(/#/g, "");
  if (/^\d+,\d{1,2}$/.test(s)) s = s.replace(",", ".");
  else s = s.replace(/,/g, "");
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
};

const INCOTERMS = ["EXW", "FCA", "FAS", "FOB", "CFR", "CIF", "CPT", "CIP", "DAP", "DPU", "DDP"];

// A party's legal suffix — the reliable end of a company name in a :50:/:59: block.
const LEGAL_SUFFIX = /\b(CO\.?,?\s*LTD|COMPANY LIMITED|LIMITED|LTD\.?|INC\.?|L\.?L\.?C|CORP(?:ORATION)?|PVT|GMBH|S\.A\.?|B\.V\.?|N\.V\.?|PLC)\b\.?/i;

/**
 * Split a party block into name and address.
 *
 * SWIFT wraps at 35 characters mid-name — "LINYI TRADE CITY NEW COMMERCIAL" /
 * "DEVELOPMENT CO.,LTD 6TH FLOOR,HUAKE" is ONE company followed by its address on
 * the same line. Taking line 1 as the name (the obvious reading) truncates it, and
 * taking the whole block makes the customer record an address. So: accumulate until
 * a legal suffix appears, and cut at the end of that suffix — everything after it is
 * address, on that line and below.
 */
// SWIFT lines often already end in a comma, so a naive join yields "ZONE,, KARACHI".
const joinAddress = (parts) =>
  parts.join(", ").replace(/\s*,(\s*,)+/g, ",").replace(/\s+/g, " ").replace(/^[\s,]+|[\s,]+$/g, "") || null;

const splitParty = (lines = []) => {
  if (!lines.length) return { name: null, address: null };
  const nameParts = [];
  for (let i = 0; i < Math.min(lines.length, 4); i += 1) {
    const m = LEGAL_SUFFIX.exec(lines[i]);
    if (m) {
      const cut = m.index + m[0].length;
      nameParts.push(lines[i].slice(0, cut).trim());
      const rest = [lines[i].slice(cut).replace(/^[\s,]+/, ""), ...lines.slice(i + 1)].filter(Boolean);
      return { name: nameParts.join(" ").replace(/\s+/g, " "), address: joinAddress(rest) };
    }
    nameParts.push(lines[i].trim());
  }
  // No suffix anywhere (a person, or a bank named plainly) — line 1 is the name.
  return { name: lines[0], address: joinAddress(lines.slice(1)) };
};

/**
 * The LC's business facts, as far as the message states them. Every field is
 * optional — a tag the bank omitted stays null rather than being guessed at.
 */
export const parseSwiftLc = (text) => {
  const blocks = parseSwiftTags(text);
  const byTag = new Map();
  for (const b of blocks) if (!byTag.has(b.tag)) byTag.set(b.tag, b);

  const block = (tag) => byTag.get(tag) ?? null;
  const first = (tag) => block(tag)?.lines[0] ?? null;
  const joined = (tag) => block(tag)?.lines.join("\n") ?? null;

  // MT700 puts the credit number in :20:; MT710 (an advice of someone else's credit)
  // puts the sender's own reference there and the credit number in :21:. Trust the
  // printed label over the tag number, and fall back to the tag.
  const labelled = (needle) =>
    blocks.find((b) => b.label.toLowerCase().includes(needle))?.lines[0] ?? null;

  const lcNumber = labelled("documentary credit number") ?? first("20");
  const senderRef = labelled("sender's reference") ?? (lcNumber === first("20") ? null : first("20"));

  // :32B: is "USD" glued to its spelled-out name, then the amount on the next line.
  const ccyBlock = block("32B");
  const currency = ccyBlock ? (/^([A-Z]{3})/.exec(ccyBlock.lines[0] ?? "")?.[1] ?? null) : null;
  const amount = ccyBlock ? swiftAmount(ccyBlock.lines[1] ?? ccyBlock.lines[0]) : null;

  // :45A: is a free-text goods description written as "+KEY:VALUE" bullets.
  const goods = joined("45A") ?? "";
  const bullet = (key) => {
    const m = new RegExp(`\\+\\s*${key}\\s*:\\s*([^\\n]+)`, "i").exec(goods);
    return m ? m[1].trim() : null;
  };

  const priceTerm = bullet("PRICE TERM");
  const incoterm = INCOTERMS.find((t) => new RegExp(`\\b${t}\\b`).test(priceTerm ?? goods)) ?? null;

  const applicant = splitParty(block("50")?.lines ?? []);
  const beneficiary = splitParty(
    blocks.find((b) => b.label.toLowerCase().startsWith("beneficiary"))?.lines ?? block("59")?.lines ?? [],
  );
  const issuingBank = blocks.find((b) => b.label.toLowerCase().includes("issuing bank"))?.lines ?? [];

  return {
    lcNumber,
    senderRef,
    formOfCredit: joined("40B"),
    applicableRules: first("40E"),
    issueDate: swiftDate(first("31C")),
    expiryDate: swiftDate(first("31D")),
    expiryPlace: block("31D")?.lines.slice(1).join(" ") || null,
    latestShipmentDate: swiftDate(first("44C")),
    currency,
    amount,
    tolerance: first("39A"),
    applicantName: applicant.name,
    applicantAddress: applicant.address,
    beneficiaryName: beneficiary.name,
    beneficiaryAddress: beneficiary.address,
    issuingBankBic: issuingBank.find((l) => /^[A-Z]{6}[A-Z0-9]{2,5}$/.test(l)) ?? null,
    issuingBankName: issuingBank.find((l) => !/^[A-Z]{6}[A-Z0-9]{2,5}$/.test(l)) ?? null,
    originPort: first("44E"),
    destinationPort: first("44F"),
    commodity: bullet("COMMODITY"),
    quantity: bullet("TOTAL QTY"),
    unitPrice: bullet("BASE UNIT PRICE"),
    totalValue: bullet("TOTAL VALUE"),
    countryOfOrigin: bullet("COUNTRY OF ORIGIN"),
    packing: bullet("PACKING"),
    priceTerm,
    incoterm,
    partialShipments: first("43P"),
    transhipment: first("43T"),
    goodsDescription: goods || null,
    documentsRequired: joined("46A"),
    additionalConditions: joined("47A"),
    tagCount: blocks.length,
  };
};

/**
 * "2500MT +/-10% BY CONTAINERS" → 2_500_000 kg.
 *
 * The tolerance is deliberately ignored: a query's weight is the nominal booking
 * figure, and quoting against the +10% ceiling would overstate every LC shipment.
 * Returns null when the unit is not one we can convert, rather than guessing.
 */
export const parseQuantityKg = (text) => {
  const m = /([\d.,]+)\s*(M\/?T|MT|METRIC TONS?|TONNES?|TONS?|KGS?|KILOS?)\b/i.exec(String(text ?? ""));
  if (!m) return null;
  const n = Number(m[1].replace(/,/g, ""));
  if (!Number.isFinite(n)) return null;
  return /K/i.test(m[2]) ? n : n * 1000; // kg as-is; everything else is tonnes
};

/**
 * Read an LC PDF end to end.
 * @returns { fields, text, pageCount } — `fields` is null-heavy when the PDF has no
 *          text layer (a scan), which the caller should surface rather than hide.
 */
export const readLcPdf = (buf) => {
  const { pages, text } = extractPdfText(buf);
  return { fields: parseSwiftLc(text), text, pageCount: pages.length };
};

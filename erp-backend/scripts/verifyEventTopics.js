/**
 * Static check (ADR-007/ADR-020): every outbox event actually invalidates something.
 *
 *   node scripts/verifyEventTopics.js
 *
 * The relay turns each dispatched event into ONE `data:changed` emit by looking the event
 * up in `utils/eventTopics.js`. An event with no row there dispatches normally, notifies
 * whoever it notified before, and invalidates nothing — the failure looks exactly like the
 * bug this whole change set removed ("I did something and the other screen is stale"), so
 * it needs a guard rather than a code review.
 *
 * Asserts:
 *  1. every `eventType` string written anywhere in modules/ or jobs/ resolves to a row;
 *  2. every topic a row names is a known topic (a typo would broadcast to nothing);
 *  3. every role a row names is a real role key from ROLE_PERMISSIONS (a typo would
 *     broadcast to an empty room, which is silent);
 *  4. every row has at least one topic AND one audience, or it cannot do anything;
 *  5. every row in the table corresponds to an event the code can actually emit (a stale
 *     row is dead weight and misleads the next reader).
 *
 * Pure source analysis — no DB, no network, safe to run anywhere.
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { EVENT_TOPICS, EVENT_TOPIC_PREFIXES, fanOutFor } from "../utils/eventTopics.js";
import { isKnownTopic } from "../utils/topics.js";
import { PERMISSIONS_BY_ROLE } from "../modules/auth/auth.middleware.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SCAN_DIRS = ["modules", "jobs"];

/** Every `eventType:`/`emitEvent(tx, "…")` literal the source can emit. */
const collectEmittedEventTypes = () => {
  const found = new Map(); // eventType → "file:line"

  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.name.endsWith(".js")) scan(full);
    }
  };

  const scan = (file) => {
    const lines = fs.readFileSync(file, "utf8").split("\n");
    lines.forEach((line, i) => {
      // Three shapes are in use across the codebase:
      //   emitEvent(tx, "type", …) / emit(tx, "type", …) / emitOtcEvent / emitShipmentEvent
      //   eventType: "type"                            (inline outboxEvent.create)
      //   emitEvent(tx, `type:${suffix}`, …)           (the step events, matched by prefix)
      //
      // Helpers whose second argument is NOT an eventType — emitCatalogChanged(tx, "step"),
      // emitDocumentsChanged(tx, doc, …) — are deliberately excluded; their own
      // `eventType:` literal is picked up by the second pattern instead.
      const patterns = [
        /\bemit(?:Event|OtcEvent|ShipmentEvent|Outbox)?\s*\(\s*(?:tx\s*,\s*)?["'`]([a-z][\w.]*(?::[\w.]*)?)/g,
        /\beventType:\s*["'`]([a-z][\w.]*(?::[\w.]*)?)/g,
      ];
      for (const re of patterns) {
        let m;
        while ((m = re.exec(line)) !== null) {
          // A template literal like `shipment.step.completed:${code}` yields the literal
          // prefix, which is exactly what the prefix rows are keyed on.
          const type = m[1];
          if (!found.has(type)) found.set(type, `${path.relative(ROOT, file)}:${i + 1}`);
        }
      }
    });
  };

  for (const dir of SCAN_DIRS) walk(path.join(ROOT, dir));
  return found;
};

const problems = [];
const notes = [];

const emitted = collectEmittedEventTypes();
const knownRoles = new Set(Object.keys(PERMISSIONS_BY_ROLE));

/* 1. Every emitted event resolves to a fan-out row. */
// Step events carry the step code as a suffix, so a literal like
// `shipment.step.completed:` matches a prefix row rather than an exact one.
for (const [type, where] of emitted) {
  const resolved = fanOutFor(type, {
    // A plausible payload, so `topics(payload)` returns its real shape rather than
    // collapsing to nothing and looking like a missing row.
    shipmentId: "00000000-0000-0000-0000-000000000000",
    customerId: "00000000-0000-0000-0000-000000000001",
    leadId: "00000000-0000-0000-0000-000000000002",
    ownerType: "shipment",
    ownerId: "00000000-0000-0000-0000-000000000000",
  });
  if (!resolved) {
    problems.push(`"${type}" (${where}) has no usable row in utils/eventTopics.js — it will invalidate nothing`);
  }
}

/* 2-4. Every row is well formed. */
const samplePayload = {
  shipmentId: "s", customerId: "c", leadId: "l", queryId: "q",
  ownerType: "shipment", ownerId: "s",
};
const allRows = [
  ...Object.entries(EVENT_TOPICS).map(([k, v]) => [k, v, "exact"]),
  ...Object.entries(EVENT_TOPIC_PREFIXES).map(([k, v]) => [k, v, "prefix"]),
];
for (const [type, row, kind] of allRows) {
  const topics = row.topics?.(samplePayload) ?? [];
  if (!topics.length) problems.push(`row "${type}" (${kind}) names no topics`);
  for (const topic of topics) {
    if (!isKnownTopic(topic)) problems.push(`row "${type}" names unknown topic "${topic}" — check utils/topics.js`);
  }
  for (const role of row.roles ?? []) {
    if (!knownRoles.has(role)) problems.push(`row "${type}" names unknown role "${role}" — it would broadcast to an empty room`);
  }
  const audience = (row.roles ?? []).length + (row.scoped?.(samplePayload) ?? []).length;
  if (!audience) problems.push(`row "${type}" has no audience (no roles and no scoped rooms) — nothing will receive it`);
}

/* 5. No stale rows describing events nothing emits. */
for (const type of Object.keys(EVENT_TOPICS)) {
  if (!emitted.has(type)) {
    notes.push(`row "${type}" is not emitted anywhere in modules/ or jobs/ (scheduler-only or dead?)`);
  }
}
for (const prefix of Object.keys(EVENT_TOPIC_PREFIXES)) {
  const used = [...emitted.keys()].some((t) => t.startsWith(prefix) || prefix.startsWith(t));
  if (!used) notes.push(`prefix row "${prefix}" matches nothing that is emitted`);
}

/* ── report ─────────────────────────────────────────────────────────────────── */

if (notes.length) {
  console.log(`Notes (not failures):\n${notes.map((n) => `  · ${n}`).join("\n")}\n`);
}
if (problems.length) {
  console.error(`FAILURES:\n${problems.map((p) => `  ✗ ${p}`).join("\n")}`);
  process.exit(1);
}
console.log(
  `✓ event fan-out: ${emitted.size} emitted event types, ${allRows.length} rows — every event invalidates something, every topic and role is real`,
);

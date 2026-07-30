/**
 * Read-only check (ADR-020): the outbox is transactional and is not silently backing up.
 *
 *   node scripts/verifyOutboxHygiene.js
 *
 * Asserts:
 *  1. an outbox row written inside a ROLLED-BACK transaction does not survive — every
 *     `emit*` helper takes the caller's `tx` precisely so an event can never announce a
 *     write that did not commit;
 *  2. no row has exhausted its retries. Such a row is excluded from the relay's query
 *     forever while `reapOutbox` only deletes DISPATCHED rows, so it sits in the table
 *     permanently and its invalidation never reaches anyone;
 *  3. nothing undispatched is unreasonably old (the relay polls every 3s, so a backlog
 *     older than a few minutes means the relay is not running);
 *  4. every recently dispatched eventType still resolves to a fan-out row, i.e. the events
 *     actually flowing in this database are ones clients will re-read for.
 *
 * Writes only inside the deliberately aborted transaction in check 1, so it is safe
 * against the shared demo database.
 */
import crypto from "crypto";
import prisma from "../config/prisma.js";
import { fanOutFor } from "../utils/eventTopics.js";

const MAX_ATTEMPTS = 5; // must match jobs/outboxRelay.js
const STALE_MINUTES = 5;

async function run() {
  const problems = [];
  const notes = [];

  /* 1. Rollback must take the event with it. */
  const probe = `verify.rollback.${crypto.randomUUID()}`;
  try {
    await prisma.$transaction(async (tx) => {
      await tx.outboxEvent.create({
        data: { eventType: probe, payload: { probe: true }, correlationId: crypto.randomUUID() },
      });
      throw new Error("deliberate rollback");
    });
  } catch (err) {
    if (err?.message !== "deliberate rollback") throw err;
  }
  const survivor = await prisma.outboxEvent.findFirst({ where: { eventType: probe } });
  if (survivor) {
    problems.push(
      `an outbox row survived a rolled-back transaction (id ${survivor.id}) — events can announce writes that never happened`,
    );
    // Leave the database as we found it.
    await prisma.outboxEvent.delete({ where: { id: survivor.id } });
  }

  /* 2. Poison rows. */
  const exhausted = await prisma.outboxEvent.findMany({
    where: { dispatchedAt: null, attempts: { gte: MAX_ATTEMPTS } },
    select: { id: true, eventType: true, attempts: true, lastError: true, createdAt: true },
    orderBy: { createdAt: "asc" },
    take: 20,
  });
  for (const row of exhausted) {
    problems.push(
      `event ${row.id} "${row.eventType}" exhausted ${row.attempts} attempts and will never dispatch: ${String(row.lastError ?? "").slice(0, 160)}`,
    );
  }

  /* 3. Backlog. */
  const cutoff = new Date(Date.now() - STALE_MINUTES * 60 * 1000);
  const stale = await prisma.outboxEvent.count({
    where: { dispatchedAt: null, attempts: { lt: MAX_ATTEMPTS }, createdAt: { lt: cutoff } },
  });
  if (stale > 0) {
    problems.push(
      `${stale} undispatched event(s) older than ${STALE_MINUTES} minutes — is the relay running? (startOutboxRelay)`,
    );
  }

  /* 4. What is actually flowing resolves to a fan-out row. */
  const recent = await prisma.outboxEvent.findMany({
    where: { dispatchedAt: { not: null } },
    select: { eventType: true, payload: true },
    orderBy: { dispatchedAt: "desc" },
    take: 200,
  });
  const unmapped = new Set();
  for (const row of recent) {
    if (!fanOutFor(row.eventType, row.payload ?? {})) unmapped.add(row.eventType);
  }
  for (const type of unmapped) {
    problems.push(`dispatched event "${type}" resolves to no fan-out row — no client re-reads for it`);
  }

  const pending = await prisma.outboxEvent.count({ where: { dispatchedAt: null } });
  notes.push(`${pending} undispatched, ${recent.length} recent dispatched inspected`);

  if (notes.length) console.log(`Notes:\n${notes.map((n) => `  · ${n}`).join("\n")}\n`);
  if (problems.length) {
    console.error(`FAILURES:\n${problems.map((p) => `  ✗ ${p}`).join("\n")}`);
    process.exit(1);
  }
  console.log("✓ outbox hygiene: transactional, no poison rows, no backlog, every flowing event maps to an invalidation");
}

run()
  .catch((e) => {
    console.error("verifyOutboxHygiene failed:", e.message);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
